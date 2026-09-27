-- A policy quote is provisional and does not persist an execution or authorize
-- provider work. Validate the sealed plan envelope here; the full per-group
-- source/evidence validator still runs in the durable admission trigger before
-- any execution, reservation, request or provider manifest can commit.
CREATE OR REPLACE FUNCTION signal_topic_editorial_quote_v2(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,plan_body text,
 expected_deadline bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 org uuid;exposure bigint;expiry bigint;send_deadline timestamptz;body jsonb;cap bigint;day date;expected_groups integer;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 expected_groups:=NULLIF(source->>'expected_group_count','')::integer;
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text
  OR plan_body IS NULL OR plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2'
  OR plan->'identity'->>'workspace_id' IS DISTINCT FROM target_workspace::text
  OR plan->'identity'->>'run_id' IS DISTINCT FROM target_run::text
  OR plan->'identity'->>'source_context_digest' IS DISTINCT FROM source->>'context_digest'
  OR plan->>'plan_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(plan_body)
  OR jsonb_typeof(plan->'requests') IS DISTINCT FROM 'array'
  OR jsonb_array_length(plan->'requests')<>expected_groups
  OR plan->>'expected_group_count' IS DISTINCT FROM expected_groups::text THEN
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
