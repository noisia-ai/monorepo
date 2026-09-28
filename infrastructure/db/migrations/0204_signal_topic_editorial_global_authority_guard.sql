-- Fix the global paid-call guard to validate the policy action instead of nonexistent execution provider/model columns.
-- Existing calls, receipts, admissions, stages and the 0202 migration remain unchanged.
CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;g signal_topic_editorial_global_stages_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;spent bigint;daily_spent bigint;expected bigint;prior signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
 envelope jsonb;cost bigint;request_body text;max_tokens integer;new_send boolean;
BEGIN
 SELECT * INTO g FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=g.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=a.policy_version_id AND action='topic_consolidation';
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 IF g.stage_id IS NULL OR g.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR (NEW.workspace_id,NEW.organization_id,NEW.execution_id,NEW.stage_id)
   IS DISTINCT FROM (e.workspace_id,e.organization_id,e.id,g.stage_id)
  OR a.id IS DISTINCT FROM e.processing_admission_id OR a.action IS DISTINCT FROM 'topic_consolidation'
  OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.organization_id IS DISTINCT FROM e.organization_id
  OR a.actor_user_id IS DISTINCT FROM e.actor_user_id OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR owner_row.execution_id IS NULL OR owner_row.policy_version_id IS DISTINCT FROM a.policy_version_id
  OR NEW.budget_date<>a.budget_date OR NEW.budget_timezone<>a.budget_timezone
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR action_row.provider IS DISTINCT FROM 'anthropic' OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514';
 END IF;
 new_send:=TG_OP='INSERT' OR (OLD.status='reserved' AND NEW.status='in_flight');
 IF new_send AND (p.id IS NULL OR p.organization_id<>e.organization_id OR p.status<>'active'
   OR clock_timestamp()<p.valid_from OR clock_timestamp()>=least(p.valid_until,a.admission_not_after,owner_row.send_not_after)
   OR clock_timestamp()>=a.admission_not_after OR clock_timestamp()>=owner_row.send_not_after) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
    OR NEW.settled_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_global_stage_call_invalid' USING ERRCODE='23514'; END IF;
  SELECT r.request_body,r.max_tokens INTO STRICT request_body,max_tokens FROM signal_topic_editorial_global_stage_requests_v2 r WHERE r.id=NEW.request_id AND r.stage_id=NEW.stage_id;
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.retry_of_call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
   IF prior.id IS NULL OR prior.status<>'settled' OR prior.settled_micro_usd<>0 OR prior.observed_micro_usd<>0
    OR (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=NEW.request_id)>=5
    OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      WHERE i.call_id=prior.id AND b.state='imported' AND i.outcome='errored' AND i.validation->>'status'='provider_error'
       AND prior.response_body_private::jsonb->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%') THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_retry_not_allowed' USING ERRCODE='23514';END IF;
  ELSIF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 prior_call WHERE prior_call.request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_retry_identity_required' USING ERRCODE='23514';
  END IF;
  expected:=(octet_length(request_body)::bigint*3+max_tokens::bigint*15+1)/2;
  IF NEW.reserved_micro_usd<>expected THEN RAISE EXCEPTION 'topic_editorial_global_stage_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  spent:=spent+COALESCE((SELECT sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END)
   FROM signal_topic_editorial_global_stage_calls_v2 WHERE execution_id=e.id AND status<>'definitely_not_sent'),0);
  SELECT total_micro_usd INTO daily_spent FROM signal_processing_org_exposure_v1(e.organization_id,a.budget_date,a.budget_timezone);
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR daily_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514'; END IF;
  NEW.reserved_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256) IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256)
  OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status='definitely_not_sent' AND OLD.provider_batch_id IS NULL
   OR OLD.status='in_flight' AND NEW.status IN('submission_unknown','response_persisted','outcome_unknown')
   OR OLD.status='submission_unknown' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_transition_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='in_flight' AND OLD.status='reserved' THEN NEW.sent_at:=clock_timestamp(); END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_invalid' USING ERRCODE='23514'; END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
    JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
      AND b.stage_id=NEW.stage_id AND b.state IN('ended','imported')) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_binding_invalid' USING ERRCODE='23514'; END IF;
  BEGIN cost:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN cost:=NULL; END;
  IF cost IS NULL THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_usage_unresolved' USING ERRCODE='23514'; END IF;
  ELSIF cost>NEW.reserved_micro_usd OR NEW.observed_micro_usd IS DISTINCT FROM cost
    OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM cost THEN
   RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='settled' THEN NEW.settled_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
