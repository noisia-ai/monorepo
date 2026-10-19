-- Operator-audited provider terminal evidence is NOT an API response or an invoice.
-- Retain the full reservation; at most one charged transport successor may reuse
-- the exact logical request. No new table, provider activation or public RPC.
ALTER TABLE engine_cost_events DROP CONSTRAINT workspace_interpretation_shape;
ALTER TABLE engine_cost_events
ADD CONSTRAINT workspace_interpretation_shape CHECK(
  (workspace_contract IS NULL AND engine_analysis_id IS NOT NULL AND workspace_id IS NULL AND catalog_execution_id IS NULL AND call_state IS NULL)
  OR COALESCE(workspace_contract='workspace-engine-interpretation-v1' AND engine_analysis_id IS NULL AND pipeline_step_id IS NULL
   AND workspace_id IS NOT NULL AND catalog_execution_id IS NOT NULL AND actor_user_id IS NOT NULL
   AND provider='anthropic' AND length(model) BETWEEN 1 AND 120 AND operation='workspace-engine-interpretation'
   AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$' AND request_digest~'^sha256:[0-9a-f]{64}$' AND request_seal~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(call_configuration)='object' AND pg_column_size(call_configuration)<=16384
   AND call_state IN('reserved','in_flight','response_persisted','settled','outcome_unknown','definitely_not_sent','terminal_confirmed')
   AND attempt_token IS NOT NULL AND reserved_micro_usd>0 AND (settled_micro_usd IS NULL OR settled_micro_usd>=0)
   AND budget_date IS NOT NULL AND length(budget_timezone) BETWEEN 1 AND 100 AND budget_daily_cap_micro_usd>0
   AND ((response_storage_key IS NULL AND response_sha256 IS NULL AND response_size_bytes IS NULL AND response_http_status IS NULL)
    OR (response_storage_key LIKE 'workspace-engine/'||workspace_id::text||'/'||catalog_execution_id::text||'/%'
      AND response_sha256~'^sha256:[0-9a-f]{64}$' AND response_size_bytes>=0 AND response_http_status BETWEEN 100 AND 599))
   AND (call_state<>'response_persisted' OR response_storage_key IS NOT NULL)
   AND (call_state<>'settled' OR (response_storage_key IS NOT NULL AND settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL)),false));
DROP INDEX uq_workspace_interpretation_request;
CREATE UNIQUE INDEX uq_workspace_interpretation_request ON engine_cost_events(catalog_execution_id,request_digest)
 WHERE workspace_contract IS NOT NULL AND call_state NOT IN('definitely_not_sent','terminal_confirmed');
CREATE UNIQUE INDEX uq_workspace_interpretation_terminal_request
 ON engine_cost_events((metadata->'provider_terminal_receipt'->>'provider_request_id'))
 WHERE workspace_contract='workspace-engine-interpretation-v1' AND metadata ? 'provider_terminal_receipt';
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
  OR NEW.call_configuration IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->'call_configuration'
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
CREATE FUNCTION workspace_engine_terminal_checkpoint_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT execution.result_summary ? 'fit_checkpoint' AND (EXISTS(SELECT 1 FROM analysis_artifacts manifest
 CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(manifest.metadata->'bundle')='array'
   THEN manifest.metadata->'bundle' ELSE '[]'::jsonb END entries) bundle
 WHERE manifest.engine_execution_id=execution.id AND manifest.workspace_id=execution.workspace_id
 AND manifest.artifact_type='engine_output' AND manifest.artifact_key='manifest.json'
 AND jsonb_array_length(bundle.entries) BETWEEN 5 AND 34
 AND (SELECT count(DISTINCT entry->>'name') FROM jsonb_array_elements(bundle.entries) entry)=jsonb_array_length(bundle.entries)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['manifest.json','model-manifest.json','clusters.open.json','assignments.open.jsonl','roots.jsonl']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE entry->>'name'=required.name))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE NOT EXISTS(
   SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
    AND artifact.workspace_id=execution.workspace_id AND artifact.artifact_key=entry->>'name'
    AND artifact.artifact_type=CASE WHEN entry->>'name'='model-manifest.json' OR entry->>'name' LIKE '%.joblib' THEN 'engine_model' ELSE 'engine_output' END
    AND artifact.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND artifact.content-'contract_version'=entry-'name'))
 AND (SELECT count(*) FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
   AND artifact.artifact_type IN('engine_output','engine_model'))=jsonb_array_length(bundle.entries))) FROM signal_topic_catalog_executions execution WHERE execution.id=target AND execution.input_contract='workspace-topic-engine-v1'),false);
$$;

CREATE FUNCTION guard_workspace_engine_terminal_transport_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt jsonb; execution signal_topic_catalog_executions%ROWTYPE; prior engine_cost_events%ROWTYPE;
 terminal_count integer;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 receipt:=NEW.metadata->'provider_terminal_receipt';
 IF TG_OP='INSERT' AND receipt IS NOT NULL THEN
  RAISE EXCEPTION 'External terminal evidence requires a prior unresolved send.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.metadata ? 'provider_terminal_receipt'
  AND receipt IS DISTINCT FROM OLD.metadata->'provider_terminal_receipt' THEN
  RAISE EXCEPTION 'External terminal evidence is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND receipt IS DISTINCT FROM OLD.metadata->'provider_terminal_receipt' THEN
  IF OLD.call_state<>'outcome_unknown' OR NEW.call_state<>'terminal_confirmed'
   OR OLD.sent_at IS NULL OR OLD.response_storage_key IS NOT NULL
   OR NEW.provider_request_id IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL
   OR (to_jsonb(NEW)-ARRAY['call_state','metadata','failure_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['call_state','metadata','failure_code'])
   OR NEW.metadata-'provider_terminal_receipt' IS DISTINCT FROM OLD.metadata THEN
   RAISE EXCEPTION 'External terminal evidence cannot replace transport or monetary receipts.' USING ERRCODE='23514'; END IF;
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF execution.status IS DISTINCT FROM 'failed' OR jsonb_typeof(receipt) IS DISTINCT FROM 'object'
   OR NOT COALESCE(receipt->>'contract_version'='workspace-provider-terminal-evidence-v1'
    AND receipt->>'source'='anthropic_console' AND receipt->>'http_status'='499' AND receipt->>'reason'='client_disconnected'
    AND receipt->>'billing_status'='unreconciled' AND receipt->>'provider_request_id'~'^req_[A-Za-z0-9_-]{1,220}$'
    AND receipt->>'call_id'=NEW.id::text AND receipt->>'attempt_token'=NEW.attempt_token::text
    AND receipt->>'workspace_id'=NEW.workspace_id::text AND receipt->>'execution_id'=NEW.catalog_execution_id::text
    AND receipt->>'request_digest'=NEW.request_digest AND receipt->>'provider_model'=NEW.model
    AND receipt->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(NEW.call_configuration),'UTF8')),'hex')
    AND receipt->'evidence'->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||NEW.catalog_execution_id::text||'/%'
    AND position('..' in receipt->'evidence'->>'storage_key')=0
    AND receipt->'evidence'->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND receipt->'evidence'->>'size_bytes'~'^[1-9][0-9]{0,9}$'
    AND receipt->>'usage_cost_micro_usd'~'^[0-9]{1,15}$'
    AND receipt->'usage'->>'input_tokens'~'^[0-9]{1,10}$' AND receipt->'usage'->>'output_tokens'~'^[0-9]{1,10}$'
    AND receipt->'usage'->>'cache_read_input_tokens'~'^[0-9]{1,10}$' AND receipt->'usage'->>'cache_creation_input_tokens'~'^[0-9]{1,10}$'
    AND receipt->>'verified_by_user_id'~'^[0-9a-f-]{36}$'
    AND receipt->>'started_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND receipt->>'ended_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND receipt->>'verified_at' IS NOT NULL,false)
   OR pg_column_size(receipt)>16384 THEN
   RAISE EXCEPTION 'External terminal evidence scope is invalid.' USING ERRCODE='23514'; END IF;
  IF (receipt->>'usage_cost_micro_usd')::numeric<>ceil(
    ((receipt->'usage'->>'input_tokens')::numeric*(NEW.call_configuration->>'input_micro_usd_per_million_tokens')::numeric
     +(receipt->'usage'->>'output_tokens')::numeric*(NEW.call_configuration->>'output_micro_usd_per_million_tokens')::numeric
     +(receipt->'usage'->>'cache_read_input_tokens')::numeric*(NEW.call_configuration->>'cache_read_micro_usd_per_million_tokens')::numeric
     +(receipt->'usage'->>'cache_creation_input_tokens')::numeric*(NEW.call_configuration->>'cache_creation_micro_usd_per_million_tokens')::numeric)/1000000) THEN
   RAISE EXCEPTION 'External usage measurement must use the sealed rate, without settlement.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users verifier WHERE verifier.id=(receipt->>'verified_by_user_id')::uuid
    AND verifier.status='active' AND verifier.user_type='noisia_internal' AND verifier.primary_role IN('noisia_admin','admin','founder'))
   OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,(receipt->>'verified_by_user_id')::uuid)
   OR abs(extract(epoch FROM (receipt->>'started_at')::timestamptz-OLD.sent_at))>60
   OR (receipt->>'ended_at')::timestamptz<(receipt->>'started_at')::timestamptz
   OR (receipt->>'ended_at')::timestamptz>clock_timestamp()+interval '5 minutes'
   OR abs(extract(epoch FROM (receipt->>'verified_at')::timestamptz-clock_timestamp()))>60 THEN
   RAISE EXCEPTION 'External terminal evidence requires a current internal administrator and correlated send window.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.call_state='terminal_confirmed' AND receipt IS NULL THEN
  RAISE EXCEPTION 'External terminal evidence is required.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
  SELECT count(*) INTO terminal_count FROM engine_cost_events WHERE catalog_execution_id=NEW.catalog_execution_id
   AND request_digest=NEW.request_digest AND call_state='terminal_confirmed';
  IF terminal_count>1 THEN RAISE EXCEPTION 'Provider terminal transport retry is exhausted.' USING ERRCODE='23514'; END IF;
  IF terminal_count=1 THEN
   SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
   IF prior.id IS NULL OR prior.call_state NOT IN('definitely_not_sent','terminal_confirmed')
    OR prior.metadata->'editorial_repair' IS DISTINCT FROM NEW.metadata->'editorial_repair'
    OR prior.budget_date IS DISTINCT FROM NEW.budget_date OR prior.budget_timezone IS DISTINCT FROM NEW.budget_timezone
    OR prior.budget_daily_cap_micro_usd IS DISTINCT FROM NEW.budget_daily_cap_micro_usd
    OR NOT workspace_engine_terminal_checkpoint_v1(NEW.catalog_execution_id)
    OR EXISTS(SELECT 1 FROM engine_cost_events unresolved WHERE unresolved.catalog_execution_id=NEW.catalog_execution_id
      AND unresolved.id<>NEW.id AND unresolved.call_state IN('in_flight','response_persisted','outcome_unknown')) THEN
     RAISE EXCEPTION 'Provider terminal transport requires exact current checkpoint and no unresolved calls.' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_terminal_transport BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_terminal_transport_v1();
REVOKE ALL ON FUNCTION guard_workspace_engine_terminal_transport_v1(),workspace_engine_terminal_checkpoint_v1(uuid) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_engine_terminal_transport_v1(),workspace_engine_terminal_checkpoint_v1(uuid) FROM %I',role_name);
 END LOOP;
END; $$;
