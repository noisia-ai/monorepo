-- Extend exact-source recovery to merge requests whose child aliases were
-- exhaustively mapped to current parent keys and revalidated by the Worker.
-- Reopen a blocked global stage after append-only, exact-source structural
-- corrections are persisted on the original request rows. The raw paid Batch
-- items and their invalid validation receipts remain immutable.
CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;
 run signal_topic_consolidation_runs%ROWTYPE;
 snapshot_count integer;snapshot_value text;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;
 retryable_count integer;corrected_count integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'completed_at') THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
  IF OLD.state='blocked' AND NEW.state='open' AND NEW.completed_at IS NULL THEN
   IF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stages_v2 successor
       WHERE successor.execution_id=OLD.execution_id AND successor.stage_id<>OLD.stage_id
         AND successor.state IN('open','complete','materialized'))
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 b
       WHERE b.stage_id=OLD.stage_id AND b.state<>'imported')
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 c
       WHERE c.stage_id=OLD.stage_id AND c.status NOT IN('settled','definitely_not_sent')) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
   WITH latest AS (SELECT DISTINCT ON(i.request_id) i.request_id,i.outcome,i.validation,b.state,c.status,
       (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=i.request_id) attempts
      FROM signal_topic_editorial_global_stage_batch_items_v2 i
      JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
      WHERE i.stage_id=OLD.stage_id ORDER BY i.request_id,b.created_at DESC)
    SELECT count(*) FILTER(WHERE l.outcome='succeeded' AND l.validation->>'status'='invalid_output'
      AND l.validation->>'code'='topic_editorial_global_shard_citation_invalid' AND l.state='imported'
      AND l.status='settled' AND l.attempts<5) INTO retryable_count
    FROM latest l;
   SELECT count(*) INTO corrected_count FROM signal_topic_editorial_global_stage_requests_v2 r
     WHERE r.stage_id=OLD.stage_id AND r.state='validated' AND r.validation->>'status'=CASE r.stage_kind WHEN 'shard' THEN 'accepted_shard' WHEN 'merge' THEN 'accepted_merge' ELSE 'accepted_rank' END
       AND EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
         JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
         JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
         WHERE i.request_id=r.id AND b.state='imported' AND c.status='settled'
           AND i.raw_text=r.raw_text AND i.raw_sha256=r.raw_sha256
           AND r.validation->'structural_repair'->>'source_call_id'=i.call_id::text
           AND r.validation->'structural_repair'->>'prior_validation_sha256'=i.validation_sha256);
   IF (retryable_count<1 AND corrected_count<1) OR EXISTS(
     SELECT 1 FROM signal_topic_editorial_global_stage_requests_v2 r
     WHERE r.stage_id=OLD.stage_id AND NOT (r.state='validated' AND r.validation->>'status'=CASE r.stage_kind WHEN 'shard' THEN 'accepted_shard' WHEN 'merge' THEN 'accepted_merge' ELSE 'accepted_rank' END
       AND EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 corrected
         JOIN signal_topic_editorial_global_stage_batches_v2 corrected_batch ON corrected_batch.id=corrected.batch_id
         JOIN signal_topic_editorial_global_stage_calls_v2 corrected_call ON corrected_call.id=corrected.call_id
         WHERE corrected.request_id=r.id AND corrected_batch.state='imported' AND corrected_call.status='settled'
           AND corrected.raw_text=r.raw_text AND corrected.raw_sha256=r.raw_sha256
           AND r.validation->'structural_repair'->>'source_call_id'=corrected.call_id::text
           AND r.validation->'structural_repair'->>'prior_validation_sha256'=corrected.validation_sha256))
       AND NOT EXISTS(
       SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
       JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
       JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
       WHERE i.request_id=r.id AND b.state='imported' AND c.status='settled'
         AND (i.validation->>'status'=CASE r.stage_kind WHEN 'shard' THEN 'accepted_shard'
             WHEN 'merge' THEN 'accepted_merge' ELSE 'accepted_rank' END
           OR (i.validation->>'status'='invalid_output'
             AND i.validation->>'code'='topic_editorial_global_shard_citation_invalid'
             AND (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts
               WHERE attempts.request_id=r.id)<5))
         AND b.created_at=(SELECT max(newest.created_at) FROM signal_topic_editorial_global_stage_batches_v2 newest
           JOIN signal_topic_editorial_global_stage_batch_items_v2 newest_item ON newest_item.batch_id=newest.id
           WHERE newest_item.request_id=r.id))) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF OLD.state NOT IN('open','complete') OR NEW.state NOT IN('blocked','complete','materialized')
   OR (NEW.state='blocked' AND OLD.state<>'open') OR (NEW.state='complete' AND OLD.state<>'open')
   OR (NEW.state='materialized' AND OLD.state NOT IN('open','complete'))
   OR (NEW.state='open')<>(NEW.completed_at IS NULL) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=e.numeric_run_id AND workspace_id=e.workspace_id;
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 SELECT count(DISTINCT request.receipts->'request'->'identity'->>'snapshot_digest'),
   min(request.receipts->'request'->'identity'->>'snapshot_digest')
   INTO snapshot_count,snapshot_value FROM signal_topic_editorial_requests request WHERE request.execution_id=e.id;
 IF e.id IS NULL OR run.id IS NULL OR owner_row.stage<>'review_pending'
  OR NEW.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR NEW.organization_id IS DISTINCT FROM e.organization_id OR NEW.expected_group_count IS DISTINCT FROM run.expected_group_count
  OR snapshot_count<>1 OR snapshot_value IS DISTINCT FROM NEW.snapshot_digest
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)<>NEW.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_source_mismatch' USING ERRCODE='23514';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 RETURN NEW;
END $$;

