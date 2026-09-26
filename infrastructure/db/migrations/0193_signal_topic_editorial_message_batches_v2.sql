-- LOCAL ONLY. Versioned Message Batches transport; no provider, policy or data
-- migration is executed by installation. Existing monetary exposure remains in
-- signal_topic_editorial_calls. Historical V1 function bodies are retained.
CREATE FUNCTION signal_topic_editorial_configuration_v2() RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT '{"contract_version":"signal-topic-editorial-provider-config-v2","phase":"screening","provider":"anthropic","transport":"message_batches","model":"claude-sonnet-4-6","max_output_tokens":128000,"thinking":"disabled","effort":"high","prompt_digest":"sha256:a4439b725bdf82c606974bb551e2ce46607922de65293925debbb0c1932bc2ff","pricing_version":"claude-sonnet-4-6-batch-usd-2026-09-26","input_micro_usd_per_million_tokens":1500000,"output_micro_usd_per_million_tokens":7500000}'::jsonb $$;

CREATE TABLE signal_topic_editorial_batch_owners_v2 (
 execution_id uuid PRIMARY KEY REFERENCES signal_topic_editorial_executions(id) DEFERRABLE INITIALLY DEFERRED,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 plan_canonical_body text NOT NULL,plan_digest text NOT NULL CHECK(plan_digest~'^sha256:[a-f0-9]{64}$'),
 send_not_after timestamptz NOT NULL,
 previous_execution_id uuid REFERENCES signal_topic_editorial_executions(id),
 stage text NOT NULL DEFAULT 'screening' CHECK(stage IN('screening','screening_ready','review_pending')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,execution_id),
 CHECK(octet_length(plan_canonical_body) BETWEEN 1 AND 67108864)
);
CREATE TABLE signal_topic_editorial_provider_batches_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL REFERENCES signal_topic_editorial_batch_owners_v2(execution_id),
 submission_key text NOT NULL CHECK(submission_key~'^[A-Za-z0-9._:-]{8,200}$'),
 manifest_body text NOT NULL,manifest_digest text NOT NULL CHECK(manifest_digest~'^sha256:[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitting','submission_unknown','in_progress','canceling','ended','applied','rejected')),
 submission_token uuid NOT NULL DEFAULT gen_random_uuid(),provider_batch_id text UNIQUE,
 provider_receipt_body text,provider_receipt_sha256 text,rejection_http_status integer,error_code text,
 next_poll_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token uuid,lease_expires_at timestamptz,
 submitted_at timestamptz,ended_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(execution_id,submission_key),UNIQUE(execution_id,id),
 CHECK(octet_length(manifest_body) BETWEEN 1 AND 268435456),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK((provider_receipt_body IS NULL)=(provider_receipt_sha256 IS NULL)),
 CHECK(provider_batch_id IS NULL OR provider_batch_id~'^[A-Za-z0-9_-]{1,200}$')
);
CREATE TABLE signal_topic_editorial_batch_items_v2 (
 batch_id uuid NOT NULL REFERENCES signal_topic_editorial_provider_batches_v2(id),
 request_id uuid NOT NULL REFERENCES signal_topic_editorial_requests(id),
 call_id uuid NOT NULL UNIQUE REFERENCES signal_topic_editorial_calls(id),
 custom_id text NOT NULL CHECK(custom_id~'^e2_[a-f0-9]{60}$'),
 outcome text CHECK(outcome IN('succeeded','errored','canceled','expired','submission_rejected')),
 validation jsonb,validation_body text,validation_sha256 text,
 received_at timestamptz,validated_at timestamptz,
 PRIMARY KEY(batch_id,custom_id),UNIQUE(batch_id,request_id),
 CHECK((validation IS NULL)=(validation_body IS NULL)),
 CHECK((validation IS NULL)=(validation_sha256 IS NULL)),
 CHECK((validation IS NULL)=(validated_at IS NULL)),
 CHECK(outcome IS NOT NULL OR validation IS NULL)
);
CREATE INDEX topic_editorial_batch_due_v2 ON signal_topic_editorial_provider_batches_v2(next_poll_at)
 WHERE state NOT IN('applied','submission_unknown','rejected');
CREATE TABLE signal_topic_editorial_reused_decisions_v2 (
 request_id uuid PRIMARY KEY REFERENCES signal_topic_editorial_requests(id),
 execution_id uuid NOT NULL REFERENCES signal_topic_editorial_batch_owners_v2(execution_id),
 source_call_id uuid NOT NULL REFERENCES signal_topic_editorial_calls(id),
 source_checkpoint_digest text,decision jsonb NOT NULL,lineage jsonb NOT NULL,body text NOT NULL,body_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(body_sha256~'^sha256:[a-f0-9]{64}$')
);

-- The new column is transport identity, not a monetary balance. Existing rows
-- stay V1 and retain the original unique-call semantics.
ALTER TABLE signal_topic_editorial_calls ADD COLUMN transport_version smallint NOT NULL DEFAULT 1 CHECK(transport_version IN(1,2));
DROP INDEX uq_topic_editorial_live_call;
CREATE UNIQUE INDEX uq_topic_editorial_live_call ON signal_topic_editorial_calls(request_id)
 WHERE transport_version=1 AND status<>'definitely_not_sent';
CREATE UNIQUE INDEX uq_topic_editorial_live_call_v2 ON signal_topic_editorial_calls(request_id)
 WHERE transport_version=2 AND status NOT IN('definitely_not_sent','settled');
ALTER TABLE signal_topic_editorial_executions DROP CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check,
 ADD CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check CHECK(hard_cap_micro_usd>0 AND
 (plan->>'contract_version'='signal-topic-editorial-screening-plan-v2' OR hard_cap_micro_usd<=30000000));
ALTER TABLE signal_topic_editorial_requests DROP CONSTRAINT signal_topic_editorial_requests_batch_index_check,
 ADD CONSTRAINT signal_topic_editorial_requests_batch_index_check CHECK(batch_index>=0 AND
 (configuration->>'contract_version'='signal-topic-editorial-provider-config-v2' OR batch_index<=124));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_consolidation_action,
 ADD CONSTRAINT signal_processing_consolidation_action CHECK(action<>'topic_consolidation' OR
 (automatic_allowed=false AND max_execution_micro_usd>0 AND
 (configuration=signal_topic_editorial_configuration_v2() OR max_execution_micro_usd<=30000000)));

CREATE FUNCTION signal_topic_editorial_output_schema_v2(receipt jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT jsonb_build_object('type','object','additionalProperties',false,
 'required','["contract_version","group_id","disposition","candidate","confidence","rationale","cited_evidence_ids"]'::jsonb,
 'properties',jsonb_build_object(
 'contract_version',jsonb_build_object('type','string','enum',jsonb_build_array('signal-topic-editorial-group-output-v2')),
 'group_id',jsonb_build_object('type','string','enum',jsonb_build_array(receipt->>'group_id')),
 'disposition','{"type":"string","enum":["topic","narrative","noise","unresolved"]}'::jsonb,
 'candidate',jsonb_build_object('type','["object","null"]'::jsonb,'additionalProperties',false,
  'required','["label","definition","locale"]'::jsonb,'properties',jsonb_build_object('label','{"type":"string"}'::jsonb,
   'definition','{"type":"string"}'::jsonb,'locale',jsonb_build_object('type','string','enum',jsonb_build_array(receipt->>'expected_locale')))),
 'confidence','{"type":["number","null"],"description":"Uncalibrated confidence from 0 to 1, or null when unavailable. Never a 0–100 percentage."}'::jsonb,
 'rationale','{"type":"string"}'::jsonb,'cited_evidence_ids',jsonb_build_object('type','array','items',
  CASE WHEN jsonb_array_length(receipt->'evidence')=0 THEN '{"type":"string"}'::jsonb ELSE jsonb_build_object('type','string','enum',
   (SELECT jsonb_agg(x->>'evidence_id' ORDER BY n) FROM jsonb_array_elements(receipt->'evidence') WITH ORDINALITY a(x,n))) END))) $$;

-- A body digest is intentionally over exact canonical bytes supplied by the
-- application: V2 source metrics contain floating-point numbers. We prove JSON
-- equivalence and provenance separately, without changing historical canonical
-- JSON functions (which intentionally support integers only).
CREATE FUNCTION signal_topic_editorial_plan_valid_v2(target_run uuid,plan jsonb,canonical_body text) RETURNS boolean
 LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;r signal_topic_consolidation_runs%ROWTYPE;item jsonb;g signal_topic_atomic_groups%ROWTYPE;
 projected jsonb;receipt jsonb;context jsonb;seen text[]:='{}';evidence jsonb;original jsonb;guard_stage text:='source';
BEGIN
 SELECT * INTO r FROM signal_topic_consolidation_runs WHERE id=target_run;
 source:=signal_topic_editorial_source_v1(target_run);
 guard_stage:='plan_header';
 IF r.id IS NULL OR source IS NULL OR plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2'
  OR plan->'identity'->>'workspace_id' IS DISTINCT FROM r.workspace_id::text OR plan->'identity'->>'run_id' IS DISTINCT FROM target_run::text
  OR plan->'identity'->>'source_context_digest' IS DISTINCT FROM r.context_digest
  OR plan-'plan_digest' IS DISTINCT FROM canonical_body::jsonb
  OR plan->>'plan_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_body)
  OR jsonb_typeof(plan->'requests') IS DISTINCT FROM 'array'
  OR jsonb_array_length(plan->'requests')<>r.expected_group_count
  OR plan->>'expected_group_count' IS DISTINCT FROM r.expected_group_count::text THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(plan->'requests') LOOP
  guard_stage:='group_lookup';
  receipt:=item->'receipt';projected:=item->'source_group';
  SELECT * INTO g FROM signal_topic_atomic_groups WHERE consolidation_run_id=target_run AND workspace_id=r.workspace_id AND group_key=receipt->>'group_key';
  guard_stage:='group_invariants';
  IF g.id IS NULL OR g.group_key=ANY(seen) OR item->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-group-request-record-v2'
   OR item->'identity' IS DISTINCT FROM plan->'identity' OR item->'configuration' IS DISTINCT FROM signal_topic_editorial_configuration_v2()
   OR receipt->>'group_digest' IS DISTINCT FROM g.group_digest OR receipt->>'source_dossier_digest' IS DISTINCT FROM g.dossier_digest
   OR projected->>'group_key' IS DISTINCT FROM g.group_key OR projected->>'group_digest' IS DISTINCT FROM g.group_digest
   OR projected->>'source_dossier_digest' IS DISTINCT FROM g.dossier_digest OR projected->>'dossier_digest' IS DISTINCT FROM receipt->>'dossier_digest'
   OR projected->>'lane' IS DISTINCT FROM g.lane OR projected->>'root_count' IS DISTINCT FROM g.root_count::text
   OR projected->>'chunk_count' IS DISTINCT FROM g.chunk_count::text OR projected->'terms' IS DISTINCT FROM to_jsonb(g.terms)
   OR (projected-ARRAY['group_key','lane','group_digest','source_dossier_digest','dossier_digest','community_key','root_count','chunk_count','terms','evidence'])
    IS DISTINCT FROM (g.dossier-ARRAY['contract_version','evidence'])
   OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_community_members m JOIN signal_topic_consolidation_communities c ON c.id=m.community_id
    WHERE m.atomic_group_id=g.id AND c.community_key=projected->>'community_key')
   OR jsonb_typeof(projected->'evidence') IS DISTINCT FROM 'array' OR jsonb_typeof(receipt->'evidence') IS DISTINCT FROM 'array'
   OR jsonb_array_length(projected->'evidence')<>jsonb_array_length(receipt->'evidence') THEN RETURN false;END IF;
  guard_stage:='context_consistency';
  IF context IS NULL THEN context:=item->'source_context';ELSIF item->'source_context' IS DISTINCT FROM context THEN RETURN false;END IF;
  guard_stage:='context_digest';
  IF receipt->>'expected_locale' IS DISTINCT FROM context->>'default_locale'
   OR plan->'identity'->>'editorial_context_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(context) THEN RETURN false;END IF;
  guard_stage:='evidence_array';
  FOR evidence IN SELECT value FROM jsonb_array_elements(projected->'evidence') LOOP
   guard_stage:='evidence_provenance';
   IF NOT EXISTS(SELECT 1 FROM signal_topic_atomic_group_evidence e WHERE e.atomic_group_id=g.id AND e.ref_id=evidence->>'ref_id')
    OR NOT(g.dossier->'evidence' @> jsonb_build_array(evidence-'text'))
    OR signal_semantic_context_digest_v1(evidence->>'text') IS DISTINCT FROM evidence->>'chunk_sha256'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'evidence') x WHERE x.value-'evidence_id'=
     evidence-ARRAY['text','locale','platform','occurred_at']) THEN RETURN false;END IF;
  END LOOP;
  -- The provider message is sealed by the canonical plan digest and rebuilt by
  -- the TypeScript contract before any IO. Re-parsing its nested JSON here adds
  -- a second, incompatible serializer without strengthening source provenance.
  -- Keep provider shape/configuration guards; the worker validates exact content.
  guard_stage:='provider_messages_type';
  IF jsonb_typeof(item->'provider_request'->'params'->'messages') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  guard_stage:='provider_messages_count';
  IF jsonb_array_length(item->'provider_request'->'params'->'messages')<>1 THEN RETURN false;END IF;
  guard_stage:='provider_message_role';
  IF item->'provider_request'->'params'->'messages'->0->>'role' IS DISTINCT FROM 'user' THEN RETURN false;END IF;
  guard_stage:='provider_message_content_type';
  IF jsonb_typeof(item->'provider_request'->'params'->'messages'->0->'content') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
  guard_stage:='provider_receipt_evidence_type';
  IF jsonb_typeof(receipt->'evidence') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  guard_stage:='provider_evidence_ref_uniqueness';
  IF (SELECT count(DISTINCT value->>'ref_id') FROM jsonb_array_elements(receipt->'evidence'))<>jsonb_array_length(receipt->'evidence') THEN RETURN false;END IF;
  guard_stage:='provider_evidence_id_uniqueness';
  IF (SELECT count(DISTINCT value->>'evidence_id') FROM jsonb_array_elements(receipt->'evidence'))<>jsonb_array_length(receipt->'evidence') THEN RETURN false;END IF;
  guard_stage:='provider_custom_id';
  IF item->'provider_request'->>'custom_id' IS DISTINCT FROM 'e2_'||substr(item->>'request_digest',8,60) THEN RETURN false;END IF;
  guard_stage:='provider_params_type';
  IF jsonb_typeof(item->'provider_request'->'params') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  guard_stage:='provider_params_keys';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(item->'provider_request'->'params') key
    WHERE key NOT IN('model','max_tokens','thinking','system','output_config','messages'))
   OR (SELECT count(*) FROM jsonb_object_keys(item->'provider_request'->'params'))<>6 THEN RETURN false;END IF;
  guard_stage:='provider_thinking';
  IF item->'provider_request'->'params'->'thinking' IS DISTINCT FROM '{"type":"disabled"}'::jsonb THEN RETURN false;END IF;
  guard_stage:='provider_schema';
  IF item->'provider_request'->'params'->'output_config' IS DISTINCT FROM jsonb_build_object('effort','high','format',
    jsonb_build_object('type','json_schema','schema',signal_topic_editorial_output_schema_v2(receipt))) THEN RETURN false;END IF;
  guard_stage:='provider_schema_digest';
  IF item->>'schema_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(signal_topic_editorial_output_schema_v2(receipt)) THEN RETURN false;END IF;
  guard_stage:='provider_model';
  IF item->'provider_request'->'params'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
   OR item->'provider_request'->'params'->>'max_tokens' IS DISTINCT FROM '128000' THEN RETURN false;END IF;
  guard_stage:='provider_system_digest';
  IF signal_semantic_context_digest_v1(to_json(item->'provider_request'->'params'->>'system')::text) IS DISTINCT FROM
      signal_topic_editorial_configuration_v2()->>'prompt_digest' THEN RETURN false;END IF;
  seen:=array_append(seen,g.group_key);
 END LOOP;
 RETURN cardinality(seen)=r.expected_group_count;
-- Diagnostic-only during the private rollback rehearsal: preserve the SQLSTATE
-- in a safe domain code instead of masking the source as a generic false.
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'topic_editorial_v2_plan_guard_exception_%_%',guard_stage,lower(SQLSTATE);
END $$;

CREATE FUNCTION persist_signal_topic_editorial_batch_item_v2(target_batch uuid,target_token uuid,target_custom text,body text,body_sha text,storage_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;i signal_topic_editorial_batch_items_v2%ROWTYPE;c signal_topic_editorial_calls%ROWTYPE;
 envelope jsonb;output_text text;cost bigint;usage_valid boolean:=true;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_topic_editorial_batch_lease_v2(b.id,target_token);
 SELECT * INTO i FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id AND custom_id=target_custom FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=i.call_id FOR UPDATE;
 IF i.call_id IS NULL OR b.state NOT IN('ended','applied') OR octet_length(body)>8388608
  OR body_sha IS DISTINCT FROM signal_semantic_context_digest_v1(body) OR storage_key IS NULL OR length(storage_key) NOT BETWEEN 1 AND 1024 THEN
  RAISE EXCEPTION 'topic_editorial_v2_receipt_invalid' USING ERRCODE='23514';END IF;
 envelope:=body::jsonb;
 IF envelope->>'custom_id' IS DISTINCT FROM i.custom_id OR NOT COALESCE(envelope->'result'->>'type' IN('succeeded','errored','canceled','expired'),false) THEN
  RAISE EXCEPTION 'topic_editorial_v2_item_binding_invalid' USING ERRCODE='23514';END IF;
 IF c.response_body_private IS NOT NULL THEN
  IF c.response_body_private IS DISTINCT FROM body OR c.response_sha256 IS DISTINCT FROM body_sha OR c.response_storage_key IS DISTINCT FROM storage_key THEN
   RAISE EXCEPTION 'topic_editorial_v2_receipt_immutable' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('outcome',i.outcome,'settled_micro_usd',c.settled_micro_usd::text,'usage_pending',c.status<>'settled','replayed',true);
 END IF;
 BEGIN cost:=signal_topic_editorial_batch_cost_v2(envelope);
 EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN usage_valid:=false;cost:=NULL;END;
 IF cost>c.reserved_micro_usd THEN usage_valid:=false;cost:=NULL;END IF;
 IF jsonb_typeof(envelope->'result'->'message'->'content')='array' THEN
  SELECT string_agg(value->>'text','' ORDER BY ordinal) INTO output_text
   FROM jsonb_array_elements(envelope->'result'->'message'->'content') WITH ORDINALITY x(value,ordinal) WHERE value->>'type'='text';
 END IF;
 UPDATE signal_topic_editorial_calls SET status='response_persisted',response_body_private=body,response_sha256=body_sha,response_storage_key=storage_key,
  response_http_status=200,response_complete=true,response_provider_request_id=b.provider_batch_id,
  response_output=signal_topic_editorial_parse_json_v1(output_text),observed_micro_usd=cost,response_at=clock_timestamp() WHERE id=c.id;
 IF usage_valid THEN
  UPDATE signal_topic_editorial_calls SET status='settled',settled_micro_usd=cost,settled_at=clock_timestamp() WHERE id=c.id;
 ELSE
  UPDATE signal_topic_editorial_calls SET status='outcome_unknown',error_code='topic_editorial_v2_usage_invalid' WHERE id=c.id;
 END IF;
 UPDATE signal_topic_editorial_batch_items_v2 SET outcome=envelope->'result'->>'type',received_at=clock_timestamp() WHERE call_id=c.id;
 RETURN jsonb_build_object('outcome',envelope->'result'->>'type','settled_micro_usd',cost::text,'usage_pending',NOT usage_valid,'replayed',false);
END $$;

-- Match only one sealed protocol spelling. Preserve all human prose unchanged.
CREATE FUNCTION signal_topic_editorial_protocol_value_v2(value jsonb,allowed text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT CASE WHEN jsonb_typeof(value)='string' AND count(*)=1 THEN to_jsonb(min(item)) ELSE value END
 FROM unnest(allowed) item WHERE lower(item)=lower(value#>>'{}') $$;
CREATE FUNCTION signal_topic_editorial_protocol_output_v2(value jsonb,receipt jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
 SET search_path=public,pg_temp AS $$
DECLARE result jsonb:=value;candidate jsonb;aliases text[];citations jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN value;END IF;
 result:=result||jsonb_build_object('contract_version',signal_topic_editorial_protocol_value_v2(value->'contract_version',ARRAY['signal-topic-editorial-group-output-v2']),
  'group_id',signal_topic_editorial_protocol_value_v2(value->'group_id',ARRAY[receipt->>'group_id']),
  'disposition',signal_topic_editorial_protocol_value_v2(value->'disposition',ARRAY['topic','narrative','noise','unresolved']));
 candidate:=value->'candidate';
 IF jsonb_typeof(candidate)='object' THEN result:=jsonb_set(result,'{candidate}',candidate||jsonb_build_object('locale',
  signal_topic_editorial_protocol_value_v2(candidate->'locale',ARRAY[receipt->>'expected_locale'])));END IF;
 IF jsonb_typeof(value->'cited_evidence_ids')='array' THEN
  SELECT array_agg(x->>'evidence_id') INTO aliases FROM jsonb_array_elements(receipt->'evidence') x;
  SELECT COALESCE(jsonb_agg(signal_topic_editorial_protocol_value_v2(x,aliases) ORDER BY n),'[]'::jsonb) INTO citations
   FROM jsonb_array_elements(value->'cited_evidence_ids') WITH ORDINALITY a(x,n);
  result:=jsonb_set(result,'{cited_evidence_ids}',citations);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION validate_signal_topic_editorial_batch_item_v2(target_batch uuid,target_token uuid,target_custom text,body text,body_sha text)
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
  IF i.outcome<>'succeeded' OR c.response_body_private::jsonb->'result'->'message'->>'stop_reason' IS DISTINCT FROM 'end_turn'
   OR output->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-group-output-v2'
   OR output->>'group_id' IS DISTINCT FROM receipt->>'group_id' OR NOT COALESCE(output->>'disposition' IN('topic','narrative','noise','unresolved'),false)
   OR jsonb_typeof(output->'cited_evidence_ids') IS DISTINCT FROM 'array'
   OR jsonb_typeof(output->'rationale') IS DISTINCT FROM 'string' OR btrim(output->>'rationale')=''
   OR NOT COALESCE(jsonb_typeof(output->'confidence') IN('number','null'),false) OR jsonb_typeof(output->'confidence')='number' AND
    ((output->>'confidence')::numeric<0 OR (output->>'confidence')::numeric>1) THEN
   RAISE EXCEPTION 'topic_editorial_v2_decision_invalid' USING ERRCODE='23514';END IF;
  SELECT array_agg(value ORDER BY ordinal) INTO aliases FROM jsonb_array_elements_text(output->'cited_evidence_ids') WITH ORDINALITY x(value,ordinal);
  IF (SELECT count(DISTINCT x) FROM unnest(aliases) x)<>COALESCE(cardinality(aliases),0)
   OR EXISTS(SELECT 1 FROM unnest(aliases) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'evidence') e WHERE e.value->>'evidence_id'=x))
   OR output->>'disposition'<>'unresolved' AND COALESCE(cardinality(aliases),0)=0 THEN
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
  IF v IS DISTINCT FROM jsonb_build_object('status','accepted','decision',expected) THEN
   RAISE EXCEPTION 'topic_editorial_v2_validation_source_mismatch' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT COALESCE(v->>'code'~'^topic_editorial_v2_[a-z_]+$',false) THEN RAISE EXCEPTION 'topic_editorial_v2_validation_code_invalid' USING ERRCODE='23514';END IF;
 END IF;
 UPDATE signal_topic_editorial_batch_items_v2 SET validation=v,validation_body=body,validation_sha256=body_sha,validated_at=clock_timestamp() WHERE call_id=i.call_id;
 RETURN '{"replayed":false}'::jsonb;
END $$;

CREATE FUNCTION finish_signal_topic_editorial_batch_import_v2(target_batch uuid,target_token uuid) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;accepted integer;failed integer;complete_count integer;expected_count integer;stage text;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_topic_editorial_batch_lease_v2(b.id,target_token);
 IF b.state NOT IN('ended','applied') OR EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id AND (outcome IS NULL OR validation IS NULL)) THEN
  RAISE EXCEPTION 'topic_editorial_v2_import_incomplete' USING ERRCODE='23514';END IF;
 SELECT count(*) FILTER(WHERE validation->>'status'='accepted'),count(*) FILTER(WHERE validation->>'status'<>'accepted') INTO accepted,failed
  FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id;
 SELECT count(*) INTO complete_count FROM (
  SELECT i.request_id FROM signal_topic_editorial_batch_items_v2 i
   JOIN signal_topic_editorial_provider_batches_v2 batch ON batch.id=i.batch_id JOIN signal_topic_editorial_calls c ON c.id=i.call_id
   WHERE batch.execution_id=b.execution_id AND i.validation->>'status'='accepted' AND c.status='settled'
  UNION SELECT request_id FROM signal_topic_editorial_reused_decisions_v2 WHERE execution_id=b.execution_id
 ) complete;
 SELECT count(*) INTO expected_count FROM signal_topic_editorial_requests WHERE execution_id=b.execution_id;
 stage:=CASE WHEN complete_count=expected_count THEN 'review_pending' ELSE 'screening' END;
 UPDATE signal_topic_editorial_batch_owners_v2 SET stage=finish_signal_topic_editorial_batch_import_v2.stage WHERE execution_id=b.execution_id;
 UPDATE signal_topic_editorial_provider_batches_v2 SET state='applied',lease_token=NULL,lease_expires_at=NULL WHERE id=b.id;
 RETURN jsonb_build_object('state','applied','accepted',accepted,'failed',failed,'stage',stage);
END $$;

CREATE FUNCTION signal_topic_editorial_batch_cost_v2(envelope jsonb) RETURNS bigint LANGUAGE plpgsql IMMUTABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE usage jsonb;input bigint;output bigint;
BEGIN
 IF envelope->'result'->>'type' IN('errored','canceled','expired') THEN RETURN 0;END IF;
 IF envelope->'result'->>'type' IS DISTINCT FROM 'succeeded' OR envelope->'result'->'message'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' THEN
  RAISE EXCEPTION 'topic_editorial_v2_usage_invalid' USING ERRCODE='23514';END IF;
 usage:=envelope->'result'->'message'->'usage';
 IF NOT COALESCE(usage->>'input_tokens'~'^[0-9]+$' AND usage->>'output_tokens'~'^[0-9]+$',false)
  OR COALESCE(usage->>'cache_creation_input_tokens','0')<>'0' OR COALESCE(usage->>'cache_read_input_tokens','0')<>'0' THEN
  RAISE EXCEPTION 'topic_editorial_v2_usage_invalid' USING ERRCODE='23514';END IF;
 input:=(usage->>'input_tokens')::bigint;output:=(usage->>'output_tokens')::bigint;
 RETURN (input*3+output*15+1)/2;
END $$;

CREATE FUNCTION signal_topic_editorial_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;
 spent bigint;org_spent bigint;expected bigint;envelope jsonb;rejected boolean;usage_valid boolean:=true;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,NEW.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 IF o.execution_id IS NULL OR r.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd,NEW.budget_timezone)
   IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd,a.budget_timezone)
 THEN RAISE EXCEPTION 'topic_editorial_v2_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_topic_editorial_batch_authority_v2(e.id,true);
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.response_output IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL
   OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  IF prior.id IS DISTINCT FROM NEW.retry_of_call_id OR prior.id IS NOT NULL AND
   (prior.transport_version<>2 OR prior.status NOT IN('settled','definitely_not_sent')
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND validation->>'status'='accepted')
    OR prior.status='settled' AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND (validation IS NOT NULL OR outcome='submission_rejected'))) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_not_retryable' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 WHERE request_id=r.id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_request_already_reused' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  SELECT total_micro_usd INTO org_spent FROM signal_processing_org_exposure_v1(e.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=o.policy_version_id;
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_v2_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF OLD.transport_version<>2 OR (to_jsonb(NEW)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD
   OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF OLD.status='reserved' AND NEW.status='in_flight' THEN
   PERFORM signal_topic_editorial_batch_authority_v2(e.id,true);
   IF NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date THEN
    RAISE EXCEPTION 'topic_editorial_v2_reservation_day_expired' USING ERRCODE='23514';END IF;
   NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
   WHERE i.call_id=NEW.id AND b.state='rejected' AND b.provider_receipt_body=NEW.response_body_private
    AND b.rejection_http_status=NEW.response_http_status AND NEW.response_complete=true) INTO rejected;
  IF rejected THEN
   IF NEW.observed_micro_usd IS DISTINCT FROM 0::bigint OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM 0::bigint
    OR NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private) THEN
    RAISE EXCEPTION 'topic_editorial_v2_rejection_settlement_invalid' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.request_id=r.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
     AND b.execution_id=e.id AND b.state IN('ended','applied'))
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_v2_response_binding_invalid' USING ERRCODE='23514';END IF;
  BEGIN expected:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN usage_valid:=false;END;
  IF NOT usage_valid OR expected>NEW.reserved_micro_usd THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_v2_usage_unresolved' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF NEW.observed_micro_usd IS DISTINCT FROM expected
   OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'topic_editorial_v2_settlement_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER topic_editorial_call_guard ON signal_topic_editorial_calls;
CREATE TRIGGER topic_editorial_call_guard BEFORE INSERT OR UPDATE ON signal_topic_editorial_calls FOR EACH ROW
 WHEN(NEW.transport_version=1 AND NOT signal_topic_editorial_known_rejection_v1(NEW.response_body_private,NEW.response_http_status,NEW.response_complete)) EXECUTE FUNCTION signal_topic_editorial_call_guard_v1();
DROP TRIGGER topic_editorial_known_rejection_guard ON signal_topic_editorial_calls;
CREATE TRIGGER topic_editorial_known_rejection_guard BEFORE UPDATE ON signal_topic_editorial_calls FOR EACH ROW
 WHEN(NEW.transport_version=1 AND signal_topic_editorial_known_rejection_v1(NEW.response_body_private,NEW.response_http_status,NEW.response_complete)) EXECUTE FUNCTION signal_topic_editorial_known_rejection_guard_v1();
CREATE TRIGGER topic_editorial_call_guard_v2 BEFORE INSERT OR UPDATE ON signal_topic_editorial_calls FOR EACH ROW
 WHEN(NEW.transport_version=2) EXECUTE FUNCTION signal_topic_editorial_call_guard_v2();

CREATE FUNCTION prepare_signal_topic_editorial_batch_v2(target_execution uuid,request_digests text[],submission_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;b signal_topic_editorial_provider_batches_v2%ROWTYPE;
 r signal_topic_editorial_requests%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;call_id uuid;manifest text;manifest_hash text;request_count integer;
BEGIN
 PERFORM signal_topic_editorial_batch_authority_v2(target_execution,true);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT count(*),jsonb_build_object('requests',jsonb_agg(receipts->'request'->'provider_request' ORDER BY batch_index))::text INTO request_count,manifest
  FROM signal_topic_editorial_requests WHERE execution_id=e.id AND request_digest=ANY(request_digests);
 IF request_count=0 OR request_count<>cardinality(request_digests) OR request_count>100000 THEN
  RAISE EXCEPTION 'topic_editorial_v2_batch_requests_invalid' USING ERRCODE='23514';END IF;
 manifest_hash:=signal_semantic_context_digest_v1(manifest);
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id AND signal_topic_editorial_provider_batches_v2.submission_key=prepare_signal_topic_editorial_batch_v2.submission_key;
 IF b.id IS NOT NULL THEN
  IF b.manifest_digest<>manifest_hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('batch_id',b.id,'manifest_digest',b.manifest_digest,'replayed',true);
 END IF;
 INSERT INTO signal_topic_editorial_provider_batches_v2(execution_id,submission_key,manifest_body,manifest_digest)
 VALUES(e.id,submission_key,manifest,manifest_hash) RETURNING * INTO b;
 FOR r IN SELECT * FROM signal_topic_editorial_requests WHERE execution_id=e.id AND request_digest=ANY(request_digests) ORDER BY batch_index LOOP
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  INSERT INTO signal_topic_editorial_calls(workspace_id,organization_id,execution_id,request_id,retry_of_call_id,reserved_micro_usd,budget_date,budget_timezone,transport_version)
  VALUES(e.workspace_id,e.organization_id,e.id,r.id,prior.id,r.reserved_micro_usd,(clock_timestamp() AT TIME ZONE a.budget_timezone)::date,a.budget_timezone,2) RETURNING id INTO call_id;
  INSERT INTO signal_topic_editorial_batch_items_v2(batch_id,request_id,call_id,custom_id)
  VALUES(b.id,r.id,call_id,r.receipts->'request'->'provider_request'->>'custom_id');
 END LOOP;
 RETURN jsonb_build_object('batch_id',b.id,'manifest_digest',b.manifest_digest,'replayed',false);
END $$;

CREATE FUNCTION claim_signal_topic_editorial_batch_v2(target_batch uuid DEFAULT NULL,lease_seconds integer DEFAULT 120) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;token uuid:=gen_random_uuid();items jsonb;
BEGIN
 IF lease_seconds NOT BETWEEN 15 AND 300 THEN RAISE EXCEPTION 'topic_editorial_v2_lease_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2
  WHERE (target_batch IS NULL OR id=target_batch) AND state NOT IN('applied','submission_unknown','rejected') AND next_poll_at<=clock_timestamp()
   AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_poll_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF b.id IS NULL THEN RETURN NULL;END IF;
 IF b.state='submitting' THEN
  UPDATE signal_topic_editorial_provider_batches_v2 SET state='submission_unknown',lease_token=NULL,lease_expires_at=NULL WHERE id=b.id;
  UPDATE signal_topic_editorial_calls c SET status='outcome_unknown',error_code='topic_editorial_v2_submission_unknown'
   FROM signal_topic_editorial_batch_items_v2 i WHERE i.batch_id=b.id AND c.id=i.call_id AND c.status='in_flight';
  RETURN NULL;
 END IF;
 UPDATE signal_topic_editorial_provider_batches_v2 SET lease_token=token,lease_expires_at=clock_timestamp()+make_interval(secs=>lease_seconds) WHERE id=b.id;
 SELECT jsonb_agg(jsonb_build_object('custom_id',i.custom_id,'call_id',c.id,'attempt_token',c.attempt_token,
  'request',r.receipts->'request','outcome',i.outcome,'validation',i.validation,'raw_sha256',c.response_sha256) ORDER BY r.batch_index) INTO items
  FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_calls c ON c.id=i.call_id JOIN signal_topic_editorial_requests r ON r.id=i.request_id WHERE i.batch_id=b.id;
 RETURN jsonb_build_object('batch_id',b.id,'execution_id',b.execution_id,'lease_token',token,'submission_token',b.submission_token,
  'state',b.state,'provider_batch_id',b.provider_batch_id,'manifest_body',b.manifest_body,'manifest_digest',b.manifest_digest,'items',items);
END $$;
CREATE FUNCTION signal_topic_editorial_batch_lease_v2(target_batch uuid,target_token uuid) RETURNS void LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch AND lease_token=target_token AND lease_expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'topic_editorial_v2_lease_conflict' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION mark_submitting_signal_topic_editorial_batch_v2(target_batch uuid,target_token uuid) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_topic_editorial_batch_lease_v2(b.id,target_token);
 IF b.state<>'prepared' THEN RAISE EXCEPTION 'topic_editorial_v2_submission_already_attempted' USING ERRCODE='23514';END IF;
 PERFORM signal_topic_editorial_batch_authority_v2(b.execution_id,true);
 UPDATE signal_topic_editorial_calls c SET status='in_flight',sent_at=clock_timestamp()
  FROM signal_topic_editorial_batch_items_v2 i WHERE i.batch_id=b.id AND c.id=i.call_id AND c.status='reserved';
 UPDATE signal_topic_editorial_provider_batches_v2 SET state='submitting',submitted_at=clock_timestamp() WHERE id=b.id;
 RETURN jsonb_build_object('submission_token',b.submission_token,'manifest_body',b.manifest_body,'manifest_digest',b.manifest_digest);
END $$;
CREATE FUNCTION attach_provider_signal_topic_editorial_batch_v2(target_batch uuid,target_submission uuid,body text,body_sha text) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;receipt jsonb;counts jsonb;total bigint;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 receipt:=body::jsonb;counts:=receipt->'request_counts';
 SELECT sum(value::bigint) INTO total FROM jsonb_each_text(counts);
 IF b.id IS NULL OR b.submission_token IS DISTINCT FROM target_submission OR body_sha IS DISTINCT FROM signal_semantic_context_digest_v1(body)
  OR receipt->>'id' IS NULL OR receipt->>'processing_status' NOT IN('in_progress','canceling','ended')
  OR total IS DISTINCT FROM (SELECT count(*) FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id) THEN
  RAISE EXCEPTION 'topic_editorial_v2_submission_receipt_invalid' USING ERRCODE='23514';END IF;
 IF b.provider_batch_id IS NOT NULL THEN
  IF b.provider_batch_id IS DISTINCT FROM receipt->>'id' OR b.provider_receipt_body IS DISTINCT FROM body THEN
   RAISE EXCEPTION 'topic_editorial_v2_submission_receipt_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('provider_batch_id',b.provider_batch_id,'replayed',true);
 END IF;
 IF b.state NOT IN('submitting','submission_unknown') THEN RAISE EXCEPTION 'topic_editorial_v2_submission_state_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_provider_batches_v2 SET provider_batch_id=receipt->>'id',provider_receipt_body=body,provider_receipt_sha256=body_sha,
  state=receipt->>'processing_status',next_poll_at=clock_timestamp(),ended_at=CASE WHEN receipt->>'processing_status'='ended' THEN clock_timestamp() ELSE NULL END WHERE id=b.id;
 RETURN jsonb_build_object('provider_batch_id',receipt->>'id','replayed',false);
END $$;
CREATE FUNCTION poll_signal_topic_editorial_batch_v2(target_batch uuid,target_token uuid,body text,next_poll timestamptz) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;receipt jsonb;total bigint;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_topic_editorial_batch_lease_v2(b.id,target_token);receipt:=body::jsonb;
 SELECT sum(value::bigint) INTO total FROM jsonb_each_text(receipt->'request_counts');
 IF b.state NOT IN('in_progress','canceling','ended') OR receipt->>'id' IS DISTINCT FROM b.provider_batch_id
  OR receipt->>'processing_status' NOT IN('in_progress','canceling','ended') OR b.state='ended' AND receipt->>'processing_status'<>'ended'
  OR total IS DISTINCT FROM (SELECT count(*) FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=b.id)
  OR next_poll IS NULL THEN RAISE EXCEPTION 'topic_editorial_v2_poll_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_provider_batches_v2 SET state=receipt->>'processing_status',next_poll_at=next_poll,
  ended_at=CASE WHEN receipt->>'processing_status'='ended' THEN COALESCE(ended_at,clock_timestamp()) ELSE NULL END WHERE id=b.id;
 RETURN jsonb_build_object('state',receipt->>'processing_status');
END $$;
CREATE FUNCTION release_signal_topic_editorial_batch_v2(target_batch uuid,target_token uuid,next_poll timestamptz,unknown_submission boolean DEFAULT false,failure_code text DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 IF b.id IS NULL OR b.lease_token IS DISTINCT FROM target_token THEN RETURN false;END IF;
 IF unknown_submission AND b.state='submitting' THEN
  UPDATE signal_topic_editorial_calls c SET status='outcome_unknown',error_code='topic_editorial_v2_submission_unknown'
   FROM signal_topic_editorial_batch_items_v2 i WHERE i.batch_id=b.id AND c.id=i.call_id AND c.status='in_flight';
 END IF;
 UPDATE signal_topic_editorial_provider_batches_v2 SET lease_token=NULL,lease_expires_at=NULL,next_poll_at=COALESCE(next_poll,next_poll_at),
  state=CASE WHEN unknown_submission AND state='submitting' THEN 'submission_unknown' ELSE state END,error_code=failure_code WHERE id=b.id;
 RETURN true;
END $$;

CREATE FUNCTION signal_topic_editorial_owner_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_topic_editorial_batch_owners_v2%ROWTYPE;a signal_processing_admissions%ROWTYPE;prior signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;
 IF TG_OP='UPDATE' THEN
  -- An old worker cannot claim, fail, checkpoint, complete, materialize or mutate
  -- this owner. Transport leases live on the batch, never on this record.
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'topic_editorial_v2_owner_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
 IF o.execution_id IS NULL OR o.workspace_id<>NEW.workspace_id OR a.id IS NULL OR a.action<>'topic_consolidation'
  OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(a.target_id,a.workspace_id,a.organization_id,a.actor_user_id,a.execution_cap_micro_usd,a.idempotency_key,a.request_digest)
   IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,NEW.hard_cap_micro_usd,NEW.idempotency_key,NEW.request_digest)
  OR a.policy_version_id<>o.policy_version_id OR a.admission_not_after<>o.send_not_after
  OR NEW.plan_digest IS DISTINCT FROM o.plan_digest OR NOT signal_topic_editorial_plan_valid_v2(NEW.numeric_run_id,NEW.plan,o.plan_canonical_body)
  OR NEW.workspace_id::text IS DISTINCT FROM NEW.plan->'identity'->>'workspace_id'
  OR NEW.numeric_run_id::text IS DISTINCT FROM NEW.plan->'identity'->>'run_id'
  OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs numeric_run JOIN signal_workspaces workspace ON workspace.id=numeric_run.workspace_id
   WHERE numeric_run.id=NEW.numeric_run_id AND workspace.id=NEW.workspace_id AND workspace.organization_id=NEW.organization_id)
  OR NEW.source_binding IS DISTINCT FROM signal_topic_editorial_source_v1(NEW.numeric_run_id)
  OR NEW.source_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.source_binding)
  OR NEW.source_engine_execution_id::text IS DISTINCT FROM NEW.source_binding->>'source_engine_execution_id'
  OR NEW.status<>'queued' OR NEW.state_body IS NOT NULL OR NEW.state_digest IS NOT NULL OR NEW.result_revision_id IS NOT NULL
  OR NEW.execution_token IS NOT NULL OR NEW.execution_expires_at IS NOT NULL OR NEW.dispatch_generation<>1 OR NEW.attempt_count<>0
  OR NEW.supersedes_execution_id IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_v2_owner_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM signal_topic_editorial_executions WHERE numeric_run_id=NEW.numeric_run_id
  ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF prior.id IS DISTINCT FROM o.previous_execution_id OR prior.id IS NOT NULL AND
  (prior.status<>'failed' OR prior.execution_token IS NOT NULL
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=prior.id AND status NOT IN('settled','definitely_not_sent'))
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=prior.id AND status IN('queued','dispatching')))
 THEN RAISE EXCEPTION 'topic_editorial_v2_predecessor_not_quiescent' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION signal_topic_editorial_admission_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.target_id;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF o.execution_id IS NULL OR o.workspace_id<>NEW.workspace_id OR o.policy_version_id<>p.id
  OR NEW.action<>'topic_consolidation' OR NEW.automatic OR NEW.execution_cap_micro_usd<=0
  OR w.organization_id IS DISTINCT FROM NEW.organization_id OR w.brand_id IS DISTINCT FROM NEW.brand_id
  OR p.organization_id IS DISTINCT FROM NEW.organization_id OR p.status IS DISTINCT FROM 'active'
  OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2() OR a.automatic_allowed
  OR NEW.configuration IS DISTINCT FROM a.configuration OR NEW.configuration_digest IS DISTINCT FROM a.configuration_digest
  OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd OR NEW.budget_timezone<>p.budget_timezone
  OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after IS DISTINCT FROM o.send_not_after OR NEW.admission_not_after>p.valid_until
  OR NEW.admission_not_after<=clock_timestamp() OR NEW.brand_context_processing_receipt_id IS NOT NULL
  OR NEW.brand_context_prototype_receipt_id IS NOT NULL THEN
  RAISE EXCEPTION 'topic_editorial_v2_admission_invalid' USING ERRCODE='23514';END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END $$;

CREATE FUNCTION signal_topic_editorial_request_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;item jsonb;core_body text;expected_reserved bigint;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 item:=e.plan->'requests'->NEW.batch_index;core_body:=NEW.receipts->>'request_canonical_body';
 expected_reserved:=(octet_length(NEW.request_body)::bigint*3+128000::bigint*15+1)/2;
 IF e.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2' OR e.workspace_id<>NEW.workspace_id
  OR NEW.phase<>'screening' OR NEW.parent_request_id IS NOT NULL OR item IS NULL
  OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR NEW.request_digest IS DISTINCT FROM item->>'request_digest' OR NEW.request_body::jsonb IS DISTINCT FROM item->'provider_request'->'params'
  OR NEW.receipts->'request' IS DISTINCT FROM item
   OR core_body::jsonb IS DISTINCT FROM ((item-ARRAY['request_digest','provider_request'])||jsonb_build_object('params',item->'provider_request'->'params'))
  OR signal_semantic_context_digest_v1(core_body) IS DISTINCT FROM NEW.request_digest OR NEW.reserved_micro_usd<>expected_reserved THEN
  RAISE EXCEPTION 'topic_editorial_v2_request_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION signal_topic_editorial_batch_history_guard_v2() RETURNS trigger LANGUAGE plpgsql
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
     AND b.manifest_body::jsonb->'requests' @> jsonb_build_array(r.receipts->'request'->'provider_request')) THEN
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
CREATE TRIGGER topic_editorial_batch_owners_history_v2 BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_batch_owners_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_batch_history_guard_v2();
CREATE TRIGGER topic_editorial_batches_history_v2 BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_provider_batches_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_batch_history_guard_v2();
CREATE TRIGGER topic_editorial_batch_items_history_v2 BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_batch_items_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_batch_history_guard_v2();
CREATE FUNCTION signal_topic_editorial_batch_call_complete_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=NEW.id) THEN
  RAISE EXCEPTION 'topic_editorial_v2_call_item_missing' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER topic_editorial_batch_call_complete_v2 AFTER INSERT ON signal_topic_editorial_calls DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN(NEW.transport_version=2) EXECUTE FUNCTION signal_topic_editorial_batch_call_complete_v2();

CREATE FUNCTION signal_topic_editorial_batch_admission_complete_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.target_id AND processing_admission_id=NEW.id;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys WHERE execution_id=e.id AND request_digest=e.request_digest)
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)<>jsonb_array_length(e.plan->'requests')
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=e.id) THEN
  RAISE EXCEPTION 'topic_editorial_v2_admission_incomplete' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;

-- Route INSERT/UPDATE explicitly. UPDATE cannot switch identity: V2 owner guard
-- rejects every change, V1 guard rejects plan changes, and request retention is
-- unconditional. DELETE retains the original history guards.
DROP TRIGGER topic_editorial_owner_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_owner_guard BEFORE INSERT OR UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2') EXECUTE FUNCTION signal_topic_editorial_owner_guard_v1();
CREATE TRIGGER topic_editorial_owner_delete_guard BEFORE DELETE ON signal_topic_editorial_executions FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_owner_guard_v1();
CREATE TRIGGER topic_editorial_owner_guard_v2 BEFORE INSERT OR UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2') EXECUTE FUNCTION signal_topic_editorial_owner_guard_v2();
DROP TRIGGER topic_editorial_successor_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_successor_guard BEFORE INSERT ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2') EXECUTE FUNCTION signal_topic_editorial_successor_guard_v1();
DROP TRIGGER topic_editorial_state_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_state_guard BEFORE UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2') EXECUTE FUNCTION signal_topic_editorial_state_guard_v1();
DROP TRIGGER topic_editorial_request_guard ON signal_topic_editorial_requests;
CREATE TRIGGER topic_editorial_request_guard BEFORE INSERT ON signal_topic_editorial_requests FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_topic_editorial_request_guard_v1();
CREATE TRIGGER topic_editorial_request_guard_v2 BEFORE INSERT ON signal_topic_editorial_requests FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version'='signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_topic_editorial_request_guard_v2();
DROP TRIGGER processing_admission_guard ON signal_processing_admissions;
CREATE TRIGGER processing_admission_guard BEFORE INSERT ON signal_processing_admissions FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_processing_admission_guard_v1();
CREATE TRIGGER processing_admission_history_guard BEFORE UPDATE OR DELETE ON signal_processing_admissions FOR EACH ROW EXECUTE FUNCTION signal_processing_admission_guard_v1();
CREATE TRIGGER processing_admission_guard_v2 BEFORE INSERT ON signal_processing_admissions FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version'='signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_topic_editorial_admission_guard_v2();
DROP TRIGGER topic_editorial_admission_complete ON signal_processing_admissions;
CREATE CONSTRAINT TRIGGER topic_editorial_admission_complete AFTER INSERT ON signal_processing_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_topic_editorial_admission_complete_v1();
CREATE CONSTRAINT TRIGGER topic_editorial_admission_complete_v2 AFTER INSERT ON signal_processing_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.configuration->>'contract_version'='signal-topic-editorial-provider-config-v2') EXECUTE FUNCTION signal_topic_editorial_batch_admission_complete_v2();

CREATE FUNCTION admit_signal_topic_editorial_batch_v2(target_workspace uuid,target_actor uuid,plan jsonb,plan_body text,
 request_bodies jsonb,request_key text,target_policy uuid,execution_cap bigint,send_deadline timestamptz,previous_execution uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;source jsonb;hash text;prior signal_topic_editorial_request_keys%ROWTYPE;item jsonb;i integer:=0;body text;result jsonb;
BEGIN
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=target_policy;
 PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,
  'plan_digest',plan->>'plan_digest','policy_id',target_policy,'cap',execution_cap::text,'send_deadline',send_deadline::text,'previous_execution',previous_execution));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 source:=signal_topic_editorial_source_v1((plan->'identity'->>'run_id')::uuid);
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=target_policy AND action='topic_consolidation';
 IF jsonb_array_length(request_bodies)<>jsonb_array_length(plan->'requests') THEN RAISE EXCEPTION 'topic_editorial_v2_request_count_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_topic_editorial_batch_owners_v2(execution_id,workspace_id,policy_version_id,plan_canonical_body,plan_digest,send_not_after,previous_execution_id)
 VALUES(e,w.id,p.id,plan_body,plan->>'plan_digest',send_deadline,previous_execution);
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,idempotency_key,
  request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission,w.organization_id,w.id,w.brand_id,target_actor,p.id,'topic_consolidation',e,request_key,hash,'anthropic','claude-sonnet-4-6',
  action_row.configuration,action_row.configuration_digest,execution_cap,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone,send_deadline,false,'pending');
 INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,source_binding,source_digest,
  plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference)
 VALUES(e,w.id,w.organization_id,target_actor,(plan->'identity'->>'run_id')::uuid,(source->>'source_engine_execution_id')::uuid,source,
  signal_topic_editorial_digest_json_v1(source),plan,plan->>'plan_digest',admission,execution_cap,request_key,hash,'v2.'||substr(hash,8));
 FOR item IN SELECT value FROM jsonb_array_elements(plan->'requests') LOOP
  body:=request_bodies->i->>'params_body';
  INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,configuration,receipts,reserved_micro_usd)
  VALUES(w.id,e,'screening',i,item->>'request_digest',body,item->'configuration',jsonb_build_object('request',item,'request_canonical_body',request_bodies->i->>'core_body'),
   (octet_length(body)::bigint*3+128000::bigint*15+1)/2);
  i:=i+1;
 END LOOP;
 result:=jsonb_build_object('execution_id',e,'expected_items',i,'stage','screening','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
 VALUES(w.id,target_actor,request_key,e,hash,result);
 RETURN result;
END $$;

CREATE FUNCTION signal_topic_editorial_batch_authority_v2(target_execution uuid,new_spend boolean DEFAULT true) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution;
 IF e.id IS NULL OR o.execution_id IS NULL OR e.plan->>'contract_version'<>'signal-topic-editorial-screening-plan-v2' THEN
  RAISE EXCEPTION 'topic_editorial_v2_owner_invalid' USING ERRCODE='23514';END IF;
 IF NOT new_spend THEN RETURN;END IF;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,(clock_timestamp() AT TIME ZONE a.budget_timezone)::date);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=o.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=least(o.send_not_after,p.valid_until)
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR action_row.provider IS DISTINCT FROM 'anthropic' OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR p.organization_id IS DISTINCT FROM e.organization_id OR p.budget_timezone IS DISTINCT FROM a.budget_timezone
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_editorial_v2_authority_unavailable' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION reject_signal_topic_editorial_batch_submission_v2(target_batch uuid,target_submission uuid,http_status integer,body text,body_sha text,complete boolean,storage_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_topic_editorial_provider_batches_v2%ROWTYPE;c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE id=target_batch FOR UPDATE;
 IF b.id IS NULL OR b.submission_token IS DISTINCT FROM target_submission OR NOT COALESCE(complete,false)
  OR NOT COALESCE(http_status IN(400,401,403,404,413,422,429),false) OR body IS NULL OR octet_length(body)>8388608
  OR body_sha IS DISTINCT FROM signal_semantic_context_digest_v1(body) OR storage_key IS NULL OR length(storage_key) NOT BETWEEN 1 AND 1024 THEN
  RAISE EXCEPTION 'topic_editorial_v2_rejection_unproven' USING ERRCODE='23514';END IF;
 IF b.state='rejected' THEN
  IF b.provider_receipt_body IS DISTINCT FROM body OR b.rejection_http_status IS DISTINCT FROM http_status THEN
   RAISE EXCEPTION 'topic_editorial_v2_receipt_immutable' USING ERRCODE='23514';END IF;
  RETURN '{"state":"rejected","replayed":true}'::jsonb;
 END IF;
 IF b.state<>'submitting' OR b.provider_batch_id IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_v2_rejection_state_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_provider_batches_v2 SET state='rejected',provider_receipt_body=body,provider_receipt_sha256=body_sha,
  rejection_http_status=http_status,error_code='topic_editorial_v2_http_'||http_status::text,lease_token=NULL,lease_expires_at=NULL WHERE id=b.id;
 FOR c IN SELECT call.* FROM signal_topic_editorial_calls call JOIN signal_topic_editorial_batch_items_v2 i ON i.call_id=call.id WHERE i.batch_id=b.id LOOP
  UPDATE signal_topic_editorial_calls SET status='response_persisted',response_body_private=body,response_sha256=body_sha,response_storage_key=storage_key,
   response_http_status=http_status,response_complete=true,observed_micro_usd=0,response_at=clock_timestamp() WHERE id=c.id;
  UPDATE signal_topic_editorial_calls SET status='settled',settled_micro_usd=0,settled_at=clock_timestamp() WHERE id=c.id;
  UPDATE signal_topic_editorial_batch_items_v2 SET outcome='submission_rejected',received_at=clock_timestamp() WHERE call_id=c.id;
 END LOOP;
 RETURN '{"state":"rejected","replayed":false}'::jsonb;
END $$;

-- Reuse is provenance, never a second call, receipt, transport item or charge.
CREATE FUNCTION signal_topic_editorial_reuse_guard_v2() RETURNS trigger LANGUAGE plpgsql
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
  OR btrim(historical->>'rationale')='' OR jsonb_typeof(historical->'cited_ref_ids') IS DISTINCT FROM 'array'
  OR jsonb_array_length(historical->'cited_ref_ids')=0
  OR (SELECT count(DISTINCT ref) FROM jsonb_array_elements_text(historical->'cited_ref_ids') ref)<>jsonb_array_length(historical->'cited_ref_ids')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(historical->'cited_ref_ids') ref WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(receipt->'evidence') evidence WHERE evidence->>'ref_id'=ref)) THEN
  RAISE EXCEPTION 'topic_editorial_v2_reuse_decision_invalid' USING ERRCODE='23514';END IF;
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
 IF expected IS DISTINCT FROM NEW.decision THEN RAISE EXCEPTION 'topic_editorial_v2_reuse_decision_changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER topic_editorial_reused_decisions_history_v2 BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_reused_decisions_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_reuse_guard_v2();
CREATE FUNCTION reuse_signal_topic_editorial_paid_decision_v2(target_execution uuid,target_digest text,reuse_body text,reuse_sha text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE request signal_topic_editorial_requests%ROWTYPE;prior signal_topic_editorial_reused_decisions_v2%ROWTYPE;value jsonb:=reuse_body::jsonb;
BEGIN
 PERFORM 1 FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution FOR UPDATE;
 SELECT * INTO request FROM signal_topic_editorial_requests WHERE execution_id=target_execution AND request_digest=target_digest;
 IF request.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_v2_reuse_request_missing' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM signal_topic_editorial_reused_decisions_v2 WHERE request_id=request.id;
 IF prior.request_id IS NOT NULL THEN
  IF prior.body IS DISTINCT FROM reuse_body OR prior.body_sha256 IS DISTINCT FROM reuse_sha THEN
   RAISE EXCEPTION 'topic_editorial_v2_reuse_immutable' USING ERRCODE='23514';END IF;
  RETURN '{"replayed":true}'::jsonb;
 END IF;
 INSERT INTO signal_topic_editorial_reused_decisions_v2(request_id,execution_id,source_call_id,source_checkpoint_digest,decision,lineage,body,body_sha256)
 VALUES(request.id,target_execution,(value->'lineage'->>'source_call_id')::uuid,value->'lineage'->>'source_checkpoint_digest',value->'decision',value->'lineage',reuse_body,reuse_sha);
 RETURN '{"replayed":false}'::jsonb;
END $$;

ALTER TABLE signal_topic_editorial_batch_owners_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_editorial_provider_batches_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_editorial_batch_items_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_editorial_reused_decisions_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_topic_editorial_batch_owners_v2,signal_topic_editorial_provider_batches_v2,signal_topic_editorial_batch_items_v2,signal_topic_editorial_reused_decisions_v2 FROM PUBLIC;
DO $$ DECLARE f record;role_name text;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND (p.proname LIKE '%signal_topic_editorial%v2' OR p.proname='signal_topic_editorial_configuration_v2') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;
  END LOOP;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_topic_editorial_batch_owners_v2,signal_topic_editorial_provider_batches_v2,signal_topic_editorial_batch_items_v2,signal_topic_editorial_reused_decisions_v2 FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
