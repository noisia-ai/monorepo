-- Extend the existing monetary audit ledger for workspace interpretation. Legacy
-- engine events retain their original shape and behavior. No provider is enabled.
ALTER TABLE engine_cost_events
 ALTER COLUMN engine_analysis_id DROP NOT NULL,
 ADD COLUMN workspace_contract text,
 ADD COLUMN workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 ADD COLUMN catalog_execution_id uuid,
 ADD COLUMN actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN idempotency_key text,
 ADD COLUMN request_digest text,
 ADD COLUMN request_seal text,
 ADD COLUMN call_configuration jsonb,
 ADD COLUMN call_state text,
 ADD COLUMN attempt_token uuid,
 ADD COLUMN retry_of_call_id uuid REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 ADD COLUMN reserved_micro_usd bigint,
 ADD COLUMN settled_micro_usd bigint,
 ADD COLUMN response_storage_key text,
 ADD COLUMN response_sha256 text,
 ADD COLUMN response_size_bytes bigint,
 ADD COLUMN response_http_status integer,
 ADD COLUMN provider_request_id text,
 ADD COLUMN failure_code text,
 ADD COLUMN budget_date date,
 ADD COLUMN budget_timezone text,
 ADD COLUMN budget_daily_cap_micro_usd bigint,
 ADD COLUMN sent_at timestamptz,
 ADD COLUMN response_received_at timestamptz,
 ADD COLUMN settled_at timestamptz,
 ADD CONSTRAINT workspace_interpretation_execution FOREIGN KEY(workspace_id,catalog_execution_id)
  REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_interpretation_shape CHECK(
  (workspace_contract IS NULL AND engine_analysis_id IS NOT NULL AND workspace_id IS NULL AND catalog_execution_id IS NULL AND call_state IS NULL)
  OR COALESCE(workspace_contract='workspace-engine-interpretation-v1' AND engine_analysis_id IS NULL AND pipeline_step_id IS NULL
   AND workspace_id IS NOT NULL AND catalog_execution_id IS NOT NULL AND actor_user_id IS NOT NULL
   AND provider='anthropic' AND length(model) BETWEEN 1 AND 120 AND operation='workspace-engine-interpretation'
   AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$' AND request_digest~'^sha256:[0-9a-f]{64}$' AND request_seal~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(call_configuration)='object' AND pg_column_size(call_configuration)<=16384
   AND call_state IN('reserved','in_flight','response_persisted','settled','outcome_unknown','definitely_not_sent')
   AND attempt_token IS NOT NULL AND reserved_micro_usd>0 AND (settled_micro_usd IS NULL OR settled_micro_usd>=0)
   AND budget_date IS NOT NULL AND length(budget_timezone) BETWEEN 1 AND 100 AND budget_daily_cap_micro_usd>0
   AND ((response_storage_key IS NULL AND response_sha256 IS NULL AND response_size_bytes IS NULL AND response_http_status IS NULL)
    OR (response_storage_key LIKE 'workspace-engine/'||workspace_id::text||'/'||catalog_execution_id::text||'/%'
      AND response_sha256~'^sha256:[0-9a-f]{64}$' AND response_size_bytes>=0 AND response_http_status BETWEEN 100 AND 599))
   AND (call_state<>'response_persisted' OR response_storage_key IS NOT NULL)
   AND (call_state<>'settled' OR (response_storage_key IS NOT NULL AND settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL)),false));
CREATE UNIQUE INDEX uq_workspace_interpretation_key ON engine_cost_events(workspace_id,idempotency_key) WHERE workspace_contract IS NOT NULL;
CREATE UNIQUE INDEX uq_workspace_interpretation_request ON engine_cost_events(catalog_execution_id,request_digest)
 WHERE workspace_contract IS NOT NULL AND call_state<>'definitely_not_sent';
CREATE UNIQUE INDEX uq_workspace_interpretation_successor ON engine_cost_events(retry_of_call_id) WHERE retry_of_call_id IS NOT NULL;
CREATE INDEX idx_workspace_interpretation_budget ON engine_cost_events(actor_user_id,budget_date) WHERE workspace_contract IS NOT NULL;
CREATE INDEX idx_workspace_interpretation_execution ON engine_cost_events(catalog_execution_id,created_at,id) WHERE workspace_contract IS NOT NULL;

CREATE FUNCTION guard_workspace_engine_interpretation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
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
  IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR execution.status<>'ready'
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
  IF OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id) THEN
   RAISE EXCEPTION 'Provider response evidence is immutable.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_interpretation BEFORE INSERT OR UPDATE OR DELETE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_interpretation_v1();
ALTER TABLE engine_cost_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON engine_cost_events FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_workspace_engine_interpretation_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON engine_cost_events FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_engine_interpretation_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
