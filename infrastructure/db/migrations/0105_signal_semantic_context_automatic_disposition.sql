-- 0105 — deterministic trust-and-revert disposition for provider proposals.
-- The provider proposal remains immutable; eligible rows receive one append-only ready successor.

ALTER TABLE signal_semantic_context_events DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
  'generation_created','generation_reconciled','proposals_appended','element_approved','element_rejected',
  'element_corrected','elements_bulk_approved','elements_merged','review_annotation_created',
  'review_annotation_updated','review_annotation_resolved','locale_authority_decided','generation_published',
  'ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore',
  'operator_element_created','automatic_policy_ready'
));

ALTER TABLE signal_semantic_context_element_versions
  ADD COLUMN automatic_policy_contract_version text,
  ADD COLUMN automatic_policy_outcome text,
  ADD COLUMN automatic_policy_basis jsonb,
  ADD COLUMN automatic_policy_basis_digest text,
  ADD COLUMN automatic_policy_input_digest text,
  ADD COLUMN automatic_policy_prestate_digest text,
  ADD COLUMN automatic_policy_poststate_digest text,
  ADD COLUMN automatic_policy_decided_at timestamptz;

ALTER TABLE signal_semantic_context_element_versions ADD CONSTRAINT
  signal_semantic_context_automatic_policy_all_or_none CHECK (
    (automatic_policy_contract_version IS NULL AND automatic_policy_outcome IS NULL
      AND automatic_policy_basis IS NULL AND automatic_policy_basis_digest IS NULL
      AND automatic_policy_input_digest IS NULL AND automatic_policy_prestate_digest IS NULL
      AND automatic_policy_poststate_digest IS NULL AND automatic_policy_decided_at IS NULL)
    OR (automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'
      AND automatic_policy_outcome IN ('ready','exception')
      AND jsonb_typeof(automatic_policy_basis)='object'
      AND automatic_policy_basis_digest ~ '^sha256:[0-9a-f]{64}$'
      AND automatic_policy_input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND automatic_policy_prestate_digest ~ '^sha256:[0-9a-f]{64}$'
      AND automatic_policy_poststate_digest ~ '^sha256:[0-9a-f]{64}$'
      AND automatic_policy_decided_at IS NOT NULL)
  );

ALTER TABLE signal_semantic_context_proposal_runs
  ADD COLUMN automatic_policy_contract_version text,
  ADD COLUMN automatic_ready_count integer,
  ADD COLUMN automatic_exception_count integer,
  ADD CONSTRAINT signal_semantic_context_run_automatic_counts_valid_v1 CHECK (
    (automatic_policy_contract_version IS NULL
      AND automatic_ready_count IS NULL AND automatic_exception_count IS NULL)
    OR (automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'
      AND automatic_ready_count BETWEEN 0 AND 250
      AND automatic_exception_count BETWEEN 0 AND 250
      AND automatic_ready_count + automatic_exception_count = proposal_count)
  );

-- Preserve the complete 0103 element-operation authority and add one closed automatic-ready branch.
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
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements')
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

CREATE FUNCTION signal_semantic_context_automatic_operation_run_valid_v1(target_operation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE run signal_semantic_context_proposal_runs%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;DECLARE input jsonb;DECLARE run_input jsonb;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  input:=operation.semantic_context_decision_input;run_input:=input->'run';
  IF operation.id IS NULL OR operation.action<>'append-semantic-context-proposals'
     OR operation.status<>'completed' OR jsonb_typeof(input)<>'object'
     OR input-ARRAY['contract_version','generation_key','run','proposal_count','proposal_keys','parent_authority_digest','outcomes','policy_digest']<>'{}'::jsonb
     OR NOT input ?& ARRAY['contract_version','generation_key','run','proposal_count','proposal_keys','parent_authority_digest','outcomes','policy_digest']
     OR input->>'contract_version'<>'signal-semantic-context-automatic-run-operation-v2'
     OR jsonb_typeof(input->'proposal_count')<>'number' OR jsonb_typeof(input->'proposal_keys')<>'array'
     OR jsonb_typeof(input->'outcomes')<>'array' OR jsonb_typeof(run_input)<>'object'
     OR run_input-ARRAY['run_id','run_key','response_digest','validated_output_digest','provider_lineage_digest',
       'provider_request_identity','brand_os_digest','knowledge_digest','locale_context_digest','prompt_digest',
       'context_input_digest','settled_micro_usd']<>'{}'::jsonb
     OR NOT run_input ?& ARRAY['run_id','run_key','response_digest','validated_output_digest','provider_lineage_digest',
       'provider_request_identity','brand_os_digest','knowledge_digest','locale_context_digest','prompt_digest',
       'context_input_digest','settled_micro_usd']
     OR operation.semantic_context_decision_input_digest<>signal_semantic_context_digest_json_v2(input)
     OR COALESCE(run_input->>'run_id','') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  SELECT * INTO run FROM signal_semantic_context_proposal_runs WHERE id=(run_input->>'run_id')::uuid;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=run.generation_id;
  RETURN run.id IS NOT NULL AND generation.id IS NOT NULL AND run.workspace_id=operation.workspace_id
    AND run.created_by_user_id=operation.actor_user_id AND run.appended_operation_id=operation.id
    AND run.status='completed' AND run.provider_call_state='settled' AND run.provider_call_count=1
    AND run.provider_response_private IS NOT NULL AND run.provider_response_digest=run_input->>'response_digest'
    AND run.validated_output_digest=run_input->>'validated_output_digest'
    AND run.provider_lineage_digest=run_input->>'provider_lineage_digest'
    AND run.provider_request_identity=run_input->>'provider_request_identity'
    AND run.run_key=run_input->>'run_key' AND run.brand_os_digest=run_input->>'brand_os_digest'
    AND run.knowledge_digest=run_input->>'knowledge_digest'
    AND run.locale_context_digest=run_input->>'locale_context_digest'
    AND run.prompt_digest=run_input->>'prompt_digest' AND run.context_input_digest=run_input->>'context_input_digest'
    AND run.settled_micro_usd::text=run_input->>'settled_micro_usd'
    AND generation.generation_key=input->>'generation_key'
    AND generation.brand_os_digest=run.brand_os_digest AND generation.knowledge_digest=run.knowledge_digest
    AND generation.locale_context_digest=run.locale_context_digest
    AND generation.proposal_prompt_digest=run.prompt_digest
    AND generation.proposal_provider_lineage_digest=run.provider_lineage_digest
    AND (input->>'proposal_count')::int=run.proposal_count
    AND jsonb_array_length(input->'proposal_keys')=run.proposal_count
    AND jsonb_array_length(input->'outcomes')=run.proposal_count
    AND run.automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'
    AND run.automatic_ready_count+run.automatic_exception_count=run.proposal_count
    AND EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation
      WHERE reservation.run_id=run.id AND reservation.status='settled'
        AND reservation.actual_micro_usd=run.settled_micro_usd
        AND reservation.actual_micro_usd<=reservation.reservation_micro_usd)
    AND EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox
      WHERE outbox.run_id=run.id AND outbox.status='completed');
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;

CREATE FUNCTION signal_semantic_context_automatic_evidence_current_v1(target_element_id uuid)
RETURNS boolean LANGUAGE sql STABLE STRICT AS $$
  SELECT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
    WHERE element.id=target_element_id AND EXISTS(SELECT 1 FROM analysis_evidence_links present
      WHERE present.evidence_group_id=element.evidence_group_id)
    AND NOT EXISTS(SELECT 1 FROM analysis_evidence_links link
      JOIN signal_semantic_context_generations generation ON generation.id=element.generation_id
      JOIN signal_workspaces workspace ON workspace.id=element.workspace_id
      WHERE link.evidence_group_id=element.evidence_group_id AND NOT CASE link.source_type
        WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
          WHERE source.id=link.source_id AND source.id=generation.brand_os_profile_id)
        WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation.brand_os_profile_id)
        WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation.brand_os_profile_id)
        WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
          JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
          WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation.brand_os_profile_id)
        WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
          WHERE source.id=link.source_id AND source.organization_id=workspace.organization_id
            AND source.brand_id=workspace.brand_id AND source.study_corpus_id IS NULL
            AND source.status IN ('processed','profiled','active'))
        WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace.organization_id
            AND knowledge.brand_id=workspace.brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace.organization_id
            AND knowledge.brand_id=workspace.brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        ELSE false END));
$$;

CREATE FUNCTION signal_semantic_context_automatic_base_reasons_v1(target_element_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE reasons text[]:='{}';DECLARE ref_count integer;
DECLARE expected_authority jsonb;DECLARE parent_result jsonb;DECLARE collision_count integer;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=element.generation_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=element.operation_id;
  IF element.id IS NULL OR generation.id IS NULL OR NOT signal_semantic_context_automatic_operation_run_valid_v1(operation.id)
     OR element.element_key !~ '^[a-z0-9]+([._:-][a-z0-9]+)*$'
     OR element.canonical_key !~ '^[a-z0-9]+([._:-][a-z0-9]+)*$'
     OR length(btrim(element.display_text))<1 OR length(element.display_text)>500
     OR element.scope IS NOT NULL AND element.scope NOT IN ('primary_brand','category','competitor','reference')
     OR element.entity_type IS NOT NULL AND element.entity_type NOT IN ('brand','competitor','product','category')
     OR element.locale IS NOT NULL AND element.locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
     OR element.confidence IS NOT NULL AND (element.confidence<0 OR element.confidence>1)
     OR (element.element_kind='typed_relation')<>(element.relation_kind IS NOT NULL AND element.relation_target_key IS NOT NULL)
     OR element.relation_kind IS NOT NULL AND element.relation_kind NOT IN ('is_a','part_of','surface_of','competes_with','associated_with')
     THEN RETURN '["__invalid_schema_or_authority__"]'::jsonb; END IF;
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest);
  parent_result:=signal_semantic_context_parent_applicability_v1(generation.id,expected_authority);
  IF parent_result->>'valid'<>'true' THEN RETURN '["__invalid_parent_authority__"]'::jsonb; END IF;
  SELECT count(*) INTO ref_count FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id;
  IF ref_count=0 THEN reasons:=array_append(reasons,'evidence_missing'); END IF;
  IF ref_count>0 AND NOT signal_semantic_context_automatic_evidence_current_v1(element.id)
    THEN reasons:=array_append(reasons,'evidence_invalid'); END IF;
  IF ref_count>50 OR EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id
      AND (link.source_type NOT IN ('brand_os_profile','brand_os_product','brand_os_competitor','brand_os_seed_term',
        'knowledge_source','knowledge_chunk','knowledge_assertion')
        OR link.relation_type NOT IN ('supports','limits','contradicts'))) THEN reasons:=array_append(reasons,'evidence_invalid'); END IF;
  IF EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id
      AND link.relation_type='limits') THEN reasons:=array_append(reasons,'evidence_limited'); END IF;
  IF EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id
      AND link.relation_type='contradicts') THEN reasons:=array_append(reasons,'evidence_contradictory'); END IF;
  SELECT count(DISTINCT candidate.element_key) INTO collision_count
    FROM signal_semantic_context_element_versions candidate
    WHERE candidate.generation_id=element.generation_id AND candidate.element_kind=element.element_kind
      AND candidate.canonical_key=element.canonical_key AND candidate.locale IS NOT DISTINCT FROM element.locale
      AND ((candidate.operation_id=element.operation_id AND candidate.element_version=1)
        OR (candidate.operation_id<>element.operation_id
          AND COALESCE(to_jsonb(candidate)->>'lifecycle_state','active')='active'
          AND candidate.disposition NOT IN ('rejected','merged','archived')
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
            WHERE child.supersedes_element_id=candidate.id)));
  IF collision_count>1 THEN reasons:=array_append(reasons,'semantic_collision'); END IF;
  IF element.element_kind='locale_variant' AND element.locale IS NULL THEN reasons:=array_append(reasons,'locale_required');
  ELSIF element.element_kind='locale_variant' AND NOT element.locale=ANY(generation.locale_variants)
    THEN reasons:=array_append(reasons,'locale_not_in_parent_envelope');
  ELSIF element.element_kind<>'locale_variant' AND element.locale IS NOT NULL
    THEN reasons:=array_append(reasons,'locale_specific_requires_operator_review'); END IF;
  RETURN COALESCE((SELECT jsonb_agg(value ORDER BY convert_to(value,'UTF8'))
    FROM (SELECT DISTINCT value FROM unnest(reasons) item(value)) unique_reason),'[]'::jsonb);
END; $$;

CREATE FUNCTION signal_semantic_context_automatic_relation_resolves_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;DECLARE target signal_semantic_context_element_versions%ROWTYPE;
DECLARE target_key text;DECLARE seen text[]:='{}';DECLARE step integer:=0;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  IF element.element_kind<>'typed_relation' THEN RETURN true; END IF;
  target_key:=element.relation_target_key;seen:=array_append(seen,element.element_key);
  LOOP
    step:=step+1;IF step>250 OR target_key IS NULL OR target_key=ANY(seen) THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM signal_semantic_context_element_versions current_leaf
      WHERE current_leaf.generation_id=element.generation_id AND current_leaf.element_key=target_key
        AND current_leaf.operation_id<>element.operation_id AND current_leaf.disposition='approved'
        AND COALESCE(to_jsonb(current_leaf)->>'lifecycle_state','active')='active'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=current_leaf.id)) THEN RETURN true; END IF;
    SELECT * INTO target FROM signal_semantic_context_element_versions candidate
      WHERE candidate.operation_id=element.operation_id AND candidate.element_version=1
        AND candidate.element_key=target_key LIMIT 1;
    IF target.id IS NULL OR signal_semantic_context_automatic_base_reasons_v1(target.id)<>'[]'::jsonb THEN RETURN false; END IF;
    IF target.element_kind<>'typed_relation' THEN RETURN true; END IF;
    seen:=array_append(seen,target.element_key);target_key:=target.relation_target_key;target:=NULL;
  END LOOP;
END; $$;

CREATE FUNCTION signal_semantic_context_automatic_policy_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE parent_result jsonb;DECLARE expected_authority jsonb;DECLARE expected_applicability jsonb;DECLARE expected_basis jsonb;
DECLARE expected_input_digest text;DECLARE expected_element_digest text;DECLARE refs jsonb;DECLARE predecessor_refs jsonb;
DECLARE reasons jsonb;DECLARE expected_reasons jsonb;DECLARE outcome_entry jsonb;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO predecessor FROM signal_semantic_context_element_versions WHERE id=element.supersedes_element_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=element.generation_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=element.operation_id;
  IF element.id IS NULL OR generation.id IS NULL OR operation.id IS NULL
     OR NOT signal_semantic_context_automatic_operation_run_valid_v1(operation.id)
     OR operation.workspace_id<>element.workspace_id OR operation.actor_user_id<>element.proposed_by_user_id
     OR element.automatic_policy_contract_version<>'signal-semantic-context-automatic-disposition-v1'
     OR element.automatic_policy_outcome NOT IN ('ready','exception')
     OR jsonb_typeof(element.automatic_policy_basis)<>'object'
     OR element.automatic_policy_basis-ARRAY['contract_version','policy_version','system_authority','actor','decided_at',
       'outcome','reasons','transition','evidence_digest','parent_authority_digest','applicability']<>'{}'::jsonb
     OR NOT element.automatic_policy_basis ?& ARRAY['contract_version','policy_version','system_authority','actor',
       'decided_at','outcome','reasons','transition','evidence_digest','parent_authority_digest','applicability']
     OR element.automatic_policy_basis->>'contract_version'<>'signal-semantic-context-automatic-audit-v1'
     OR element.automatic_policy_basis->>'policy_version'<>element.automatic_policy_contract_version
     OR element.automatic_policy_basis->>'system_authority'<>'server_owned_deterministic_policy'
     OR element.automatic_policy_basis->'actor'<>jsonb_build_object('authority','authenticated_operation_actor',
       'id',lower(operation.actor_user_id::text))
     OR element.automatic_policy_basis->>'decided_at'<>to_char(element.automatic_policy_decided_at AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     OR element.automatic_policy_basis->>'outcome'<>element.automatic_policy_outcome
     OR jsonb_typeof(element.automatic_policy_basis->'reasons')<>'array'
     OR jsonb_typeof(element.automatic_policy_basis->'transition')<>'object'
     OR jsonb_typeof(element.automatic_policy_basis->'applicability')<>'object'
     OR element.automatic_policy_basis_digest<>signal_semantic_context_digest_json_v2(element.automatic_policy_basis)
     OR element.automatic_policy_basis->>'evidence_digest'<>element.source_refs_digest THEN RETURN false; END IF;
  expected_reasons:=signal_semantic_context_automatic_base_reasons_v1(COALESCE(predecessor.id,element.id));
  IF element.element_kind='typed_relation' AND NOT signal_semantic_context_automatic_relation_resolves_v1(
      COALESCE(predecessor.id,element.id)) THEN expected_reasons:=expected_reasons||'["relation_target_unresolved"]'::jsonb; END IF;
  expected_reasons:=COALESCE((SELECT jsonb_agg(reason ORDER BY convert_to(reason,'UTF8'))
    FROM (SELECT DISTINCT value reason FROM jsonb_array_elements_text(expected_reasons) item(value)) canonical),
    '[]'::jsonb);
  IF expected_reasons ? '__invalid_schema_or_authority__' OR expected_reasons ? '__invalid_parent_authority__' THEN RETURN false; END IF;
  SELECT value INTO outcome_entry FROM jsonb_array_elements(operation.semantic_context_decision_input->'outcomes') item(value)
    WHERE value->>'element_key'=element.element_key;
  reasons:=element.automatic_policy_basis->'reasons';
  IF outcome_entry IS NULL OR outcome_entry-ARRAY['element_key','outcome','reasons','decision_digest']<>'{}'::jsonb
     OR outcome_entry->>'outcome'<>element.automatic_policy_outcome OR outcome_entry->'reasons'<>reasons
     OR reasons<>expected_reasons OR element.automatic_policy_outcome<>(
       CASE WHEN jsonb_array_length(expected_reasons)=0 THEN 'ready' ELSE 'exception' END)
     OR element.automatic_policy_input_digest<>outcome_entry->>'decision_digest'
     OR outcome_entry->>'decision_digest'<>signal_semantic_context_digest_json_v2(jsonb_build_object(
       'contract_version','signal-semantic-context-automatic-disposition-v1',
       'generation_key',generation.generation_key,'element_key',element.element_key,
       'outcome',element.automatic_policy_outcome,'reasons',reasons,
       'applicability',element.automatic_policy_basis->'applicability',
       'evidence_digest',element.source_refs_digest,
       'parent_authority_digest',operation.semantic_context_decision_input->>'parent_authority_digest'))
     THEN RETURN false; END IF;
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest);
  parent_result:=signal_semantic_context_parent_applicability_v1(generation.id,expected_authority);
  IF parent_result->>'valid'<>'true' OR element.automatic_policy_basis->>'parent_authority_digest'
      IS DISTINCT FROM parent_result->>'parent_authority_digest' THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_type',link.source_type,'source_id',lower(link.source_id::text),
      'relation_type',link.relation_type) ORDER BY convert_to(link.source_type,'UTF8'),link.source_id,
      convert_to(link.relation_type,'UTF8')),'[]'::jsonb) INTO refs
    FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id;
  IF element.source_refs_digest<>signal_semantic_context_digest_json_v2(refs) THEN RETURN false; END IF;
  expected_applicability:=CASE WHEN element.element_kind='locale_variant' AND element.locale=ANY(generation.locale_variants)
    THEN jsonb_build_object('state','explicit_locale','locale',element.locale,'locales',jsonb_build_array(element.locale),
      'markets',to_jsonb(generation.markets))
    WHEN element.element_kind='locale_variant' OR element.locale IS NOT NULL
    THEN jsonb_build_object('state','unresolved','locale',element.locale,'locales','[]'::jsonb,'markets',to_jsonb(generation.markets))
    ELSE jsonb_build_object('state','workspace_inherited','locale',NULL,'locales',to_jsonb(generation.locale_variants),
      'markets',to_jsonb(generation.markets)) END;
  IF element.automatic_policy_basis->'applicability'<>expected_applicability THEN RETURN false; END IF;
  expected_basis:=jsonb_build_object('contract_version','signal-semantic-context-automatic-audit-v1',
    'policy_version',element.automatic_policy_contract_version,'system_authority','server_owned_deterministic_policy',
    'actor',jsonb_build_object('authority','authenticated_operation_actor','id',lower(operation.actor_user_id::text)),
    'decided_at',to_char(element.automatic_policy_decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'outcome',element.automatic_policy_outcome,'reasons',reasons,
    'transition',CASE WHEN element.automatic_policy_outcome='ready' THEN jsonb_build_object(
      'before',jsonb_build_object('element_version',1,'disposition','pending'),
      'after',jsonb_build_object('element_version',2,'disposition','approved')) ELSE jsonb_build_object(
      'before',NULL,'after',jsonb_build_object('element_version',1,'disposition','pending')) END,
    'evidence_digest',element.source_refs_digest,'parent_authority_digest',parent_result->>'parent_authority_digest',
    'applicability',expected_applicability);
  IF element.automatic_policy_basis<>expected_basis THEN RETURN false; END IF;
  IF element.automatic_policy_outcome='exception' THEN
    RETURN element.origin_kind='provider_proposal' AND element.element_version=1 AND element.disposition='pending'
      AND element.supersedes_element_id IS NULL AND element.original_proposal_element_id IS NULL
      AND jsonb_array_length(reasons)>0 AND element.automatic_policy_prestate_digest=element.element_digest
      AND element.automatic_policy_poststate_digest=element.element_digest;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_type',link.source_type,'source_id',lower(link.source_id::text),
      'relation_type',link.relation_type) ORDER BY convert_to(link.source_type,'UTF8'),link.source_id,
      convert_to(link.relation_type,'UTF8')),'[]'::jsonb) INTO predecessor_refs
    FROM analysis_evidence_links link WHERE link.evidence_group_id=predecessor.evidence_group_id;
  RETURN predecessor.id IS NOT NULL AND predecessor.origin_kind='provider_proposal'
    AND predecessor.disposition='pending' AND predecessor.element_version=1
    AND element.origin_kind='server_projection' AND element.disposition='approved' AND element.element_version=2
    AND element.original_proposal_element_id=predecessor.id AND element.decided_by_user_id=operation.actor_user_id
    AND element.decided_at=element.automatic_policy_decided_at AND predecessor_refs=refs
    AND ROW(element.element_key,element.element_kind,element.canonical_key,element.display_text,element.scope,
      element.entity_type,element.entity_id,element.locale,element.relation_kind,element.relation_target_key,
      element.confidence,element.source_refs_digest) IS NOT DISTINCT FROM ROW(predecessor.element_key,
      predecessor.element_kind,predecessor.canonical_key,predecessor.display_text,predecessor.scope,
      predecessor.entity_type,predecessor.entity_id,predecessor.locale,predecessor.relation_kind,
      predecessor.relation_target_key,predecessor.confidence,predecessor.source_refs_digest)
    AND element.automatic_policy_prestate_digest=predecessor.element_digest
    AND element.automatic_policy_poststate_digest=element.element_digest;
END; $$;

CREATE FUNCTION validate_signal_semantic_context_automatic_policy_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.automatic_policy_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NOT signal_semantic_context_automatic_policy_valid_v1(NEW.id) THEN
    RAISE EXCEPTION 'Semantic context automatic policy authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- The complete row and evidence are visible only after INSERT, so validation is deferred.
CREATE FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_operation_id uuid;DECLARE invalid_count integer;DECLARE ready_count integer;DECLARE exception_count integer;
DECLARE input_keys jsonb;DECLARE row_keys jsonb;DECLARE outcome_keys jsonb;DECLARE appended_events integer;DECLARE ready_events integer;
DECLARE appended_event_keys jsonb;DECLARE ready_event_keys jsonb;DECLARE ready_row_keys jsonb;
DECLARE input jsonb;DECLARE computed_policy_digest text;
BEGIN
  target_operation_id:=COALESCE(NEW.operation_id,OLD.operation_id);
  IF NOT EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.id=target_operation_id AND operation.action='append-semantic-context-proposals') THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.id=target_operation_id
        AND operation.semantic_context_decision_input->>'contract_version'=
          'signal-semantic-context-automatic-run-operation-v2')
     AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
       WHERE element.operation_id=target_operation_id AND element.automatic_policy_contract_version IS NOT NULL)
     THEN RETURN NULL; END IF;
  IF NOT signal_semantic_context_automatic_operation_run_valid_v1(target_operation_id) THEN
    RAISE EXCEPTION 'Semantic context automatic policy is not bound to one settled run.' USING ERRCODE='23514'; END IF;
  SELECT count(*) FILTER(WHERE element.automatic_policy_outcome='ready'),
    count(*) FILTER(WHERE element.automatic_policy_outcome='exception'),
    count(*) FILTER(WHERE element.automatic_policy_contract_version IS NOT NULL
      AND NOT signal_semantic_context_automatic_policy_valid_v1(element.id))
    INTO ready_count,exception_count,invalid_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id;
  SELECT operation.semantic_context_decision_input->'proposal_keys' INTO input_keys
    FROM signal_governance_control_operations operation WHERE operation.id=target_operation_id;
  SELECT operation.semantic_context_decision_input INTO input
    FROM signal_governance_control_operations operation WHERE operation.id=target_operation_id;
  computed_policy_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-automatic-disposition-v1',
    'generation_key',input->>'generation_key','parent_authority_digest',input->>'parent_authority_digest',
    'decisions',(SELECT jsonb_agg(jsonb_build_object('element_key',value->>'element_key',
      'decision_digest',value->>'decision_digest') ORDER BY convert_to(value->>'element_key','UTF8'))
      FROM jsonb_array_elements(input->'outcomes') item(value))));
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8')),'[]'::jsonb)
    INTO row_keys FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id AND element.element_version=1;
  SELECT COALESCE(jsonb_agg(value->>'element_key' ORDER BY convert_to(value->>'element_key','UTF8')),'[]'::jsonb)
    INTO outcome_keys FROM jsonb_array_elements((SELECT semantic_context_decision_input->'outcomes'
      FROM signal_governance_control_operations WHERE id=target_operation_id)) item(value);
  SELECT count(*) FILTER(WHERE event_kind='proposals_appended'),count(*) FILTER(WHERE event_kind='automatic_policy_ready')
    INTO appended_events,ready_events FROM signal_semantic_context_events event
    WHERE event.operation_id=target_operation_id;
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8'))
      FILTER(WHERE event.event_kind='proposals_appended'),'[]'::jsonb),
    COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8'))
      FILTER(WHERE event.event_kind='automatic_policy_ready'),'[]'::jsonb)
    INTO appended_event_keys,ready_event_keys
    FROM signal_semantic_context_events event
    LEFT JOIN signal_semantic_context_element_versions element ON element.id=event.element_id
    WHERE event.operation_id=target_operation_id;
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8')),'[]'::jsonb)
    INTO ready_row_keys FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id AND element.automatic_policy_outcome='ready';
  IF invalid_count<>0 OR input->>'policy_digest'<>computed_policy_digest
     OR input_keys<>row_keys OR input_keys<>outcome_keys
     OR jsonb_array_length(input_keys)<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input_keys) item(value))
     OR ready_count+exception_count<>jsonb_array_length(input_keys)
     OR ready_count<>(SELECT automatic_ready_count FROM signal_semantic_context_proposal_runs
       WHERE appended_operation_id=target_operation_id)
     OR exception_count<>(SELECT automatic_exception_count FROM signal_semantic_context_proposal_runs
       WHERE appended_operation_id=target_operation_id)
     OR appended_events<>jsonb_array_length(input_keys) OR ready_events<>ready_count
     OR appended_event_keys<>input_keys OR ready_event_keys<>ready_row_keys OR EXISTS(
      SELECT 1 FROM signal_semantic_context_events event
      LEFT JOIN signal_semantic_context_element_versions element ON element.id=event.element_id
      WHERE event.operation_id=target_operation_id AND (event.element_id IS NULL
        OR event.workspace_id<>element.workspace_id OR event.generation_id<>element.generation_id
        OR event.event_kind NOT IN ('proposals_appended','automatic_policy_ready')
        OR event.event_kind='proposals_appended' AND (element.element_version<>1
          OR event.previous_state_digest IS NOT NULL OR event.next_state_digest<>element.element_digest)
        OR event.event_kind='automatic_policy_ready' AND (element.automatic_policy_outcome<>'ready'
          OR event.previous_state_digest<>element.automatic_policy_prestate_digest
          OR event.next_state_digest<>element.automatic_policy_poststate_digest))) THEN
    RAISE EXCEPTION 'Semantic context automatic policy cohort is incomplete or invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_automatic_element_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_element_versions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_automatic_event_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'generation_created' THEN 'create-semantic-context-draft'
    WHEN 'generation_reconciled' THEN 'reconcile-semantic-context-generation'
    WHEN 'proposals_appended' THEN 'append-semantic-context-proposals'
    WHEN 'automatic_policy_ready' THEN 'append-semantic-context-proposals'
    WHEN 'element_approved' THEN 'decide-semantic-context-element'
    WHEN 'element_rejected' THEN 'decide-semantic-context-element'
    WHEN 'element_corrected' THEN CASE WHEN operation.action='correct-semantic-context-element'
      THEN 'correct-semantic-context-element' ELSE 'decide-semantic-context-element' END
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'elements_merged' THEN 'merge-semantic-context-elements'
    WHEN 'review_annotation_created' THEN 'annotate-semantic-context-element'
    WHEN 'review_annotation_updated' THEN CASE WHEN operation.action IN (
      'merge-semantic-context-elements','correct-semantic-context-element') THEN operation.action
      ELSE 'annotate-semantic-context-element' END
    WHEN 'review_annotation_resolved' THEN CASE WHEN operation.action IN ('merge-semantic-context-elements',
      'correct-semantic-context-element','resolve-semantic-context-annotation',
      'repair-semantic-context-annotation-resolution') THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'locale_authority_decided' THEN 'decide-semantic-context-locale-authority'
    WHEN 'ordinary_element_save' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_undo' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_archive' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_restore' THEN 'edit-semantic-context-element-v1'
    WHEN 'operator_element_created' THEN 'create-semantic-context-element-v1'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;RETURN NEW;
END; $$;

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0105;
CREATE FUNCTION signal_semantic_context_publication_snapshot_v2(p_generation_id uuid,current_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;valid_ready integer;exceptions integer;missing integer;counts jsonb;blockers text[];preflight jsonb;
BEGIN
  base:=signal_semantic_context_publication_snapshot_pre_0105(p_generation_id,current_authority);
  SELECT count(*) FILTER(WHERE element.disposition='approved'
      AND signal_semantic_context_automatic_policy_valid_v1(element.id)
      AND (element.decision_contract_version IS NULL OR element.decision_reason_code IS NULL
        OR element.decision_rationale IS NULL OR element.decision_basis_digest IS NULL)),
    count(*) FILTER(WHERE element.disposition='pending' AND element.automatic_policy_outcome='exception'
      AND signal_semantic_context_automatic_policy_valid_v1(element.id))
    INTO valid_ready,exceptions FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=p_generation_id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id);
  missing:=greatest(COALESCE((base->'counts'->>'decision_basis_missing')::int,0)-valid_ready,0);
  counts:=(base->'counts')||jsonb_build_object('decision_basis_missing',missing,
    'automatic_ready',valid_ready,'automatic_exceptions',exceptions);
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value) WHERE value<>'decision_basis_missing';
  IF missing>0 THEN blockers:=array_append(blockers,'decision_basis_missing'); END IF;
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers FROM unnest(blockers) item(value);
  preflight:=(base->'preflight')||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,
    'automatic_policy_contract_version','signal-semantic-context-automatic-disposition-v1');
  RETURN base||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,'preflight',preflight,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight));
END; $$;

COMMENT ON FUNCTION signal_semantic_context_automatic_policy_valid_v1(uuid) IS
  'Fail-closed validation for deterministic automatic ready successors and explicit pending exceptions.';
COMMENT ON COLUMN signal_semantic_context_element_versions.automatic_policy_basis IS
  'Server-authored policy/actor/time/transition/evidence/applicability audit basis; provider prose is excluded.';
COMMENT ON COLUMN signal_semantic_context_proposal_runs.automatic_ready_count IS
  'Count accepted by the sealed deterministic policy; each row remains reversible append-only authority.';
COMMENT ON COLUMN signal_semantic_context_proposal_runs.automatic_exception_count IS
  'Count left pending because at least one closed automatic-policy invariant failed.';
