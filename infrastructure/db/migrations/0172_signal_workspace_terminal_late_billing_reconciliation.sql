-- Allow exact audited provider billing to be reconciled after the single
-- transport successor already exists. This updates accounting only: the
-- terminal call remains terminal_confirmed and still has no response bytes.

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
  IF execution.input_contract='workspace-incremental-editorial-v1' AND NOT workspace_incremental_editorial_ledger_request_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_not_admitted' USING ERRCODE='23514'; END IF;
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
  SELECT COALESCE(sum(CASE WHEN call_state='settled' OR call_state='terminal_confirmed'
       AND metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
       THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE catalog_execution_id=NEW.catalog_execution_id),0),
    COALESCE(sum(CASE WHEN call_state='settled' OR call_state='terminal_confirmed'
       AND metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
       THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
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
  IF execution.id IS NULL OR NOT ((execution.input_contract='workspace-topic-engine-v1' AND ((execution.input_snapshot->'interpretation_config' IS NULL AND execution.status='ready') OR (execution.input_snapshot->'interpretation_config' IS NOT NULL AND execution.status='running' AND execution.execution_expires_at>clock_timestamp() AND execution.result_summary->'fit_checkpoint' IS NOT NULL))) OR (execution.input_contract='workspace-incremental-editorial-v1' AND workspace_incremental_editorial_ledger_request_v1(NEW)))
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
  IF OLD.call_state='terminal_confirmed' AND NEW IS DISTINCT FROM OLD AND NOT COALESCE((
    NEW.call_state='terminal_confirmed' AND NEW.response_storage_key IS NULL
    AND OLD.metadata ? 'provider_terminal_receipt'
    AND NEW.metadata->'provider_terminal_receipt' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'
    AND NEW.metadata-'usage'-'provider_terminal_billing_reconciliation' IS NOT DISTINCT FROM OLD.metadata
    AND NEW.metadata->'usage' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'->'usage'
    AND jsonb_typeof(NEW.metadata->'provider_terminal_billing_reconciliation')='object'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'method'='audited_usage_pricing'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'provider_request_id'=OLD.metadata->'provider_terminal_receipt'->>'provider_request_id'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'terminal_receipt_digest'=
      'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(OLD.metadata->'provider_terminal_receipt'),'UTF8')),'hex')
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'actual_micro_usd'=OLD.metadata->'provider_terminal_receipt'->>'usage_cost_micro_usd'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->'usage' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'->'usage'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id'~'^[0-9a-f-]{36}$'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'reconciled_at' IS NOT NULL
    AND NEW.settled_micro_usd=(OLD.metadata->'provider_terminal_receipt'->>'usage_cost_micro_usd')::bigint
    AND NEW.input_tokens=(OLD.metadata->'provider_terminal_receipt'->'usage'->>'input_tokens')::int
      +(OLD.metadata->'provider_terminal_receipt'->'usage'->>'cache_read_input_tokens')::int
      +(OLD.metadata->'provider_terminal_receipt'->'usage'->>'cache_creation_input_tokens')::int
    AND NEW.output_tokens=(OLD.metadata->'provider_terminal_receipt'->'usage'->>'output_tokens')::int
    AND NEW.total_tokens=NEW.input_tokens+NEW.output_tokens
    AND NEW.estimated_cost_usd=NEW.settled_micro_usd::numeric/1000000
    AND NEW.settled_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM users verifier WHERE verifier.id=(NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id')::uuid
      AND verifier.status='active' AND verifier.user_type='noisia_internal' AND verifier.primary_role IN('noisia_admin','admin','founder'))
    AND signal_workspace_classification_actor_v1(NEW.workspace_id,(NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id')::uuid)
    AND abs(extract(epoch FROM (NEW.metadata->'provider_terminal_billing_reconciliation'->>'reconciled_at')::timestamptz-clock_timestamp()))<=60
    AND (to_jsonb(NEW)-ARRAY['settled_micro_usd','input_tokens','output_tokens','total_tokens','estimated_cost_usd','metadata','settled_at'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['settled_micro_usd','input_tokens','output_tokens','total_tokens','estimated_cost_usd','metadata','settled_at'])
   ),false) THEN RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF NEW.call_state<>OLD.call_state AND NOT (
   (OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent'))
   OR (OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown','definitely_not_sent'))
   OR (OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown'))
   OR (OLD.call_state='outcome_unknown' AND (NEW.call_state IN('response_persisted','terminal_confirmed') OR NEW.call_state='settled' AND NEW.response_storage_key IS NOT NULL))
   ) THEN
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

REVOKE ALL ON FUNCTION guard_workspace_engine_interpretation_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_engine_interpretation_v1() FROM %I',role_name);
 END LOOP;
END $$;

