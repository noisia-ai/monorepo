-- A settled max_tokens response can repeat a group while omitting another.
-- Keep only complete, receipt-bound decisions. A duplicated group is ambiguous:
-- replace its earlier decision with an abstention, then abstain on omitted groups.
-- Never turn a repeated or uncited decision into a Topic or Noise verdict.
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
    IF bad_citation OR bad_target OR (item->>'disposition' IN('topic','narrative') AND jsonb_array_length(item->'cited_ref_ids')=0) THEN
     item:=item||jsonb_build_object('disposition','unresolved','candidate',NULL,'confidence',NULL,
      'rationale','Decisión o evidencia inconsistente; requiere revisión posterior.','cited_ref_ids','[]'::jsonb);
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
