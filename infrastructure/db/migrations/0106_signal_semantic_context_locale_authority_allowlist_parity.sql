-- 0106: Restore the dedicated locale-authority action after 0105 replaced the
-- element-operation validator. This is intentionally the 0105 function body
-- with one closed allowlist addition; every other guard remains unchanged.

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  SELECT generation.status,(generation.proposal_model IS NOT NULL AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL AND generation.proposal_pricing_version IS NOT NULL
      AND generation.proposal_provider_lineage IS NOT NULL AND generation.proposal_provider_lineage_digest IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation JOIN signal_workspaces workspace
      ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT workspace_artifact_kind,workspace_authority_digest INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF generation_status IS DISTINCT FROM 'draft' OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.proposed_by_user_id OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF artifact_kind IS DISTINCT FROM 'semantic_context' OR artifact_authority IS DISTINCT FROM NEW.element_digest
     OR group_artifact IS DISTINCT FROM NEW.artifact_id THEN
    RAISE EXCEPTION 'Semantic context element artifact/evidence lineage is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id)
     OR EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id
      AND NOT CASE link.source_type
        WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
          WHERE source.id=link.source_id AND source.id=generation_profile_id)
        WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
          JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
          WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation_profile_id)
        WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
          WHERE source.id=link.source_id AND source.organization_id=workspace_organization_id
            AND source.brand_id=workspace_brand_id AND source.study_corpus_id IS NULL
            AND source.status IN ('processed','profiled','active'))
        WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'semantic_context_operator_input' THEN link.relation_type='supports' AND (
          (operation.action='create-semantic-context-element-v1' AND link.source_id=operation.id)
          OR EXISTS(SELECT 1 FROM signal_governance_control_operations source_operation
            WHERE source_operation.id=link.source_id AND source_operation.workspace_id=NEW.workspace_id
              AND source_operation.action='create-semantic-context-element-v1'
              AND source_operation.status='completed'
              AND signal_data_governance_actor_is_valid(NEW.workspace_id,source_operation.actor_user_id)))
        ELSE false END) THEN
    RAISE EXCEPTION 'Semantic context source references are cross-workspace or stale.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_element_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions predecessor
    WHERE predecessor.id=NEW.supersedes_element_id AND predecessor.workspace_id=NEW.workspace_id
      AND predecessor.generation_id=NEW.generation_id AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND NOT (
      operation.action='append-semantic-context-proposals'
      AND (NEW.disposition='pending' OR (NEW.origin_kind='server_projection'
        AND NEW.disposition='approved'
        AND to_jsonb(NEW)->>'automatic_policy_outcome'='ready'))
    ) THEN
    RAISE EXCEPTION 'Semantic context proposal disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_decision' AND (operation.action NOT IN (
      'decide-semantic-context-element','bulk-approve-semantic-context-elements')
      OR NEW.disposition NOT IN ('approved','rejected') OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator decision is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_merge' AND (operation.action<>'merge-semantic-context-elements'
       OR NEW.disposition<>'merged') THEN
    RAISE EXCEPTION 'Semantic context merged disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_correction' AND (operation.action NOT IN (
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements',
      'decide-semantic-context-locale-authority')
      OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context correction disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_created' AND (operation.action<>'create-semantic-context-element-v1'
      OR NEW.disposition<>'approved' OR NEW.lifecycle_state<>'active'
      OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator creation is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION validate_signal_semantic_context_element_operation_v2() IS
  'Validates Semantic Context element operation authority; 0106 restores only the dedicated locale-authority action omitted by 0105.';
