-- Reconcile provider usage already audited from the Anthropic console while
-- retaining terminal_confirmed as its transport state. The exact billed amount
-- can then replace the conservative reservation in budget views without making
-- the missing response usable or blocking the one allowed transport successor.

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
    AND NOT EXISTS(SELECT 1 FROM engine_cost_events retry WHERE retry.retry_of_call_id=OLD.id)
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

-- Effective provider cost is shared by every admission and organization cap.
-- A malformed or incomplete reconciliation remains charged at the conservative
-- reservation; only the exact, guarded receipt switches it to observed usage.
CREATE OR REPLACE FUNCTION workspace_engine_interpretation_terminal_billed_v1(call engine_cost_events)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(call.call_state='terminal_confirmed'
  AND call.settled_micro_usd IS NOT NULL
  AND call.metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1',false)
$$;
CREATE OR REPLACE FUNCTION workspace_engine_interpretation_effective_cost_v1(call engine_cost_events)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN call.call_state='settled' OR workspace_engine_interpretation_terminal_billed_v1(call)
  THEN call.settled_micro_usd WHEN call.call_state='definitely_not_sent' THEN 0 ELSE call.reserved_micro_usd END
$$;
CREATE OR REPLACE FUNCTION workspace_engine_interpretation_effective_state_v1(call engine_cost_events)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN call.call_state='settled' OR workspace_engine_interpretation_terminal_billed_v1(call) THEN 'confirmed'
  WHEN call.call_state='outcome_unknown' THEN 'ambiguous' WHEN call.call_state='definitely_not_sent' THEN 'released' ELSE 'reserved' END
$$;
REVOKE ALL ON FUNCTION workspace_engine_interpretation_terminal_billed_v1(engine_cost_events),workspace_engine_interpretation_effective_cost_v1(engine_cost_events),workspace_engine_interpretation_effective_state_v1(engine_cost_events) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION workspace_engine_interpretation_terminal_billed_v1(engine_cost_events),workspace_engine_interpretation_effective_cost_v1(engine_cost_events),workspace_engine_interpretation_effective_state_v1(engine_cost_events) FROM %I',role_name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_interpretation_admission_operation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; execution signal_topic_catalog_executions%ROWTYPE; config jsonb; run_spent bigint; day_spent bigint;
BEGIN
 IF NEW.operation_kind NOT IN('authorize-interpretation','revoke-interpretation') THEN RETURN NEW; END IF;
 body:=NEW.result;
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid AND input_contract='workspace-incremental-editorial-v1') THEN
  PERFORM workspace_incremental_editorial_admission_validate_v1(NEW); RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;
 config:=COALESCE(execution.interpretation_revision->'configuration',execution.input_snapshot->'interpretation_config');
 IF NEW.status<>'completed' OR NEW.completed_at IS NULL OR pg_column_size(body)>8192
 OR NOT workspace_interpretation_admission_admin_v1(NEW.workspace_id,NEW.actor_user_id)
 OR execution.id IS NULL OR execution.workspace_id<>NEW.workspace_id OR execution.input_contract<>'workspace-topic-engine-v1'
 OR execution.input_snapshot ? 'numeric_descriptor'
 OR NOT COALESCE(body->>'contract_version'='workspace-interpretation-admission-v1'
  AND body->>'operation_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'authorized_by_user_id'=NEW.actor_user_id::text AND body->>'budget_actor_user_id'=execution.actor_user_id::text
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM execution.interpretation_admission_operation_id
  AND body->>'input_digest'=execution.input_digest
  AND body->>'fit_checkpoint_digest'=execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
  AND body->>'interpretation_revision_digest' IS NOT DISTINCT FROM execution.interpretation_revision->>'revision_digest'
  AND body->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(config->'call_configuration'),'UTF8')),'hex')
  AND (body->>'run_cap_micro_usd')::bigint=(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
  AND (body->>'daily_cap_micro_usd')::bigint=(config->>'daily_cap_micro_usd')::bigint
  AND body->>'budget_timezone'=config->>'budget_timezone'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(body-'grant_digest'),'UTF8')),'hex'),false) THEN
 RAISE EXCEPTION 'Interpretation admission receipt invalid.' USING ERRCODE='23514'; END IF;
 IF NEW.operation_kind='revoke-interpretation' THEN
  IF body->>'action'<>'revoke_interpretation' OR (body->>'grant_cap_micro_usd')::bigint<>0
   OR workspace_interpretation_admission_receipt_v1(execution.id)->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
      IS DISTINCT FROM workspace_interpretation_admission_receipt_v1(execution.id)-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'Interpretation revocation invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT workspace_interpretation_admission_eligible_v1(execution.id)
   OR NOT COALESCE(body->>'action'='authorize_interpretation' AND (body->>'grant_cap_micro_usd')::bigint>0
    AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (config->>'budget_timezone'))::date::text
    AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
    AND (body->>'admission_not_after')::timestamptz<=(((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (config->>'budget_timezone')),false) THEN
   RAISE EXCEPTION 'Interpretation authorization unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)) FILTER(WHERE catalog_execution_id=execution.id),0),
   COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)) FILTER(WHERE budget_date=(body->>'budget_date')::date),0)
  INTO run_spent,day_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=execution.actor_user_id;
  IF (body->>'grant_cap_micro_usd')::bigint>LEAST((body->>'run_cap_micro_usd')::bigint-run_spent,(body->>'daily_cap_micro_usd')::bigint-day_spent) THEN
   RAISE EXCEPTION 'Interpretation admission cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_interpretation_call_admission_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; receipt jsonb; grant_spent bigint;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.metadata->'interpretation_admission' IS DISTINCT FROM OLD.metadata->'interpretation_admission' THEN
  RAISE EXCEPTION 'Call admission is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id FOR UPDATE;
  IF execution.interpretation_admission_operation_id IS NULL THEN
   IF NEW.metadata ? 'interpretation_admission' THEN RAISE EXCEPTION 'Unexpected admission.' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  receipt:=workspace_interpretation_admission_receipt_v1(execution.id);
  IF NOT COALESCE(receipt->>'action'='authorize_interpretation'
   AND NEW.metadata->'interpretation_admission'=jsonb_build_object('operation_id',receipt->>'operation_id','grant_digest',receipt->>'grant_digest')
   AND receipt->>'budget_actor_user_id'=NEW.actor_user_id::text
   AND receipt->>'budget_date'=NEW.budget_date::text
   AND clock_timestamp()<(receipt->>'admission_not_after')::timestamptz
   AND workspace_interpretation_admission_admin_v1(execution.workspace_id,(receipt->>'authorized_by_user_id')::uuid)
   AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
   AND CASE WHEN execution.input_contract='workspace-incremental-editorial-v1' THEN workspace_incremental_editorial_execution_current_v1(execution.id) ELSE signal_workspace_incremental_parent_current_v1(execution.id,execution.workspace_id,execution.actor_user_id) END,false) THEN
   RAISE EXCEPTION 'Call admission unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)),0)
   INTO grant_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND id<>NEW.id
    AND catalog_execution_id=NEW.catalog_execution_id AND metadata->'interpretation_admission'->>'operation_id'=receipt->>'operation_id';
  IF grant_spent+NEW.reserved_micro_usd>(receipt->>'grant_cap_micro_usd')::bigint THEN
   RAISE EXCEPTION 'Interpretation grant cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION workspace_incremental_editorial_renewal_state_v1(target uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path=public,extensions,pg_temp AS $$
 WITH source AS MATERIALIZED (SELECT owner.*,workspace_interpretation_admission_receipt_v1(owner.id) receipt,
  workspace_incremental_editorial_execution_current_v1(owner.id) is_current,
  workspace_incremental_editorial_output_complete_v1(owner.id) output_complete,
  clock_timestamp() now FROM signal_topic_catalog_executions owner WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1'),
 policy AS MATERIALIZED (SELECT source.*,(input_snapshot->>'claude_cap_micro_usd')::bigint run_cap,
  (input_snapshot->'budget_policy'->>'daily_cap_micro_usd')::bigint daily_cap,
  input_snapshot->'budget_policy'->>'budget_timezone' zone,
  (now AT TIME ZONE (input_snapshot->'budget_policy'->>'budget_timezone'))::date AS budget_day FROM source),
 calls AS MATERIALIZED (SELECT call.*,workspace_incremental_editorial_renewal_releasable_v1(call) releasable,
  workspace_engine_interpretation_effective_cost_v1(call) exposure,
  workspace_engine_interpretation_terminal_billed_v1(call) terminal_billed
  FROM engine_cost_events call JOIN policy ON call.actor_user_id=policy.actor_user_id
  WHERE call.workspace_contract='workspace-engine-interpretation-v1' AND (call.catalog_execution_id=target OR call.budget_date=policy.budget_day)),
 money AS (SELECT
  COALESCE(sum(exposure) FILTER(WHERE catalog_execution_id=target AND NOT releasable),0) run_spent,
  COALESCE(sum(exposure) FILTER(WHERE budget_date=(SELECT budget_day FROM policy) AND NOT (catalog_execution_id=target AND releasable)),0) day_spent,
  COALESCE(sum(settled_micro_usd) FILTER(WHERE catalog_execution_id=target AND (call_state='settled' OR terminal_billed)),0) confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state NOT IN('settled','definitely_not_sent') AND NOT terminal_billed),0) reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state='terminal_confirmed' AND NOT terminal_billed),0) terminal,
  COALESCE(bool_or(catalog_execution_id=target AND (call_state IN('in_flight','outcome_unknown')
   OR call_state='reserved' AND NOT releasable OR call_state='response_persisted' AND (response_storage_key IS NULL OR NOT COALESCE((metadata->>'response_complete')::boolean,true)))),false) uncertain
  FROM calls),
 prepared AS (SELECT policy.*,money.*,greatest(0,least(run_cap-run_spent,daily_cap-day_spent)) maximum,
  (SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=target AND workspace_id=policy.workspace_id AND dispatch_kind='execution') job
  FROM policy CROSS JOIN money),
 checked AS (SELECT prepared.*,CASE
  WHEN NOT is_current THEN 'workspace_incremental_editorial_source_stale'
  WHEN status<>'failed' OR execution_token IS NOT NULL OR execution_expires_at IS NOT NULL THEN 'workspace_incremental_editorial_renewal_not_failed'
  WHEN uncertain THEN 'workspace_incremental_editorial_renewal_uncertain'
  WHEN output_complete THEN 'workspace_incremental_editorial_renewal_output_complete'
  WHEN receipt IS NULL OR NOT COALESCE(receipt->>'action'='revoke_interpretation' OR (receipt->>'admission_not_after')::timestamptz<=now,false) THEN 'workspace_incremental_editorial_renewal_not_expired'
  WHEN error_code IS NULL OR error_code NOT IN('workspace_engine_interpretation_daily_authority_expired','workspace_engine_interpretation_admission_revoked','workspace_engine_interpretation_admission_changed',
   'workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable','workspace_engine_interpretation_receipt_recovery_required','workspace_engine_interpretation_transport_terminal_confirmed') THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN error_code='workspace_engine_interpretation_receipt_recovery_required' AND NOT EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true)) THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN error_code='workspace_engine_interpretation_transport_terminal_confirmed' AND (NOT EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt') OR EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN job IS DISTINCT FROM 'signal-workspace-incremental-editorial-'||target::text||'-1'
   OR (result_summary->>'worker_job_id' IS NOT NULL AND result_summary->>'worker_job_id'<>job) THEN 'workspace_incremental_editorial_dispatch_unavailable'
  WHEN maximum<=0 THEN 'workspace_incremental_editorial_cap_exceeded'
  ELSE NULL END blocked FROM prepared)
 SELECT jsonb_build_object('execution_id',id,'is_current',is_current,'eligible',blocked IS NULL,'can_renew',blocked IS NULL,'blocked_reason',blocked,
  'expected_admission_operation_id',interpretation_admission_operation_id,'budget_actor_user_id',actor_user_id,'budget_timezone',zone,'budget_date',budget_day::text,
  'now',to_char(now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'maximum_admission_not_after',to_char(((budget_day+1)::timestamp AT TIME ZONE zone) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'run_cap_micro_usd',run_cap,'daily_cap_micro_usd',daily_cap,'confirmed_micro_usd',confirmed,'reserved_micro_usd',reserved,'terminal_reserved_micro_usd',terminal,
  'maximum_grant_micro_usd',maximum,'receipt',receipt,'context_digest',input_snapshot->>'context_digest','catalog_digest',input_snapshot->>'catalog_input_digest','worker_job_id',job)
 FROM checked
$$;

CREATE OR REPLACE FUNCTION workspace_incremental_editorial_admission_validate_v1(operation signal_classification_operations) RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_catalog_executions%ROWTYPE; body jsonb:=operation.result; policy jsonb; current_receipt jsonb; spent bigint; renewal jsonb;
BEGIN
 SELECT * INTO owner FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;policy:=owner.input_snapshot->'budget_policy';
 IF NOT COALESCE(owner.input_contract='workspace-incremental-editorial-v1' AND owner.workspace_id=operation.workspace_id
  AND operation.status='completed' AND operation.completed_at IS NOT NULL AND pg_column_size(body)<=8192
  AND workspace_interpretation_admission_admin_v1(operation.workspace_id,operation.actor_user_id)
  AND body->>'contract_version'='workspace-incremental-editorial-admission-v1' AND body->>'operation_id'=operation.id::text
  AND body->>'workspace_id'=owner.workspace_id::text AND body->>'authorized_by_user_id'=operation.actor_user_id::text
  AND body->>'budget_actor_user_id'=owner.actor_user_id::text AND body->>'input_digest'=owner.input_digest
  AND body->>'numeric_execution_id'=owner.source_execution_id::text AND body->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
  AND body->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
  AND body->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest' AND body->>'evidence_plan_artifact_id'=owner.input_snapshot->>'evidence_plan_artifact_id'
  AND body->>'configuration_digest'=workspace_incremental_editorial_digest_v1(owner.input_snapshot->'interpretation_configuration')
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM owner.interpretation_admission_operation_id
  AND body->>'budget_timezone'=policy->>'budget_timezone' AND body->>'daily_cap_micro_usd'=policy->>'daily_cap_micro_usd'
  AND body->>'run_cap_micro_usd'=owner.input_snapshot->>'claude_cap_micro_usd'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'=workspace_incremental_editorial_digest_v1(body-'grant_digest'),false) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_permission_invalid' USING ERRCODE='23514'; END IF;
 IF operation.operation_kind='revoke-interpretation' THEN
  current_receipt:=workspace_interpretation_admission_receipt_v1(owner.id);
  IF body->>'action' IS DISTINCT FROM 'revoke_interpretation' OR body->>'grant_cap_micro_usd' IS DISTINCT FROM '0'
   OR current_receipt->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
    IS DISTINCT FROM current_receipt-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_revoke_invalid' USING ERRCODE='23514'; END IF;
 ELSIF owner.interpretation_admission_operation_id IS NOT NULL THEN
  renewal:=workspace_incremental_editorial_renewal_state_v1(owner.id);
  IF NOT COALESCE(operation.operation_kind='authorize-interpretation' AND body->>'action'='authorize_interpretation'
   AND (renewal->>'eligible')::boolean
   AND body->>'grant_cap_micro_usd'~'^[1-9][0-9]*$' AND (body->>'grant_cap_micro_usd')::numeric<=9007199254740991
   AND (body->>'grant_cap_micro_usd')::numeric<=(renewal->>'maximum_grant_micro_usd')::numeric
   AND body->>'budget_date'=renewal->>'budget_date'
   AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (body->>'admission_not_after')::timestamptz<=(renewal->>'maximum_admission_not_after')::timestamptz,false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_renewal_unavailable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||owner.actor_user_id::text,0));
  renewal:=workspace_incremental_editorial_renewal_state_v1(owner.id);
  IF NOT COALESCE((renewal->>'eligible')::boolean AND (body->>'grant_cap_micro_usd')::numeric<=(renewal->>'maximum_grant_micro_usd')::numeric,false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 ELSE
  -- Initial permission only: a new key never renews or reacquires a unit.
  IF NOT COALESCE(owner.interpretation_admission_operation_id IS NULL AND body->>'action'='authorize_interpretation'
   AND body->>'grant_cap_micro_usd'=owner.input_snapshot->>'claude_cap_micro_usd'
   AND workspace_incremental_editorial_source_v1(owner.source_execution_id) AND workspace_incremental_editorial_claims_complete_v1(owner.id)
   AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (policy->>'budget_timezone'))::date::text
   AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (body->>'admission_not_after')::timestamptz<=(((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (policy->>'budget_timezone')),false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_permission_unavailable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||owner.actor_user_id::text,0));
  SELECT COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)),0)
   INTO spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=owner.actor_user_id AND budget_date=(body->>'budget_date')::date;
  IF (body->>'grant_cap_micro_usd')::bigint<=0 OR (body->>'grant_cap_micro_usd')::bigint>(policy->>'daily_cap_micro_usd')::bigint-spent THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH entries AS (
  SELECT CASE WHEN r.status='settled' THEN 'confirmed' WHEN run.provider_call_state='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END kind,
   CASE WHEN r.status='settled' THEN r.actual_micro_usd ELSE r.reservation_micro_usd END amount
  FROM signal_semantic_context_budget_reservations r JOIN signal_workspaces w ON w.id=r.workspace_id
  JOIN signal_semantic_context_proposal_runs run ON run.id=r.run_id
  LEFT JOIN LATERAL(SELECT candidate.budget_date FROM signal_brand_context_semantic_renewals candidate
   WHERE candidate.reservation_id=r.id AND candidate.run_id=r.run_id
    AND NOT EXISTS(SELECT 1 FROM signal_brand_context_semantic_renewals successor WHERE successor.supersedes_renewal_id=candidate.id)
   ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) renewal ON true
  WHERE COALESCE(r.processing_organization_id,w.organization_id)=target_org AND COALESCE(renewal.budget_date,(r.reserved_at AT TIME ZONE target_timezone)::date)=target_day AND r.status<>'released'
   AND NOT COALESCE(excluded_ledger='semantic' AND r.id=excluded_id,false)
  UNION ALL
  SELECT CASE WHEN c.status='settled' THEN 'confirmed' WHEN c.status='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END,
   CASE WHEN c.status='settled' THEN c.settled_micro_usd ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END
  FROM signal_workspace_embedding_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
  WHERE COALESCE(c.processing_organization_id,w.organization_id)=target_org AND (c.reserved_at AT TIME ZONE target_timezone)::date=target_day AND c.status<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='voyage' AND c.id=excluded_id,false)
  UNION ALL
  SELECT workspace_engine_interpretation_effective_state_v1(c),workspace_engine_interpretation_effective_cost_v1(c)
  FROM engine_cost_events c JOIN signal_workspaces w ON w.id=c.workspace_id
  WHERE COALESCE(c.processing_organization_id,w.organization_id)=target_org AND c.workspace_contract='workspace-engine-interpretation-v1'
   AND (c.created_at AT TIME ZONE target_timezone)::date=target_day AND c.call_state<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='interpretation' AND c.id=excluded_id,false)
 ) SELECT COALESCE(sum(amount) FILTER(WHERE kind='confirmed'),0)::bigint,
  COALESCE(sum(amount) FILTER(WHERE kind='reserved'),0)::bigint,
  COALESCE(sum(amount) FILTER(WHERE kind='ambiguous'),0)::bigint,COALESCE(sum(amount),0)::bigint FROM entries
$$;
