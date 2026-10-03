-- A client administrator may create only a one-interest Sonnet decision
-- generation with the exact registered model and effective policy. The
-- historical internal classification actor remains unchanged.
CREATE FUNCTION signal_defined_interest_generation_actor_v1(target_workspace uuid,
 target_actor uuid,target_profile uuid,snapshot jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(signal_processing_actor_v1(target_workspace,target_actor)
  AND jsonb_typeof(snapshot->'topics')='array'
  AND CASE WHEN jsonb_typeof(snapshot->'topics')='array'
   THEN jsonb_array_length(snapshot->'topics')=1 ELSE false END
  AND snapshot->'source_projection' IS NULL
  AND snapshot->>'interest_term_key'=snapshot->'topics'->0->'definition'->>'term_key'
  AND COALESCE((snapshot->'topics'->0->'definition'->>'discovery_guidance')::boolean,
   snapshot->'topics'->0->'definition'->>'origin'<>'workspace_discovery')
  AND snapshot->'identity'->>'engine_key'='interest_decision'
  AND snapshot->'identity'->>'engine_version'='1'
  AND snapshot->'identity'->>'engine_artifact_digest'=signal_interest_decision_model_digest_v1()
  AND snapshot->'identity'->>'workspace_id'=target_workspace::text
  AND EXISTS(SELECT 1 FROM tagging_model_versions model
   JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
    ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
   JOIN signal_classification_approval_policies policy
    ON policy.model_version_id=model.id AND policy.workspace_id=target_workspace
     AND policy.taxonomy_profile_id=target_profile
   WHERE model.registry_contract_version='signal-tagging-model-registry-v1'
    AND model.provider='anthropic' AND model.taxonomy_profile_id=target_profile
    AND model.artifact_digest=signal_interest_decision_model_digest_v1()
    AND model.configuration->'provider_config'=signal_interest_decision_provider_config_v1()
    AND model.configuration->'workspace_classification_identity'=snapshot->'identity'
    AND model.configuration_digest=signal_semantic_context_digest_json_v2(model.configuration)
    AND model.dataset_digest=benchmark.dataset_digest
    AND model.gold_set_digest=benchmark.labels_digest
    AND benchmark.model_artifact_digest=model.artifact_digest
    AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1())
    AND benchmark.prompt_digest=signal_interest_decision_provider_config_v1()->>'prompt_digest'
    AND benchmark.approved_at<=clock_timestamp()
    AND policy.authority_kind='model' AND policy.status='approved'
    AND policy.definition_hash=snapshot->'identity'->>'decision_policy_digest'
    AND policy.effective_from<=clock_timestamp()
    AND (policy.effective_to IS NULL OR policy.effective_to>clock_timestamp())
    AND (SELECT event.status FROM signal_tagging_model_version_events event
     WHERE event.workspace_id=target_workspace AND event.model_version_id=model.id
      AND event.effective_at<=clock_timestamp()
     ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'),false)
$$;

CREATE OR REPLACE FUNCTION guard_workspace_classification_generation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-classification-v1' THEN RAISE EXCEPTION 'workspace_classification_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['status','finalized_digest','finalized_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['status','finalized_digest','finalized_at']) THEN
  RAISE EXCEPTION 'workspace_classification_input_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.input_contract<>'workspace-topic-classification-v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE id=NEW.embedding_run_id AND workspace_id=NEW.workspace_id AND input_contract='corpus';
  IF embedded.id IS NULL OR embedded.status<>'completed' OR embedded.preparation_run_id<>NEW.preparation_run_id
   OR embedded.input_revision<>NEW.input_revision OR NEW.denominator<>(embedded.counts->>'eligible_roots')::bigint
   OR (embedded.counts->>'completed_roots')::bigint<>NEW.denominator
   OR embedded.config_digest IS DISTINCT FROM NEW.input_snapshot->'identity'->>'embedding_config_digest'
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-classification-v1'
    AND NEW.input_snapshot->'identity'->>'contract_version'='signal-workspace-classification-v1'
    AND NEW.input_snapshot->'identity'->>'workspace_id'=NEW.workspace_id::text
    AND NEW.input_snapshot->'identity'->>'catalog_digest'=NEW.identity_catalog_digest
    AND jsonb_typeof(NEW.input_snapshot->'topics')='array',false)
   OR NOT (signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
    OR signal_defined_interest_generation_actor_v1(NEW.workspace_id,NEW.created_by_user_id,
     NEW.taxonomy_profile_id,NEW.input_snapshot))
   OR NOT EXISTS(SELECT 1 FROM signal_classification_operations op WHERE op.id=NEW.operation_id AND op.workspace_id=NEW.workspace_id
    AND op.actor_user_id=NEW.created_by_user_id AND op.operation_kind='create-generation' AND op.status='in_progress')
   OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=NEW.workspace_id AND state.input_revision=NEW.input_revision)
   OR NEW.policy_valid_until IS DISTINCT FROM embedded.policy_valid_until
   OR (NEW.policy_valid_until IS NOT NULL AND NEW.policy_valid_until<=clock_timestamp())
   OR (NEW.source_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_classification_generations prior
    WHERE prior.id=NEW.source_generation_id AND prior.workspace_id=NEW.workspace_id AND prior.input_contract=NEW.input_contract
    AND prior.status='ready' AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=prior.id AND item.resolution_state='error'))) THEN
   RAISE EXCEPTION 'workspace_classification_input_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION signal_defined_interest_generation_actor_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_defined_interest_generation_actor_v1(uuid,uuid,uuid,jsonb) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
