-- Shared-vocabulary pilot identity. Preserve historical v1/v2 receipts.
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
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NOT COALESCE(execution.status IN('running','failed','ready') AND execution.result_summary ? 'fit_checkpoint'
    AND signal_workspace_engine_actor_v1(execution,execution.actor_user_id)
    AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
    AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
    AND profile.id=signal_workspace_incremental_operational_profile_v1(execution.id)
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
 IF NEW.metadata->>'contract_version'='workspace-mass-labeling-consolidation-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(NEW.metadata->>'call_id')::uuid
   AND workspace_id=NEW.workspace_id AND catalog_execution_id=execution.id AND workspace_contract='workspace-engine-interpretation-v1';
  IF NOT COALESCE(execution.input_snapshot#>>'{engine_config,profile_version}' IN ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
    AND NEW.artifact_key='mass-labeling-consolidation.json'
    AND NEW.metadata->>'source_engine_execution_id'=execution.id::text
    AND NEW.metadata->>'stage'='global-consolidation-v1'
    AND NEW.metadata->>'source_groups_digest'~'^sha256:[0-9a-f]{64}$'
    AND call.id IS NOT NULL AND call.call_state='settled' AND call.response_http_status=200
    AND call.actor_user_id=execution.actor_user_id
    AND call.request_digest=NEW.metadata->>'request_digest'
    AND call.response_sha256=NEW.metadata->>'response_sha256'
    AND call.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
    AND call.metadata#>>'{mass_labeling_stage,source_groups_digest}'=NEW.metadata->>'source_groups_digest'
    AND call.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,call.metadata->>'interpretation_revision_digest')
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'mass_labeling_consolidation_receipt_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
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
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
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

CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_cost_stage_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.metadata->'mass_labeling_stage' IS DISTINCT FROM OLD.metadata->'mass_labeling_stage' THEN
  RAISE EXCEPTION 'mass_labeling_cost_stage_immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.metadata ? 'mass_labeling_stage' AND NOT COALESCE(
   NEW.workspace_contract='workspace-engine-interpretation-v1'
   AND NEW.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
   AND NEW.metadata#>>'{mass_labeling_stage,source_groups_digest}'~'^sha256:[0-9a-f]{64}$'
   AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution WHERE execution.id=NEW.catalog_execution_id
     AND execution.workspace_id=NEW.workspace_id AND execution.actor_user_id=NEW.actor_user_id
     AND execution.input_snapshot#>>'{engine_config,profile_version}' IN ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')),false) THEN
  RAISE EXCEPTION 'mass_labeling_cost_stage_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
