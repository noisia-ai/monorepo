-- A small durable request precedes the expensive all-group quote/admission.
-- It is not a spending authorization: the existing V2 policy quote, atomic
-- admission and monetary ledger remain the only path to provider work.
CREATE TABLE signal_topic_editorial_start_intents_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),
 numeric_execution_id uuid NOT NULL REFERENCES signal_topic_consolidation_executions(id),
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed')),
 execution_id uuid REFERENCES signal_topic_editorial_executions(id),
 error_code text CHECK(error_code IS NULL OR error_code~'^[a-z][a-z0-9_]{1,119}$'),
 lease_token uuid,lease_expires_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CHECK((status='running')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK((status='completed')=(execution_id IS NOT NULL)),
 CHECK((status='failed')=(error_code IS NOT NULL))
);
CREATE UNIQUE INDEX signal_topic_editorial_one_live_start_v2
 ON signal_topic_editorial_start_intents_v2(workspace_id,numeric_execution_id)
 WHERE status IN('queued','running','completed');
CREATE INDEX signal_topic_editorial_start_due_v2
 ON signal_topic_editorial_start_intents_v2(next_attempt_at,id)
 WHERE status IN('queued','running');

-- At 1,652 groups the sealed plan is ~81 MB. The previous 64 MiB checks
-- rejected it after spending minutes validating the source. This bound is a
-- storage safety limit, not a product or provider-output size policy.
ALTER TABLE signal_topic_editorial_executions
 DROP CONSTRAINT signal_topic_editorial_executions_plan_check,
 ADD CONSTRAINT signal_topic_editorial_executions_plan_check
 CHECK(jsonb_typeof(plan)='object' AND octet_length(plan::text)<=268435456);
ALTER TABLE signal_topic_editorial_batch_owners_v2
 DROP CONSTRAINT signal_topic_editorial_batch_owners_v_plan_canonical_body_check,
 ADD CONSTRAINT signal_topic_editorial_batch_owners_v_plan_canonical_body_check
 CHECK(octet_length(plan_canonical_body) BETWEEN 1 AND 268435456);

-- The long-running Worker may need several minutes to validate the same
-- source at quote and again under the admission lock. The quote is a seal,
-- not spending authority; admission rechecks current policy/source/budget.
CREATE FUNCTION signal_topic_editorial_quote_fast_v2(target_workspace uuid,target_actor uuid,target_run uuid,
 target_plan_digest text,target_group_count integer,expected_deadline bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 org uuid;exposure bigint;expiry bigint;send_deadline timestamptz;body jsonb;cap bigint;day date;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text
  OR target_plan_digest !~ '^sha256:[a-f0-9]{64}$'
  OR target_group_count IS DISTINCT FROM (source->>'expected_group_count')::integer THEN
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
 expiry:=COALESCE(expected_deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '1 hour',send_deadline)))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '1 hour',send_deadline) THEN
  RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'run_id',target_run,
  'source_binding',source,'plan_digest',target_plan_digest,'policy_id',p.id,'policy_digest',p.policy_digest,
  'configuration_digest',a.configuration_digest,'hard_cap_micro_usd',cap::text,'budget_date',day::text,
  'budget_timezone',p.budget_timezone,'send_deadline',send_deadline,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize','quote_reference','v2.'||expiry::text||'.'||
  substr(signal_semantic_context_digest_json_v2(body),8),'quote_expires_at',to_timestamp(expiry),
  'hard_cap_micro_usd',cap::text,'expected_group_count',target_group_count,'provider_execution_enabled',false);
END $$;

-- Compatibility entry for the atomic admission function. A quote is only a
-- non-paying offer. The admission trigger still checks exact canonical plan,
-- every group/evidence receipt, current policy and the monetary ledger.
CREATE OR REPLACE FUNCTION signal_topic_editorial_quote_v2(target_workspace uuid,target_actor uuid,target_run uuid,
 plan jsonb,plan_body text,expected_deadline bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2'
  OR plan->'identity'->>'workspace_id' IS DISTINCT FROM target_workspace::text
  OR plan->'identity'->>'run_id' IS DISTINCT FROM target_run::text
  OR plan->>'plan_digest' IS NULL OR plan->>'expected_group_count' IS NULL THEN
  RETURN '{"status":"source_stale"}'::jsonb;
 END IF;
 RETURN signal_topic_editorial_quote_fast_v2(target_workspace,target_actor,target_run,
  plan->>'plan_digest',(plan->>'expected_group_count')::integer,expected_deadline);
END $$;

ALTER TABLE signal_topic_editorial_start_intents_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_topic_editorial_start_intents_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_topic_editorial_start_intents_v2 FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
