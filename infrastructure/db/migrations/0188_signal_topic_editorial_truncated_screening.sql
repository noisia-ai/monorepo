-- A settled max_tokens response can contain complete, cited decisions before
-- its last incomplete JSON object. Preserve those decisions and explicitly
-- abstain for missing groups. This never changes the paid receipt or request.
CREATE FUNCTION signal_topic_editorial_truncated_output_v1(raw_response text,receipts jsonb,batch_index integer,max_tokens integer)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE response jsonb;content text;marker integer;relative integer;array_start integer;header jsonb;
 item jsonb;receipt jsonb;decisions jsonb:='[]'::jsonb;seen text[]:=ARRAY[]::text[];
 i integer;object_start integer:=0;depth integer:=0;in_string boolean:=false;escaped boolean:=false;
 symbol text;bad_citation boolean;
BEGIN
 IF raw_response IS NULL OR jsonb_typeof(receipts)<>'array' OR jsonb_array_length(receipts) NOT BETWEEN 1 AND 40
  OR max_tokens<>8192 OR batch_index<0 THEN RETURN NULL;END IF;
 response:=raw_response::jsonb;
 IF response->>'type'<>'message' OR response->>'role'<>'assistant' OR response->>'model'<>'claude-sonnet-4-6'
  OR response->>'stop_reason'<>'max_tokens' OR response->'usage'->>'output_tokens' IS DISTINCT FROM max_tokens::text
  OR jsonb_typeof(response->'content')<>'array' OR jsonb_array_length(response->'content')<>1
  OR response->'content'->0->>'type'<>'text' THEN RETURN NULL;END IF;
 content:=response->'content'->0->>'text';
 IF content IS NULL OR octet_length(content)>8388608 THEN RETURN NULL;END IF;
 marker:=strpos(content,'"decisions"');
 IF marker=0 THEN RETURN NULL;END IF;
 relative:=strpos(substr(content,marker),'[');
 IF relative=0 THEN RETURN NULL;END IF;
 array_start:=marker+relative-1;
 header:=(substr(content,1,array_start)||']}')::jsonb;
 IF header->>'contract_version'<>'signal-topic-editorial-screening-output-v1'
  OR header->>'batch_index' IS DISTINCT FROM batch_index::text
  OR header->'decisions' IS DISTINCT FROM '[]'::jsonb
  OR (SELECT count(*) FROM jsonb_object_keys(header))<>3 THEN RETURN NULL;END IF;
 FOR i IN array_start+1..length(content) LOOP
  symbol:=substr(content,i,1);
  IF in_string THEN
   IF escaped THEN escaped:=false;
   ELSIF ascii(symbol)=92 THEN escaped:=true;
   ELSIF symbol='"' THEN in_string:=false;END IF;
  ELSIF symbol='"' THEN in_string:=true;
  ELSIF symbol='{' THEN
   IF depth=0 THEN object_start:=i;END IF;
   depth:=depth+1;
  ELSIF symbol='}' THEN
   IF depth<1 THEN RETURN NULL;END IF;
   depth:=depth-1;
   IF depth=0 THEN
    item:=substr(content,object_start,i-object_start+1)::jsonb;
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'cited_ref_ids')<>'array'
     OR (SELECT count(*) FROM jsonb_object_keys(item))<>6 THEN RETURN NULL;END IF;
    SELECT value INTO receipt FROM jsonb_array_elements(receipts) WHERE value->>'group_key'=item->>'group_key';
    IF receipt IS NULL OR item->>'group_key'=ANY(seen) OR jsonb_typeof(receipt->'evidence_ref_ids')<>'array'
     THEN RETURN NULL;END IF;
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'cited_ref_ids') cited(ref_id)
      WHERE NOT (receipt->'evidence_ref_ids') ? cited.ref_id) INTO bad_citation;
    IF bad_citation OR (item->>'disposition' IN('topic','narrative') AND jsonb_array_length(item->'cited_ref_ids')=0) THEN
     item:=item||jsonb_build_object('disposition','unresolved','candidate',NULL,'confidence',NULL,
      'rationale','Evidencia citada no verificable; requiere revisión posterior.','cited_ref_ids','[]'::jsonb);
    END IF;
    decisions:=decisions||jsonb_build_array(item);seen:=array_append(seen,item->>'group_key');object_start:=0;
   END IF;
  ELSIF depth=0 AND symbol NOT IN(' ',E'\n',E'\r',E'\t',',') THEN RETURN NULL;
  END IF;
 END LOOP;
 IF jsonb_array_length(decisions)=0 OR jsonb_array_length(decisions)>=jsonb_array_length(receipts) THEN RETURN NULL;END IF;
 FOR receipt IN SELECT value FROM jsonb_array_elements(receipts) LOOP
  IF receipt->>'group_key' IS NULL THEN RETURN NULL;END IF;
  IF NOT ((receipt->>'group_key')=ANY(seen)) THEN
   decisions:=decisions||jsonb_build_array(jsonb_build_object('group_key',receipt->>'group_key',
    'disposition','unresolved','candidate',NULL,'confidence',NULL,
    'rationale','Respuesta truncada del proveedor; falta revisión editorial completa.','cited_ref_ids','[]'::jsonb));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('contract_version','signal-topic-editorial-screening-output-v1',
  'batch_index',batch_index,'decisions',decisions);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;$$;

-- Append one admitted derivation to the prior state guard. All other lease,
-- historical-output, paid-call, coverage and global checks remain unchanged.
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
  SELECT r.id,r.batch_index,r.receipts FROM signal_topic_editorial_requests r JOIN delta d USING(batch_index)
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

REVOKE ALL ON FUNCTION signal_topic_editorial_truncated_output_v1(text,jsonb,integer,integer) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_truncated_output_v1(text,jsonb,integer,integer) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
