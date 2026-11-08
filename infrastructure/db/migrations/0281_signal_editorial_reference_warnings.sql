-- References are diagnostics. Identity, receipt provenance and sample membership remain mandatory.
CREATE FUNCTION signal_topic_editorial_reference_warnings_v2(refs jsonb,maximum integer,required boolean)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE warnings jsonb:='[]'::jsonb;
BEGIN
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR maximum IS NULL OR maximum<0 THEN RETURN NULL; END IF;
 IF required AND jsonb_array_length(refs)=0 THEN warnings:=warnings||jsonb_build_array('references_missing'); END IF;
 IF jsonb_array_length(refs)>maximum THEN warnings:=warnings||jsonb_build_array('references_excess'); END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs))<>jsonb_array_length(refs) THEN
  warnings:=warnings||jsonb_build_array('references_repeated'); END IF;
 RETURN warnings;
END $$;

CREATE OR REPLACE FUNCTION validate_signal_topic_editorial_batch_item_v2(target_batch uuid,target_token uuid,target_custom text,body text,body_sha text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;i signal_topic_editorial_batch_items_v2%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;
 c signal_topic_editorial_calls%ROWTYPE;v jsonb;output jsonb;request jsonb;receipt jsonb;expected jsonb;candidate jsonb;refs jsonb;aliases text[];
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_topic_editorial_batch_lease_v2(b.id,target_token);
 SELECT * INTO i FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id AND custom_id=target_custom FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=i.request_id;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=i.call_id;
 v:=body::jsonb;
 IF i.call_id IS NULL OR i.outcome IS NULL OR body_sha IS DISTINCT FROM signal_semantic_context_digest_v1(body)
  OR NOT COALESCE(v->>'status' IN('accepted','refusal','max_tokens','invalid_output','invalid_message'),false) THEN
  RAISE EXCEPTION 'topic_editorial_v2_validation_invalid' USING ERRCODE='23514';END IF;
 IF i.validation IS NOT NULL THEN
  IF i.validation_body IS DISTINCT FROM body THEN RAISE EXCEPTION 'topic_editorial_v2_validation_immutable' USING ERRCODE='23514';END IF;
  RETURN '{"replayed":true}'::jsonb;
 END IF;
 IF v->>'status'='accepted' THEN
  request:=r.receipts->'request';receipt:=request->'receipt';output:=signal_topic_editorial_protocol_output_v2(c.response_output,receipt);
  IF jsonb_typeof(output)='object' AND NOT output ? 'cited_evidence_ids' THEN
   output:=output||jsonb_build_object('cited_evidence_ids','[]'::jsonb); END IF;
  IF i.outcome<>'succeeded' OR c.response_body_private::jsonb->'result'->'message'->>'stop_reason' IS DISTINCT FROM 'end_turn'
   OR output->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-group-output-v2'
   OR output->>'group_id' IS DISTINCT FROM receipt->>'group_id' OR NOT COALESCE(output->>'disposition' IN('topic','narrative','noise','unresolved'),false)
   OR jsonb_typeof(output->'cited_evidence_ids') IS DISTINCT FROM 'array'
   OR jsonb_typeof(output->'rationale') IS DISTINCT FROM 'string' OR btrim(output->>'rationale')=''
   OR NOT COALESCE(jsonb_typeof(output->'confidence') IN('number','null'),false) OR jsonb_typeof(output->'confidence')='number' AND
    ((output->>'confidence')::numeric<0 OR (output->>'confidence')::numeric>1) THEN
   RAISE EXCEPTION 'topic_editorial_v2_decision_invalid' USING ERRCODE='23514';END IF;
  SELECT array_agg(value ORDER BY ordinal) INTO aliases FROM jsonb_array_elements_text(output->'cited_evidence_ids') WITH ORDINALITY x(value,ordinal);
  IF EXISTS(SELECT 1 FROM unnest(aliases) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'evidence') e WHERE e.value->>'evidence_id'=x))
   OR output->>'disposition'<>'unresolved' AND jsonb_array_length(receipt->'evidence')=0 THEN
   RAISE EXCEPTION 'topic_editorial_v2_citation_invalid' USING ERRCODE='23514';END IF;
  SELECT COALESCE(jsonb_agg(e.value->>'ref_id' ORDER BY x.ordinal),'[]'::jsonb) INTO refs
   FROM unnest(aliases) WITH ORDINALITY x(value,ordinal) JOIN LATERAL jsonb_array_elements(receipt->'evidence') e ON e.value->>'evidence_id'=x.value;
  IF output->>'disposition' IN('topic','narrative') THEN
   candidate:=output->'candidate';
   IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR candidate->>'locale' IS DISTINCT FROM receipt->>'expected_locale'
    OR jsonb_typeof(candidate->'label') IS DISTINCT FROM 'string' OR btrim(candidate->>'label')=''
    OR jsonb_typeof(candidate->'definition') IS DISTINCT FROM 'string' OR btrim(candidate->>'definition')='' THEN
    RAISE EXCEPTION 'topic_editorial_v2_candidate_invalid' USING ERRCODE='23514';END IF;
   candidate:=candidate||jsonb_build_object('candidate_key',output->>'disposition'||'-v2-'||substr(r.request_digest,8,24));
  ELSE
   IF output->'candidate' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'topic_editorial_v2_candidate_invalid' USING ERRCODE='23514';END IF;
   candidate:='null'::jsonb;
  END IF;
  expected:=jsonb_build_object('contract_version','signal-topic-editorial-group-decision-v2','identity',request->'identity',
   'request_digest',r.request_digest,'group_key',receipt->>'group_key','group_digest',receipt->>'group_digest','dossier_digest',receipt->>'dossier_digest',
   'evidence_scope','cited_evidence_only','disposition',output->>'disposition','candidate',candidate,'confidence',output->'confidence',
   'rationale',output->>'rationale','cited_ref_ids',refs);
  IF jsonb_array_length(signal_topic_editorial_reference_warnings_v2(refs,jsonb_array_length(receipt->'evidence'),output->>'disposition'<>'unresolved'))>0 THEN
   expected:=expected||jsonb_build_object('warnings',signal_topic_editorial_reference_warnings_v2(refs,jsonb_array_length(receipt->'evidence'),output->>'disposition'<>'unresolved'));
  END IF;
  IF v IS DISTINCT FROM jsonb_build_object('status','accepted','decision',expected) THEN
   RAISE EXCEPTION 'topic_editorial_v2_validation_source_mismatch' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT COALESCE(v->>'code'~'^topic_editorial_v2_[a-z_]+$',false) THEN RAISE EXCEPTION 'topic_editorial_v2_validation_code_invalid' USING ERRCODE='23514';END IF;
 END IF;
 UPDATE signal_topic_editorial_batch_items_v2 SET validation=v,validation_body=body,validation_sha256=body_sha,validated_at=clock_timestamp() WHERE call_id=i.call_id;
 RETURN '{"replayed":false}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_reuse_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE target signal_topic_editorial_requests%ROWTYPE;owner signal_topic_editorial_batch_owners_v2%ROWTYPE;
 source_owner signal_topic_editorial_executions%ROWTYPE;source_call signal_topic_editorial_calls%ROWTYPE;source_request signal_topic_editorial_requests%ROWTYPE;
 original_request signal_topic_editorial_requests%ROWTYPE;source_batch jsonb;source_group jsonb;output jsonb;historical jsonb;candidate jsonb;expected jsonb;receipt jsonb;request jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;
 SELECT * INTO target FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.execution_id;
 SELECT * INTO source_call FROM signal_topic_editorial_calls WHERE id=NEW.source_call_id;
 SELECT * INTO source_owner FROM signal_topic_editorial_executions WHERE id=source_call.execution_id;
 SELECT * INTO source_request FROM signal_topic_editorial_requests WHERE id=source_call.request_id;
 SELECT * INTO original_request FROM signal_topic_editorial_requests WHERE id=COALESCE(source_request.parent_request_id,source_request.id);
 request:=target.receipts->'request';receipt:=request->'receipt';
 IF target.id IS NULL OR target.execution_id IS DISTINCT FROM owner.execution_id OR source_call.id IS NULL
  OR source_call.transport_version<>1 OR source_call.status<>'settled' OR source_call.response_http_status IS DISTINCT FROM 200
  OR source_call.response_complete IS DISTINCT FROM true OR source_call.response_body_private IS NULL
  OR source_call.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(source_call.response_body_private)
  OR owner.previous_execution_id IS DISTINCT FROM source_owner.id OR source_owner.workspace_id IS DISTINCT FROM target.workspace_id
  OR source_owner.numeric_run_id::text IS DISTINCT FROM request->'identity'->>'run_id'
  OR source_owner.plan->>'source_context_digest' IS DISTINCT FROM request->'identity'->>'source_context_digest'
  OR source_owner.plan->>'editorial_context_digest' IS DISTINCT FROM request->'identity'->>'editorial_context_digest'
  OR NEW.lineage->>'source_call_id' IS DISTINCT FROM source_call.id::text
  OR NEW.lineage->>'source_execution_id' IS DISTINCT FROM source_owner.id::text
  OR NEW.lineage->>'source_request_digest' IS DISTINCT FROM source_request.request_digest
  OR NEW.lineage->>'source_batch_request_digest' IS DISTINCT FROM original_request.request_digest
  OR NEW.lineage->>'source_raw_sha256' IS DISTINCT FROM source_call.response_sha256
  OR NEW.source_checkpoint_digest IS DISTINCT FROM NEW.lineage->>'source_checkpoint_digest'
  OR NEW.body_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.body)
  OR NEW.body::jsonb->'decision' IS DISTINCT FROM NEW.decision OR NEW.body::jsonb->'lineage' IS DISTINCT FROM NEW.lineage
  OR NEW.body::jsonb->>'status' IS DISTINCT FROM 'reusable'
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE request_id=target.id) THEN
  RAISE EXCEPTION 'topic_editorial_v2_reuse_source_invalid' USING ERRCODE='23514';END IF;
 SELECT value INTO source_batch FROM jsonb_array_elements(source_owner.plan->'batches') WHERE value->>'request_digest'=original_request.request_digest;
 SELECT value INTO source_group FROM jsonb_array_elements((source_batch->>'source_groups_body')::jsonb) WHERE value->>'group_key'=receipt->>'group_key';
 IF source_batch IS NULL OR original_request.phase<>'screening' OR source_group IS DISTINCT FROM request->'source_group'
  OR original_request.execution_id IS DISTINCT FROM source_owner.id OR source_request.execution_id IS DISTINCT FROM source_owner.id THEN
  RAISE EXCEPTION 'topic_editorial_v2_reuse_group_changed' USING ERRCODE='23514';END IF;
 IF NEW.lineage->>'source_kind'='historical_checkpoint' THEN
  IF NEW.source_checkpoint_digest IS NULL OR NEW.source_checkpoint_digest IS DISTINCT FROM source_owner.state_digest
   OR source_owner.state_body IS NULL OR source_owner.state_body::jsonb->>'execution_key' IS DISTINCT FROM source_owner.id::text
   OR source_owner.state_body::jsonb->>'plan_digest' IS DISTINCT FROM source_owner.plan_digest THEN
   RAISE EXCEPTION 'topic_editorial_v2_reuse_checkpoint_invalid' USING ERRCODE='23514';END IF;
  SELECT value INTO output FROM jsonb_array_elements(source_owner.state_body::jsonb->'screening_outputs')
   WHERE value->>'batch_index'=original_request.batch_index::text;
  -- Revalidate the existing checkpoint's accepted lineage with the unchanged
  -- historical derivations. No new checkpoint or reconstructed decision is stored.
  IF NOT EXISTS(SELECT 1 FROM (
   SELECT signal_topic_editorial_normalize_output_v1(source_call.response_output) normalized
   UNION ALL SELECT signal_topic_editorial_normalize_output_v1(signal_topic_editorial_reference_output_v1(source_call.response_output,original_request.receipts))
   UNION ALL SELECT signal_topic_editorial_normalize_output_v1(signal_topic_editorial_quarantine_citations_v1(source_call.response_output,original_request.receipts))
    WHERE source_request.parent_request_id IS NOT NULL OR EXISTS(SELECT 1 FROM signal_topic_editorial_requests child JOIN signal_topic_editorial_calls repaired ON repaired.request_id=child.id
     WHERE child.parent_request_id=original_request.id AND child.execution_id=source_owner.id AND repaired.status='settled' AND repaired.response_http_status=200 AND repaired.response_complete=true)
   UNION ALL SELECT signal_topic_editorial_normalize_output_v1(signal_topic_editorial_truncated_output_v1(source_call.response_body_private,original_request.receipts,original_request.batch_index,
    (original_request.configuration->>'max_output_tokens')::integer)) WHERE source_request.parent_request_id IS NULL AND source_call.response_output IS NULL
   UNION ALL SELECT signal_topic_editorial_normalize_output_v1(signal_topic_editorial_paid_missing_output_v1(source_call.response_output,original_request.receipts,original_request.batch_index))
    WHERE source_request.parent_request_id IS NOT NULL
  ) paid WHERE paid.normalized IS NOT NULL AND paid.normalized=signal_topic_editorial_normalize_output_v1(output)) THEN
   RAISE EXCEPTION 'topic_editorial_v2_reuse_checkpoint_call_mismatch' USING ERRCODE='23514';END IF;
 ELSIF NEW.lineage->>'source_kind'='raw_response' THEN
  IF NEW.source_checkpoint_digest IS NOT NULL OR source_call.response_body_private::jsonb->>'stop_reason' IS DISTINCT FROM 'end_turn'
   OR jsonb_array_length(source_call.response_body_private::jsonb->'content')<>1 THEN
   RAISE EXCEPTION 'topic_editorial_v2_reuse_raw_invalid' USING ERRCODE='23514';END IF;
  output:=(source_call.response_body_private::jsonb->'content'->0->>'text')::jsonb;
  IF output IS DISTINCT FROM source_call.response_output THEN RAISE EXCEPTION 'topic_editorial_v2_reuse_raw_invalid' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'topic_editorial_v2_reuse_kind_invalid' USING ERRCODE='23514';END IF;
 SELECT value INTO historical FROM jsonb_array_elements(output->'decisions') WHERE value->>'group_key'=receipt->>'group_key';
 IF historical IS NULL OR historical IS DISTINCT FROM (NEW.body::jsonb->>'source_decision_body')::jsonb
  OR signal_semantic_context_digest_v1(NEW.body::jsonb->>'source_decision_body') IS DISTINCT FROM NEW.lineage->>'source_decision_digest'
  OR NOT COALESCE(historical->>'disposition' IN('topic','narrative','noise'),false)
  OR NOT COALESCE(jsonb_typeof(historical->'confidence') IN('number','null'),false)
  OR jsonb_typeof(historical->'confidence')='number' AND ((historical->>'confidence')::numeric<0 OR (historical->>'confidence')::numeric>1)
  OR jsonb_typeof(historical->'rationale') IS DISTINCT FROM 'string'
  OR btrim(historical->>'rationale')='' OR jsonb_typeof(COALESCE(historical->'cited_ref_ids','[]'::jsonb)) IS DISTINCT FROM 'array'
  OR jsonb_array_length(receipt->'evidence')=0
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(historical->'cited_ref_ids','[]'::jsonb)) ref WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(receipt->'evidence') evidence WHERE evidence->>'ref_id'=ref)) THEN
  RAISE EXCEPTION 'topic_editorial_v2_reuse_decision_invalid' USING ERRCODE='23514';END IF;
 historical:=historical||jsonb_build_object('cited_ref_ids',COALESCE(historical->'cited_ref_ids','[]'::jsonb));
 candidate:=historical->'candidate';
 IF historical->>'disposition' IN('topic','narrative') THEN
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR candidate->>'locale' IS DISTINCT FROM receipt->>'expected_locale'
   OR jsonb_typeof(candidate->'label') IS DISTINCT FROM 'string' OR btrim(candidate->>'label')=''
   OR jsonb_typeof(candidate->'definition') IS DISTINCT FROM 'string' OR btrim(candidate->>'definition')='' THEN
   RAISE EXCEPTION 'topic_editorial_v2_reuse_candidate_invalid' USING ERRCODE='23514';END IF;
  candidate:=candidate||jsonb_build_object('candidate_key',historical->>'disposition'||'-v2-'||substr(target.request_digest,8,24));
 ELSE
  IF candidate IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'topic_editorial_v2_reuse_candidate_invalid' USING ERRCODE='23514';END IF;
 END IF;
 expected:=jsonb_build_object('contract_version','signal-topic-editorial-group-decision-v2','identity',request->'identity',
  'request_digest',target.request_digest,'group_key',receipt->>'group_key','group_digest',receipt->>'group_digest','dossier_digest',receipt->>'dossier_digest',
  'evidence_scope','cited_evidence_only','disposition',historical->>'disposition','candidate',candidate,'confidence',historical->'confidence',
  'rationale',historical->>'rationale','cited_ref_ids',historical->'cited_ref_ids');
 IF jsonb_array_length(signal_topic_editorial_reference_warnings_v2(historical->'cited_ref_ids',jsonb_array_length(receipt->'evidence'),true))>0 THEN
  expected:=expected||jsonb_build_object('warnings',signal_topic_editorial_reference_warnings_v2(historical->'cited_ref_ids',jsonb_array_length(receipt->'evidence'),true));
 END IF;
 IF expected IS DISTINCT FROM NEW.decision THEN RAISE EXCEPTION 'topic_editorial_v2_reuse_decision_changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_catalog_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_topic_editorial_global_stages_v2%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['revision_id','materialized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision_id','materialized_at'])
   OR OLD.revision_id IS NOT NULL AND ROW(NEW.revision_id,NEW.materialized_at) IS DISTINCT FROM ROW(OLD.revision_id,OLD.materialized_at)
   OR (NEW.revision_id IS NULL)<>(NEW.materialized_at IS NULL) THEN
   RAISE EXCEPTION 'topic_editorial_global_catalog_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_catalog_retained' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=s.execution_id;
 IF s.stage_id IS NULL OR jsonb_typeof(NEW.catalog_body) IS DISTINCT FROM 'object'
  OR NEW.catalog_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.catalog_body)
  OR jsonb_array_length(NEW.group_evidence)<>s.expected_group_count
  OR (SELECT count(DISTINCT item->>'group_key') FROM jsonb_array_elements(NEW.group_evidence) item)<>s.expected_group_count
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.group_evidence) AS entry(value)
    WHERE entry.value->>'status' IS NULL OR entry.value->>'status' NOT IN('topic','narrative','noise','insufficient_evidence')
      OR jsonb_typeof(entry.value->'cited_ref_ids') IS DISTINCT FROM 'array'
      OR entry.value->>'status' IN('topic','narrative','noise') AND NOT EXISTS(
        SELECT 1 FROM signal_topic_editorial_requests r WHERE r.execution_id=e.id
         AND r.receipts#>>'{request,receipt,group_key}'=entry.value->>'group_key'
         AND jsonb_array_length(r.receipts#>'{request,source_group,evidence}')>0)
      OR entry.value->'warnings' IS DISTINCT FROM (SELECT CASE WHEN jsonb_array_length(w.warnings)>0 THEN w.warnings ELSE NULL END
        FROM (SELECT signal_topic_editorial_reference_warnings_v2(entry.value->'cited_ref_ids',
          COALESCE((SELECT jsonb_array_length(r.receipts#>'{request,source_group,evidence}') FROM signal_topic_editorial_requests r
            WHERE r.execution_id=e.id AND r.receipts#>>'{request,receipt,group_key}'=entry.value->>'group_key'),0),
          entry.value->>'status' IN('topic','narrative','noise')) warnings) w)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(entry.value->'cited_ref_ids') cited(ref_id)
        WHERE NOT EXISTS(SELECT 1 FROM signal_topic_atomic_groups g
          JOIN signal_topic_atomic_group_evidence evidence ON evidence.atomic_group_id=g.id
            AND evidence.consolidation_run_id=g.consolidation_run_id AND evidence.workspace_id=g.workspace_id
          WHERE g.consolidation_run_id=e.numeric_run_id AND g.group_key=entry.value->>'group_key'
            AND evidence.ref_id=cited.ref_id)
          OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_requests r,
            LATERAL jsonb_array_elements(r.receipts#>'{request,source_group,evidence}') evidence
            WHERE r.execution_id=e.id AND r.receipts#>>'{request,receipt,group_key}'=entry.value->>'group_key'
              AND evidence->>'ref_id'=cited.ref_id)))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.group_evidence) AS entry(value) WHERE NOT EXISTS(
     SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=e.numeric_run_id AND g.group_key=entry.value->>'group_key'))
  OR (SELECT count(*) FROM signal_topic_atomic_groups WHERE consolidation_run_id=e.numeric_run_id)<>s.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_catalog_coverage_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION signal_topic_editorial_reference_warnings_v2(jsonb,integer,boolean) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_reference_warnings_v2(jsonb,integer,boolean) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;


-- Deterministic application-side diagnostics are reconstructed from paid V1 output.
-- Historical canonicalizers and raw provider bytes retain their original contracts.
CREATE FUNCTION signal_topic_editorial_reference_output_v1(output jsonb,receipts jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE item jsonb;receipt jsonb;refs jsonb;warnings jsonb;decisions jsonb:='[]'::jsonb;required boolean;
BEGIN
 IF jsonb_typeof(output) IS DISTINCT FROM 'object' OR jsonb_typeof(output->'decisions') IS DISTINCT FROM 'array'
  OR jsonb_typeof(receipts) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(output->'decisions') LOOP
  SELECT value INTO receipt FROM jsonb_array_elements(receipts) WHERE value->>'group_key'=item->>'group_key';
  refs:=COALESCE(item->'cited_ref_ids','[]'::jsonb);
  required:=item->>'disposition' IN('topic','narrative');
  IF receipt IS NULL OR jsonb_typeof(refs) IS DISTINCT FROM 'array'
   OR jsonb_typeof(receipt->'evidence_ref_ids') IS DISTINCT FROM 'array'
   OR required AND jsonb_array_length(receipt->'evidence_ref_ids')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) ref WHERE jsonb_typeof(ref)<>'string'
     OR NOT (receipt->'evidence_ref_ids') ? (ref#>>'{}')) THEN RETURN NULL; END IF;
  warnings:=signal_topic_editorial_reference_warnings_v2(refs,10,required);
  item:=(item-'warnings')||jsonb_build_object('cited_ref_ids',refs);
  IF jsonb_array_length(warnings)>0 THEN item:=item||jsonb_build_object('warnings',warnings); END IF;
  decisions:=decisions||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_set(output,'{decisions}',decisions);
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_truncated_output_v1(raw_response text,receipts jsonb,batch_index integer,max_tokens integer)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE response jsonb;content text;marker integer;relative integer;array_start integer;header jsonb;
 item jsonb;receipt jsonb;decisions jsonb:='[]'::jsonb;seen text[]:=ARRAY[]::text[];
 i integer;object_start integer:=0;depth integer:=0;in_string boolean:=false;escaped boolean:=false;
 symbol text;bad_citation boolean;bad_target boolean;
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
    IF jsonb_typeof(item)='object' AND NOT item ? 'cited_ref_ids' THEN
     item:=item||jsonb_build_object('cited_ref_ids','[]'::jsonb); END IF;
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'cited_ref_ids')<>'array'
     OR (SELECT count(*) FROM jsonb_object_keys(item))<>6 THEN RETURN NULL;END IF;
    SELECT value INTO receipt FROM jsonb_array_elements(receipts) WHERE value->>'group_key'=item->>'group_key';
    IF receipt IS NULL OR jsonb_typeof(receipt->'evidence_ref_ids')<>'array'
     THEN RETURN NULL;END IF;
    IF item->>'group_key'=ANY(seen) THEN
     decisions:=jsonb_set(decisions,ARRAY[(array_position(seen,item->>'group_key')-1)::text],
      jsonb_build_object('group_key',item->>'group_key','disposition','unresolved','candidate',NULL,
       'confidence',NULL,'rationale','Decisiones duplicadas del proveedor; requiere revisión posterior.',
       'cited_ref_ids','[]'::jsonb));
     object_start:=0;
     CONTINUE;
    END IF;
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'cited_ref_ids') cited(ref_id)
      WHERE NOT (receipt->'evidence_ref_ids') ? cited.ref_id) INTO bad_citation;
    bad_target:=(item->>'disposition' IN('topic','narrative')) IS DISTINCT FROM (jsonb_typeof(item->'candidate')='object');
    IF bad_citation OR bad_target THEN
     item:=item||jsonb_build_object('disposition','unresolved','candidate',NULL,'confidence',NULL,
      'rationale','Decisión o evidencia inconsistente; requiere revisión posterior.','cited_ref_ids','[]'::jsonb);
    END IF;
    item:=signal_topic_editorial_reference_output_v1(jsonb_build_object('decisions',jsonb_build_array(item)),receipts)->'decisions'->0;
    IF item IS NULL THEN RETURN NULL; END IF;
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
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(signal_topic_editorial_reference_output_v1(c.response_output,r.receipts)) AS normalized
   FROM requests r JOIN paid_lineage lineage ON lineage.original_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=lineage.request_id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
  UNION ALL
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(c.response_output) AS normalized
   FROM requests r JOIN paid_lineage lineage ON lineage.original_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=lineage.request_id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_reference_output_v1(c.response_output,r.receipts) IS NOT NULL
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
  UNION ALL
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(
    signal_topic_editorial_paid_missing_output_v1(c.response_output,r.receipts,r.batch_index)) AS normalized
   FROM requests r JOIN signal_topic_editorial_requests child ON child.parent_request_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=child.id
   WHERE child.execution_id=NEW.id AND child.workspace_id=NEW.workspace_id AND child.phase='screening'
    AND c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_paid_missing_output_v1(c.response_output,r.receipts,r.batch_index) IS NOT NULL
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

REVOKE ALL ON FUNCTION signal_topic_editorial_reference_output_v1(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_reference_output_v1(jsonb,jsonb) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
