-- Server quote and atomic admission for the V2 Message Batches path.
-- The quote uses the active topic_consolidation policy maximum; the historical
-- V1 USD 20/30 experiment ceilings do not apply to this V2 configuration.
CREATE FUNCTION signal_topic_editorial_quote_v2(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,plan_body text,
 expected_deadline bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 org uuid;exposure bigint;expiry bigint;send_deadline timestamptz;body jsonb;cap bigint;day date;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text
  OR NOT signal_topic_editorial_plan_valid_v2(target_run,plan,plan_body) THEN
  RETURN '{"status":"source_stale"}'::jsonb;END IF;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN RETURN '{"status":"policy_required"}'::jsonb;END IF;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF a.action IS NULL OR a.automatic_allowed OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR a.provider IS DISTINCT FROM 'anthropic' OR a.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
  RETURN '{"status":"policy_action_required"}'::jsonb;END IF;
 cap:=a.max_execution_micro_usd;day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(org,day,p.budget_timezone);
 IF cap<=0 OR exposure IS NULL OR exposure::numeric+cap::numeric>p.daily_cap_micro_usd::numeric THEN
  RETURN '{"status":"budget_unavailable"}'::jsonb;END IF;
 send_deadline:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 expiry:=COALESCE(expected_deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '5 minutes',send_deadline)))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '5 minutes',send_deadline) THEN
  RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'run_id',target_run,
  'source_binding',source,'plan_digest',plan->>'plan_digest','policy_id',p.id,'policy_digest',p.policy_digest,
  'configuration_digest',a.configuration_digest,'hard_cap_micro_usd',cap::text,'budget_date',day::text,
  'budget_timezone',p.budget_timezone,'send_deadline',send_deadline,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize','quote_reference','v2.'||expiry::text||'.'||
  substr(signal_semantic_context_digest_json_v2(body),8),'quote_expires_at',to_timestamp(expiry),
  'hard_cap_micro_usd',cap::text,'expected_group_count',(plan->>'expected_group_count')::integer,'provider_execution_enabled',false);
END $$;

-- Revalidates the exact quote under the same locks as admission, then reuses
-- the existing policy, exposure ledger, request-key table and V2 admission.
CREATE FUNCTION request_signal_topic_editorial_batch_v2(target_workspace uuid,target_actor uuid,plan jsonb,plan_body text,
 request_bodies jsonb,request_key text,expected_quote text,previous_execution uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;q jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;
 result jsonb;prepared jsonb;deadline bigint;digests text[];i integer;
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
  result:=admit_signal_topic_editorial_batch_v2(target_workspace,target_actor,plan,plan_body,request_bodies,request_key,
   (SELECT policy_version_id FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id),
   (SELECT hard_cap_micro_usd FROM signal_topic_editorial_executions WHERE id=prior.execution_id),
   (SELECT send_not_after FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id),
   (SELECT previous_execution_id FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=prior.execution_id));
 ELSE
  deadline:=split_part(expected_quote,'.',2)::bigint;
  q:=signal_topic_editorial_quote_v2(target_workspace,target_actor,(plan->'identity'->>'run_id')::uuid,plan,plan_body,deadline);
  IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM expected_quote THEN
   RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=(q->>'policy_id')::uuid;
  result:=admit_signal_topic_editorial_batch_v2(target_workspace,target_actor,plan,plan_body,request_bodies,request_key,
   p.id,(q->>'hard_cap_micro_usd')::bigint,(q->>'send_deadline')::timestamptz,previous_execution);
 END IF;
 SELECT array_agg(value->>'request_digest' ORDER BY ord) INTO digests
  FROM jsonb_array_elements(plan->'requests') WITH ORDINALITY requests(value,ord);
 prepared:=prepare_signal_topic_editorial_batch_v2((result->>'execution_id')::uuid,digests,request_key);
 RETURN result||jsonb_build_object('batch_id',prepared->>'batch_id','manifest_digest',prepared->>'manifest_digest');
END $$;

-- A lost HTTP response can be recovered after corpus or policy drift without
-- rebuilding private evidence. The original key, cap and signed quote must match.
CREATE FUNCTION replay_signal_topic_editorial_batch_v2(target_workspace uuid,target_actor uuid,target_numeric_execution uuid,request_key text,
 expected_quote text,confirmed_cap bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;body jsonb;deadline bigint;b signal_topic_editorial_provider_batches_v2%ROWTYPE;
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
 SELECT * INTO b FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id AND submission_key=request_key;
 IF b.id IS NULL OR b.manifest_digest IS DISTINCT FROM signal_semantic_context_digest_v1(b.manifest_body)
  OR b.manifest_body::jsonb IS DISTINCT FROM jsonb_build_object('requests',(
   SELECT jsonb_agg(value->'provider_request' ORDER BY ord) FROM jsonb_array_elements(e.plan->'requests') WITH ORDINALITY requests(value,ord))) THEN
  RAISE EXCEPTION 'topic_editorial_v2_replay_unavailable' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('replayed',true,'execution_id',e.id,'expected_items',jsonb_array_length(e.plan->'requests'),
  'stage','screening','batch_id',b.id,'manifest_digest',b.manifest_digest);
END $$;

REVOKE ALL ON FUNCTION signal_topic_editorial_quote_v2(uuid,uuid,uuid,jsonb,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2(uuid,uuid,jsonb,text,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v2(uuid,uuid,uuid,text,text,bigint) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_quote_v2(uuid,uuid,uuid,jsonb,text,bigint) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2(uuid,uuid,jsonb,text,jsonb,text,text,uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION replay_signal_topic_editorial_batch_v2(uuid,uuid,uuid,text,text,bigint) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
