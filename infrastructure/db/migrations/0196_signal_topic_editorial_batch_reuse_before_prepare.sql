-- Separate idempotent admission from manifest reservation so compatible paid
-- V1 group results can be durably linked before any V2 provider call is created.
-- The sealed V2 plan remains the durable all-group manifest; the provider batch
-- contains only requests without a compatible reused decision.
CREATE FUNCTION request_signal_topic_editorial_batch_v2_unprepared(target_workspace uuid,target_actor uuid,plan jsonb,plan_body text,
 request_bodies jsonb,request_key text,expected_quote text,previous_execution uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;q jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;
 result jsonb;deadline bigint;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v2\.[0-9]{10}\.[a-f0-9]{64}$',false)
  OR plan_body IS NULL OR plan_body::jsonb IS DISTINCT FROM (plan-'plan_digest')
  OR signal_semantic_context_digest_v1(plan_body) IS DISTINCT FROM plan->>'plan_digest' THEN
  RAISE EXCEPTION 'topic_editorial_v2_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,
    'actor_user_id',target_actor,'plan_digest',plan->>'plan_digest','policy_id',(SELECT policy_version_id FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id),
    'cap',(SELECT hard_cap_micro_usd::text FROM signal_topic_editorial_executions WHERE id=prior.execution_id),
    'send_deadline',(SELECT send_not_after::text FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id),
    'previous_execution',(SELECT previous_execution_id FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id))) THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 deadline:=split_part(expected_quote,'.',2)::bigint;
 q:=signal_topic_editorial_quote_v2(target_workspace,target_actor,(plan->'identity'->>'run_id')::uuid,plan,plan_body,deadline);
 IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM expected_quote THEN
  RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=(q->>'policy_id')::uuid;
 result:=admit_signal_topic_editorial_batch_v2(target_workspace,target_actor,plan,plan_body,request_bodies,request_key,
  p.id,(q->>'hard_cap_micro_usd')::bigint,(q->>'send_deadline')::timestamptz,previous_execution);
 RETURN result;
END $$;

-- Recovery accepts the durable admission even when a process died before the
-- compatible-result pass or provider-manifest preparation. The caller replays
-- those idempotent local DB steps before the Worker can claim anything.
CREATE FUNCTION replay_signal_topic_editorial_batch_v2_unprepared(target_workspace uuid,target_actor uuid,target_numeric_execution uuid,request_key text,
 expected_quote text,confirmed_cap bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;body jsonb;deadline bigint;b signal_topic_editorial_provider_batches_v2%ROWTYPE;
 expected_manifest text;expected_digest text;request_count integer;reused_count integer;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v2\.[0-9]{10}\.[a-f0-9]{64}$' AND confirmed_cap>0,false) THEN
  RAISE EXCEPTION 'topic_editorial_v2_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NULL THEN RETURN '{"replayed":false}'::jsonb;END IF;
 SELECT execution.* INTO e FROM signal_topic_editorial_executions execution
  JOIN signal_topic_consolidation_executions control_run ON control_run.workspace_id=execution.workspace_id
   AND control_run.consolidation_run_id=execution.numeric_run_id AND control_run.id=target_numeric_execution
  WHERE execution.id=prior.execution_id AND execution.workspace_id=target_workspace AND execution.actor_user_id=target_actor
   AND execution.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2';
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=target_workspace;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=o.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 deadline:=split_part(expected_quote,'.',2)::bigint;
 body:=jsonb_build_object('workspace_id',e.workspace_id,'actor_user_id',e.actor_user_id,'run_id',e.numeric_run_id,
  'source_binding',e.source_binding,'plan_digest',e.plan_digest,'policy_id',p.id,'policy_digest',p.policy_digest,
  'configuration_digest',action_row.configuration_digest,'hard_cap_micro_usd',e.hard_cap_micro_usd::text,
  'budget_date',a.budget_date::text,'budget_timezone',a.budget_timezone,'send_deadline',o.send_not_after,'deadline',deadline::text);
 IF e.id IS NULL OR e.hard_cap_micro_usd<>confirmed_cap OR p.id IS NULL OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR expected_quote IS DISTINCT FROM 'v2.'||deadline::text||'.'||substr(signal_semantic_context_digest_json_v2(body),8)
  OR prior.request_digest IS DISTINCT FROM e.request_digest OR a.id IS DISTINCT FROM e.processing_admission_id
  OR a.workspace_id IS DISTINCT FROM target_workspace OR a.actor_user_id IS DISTINCT FROM target_actor
  OR a.target_id IS DISTINCT FROM e.id OR a.idempotency_key IS DISTINCT FROM request_key
  OR a.request_digest IS DISTINCT FROM e.request_digest THEN
  RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
 SELECT count(*),count(*) FILTER(WHERE reused.request_id IS NOT NULL),
   jsonb_build_object('requests',jsonb_agg(request.value->'provider_request' ORDER BY request.ordinality)
     FILTER(WHERE reused.request_id IS NULL))::text
  INTO request_count,reused_count,expected_manifest
  FROM jsonb_array_elements(e.plan->'requests') WITH ORDINALITY request(value,ordinality)
  JOIN signal_topic_editorial_requests r ON r.execution_id=e.id AND r.request_digest=request.value->>'request_digest'
  LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id;
 IF request_count<>jsonb_array_length(e.plan->'requests') THEN RAISE EXCEPTION 'topic_editorial_v2_replay_unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id AND submission_key='v2-full-'||replace(e.id::text,'-','');
 IF b.id IS NOT NULL THEN
  expected_digest:=signal_semantic_context_digest_v1(expected_manifest);
  IF b.manifest_digest IS DISTINCT FROM expected_digest OR b.manifest_digest IS DISTINCT FROM signal_semantic_context_digest_v1(b.manifest_body)
   OR b.manifest_body::jsonb IS DISTINCT FROM expected_manifest::jsonb THEN
   RAISE EXCEPTION 'topic_editorial_v2_replay_unavailable' USING ERRCODE='23514';END IF;
 ELSIF reused_count<>request_count AND expected_manifest IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_v2_replay_unavailable' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('replayed',true,'execution_id',e.id,'expected_items',request_count,'stage','screening',
  'batch_id',b.id,'manifest_digest',b.manifest_digest,'reused_items',reused_count);
END $$;

REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2_unprepared(uuid,uuid,jsonb,text,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v2_unprepared(uuid,uuid,uuid,text,text,bigint) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2_unprepared(uuid,uuid,jsonb,text,jsonb,text,text,uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v2_unprepared(uuid,uuid,uuid,text,text,bigint) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
