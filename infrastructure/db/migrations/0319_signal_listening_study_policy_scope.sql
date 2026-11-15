-- Explicit R16 operator provisioning only. This migration grants no policy,
-- provider permission or budget, and creates no admission or paid work.
CREATE TABLE signal_listening_study_policy_scopes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),actor_user_id uuid NOT NULL REFERENCES users(id),
 prior_policy_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),prior_policy_digest text NOT NULL,
 policy_id uuid NOT NULL UNIQUE REFERENCES signal_processing_policy_versions(id),idempotency_key text NOT NULL,
 request jsonb NOT NULL,request_digest text NOT NULL,plan jsonb NOT NULL,plan_digest text NOT NULL,
 budget_micro_usd bigint NOT NULL,discovery_cap_micro_usd bigint NOT NULL,study_cap_micro_usd bigint NOT NULL,prototype_cap_micro_usd bigint,
 restricted_actions text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 CHECK(prior_policy_digest~'^sha256:[0-9a-f]{64}$' AND request_digest=signal_labeling_digest_v1(request) AND plan_digest=signal_labeling_digest_v1(plan)),
 CHECK(budget_micro_usd BETWEEN 1 AND 9007199254740991 AND discovery_cap_micro_usd>0 AND study_cap_micro_usd>0
  AND(prototype_cap_micro_usd IS NULL OR prototype_cap_micro_usd>0)
  AND discovery_cap_micro_usd::numeric+study_cap_micro_usd+COALESCE(prototype_cap_micro_usd,0)<=budget_micro_usd),
 CHECK(restricted_actions<@ARRAY['listening_discovery_review','study_analysis','topic_prototype_embeddings']::text[]
  AND array_position(restricted_actions,NULL) IS NULL),CHECK(pg_column_size(request)<=8192 AND pg_column_size(plan)<=262144)
);
-- Includes terminal owners with raw/custody awaiting free recovery. Historical
-- confirmed, applied receipts do not block a new policy. This is an observation
-- under the same organization lock held by every new admission/parent.
CREATE FUNCTION signal_listening_study_policy_busy_v1(org uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w WHERE w.organization_id=org AND(
  EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs r WHERE r.workspace_id=w.id AND(r.status IN('queued','processing','validating') OR r.provider_call_state IN('in_flight','response_persisted','outcome_unknown'))) OR
  EXISTS(SELECT 1 FROM signal_corpus_preparation_runs r WHERE r.workspace_id=w.id AND r.status IN('queued','running')) OR
  EXISTS(SELECT 1 FROM signal_topic_catalog_executions r WHERE r.workspace_id=w.id AND r.status IN('queued','running')) OR
  EXISTS(SELECT 1 FROM signal_topic_consolidation_executions r WHERE r.workspace_id=w.id AND r.status IN('queued','running')) OR
  EXISTS(SELECT 1 FROM signal_topic_editorial_executions r WHERE r.workspace_id=w.id AND r.status IN('queued','running','review_ready')) OR
  EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 r WHERE r.workspace_id=w.id AND r.status IN('open','ready','blocked')) OR
  EXISTS(SELECT 1 FROM signal_monitoring_insight_runs r WHERE r.workspace_id=w.id AND(r.status IN('queued','running','outcome_unknown') OR EXISTS(SELECT 1 FROM signal_monitoring_insight_calls c WHERE c.run_id=r.id AND c.state IN('reserved','in_flight','response_persisted','outcome_unknown')))) OR
  EXISTS(SELECT 1 FROM signal_labeling_runs r WHERE r.workspace_id=w.id AND r.status IN('queued','running')) OR
  EXISTS(SELECT 1 FROM signal_labeling_calls c JOIN signal_labeling_runs r ON r.id=c.run_id WHERE c.workspace_id=w.id AND(c.status IN('reserved','submitting','submitted','unknown') OR c.terminal_exposure_micro_usd>0 OR c.raw_storage_key IS NOT NULL AND NOT c.results_applied AND NOT(c.status='failed' AND r.status='failed' AND r.error_code='labeling_raw_receipt_invalid'))) OR
  EXISTS(SELECT 1 FROM signal_workspace_embedding_runs r WHERE r.workspace_id=w.id AND r.status IN('queued','running','outcome_unknown')) OR
  EXISTS(SELECT 1 FROM signal_workspace_embedding_calls c WHERE c.workspace_id=w.id AND c.status IN('reserved','in_flight','response_persisted','outcome_unknown')) OR
  EXISTS(SELECT 1 FROM engine_cost_events c WHERE c.workspace_id=w.id AND c.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')) OR
  EXISTS(SELECT 1 FROM signal_listening_preparations p WHERE p.workspace_id=w.id AND p.status IN('preparing','waiting_prototypes','ready_for_labeling','labeling')) OR
  EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents i WHERE i.workspace_id=w.id AND i.status IN('preparing','admitted','waiting_recovery')) OR
  EXISTS(SELECT 1 FROM signal_listening_discovery_executions p WHERE p.workspace_id=w.id AND p.status IN('active','outcome_unknown')) OR
  EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r WHERE r.workspace_id=w.id AND(r.status IN('queued','reviewing','reviewed','classifying','outcome_unknown') OR r.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_listening_serving_snapshots s WHERE s.round_id=r.id))) OR
  EXISTS(SELECT 1 FROM signal_study_executions p WHERE p.workspace_id=w.id AND(p.status IN('building','queued','running','outcome_unknown') OR p.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_study_outputs o WHERE o.execution_id=p.id))) OR
  EXISTS(SELECT 1 FROM signal_study_steps s WHERE s.workspace_id=w.id AND s.status IN('sent','raw','unknown')) OR
  EXISTS(SELECT 1 FROM signal_study_jev_batches b WHERE b.workspace_id=w.id AND b.status IN('running','outcome_unknown'))
 ))
$$;
CREATE FUNCTION signal_listening_study_policy_scope_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_processing_policy_versions;successor signal_processing_policy_versions;inherited signal_listening_study_policy_scopes;
 a signal_processing_policy_actions;cfg jsonb;action_key text;cap bigint;required text[];actual text[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'r16_policy_receipt_immutable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||NEW.organization_id::text,0));
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')) THEN RAISE EXCEPTION 'r16_policy_forbidden';END IF;
 SELECT * INTO prior FROM signal_processing_policy_versions WHERE id=NEW.prior_policy_id;
 SELECT * INTO successor FROM signal_processing_policy_versions WHERE id=NEW.policy_id;
 SELECT * INTO inherited FROM signal_listening_study_policy_scopes WHERE policy_id=prior.id;
 IF prior.id IS NULL OR successor.id IS NULL OR prior.status<>'active' OR successor.status<>'draft' OR successor.organization_id<>NEW.organization_id OR prior.organization_id<>NEW.organization_id
 OR NEW.organization_id IS DISTINCT FROM(SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id)
 OR prior.policy_digest IS DISTINCT FROM NEW.prior_policy_digest OR successor.created_by_user_id<>NEW.actor_user_id
 OR prior.valid_from>clock_timestamp() OR prior.valid_until<=clock_timestamp() OR successor.valid_until>prior.valid_until OR successor.valid_until<=clock_timestamp()
 OR successor.valid_until>clock_timestamp()+interval '30 days' OR successor.valid_from<prior.valid_from
 OR successor.budget_timezone<>prior.budget_timezone OR successor.daily_cap_micro_usd IS DISTINCT FROM prior.daily_cap_micro_usd
 OR successor.version<>(SELECT max(version) FROM signal_processing_policy_versions WHERE organization_id=NEW.organization_id) OR successor.version<=prior.version
 OR signal_listening_study_policy_busy_v1(NEW.organization_id)
 OR prior.daily_cap_micro_usd IS NOT NULL AND NEW.budget_micro_usd::numeric+(SELECT total_micro_usd::numeric FROM signal_processing_org_exposure_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE prior.budget_timezone)::date,prior.budget_timezone))>prior.daily_cap_micro_usd
 THEN RAISE EXCEPTION 'r16_policy_scope_invalid';END IF;
 IF inherited.id IS NOT NULL AND(inherited.workspace_id<>NEW.workspace_id OR NEW.budget_micro_usd>inherited.budget_micro_usd OR NEW.discovery_cap_micro_usd>inherited.discovery_cap_micro_usd OR NEW.study_cap_micro_usd>inherited.study_cap_micro_usd
  OR inherited.prototype_cap_micro_usd IS NOT NULL AND(NEW.prototype_cap_micro_usd IS NULL OR NEW.prototype_cap_micro_usd>inherited.prototype_cap_micro_usd)) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
 -- Exact immutable legacy copy. No action, configuration, cap or automatic flag
 -- can be replaced in the same operation that adds the missing R16 actions.
 IF EXISTS(SELECT 1 FROM signal_processing_policy_actions old LEFT JOIN signal_processing_policy_actions fresh ON fresh.policy_version_id=successor.id AND fresh.action=old.action
  WHERE old.policy_version_id=prior.id AND(to_jsonb(old)-'policy_version_id') IS DISTINCT FROM(to_jsonb(fresh)-'policy_version_id')) THEN RAISE EXCEPTION 'r16_policy_legacy_changed';END IF;
 required:=ARRAY['listening_discovery_review','study_analysis'];IF NEW.prototype_cap_micro_usd IS NOT NULL THEN required:=required||'topic_prototype_embeddings'::text;END IF;
 FOREACH action_key IN ARRAY required LOOP
  cfg:=CASE action_key WHEN 'listening_discovery_review' THEN signal_listening_discovery_review_configuration_v1() WHEN 'study_analysis' THEN signal_study_analysis_configuration_v1()
   ELSE NEW.plan->'prototype_configuration' END;
  cap:=CASE action_key WHEN 'listening_discovery_review' THEN NEW.discovery_cap_micro_usd WHEN 'study_analysis' THEN NEW.study_cap_micro_usd ELSE NEW.prototype_cap_micro_usd END;
  SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=successor.id AND action=action_key;
  IF a.action IS NULL OR a.kind<>'provider' OR a.configuration IS DISTINCT FROM cfg OR a.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(cfg)
   OR a.provider IS DISTINCT FROM CASE WHEN action_key='topic_prototype_embeddings' THEN 'voyage' ELSE 'anthropic' END
   OR a.model IS DISTINCT FROM CASE WHEN action_key='topic_prototype_embeddings' THEN 'voyage-4-large' ELSE 'claude-sonnet-4-6' END
   OR a.max_execution_micro_usd IS NOT NULL AND cap>a.max_execution_micro_usd
   OR action_key='topic_prototype_embeddings' AND NOT signal_brand_context_prototype_configuration_v1(a.configuration)
   OR NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions old WHERE old.policy_version_id=prior.id AND old.action=action_key)
    AND(a.max_execution_micro_usd IS DISTINCT FROM cap OR a.automatic_allowed)
  THEN RAISE EXCEPTION 'r16_policy_canonical_action_required';END IF;
 END LOOP;
 SELECT COALESCE(array_agg(DISTINCT additions.action ORDER BY additions.action),'{}'::text[]) INTO actual FROM(
  SELECT unnest(COALESCE(inherited.restricted_actions,'{}'::text[])||ARRAY['listening_discovery_review','study_analysis']) action
  UNION SELECT action FROM signal_processing_policy_actions fresh WHERE fresh.policy_version_id=successor.id
   AND NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions old WHERE old.policy_version_id=prior.id AND old.action=fresh.action)
 ) additions;
 IF actual IS DISTINCT FROM NEW.restricted_actions OR NOT actual<@required OR EXISTS(SELECT 1 FROM signal_processing_policy_actions fresh WHERE fresh.policy_version_id=successor.id
  AND NOT(fresh.action=ANY(required)) AND NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions old WHERE old.policy_version_id=prior.id AND old.action=fresh.action))
 THEN RAISE EXCEPTION 'r16_policy_scope_actions_invalid';END IF;
 IF NEW.request->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text OR NEW.request->>'actor_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.request->>'expected_policy_id' IS DISTINCT FROM prior.id::text OR NEW.request->>'expected_policy_digest' IS DISTINCT FROM prior.policy_digest
 OR NEW.plan->>'request_digest' IS DISTINCT FROM NEW.request_digest OR NEW.plan->>'scope' IS DISTINCT FROM 'workspace'
 OR NEW.plan->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
 OR(NEW.request->>'budget_micro_usd')::bigint IS DISTINCT FROM NEW.budget_micro_usd
 OR(NEW.request->>'discovery_cap_micro_usd')::bigint IS DISTINCT FROM NEW.discovery_cap_micro_usd OR(NEW.request->>'study_cap_micro_usd')::bigint IS DISTINCT FROM NEW.study_cap_micro_usd
 OR(NEW.request->>'prototype_cap_micro_usd')::bigint IS DISTINCT FROM NEW.prototype_cap_micro_usd
 OR(NEW.request->>'valid_until')::timestamptz IS DISTINCT FROM successor.valid_until
 THEN RAISE EXCEPTION 'r16_policy_receipt_binding_invalid';END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_study_policy_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_study_policy_scopes
 FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_scope_guard_v1();
-- Scope is inherited authority, not a property that a sibling policy rotation
-- may erase by merely copying the three provider actions.
CREATE FUNCTION signal_listening_study_policy_rotation_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE previous uuid;inherited signal_listening_study_policy_scopes;scope signal_listening_study_policy_scopes;
BEGIN
 IF NEW.status<>'active' OR OLD.status<>'draft' THEN RETURN NEW;END IF;
 SELECT id INTO previous FROM signal_processing_policy_versions WHERE organization_id=NEW.organization_id AND status<>'draft' AND version<NEW.version ORDER BY version DESC LIMIT 1;
 SELECT * INTO inherited FROM signal_listening_study_policy_scopes WHERE policy_id=previous;
 IF inherited.id IS NOT NULL AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=NEW.id AND action=ANY(inherited.restricted_actions)) THEN
  SELECT * INTO scope FROM signal_listening_study_policy_scopes WHERE policy_id=NEW.id;
  IF scope.id IS NULL OR scope.prior_policy_id<>previous OR scope.workspace_id<>inherited.workspace_id
   OR NOT inherited.restricted_actions<@scope.restricted_actions THEN RAISE EXCEPTION 'r16_policy_scope_required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER zz_r16_policy_scope_rotation BEFORE UPDATE ON signal_processing_policy_versions
 FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_rotation_guard_v1();
CREATE FUNCTION signal_listening_study_policy_assert_scope_v1(pid uuid,w uuid,action_key text,cap bigint) RETURNS void LANGUAGE plpgsql STABLE
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;allowed bigint;cfg jsonb;
BEGIN
 SELECT * INTO scope FROM signal_listening_study_policy_scopes WHERE policy_id=pid;
 IF scope.id IS NULL THEN
  IF action_key IN('listening_discovery_review','study_analysis') THEN RAISE EXCEPTION 'r16_policy_scope_required';END IF;
  RETURN;
 END IF;
 IF action_key=ANY(scope.restricted_actions) AND scope.workspace_id<>w THEN RAISE EXCEPTION 'r16_policy_workspace_scope';END IF;
 IF action_key NOT IN('listening_discovery_review','study_analysis','topic_prototype_embeddings') THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_processing_policy_versions p JOIN signal_workspaces workspace ON workspace.organization_id=p.organization_id
  WHERE p.id=pid AND workspace.id=w AND p.status='active' AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'r16_policy_scope_inactive';END IF;
 cfg:=CASE action_key WHEN 'listening_discovery_review' THEN signal_listening_discovery_review_configuration_v1() WHEN 'study_analysis' THEN signal_study_analysis_configuration_v1() ELSE scope.plan->'prototype_configuration' END;
 IF action_key IN('listening_discovery_review','study_analysis') OR scope.prototype_cap_micro_usd IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions a WHERE a.policy_version_id=pid AND a.action=action_key AND a.configuration=cfg
   AND a.configuration_digest=signal_semantic_context_digest_json_v2(cfg) AND a.provider=CASE WHEN action_key='topic_prototype_embeddings' THEN 'voyage' ELSE 'anthropic' END
   AND a.model=CASE WHEN action_key='topic_prototype_embeddings' THEN 'voyage-4-large' ELSE 'claude-sonnet-4-6' END) THEN RAISE EXCEPTION 'r16_policy_canonical_action_required';END IF;
 END IF;
 IF scope.workspace_id<>w THEN RETURN;END IF;
 allowed:=CASE action_key WHEN 'listening_discovery_review' THEN scope.discovery_cap_micro_usd WHEN 'study_analysis' THEN scope.study_cap_micro_usd WHEN 'topic_prototype_embeddings' THEN scope.prototype_cap_micro_usd END;
 IF action_key IN('listening_discovery_review','study_analysis') OR action_key='topic_prototype_embeddings' AND scope.prototype_cap_micro_usd IS NOT NULL THEN
  IF cap IS NULL OR cap<=0 OR cap>allowed THEN RAISE EXCEPTION 'r16_policy_scope_cap';END IF;
 END IF;
END $$;
CREATE FUNCTION signal_listening_study_policy_money_scope_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE action_key text;cap bigint;org uuid;
BEGIN
 SELECT organization_id INTO org FROM signal_listening_study_policy_scopes WHERE policy_id=NEW.policy_version_id;
 IF org IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));END IF;
 IF TG_TABLE_NAME='signal_processing_admissions' THEN action_key:=NEW.action;cap:=NEW.execution_cap_micro_usd;
 ELSIF TG_TABLE_NAME='signal_listening_discovery_executions' OR TG_TABLE_NAME='signal_listening_discovery_initial_intents' THEN action_key:='listening_discovery_review';cap:=NEW.cap_micro_usd;
 ELSE action_key:='study_analysis';cap:=NEW.cap_micro_usd;END IF;
 PERFORM signal_listening_study_policy_assert_scope_v1(NEW.policy_version_id,NEW.workspace_id,action_key,cap);RETURN NEW;
END $$;
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_processing_admissions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_listening_discovery_initial_intents FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE FUNCTION signal_listening_study_policy_no_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'r16_policy_receipt_immutable';END $$;
CREATE TRIGGER retain_r16_policy_scope BEFORE TRUNCATE ON signal_listening_study_policy_scopes EXECUTE FUNCTION signal_listening_study_policy_no_truncate_v1();
ALTER TABLE signal_listening_study_policy_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_listening_study_policy_scopes FROM PUBLIC;
DO $$DECLARE role_name text;fn text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE signal_listening_study_policy_scopes FROM %I',role_name);END IF;END LOOP;
 FOR fn IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'signal_listening_study_policy_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC';FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name);END IF;END LOOP;
 END LOOP;
END $$;
