-- 0101_signal_semantic_context_inherited_applicability.sql
-- Forward-only effective applicability for Semantic Context publication.

CREATE OR REPLACE FUNCTION signal_semantic_context_parent_applicability_v1(
  target_generation_id uuid,
  expected_live_authority jsonb
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE canonical_locales text[];canonical_markets text[];computed_locale_digest text;
DECLARE authority jsonb;parent jsonb;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN
    RETURN jsonb_build_object('valid',false,'reason','parent_authority_missing');
  END IF;
  IF expected_live_authority IS NULL OR jsonb_typeof(expected_live_authority)<>'object' THEN
    RETURN jsonb_build_object('valid',false,'reason','live_authority_missing');
  END IF;
  IF generation.primary_locale IS NULL OR generation.primary_locale=''
     OR generation.primary_locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
     OR generation.timezone IS NULL OR generation.timezone=''
     OR COALESCE(cardinality(generation.locale_variants),0)=0
     OR COALESCE(cardinality(generation.markets),0)=0 THEN
    RETURN jsonb_build_object('valid',false,'reason','parent_authority_malformed');
  END IF;
  SELECT COALESCE(array_agg(value ORDER BY convert_to(value,'UTF8')),'{}'::text[])
    INTO canonical_locales FROM (SELECT DISTINCT unnest(generation.locale_variants) value) values;
  SELECT COALESCE(array_agg(value ORDER BY convert_to(value,'UTF8')),'{}'::text[])
    INTO canonical_markets FROM (SELECT DISTINCT unnest(generation.markets) value) values;
  IF canonical_locales IS DISTINCT FROM generation.locale_variants
     OR canonical_markets IS DISTINCT FROM generation.markets
     OR NOT generation.primary_locale=ANY(canonical_locales)
     OR EXISTS(SELECT 1 FROM unnest(canonical_locales) value
       WHERE value IS NULL OR value !~ '^[a-z]{2,3}(-[A-Z]{2})?$')
     OR EXISTS(SELECT 1 FROM unnest(canonical_markets) value
       WHERE value IS NULL OR value !~ '^[A-Z]{2}$') THEN
    RETURN jsonb_build_object('valid',false,'reason','parent_authority_malformed');
  END IF;
  computed_locale_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'primary_locale',generation.primary_locale,'locale_variants',to_jsonb(canonical_locales),
    'markets',to_jsonb(canonical_markets),'timezone',generation.timezone));
  IF generation.locale_context_digest IS DISTINCT FROM computed_locale_digest THEN
    RETURN jsonb_build_object('valid',false,'reason','parent_authority_digest_invalid');
  END IF;
  authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest);
  IF authority IS DISTINCT FROM expected_live_authority THEN
    RETURN jsonb_build_object('valid',false,'reason','live_authority_drift');
  END IF;
  parent:=jsonb_build_object(
    'contract_version','signal-semantic-context-parent-applicability-v1',
    'source','sealed_generation_locale_context',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'primary_locale',generation.primary_locale,'locales',to_jsonb(canonical_locales),
    'markets',to_jsonb(canonical_markets),'timezone',generation.timezone,
    'locale_context_digest',generation.locale_context_digest);
  RETURN jsonb_build_object('valid',true,'parent_authority',parent,
    'parent_authority_digest',signal_semantic_context_digest_json_v2(parent));
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_effective_applicability_v1(
  target_element_id uuid,
  expected_live_authority jsonb
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;
DECLARE parent_result jsonb;parent jsonb;applicability jsonb;state text;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  IF element.id IS NULL THEN RETURN jsonb_build_object('valid',false,'reason','element_missing'); END IF;
  IF element.disposition<>'approved' THEN
    RETURN jsonb_build_object('valid',false,'reason','element_not_approved');
  END IF;
  parent_result:=signal_semantic_context_parent_applicability_v1(element.generation_id,expected_live_authority);
  IF parent_result->>'valid'<>'true' THEN RETURN parent_result; END IF;
  parent:=parent_result->'parent_authority';
  IF element.locale_decision_contract_version IS NOT NULL THEN
    IF NOT signal_semantic_context_locale_authority_valid_v1(element.id) THEN
      RETURN jsonb_build_object('valid',false,'reason','explicit_locale_authority_invalid');
    END IF;
    state:=CASE element.locale_decision_disposition WHEN 'global' THEN 'explicit_global'
      WHEN 'locale_specific' THEN 'explicit_locale' ELSE NULL END;
  ELSE
    SELECT * INTO origin FROM signal_semantic_context_element_versions
      WHERE id=COALESCE(element.original_proposal_element_id,element.id);
    IF origin.id IS NULL OR origin.generation_id<>element.generation_id
       OR origin.element_key<>element.element_key
       OR origin.origin_kind NOT IN ('server_projection','provider_proposal')
       OR origin.locale IS DISTINCT FROM element.locale
       OR origin.locale_decision_contract_version IS NOT NULL THEN
      RETURN jsonb_build_object('valid',false,'reason','proposal_origin_invalid');
    END IF;
    IF element.locale IS NOT NULL THEN
      IF NOT signal_semantic_context_locale_authority_valid_v1(element.id) THEN
        RETURN jsonb_build_object('valid',false,'reason','explicit_locale_invalid');
      END IF;
      state:='explicit_locale';
    ELSIF element.element_kind='locale_variant' THEN
      RETURN jsonb_build_object('valid',false,'reason','locale_specific_locale_required');
    ELSE
      state:='workspace_inherited';
    END IF;
  END IF;
  applicability:=jsonb_build_object(
    'contract_version','signal-semantic-context-effective-applicability-v1',
    'state',state,
    'locale',element.locale,
    'locales',CASE WHEN state='explicit_locale' THEN jsonb_build_array(element.locale)
      ELSE parent->'locales' END,
    'markets',parent->'markets',
    'source',CASE state WHEN 'workspace_inherited' THEN 'sealed_generation_locale_context'
      WHEN 'explicit_global' THEN 'operator_locale_authority'
      WHEN 'explicit_locale' THEN CASE WHEN element.locale_decision_contract_version IS NOT NULL
        THEN 'operator_locale_authority' ELSE 'sealed_element_locale' END
      ELSE NULL END,
    'parent_authority',parent,
    'parent_authority_digest',parent_result->>'parent_authority_digest',
    'explicit_authority_digest',CASE WHEN element.locale_decision_contract_version IS NULL THEN NULL
      ELSE element.locale_decision_authority_digest END);
  RETURN jsonb_build_object('valid',true,'applicability',applicability,
    'applicability_digest',signal_semantic_context_digest_json_v2(applicability));
END; $$;

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0101_v2;

CREATE OR REPLACE FUNCTION signal_semantic_context_publication_snapshot_v2(
  target_generation_id uuid,
  expected_live_authority jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;generation signal_semantic_context_generations%ROWTYPE;
DECLARE candidate jsonb;candidate_digest text;applicability_graph jsonb;applicability_graph_digest text;
DECLARE review_digest text;publication_graph jsonb;pack_digest text;preflight jsonb;counts jsonb;
DECLARE blockers text[]:='{}';invalid_applicability integer;parent_result jsonb;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN RAISE EXCEPTION 'Semantic context generation not found.' USING ERRCODE='P0002'; END IF;
  IF expected_live_authority IS NULL OR jsonb_typeof(expected_live_authority)<>'object' THEN
    RAISE EXCEPTION 'Semantic context live authority is required.' USING ERRCODE='23514';
  END IF;
  base:=signal_semantic_context_publication_snapshot_pre_0101_v2(target_generation_id,expected_live_authority);
  parent_result:=signal_semantic_context_parent_applicability_v1(target_generation_id,expected_live_authority);

  WITH approved AS (
    SELECT element.*,signal_semantic_context_effective_applicability_v1(element.id,expected_live_authority) resolved
    FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND element.disposition='approved' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*) FILTER(WHERE resolved->>'valid'<>'true')::int,
    jsonb_build_object('contract_version','signal-semantic-context-candidate-pack-v3',
      'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
      'elements',COALESCE(jsonb_agg(jsonb_build_object(
        'element_key',element_key,'element_version',element_version,'element_kind',element_kind,
        'canonical_key',canonical_key,'display_text',display_text,'scope',scope,'entity_type',entity_type,
        'entity_id',lower(entity_id::text),'locale',locale,'relation_kind',relation_kind,
        'relation_target_key',relation_target_key,'applicability',resolved->'applicability')
        ORDER BY convert_to(element_key,'UTF8'),element_version),'[]'::jsonb))
    INTO invalid_applicability,candidate FROM approved;
  candidate_digest:=signal_semantic_context_digest_json_v2(candidate);

  applicability_graph:=jsonb_build_object(
    'contract_version','signal-semantic-context-applicability-graph-v1',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'parent_authority_digest',parent_result->>'parent_authority_digest',
    'elements',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element_key',element.element_key,'element_version',element.element_version,
      'state',resolved.value->'applicability'->>'state',
      'applicability_digest',resolved.value->>'applicability_digest')
      ORDER BY convert_to(element.element_key,'UTF8'),element.element_version)
      FROM signal_semantic_context_element_versions element
      CROSS JOIN LATERAL (SELECT signal_semantic_context_effective_applicability_v1(
        element.id,expected_live_authority) value) resolved
      WHERE element.generation_id=generation.id AND element.disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)),'[]'::jsonb));
  applicability_graph_digest:=signal_semantic_context_digest_json_v2(applicability_graph);
  review_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-review-graph-v6',
    'prior_review_graph_digest',base->>'review_graph_digest',
    'applicability_graph_digest',applicability_graph_digest));
  publication_graph:=jsonb_build_object('contract_version','signal-semantic-context-publication-graph-v3',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'candidate_pack_digest',candidate_digest,'evidence_graph_digest',base->>'evidence_graph_digest',
    'review_graph_digest',review_digest,'authority',base->'preflight'->'authority');
  pack_digest:=signal_semantic_context_digest_json_v2(publication_graph);
  counts:=(base->'counts')||jsonb_build_object('locale_market_required_unresolved',invalid_applicability);
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value)
    WHERE value<>'locale_market_required_unresolved';
  IF generation.status='draft' AND invalid_applicability>0 THEN
    blockers:=array_append(blockers,'locale_market_required_unresolved');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item),'{}'::text[]) INTO blockers FROM unnest(blockers) item;
  preflight:=(base->'preflight')||jsonb_build_object(
    'candidate_pack_digest',candidate_digest,'review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,'counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,
    'applicability_contract_version','signal-semantic-context-effective-applicability-v1',
    'parent_applicability',parent_result->'parent_authority',
    'parent_authority_digest',parent_result->>'parent_authority_digest',
    'applicability_graph_digest',applicability_graph_digest);
  RETURN base||jsonb_build_object(
    'candidate_pack',candidate,'candidate_pack_digest',candidate_digest,
    'review_graph_digest',review_digest,'semantic_context_pack_digest',pack_digest,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight),
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,
    'applicability_graph',applicability_graph,'applicability_graph_digest',applicability_graph_digest,
    'applicability_contract_version','signal-semantic-context-effective-applicability-v1',
    'parent_applicability',parent_result->'parent_authority',
    'preflight',preflight);
END; $$;

COMMENT ON FUNCTION signal_semantic_context_parent_applicability_v1(uuid,jsonb) IS
  'Validates the immutable generation locale/market envelope and exact live authority; never accepts browser authority.';
COMMENT ON FUNCTION signal_semantic_context_effective_applicability_v1(uuid,jsonb) IS
  'Resolves explicit locale, explicit global, or workspace-inherited applicability without rewriting leaf locale.';
COMMENT ON FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) IS
  '0101 publication and pack snapshot sharing the DB-owned effective-applicability resolver.';
