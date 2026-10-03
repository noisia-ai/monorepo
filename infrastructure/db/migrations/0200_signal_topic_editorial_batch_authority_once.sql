-- The batch preparer and mark-submitting transition each validate mutable
-- Brand OS/source authority once per provider batch, before any paid HTTP IO.
-- Reserving and transitioning each item repeats monetary/scope/receipt guards,
-- but rehashing the complete knowledge base for every item makes a 1,652-item
-- manifest exceed the Worker statement timeout. A direct row mutation cannot
-- send to the provider; mark_submitting_signal_topic_editorial_batch_v2 still
-- checks full authority in the same transaction before changing calls to
-- in_flight. No historical calls, manifests, balances or results are changed.
CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;
 spent bigint;org_spent bigint;expected bigint;envelope jsonb;rejected boolean;usage_valid boolean:=true;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,NEW.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 IF o.execution_id IS NULL OR r.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd,NEW.budget_timezone)
   IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd,a.budget_timezone)
 THEN RAISE EXCEPTION 'topic_editorial_v2_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_topic_editorial_batch_authority_v2(e.id,false);
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.response_output IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL
   OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  IF prior.id IS DISTINCT FROM NEW.retry_of_call_id OR prior.id IS NOT NULL AND
   (prior.transport_version<>2 OR prior.status NOT IN('settled','definitely_not_sent')
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND validation->>'status'='accepted')
    OR prior.status='settled' AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND (validation IS NOT NULL OR outcome='submission_rejected'))) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_not_retryable' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 WHERE request_id=r.id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_request_already_reused' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  SELECT total_micro_usd INTO org_spent FROM signal_processing_org_exposure_v1(e.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=o.policy_version_id;
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_v2_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF OLD.transport_version<>2 OR (to_jsonb(NEW)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD
   OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF OLD.status='reserved' AND NEW.status='in_flight' THEN
   PERFORM signal_topic_editorial_batch_authority_v2(e.id,false);
   IF NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date THEN
    RAISE EXCEPTION 'topic_editorial_v2_reservation_day_expired' USING ERRCODE='23514';END IF;
   NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
   WHERE i.call_id=NEW.id AND b.state='rejected' AND b.provider_receipt_body=NEW.response_body_private
    AND b.rejection_http_status=NEW.response_http_status AND NEW.response_complete=true) INTO rejected;
  IF rejected THEN
   IF NEW.observed_micro_usd IS DISTINCT FROM 0::bigint OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM 0::bigint
    OR NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private) THEN
    RAISE EXCEPTION 'topic_editorial_v2_rejection_settlement_invalid' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.request_id=r.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
     AND b.execution_id=e.id AND b.state IN('ended','applied'))
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_v2_response_binding_invalid' USING ERRCODE='23514';END IF;
  BEGIN expected:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN usage_valid:=false;END;
  IF NOT usage_valid OR expected>NEW.reserved_micro_usd THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_v2_usage_unresolved' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF NEW.observed_micro_usd IS DISTINCT FROM expected
   OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'topic_editorial_v2_settlement_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
