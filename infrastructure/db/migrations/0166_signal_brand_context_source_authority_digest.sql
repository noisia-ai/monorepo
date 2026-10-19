-- Keep the mutable source-authority check linear in the size of a brand's
-- knowledge base. The previous implementation assembled one large JSONB value
-- and recursively canonicalized it on every quote/admission checkpoint.
CREATE OR REPLACE FUNCTION signal_brand_context_processing_source_current_v1(target_generation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;w signal_workspaces%ROWTYPE;
 profile brand_os_profiles%ROWTYPE;brand brands%ROWTYPE;brand_snapshot jsonb;
 source_members text;chunk_members text;current_knowledge text;artifact_digest text;brief jsonb;
 current_locales text[];current_markets text[];current_primary text;current_timezone text;current_locale_digest text;
BEGIN
 SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation;
 SELECT * INTO w FROM signal_workspaces WHERE id=generation.workspace_id;
 SELECT * INTO brand FROM brands WHERE id=w.brand_id AND organization_id=w.organization_id AND status='active';
 SELECT * INTO profile FROM brand_os_profiles WHERE brand_id=w.brand_id AND organization_id=w.organization_id AND status='active'
  ORDER BY version DESC LIMIT 1;
 IF generation.id IS NULL OR w.id IS NULL OR brand.id IS NULL OR profile.id IS NULL
  OR profile.id IS DISTINCT FROM generation.brand_os_profile_id
  OR profile.version IS DISTINCT FROM generation.brand_os_profile_version
  OR profile.metadata->>'snapshot_hash' IS DISTINCT FROM generation.brand_os_digest
  OR profile.metadata->'countries' IS DISTINCT FROM to_jsonb(brand.countries) THEN RETURN false; END IF;
 SELECT jsonb_build_object('name',COALESCE(brand.display_name,brand.name),'description',brand.description,
  'organization_id',brand.organization_id::text,'industry',brand.industry,'industry_sub',brand.industry_sub,
  'countries',brand.countries,'aliases',COALESCE(brand.brand_seed_handles,ARRAY[]::text[]),
  'competitors',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',seed.canonical_name,'seed_id',seed.id::text)
    ORDER BY lower(seed.canonical_name),seed.id) FROM competitors competitor JOIN brand_seeds seed
    ON seed.id=competitor.competitor_brand_seed_id WHERE competitor.brand_id=brand.id
      AND competitor.status='current' AND seed.active),'[]'::jsonb),
  'knowledge_count',(SELECT count(*)::int FROM brand_knowledge_sources source WHERE source.brand_id=brand.id
    AND source.study_corpus_id IS NULL AND source.status IN('processed','profiled','active'))) INTO brand_snapshot;
 IF signal_semantic_context_digest_json_v2(brand_snapshot) IS DISTINCT FROM generation.brand_os_digest THEN RETURN false; END IF;
 SELECT COALESCE(string_agg('{"digest":"'||
   (CASE WHEN COALESCE(source.file_hash,'')~'^sha256:[0-9a-f]{64}$' THEN source.file_hash ELSE
    'sha256:'||encode(digest(COALESCE(source.raw_text,'')||source.extracted_payload::text,'sha256'),'hex') END)||
   '","id":"'||source.id::text||'","kind":'||signal_semantic_context_escape_string_v2(source.source_kind)||'}',
   ',' ORDER BY source.id),'') INTO source_members
  FROM brand_knowledge_sources source
  WHERE source.organization_id=w.organization_id AND source.brand_id=w.brand_id AND source.study_corpus_id IS NULL
    AND source.status IN('processed','profiled','active');
 SELECT COALESCE(string_agg('{"content_digest":"sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex')||
   '","id":"'||chunk.id::text||'","source_id":"'||chunk.knowledge_source_id::text||'"}',
   ',' ORDER BY chunk.id),'') INTO chunk_members
  FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
  WHERE source.organization_id=w.organization_id AND source.brand_id=w.brand_id AND source.study_corpus_id IS NULL
    AND source.status IN('processed','profiled','active');
 current_knowledge:=signal_semantic_context_digest_v1(
  '{"chunks":['||chunk_members||'],"sources":['||source_members||']}');
 SELECT acquisition_brief INTO brief FROM signal_acquisition_plans WHERE workspace_id=w.id AND acquisition_brief IS NOT NULL
 AND status IN('current','draft') ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC LIMIT 1;
 IF brief IS NOT NULL THEN
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_locales FROM (
   SELECT DISTINCT btrim(value) value FROM jsonb_array_elements_text(COALESCE(brief->'languages','[]'::jsonb)) item(value)
   WHERE btrim(value)<>'') normalized;
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_markets FROM (
   SELECT DISTINCT btrim(value) value FROM jsonb_array_elements_text(COALESCE(brief->'countries','[]'::jsonb)) item(value)
   WHERE btrim(value)<>'') normalized;
  current_primary:=COALESCE(brief->>'primary_locale',CASE WHEN current_locales[1] LIKE '%-%' THEN current_locales[1]
   WHEN current_markets[1] IS NOT NULL AND current_locales[1] IS NOT NULL THEN lower(left(current_locales[1],2))||'-'||current_markets[1] END);
  current_timezone:=COALESCE(brief->>'timezone',w.timezone);
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_locales FROM (
   SELECT DISTINCT value FROM (SELECT unnest(current_locales) value UNION ALL SELECT current_primary) item
   WHERE value IS NOT NULL AND btrim(value)<>'') normalized;
  IF current_primary IS NULL OR NOT current_primary=ANY(current_locales) OR cardinality(current_markets)=0 THEN RETURN false; END IF;
  current_locale_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object('primary_locale',current_primary,
   'locale_variants',current_locales,'markets',current_markets,'timezone',current_timezone));
  IF current_locale_digest IS DISTINCT FROM generation.locale_context_digest THEN RETURN false; END IF;
 ELSE
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_markets FROM (
   SELECT DISTINCT btrim(value) value FROM unnest(COALESCE(brand.countries::text[],ARRAY[]::text[])) item(value)
   WHERE btrim(value)<>'') normalized;
  IF generation.markets IS DISTINCT FROM current_markets OR generation.timezone IS DISTINCT FROM w.timezone
   OR NOT generation.primary_locale=ANY(generation.locale_variants) THEN RETURN false; END IF;
 END IF;
 SELECT workspace_authority_digest INTO artifact_digest FROM analysis_artifacts WHERE id=generation.artifact_id
  AND workspace_id=generation.workspace_id AND workspace_artifact_kind='semantic_context';
 RETURN current_knowledge=generation.knowledge_digest AND artifact_digest=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'brand_os_profile_id',generation.brand_os_profile_id,'brand_os_profile_version',generation.brand_os_profile_version,
  'brand_os_digest',generation.brand_os_digest,'knowledge_generation_key',generation.knowledge_generation_key,
  'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest));
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false;
END; $$;

REVOKE ALL ON FUNCTION signal_brand_context_processing_source_current_v1(uuid) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_processing_source_current_v1(uuid) FROM %I',role_name);
  END IF;
 END LOOP;
END; $$;
