-- A sealed retry keeps the original request in submitted state. The Batch
-- manifest may bind a new reserved call only when that call is a guarded retry.
CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_batch_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_batch_immutable' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'prepared' OR NEW.provider_batch_id IS NOT NULL OR NEW.provider_receipt_body IS NOT NULL
   OR NEW.manifest_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.manifest_body::jsonb)
   OR NEW.manifest_body::jsonb->>'stage_kind' IS DISTINCT FROM NEW.stage_kind
   OR jsonb_typeof(NEW.manifest_body::jsonb->'items') IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.manifest_body::jsonb->'items') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_manifest_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','rejection_http_status','lease_token',
   'lease_expires_at','next_poll_at','error_code','submitted_at','ended_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','rejection_http_status','lease_token',
   'lease_expires_at','next_poll_at','error_code','submitted_at','ended_at'])
   OR OLD.provider_batch_id IS NOT NULL AND NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
   OR OLD.provider_receipt_body IS NOT NULL AND ROW(NEW.provider_receipt_body,NEW.provider_receipt_sha256) IS DISTINCT FROM ROW(OLD.provider_receipt_body,OLD.provider_receipt_sha256)
   OR NEW.state<>OLD.state AND NOT(OLD.state='prepared' AND NEW.state='submitting'
      OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','ended','rejected')
      OR OLD.state='in_progress' AND NEW.state IN('in_progress','canceling','ended')
      OR OLD.state='canceling' AND NEW.state IN('canceling','ended')
      OR OLD.state='ended' AND NEW.state='imported') THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_batch_transition_invalid' USING ERRCODE='23514';END IF;
 IF NEW.provider_receipt_body IS NOT NULL AND NEW.provider_receipt_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.provider_receipt_body) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_provider_receipt_invalid' USING ERRCODE='23514';END IF;
 IF OLD.state='prepared' AND NEW.state='submitting' AND (
   jsonb_array_length(NEW.manifest_body::jsonb->'items')<>(SELECT count(*) FROM signal_topic_editorial_global_stage_batch_items_v2 i WHERE i.batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.manifest_body::jsonb->'items') AS entry(value)
     WHERE NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
       JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.id=i.request_id AND r.stage_id=i.stage_id
       WHERE i.batch_id=NEW.id AND i.custom_id=entry.value->>'custom_id' AND i.call_identity=entry.value->>'call_id'
        AND r.stage_identity=entry.value->>'stage_identity' AND r.request_digest=entry.value->>'request_digest'
        AND r.stage_kind=NEW.stage_kind AND (r.state='prepared' OR (r.state='submitted' AND EXISTS(
          SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 retry_call
          WHERE retry_call.id=i.call_id AND retry_call.request_id=i.request_id
            AND retry_call.retry_of_call_id IS NOT NULL AND retry_call.status='reserved')))))
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
     WHERE i.batch_id=NEW.id AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 c
       WHERE c.id=i.call_id AND c.request_id=i.request_id AND c.stage_id=i.stage_id AND c.status='reserved'))
 ) THEN RAISE EXCEPTION 'topic_editorial_global_stage_manifest_binding_invalid' USING ERRCODE='23514';END IF;
 IF NEW.state='submission_unknown' AND NEW.provider_batch_id IS NOT NULL
   OR NEW.state IN('in_progress','canceling','ended','imported') AND NEW.provider_batch_id IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_provider_identity_missing' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
