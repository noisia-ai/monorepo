-- A single workspace execution continues from a fitted model through metered
-- interpretation and catalog materialization. Existing ledgers remain authoritative.
CREATE FUNCTION signal_workspace_engine_interpretation_coverage_v1(p_execution uuid)
RETURNS TABLE(unit_count bigint,unique_count bigint,unit_digest text)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT count(*),count(DISTINCT unit.key),
  'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.key)::text||E'\n','' ORDER BY unit.key COLLATE "C"),''),'UTF8')),'hex')
 FROM analysis_artifacts artifact CROSS JOIN LATERAL jsonb_array_elements_text(artifact.metadata->'unit_keys') unit(key)
 WHERE artifact.engine_execution_id=p_execution AND artifact.artifact_type='engine_proposals'
  AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1';
$$;

CREATE FUNCTION guard_workspace_engine_analysis_artifact_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE;
 count_keys bigint; unique_keys bigint; profile signal_taxonomy_profiles%ROWTYPE; topics bigint;
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
 IF execution.input_snapshot->'interpretation_config' IS NULL THEN RETURN NEW; END IF;
 IF execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp()
  OR execution.result_summary->'fit_checkpoint' IS NULL THEN
  RAISE EXCEPTION 'Analysis proposals require a live fitted execution.' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(NEW.metadata->>'call_id')::uuid
   AND workspace_id=NEW.workspace_id AND catalog_execution_id=execution.id AND workspace_contract='workspace-engine-interpretation-v1';
  IF call.id IS NULL OR call.call_state<>'settled' OR call.response_sha256 IS DISTINCT FROM NEW.metadata->>'response_sha256'
   OR call.call_configuration IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->'call_configuration'
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
CREATE TRIGGER trg_workspace_engine_analysis_artifact BEFORE INSERT OR UPDATE OR DELETE ON analysis_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_analysis_artifact_v1();

CREATE FUNCTION guard_workspace_engine_analysis_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE fit jsonb; config jsonb; coverage record; materialization analysis_artifacts%ROWTYPE; output analysis_artifacts%ROWTYPE;
BEGIN
 IF NEW.input_contract<>'workspace-topic-engine-v1' THEN RETURN NEW; END IF;
 config:=NEW.input_snapshot->'interpretation_config';
 IF config IS NULL THEN RETURN NEW; END IF;
 IF NOT COALESCE(jsonb_typeof(config)='object' AND jsonb_typeof(config->'call_configuration')='object'
   AND config->'call_configuration'->>'provider'='anthropic'
   AND config->'call_configuration'->>'prompt_digest'~'^sha256:[0-9a-f]{64}$'
   AND config->'call_configuration'->>'schema_digest'~'^sha256:[0-9a-f]{64}$'
   AND (NEW.input_snapshot->>'claude_cap_micro_usd')::bigint>0
   AND (config->>'daily_cap_micro_usd')::bigint>0
   AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=config->>'budget_timezone'),false) THEN
  RAISE EXCEPTION 'Analysis interpretation configuration is invalid.' USING ERRCODE='23514'; END IF;
 fit:=NEW.result_summary->'fit_checkpoint';
 IF TG_OP='UPDATE' AND OLD.result_summary->'fit_checkpoint' IS NOT NULL
   AND OLD.result_summary->'fit_checkpoint' IS DISTINCT FROM fit THEN
  RAISE EXCEPTION 'Fitted analysis checkpoint is immutable.' USING ERRCODE='23514'; END IF;
 IF fit IS NOT NULL THEN
  SELECT * INTO output FROM analysis_artifacts WHERE id=(fit->>'output_artifact_id')::uuid
   AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id AND artifact_type='engine_output';
  IF output.id IS NULL OR NOT COALESCE(fit->>'checkpoint_digest'~'^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(fit->'interpretation_manifest')='object'
    AND (fit->'interpretation_manifest'->>'unit_count')::bigint>=0
    AND fit->'interpretation_manifest'->>'unit_digest'~'^sha256:[0-9a-f]{64}$'
    AND ((fit->>'result_kind'='insufficient_population' AND fit->>'model_version_id' IS NULL AND fit->>'model_artifact_id' IS NULL)
      OR (fit->>'result_kind'='computational_grouping' AND EXISTS(SELECT 1 FROM tagging_model_versions model JOIN analysis_artifacts artifact
        ON artifact.id=(fit->>'model_artifact_id')::uuid AND artifact.workspace_id=NEW.workspace_id AND artifact.engine_execution_id=NEW.id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=model.artifact_digest
        WHERE model.id=(fit->>'model_version_id')::uuid AND model.configuration->>'execution_id'=NEW.id::text))),false)
    OR NEW.processed_roots<>NEW.denominator OR NEW.processed_chunks<>NEW.expected_chunks THEN
   RAISE EXCEPTION 'Analysis fit checkpoint is incomplete.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' THEN
  SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(NEW.id);
  SELECT * INTO materialization FROM analysis_artifacts WHERE id=(NEW.result_summary->'analysis_checkpoint'->>'materialization_artifact_id')::uuid
   AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id AND artifact_key='materialization.json' AND artifact_type='engine_proposals'
   AND metadata->>'contract_version'='workspace-topic-materialization-v1';
  IF fit IS NULL OR materialization.id IS NULL OR coverage.unit_count<>coverage.unique_count
   OR coverage.unit_count IS DISTINCT FROM (fit->'interpretation_manifest'->>'unit_count')::bigint
   OR coverage.unit_digest IS DISTINCT FROM fit->'interpretation_manifest'->>'unit_digest'
   OR coverage.unit_count IS DISTINCT FROM (NEW.result_summary->>'interpreted_units')::bigint
   OR materialization.metadata->>'interpretation_units_digest' IS DISTINCT FROM coverage.unit_digest
   OR materialization.metadata->>'output_catalog_profile_id' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'
   OR materialization.metadata->>'output_catalog_revision' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'output_catalog_revision'
   OR materialization.metadata->>'mapping_digest' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'mapping_digest'
   OR materialization.metadata->>'topic_count' IS DISTINCT FROM NEW.result_summary->>'materialized_topics'
   OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=NEW.id AND workspace_contract='workspace-engine-interpretation-v1'
     AND call_state IN('reserved','in_flight','response_persisted','outcome_unknown')) THEN
   RAISE EXCEPTION 'Analysis cannot complete with partial interpretation or unresolved cost.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_analysis BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_analysis_v1();

REVOKE ALL ON FUNCTION signal_workspace_engine_interpretation_coverage_v1(uuid),guard_workspace_engine_analysis_artifact_v1(),guard_workspace_engine_analysis_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_engine_interpretation_coverage_v1(uuid),guard_workspace_engine_analysis_artifact_v1(),guard_workspace_engine_analysis_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_interpretation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; prior engine_cost_events%ROWTYPE; run_spent bigint; day_spent bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.workspace_contract IS NOT NULL THEN RAISE EXCEPTION 'Provider monetary evidence is retained.' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_contract IS DISTINCT FROM OLD.workspace_contract THEN
  RAISE EXCEPTION 'Provider ledger authority cannot be converted.' USING ERRCODE='23514'; END IF;
 IF NEW.workspace_contract IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL AND (
    execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp() OR execution.result_summary->'fit_checkpoint' IS NULL
    OR NEW.call_configuration IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->'call_configuration'
    OR NEW.budget_timezone IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->>'budget_timezone'
    OR NEW.budget_daily_cap_micro_usd IS DISTINCT FROM (execution.input_snapshot->'interpretation_config'->>'daily_cap_micro_usd')::bigint
    OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)) THEN
   RAISE EXCEPTION 'Analysis interpretation requires its live checkpoint and sealed configuration.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.budget_timezone)
   OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE NEW.budget_timezone)::date THEN
   RAISE EXCEPTION 'Provider daily authority is invalid.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE catalog_execution_id=NEW.catalog_execution_id),0),
    COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE budget_date=NEW.budget_date),0) INTO run_spent,day_spent
   FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=NEW.actor_user_id AND id<>NEW.id;
  IF run_spent+NEW.reserved_micro_usd>(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
   OR day_spent+NEW.reserved_micro_usd>NEW.budget_daily_cap_micro_usd THEN
   RAISE EXCEPTION 'Provider reservation exceeds its budget.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
   IF prior.id IS NULL OR prior.workspace_contract IS DISTINCT FROM NEW.workspace_contract
    OR prior.workspace_id<>NEW.workspace_id OR prior.catalog_execution_id<>NEW.catalog_execution_id
    OR prior.actor_user_id<>NEW.actor_user_id OR prior.call_state<>'definitely_not_sent' OR prior.response_storage_key IS NOT NULL
    OR prior.request_digest<>NEW.request_digest OR prior.call_configuration<>NEW.call_configuration
    OR prior.reserved_micro_usd<>NEW.reserved_micro_usd OR prior.attempt_token=NEW.attempt_token THEN
    RAISE EXCEPTION 'Provider retry requires an exact definitely-not-sent predecessor.' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=NEW.catalog_execution_id AND request_digest=NEW.request_digest
    AND workspace_contract='workspace-engine-interpretation-v1') THEN
   RAISE EXCEPTION 'Provider request retry requires an explicit predecessor.' USING ERRCODE='23514';
  END IF;
  IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR NOT ((execution.input_snapshot->'interpretation_config' IS NULL AND execution.status='ready') OR (execution.input_snapshot->'interpretation_config' IS NOT NULL AND execution.status='running' AND execution.execution_expires_at>clock_timestamp() AND execution.result_summary->'fit_checkpoint' IS NOT NULL))
   OR execution.actor_user_id<>NEW.actor_user_id OR NEW.call_state<>'reserved'
   OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)
   OR NEW.reserved_micro_usd>(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
   OR NEW.input_tokens<>0 OR NEW.output_tokens<>0 OR NEW.total_tokens<>0 OR NEW.settled_micro_usd IS NOT NULL
   OR NEW.response_storage_key IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NOT COALESCE(NEW.call_configuration->>'provider'=NEW.provider AND NEW.call_configuration->>'model'=NEW.model
     AND NEW.call_configuration->>'prompt_digest'~'^sha256:[0-9a-f]{64}$'
     AND NEW.call_configuration->>'schema_digest'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'Provider reservation authority is invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.workspace_id,NEW.catalog_execution_id,NEW.actor_user_id,NEW.idempotency_key,NEW.request_digest,NEW.request_seal,
     NEW.call_configuration,NEW.attempt_token,NEW.retry_of_call_id,NEW.reserved_micro_usd,NEW.provider,NEW.model,NEW.operation,
     NEW.budget_date,NEW.budget_timezone,NEW.budget_daily_cap_micro_usd,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.catalog_execution_id,OLD.actor_user_id,OLD.idempotency_key,OLD.request_digest,OLD.request_seal,
     OLD.call_configuration,OLD.attempt_token,OLD.retry_of_call_id,OLD.reserved_micro_usd,OLD.provider,OLD.model,OLD.operation,
     OLD.budget_date,OLD.budget_timezone,OLD.budget_daily_cap_micro_usd,OLD.created_at) THEN
   RAISE EXCEPTION 'Provider request and budget are immutable.' USING ERRCODE='23514'; END IF;
  IF OLD.call_state IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF NEW.call_state<>OLD.call_state AND NOT (
   (OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent'))
   OR (OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown','definitely_not_sent'))
   OR (OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown'))
   OR (OLD.call_state='outcome_unknown' AND (NEW.call_state='response_persisted' OR NEW.call_state='settled' AND NEW.response_storage_key IS NOT NULL))) THEN
   RAISE EXCEPTION 'Provider state transition is invalid.' USING ERRCODE='23514'; END IF;
  IF OLD.response_storage_key IS NOT NULL AND COALESCE((NEW.metadata->>'response_complete')::boolean,true)
    IS DISTINCT FROM COALESCE((OLD.metadata->>'response_complete')::boolean,true) THEN
   RAISE EXCEPTION 'Provider transport completeness is immutable.' USING ERRCODE='23514'; END IF;
  IF NEW.call_state='settled' AND NOT COALESCE((NEW.metadata->>'response_complete')::boolean,true) THEN
   RAISE EXCEPTION 'Incomplete provider transport cannot be settled.' USING ERRCODE='23514'; END IF;
  IF OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id) THEN
   RAISE EXCEPTION 'Provider response evidence is immutable.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
