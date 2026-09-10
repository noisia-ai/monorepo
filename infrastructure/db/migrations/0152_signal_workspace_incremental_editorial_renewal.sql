-- Renew only an existing, failed incremental editorial owner under a new explicit grant.
-- No numeric financing, new owner/claim, altered snapshot, request plan or paid output.
CREATE FUNCTION workspace_incremental_editorial_renewal_releasable_v1(call engine_cost_events) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(call.workspace_contract='workspace-engine-interpretation-v1' AND call.call_state='reserved'
  AND call.sent_at IS NULL AND call.response_storage_key IS NULL
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner WHERE owner.id=call.catalog_execution_id
   AND owner.workspace_id=call.workspace_id AND owner.input_contract='workspace-incremental-editorial-v1'
   AND (workspace_interpretation_admission_receipt_v1(owner.id)->>'action'='revoke_interpretation'
    OR EXISTS(SELECT 1 FROM signal_classification_operations grant_receipt
     WHERE grant_receipt.id::text=call.metadata->'interpretation_admission'->>'operation_id'
      AND grant_receipt.workspace_id=owner.workspace_id AND grant_receipt.result->>'execution_id'=owner.id::text
      AND (grant_receipt.result->>'admission_not_after')::timestamptz<=clock_timestamp()))),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_renewal_state_v1(target uuid) RETURNS jsonb
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
  CASE WHEN call.call_state='settled' THEN call.settled_micro_usd WHEN call.call_state='definitely_not_sent' THEN 0 ELSE call.reserved_micro_usd END exposure
  FROM engine_cost_events call JOIN policy ON call.actor_user_id=policy.actor_user_id
  WHERE call.workspace_contract='workspace-engine-interpretation-v1' AND (call.catalog_execution_id=target OR call.budget_date=policy.budget_day)),
 money AS (SELECT
  COALESCE(sum(exposure) FILTER(WHERE catalog_execution_id=target AND NOT releasable),0) run_spent,
  COALESCE(sum(exposure) FILTER(WHERE budget_date=(SELECT budget_day FROM policy) AND NOT (catalog_execution_id=target AND releasable)),0) day_spent,
  COALESCE(sum(settled_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state='settled'),0) confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state NOT IN('settled','definitely_not_sent')),0) reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state='terminal_confirmed'),0) terminal,
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
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
   INTO spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=owner.actor_user_id AND budget_date=(body->>'budget_date')::date;
  IF (body->>'grant_cap_micro_usd')::bigint<=0 OR (body->>'grant_cap_micro_usd')::bigint>(policy->>'daily_cap_micro_usd')::bigint-spent THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; body jsonb; policy jsonb; targets jsonb;
BEGIN
 IF COALESCE(NEW.input_contract,'')<>'workspace-incremental-editorial-v1' AND COALESCE(OLD.input_contract,'')<>'workspace-incremental-editorial-v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   OR (NEW.result_summary->'delivery_retry_count' IS DISTINCT FROM OLD.result_summary->'delivery_retry_count' AND NOT (OLD.status='failed' AND NEW.status='queued'))
   OR NEW.input_contract IS DISTINCT FROM OLD.input_contract OR OLD.status='ready' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
   OR (OLD.result_summary ? 'request_plan_artifact_id' AND (NEW.result_summary->>'request_plan_artifact_id' IS DISTINCT FROM OLD.result_summary->>'request_plan_artifact_id' OR NEW.result_summary->>'request_plan_digest' IS DISTINCT FROM OLD.result_summary->>'request_plan_digest'))
   OR NEW.result_summary->'analysis_complete' IS DISTINCT FROM 'false'::jsonb
   OR NEW.result_summary->'provider_enabled' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='failed' AND NEW.status='queued'
   AND NEW.interpretation_admission_operation_id IS DISTINCT FROM OLD.interpretation_admission_operation_id
   AND COALESCE((workspace_incremental_editorial_renewal_state_v1(OLD.id)->>'eligible')::boolean,false)
   AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.error_code IS NULL
   AND NEW.result_summary IS NOT DISTINCT FROM OLD.result_summary
   AND EXISTS(SELECT 1 FROM signal_classification_operations permission WHERE permission.id=NEW.interpretation_admission_operation_id
    AND permission.workspace_id=OLD.workspace_id AND permission.operation_kind='authorize-interpretation' AND permission.status='completed'
    AND permission.result->>'contract_version'='workspace-incremental-editorial-admission-v1' AND permission.result->>'execution_id'=OLD.id::text
    AND permission.result->>'prior_admission_operation_id'=OLD.interpretation_admission_operation_id::text
    AND permission.result->>'action'='authorize_interpretation' AND (permission.result->>'admission_not_after')::timestamptz>clock_timestamp())
   OR OLD.status='queued' AND NEW.status='running' OR (OLD.status='queued' AND NEW.status='failed'
   AND OLD.execution_token IS NULL AND OLD.execution_expires_at IS NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox dispatch WHERE dispatch.execution_id=OLD.id AND dispatch.workspace_id=OLD.workspace_id AND dispatch.dispatch_kind='execution'
     AND dispatch.worker_job_id='signal-workspace-incremental-editorial-'||OLD.id::text||'-1' AND dispatch.status='dead_letter' AND dispatch.error_code=NEW.error_code
     AND (OLD.result_summary->>'worker_job_id' IS NULL OR OLD.result_summary->>'worker_job_id'=dispatch.worker_job_id))
   AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND (OLD.result_summary->>'worker_job_id' IS NULL OR call_state IN('in_flight','outcome_unknown')))) OR OLD.status='running' AND NEW.status IN('ready','failed') OR OLD.status='failed' AND NEW.status='queued' AND OLD.error_code IN('workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable','workspace_engine_interpretation_transport_terminal_confirmed','workspace_engine_interpretation_receipt_recovery_required') AND (OLD.error_code<>'workspace_engine_interpretation_receipt_recovery_required' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true))) AND (OLD.error_code<>'workspace_engine_interpretation_transport_terminal_confirmed' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt') AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) AND COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)<8 AND (NEW.result_summary->>'delivery_retry_count')::int=COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)+1 AND workspace_incremental_editorial_execution_current_v1(OLD.id) AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state IN('in_flight','outcome_unknown'))) THEN RAISE EXCEPTION 'workspace_incremental_editorial_transition_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='running' AND NOT COALESCE(NEW.execution_token IS NOT NULL AND NEW.execution_expires_at>clock_timestamp() AND NEW.result_summary->>'worker_job_id' LIKE 'signal-workspace-incremental-editorial-'||NEW.id::text||'-%'
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox WHERE execution_id=NEW.id AND workspace_id=NEW.workspace_id AND dispatch_kind='execution' AND worker_job_id=NEW.result_summary->>'worker_job_id' AND status IN('dispatching','dispatched')),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_lease_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.result_summary ? 'request_plan_artifact_id' AND NOT (workspace_incremental_editorial_request_plan_valid_v1((NEW.result_summary->>'request_plan_artifact_id')::uuid) AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=NEW.result_summary->>'request_plan_artifact_id' AND plan.engine_execution_id=NEW.id AND plan.workspace_id=NEW.workspace_id AND plan.metadata->'plan'->>'plan_digest'=NEW.result_summary->>'request_plan_digest')) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_plan_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT COALESCE(NEW.completed_at IS NOT NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.result_summary->'editorial_complete'='true'::jsonb AND workspace_incremental_editorial_output_complete_v1(NEW.id),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_checkpoint_incomplete' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO source FROM signal_topic_catalog_executions WHERE id=NEW.source_execution_id FOR UPDATE;
 body:=NEW.input_snapshot; policy:=workspace_incremental_editorial_policy_v1(source.id);targets:=workspace_incremental_editorial_targets_v1(source.id);
 IF NOT COALESCE(source.id IS NOT NULL AND source.workspace_id=NEW.workspace_id AND NEW.actor_user_id=source.actor_user_id
  AND NEW.status='queued' AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.completed_at IS NULL
  AND NEW.interpretation_revision IS NULL AND NEW.interpretation_admission_operation_id IS NULL
  AND NEW.processed_roots=0 AND NEW.processed_chunks=0 AND NEW.denominator=source.denominator AND NEW.expected_chunks=source.expected_chunks
  AND NEW.embedding_run_id=source.embedding_run_id AND NEW.preparation_run_id=source.preparation_run_id AND NEW.embedding_config_digest=source.embedding_config_digest
  AND NEW.input_revision=source.input_revision AND NEW.policy_valid_until IS NOT DISTINCT FROM source.policy_valid_until
  AND NEW.population_digest=source.result_summary->'numeric_checkpoint'->>'population_digest'
  AND NEW.identity_catalog_digest=source.identity_catalog_digest AND NEW.definition_digest=source.definition_digest
  AND NEW.taxonomy_profile_id=(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
  AND workspace_incremental_editorial_source_v1(source.id) AND policy IS NOT NULL
  AND body->>'contract_version'='workspace-incremental-editorial-v1' AND pg_column_size(body)<=16384
  AND body->>'execution_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'numeric_execution_id'=source.id::text AND body->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
  AND body->>'population_digest'=NEW.population_digest AND body->>'input_revision'=NEW.input_revision::text
  AND body->>'context_digest'=source.input_snapshot->>'context_digest' AND body->>'catalog_input_digest'=source.input_snapshot->>'catalog_digest'
  AND body->>'model_bank_artifact_id'=source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
  AND body->>'model_bank_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id=(body->>'model_bank_artifact_id')::uuid AND engine_execution_id=source.id)
  AND body->>'census_derivation_digest'=workspace_incremental_editorial_census_v1(source.id)
  AND body->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)
  AND (body->>'expected_units')::bigint=(targets->>'expected_units')::bigint AND targets->>'expected_units'=targets->>'unique_units'
  AND workspace_incremental_editorial_plan_valid_v1((body->>'evidence_plan_artifact_id')::uuid)
  AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=body->>'evidence_plan_artifact_id' AND (plan.metadata->>'numeric_execution_id')::uuid=source.id
   AND body->>'target_units'=plan.metadata->'descriptor'->'stream'->>'rows' AND (body->>'target_units')::bigint>0
   AND body->>'target_unit_digest'=plan.metadata->'descriptor'->>'target_unit_digest' AND body->>'target_binding_digest'=plan.metadata->'descriptor'->>'target_binding_digest'
   AND body->>'evidence_digest'=plan.metadata->>'evidence_digest')
  AND body->'budget_policy'=policy AND body->>'budget_actor_user_id'=source.actor_user_id::text
  AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,(body->>'authorized_by_user_id')::uuid)
  AND (body->>'claude_cap_micro_usd')::bigint>0 AND (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint
  AND body->'interpretation_configuration'=workspace_incremental_editorial_sonnet_v1()
  AND NEW.input_digest=workspace_incremental_editorial_digest_v1(body)
  AND NEW.result_summary='{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  AND NEW.engine_request_keys IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_execution_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION workspace_incremental_editorial_renewal_releasable_v1(engine_cost_events),workspace_incremental_editorial_renewal_state_v1(uuid) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION workspace_incremental_editorial_renewal_releasable_v1(engine_cost_events),workspace_incremental_editorial_renewal_state_v1(uuid) FROM %I',role_name); END IF; END LOOP; END $$;
COMMENT ON FUNCTION workspace_incremental_editorial_renewal_state_v1(uuid) IS '0152: explicit incremental editorial renewal on the same immutable owner and original caps';
