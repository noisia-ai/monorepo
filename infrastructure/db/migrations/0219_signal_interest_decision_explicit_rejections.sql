-- Explicit provider HTTP 402/429 rejection is a known non-submission, with its
-- complete response retained before the call reservation is released. Neither a
-- timeout nor a missing response is eligible for this transition. This migration
-- deliberately does not reconcile older submission_unknown batches.

CREATE OR REPLACE FUNCTION signal_interest_decision_call_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;r signal_interest_decision_requests_v1%ROWTYPE;
 b signal_interest_decision_batches_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 org_exposure bigint;owner_exposure bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'interest_decision_call_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=NEW.owner_id;
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE id=NEW.request_id;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=NEW.batch_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF o.id IS NULL OR r.id IS NULL OR b.id IS NULL OR a.id IS NULL
  OR r.owner_id IS DISTINCT FROM o.id OR b.owner_id IS DISTINCT FROM o.id
  OR b.page_id IS DISTINCT FROM r.page_id OR a.target_id IS DISTINCT FROM o.id
  OR NEW.organization_id IS DISTINCT FROM o.organization_id
  OR NEW.reserved_micro_usd IS DISTINCT FROM r.reserved_micro_usd
  OR NEW.budget_date IS DISTINCT FROM a.budget_date
  OR NEW.budget_timezone IS DISTINCT FROM a.budget_timezone THEN
  RAISE EXCEPTION 'interest_decision_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_processing_lock_v1(o.organization_id,NEW.budget_date);
  IF NEW.status<>'reserved' OR NEW.raw_body IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.settled_micro_usd IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
   OR NEW.attempt_index<>COALESCE((SELECT max(attempt_index)+1 FROM signal_interest_decision_calls_v1
     WHERE request_id=r.id),1)
   OR NEW.retry_of_call_id IS DISTINCT FROM (SELECT id FROM signal_interest_decision_calls_v1
     WHERE request_id=r.id ORDER BY attempt_index DESC LIMIT 1) THEN
   RAISE EXCEPTION 'interest_decision_call_insert_invalid' USING ERRCODE='23514';END IF;
  SELECT total_micro_usd INTO org_exposure FROM signal_processing_org_exposure_v1(
   o.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd
    WHEN status='definitely_not_sent' THEN 0 ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO owner_exposure FROM signal_interest_decision_calls_v1 WHERE owner_id=o.id;
  IF org_exposure+NEW.reserved_micro_usd>
    (SELECT daily_cap_micro_usd FROM signal_processing_policy_versions WHERE id=a.policy_version_id)
   OR owner_exposure+NEW.reserved_micro_usd>o.hard_cap_micro_usd THEN
   RAISE EXCEPTION 'interest_decision_cap_exhausted' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','raw_body','raw_sha256','storage_key','output_text','output_digest',
   'observed_micro_usd','settled_micro_usd','outcome','error_code','validation_status','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','raw_body','raw_sha256','storage_key','output_text','output_digest',
   'observed_micro_usd','settled_micro_usd','outcome','error_code','validation_status','sent_at','response_at','settled_at'])
   OR OLD.raw_body IS NOT NULL AND NEW.raw_body IS DISTINCT FROM OLD.raw_body
   OR OLD.status IN('settled','definitely_not_sent') AND NEW.status IS DISTINCT FROM OLD.status
   OR NEW.status IS DISTINCT FROM OLD.status AND NOT(
    OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
    OR OLD.status='in_flight' AND NEW.status IN('outcome_unknown','response_persisted')
    OR OLD.status='in_flight' AND NEW.status='definitely_not_sent'
      AND NEW.error_code='provider_rejected' AND b.state='rejected'
      AND b.provider_batch_id IS NULL AND b.provider_receipt_body IS NOT NULL
      AND b.provider_receipt_sha256=signal_semantic_context_digest_v1(b.provider_receipt_body)
    OR OLD.status='outcome_unknown' AND NEW.status IN('in_flight','response_persisted')
    OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown'))
   OR OLD.validation_status IS NOT NULL AND NEW.validation_status IS DISTINCT FROM OLD.validation_status
   OR NEW.status='settled' AND (NEW.raw_body IS NULL OR NEW.settled_micro_usd IS DISTINCT FROM NEW.observed_micro_usd
    OR NEW.settled_micro_usd>NEW.reserved_micro_usd)
   OR NEW.raw_body IS NOT NULL AND NEW.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.raw_body)
   OR NEW.output_text IS NOT NULL AND NEW.output_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.output_text)
  THEN RAISE EXCEPTION 'interest_decision_call_transition_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid,
 http_status integer,raw_body text,raw_sha text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'submitting' OR b.provider_batch_id IS NOT NULL
  OR http_status NOT IN(400,401,402,403,404,413,422,429) OR raw_body IS NULL OR octet_length(raw_body)>8388608
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body) THEN
  RAISE EXCEPTION 'interest_decision_rejection_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_batches_v1 SET state='rejected',provider_receipt_body=raw_body,
  provider_receipt_sha256=raw_sha,lease_token=NULL,lease_expires_at=NULL,ended_at=clock_timestamp()
 WHERE id=b.id;
 UPDATE signal_interest_decision_calls_v1 SET status='definitely_not_sent',error_code='provider_rejected'
 WHERE batch_id=b.id AND status='in_flight';
 RETURN jsonb_build_object('state','rejected','retry_allowed',true);
END $$;
