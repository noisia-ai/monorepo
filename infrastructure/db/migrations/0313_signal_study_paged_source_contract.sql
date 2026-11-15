-- A paged Study source is a new immutable header contract. Existing inline
-- source hashes, frozen row proofs, cut completeness, actor and money guards
-- remain unchanged. Only fresh executions may declare this storage protocol.
CREATE FUNCTION signal_study_paged_source_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE m jsonb;actual_native_bytes bigint;
BEGIN
 IF NOT(NEW.source_header ? 'source_storage') THEN RETURN NEW;END IF;
 m:=NEW.source_header->'source_storage';
 IF jsonb_typeof(m) IS DISTINCT FROM 'object'
  OR m->>'contract_version' IS DISTINCT FROM 'signal-study-source-pages-v1'
  OR (SELECT count(*) FROM jsonb_object_keys(m))<>10
  OR NOT(m ?& ARRAY['contract_version','root_count','root_manifest_digest','metadata_bytes','vector_bytes','native_vector_json_bytes',
    'descriptor_working_limit_bytes','page_working_limit_bytes','cache_working_limit_bytes','vector_encoding'])
  OR EXISTS(SELECT 1 FROM jsonb_each(m) x WHERE x.key IN('root_count','metadata_bytes','vector_bytes','native_vector_json_bytes',
    'descriptor_working_limit_bytes','page_working_limit_bytes','cache_working_limit_bytes')
    AND(jsonb_typeof(x.value) IS DISTINCT FROM 'number' OR x.value::text !~ '^[0-9]+$'))
  OR COALESCE(m->>'root_manifest_digest','')!~'^sha256:[0-9a-f]{64}$'
  OR m->>'vector_encoding' IS DISTINCT FROM 'float64-le-exact-parsed-native'
 THEN RAISE EXCEPTION 'study_paged_source_contract_invalid';END IF;
 IF (m->>'root_count')::numeric<>NEW.source_roots OR NEW.source_roots>32768
  OR (m->>'vector_bytes')::numeric<>8192::numeric*NEW.source_roots
  OR (m->>'descriptor_working_limit_bytes')::numeric<>268435456
  OR (m->>'page_working_limit_bytes')::numeric<>16777216
  OR (m->>'cache_working_limit_bytes')::numeric<131072 OR(m->>'cache_working_limit_bytes')::numeric>16777216
  OR (m->>'descriptor_working_limit_bytes')::numeric+(m->>'page_working_limit_bytes')::numeric+(m->>'cache_working_limit_bytes')::numeric>536870912
  OR NEW.source_bytes<>(m->>'descriptor_working_limit_bytes')::numeric+(m->>'page_working_limit_bytes')::numeric+(m->>'cache_working_limit_bytes')::numeric
  OR (m->>'metadata_bytes')::numeric+(m->>'native_vector_json_bytes')::numeric+(m->>'vector_bytes')::numeric>2147483648
  OR NEW.source_header->'max_roots' IS DISTINCT FROM '32768'::jsonb
  OR NEW.source_header->'max_bytes' IS DISTINCT FROM '134217728'::jsonb
  OR octet_length(NEW.source_header::text)>134217728
 THEN RAISE EXCEPTION 'study_paged_source_bound_invalid';END IF;
 IF TG_OP='UPDATE' AND OLD.status='building' AND NEW.status='queued' THEN
  IF NEW.source_digest IS DISTINCT FROM signal_labeling_digest_v1(NEW.source_header)
   OR NEW.source_census_digest IS DISTINCT FROM signal_study_census_v1(NEW.id)
  THEN RAISE EXCEPTION 'study_paged_source_digest_invalid';END IF;
  SELECT COALESCE(sum(octet_length(cached.embedding::text)),0) INTO actual_native_bytes
   FROM signal_study_source_roots saved JOIN signal_workspace_chunk_embeddings cached
    ON cached.workspace_id=saved.workspace_id AND cached.config_digest=saved.embedding_config_digest AND cached.chunk_sha256=saved.chunk_sha256
   WHERE saved.execution_id=NEW.id AND saved.workspace_id=NEW.workspace_id;
  IF actual_native_bytes<>(m->>'native_vector_json_bytes')::numeric
  THEN RAISE EXCEPTION 'study_paged_source_vector_bytes_invalid';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aab_signal_study_paged_source_guard BEFORE INSERT OR UPDATE ON signal_study_executions
 FOR EACH ROW EXECUTE FUNCTION signal_study_paged_source_guard_v1();
REVOKE ALL ON FUNCTION signal_study_paged_source_guard_v1() FROM PUBLIC;
