-- Retain the 0188 paid-response derivation while exposing the sealed
-- request configuration to its materialized requests CTE. No data or receipt
-- changes occur when installing this guard.
CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp SET jit=off AS $$
DECLARE body jsonb;prior jsonb;seen integer;invalid boolean;unpaid boolean;bad_coverage boolean;
BEGIN
 IF NEW.state_body IS NOT DISTINCT FROM OLD.state_body THEN RETURN NEW;END IF;
 IF OLD.status<>'running' OR OLD.execution_token IS NULL OR OLD.execution_expires_at<=clock_timestamp() OR NEW.state_body IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_state_lease_invalid' USING ERRCODE='23514';END IF;
 body:=NEW.state_body::jsonb;prior:=OLD.state_body::jsonb;
 IF body->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-runner-v1' OR body->>'execution_key' IS DISTINCT FROM NEW.id::text
  OR body->>'plan_digest' IS DISTINCT FROM NEW.plan_digest OR NOT COALESCE(body->>'phase' IN('screening','global','completed'),false)
  OR jsonb_typeof(body->'screening_outputs') IS DISTINCT FROM 'array'
  OR prior->'global' IS DISTINCT FROM 'null'::jsonb AND prior->'global' IS NOT NULL AND body->'global' IS DISTINCT FROM prior->'global' THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 WITH outputs AS MATERIALIZED (
  SELECT value AS output,(value->>'batch_index')::integer AS batch_index FROM jsonb_array_elements(body->'screening_outputs')
 ), previous AS MATERIALIZED (
  SELECT value AS output,(value->>'batch_index')::integer AS batch_index
   FROM jsonb_array_elements(COALESCE(prior->'screening_outputs','[]'::jsonb))
 ), delta AS MATERIALIZED (
  SELECT o.*,signal_topic_editorial_normalize_output_v1(o.output) AS normalized FROM outputs o
   LEFT JOIN previous p USING(batch_index) WHERE p.batch_index IS NULL
 ), requests AS MATERIALIZED (
  SELECT r.id,r.batch_index,r.receipts,r.configuration FROM signal_topic_editorial_requests r JOIN delta d USING(batch_index)
   WHERE r.execution_id=NEW.id AND r.workspace_id=NEW.workspace_id AND r.phase='screening' AND r.parent_request_id IS NULL
 ), paid_lineage AS MATERIALIZED (
  SELECT id AS request_id,id AS original_id FROM requests
  UNION ALL
  SELECT child.id,parent.id FROM requests parent JOIN signal_topic_editorial_requests child ON child.parent_request_id=parent.id
   WHERE child.execution_id=NEW.id AND child.workspace_id=NEW.workspace_id AND child.phase='screening'
 ), paid AS MATERIALIZED (
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(c.response_output) AS normalized
   FROM requests r JOIN paid_lineage lineage ON lineage.original_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=lineage.request_id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
  UNION ALL
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(
    signal_topic_editorial_quarantine_citations_v1(c.response_output,r.receipts)) AS normalized
   FROM requests r JOIN signal_topic_editorial_requests child ON child.parent_request_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=child.id
   WHERE child.execution_id=NEW.id AND child.workspace_id=NEW.workspace_id AND child.phase='screening'
    AND c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_quarantine_citations_v1(c.response_output,r.receipts) IS NOT NULL
  UNION ALL
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(
    signal_topic_editorial_quarantine_citations_v1(c.response_output,r.receipts)) AS normalized
   FROM requests r JOIN signal_topic_editorial_calls c ON c.request_id=r.id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_quarantine_citations_v1(c.response_output,r.receipts) IS NOT NULL
    AND EXISTS(SELECT 1 FROM signal_topic_editorial_requests child
      JOIN signal_topic_editorial_calls repaired ON repaired.request_id=child.id
      WHERE child.parent_request_id=r.id AND child.execution_id=NEW.id AND child.workspace_id=NEW.workspace_id
       AND child.phase='screening' AND repaired.execution_id=NEW.id AND repaired.workspace_id=NEW.workspace_id
       AND repaired.status='settled' AND repaired.response_http_status=200 AND repaired.response_complete=true)
  UNION ALL
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(
    signal_topic_editorial_truncated_output_v1(c.response_body_private,r.receipts,r.batch_index,
      (r.configuration->>'max_output_tokens')::integer)) AS normalized
   FROM requests r JOIN signal_topic_editorial_calls c ON c.request_id=r.id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true AND c.response_output IS NULL
    AND signal_topic_editorial_truncated_output_v1(c.response_body_private,r.receipts,r.batch_index,
      (r.configuration->>'max_output_tokens')::integer) IS NOT NULL
 ), decision_keys AS MATERIALIZED (
  SELECT d.batch_index,array_agg(item.value->>'group_key' ORDER BY item.value->>'group_key' COLLATE "C") AS keys
   FROM delta d CROSS JOIN LATERAL jsonb_array_elements(d.output->'decisions') item GROUP BY d.batch_index
 ), expected_keys AS MATERIALIZED (
  SELECT r.batch_index,array_agg(item.value->>'group_key' ORDER BY item.value->>'group_key' COLLATE "C") AS keys
   FROM requests r CROSS JOIN LATERAL jsonb_array_elements(r.receipts) item GROUP BY r.batch_index
 )
 SELECT (SELECT count(*) FROM outputs),
  EXISTS(SELECT 1 FROM outputs GROUP BY batch_index HAVING batch_index IS NULL OR count(*)<>1)
  OR EXISTS(SELECT 1 FROM previous p LEFT JOIN outputs o USING(batch_index) WHERE o.batch_index IS NULL
    OR NOT (o.output @> p.output) OR o.output IS DISTINCT FROM p.output AND signal_topic_editorial_normalize_output_v1(o.output) IS DISTINCT FROM signal_topic_editorial_normalize_output_v1(p.output)),
  EXISTS(SELECT 1 FROM delta d WHERE NOT EXISTS(SELECT 1 FROM paid p WHERE p.batch_index=d.batch_index AND p.normalized=d.normalized)),
  EXISTS(SELECT 1 FROM delta d LEFT JOIN decision_keys actual USING(batch_index) LEFT JOIN expected_keys expected USING(batch_index)
    WHERE actual.keys IS DISTINCT FROM expected.keys)
 INTO seen,invalid,unpaid,bad_coverage;
 IF invalid THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 IF unpaid THEN RAISE EXCEPTION 'topic_editorial_state_unpaid' USING ERRCODE='23514';END IF;
 IF bad_coverage THEN RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 IF body->>'phase' IN('global','completed') AND seen<>jsonb_array_length(NEW.plan->'batches')
  OR body->>'phase'='screening' AND seen>=jsonb_array_length(NEW.plan->'batches') THEN
  RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 IF body->>'phase'='completed' THEN
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_requests q JOIN signal_topic_editorial_requests paid ON paid.id=q.id OR paid.parent_request_id=q.id
   JOIN signal_topic_editorial_calls c ON c.request_id=paid.id
   WHERE q.execution_id=NEW.id AND q.workspace_id=NEW.workspace_id AND q.phase='global' AND q.parent_request_id IS NULL
    AND paid.execution_id=NEW.id AND paid.workspace_id=NEW.workspace_id AND c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id
    AND q.request_digest=body->'global'->>'request_digest' AND c.status='settled' AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_normalize_output_v1(c.response_output)=signal_topic_editorial_normalize_output_v1(body->'global'->'result')) THEN
   RAISE EXCEPTION 'topic_editorial_global_unpaid' USING ERRCODE='23514';END IF;
 ELSE IF body->'global' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;END IF;
 RETURN NEW;
END;$$;
