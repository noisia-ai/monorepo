-- A prepared Batch may outlive its admission's budget day without ever crossing
-- the provider boundary. Preserve that Batch and its calls as an auditable,
-- definitely-unsent attempt; prepare the identical requests under today's
-- already-renewed admission. In-flight and uncertain Batches are never rolled.
ALTER TABLE signal_interest_decision_batches_v1
 DROP CONSTRAINT signal_interest_decision_batches_v1_state_check;
ALTER TABLE signal_interest_decision_batches_v1
 ADD CONSTRAINT signal_interest_decision_batches_v1_state_check CHECK(state IN(
  'prepared','submitting','submission_unknown','in_progress','canceling','ended',
  'applied','rejected','expired_unsubmitted'));

CREATE OR REPLACE FUNCTION signal_interest_decision_batch_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'interest_decision_batch_immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','provider_batch_id','provider_receipt_body',
    'provider_receipt_sha256','lease_token','lease_expires_at','next_poll_at','submitted_at','ended_at','last_error_code'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_batch_id','provider_receipt_body',
    'provider_receipt_sha256','lease_token','lease_expires_at','next_poll_at','submitted_at','ended_at','last_error_code'])
  OR OLD.provider_batch_id IS NOT NULL AND NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
  OR OLD.provider_receipt_body IS NOT NULL AND NEW.provider_receipt_body IS DISTINCT FROM OLD.provider_receipt_body
  OR OLD.state IN('applied','rejected','expired_unsubmitted') AND NEW IS DISTINCT FROM OLD
  OR NEW.state IS DISTINCT FROM OLD.state AND NOT(
   OLD.state='prepared' AND NEW.state IN('submitting','expired_unsubmitted')
   OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','canceling','ended','rejected')
   OR OLD.state='submission_unknown' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state='in_progress' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state='canceling' AND NEW.state IN('canceling','ended')
   OR OLD.state='ended' AND NEW.state='applied')
  OR NEW.state='expired_unsubmitted' AND (OLD.provider_batch_id IS NOT NULL
   OR OLD.provider_receipt_body IS NOT NULL OR OLD.provider_receipt_sha256 IS NOT NULL
   OR OLD.submitted_at IS NOT NULL
   OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
   OR NEW.next_poll_at IS NOT NULL
   OR EXISTS(SELECT 1 FROM signal_interest_decision_calls_v1 call
     WHERE call.batch_id=OLD.id AND (call.status<>'definitely_not_sent'
       OR call.sent_at IS NOT NULL OR call.raw_body IS NOT NULL))))
 THEN RAISE EXCEPTION 'interest_decision_batch_transition_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION rollover_prepared_signal_interest_decision_batch_v1(
 target_batch uuid,target_token uuid,target_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE scope record;o signal_interest_decision_owners_v1%ROWTYPE;
 b signal_interest_decision_batches_v1%ROWTYPE;old_a signal_processing_admissions%ROWTYPE;
 current_a signal_processing_admissions%ROWTYPE;successor signal_interest_decision_batches_v1%ROWTYPE;
 day date;request_digests text[];call_count integer;rollover_key text;prepared jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001';END IF;
 SELECT owner.id owner_id,owner.organization_id,owner.workspace_id,owner.actor_user_id,
  admission.budget_date,admission.budget_timezone INTO scope
 FROM signal_interest_decision_batches_v1 batch
 JOIN signal_interest_decision_owners_v1 owner ON owner.id=batch.owner_id
 JOIN signal_processing_admissions admission ON admission.id=batch.admission_id
 WHERE batch.id=target_batch;
 IF scope.owner_id IS NULL OR scope.actor_user_id IS DISTINCT FROM target_actor THEN
  RAISE EXCEPTION 'interest_decision_rollover_forbidden' USING ERRCODE='42501';END IF;
 day:=(clock_timestamp() AT TIME ZONE scope.budget_timezone)::date;
 rollover_key:='interest-decision-rollover:'||target_batch::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'signal-processing-policy:'||scope.organization_id::text,0));
 PERFORM signal_processing_lock_v1(scope.organization_id,day);
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=scope.owner_id FOR UPDATE NOWAIT;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 SELECT * INTO old_a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF o.id IS NULL OR b.id IS NULL OR b.owner_id IS DISTINCT FROM o.id
  OR o.organization_id IS DISTINCT FROM scope.organization_id
  OR o.workspace_id IS DISTINCT FROM scope.workspace_id
  OR o.actor_user_id IS DISTINCT FROM target_actor
  OR old_a.budget_timezone IS DISTINCT FROM scope.budget_timezone
  OR old_a.budget_date IS DISTINCT FROM scope.budget_date THEN
  RAISE EXCEPTION 'interest_decision_rollover_scope_invalid' USING ERRCODE='23514';END IF;
 IF b.state='expired_unsubmitted' THEN
  SELECT * INTO successor FROM signal_interest_decision_batches_v1
   WHERE owner_id=o.id AND submission_key=rollover_key;
  IF successor.id IS NULL OR successor.page_id IS DISTINCT FROM b.page_id
   OR successor.manifest_body IS DISTINCT FROM b.manifest_body
   OR successor.manifest_digest IS DISTINCT FROM b.manifest_digest THEN
   RAISE EXCEPTION 'interest_decision_rollover_replay_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('batch_id',successor.id,'manifest_digest',successor.manifest_digest,
   'replayed',true,'expired_batch_id',b.id);
 END IF;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'prepared' OR b.provider_batch_id IS NOT NULL
  OR b.provider_receipt_body IS NOT NULL OR b.provider_receipt_sha256 IS NOT NULL
  OR b.submitted_at IS NOT NULL
  OR old_a.budget_date>=day OR old_a.admission_not_after>clock_timestamp()
  OR o.status<>'ready' THEN
  RAISE EXCEPTION 'interest_decision_rollover_not_unsent' USING ERRCODE='23514';END IF;
 SELECT admission.* INTO current_a FROM signal_processing_admissions admission
  JOIN signal_interest_decision_owner_admissions_v1 renewal ON renewal.admission_id=admission.id
  WHERE renewal.owner_id=o.id AND renewal.budget_date=day;
 IF current_a.id IS NULL OR current_a.budget_timezone IS DISTINCT FROM old_a.budget_timezone THEN
  RAISE EXCEPTION 'interest_decision_rollover_admission_required' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v1(o.id,current_a.id,true);
 SELECT count(*)::integer,array_agg(request.request_digest ORDER BY request.request_index)
  INTO call_count,request_digests
 FROM signal_interest_decision_calls_v1 call
 JOIN signal_interest_decision_requests_v1 request ON request.id=call.request_id
 WHERE call.batch_id=b.id AND call.owner_id=o.id AND request.owner_id=o.id
  AND request.page_id=b.page_id AND call.status='reserved'
  AND call.sent_at IS NULL AND call.raw_body IS NULL AND call.response_at IS NULL;
 IF call_count<1 OR call_count>64 OR call_count<>(SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)
  OR b.manifest_digest IS DISTINCT FROM signal_semantic_context_digest_v1(b.manifest_body) THEN
  RAISE EXCEPTION 'interest_decision_rollover_call_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='definitely_not_sent',error_code='budget_day_expired_unsent'
  WHERE batch_id=b.id AND status='reserved';
 UPDATE signal_interest_decision_batches_v1 SET state='expired_unsubmitted',lease_token=NULL,
  lease_expires_at=NULL,next_poll_at=NULL,last_error_code='budget_day_expired_unsent'
  WHERE id=b.id;
 prepared:=prepare_signal_interest_decision_batch_v1(o.id,b.page_id,request_digests,rollover_key);
 SELECT * INTO successor FROM signal_interest_decision_batches_v1 WHERE id=(prepared->>'batch_id')::uuid;
 IF successor.id IS NULL OR successor.owner_id IS DISTINCT FROM o.id
  OR successor.page_id IS DISTINCT FROM b.page_id
  OR successor.admission_id IS DISTINCT FROM current_a.id
  OR successor.manifest_body IS DISTINCT FROM b.manifest_body
  OR successor.manifest_digest IS DISTINCT FROM b.manifest_digest THEN
  RAISE EXCEPTION 'interest_decision_rollover_successor_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('batch_id',successor.id,'manifest_digest',successor.manifest_digest,
  'replayed',false,'expired_batch_id',b.id);
END $$;

REVOKE ALL ON FUNCTION rollover_prepared_signal_interest_decision_batch_v1(uuid,uuid,uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION rollover_prepared_signal_interest_decision_batch_v1(uuid,uuid,uuid) TO service_role;
 END IF;
END $$;
