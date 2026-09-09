-- One explicit editorial model revision preserves the original execution, receipts,
-- numerical bundle and all financial exposure. It never approves a model or Topic.
ALTER TABLE signal_topic_catalog_executions ADD COLUMN interpretation_revision jsonb;
ALTER TABLE signal_topic_catalog_executions ADD CONSTRAINT workspace_engine_interpretation_revision_shape CHECK (
 interpretation_revision IS NULL OR (input_contract='workspace-topic-engine-v1' AND jsonb_typeof(interpretation_revision)='object'
 AND pg_column_size(interpretation_revision)<=24576));

CREATE FUNCTION workspace_engine_interpretation_configuration_v1(p_execution uuid,p_revision text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN p_revision IS NULL THEN input_snapshot->'interpretation_config'->'call_configuration'
  WHEN interpretation_revision->>'revision_digest'=p_revision THEN interpretation_revision->'configuration'->'call_configuration' END
 FROM signal_topic_catalog_executions WHERE id=p_execution AND input_contract='workspace-topic-engine-v1';
$$;
CREATE FUNCTION guard_workspace_engine_interpretation_revision_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE revision jsonb; source engine_cost_events%ROWTYPE; config jsonb; retained record;
BEGIN
 revision:=NEW.interpretation_revision;
 IF TG_OP='INSERT' THEN
  IF revision IS NOT NULL THEN RAISE EXCEPTION 'Editorial revisions require existing failed evidence.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF revision IS NOT DISTINCT FROM OLD.interpretation_revision THEN RETURN NEW; END IF;
 IF OLD.interpretation_revision IS NOT NULL THEN RAISE EXCEPTION 'Editorial revision is immutable and bounded.' USING ERRCODE='55000'; END IF;
 SELECT * INTO source FROM engine_cost_events WHERE id=(revision->>'source_call_id')::uuid;
 SELECT * INTO retained FROM signal_workspace_engine_interpretation_coverage_v1(OLD.id);
 config:=revision->'configuration';
 IF OLD.input_contract<>'workspace-topic-engine-v1' OR OLD.status<>'failed'
  OR OLD.error_code IS DISTINCT FROM 'workspace_engine_interpretation_repair_invalid' OR OLD.result_summary->'fit_checkpoint' IS NULL
  OR OLD.result_summary ? 'analysis_checkpoint' OR NOT workspace_engine_terminal_checkpoint_v1(OLD.id)
  OR (OLD.policy_valid_until IS NOT NULL AND OLD.policy_valid_until<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=OLD.workspace_id AND state.input_revision=OLD.input_revision)
  OR source.id IS NULL OR source.workspace_id<>OLD.workspace_id OR source.catalog_execution_id<>OLD.id OR source.actor_user_id<>OLD.actor_user_id
  OR source.call_state<>'settled' OR source.response_storage_key IS NULL OR source.response_http_status IS DISTINCT FROM 200
  OR NOT COALESCE((source.metadata->>'response_complete')::boolean,true) OR NOT(source.metadata ? 'editorial_repair')
  OR source.metadata ? 'interpretation_revision_digest'
  OR source.call_configuration IS DISTINCT FROM OLD.input_snapshot->'interpretation_config'->'call_configuration'
  OR source.model<>'claude-opus-5'
  OR EXISTS(SELECT 1 FROM analysis_artifacts WHERE engine_execution_id=OLD.id AND metadata->>'call_id'=source.id::text)
  OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state IN('reserved','in_flight','response_persisted','outcome_unknown'))
  OR config->'call_configuration' IS DISTINCT FROM '{"contract_version":"workspace-engine-interpretation-config-v1","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:0f6899018e107524f7a9805eae8725da6850d19cbb66426ef8fe981acdb8d52e","schema_digest":"sha256:584f513175a1b748a5dd2de79d7abeb5a0cb57cf51f5534b3bad9368348ba542","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"cache_read_micro_usd_per_million_tokens":300000,"cache_creation_micro_usd_per_million_tokens":3750000,"thinking":"disabled","effort":"high","max_output_tokens":8192,"token_bound_version":"utf8-request-bytes-times-four-plus-8192-v1","citation_wire_version":"group-local-reference-labels-v1"}'::jsonb
  OR config-'call_configuration' IS DISTINCT FROM (OLD.input_snapshot->'interpretation_config')-'call_configuration'
  OR NOT COALESCE(revision->>'contract_version'='workspace-engine-interpretation-revision-v1'
   AND revision->>'execution_id'=OLD.id::text AND revision->>'workspace_id'=OLD.workspace_id::text
   AND revision->>'actor_user_id'=OLD.actor_user_id::text AND revision->>'input_digest'=OLD.input_digest
   AND revision->>'source_request_digest'=source.request_digest AND revision->>'source_response_sha256'=source.response_sha256
   AND revision->>'source_configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(source.call_configuration),'UTF8')),'hex')
   AND revision->>'fit_checkpoint_digest'=OLD.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   AND revision->'retained_unit_manifest'=jsonb_build_object('unit_count',retained.unit_count,'unit_digest',retained.unit_digest)
   AND retained.unit_count=retained.unique_count
   AND revision->>'budget_date'=source.budget_date::text
   AND source.budget_date=(clock_timestamp() AT TIME ZONE source.budget_timezone)::date
   AND revision->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND abs(extract(epoch FROM ((revision->>'authorized_at')::timestamptz-clock_timestamp())))<60
   AND revision->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (revision->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (revision->>'admission_not_after')::timestamptz<=((source.budget_date+1)::timestamp AT TIME ZONE source.budget_timezone)
   AND revision->>'revision_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(revision-'revision_digest'),'UTF8')),'hex'),false) THEN
  RAISE EXCEPTION 'Editorial revision authority is invalid.' USING ERRCODE='23514'; END IF;
 IF NOT signal_workspace_classification_actor_v1(OLD.workspace_id,OLD.actor_user_id) THEN
  RAISE EXCEPTION 'Editorial revision actor is forbidden.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_interpretation_revision BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_interpretation_revision_v1();

CREATE FUNCTION guard_workspace_engine_call_revision_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; revision text;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 revision:=NEW.metadata->>'interpretation_revision_digest';
 IF TG_OP='UPDATE' AND NEW.metadata->'interpretation_revision_digest' IS DISTINCT FROM OLD.metadata->'interpretation_revision_digest' THEN
  RAISE EXCEPTION 'Call editorial revision is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id FOR UPDATE;
  IF revision IS DISTINCT FROM execution.interpretation_revision->>'revision_digest' THEN
   RAISE EXCEPTION 'Call editorial revision is not current.' USING ERRCODE='23514'; END IF;
  IF revision IS NOT NULL AND (NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,revision)
   OR NEW.budget_date::text IS DISTINCT FROM execution.interpretation_revision->>'budget_date'
   OR clock_timestamp()>=(execution.interpretation_revision->>'admission_not_after')::timestamptz) THEN
   RAISE EXCEPTION 'Editorial revision grant is unavailable.' USING ERRCODE='23514'; END IF;
  IF NEW.retry_of_call_id IS NOT NULL AND EXISTS(SELECT 1 FROM engine_cost_events prior WHERE prior.id=NEW.retry_of_call_id
    AND prior.metadata->>'interpretation_revision_digest' IS DISTINCT FROM revision) THEN
   RAISE EXCEPTION 'Transport cannot change editorial revision.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_call_revision BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_call_revision_v1();

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
    OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
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
    OR prior.actor_user_id<>NEW.actor_user_id OR prior.call_state NOT IN('definitely_not_sent','terminal_confirmed') OR prior.response_storage_key IS NOT NULL
    OR prior.request_digest<>NEW.request_digest OR prior.call_configuration<>NEW.call_configuration
    OR prior.reserved_micro_usd<>NEW.reserved_micro_usd OR prior.attempt_token=NEW.attempt_token THEN
    RAISE EXCEPTION 'Provider retry requires an exact unsent or externally confirmed terminal predecessor.' USING ERRCODE='23514'; END IF;
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
  IF OLD.call_state IN('settled','definitely_not_sent','terminal_confirmed') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF NEW.call_state<>OLD.call_state AND NOT (
   (OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent'))
   OR (OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown','definitely_not_sent'))
   OR (OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown'))
   OR (OLD.call_state='outcome_unknown' AND (NEW.call_state IN('response_persisted','terminal_confirmed') OR NEW.call_state='settled' AND NEW.response_storage_key IS NOT NULL))) THEN
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

CREATE OR REPLACE FUNCTION guard_workspace_engine_editorial_repair_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE repair jsonb; source engine_cost_events%ROWTYPE; prior engine_cost_events%ROWTYPE;
 execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 repair:=NEW.metadata->'editorial_repair';
 IF TG_OP='UPDATE' THEN
  IF repair IS DISTINCT FROM OLD.metadata->'editorial_repair' THEN
   RAISE EXCEPTION 'Editorial repair identity is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT (OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN RETURN NEW; END IF;
 END IF;
 IF repair IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(repair) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(repair))<>6
  OR NOT COALESCE(repair->>'contract_version'='workspace-editorial-repair-v1'
   AND repair->>'diagnostic'='output_invalid'
   AND repair->>'source_call_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
   AND repair->>'source_request_digest'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'source_response_sha256'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'protocol_digest'='sha256:7b113e97b33c00fc94a6043ac1f1f4a6c7aa99c5e792c465a384587e9b72e3d3',false) THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
 SELECT * INTO execution FROM signal_topic_catalog_executions
  WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO source FROM engine_cost_events WHERE id=(repair->>'source_call_id')::uuid FOR UPDATE;
 IF execution.status IS DISTINCT FROM 'running' OR execution.result_summary->'fit_checkpoint' IS NULL
  OR execution.input_snapshot->'interpretation_config' IS NULL
  OR source.id IS NULL OR source.workspace_contract IS DISTINCT FROM NEW.workspace_contract
  OR source.workspace_id IS DISTINCT FROM NEW.workspace_id OR source.catalog_execution_id IS DISTINCT FROM NEW.catalog_execution_id
  OR source.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR source.call_state IS DISTINCT FROM 'settled'
  OR source.response_storage_key IS NULL OR source.response_http_status IS DISTINCT FROM 200
  OR NOT COALESCE((source.metadata->>'response_complete')::boolean,true)
  OR source.metadata ? 'editorial_repair'
  OR source.request_digest IS DISTINCT FROM repair->>'source_request_digest'
  OR source.response_sha256 IS DISTINCT FROM repair->>'source_response_sha256'
  OR source.request_digest=NEW.request_digest OR source.call_configuration IS DISTINCT FROM NEW.call_configuration
  OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
  OR EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=NEW.catalog_execution_id
    AND artifact.metadata->>'call_id'=source.id::text) THEN
   RAISE EXCEPTION 'Editorial repair requires its unmaterialized settled source receipt.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM engine_cost_events other WHERE other.catalog_execution_id=NEW.catalog_execution_id
   AND other.id<>NEW.id AND other.call_state IN('in_flight','response_persisted','outcome_unknown')) THEN
  RAISE EXCEPTION 'Unresolved provider outcome blocks editorial repair.' USING ERRCODE='23514'; END IF;
 IF NEW.retry_of_call_id IS NOT NULL THEN
  SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
  IF prior.call_state NOT IN('definitely_not_sent','terminal_confirmed') OR prior.metadata->'editorial_repair' IS DISTINCT FROM repair THEN
   RAISE EXCEPTION 'Repair transport successor requires an unsent or externally confirmed predecessor.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_analysis_artifact_v1() RETURNS trigger LANGUAGE plpgsql
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

DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['workspace_engine_interpretation_configuration_v1(uuid,text)','guard_workspace_engine_interpretation_revision_v1()','guard_workspace_engine_call_revision_v1()','guard_workspace_engine_interpretation_v1()','guard_workspace_engine_editorial_repair_v1()','guard_workspace_engine_analysis_artifact_v1()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature); END IF;
 END LOOP;
END $$;
