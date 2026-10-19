-- Derive settled interpretation checkpoints progressively into the main catalog.
-- The engine and money ledgers retain their states, snapshots and uncertainty.
ALTER TABLE signal_topic_classification_outbox
 ADD COLUMN dispatch_kind text NOT NULL DEFAULT 'execution' CHECK(dispatch_kind IN('execution','engine_progress'));
-- PostgreSQL truncates auto-generated names; match the exact existing key shape.
DO $$ DECLARE key record; removed integer:=0; BEGIN
 FOR key IN SELECT conname FROM pg_constraint WHERE conrelid='signal_topic_classification_outbox'::regclass AND contype='u'
  AND pg_get_constraintdef(oid) IN('UNIQUE (execution_id)','UNIQUE (workspace_id, execution_id)') LOOP
  EXECUTE format('ALTER TABLE signal_topic_classification_outbox DROP CONSTRAINT %I',key.conname);removed:=removed+1;
 END LOOP;
 IF removed<>2 THEN RAISE EXCEPTION 'Progress dispatch prerequisite keys do not match.'; END IF;
END $$;
ALTER TABLE signal_topic_classification_outbox ADD CONSTRAINT signal_topic_classification_outbox_execution_dispatch_key UNIQUE(execution_id,dispatch_kind);
CREATE FUNCTION guard_workspace_engine_progress_dispatch_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.execution_id,NEW.workspace_id,NEW.dispatch_kind) IS DISTINCT FROM ROW(OLD.execution_id,OLD.workspace_id,OLD.dispatch_kind) THEN
  RAISE EXCEPTION 'Dispatch authority is immutable.' USING ERRCODE='23514'; END IF;
 IF NEW.dispatch_kind='engine_progress' AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
  WHERE execution.id=NEW.execution_id AND execution.workspace_id=NEW.workspace_id AND execution.input_contract='workspace-topic-engine-v1'
   AND execution.result_summary ? 'fit_checkpoint' AND execution.input_snapshot ? 'interpretation_config' AND NEW.worker_job_id LIKE 'workspace-progress-%') THEN
  RAISE EXCEPTION 'Progress dispatch requires a fitted engine.' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_engine_progress_dispatch BEFORE INSERT OR UPDATE ON signal_topic_classification_outbox
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_progress_dispatch_v1();

-- A partial receipt is immutable historical evidence. Currentness of user inputs
-- is additionally checked by the native classification/serving identity guards.
CREATE FUNCTION signal_workspace_engine_materialization_source_v1(engine signal_topic_catalog_executions,materialization analysis_artifacts,p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
  AND materialization.artifact_type='engine_proposals'
  AND materialization.metadata->>'output_catalog_profile_id'=p_profile::text
  AND materialization.metadata->>'execution_id'=engine.id::text
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=p_profile AND profile.workspace_id=engine.workspace_id
   AND profile.metadata->>'source_engine_execution_id'=engine.id::text
   AND profile.metadata->>'source_mapping_digest'=materialization.metadata->>'mapping_digest'
   AND profile.metadata->>'source_interpretation_units_digest'=materialization.metadata->>'interpretation_units_digest')
  AND ((materialization.metadata->>'contract_version'='workspace-topic-materialization-v1' AND engine.status='ready'
    AND engine.result_summary->'analysis_checkpoint'->>'materialization_artifact_id'=materialization.id::text
    AND engine.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'=p_profile::text)
   OR (materialization.metadata->>'contract_version'='workspace-topic-materialization-progress-v1'
    AND engine.status IN('running','failed','ready') AND engine.result_summary ? 'fit_checkpoint'
    AND materialization.metadata->>'expected_interpretation_units_digest'=engine.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
    AND (materialization.metadata->>'expected_interpretation_unit_count')::bigint=(engine.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint
    AND (materialization.metadata->>'interpreted_unit_count')::bigint BETWEEN 1 AND (materialization.metadata->>'expected_interpretation_unit_count')::bigint)),false)
$$;


CREATE OR REPLACE FUNCTION guard_workspace_engine_analysis_artifact_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE;
 count_keys bigint; unique_keys bigint; profile signal_taxonomy_profiles%ROWTYPE; topics bigint; coverage record;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=OLD.engine_execution_id;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Analysis checkpoint history is retained.' USING ERRCODE='55000'; END IF;
   IF ROW(NEW.workspace_id,NEW.engine_execution_id,NEW.artifact_key,NEW.artifact_type,NEW.content,NEW.metadata,NEW.discovery_run_digest,NEW.workspace_authority_digest)
     IS DISTINCT FROM ROW(OLD.workspace_id,OLD.engine_execution_id,OLD.artifact_key,OLD.artifact_type,OLD.content,OLD.metadata,OLD.discovery_run_digest,OLD.workspace_authority_digest) THEN
    RAISE EXCEPTION 'Analysis checkpoint evidence is immutable.' USING ERRCODE='55000'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.engine_execution_id IS DISTINCT FROM OLD.engine_execution_id AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions
    WHERE id=NEW.engine_execution_id AND input_snapshot->'interpretation_config' IS NOT NULL) THEN
   RAISE EXCEPTION 'Existing evidence cannot become an analysis checkpoint.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.engine_execution_id IS NULL OR NEW.artifact_type<>'engine_proposals' THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF execution.input_snapshot->'interpretation_config' IS NULL THEN
  IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
   RAISE EXCEPTION 'Progress requires an editorial interpretation contract.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
  SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(execution.id);
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NOT COALESCE(execution.status IN('running','failed','ready') AND execution.result_summary ? 'fit_checkpoint'
    AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
    AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
    AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
    AND profile.id=(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=execution.workspace_id AND kind='topic'
      AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
    AND NEW.artifact_key='materialization-progress-'||profile.id::text||'.json'
    AND NEW.metadata->>'execution_id'=execution.id::text
    AND (NEW.metadata->>'output_catalog_revision')::int=profile.version AND (NEW.metadata->>'topic_count')::bigint=topics
    AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
    AND coverage.unit_count=(NEW.metadata->>'interpreted_unit_count')::bigint
    AND coverage.unit_digest=NEW.metadata->>'interpretation_units_digest'
    AND (NEW.metadata->>'expected_interpretation_unit_count')::bigint=(execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint
    AND NEW.metadata->>'expected_interpretation_units_digest'=execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
    AND coverage.unit_count<=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
    AND (NEW.metadata->>'interpretation_complete')::boolean=(coverage.unit_count=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
      AND coverage.unit_digest=NEW.metadata->>'expected_interpretation_units_digest')
    AND profile.metadata->>'source_engine_execution_id'=execution.id::text
    AND profile.metadata->>'source_interpretation_units_digest'=coverage.unit_digest
    AND profile.metadata->>'source_mapping_digest'=NEW.metadata->>'mapping_digest'
    AND NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR EXISTS(SELECT 1 FROM analysis_artifacts artifact LEFT JOIN engine_cost_events receipt
     ON receipt.id=(artifact.metadata->>'call_id')::uuid AND receipt.catalog_execution_id=execution.id AND receipt.workspace_id=execution.workspace_id
    WHERE artifact.engine_execution_id=execution.id AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
     AND NOT COALESCE(receipt.call_state='settled' AND receipt.actor_user_id=execution.actor_user_id
      AND receipt.response_sha256=artifact.metadata->>'response_sha256'
      AND receipt.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,receipt.metadata->>'interpretation_revision_digest'),false)) THEN
   RAISE EXCEPTION 'Progress materialization evidence is invalid.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp()
  OR execution.result_summary->'fit_checkpoint' IS NULL THEN
  RAISE EXCEPTION 'Analysis proposals require a live fitted execution.' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(NEW.metadata->>'call_id')::uuid
   AND workspace_id=NEW.workspace_id AND catalog_execution_id=execution.id AND workspace_contract='workspace-engine-interpretation-v1';
  IF call.id IS NULL OR call.call_state<>'settled' OR call.response_sha256 IS DISTINCT FROM NEW.metadata->>'response_sha256'
   OR call.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,call.metadata->>'interpretation_revision_digest')
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR NEW.metadata->>'fit_checkpoint_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR jsonb_typeof(NEW.metadata->'unit_keys') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Interpretation checkpoint receipt is invalid.' USING ERRCODE='23514'; END IF;
  SELECT count(*),count(DISTINCT key) INTO count_keys,unique_keys FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key);
  IF count_keys NOT BETWEEN 1 AND 128 OR count_keys<>unique_keys
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key) WHERE key!~'^[A-Za-z0-9:._-]{1,200}$')
   OR EXISTS(SELECT 1 FROM analysis_artifacts prior CROSS JOIN LATERAL jsonb_array_elements_text(prior.metadata->'unit_keys') unit(key)
      WHERE prior.engine_execution_id=execution.id AND prior.artifact_type='engine_proposals'
       AND prior.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' AND NEW.metadata->'unit_keys' ? unit.key) THEN
   RAISE EXCEPTION 'Interpretation units are duplicate or invalid.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.metadata->>'contract_version'='workspace-topic-materialization-v1' THEN
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NEW.artifact_key<>'materialization.json' OR profile.id IS NULL
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR (NEW.metadata->>'output_catalog_revision')::integer IS DISTINCT FROM profile.version
   OR (NEW.metadata->>'topic_count')::bigint IS DISTINCT FROM topics
   OR NEW.metadata->>'interpretation_units_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
   OR profile.metadata->>'source_engine_execution_id' IS DISTINCT FROM execution.id::text
   OR profile.metadata->>'source_interpretation_units_digest' IS DISTINCT FROM NEW.metadata->>'interpretation_units_digest'
   OR profile.metadata->>'source_mapping_digest' IS DISTINCT FROM NEW.metadata->>'mapping_digest'
   OR NOT COALESCE(NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'Analysis catalog materialization is invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Analysis proposal contract is required.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_signal_workspace_engine_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR NOT (execution.status='running' OR execution.status IN('failed','ready') AND NEW.artifact_type='engine_proposals' AND NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1')
  OR NEW.workspace_artifact_kind<>'topic_discovery' OR NEW.discovery_run_digest<>'sha256:'||encode(sha256(convert_to(execution.input_digest||':'||execution.id::text,'UTF8')),'hex')
  OR NEW.review_status<>'draft' OR NEW.artifact_type NOT IN('engine_model','engine_output','engine_proposals')
  OR NOT COALESCE(NEW.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (NEW.content->>'size_bytes')::bigint>=0
    AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||execution.id::text||'/%',false)
  OR pg_column_size(NEW.content)>65536 OR pg_column_size(NEW.metadata)>65536 THEN
  RAISE EXCEPTION 'Engine artifact authority is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_workspace_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN analysis_artifacts output ON output.id::text=generation.input_snapshot->'source_projection'->>'output_artifact_id'
   AND output.engine_execution_id=engine.id AND output.workspace_id=engine.workspace_id AND output.artifact_type='engine_output'
  JOIN analysis_artifacts materialization ON materialization.id::text=generation.input_snapshot->'source_projection'->>'materialization_artifact_id'
   AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
   AND materialization.artifact_type='engine_proposals'
  WHERE engine.id::text=generation.input_snapshot->'source_projection'->>'engine_execution_id'
   AND engine.workspace_id=generation.workspace_id AND engine.input_contract='workspace-topic-engine-v1'
   AND engine.embedding_run_id=generation.embedding_run_id AND engine.preparation_run_id=generation.preparation_run_id
   AND engine.input_revision=generation.input_revision
   AND signal_workspace_engine_materialization_source_v1(engine,materialization,generation.taxonomy_profile_id)
   AND engine.result_summary->'fit_checkpoint'->>'output_artifact_id'=output.id::text
   AND materialization.metadata->>'mapping_digest'=generation.input_snapshot->'source_projection'->>'mapping_digest'
   AND (materialization.metadata->>'contract_version'<>'workspace-topic-materialization-progress-v1' OR
    generation.input_snapshot->'source_projection'->'interpretation_coverage'=jsonb_build_object(
     'interpreted_unit_count',(materialization.metadata->>'interpreted_unit_count')::bigint,
     'expected_unit_count',(materialization.metadata->>'expected_interpretation_unit_count')::bigint,
     'unit_digest',materialization.metadata->>'interpretation_units_digest',
     'expected_unit_digest',materialization.metadata->>'expected_interpretation_units_digest',
     'complete',(materialization.metadata->>'interpretation_complete')::boolean))
   AND generation.input_snapshot->'source_projection'->>'policy_digest' =generation.input_snapshot->'identity'->>'decision_policy_digest'
   AND CASE WHEN generation.input_snapshot->'source_projection'->>'model_artifact_id' IS NULL
    THEN engine.result_summary->'fit_checkpoint'->>'model_artifact_id' IS NULL
     AND generation.input_snapshot->'source_projection'->>'model_version_id' IS NULL
     AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=output.content->>'sha256'
    ELSE EXISTS(SELECT 1 FROM analysis_artifacts model JOIN tagging_model_versions registry
     ON registry.id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
      AND registry.taxonomy_profile_id=generation.taxonomy_profile_id AND registry.artifact_digest=model.content->>'sha256'
      AND registry.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity'
      AND (SELECT event.status FROM signal_tagging_model_version_events event WHERE event.model_version_id=registry.id
       AND event.workspace_id=generation.workspace_id AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1) IN('draft','evaluated','approved')
     WHERE model.id::text=generation.input_snapshot->'source_projection'->>'model_artifact_id'
      AND model.id::text=engine.result_summary->'fit_checkpoint'->>'model_artifact_id'
      AND model.workspace_id=engine.workspace_id AND model.engine_execution_id=engine.id AND model.artifact_type='engine_model'
      AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=model.content->>'sha256') END),false)
$$;

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active')
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
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status='draft'
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

CREATE FUNCTION guard_workspace_engine_progress_checkpoint_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE artifact analysis_artifacts%ROWTYPE; checkpoint jsonb; projection signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.input_contract<>'workspace-topic-engine-v1' OR NEW.result_summary->'materialization_progress' IS NOT DISTINCT FROM OLD.result_summary->'materialization_progress' THEN RETURN NEW; END IF;
 checkpoint:=NEW.result_summary->'materialization_progress';
 SELECT * INTO artifact FROM analysis_artifacts WHERE id=(checkpoint->>'artifact_id')::uuid AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id;
 SELECT * INTO projection FROM signal_topic_catalog_executions WHERE id=(checkpoint->>'projection_execution_id')::uuid AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(artifact.metadata->>'contract_version'='workspace-topic-materialization-progress-v1'
   AND artifact.metadata-'contract_version'-'execution_id'-'output_catalog_revision'-'interpretation_units_digest'-'expected_interpretation_units_digest'
    =checkpoint-'artifact_id'-'projection_execution_id'-'generation_id'
   AND projection.generation_id::text=checkpoint->>'generation_id' AND projection.input_contract='workspace-topic-classification-v1'
   AND projection.input_snapshot->'source_projection'->>'materialization_artifact_id'=artifact.id::text
   AND NEW.result_summary->>'materialized_topics'=checkpoint->>'topic_count'
   AND (OLD.result_summary->'materialization_progress' IS NULL OR (checkpoint->>'interpreted_unit_count')::bigint>=(OLD.result_summary->'materialization_progress'->>'interpreted_unit_count')::bigint),false) THEN
  RAISE EXCEPTION 'Progress checkpoint must reference its immutable catalog and projection.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_engine_progress_checkpoint BEFORE UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_progress_checkpoint_v1();

-- Root-level abstention has no assignments to revalidate. Its interpretation
-- coverage must still be the same before a metadata-only carry-forward.
CREATE FUNCTION guard_workspace_projection_copy_source_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.source_generation_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM signal_classification_generation_items prior
  JOIN signal_classification_generations source ON source.id=prior.generation_id
  JOIN signal_classification_generations target ON target.id=NEW.generation_id
  WHERE prior.id=NEW.source_generation_item_id AND source.input_snapshot->'source_projection' IS DISTINCT FROM target.input_snapshot->'source_projection') THEN
  RAISE EXCEPTION 'workspace_classification_copy_projection_changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_projection_copy_source BEFORE INSERT ON signal_classification_generation_items
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_projection_copy_source_v1();

DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['guard_workspace_projection_copy_source_v1()','guard_workspace_engine_progress_checkpoint_v1()','guard_workspace_engine_progress_dispatch_v1()','signal_workspace_engine_materialization_source_v1(signal_topic_catalog_executions,analysis_artifacts,uuid)','guard_workspace_engine_analysis_artifact_v1()','guard_signal_workspace_engine_artifact_v1()','signal_workspace_projection_source_current_v1(signal_classification_generations)','validate_signal_tagging_model_registry_v1()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
