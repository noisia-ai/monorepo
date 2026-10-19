-- V3 is an additive representation for NEW Message Batches admissions. Paid
-- V1/V2 plans, request rows, owner identities and ledger entries stay intact.
-- Installation alone neither admits an execution nor calls a provider.

CREATE FUNCTION signal_topic_editorial_header_valid_v3(target_run uuid,header jsonb,canonical_body text)
 RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_consolidation_runs%ROWTYPE;source jsonb;
BEGIN
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=target_run;
 source:=signal_topic_editorial_source_v1(target_run);
 IF run.id IS NULL OR source IS NULL OR header->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-admission-header-v3'
  OR header->'identity'->>'workspace_id' IS DISTINCT FROM run.workspace_id::text
  OR header->'identity'->>'run_id' IS DISTINCT FROM target_run::text
  OR header->'identity'->>'source_context_digest' IS DISTINCT FROM run.context_digest
  OR header->'identity'->>'editorial_context_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(header->'source_context')
  OR header->'configuration' IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR NOT COALESCE(header->>'source_plan_digest' ~ '^sha256:[a-f0-9]{64}$',false)
  OR NOT COALESCE(header->'identity'->>'snapshot_digest' ~ '^sha256:[a-f0-9]{64}$',false)
  OR header-'admission_digest' IS DISTINCT FROM canonical_body::jsonb
  OR header->>'admission_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_body)
  OR jsonb_typeof(header->'requests') IS DISTINCT FROM 'array'
  OR jsonb_array_length(header->'requests')<>run.expected_group_count
  OR header->>'expected_group_count' IS DISTINCT FROM run.expected_group_count::text
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(header->'requests') WITH ORDINALITY item(value,ordinality)
     WHERE value->>'batch_index' IS DISTINCT FROM (ordinality-1)::text
      OR value->>'group_key' IS NULL OR NOT COALESCE(value->>'group_digest' ~ '^sha256:[a-f0-9]{64}$',false)
      OR NOT COALESCE(value->>'request_digest' ~ '^sha256:[a-f0-9]{64}$',false)
      OR value->>'custom_id' IS DISTINCT FROM 'e2_'||substr(value->>'request_digest',8,60))
  OR (SELECT count(DISTINCT value->>'group_key') FROM jsonb_array_elements(header->'requests'))<>run.expected_group_count
  OR (SELECT count(DISTINCT value->>'request_digest') FROM jsonb_array_elements(header->'requests'))<>run.expected_group_count
 THEN RETURN false;END IF;
 RETURN true;
END $$;

CREATE FUNCTION append_signal_topic_editorial_batch_v3(target_execution uuid,rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_editorial_executions%ROWTYPE;item jsonb;request jsonb;position integer;
 params_body text;core_body text;source_group_body text;inserted integer:=0;
BEGIN
 SELECT * INTO execution FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 IF execution.id IS NULL OR execution.plan->>'contract_version'<>'signal-topic-editorial-admission-header-v3'
  OR jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_array_length(rows) NOT BETWEEN 1 AND 256
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys WHERE execution_id=target_execution)
 THEN RAISE EXCEPTION 'topic_editorial_v3_append_unavailable' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
  position:=(item->>'batch_index')::integer;request:=item->'request';
  params_body:=item->>'params_body';core_body:=item->>'core_body';source_group_body:=item->>'source_group_body';
  IF position IS NULL OR position<0 OR position>=(execution.plan->>'expected_group_count')::integer
   OR params_body IS NULL OR core_body IS NULL OR source_group_body IS NULL
  THEN RAISE EXCEPTION 'topic_editorial_v3_request_invalid' USING ERRCODE='23514';END IF;
  INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,
   configuration,receipts,reserved_micro_usd)
  VALUES(execution.workspace_id,execution.id,'screening',position,request->>'request_digest',params_body,
   request->'configuration',jsonb_build_object('request',request,'request_canonical_body',core_body,
    'source_group_canonical_body',source_group_body),
   (octet_length(params_body)::bigint*3+128000::bigint*15+1)/2);
  inserted:=inserted+1;
 END LOOP;
 RETURN jsonb_build_object('inserted',inserted);
END $$;

CREATE FUNCTION finalize_signal_topic_editorial_batch_v3(target_execution uuid,target_actor uuid,request_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_editorial_executions%ROWTYPE;owner signal_topic_editorial_batch_owners_v2%ROWTYPE;
 expected integer;actual integer;matched integer;request_hash text;result jsonb;snapshot_digest text;
BEGIN
 SELECT * INTO execution FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution;
 expected:=(execution.plan->>'expected_group_count')::integer;
 SELECT count(*)::integer,count(*) FILTER (WHERE summary.value->>'request_digest'=request.request_digest
  AND summary.value->>'group_key'=request.receipts->'request'->'receipt'->>'group_key'
  AND summary.value->>'group_digest'=request.receipts->'request'->'receipt'->>'group_digest')::integer
 INTO actual,matched FROM signal_topic_editorial_requests request
 JOIN LATERAL (SELECT execution.plan->'requests'->request.batch_index value) summary ON true
 WHERE request.execution_id=target_execution;
 IF execution.id IS NULL OR execution.plan->>'contract_version'<>'signal-topic-editorial-admission-header-v3'
  OR execution.actor_user_id IS DISTINCT FROM target_actor OR execution.idempotency_key IS DISTINCT FROM request_key
  OR owner.execution_id IS NULL OR actual IS DISTINCT FROM expected OR matched IS DISTINCT FROM expected
  OR signal_topic_editorial_source_v1(execution.numeric_run_id) IS DISTINCT FROM execution.source_binding
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys WHERE execution_id=target_execution)
 THEN RAISE EXCEPTION 'topic_editorial_v3_admission_incomplete' USING ERRCODE='23514';END IF;
 -- The V2 snapshot identity is recomputed from the admitted ordered source
 -- groups; no sampled or summary-only group can satisfy this seal.
 SELECT signal_topic_editorial_digest_json_v1(jsonb_build_object(
  'contract_version','signal-topic-editorial-snapshot-v2',
  'workspace_id',execution.workspace_id,'run_id',execution.numeric_run_id,
  'source_context_digest',execution.plan->'identity'->>'source_context_digest',
  'editorial_context_digest',execution.plan->'identity'->>'editorial_context_digest',
  'source_group_digests',jsonb_agg(r.receipts->'request'->'receipt'->>'source_group_digest' ORDER BY r.batch_index)))
 INTO snapshot_digest FROM signal_topic_editorial_requests r WHERE r.execution_id=target_execution;
 IF snapshot_digest IS DISTINCT FROM execution.plan->'identity'->>'snapshot_digest' THEN
  RAISE EXCEPTION 'topic_editorial_v3_snapshot_changed' USING ERRCODE='23514';END IF;
 request_hash:=execution.request_digest;
 result:=jsonb_build_object('execution_id',execution.id,'expected_items',expected,'stage','screening','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
 VALUES(execution.workspace_id,execution.actor_user_id,request_key,execution.id,request_hash,result);
 RETURN result;
END $$;

CREATE FUNCTION replay_signal_topic_editorial_batch_v3_unprepared(target_workspace uuid,target_actor uuid,
 target_numeric_execution uuid,request_key text,expected_quote text,confirmed_cap bigint) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 admission signal_processing_admissions%ROWTYPE;owner signal_topic_editorial_batch_owners_v2%ROWTYPE;
 expected integer;actual integer;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v2\.[0-9]{10}\.[a-f0-9]{64}$'
  AND confirmed_cap>0,false) THEN RAISE EXCEPTION 'topic_editorial_v3_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NULL THEN RETURN '{"replayed":false}'::jsonb;END IF;
 SELECT execution.* INTO e FROM signal_topic_editorial_executions execution
  JOIN signal_topic_consolidation_executions control_run ON control_run.workspace_id=execution.workspace_id
   AND control_run.consolidation_run_id=execution.numeric_run_id AND control_run.id=target_numeric_execution
  WHERE execution.id=prior.execution_id AND execution.workspace_id=target_workspace
   AND execution.actor_user_id=target_actor AND execution.plan->>'contract_version'='signal-topic-editorial-admission-header-v3';
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id;
 expected:=(e.plan->>'expected_group_count')::integer;
 SELECT count(*)::integer INTO actual FROM signal_topic_editorial_requests WHERE execution_id=e.id;
 IF e.id IS NULL OR owner.execution_id IS NULL OR admission.id IS NULL OR actual IS DISTINCT FROM expected
  OR e.quote_reference IS DISTINCT FROM expected_quote OR e.hard_cap_micro_usd IS DISTINCT FROM confirmed_cap
  OR e.request_digest IS DISTINCT FROM prior.request_digest OR admission.request_digest IS DISTINCT FROM prior.request_digest
  OR admission.target_id IS DISTINCT FROM e.id OR admission.idempotency_key IS DISTINCT FROM request_key
  OR owner.plan_digest IS DISTINCT FROM e.plan_digest
 THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
 RETURN prior.result||'{"replayed":true}'::jsonb;
END $$;

CREATE FUNCTION begin_signal_topic_editorial_batch_v3(target_workspace uuid,target_actor uuid,header jsonb,header_body text,
 request_key text,expected_quote text,previous_execution uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();w signal_workspaces%ROWTYPE;
 policy signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
 quote jsonb;source jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;request_hash text;deadline bigint;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v2\.[0-9]{10}\.[a-f0-9]{64}$',false)
  OR header_body IS NULL OR header->>'admission_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(header_body)
  OR header-'admission_digest' IS DISTINCT FROM header_body::jsonb
  OR header->'identity'->>'workspace_id' IS DISTINCT FROM target_workspace::text
  OR signal_topic_editorial_header_valid_v3((header->'identity'->>'run_id')::uuid,header,header_body) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'topic_editorial_v3_header_invalid' USING ERRCODE='23514';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_batch_owners_v2 owner ON owner.execution_id=e.id
    WHERE e.id=prior.execution_id AND e.plan->>'contract_version'='signal-topic-editorial-admission-header-v3'
     AND e.plan_digest=header->>'admission_digest' AND e.quote_reference=expected_quote
     AND e.request_digest=prior.request_digest AND owner.previous_execution_id IS NOT DISTINCT FROM previous_execution)
  THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF policy.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
 PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE policy.budget_timezone)::date);
 deadline:=split_part(expected_quote,'.',2)::bigint;
 quote:=signal_topic_editorial_quote_fast_v2(target_workspace,target_actor,(header->'identity'->>'run_id')::uuid,
  header->>'admission_digest',(header->>'expected_group_count')::integer,deadline);
 IF quote->>'status'<>'ready_to_authorize' OR quote->>'quote_reference' IS DISTINCT FROM expected_quote THEN
  RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE id=(quote->>'policy_id')::uuid;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='topic_consolidation';
 source:=signal_topic_editorial_source_v1((header->'identity'->>'run_id')::uuid);
 request_hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,
  'plan_digest',header->>'admission_digest','policy_id',policy.id,'cap',(quote->>'hard_cap_micro_usd'),
  'send_deadline',(quote->>'send_deadline')::timestamptz::text,'previous_execution',previous_execution));
 INSERT INTO signal_topic_editorial_batch_owners_v2(execution_id,workspace_id,policy_version_id,plan_canonical_body,
  plan_digest,send_not_after,previous_execution_id) VALUES(execution,target_workspace,policy.id,header_body,
  header->>'admission_digest',(quote->>'send_deadline')::timestamptz,previous_execution);
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,
  target_id,idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,
  budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission,w.organization_id,w.id,w.brand_id,target_actor,policy.id,'topic_consolidation',execution,request_key,request_hash,
  'anthropic','claude-sonnet-4-6',action_row.configuration,action_row.configuration_digest,(quote->>'hard_cap_micro_usd')::bigint,
  (clock_timestamp() AT TIME ZONE policy.budget_timezone)::date,policy.budget_timezone,
  (quote->>'send_deadline')::timestamptz,false,'pending');
 INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,
  source_engine_execution_id,source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,
  idempotency_key,request_digest,quote_reference)
 VALUES(execution,w.id,w.organization_id,target_actor,(header->'identity'->>'run_id')::uuid,
  (source->>'source_engine_execution_id')::uuid,source,signal_topic_editorial_digest_json_v1(source),header,
  header->>'admission_digest',admission,(quote->>'hard_cap_micro_usd')::bigint,request_key,request_hash,expected_quote);
 RETURN jsonb_build_object('execution_id',execution,'expected_items',(header->>'expected_group_count')::integer,
  'stage','screening','replayed',false);
END $$;

-- V3 uses the same policy/admission and owner tables, but its immutable plan
-- contains only the header. The V1/V2 triggers continue to protect old rows.
ALTER TABLE signal_topic_editorial_executions DROP CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check,
 ADD CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check CHECK(hard_cap_micro_usd>0 AND
 (plan->>'contract_version' IN('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
  OR hard_cap_micro_usd<=30000000));

CREATE FUNCTION signal_topic_editorial_owner_guard_v3() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_editorial_batch_owners_v2%ROWTYPE;admission signal_processing_admissions%ROWTYPE;
 prior signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'topic_editorial_v3_owner_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.id;
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
 IF owner.execution_id IS NULL OR owner.workspace_id IS DISTINCT FROM NEW.workspace_id OR admission.id IS NULL
  OR admission.action IS DISTINCT FROM 'topic_consolidation'
  OR admission.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(admission.target_id,admission.workspace_id,admission.organization_id,admission.actor_user_id,
    admission.execution_cap_micro_usd,admission.idempotency_key,admission.request_digest)
   IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,
    NEW.hard_cap_micro_usd,NEW.idempotency_key,NEW.request_digest)
  OR admission.policy_version_id IS DISTINCT FROM owner.policy_version_id
  OR admission.admission_not_after IS DISTINCT FROM owner.send_not_after
  OR NEW.plan_digest IS DISTINCT FROM owner.plan_digest
  OR NEW.plan_digest IS DISTINCT FROM NEW.plan->>'admission_digest'
  OR signal_topic_editorial_header_valid_v3(NEW.numeric_run_id,NEW.plan,owner.plan_canonical_body) IS DISTINCT FROM true
  OR NEW.workspace_id::text IS DISTINCT FROM NEW.plan->'identity'->>'workspace_id'
  OR NEW.numeric_run_id::text IS DISTINCT FROM NEW.plan->'identity'->>'run_id'
  OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs run JOIN signal_workspaces w ON w.id=run.workspace_id
    WHERE run.id=NEW.numeric_run_id AND w.id=NEW.workspace_id AND w.organization_id=NEW.organization_id)
  OR NEW.source_binding IS DISTINCT FROM signal_topic_editorial_source_v1(NEW.numeric_run_id)
  OR NEW.source_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.source_binding)
  OR NEW.source_engine_execution_id::text IS DISTINCT FROM NEW.source_binding->>'source_engine_execution_id'
  OR NEW.status<>'queued' OR NEW.state_body IS NOT NULL OR NEW.state_digest IS NOT NULL OR NEW.result_revision_id IS NOT NULL
  OR NEW.execution_token IS NOT NULL OR NEW.execution_expires_at IS NOT NULL OR NEW.dispatch_generation<>1 OR NEW.attempt_count<>0
  OR NEW.supersedes_execution_id IS NOT NULL THEN
  RAISE EXCEPTION 'topic_editorial_v3_owner_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM signal_topic_editorial_executions WHERE numeric_run_id=NEW.numeric_run_id
  ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF prior.id IS DISTINCT FROM owner.previous_execution_id OR prior.id IS NOT NULL AND
  (prior.status<>'failed' OR prior.execution_token IS NOT NULL
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=prior.id AND status NOT IN('settled','definitely_not_sent'))
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=prior.id AND status IN('queued','dispatching')))
 THEN RAISE EXCEPTION 'topic_editorial_v3_predecessor_not_quiescent' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

DROP TRIGGER topic_editorial_owner_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_owner_guard BEFORE INSERT OR UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' NOT IN('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3'))
 EXECUTE FUNCTION signal_topic_editorial_owner_guard_v1();
DROP TRIGGER topic_editorial_successor_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_successor_guard BEFORE INSERT ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' NOT IN('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3'))
 EXECUTE FUNCTION signal_topic_editorial_successor_guard_v1();
DROP TRIGGER topic_editorial_state_guard ON signal_topic_editorial_executions;
CREATE TRIGGER topic_editorial_state_guard BEFORE UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version' NOT IN('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3'))
 EXECUTE FUNCTION signal_topic_editorial_state_guard_v1();
CREATE TRIGGER topic_editorial_owner_guard_v3 BEFORE INSERT OR UPDATE ON signal_topic_editorial_executions FOR EACH ROW
 WHEN(NEW.plan->>'contract_version'='signal-topic-editorial-admission-header-v3')
 EXECUTE FUNCTION signal_topic_editorial_owner_guard_v3();

-- Validate one exact request against its immutable atomic group and cited
-- evidence. This is bounded per row; no 80 MB JSONB plan is passed or scanned.
CREATE FUNCTION signal_topic_editorial_request_valid_v3(target_run uuid,header jsonb,item jsonb,core_body text,params_body text,
 source_group_body text,
 batch_position integer) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_consolidation_runs%ROWTYPE;g signal_topic_atomic_groups%ROWTYPE;
 projected jsonb;receipt jsonb;evidence jsonb;summary jsonb;
BEGIN
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=target_run;
 summary:=header->'requests'->batch_position;receipt:=item->'receipt';projected:=item->'source_group';
 SELECT * INTO g FROM signal_topic_atomic_groups WHERE consolidation_run_id=target_run AND workspace_id=run.workspace_id
  AND group_key=receipt->>'group_key';
 IF run.id IS NULL OR g.id IS NULL OR summary IS NULL OR batch_position<0
  OR item->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-group-request-record-v2'
  OR item->'identity' IS DISTINCT FROM header->'identity'
  OR item->'configuration' IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR item->'source_context' IS DISTINCT FROM header->'source_context'
  OR summary->>'group_key' IS DISTINCT FROM g.group_key
  OR summary->>'group_digest' IS DISTINCT FROM g.group_digest
  OR summary->>'request_digest' IS DISTINCT FROM item->>'request_digest'
  OR summary->>'custom_id' IS DISTINCT FROM item->'provider_request'->>'custom_id'
  OR receipt->>'group_digest' IS DISTINCT FROM g.group_digest
  OR NOT COALESCE(receipt->>'source_group_digest' ~ '^sha256:[a-f0-9]{64}$',false)
  OR receipt->>'source_dossier_digest' IS DISTINCT FROM g.dossier_digest
  OR projected IS DISTINCT FROM source_group_body::jsonb
  OR receipt->>'source_group_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(source_group_body)
  OR projected->>'group_key' IS DISTINCT FROM g.group_key
  OR projected->>'group_digest' IS DISTINCT FROM g.group_digest
  OR projected->>'source_dossier_digest' IS DISTINCT FROM g.dossier_digest
  OR projected->>'dossier_digest' IS DISTINCT FROM receipt->>'dossier_digest'
  OR projected->>'lane' IS DISTINCT FROM g.lane
  OR projected->>'root_count' IS DISTINCT FROM g.root_count::text
  OR projected->>'chunk_count' IS DISTINCT FROM g.chunk_count::text
  OR projected->'terms' IS DISTINCT FROM to_jsonb(g.terms)
  OR (projected-ARRAY['group_key','lane','group_digest','source_dossier_digest','dossier_digest','community_key','root_count','chunk_count','terms','evidence'])
    IS DISTINCT FROM (g.dossier-ARRAY['contract_version','evidence'])
  OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_community_members m JOIN signal_topic_consolidation_communities c ON c.id=m.community_id
    WHERE m.atomic_group_id=g.id AND c.community_key=projected->>'community_key')
  OR jsonb_typeof(projected->'evidence') IS DISTINCT FROM 'array'
  OR jsonb_typeof(receipt->'evidence') IS DISTINCT FROM 'array'
  OR jsonb_array_length(projected->'evidence')<>jsonb_array_length(receipt->'evidence')
  OR receipt->>'expected_locale' IS DISTINCT FROM header->'source_context'->>'default_locale'
  OR ((item-'request_digest'-'provider_request')||jsonb_build_object('params',item->'provider_request'->'params')) IS DISTINCT FROM core_body::jsonb
  OR item->>'request_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(core_body)
  OR item->'provider_request'->'params' IS DISTINCT FROM params_body::jsonb
  OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item->'provider_request'->'params') key)
     IS DISTINCT FROM ARRAY['max_tokens','messages','model','output_config','system','thinking']
  OR item->'provider_request'->>'custom_id' IS DISTINCT FROM 'e2_'||substr(item->>'request_digest',8,60)
  OR jsonb_typeof(item->'provider_request'->'params'->'messages') IS DISTINCT FROM 'array'
  OR jsonb_array_length(item->'provider_request'->'params'->'messages')<>1
  OR item->'provider_request'->'params'->'messages'->0->>'role' IS DISTINCT FROM 'user'
  OR jsonb_typeof(item->'provider_request'->'params'->'messages'->0->'content') IS DISTINCT FROM 'string'
  OR item->'provider_request'->'params'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR item->'provider_request'->'params'->>'max_tokens' IS DISTINCT FROM '128000'
  OR item->'provider_request'->'params'->'thinking' IS DISTINCT FROM '{"type":"disabled"}'::jsonb
  OR item->'provider_request'->'params'->'output_config' IS DISTINCT FROM jsonb_build_object('effort','high','format',
    jsonb_build_object('type','json_schema','schema',signal_topic_editorial_output_schema_v2(receipt)))
  OR item->>'schema_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(signal_topic_editorial_output_schema_v2(receipt))
  OR signal_semantic_context_digest_v1(to_json(item->'provider_request'->'params'->>'system')::text)
     IS DISTINCT FROM signal_topic_editorial_configuration_v2()->>'prompt_digest'
  OR (SELECT count(DISTINCT value->>'ref_id') FROM jsonb_array_elements(receipt->'evidence'))<>jsonb_array_length(receipt->'evidence')
  OR (SELECT count(DISTINCT value->>'evidence_id') FROM jsonb_array_elements(receipt->'evidence'))<>jsonb_array_length(receipt->'evidence')
 THEN RETURN false;END IF;
 FOR evidence IN SELECT value FROM jsonb_array_elements(projected->'evidence') LOOP
  IF NOT EXISTS(SELECT 1 FROM signal_topic_atomic_group_evidence e WHERE e.atomic_group_id=g.id AND e.ref_id=evidence->>'ref_id')
   OR NOT(g.dossier->'evidence' @> jsonb_build_array(evidence-'text'))
   OR signal_semantic_context_digest_v1(evidence->>'text') IS DISTINCT FROM evidence->>'chunk_sha256'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'evidence') x WHERE x.value-'evidence_id'=
     evidence-ARRAY['text','locale','platform','occurred_at']) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_request_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;item jsonb;core_body text;source_group_body text;expected_reserved bigint;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 core_body:=NEW.receipts->>'request_canonical_body';
 source_group_body:=NEW.receipts->>'source_group_canonical_body';
 expected_reserved:=(octet_length(NEW.request_body)::bigint*3+128000::bigint*15+1)/2;
 IF e.plan->>'contract_version'='signal-topic-editorial-admission-header-v3' THEN
  IF e.workspace_id IS DISTINCT FROM NEW.workspace_id OR NEW.phase<>'screening' OR NEW.parent_request_id IS NOT NULL
   OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
   OR NEW.request_digest IS DISTINCT FROM NEW.receipts->'request'->>'request_digest'
   OR NEW.reserved_micro_usd<>expected_reserved
   OR signal_topic_editorial_request_valid_v3(e.numeric_run_id,e.plan,NEW.receipts->'request',core_body,NEW.request_body,source_group_body,NEW.batch_index) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'topic_editorial_v3_request_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 item:=e.plan->'requests'->NEW.batch_index;
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

CREATE OR REPLACE FUNCTION signal_topic_editorial_batch_authority_v2(target_execution uuid,new_spend boolean DEFAULT true) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution;
 IF e.id IS NULL OR o.execution_id IS NULL OR e.plan->>'contract_version' NOT IN
  ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3') THEN
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

-- No provider batch may be prepared from an unfinished V3 transaction, even
-- if a future caller invokes the historical prepare function directly.
CREATE FUNCTION signal_topic_editorial_v3_prepare_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_editorial_executions%ROWTYPE;actual integer;
BEGIN
 SELECT * INTO execution FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 IF execution.plan->>'contract_version'='signal-topic-editorial-admission-header-v3' THEN
  SELECT count(*)::integer INTO actual FROM signal_topic_editorial_requests WHERE execution_id=execution.id;
  IF actual IS DISTINCT FROM (execution.plan->>'expected_group_count')::integer
   OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys k WHERE k.execution_id=execution.id
     AND k.idempotency_key=execution.idempotency_key AND k.request_digest=execution.request_digest)
  THEN RAISE EXCEPTION 'topic_editorial_v3_preparation_incomplete' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER topic_editorial_v3_prepare_guard BEFORE INSERT ON signal_topic_editorial_provider_batches_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_v3_prepare_guard();

REVOKE ALL ON FUNCTION signal_topic_editorial_header_valid_v3(uuid,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_request_valid_v3(uuid,jsonb,jsonb,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION begin_signal_topic_editorial_batch_v3(uuid,uuid,jsonb,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_signal_topic_editorial_batch_v3(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_signal_topic_editorial_batch_v3(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v3_unprepared(uuid,uuid,uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_owner_guard_v3() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_v3_prepare_guard() FROM PUBLIC;
DO $$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_header_valid_v3(uuid,jsonb,text) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_request_valid_v3(uuid,jsonb,jsonb,text,text,text,integer) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION begin_signal_topic_editorial_batch_v3(uuid,uuid,jsonb,text,text,text,uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION append_signal_topic_editorial_batch_v3(uuid,jsonb) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION finalize_signal_topic_editorial_batch_v3(uuid,uuid,text) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v3_unprepared(uuid,uuid,uuid,text,text,bigint) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_owner_guard_v3() FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_v3_prepare_guard() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

-- Preparation recovery accepts V3; exact historical V2 semantics remain unchanged.
CREATE OR REPLACE FUNCTION mark_signal_topic_editorial_batch_preparation_failed_v2(target_execution uuid) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution;
 IF e.id IS NULL OR e.plan->>'contract_version' NOT IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
  OR o.execution_id IS NULL OR o.workspace_id IS DISTINCT FROM e.workspace_id
  OR o.plan_digest IS DISTINCT FROM e.plan_digest
  OR o.stage NOT IN('screening','preparation_failed')
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id)
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id) THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 IF o.stage='screening' THEN
  UPDATE signal_topic_editorial_batch_owners_v2 SET stage='preparation_failed' WHERE execution_id=e.id;
 END IF;
 RETURN jsonb_build_object('execution_id',e.id,'stage','preparation_failed','replayed',o.stage='preparation_failed');
END $$;

CREATE OR REPLACE FUNCTION retry_signal_topic_editorial_batch_preparation_v2(target_workspace uuid,target_actor uuid,
 target_execution uuid,request_key text) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 retry_digest text;result jsonb;is_replay boolean:=false;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN
  RAISE EXCEPTION 'topic_editorial_v2_request_invalid' USING ERRCODE='22023';
 END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));

 SELECT * INTO prior FROM signal_topic_editorial_request_keys
  WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL AND prior.execution_id<>target_execution THEN
  RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';
 END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions
  WHERE id=target_execution AND workspace_id=target_workspace AND actor_user_id=target_actor FOR UPDATE;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2
  WHERE execution_id=e.id AND workspace_id=target_workspace;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 IF e.id IS NULL OR o.execution_id IS NULL
  OR e.plan->>'contract_version' NOT IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
  OR o.plan_digest IS DISTINCT FROM e.plan_digest
  OR a.id IS NULL OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.actor_user_id IS DISTINCT FROM e.actor_user_id
  OR a.action IS DISTINCT FROM 'topic_consolidation' OR a.target_id IS DISTINCT FROM e.id
  OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR a.idempotency_key IS DISTINCT FROM e.idempotency_key OR a.request_digest IS DISTINCT FROM e.request_digest THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 retry_digest:=signal_topic_editorial_digest_json_v1(jsonb_build_object(
  'action','retry_preparation','workspace_id',e.workspace_id,'actor_user_id',e.actor_user_id,
  'execution_id',e.id,'plan_digest',e.plan_digest,'processing_admission_id',e.processing_admission_id,
  'admission_request_digest',e.request_digest));
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM retry_digest THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';
  END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 IF o.stage IS DISTINCT FROM 'preparation_failed'
  OR e.status NOT IN('queued','running')
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id)
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id)
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(e.plan->'requests')=0
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)
    IS DISTINCT FROM jsonb_array_length(e.plan->'requests') THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 UPDATE signal_topic_editorial_batch_owners_v2 SET stage='screening' WHERE execution_id=e.id;
 result:=jsonb_build_object('execution_id',e.id,'stage','screening','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
  VALUES(e.workspace_id,e.actor_user_id,request_key,e.id,retry_digest,result);
 RETURN result;
END $$;
