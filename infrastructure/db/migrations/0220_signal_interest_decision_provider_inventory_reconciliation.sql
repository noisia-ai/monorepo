-- Operator-only negative reconciliation of Batches after a complete provider
-- inventory, with a grace period and a durable immutable receipt. The Worker may
-- never infer non-submission from a timeout or missing local provider ID.
CREATE TABLE signal_interest_decision_provider_inventories_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 inventory_sha256 text NOT NULL CHECK(inventory_sha256~'^sha256:[0-9a-f]{64}$'),
 raw_body text NOT NULL CHECK(octet_length(raw_body) BETWEEN 1 AND 8388608),
 fetched_at timestamptz NOT NULL,
 latest_provider_created_at timestamptz NOT NULL,
 earliest_uncertain_submitted_at timestamptz NOT NULL,
 latest_uncertain_submitted_at timestamptz NOT NULL,
 provider_count integer NOT NULL CHECK(provider_count>0),
 known_count integer NOT NULL CHECK(known_count>0),
 reconciled_count integer NOT NULL CHECK(reconciled_count>0),
 UNIQUE(owner_id,inventory_sha256)
);
CREATE FUNCTION signal_interest_decision_provider_inventory_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN RAISE EXCEPTION 'interest_decision_inventory_immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER signal_interest_decision_provider_inventory_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_provider_inventories_v1
 FOR EACH ROW EXECUTE FUNCTION signal_interest_decision_provider_inventory_immutable_v1();

CREATE FUNCTION signal_interest_decision_inventory_receipt_v1(raw_body text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,extensions,pg_temp AS $$
BEGIN RETURN raw_body::jsonb;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

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
  OR OLD.state IN('applied','rejected') AND NEW IS DISTINCT FROM OLD
  OR NEW.state IS DISTINCT FROM OLD.state AND NOT(
   OLD.state='prepared' AND NEW.state='submitting'
   OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','canceling','ended','rejected')
   OR OLD.state='submission_unknown' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state IN('submission_unknown','submitting') AND NEW.state='rejected'
     AND NEW.last_error_code='provider_inventory_absent'
     AND NEW.provider_batch_id IS NULL AND NEW.provider_receipt_body IS NOT NULL
     AND NEW.provider_receipt_sha256=signal_semantic_context_digest_v1(NEW.provider_receipt_body)
     AND EXISTS(SELECT 1 FROM signal_interest_decision_provider_inventories_v1 inventory
       WHERE inventory.id::text=signal_interest_decision_inventory_receipt_v1(NEW.provider_receipt_body)->>'reconciliation_id'
        AND inventory.owner_id=NEW.owner_id
        AND inventory.inventory_sha256=signal_interest_decision_inventory_receipt_v1(NEW.provider_receipt_body)->>'inventory_sha256')
   OR OLD.state='in_progress' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state='canceling' AND NEW.state IN('canceling','ended')
   OR OLD.state='ended' AND NEW.state='applied'))
 THEN RAISE EXCEPTION 'interest_decision_batch_transition_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

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
    OR OLD.status IN('in_flight','outcome_unknown') AND NEW.status='definitely_not_sent'
      AND NEW.error_code='provider_inventory_absent' AND b.state='rejected'
      AND b.provider_batch_id IS NULL AND b.provider_receipt_body IS NOT NULL
      AND b.provider_receipt_sha256=signal_semantic_context_digest_v1(b.provider_receipt_body)
      AND signal_interest_decision_inventory_receipt_v1(b.provider_receipt_body)->>'kind'='provider_inventory_absent'
      AND EXISTS(SELECT 1 FROM signal_interest_decision_provider_inventories_v1 inventory
        WHERE inventory.id::text=signal_interest_decision_inventory_receipt_v1(b.provider_receipt_body)->>'reconciliation_id'
         AND inventory.owner_id=b.owner_id
         AND inventory.inventory_sha256=signal_interest_decision_inventory_receipt_v1(b.provider_receipt_body)->>'inventory_sha256')
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


CREATE FUNCTION reconcile_absent_signal_interest_decision_batches_v1(
 target_owner uuid, raw_inventory text, raw_sha text, expected_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;inventory jsonb;
 provider_count integer;known_count integer;uncertain_count integer;eligible_count integer;
 call_count integer;latest_provider timestamptz;first_attempt timestamptz;last_attempt timestamptz;
 audit_id uuid;receipt text;batch_row record;candidate_ids uuid[];
BEGIN
 IF session_user<>'postgres' OR current_setting('transaction_isolation')<>'read committed'
  OR raw_inventory IS NULL OR octet_length(raw_inventory) NOT BETWEEN 1 AND 8388608
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_inventory)
  OR expected_count IS NULL OR expected_count<=0 THEN
  RAISE EXCEPTION 'interest_decision_inventory_authority_invalid' USING ERRCODE='42501';END IF;
 inventory:=raw_inventory::jsonb;
 IF inventory->'has_more' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(inventory->'data') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'interest_decision_inventory_incomplete' USING ERRCODE='23514';END IF;
 SELECT count(*)::integer,max((item->>'created_at')::timestamptz)
 INTO provider_count,latest_provider FROM jsonb_array_elements(inventory->'data') item;
 IF provider_count=0 OR provider_count>1000 OR latest_provider IS NULL
  OR latest_provider>clock_timestamp()
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(inventory->'data') item
    WHERE item->>'id' IS NULL OR item->>'id'!~'^msgbatch_[A-Za-z0-9_-]+$'
     OR item->>'created_at' IS NULL)
  OR (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(inventory->'data') item)<>provider_count THEN
  RAISE EXCEPTION 'interest_decision_inventory_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL OR o.provider_contract_version<>2 THEN
  RAISE EXCEPTION 'interest_decision_inventory_owner_invalid' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM signal_interest_decision_batches_v1 b WHERE b.owner_id=o.id
  AND b.state IN('submission_unknown','submitting') ORDER BY b.id FOR UPDATE;
 SELECT count(*)::integer,min(submitted_at),max(submitted_at) INTO uncertain_count,first_attempt,last_attempt
 FROM signal_interest_decision_batches_v1 b WHERE b.owner_id=o.id
  AND b.state IN('submission_unknown','submitting');
 SELECT array_agg(id ORDER BY id) INTO candidate_ids FROM signal_interest_decision_batches_v1 b
  WHERE b.owner_id=o.id AND b.state IN('submission_unknown','submitting');
 SELECT count(*)::integer INTO eligible_count FROM signal_interest_decision_batches_v1 b
 WHERE b.owner_id=o.id AND b.state IN('submission_unknown','submitting')
  AND b.provider_batch_id IS NULL AND b.provider_receipt_body IS NULL
  AND b.submitted_at IS NOT NULL AND (b.lease_expires_at IS NULL OR b.lease_expires_at<clock_timestamp());
 SELECT count(*)::integer INTO known_count FROM signal_interest_decision_batches_v1 b
 WHERE b.owner_id=o.id AND b.provider_batch_id IS NOT NULL;
 IF uncertain_count<>expected_count OR eligible_count<>uncertain_count
  OR known_count=0 OR latest_provider>=first_attempt
  OR clock_timestamp()<last_attempt+interval '10 minutes'
  OR EXISTS(SELECT 1 FROM signal_interest_decision_batches_v1 b
    WHERE b.owner_id=o.id AND b.provider_batch_id IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inventory->'data') item
       WHERE item->>'id'=b.provider_batch_id)) THEN
  RAISE EXCEPTION 'interest_decision_inventory_negative_proof_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_provider_inventories_v1(owner_id,inventory_sha256,raw_body,
  fetched_at,latest_provider_created_at,earliest_uncertain_submitted_at,
  latest_uncertain_submitted_at,provider_count,known_count,reconciled_count)
 VALUES(o.id,raw_sha,raw_inventory,clock_timestamp(),latest_provider,first_attempt,
  last_attempt,provider_count,known_count,uncertain_count) RETURNING id INTO audit_id;
 FOR batch_row IN SELECT id,submitted_at FROM signal_interest_decision_batches_v1
   WHERE owner_id=o.id AND state IN('submission_unknown','submitting') ORDER BY id LOOP
  receipt:=jsonb_build_object('kind','provider_inventory_absent','reconciliation_id',audit_id,
   'inventory_sha256',raw_sha,'batch_id',batch_row.id,'submitted_at',batch_row.submitted_at)::text;
  UPDATE signal_interest_decision_batches_v1 SET state='rejected',
   provider_receipt_body=receipt,
   provider_receipt_sha256=signal_semantic_context_digest_v1(receipt),
   lease_token=NULL,lease_expires_at=NULL,next_poll_at=NULL,
   last_error_code='provider_inventory_absent',ended_at=clock_timestamp()
   WHERE id=batch_row.id;
 END LOOP;
 UPDATE signal_interest_decision_calls_v1 call SET status='definitely_not_sent',
  error_code='provider_inventory_absent'
  WHERE call.batch_id=ANY(candidate_ids)
   AND call.status IN('in_flight','outcome_unknown');
 GET DIAGNOSTICS call_count=ROW_COUNT;
 IF call_count<>uncertain_count THEN
  RAISE EXCEPTION 'interest_decision_inventory_call_count_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('reconciliation_id',audit_id,'owner_id',o.id,
  'reconciled_count',uncertain_count,'known_provider_count',known_count,
  'inventory_sha256',raw_sha);
END $$;
REVOKE ALL ON signal_interest_decision_provider_inventories_v1 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION reconcile_absent_signal_interest_decision_batches_v1(uuid,text,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
