-- A saved explicit interest lives in a draft taxonomy profile. Permit only the
-- V2 decision model for that exact interest to pass the legacy active-profile
-- registry and policy guards. This does not activate or publish the profile.
CREATE FUNCTION signal_interest_decision_draft_model_authorized_v2(
 target_model tagging_model_versions,target_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1
 FROM signal_taxonomy_profiles profile
 JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
 JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
  ON benchmark.id::text=target_model.configuration->>'platform_benchmark_id'
 WHERE profile.id=target_model.taxonomy_profile_id
  AND profile.workspace_id=target_workspace AND profile.kind='topic' AND profile.status='draft'
  AND term.term_key=target_model.configuration->>'interest_term_key'
  AND term.status IN('candidate','active')
  AND term.metadata->'topic'->>'origin' IS DISTINCT FROM 'workspace_discovery'
  AND COALESCE((term.metadata->'topic'->>'discovery_guidance')::boolean,true)
  AND target_model.registry_contract_version='signal-tagging-model-registry-v1'
  AND target_model.model_key~'^interest_decision:[a-f0-9]{64}$'
  AND target_model.version='1' AND target_model.provider='anthropic'
  AND target_model.runtime_kind='provider_api' AND target_model.artifact_format='message_batches'
  AND target_model.supersedes_model_version_id IS NULL
  AND target_model.artifact_digest=signal_interest_decision_model_digest_v2()
  AND target_model.configuration_digest=signal_semantic_context_digest_json_v2(target_model.configuration)
  AND target_model.configuration->'provider_config'=signal_interest_decision_provider_config_v2()
  AND jsonb_typeof(target_model.configuration->'workspace_classification_identity')='object'
  AND target_model.configuration->'workspace_classification_identity'->>'contract_version'='signal-workspace-classification-v1'
  AND target_model.configuration->'workspace_classification_identity'->>'workspace_id'=target_workspace::text
  AND target_model.configuration->'workspace_classification_identity'->>'engine_key'='interest_decision'
  AND target_model.configuration->'workspace_classification_identity'->'engine_version'='2'::jsonb
  AND target_model.configuration->'workspace_classification_identity'->>'engine_artifact_digest'=target_model.artifact_digest
  AND target_model.configuration->'workspace_classification_identity'->>'decision_policy_digest'=benchmark.thresholds_digest
  AND benchmark.model_artifact_digest=target_model.artifact_digest
  AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
  AND benchmark.prompt_digest=signal_interest_decision_provider_config_v2()->>'prompt_digest'
  AND benchmark.dataset_digest=target_model.dataset_digest
  AND benchmark.labels_digest=target_model.gold_set_digest
  AND benchmark.approved_at<=clock_timestamp()
  AND target_model.model_key='interest_decision:'||substr(signal_semantic_context_digest_json_v2(jsonb_build_object(
    'workspace_id',target_workspace,'taxonomy_profile_id',profile.id,
    'interest_term_key',term.term_key,
    'identity_digest',signal_semantic_context_digest_json_v2(target_model.configuration->'workspace_classification_identity'),
    'benchmark_id',benchmark.id)),8)
 ),false)
$$;

REVOKE ALL ON FUNCTION signal_interest_decision_draft_model_authorized_v2(tagging_model_versions,uuid) FROM PUBLIC;

-- Preserve every legacy branch; only the V2 draft-model exception changes.
CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-incremental-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN analysis_artifacts bank ON bank.id::text=NEW.configuration->>'model_artifact_id' AND bank.workspace_id=engine.workspace_id AND bank.engine_execution_id=engine.id
    JOIN analysis_artifacts binding ON binding.id::text=NEW.configuration->>'binding_artifact_id' AND binding.workspace_id=engine.workspace_id AND binding.engine_execution_id=engine.id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.status='ready' AND engine.input_snapshot ? 'numeric_descriptor'
     AND bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
     AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
     AND binding.metadata->>'catalog_profile_id'=NEW.taxonomy_profile_id::text
     AND binding.metadata->>'binding_digest'=NEW.configuration->>'binding_digest'
     AND binding.metadata->>'numeric_checkpoint_digest'=NEW.configuration->>'numeric_checkpoint_digest'
     AND NEW.configuration->'workspace_classification_identity'=binding.metadata->'identity'
     AND NEW.artifact_digest=bank.content->>'sha256' AND NEW.configuration->>'approval_policy'='none'
     AND NEW.registered_by_user_id=engine.actor_user_id AND signal_workspace_incremental_binding_scope_v1(binding)
     AND NEW.runtime_kind='python' AND NEW.artifact_format='workspace-incremental-model-bank-v1'
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_incremental_projection_registry_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active','retired')
    JOIN analysis_artifacts model ON model.id::text=NEW.configuration->>'model_artifact_id' AND model.engine_execution_id=engine.id AND model.workspace_id=engine.workspace_id
    JOIN analysis_artifacts materialization ON materialization.id::text=NEW.configuration->>'materialization_artifact_id'
     AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.input_contract='workspace-topic-engine-v1'
     AND signal_workspace_engine_materialization_source_v1(engine,materialization,profile.id)
     AND engine.result_summary->'fit_checkpoint'->>'model_artifact_id'=model.id::text
     AND model.artifact_type='engine_model' AND model.content->>'sha256'=NEW.artifact_digest
     AND materialization.metadata->>'mapping_digest'=NEW.configuration->>'mapping_digest'
     AND NEW.configuration->'workspace_classification_identity'->>'workspace_id'=engine.workspace_id::text
     AND NEW.configuration->'workspace_classification_identity'->>'engine_artifact_digest'=NEW.artifact_digest
     AND NEW.configuration->>'approval_policy'='none'
     AND signal_workspace_classification_actor_v1(engine.workspace_id,NEW.registered_by_user_id)
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_projection_model_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-engine-v1' AND NOT EXISTS(
    SELECT 1 FROM signal_topic_catalog_executions execution
    JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
    WHERE execution.id::text=NEW.configuration->>'execution_id' AND execution.input_contract='workspace-topic-engine-v1'
     AND execution.status='running' AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id
     AND execution.actor_user_id=NEW.registered_by_user_id
     AND signal_workspace_classification_actor_v1(execution.workspace_id,NEW.registered_by_user_id)
     AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest) THEN
   RAISE EXCEPTION 'Native fitted model authority is invalid.' USING ERRCODE='23514'; END IF;

  SELECT workspace_id INTO target_workspace_id FROM signal_taxonomy_profiles
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status='draft' AND signal_interest_decision_draft_model_authorized_v2(NEW,workspace_id)) OR (status IN('draft','retired')
      AND NEW.configuration->>'contract_version'='workspace-topic-engine-v1'
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
       JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
       WHERE execution.id::text=NEW.configuration->>'execution_id'
        AND execution.input_contract='workspace-topic-engine-v1' AND execution.status='running'
        AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id AND execution.actor_user_id=NEW.registered_by_user_id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest)));
  IF target_workspace_id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,NEW.registered_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.registry_operation_id AND operation.workspace_id=target_workspace_id
         AND operation.operation_kind='register-model' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.registered_by_user_id)
     OR (NEW.supersedes_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions prior
       WHERE prior.id=NEW.supersedes_model_version_id
         AND prior.registry_contract_version='signal-tagging-model-registry-v1'
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.model_key=NEW.model_key AND prior.version<>NEW.version)) THEN
    RAISE EXCEPTION 'Tagging model registry authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_interest_decision_prepublication_evaluation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE m tagging_model_versions%ROWTYPE;b signal_interest_decision_platform_benchmarks_v1%ROWTYPE;
 identity jsonb; expected_request text;
BEGIN
 NEW.created_at:=clock_timestamp();
 SELECT * INTO m FROM tagging_model_versions WHERE id=NEW.model_version_id;
 SELECT * INTO b FROM signal_interest_decision_platform_benchmarks_v1 WHERE id=NEW.benchmark_id;
 identity:=m.configuration->'workspace_classification_identity';
 expected_request:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'workspace_id',NEW.workspace_id,'taxonomy_profile_id',NEW.taxonomy_profile_id,
  'model_version_id',NEW.model_version_id,'benchmark_id',NEW.benchmark_id,
  'actor_user_id',NEW.actor_user_id,'interest_term_key',NEW.interest_term_key,
  'identity_digest',NEW.identity_digest));
 IF m.id IS NULL OR b.id IS NULL OR m.registry_contract_version<>'signal-tagging-model-registry-v1'
  OR m.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
  OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile
   WHERE profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=NEW.workspace_id
    AND (profile.status='active' OR signal_interest_decision_draft_model_authorized_v2(m,NEW.workspace_id)))
  OR m.registered_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR NOT (signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)
   OR signal_processing_actor_v1(NEW.workspace_id,NEW.actor_user_id))
  OR m.provider<>'anthropic' OR m.artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v2()
  OR m.configuration IS DISTINCT FROM jsonb_build_object('provider_config',signal_interest_decision_provider_config_v2(),
   'workspace_classification_identity',identity,'platform_benchmark_id',b.id,
   'interest_term_key',NEW.interest_term_key)
  OR m.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(m.configuration)
  OR jsonb_typeof(identity)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(identity))<>10
  OR NOT (identity ?& ARRAY['contract_version','workspace_id','engine_key','engine_version',
   'engine_artifact_digest','embedding_config_digest','catalog_digest','compiler_digest',
   'context_digest','decision_policy_digest'])
  OR identity->>'contract_version'<>'signal-workspace-classification-v1'
  OR identity->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
  OR identity->>'engine_key'<>'interest_decision' OR identity->'engine_version'<>'2'::jsonb
  OR identity->>'engine_artifact_digest' IS DISTINCT FROM m.artifact_digest
  OR EXISTS(SELECT 1 FROM jsonb_each_text(identity) field
   WHERE field.key IN('embedding_config_digest','catalog_digest','compiler_digest',
    'context_digest','decision_policy_digest') AND field.value!~'^sha256:[a-f0-9]{64}$')
  OR NEW.identity_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(identity)
  OR b.model_artifact_digest IS DISTINCT FROM m.artifact_digest
  OR b.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
  OR b.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR b.dataset_digest IS DISTINCT FROM m.dataset_digest OR b.labels_digest IS DISTINCT FROM m.gold_set_digest
  OR b.approved_at>clock_timestamp()
  OR NEW.evaluation_evidence_digest IS DISTINCT FROM b.evaluation_evidence_digest
  OR NEW.thresholds_digest IS DISTINCT FROM b.thresholds_digest
  OR NEW.request_digest IS DISTINCT FROM expected_request
  OR NEW.receipt_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'contract_version','signal-interest-decision-prepublication-evaluation-v1',
   'request_digest',expected_request,'evaluation_evidence_digest',b.evaluation_evidence_digest,
   'thresholds_digest',b.thresholds_digest))
  OR NOT EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
   WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=m.id AND event.status='draft')
  OR EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
   WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=m.id AND event.status<>'draft')
 THEN RAISE EXCEPTION 'interest_decision_prepublication_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_signal_classification_policy_scope_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid; DECLARE taxonomy_scope text;
BEGIN
  IF TG_TABLE_NAME='signal_labeling_function_versions' THEN
    SELECT term.taxonomy_id,taxonomy.scope INTO term_taxonomy,taxonomy_scope
    FROM taxonomy_terms term JOIN taxonomies taxonomy ON taxonomy.id=term.taxonomy_id
    WHERE term.id=NEW.taxonomy_term_id AND term.status='active' AND taxonomy.status='active';
    IF NEW.owner_kind='workspace' THEN
      SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
       WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND status='active';
      IF profile_taxonomy IS NULL
         OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
         OR (NEW.approved_by_user_id IS NOT NULL
           AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.approved_by_user_id)) THEN
        RAISE EXCEPTION 'Labeling function actor is outside workspace authority.' USING ERRCODE='23514';
      END IF;
    ELSIF taxonomy_scope<>'global'
       OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.created_by_user_id
         AND actor.status='active' AND actor.user_type='noisia_internal')
       OR (NEW.approved_by_user_id IS NOT NULL AND NOT EXISTS(
         SELECT 1 FROM users actor WHERE actor.id=NEW.approved_by_user_id
           AND actor.status='active' AND actor.user_type='noisia_internal')) THEN
      RAISE EXCEPTION 'Platform labeling function authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.owner_kind='workspace' AND term_taxonomy IS DISTINCT FROM profile_taxonomy THEN
      RAISE EXCEPTION 'Labeling function term is incompatible with profile.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
      WHERE operation.id=NEW.operation_id AND operation.operation_kind='register-labeling-function'
        AND operation.status='in_progress' AND operation.actor_user_id=NEW.created_by_user_id
        AND (NEW.workspace_id IS NULL OR operation.workspace_id=NEW.workspace_id)) THEN
      RAISE EXCEPTION 'Labeling function registration operation is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_labeling_function_versions prior
      WHERE prior.id=NEW.supersedes_id AND prior.owner_kind=NEW.owner_kind
        AND prior.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
        AND prior.function_key=NEW.function_key AND NEW.version=prior.version+1) THEN
      RAISE EXCEPTION 'Labeling function supersession is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
      WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id
       AND (status='active' OR (status='draft' AND NEW.authority_kind='model'
        AND EXISTS(SELECT 1 FROM tagging_model_versions draft_model
         WHERE draft_model.id=NEW.model_version_id
          AND signal_interest_decision_draft_model_authorized_v2(draft_model,NEW.workspace_id))));
    IF profile_taxonomy IS NULL THEN
      RAISE EXCEPTION 'Classification profile is outside workspace.' USING ERRCODE='23514';
    END IF;
    IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
     OR (NEW.approved_by_user_id IS NOT NULL
       AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.approved_by_user_id))
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
         AND operation.operation_kind='register-approval-policy' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Classification approval policy authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='signal_classification_approval_policies' THEN
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_classification_approval_policies prior
      WHERE prior.id=NEW.supersedes_id AND prior.workspace_id=NEW.workspace_id
        AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
        AND prior.policy_key=NEW.policy_key AND prior.authority_kind=NEW.authority_kind
        AND NEW.version=prior.version+1) THEN
      RAISE EXCEPTION 'Classification approval policy supersession is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.authority_kind='labeling_function' AND NOT EXISTS(
      SELECT 1 FROM signal_labeling_function_versions lf
      WHERE lf.id=NEW.labeling_function_version_id
        AND lf.status='approved'
        AND (lf.owner_kind='platform' OR lf.workspace_id=NEW.workspace_id)
        AND (lf.taxonomy_profile_id IS NULL OR lf.taxonomy_profile_id=NEW.taxonomy_profile_id)
        AND lf.effective_from<=NEW.created_at
        AND (lf.effective_to IS NULL OR lf.effective_to>NEW.created_at)
    ) THEN
      RAISE EXCEPTION 'Approval policy labeling function is not approved or compatible.' USING ERRCODE='23514';
    ELSIF NEW.authority_kind='model' AND NOT EXISTS(
      SELECT 1 FROM tagging_model_versions model
      WHERE model.id=NEW.model_version_id
        AND model.registry_contract_version='signal-tagging-model-registry-v1'
        AND model.taxonomy_profile_id=NEW.taxonomy_profile_id
        AND (SELECT event.status FROM signal_tagging_model_version_events event
          WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=model.id
            AND event.effective_at<=NEW.created_at
          ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'
    ) THEN
      RAISE EXCEPTION 'Approval policy model is not explicitly approved.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

