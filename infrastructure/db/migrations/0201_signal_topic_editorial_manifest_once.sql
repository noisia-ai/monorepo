-- The prepare function builds the provider manifest from sealed requests. The
-- row guard still binds each reserved call, request, batch and custom ID, but
-- no longer parses the full manifest for every item. Before any paid HTTP can
-- occur, the prepared -> submitting transition compares the complete ordered
-- set of batch items to the immutable manifest in one transaction. Direct SQL
-- cannot submit a mismatched manifest; old receipts and provider batches remain.
CREATE OR REPLACE FUNCTION signal_topic_editorial_batch_history_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE expected jsonb;previous_body jsonb;next_body jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;
 IF TG_TABLE_NAME='signal_topic_editorial_batch_owners_v2' THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'stage') IS DISTINCT FROM (to_jsonb(OLD)-'stage') THEN
   RAISE EXCEPTION 'topic_editorial_v2_manifest_immutable' USING ERRCODE='23514';END IF;
  IF TG_OP='INSERT' AND NEW.stage<>'screening' THEN RAISE EXCEPTION 'topic_editorial_v2_owner_invalid' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='signal_topic_editorial_provider_batches_v2' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.state<>'prepared' OR NEW.provider_batch_id IS NOT NULL OR NEW.provider_receipt_body IS NOT NULL OR NEW.lease_token IS NOT NULL
    OR NEW.manifest_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.manifest_body) THEN
    RAISE EXCEPTION 'topic_editorial_v2_manifest_invalid' USING ERRCODE='23514';END IF;
   expected:=NEW.manifest_body::jsonb;
   IF jsonb_typeof(expected->'requests') IS DISTINCT FROM 'array' OR jsonb_array_length(expected->'requests')=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected->'requests') item WHERE NOT EXISTS(
     SELECT 1 FROM signal_topic_editorial_requests r WHERE r.execution_id=NEW.execution_id AND r.receipts->'request'->'provider_request'=item.value))
    OR (SELECT count(DISTINCT value->>'custom_id') FROM jsonb_array_elements(expected->'requests'))<>jsonb_array_length(expected->'requests') THEN
    RAISE EXCEPTION 'topic_editorial_v2_manifest_invalid' USING ERRCODE='23514';END IF;
  ELSE
   previous_body:=to_jsonb(OLD)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','next_poll_at','lease_token','lease_expires_at','submitted_at','ended_at','rejection_http_status','error_code'];
   next_body:=to_jsonb(NEW)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','next_poll_at','lease_token','lease_expires_at','submitted_at','ended_at','rejection_http_status','error_code'];
   IF previous_body IS DISTINCT FROM next_body OR OLD.provider_batch_id IS NOT NULL AND NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
    OR OLD.provider_receipt_body IS NOT NULL AND ROW(NEW.provider_receipt_body,NEW.provider_receipt_sha256) IS DISTINCT FROM ROW(OLD.provider_receipt_body,OLD.provider_receipt_sha256)
    OR OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'topic_editorial_v2_manifest_immutable' USING ERRCODE='23514';END IF;
   IF OLD.state='prepared' AND NEW.state='submitting' THEN
    SELECT jsonb_build_object('requests',jsonb_agg(r.receipts->'request'->'provider_request' ORDER BY r.batch_index)) INTO expected
     FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_requests r ON r.id=i.request_id
     WHERE i.batch_id=NEW.id;
    IF expected IS DISTINCT FROM NEW.manifest_body::jsonb THEN
     RAISE EXCEPTION 'topic_editorial_v2_item_manifest_mismatch' USING ERRCODE='23514';END IF;
   END IF;
   IF NEW.state<>OLD.state AND NOT(OLD.state='prepared' AND NEW.state='submitting'
    OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','canceling','ended','rejected')
    OR OLD.state='submission_unknown' AND NEW.state IN('in_progress','canceling','ended')
    OR OLD.state='in_progress' AND NEW.state IN('canceling','ended') OR OLD.state='canceling' AND NEW.state='ended'
    OR OLD.state='ended' AND NEW.state='applied') THEN RAISE EXCEPTION 'topic_editorial_v2_batch_transition_invalid' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='signal_topic_editorial_batch_items_v2' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.outcome IS NOT NULL OR NEW.validation IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM signal_topic_editorial_calls c JOIN signal_topic_editorial_requests r ON r.id=c.request_id
    JOIN signal_topic_editorial_provider_batches_v2 b ON b.execution_id=c.execution_id
    WHERE c.id=NEW.call_id AND c.request_id=NEW.request_id AND c.transport_version=2 AND c.status='reserved' AND b.id=NEW.batch_id
     AND b.state='prepared' AND r.receipts->'request'->'provider_request'->>'custom_id'=NEW.custom_id
     ) THEN
    RAISE EXCEPTION 'topic_editorial_v2_item_binding_invalid' USING ERRCODE='23514';END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['outcome','validation','validation_body','validation_sha256','received_at','validated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['outcome','validation','validation_body','validation_sha256','received_at','validated_at'])
    OR OLD.outcome IS NOT NULL AND ROW(NEW.outcome,NEW.received_at) IS DISTINCT FROM ROW(OLD.outcome,OLD.received_at)
    OR OLD.validation IS NOT NULL AND ROW(NEW.validation,NEW.validation_body,NEW.validation_sha256,NEW.validated_at) IS DISTINCT FROM
     ROW(OLD.validation,OLD.validation_body,OLD.validation_sha256,OLD.validated_at) THEN
    RAISE EXCEPTION 'topic_editorial_v2_item_immutable' USING ERRCODE='23514';END IF;
   IF NEW.outcome IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.id=NEW.call_id
    AND c.status IN('settled','outcome_unknown') AND
    (NEW.outcome='submission_rejected' AND EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 b WHERE b.id=NEW.batch_id
      AND b.state='rejected' AND b.provider_receipt_body=c.response_body_private AND c.settled_micro_usd=0)
     OR NEW.outcome<>'submission_rejected' AND c.response_body_private::jsonb->'result'->>'type'=NEW.outcome)) THEN
    RAISE EXCEPTION 'topic_editorial_v2_item_receipt_missing' USING ERRCODE='23514';END IF;
   IF NEW.validation IS NOT NULL AND (NEW.validation_body::jsonb IS DISTINCT FROM NEW.validation
    OR NEW.validation_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.validation_body)) THEN
    RAISE EXCEPTION 'topic_editorial_v2_validation_invalid' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
