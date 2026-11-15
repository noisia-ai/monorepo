-- Explicit R16 operator provisioning only. This migration grants no policy,
-- provider permission or budget, and creates no admission or paid work.
CREATE TABLE signal_listening_study_policy_scopes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),actor_user_id uuid NOT NULL REFERENCES users(id),
 prior_policy_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),prior_policy_digest text NOT NULL,
 policy_id uuid NOT NULL UNIQUE REFERENCES signal_processing_policy_versions(id),
 ledger_root_id uuid NOT NULL REFERENCES signal_listening_study_policy_scopes(id) DEFERRABLE INITIALLY DEFERRED,idempotency_key text NOT NULL,
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
CREATE UNIQUE INDEX r16_one_scope_ledger_root ON signal_listening_study_policy_scopes(organization_id) WHERE ledger_root_id=id;
-- Policy aliases inherit the SAME allocation and consumed owners. A normal
-- organization-policy rotation is never a new R16 budget authorization.
CREATE TABLE signal_listening_study_policy_bindings(
 policy_id uuid PRIMARY KEY REFERENCES signal_processing_policy_versions(id),scope_id uuid NOT NULL REFERENCES signal_listening_study_policy_scopes(id),
 inherited_from_policy_id uuid REFERENCES signal_processing_policy_versions(id),provision_receipt_id uuid REFERENCES signal_listening_study_policy_scopes(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((inherited_from_policy_id IS NULL)<>(provision_receipt_id IS NULL))
);
CREATE TABLE signal_listening_study_policy_owners(
 scope_id uuid NOT NULL REFERENCES signal_listening_study_policy_scopes(id),kind text NOT NULL CHECK(kind IN('listening_initial','listening_parent','study')),
 owner_id uuid NOT NULL,workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),policy_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(scope_id,kind,owner_id),UNIQUE(kind,owner_id)
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
 SELECT scope.* INTO inherited FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes scope ON scope.id=binding.scope_id WHERE binding.policy_id=prior.id;
 IF prior.id IS NULL OR successor.id IS NULL OR prior.status<>'active' OR successor.status<>'draft' OR successor.organization_id<>NEW.organization_id OR prior.organization_id<>NEW.organization_id
 OR NEW.organization_id IS DISTINCT FROM(SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id)
 OR prior.policy_digest IS DISTINCT FROM NEW.prior_policy_digest OR successor.created_by_user_id<>NEW.actor_user_id
 OR prior.valid_from>clock_timestamp() OR prior.valid_until<=clock_timestamp() OR successor.valid_from<prior.valid_from OR successor.valid_until>prior.valid_until OR successor.valid_until<=clock_timestamp()
 OR successor.valid_until>clock_timestamp()+interval '30 days' OR successor.valid_from<prior.valid_from
 OR successor.budget_timezone<>prior.budget_timezone OR successor.daily_cap_micro_usd IS DISTINCT FROM prior.daily_cap_micro_usd
 OR successor.version<>(SELECT max(version) FROM signal_processing_policy_versions WHERE organization_id=NEW.organization_id) OR successor.version<=prior.version
 OR signal_listening_study_policy_busy_v1(NEW.organization_id)
 THEN RAISE EXCEPTION 'r16_policy_scope_invalid';END IF;
 IF inherited.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM signal_listening_study_policy_scopes WHERE organization_id=NEW.organization_id AND ledger_root_id=id) THEN RAISE EXCEPTION 'r16_policy_scope_history_required';END IF;
  NEW.ledger_root_id:=NEW.id;
 ELSE
  IF inherited.workspace_id<>NEW.workspace_id OR ROW(NEW.budget_micro_usd,NEW.discovery_cap_micro_usd,NEW.study_cap_micro_usd,NEW.prototype_cap_micro_usd)
   IS DISTINCT FROM ROW(inherited.budget_micro_usd,inherited.discovery_cap_micro_usd,inherited.study_cap_micro_usd,inherited.prototype_cap_micro_usd) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
  NEW.ledger_root_id:=inherited.id;
 END IF;
 IF prior.daily_cap_micro_usd IS NOT NULL AND greatest(0,NEW.budget_micro_usd::numeric-signal_listening_study_policy_exposure_v1(NEW.ledger_root_id))
  +(SELECT total_micro_usd::numeric FROM signal_processing_org_exposure_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE prior.budget_timezone)::date,prior.budget_timezone))>prior.daily_cap_micro_usd THEN RAISE EXCEPTION 'r16_policy_daily_limit';END IF;
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
-- An inherited alias has the original ledger root, owner reservations and spend.
CREATE FUNCTION signal_listening_study_policy_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;receipt signal_listening_study_policy_scopes;prior signal_processing_policy_versions;successor signal_processing_policy_versions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'r16_policy_receipt_immutable';END IF;
 SELECT * INTO scope FROM signal_listening_study_policy_scopes WHERE id=NEW.scope_id AND ledger_root_id=id;
 SELECT * INTO successor FROM signal_processing_policy_versions WHERE id=NEW.policy_id;
 IF scope.id IS NULL OR successor.id IS NULL THEN RAISE EXCEPTION 'r16_policy_scope_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||scope.organization_id::text,0));
 PERFORM signal_processing_lock_actor_v1(scope.workspace_id,NEW.actor_user_id);
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')) THEN RAISE EXCEPTION 'r16_policy_forbidden';END IF;
 IF NEW.provision_receipt_id IS NOT NULL THEN
  SELECT * INTO receipt FROM signal_listening_study_policy_scopes WHERE id=NEW.provision_receipt_id AND ledger_root_id=scope.id AND policy_id=successor.id AND actor_user_id=NEW.actor_user_id;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'r16_policy_receipt_binding_invalid';END IF;
  SELECT * INTO prior FROM signal_processing_policy_versions WHERE id=receipt.prior_policy_id;
 ELSE
  SELECT * INTO prior FROM signal_processing_policy_versions WHERE id=NEW.inherited_from_policy_id;
  IF NOT EXISTS(SELECT 1 FROM signal_listening_study_policy_bindings WHERE policy_id=prior.id AND scope_id=scope.id) THEN RAISE EXCEPTION 'r16_policy_scope_history_required';END IF;
  IF EXISTS(SELECT 1 FROM signal_processing_policy_actions old LEFT JOIN signal_processing_policy_actions fresh ON fresh.policy_version_id=successor.id AND fresh.action=old.action
   WHERE old.policy_version_id=prior.id AND old.action=ANY(scope.restricted_actions)
    AND fresh.action IS NOT NULL AND(to_jsonb(old)-'policy_version_id') IS DISTINCT FROM(to_jsonb(fresh)-'policy_version_id')) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM signal_processing_policy_actions a WHERE a.policy_version_id=successor.id AND a.action=ANY(scope.restricted_actions)
  AND NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions old WHERE old.policy_version_id=prior.id AND old.action=a.action)
  AND(a.max_execution_micro_usd IS NULL OR a.max_execution_micro_usd>CASE a.action WHEN 'listening_discovery_review' THEN scope.discovery_cap_micro_usd WHEN 'study_analysis' THEN scope.study_cap_micro_usd ELSE scope.prototype_cap_micro_usd END)) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
 IF prior.id IS NULL OR prior.status<>'active' OR successor.status<>'draft' OR prior.organization_id<>scope.organization_id OR successor.organization_id<>scope.organization_id
 OR prior.valid_from>clock_timestamp() OR prior.valid_until<=clock_timestamp() OR successor.valid_from<prior.valid_from OR successor.valid_until>prior.valid_until OR successor.valid_until<=clock_timestamp()
 OR successor.daily_cap_micro_usd IS DISTINCT FROM prior.daily_cap_micro_usd OR successor.budget_timezone<>prior.budget_timezone OR successor.version<=prior.version
 OR signal_listening_study_policy_busy_v1(scope.organization_id) THEN RAISE EXCEPTION 'r16_policy_active_work_or_changed';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r16_policy_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_study_policy_bindings FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_binding_guard_v1();
CREATE FUNCTION signal_listening_study_policy_bind_receipt_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$ BEGIN
 INSERT INTO signal_listening_study_policy_bindings(policy_id,scope_id,provision_receipt_id,actor_user_id)
 VALUES(NEW.policy_id,NEW.ledger_root_id,NEW.id,NEW.actor_user_id);RETURN NEW;
END $$;
CREATE TRIGGER r16_policy_bind_receipt AFTER INSERT ON signal_listening_study_policy_scopes FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_bind_receipt_v1();
CREATE FUNCTION signal_listening_study_policy_inherit_v1(prior_id uuid,next_id uuid,actor uuid) RETURNS uuid LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE root uuid;
BEGIN
 SELECT scope_id INTO root FROM signal_listening_study_policy_bindings WHERE policy_id=prior_id;
 IF root IS NULL THEN RETURN NULL;END IF;
 INSERT INTO signal_listening_study_policy_bindings(policy_id,scope_id,inherited_from_policy_id,actor_user_id) VALUES(next_id,root,prior_id,actor);
 RETURN root;
END $$;
-- Full active reservations, not an optimistic sum of tiny completed calls.
-- A parent uses the original initial cap, and its native exposure already
-- includes initial JEV/prototypes. Omit that initial row ONLY when its exact
-- native parent is bound. Parent insertion precedes linking its first child.
CREATE FUNCTION signal_listening_study_policy_exposure_v1(root uuid) RETURNS numeric LANGUAGE sql VOLATILE
SET search_path=public,extensions,pg_temp AS $$
 WITH owners AS MATERIALIZED(SELECT * FROM signal_listening_study_policy_owners WHERE scope_id=root),amounts AS(
  SELECT CASE WHEN p.status IN('active','outcome_unknown') OR EXISTS(SELECT 1 FROM signal_listening_discovery_children child JOIN signal_labeling_calls c ON c.run_id=child.run_id WHERE child.execution_id=p.id AND(c.status IN('reserved','submitting','submitted','unknown') OR c.terminal_exposure_micro_usd>0 OR c.raw_storage_key IS NOT NULL AND NOT c.results_applied)) OR EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r WHERE r.execution_id=p.id AND(r.status IN('queued','reviewing','reviewed','classifying','outcome_unknown') OR r.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_listening_serving_snapshots s WHERE s.round_id=r.id)))
   OR EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN engine_cost_events c ON c.listening_round_id=r.id WHERE r.execution_id=p.id AND c.call_state IN('reserved','in_flight','response_persisted','outcome_unknown'))
   OR EXISTS(SELECT 1 FROM signal_workspace_embedding_calls c WHERE c.status IN('reserved','in_flight','response_persisted','outcome_unknown') AND c.run_id IN(
    SELECT flow.prototype_run_id FROM signal_listening_preparations flow WHERE flow.id=p.initial_preparation_id
     OR flow.id IN(SELECT preparation_id FROM signal_listening_discovery_children WHERE execution_id=p.id)
     OR flow.id IN(SELECT classification_preparation_id FROM signal_listening_discovery_rounds WHERE execution_id=p.id)))
    THEN greatest(o.cap_micro_usd,signal_listening_discovery_exposure_v1(p.id)) ELSE signal_listening_discovery_exposure_v1(p.id) END amount
  FROM owners o JOIN signal_listening_discovery_executions p ON o.kind='listening_parent' AND p.id=o.owner_id
  UNION ALL
  SELECT CASE WHEN p.status IN('building','queued','running','outcome_unknown') OR p.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_study_outputs output WHERE output.execution_id=p.id)
   OR EXISTS(SELECT 1 FROM signal_study_jev_batches batch JOIN signal_labeling_calls c ON c.run_id=batch.run_id WHERE batch.execution_id=p.id AND(c.status IN('reserved','submitting','submitted','unknown') OR c.terminal_exposure_micro_usd>0 OR c.raw_storage_key IS NOT NULL AND NOT c.results_applied)) OR EXISTS(SELECT 1 FROM signal_study_steps s WHERE s.execution_id=p.id AND s.status IN('sent','raw','unknown'))
   OR EXISTS(SELECT 1 FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=p.id AND c.call_state IN('reserved','in_flight','response_persisted','outcome_unknown'))
    THEN greatest(o.cap_micro_usd,signal_study_exposure_v1(p.id)) ELSE signal_study_exposure_v1(p.id) END
  FROM owners o JOIN signal_study_executions p ON o.kind='study' AND p.id=o.owner_id
  UNION ALL
  SELECT CASE WHEN i.status IN('preparing','admitted','waiting_recovery') OR EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=i.initial_run_id AND(c.status IN('reserved','submitting','submitted','unknown') OR c.terminal_exposure_micro_usd>0 OR c.raw_storage_key IS NOT NULL AND NOT c.results_applied))
   OR EXISTS(SELECT 1 FROM signal_listening_preparations flow JOIN signal_workspace_embedding_calls c ON c.run_id=flow.prototype_run_id WHERE flow.id=i.preparation_id AND c.status IN('reserved','in_flight','response_persisted','outcome_unknown'))
    THEN greatest(o.cap_micro_usd,spent.amount) ELSE spent.amount END
  FROM owners o JOIN signal_listening_discovery_initial_intents i ON o.kind='listening_initial' AND i.id=o.owner_id
  CROSS JOIN LATERAL(SELECT
   COALESCE((SELECT sum(CASE WHEN c.status='settled' OR c.status='failed' AND c.settled_micro_usd IS NOT NULL THEN c.settled_micro_usd WHEN c.status IN('reserved','submitting','submitted','unknown') THEN c.reserved_micro_usd ELSE 0 END+COALESCE(c.terminal_exposure_micro_usd,0)) FROM signal_labeling_calls c WHERE c.run_id=i.initial_run_id),0)
   +COALESCE((SELECT sum(CASE WHEN c.status='settled' THEN c.settled_micro_usd WHEN c.status='definitely_not_sent' THEN 0 ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END)
    FROM signal_workspace_embedding_calls c JOIN signal_listening_preparations f ON f.prototype_run_id=c.run_id WHERE f.id=i.preparation_id),0) amount) spent
  WHERE NOT EXISTS(SELECT 1 FROM owners parent JOIN signal_listening_discovery_executions p ON parent.kind='listening_parent' AND p.id=parent.owner_id AND p.initial_intent_id=i.id)
 ) SELECT COALESCE(sum(amount),0) FROM amounts
$$;
CREATE FUNCTION signal_listening_study_policy_owner_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;parent signal_listening_discovery_executions;i signal_listening_discovery_initial_intents;p signal_study_executions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'r16_policy_owner_immutable';END IF;
 SELECT * INTO scope FROM signal_listening_study_policy_scopes WHERE id=NEW.scope_id AND ledger_root_id=id;
 IF scope.id IS NULL OR scope.workspace_id<>NEW.workspace_id OR NOT EXISTS(SELECT 1 FROM signal_listening_study_policy_bindings WHERE policy_id=NEW.policy_id AND scope_id=scope.id) THEN RAISE EXCEPTION 'r16_policy_owner_scope';END IF;
 IF NEW.kind='listening_initial' THEN
  SELECT * INTO i FROM signal_listening_discovery_initial_intents WHERE id=NEW.owner_id AND workspace_id=NEW.workspace_id AND policy_version_id=NEW.policy_id;
  IF i.id IS NULL OR i.cap_micro_usd<>NEW.cap_micro_usd OR i.cap_micro_usd>scope.discovery_cap_micro_usd THEN RAISE EXCEPTION 'r16_policy_owner_binding';END IF;
 ELSIF NEW.kind='listening_parent' THEN
  SELECT * INTO parent FROM signal_listening_discovery_executions WHERE id=NEW.owner_id AND workspace_id=NEW.workspace_id AND policy_version_id=NEW.policy_id;
  IF parent.id IS NULL OR parent.cap_micro_usd<>NEW.cap_micro_usd OR parent.cap_micro_usd>scope.discovery_cap_micro_usd THEN RAISE EXCEPTION 'r16_policy_owner_binding';END IF;
  IF parent.initial_intent_id IS NOT NULL THEN
   SELECT * INTO i FROM signal_listening_discovery_initial_intents WHERE id=parent.initial_intent_id AND workspace_id=parent.workspace_id;
   IF i.id IS NULL OR i.cap_micro_usd<>parent.cap_micro_usd OR i.initial_run_id IS DISTINCT FROM parent.initial_classification_run_id
    OR NOT EXISTS(SELECT 1 FROM signal_listening_study_policy_owners WHERE scope_id=scope.id AND kind='listening_initial' AND owner_id=i.id AND cap_micro_usd=parent.cap_micro_usd) THEN RAISE EXCEPTION 'r16_policy_owner_binding';END IF;
  END IF;
 ELSE
  SELECT * INTO p FROM signal_study_executions WHERE id=NEW.owner_id AND workspace_id=NEW.workspace_id AND policy_version_id=NEW.policy_id;
  IF p.id IS NULL OR p.cap_micro_usd<>NEW.cap_micro_usd OR p.cap_micro_usd>scope.study_cap_micro_usd THEN RAISE EXCEPTION 'r16_policy_owner_binding';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER r16_policy_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_study_policy_owners FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_owner_guard_v1();
CREATE FUNCTION signal_listening_study_policy_owner_budget_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;
BEGIN
 SELECT * INTO scope FROM signal_listening_study_policy_scopes WHERE id=NEW.scope_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||scope.organization_id::text,0));
 PERFORM 1 FROM signal_listening_study_policy_scopes WHERE id=scope.id FOR UPDATE;
 IF signal_listening_study_policy_exposure_v1(scope.id)>scope.budget_micro_usd THEN RAISE EXCEPTION 'r16_policy_scope_budget_exhausted';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r16_policy_owner_budget AFTER INSERT ON signal_listening_study_policy_owners FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_owner_budget_v1();
CREATE FUNCTION signal_listening_study_policy_bind_owner_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE root uuid;owner_kind text;
BEGIN
 SELECT scope_id INTO root FROM signal_listening_study_policy_bindings WHERE policy_id=NEW.policy_version_id;
 IF root IS NULL THEN RAISE EXCEPTION 'r16_policy_scope_required';END IF;
 owner_kind:=CASE TG_TABLE_NAME WHEN 'signal_listening_discovery_initial_intents' THEN 'listening_initial' WHEN 'signal_listening_discovery_executions' THEN 'listening_parent' ELSE 'study' END;
 INSERT INTO signal_listening_study_policy_owners(scope_id,kind,owner_id,workspace_id,policy_id,cap_micro_usd)
 VALUES(root,owner_kind,NEW.id,NEW.workspace_id,NEW.policy_version_id,NEW.cap_micro_usd);RETURN NEW;
END $$;
CREATE TRIGGER zzz_r16_policy_bind_owner AFTER INSERT ON signal_listening_discovery_initial_intents FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_bind_owner_v1();
CREATE TRIGGER zzz_r16_policy_bind_owner AFTER INSERT ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_bind_owner_v1();
CREATE TRIGGER zzz_r16_policy_bind_owner AFTER INSERT ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_bind_owner_v1();
-- Scope is inherited authority, not a property that a sibling policy rotation
-- may erase by merely copying the three provider actions.
CREATE FUNCTION signal_listening_study_policy_rotation_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE previous uuid;inherited signal_listening_study_policy_scopes;scope signal_listening_study_policy_scopes;
BEGIN
 IF NEW.status<>'active' OR OLD.status<>'draft' THEN RETURN NEW;END IF;
 SELECT id INTO previous FROM signal_processing_policy_versions WHERE organization_id=NEW.organization_id AND status<>'draft' AND version<NEW.version ORDER BY version DESC LIMIT 1;
 SELECT scope.* INTO inherited FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes scope ON scope.id=binding.scope_id WHERE binding.policy_id=previous;
 IF inherited.id IS NOT NULL THEN
  SELECT receipt.* INTO scope FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes receipt ON receipt.id=binding.scope_id WHERE binding.policy_id=NEW.id;
  IF scope.id IS NULL OR scope.id<>inherited.id OR scope.workspace_id<>inherited.workspace_id THEN RAISE EXCEPTION 'r16_policy_scope_required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER zz_r16_policy_scope_rotation BEFORE UPDATE ON signal_processing_policy_versions
 FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_rotation_guard_v1();
-- Shared by enforcement and the read-only policy view. One indexed scope
-- observation, never a cached approval or an alternate source of authority.
CREATE FUNCTION signal_listening_study_policy_denied_actions_v1(pid uuid,w uuid) RETURNS text[] LANGUAGE sql STABLE
SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT CASE WHEN scope.workspace_id=w THEN '{}'::text[] ELSE scope.restricted_actions END
  FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes scope ON scope.id=binding.scope_id WHERE binding.policy_id=pid),ARRAY['listening_discovery_review','study_analysis']::text[])
$$;
CREATE FUNCTION signal_listening_study_policy_assert_scope_v1(pid uuid,w uuid,action_key text,cap bigint) RETURNS void LANGUAGE plpgsql STABLE
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;allowed bigint;cfg jsonb;
BEGIN
 SELECT receipt.* INTO scope FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes receipt ON receipt.id=binding.scope_id WHERE binding.policy_id=pid;
 IF action_key=ANY(signal_listening_study_policy_denied_actions_v1(pid,w)) THEN
  IF scope.id IS NULL THEN RAISE EXCEPTION 'r16_policy_scope_required';END IF;
  RAISE EXCEPTION 'r16_policy_workspace_scope';
 END IF;
 IF scope.id IS NULL THEN RETURN;END IF;
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
DECLARE action_key text;cap bigint;org uuid;scope signal_listening_study_policy_scopes;
BEGIN
 SELECT receipt.* INTO scope FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes receipt ON receipt.id=binding.scope_id WHERE binding.policy_id=NEW.policy_version_id;
 org:=scope.organization_id;
 IF org IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));
  PERFORM signal_processing_lock_v1(org,(clock_timestamp() AT TIME ZONE(SELECT budget_timezone FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id))::date);
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  PERFORM 1 FROM signal_listening_study_policy_scopes WHERE id=scope.id FOR UPDATE;
 END IF;
 IF TG_TABLE_NAME='signal_processing_admissions' THEN action_key:=NEW.action;cap:=NEW.execution_cap_micro_usd;
 ELSIF TG_TABLE_NAME='signal_listening_discovery_executions' OR TG_TABLE_NAME='signal_listening_discovery_initial_intents' THEN action_key:='listening_discovery_review';cap:=NEW.cap_micro_usd;
 ELSE action_key:='study_analysis';cap:=NEW.cap_micro_usd;END IF;
 PERFORM signal_listening_study_policy_assert_scope_v1(NEW.policy_version_id,NEW.workspace_id,action_key,cap);
 IF scope.id IS NOT NULL AND TG_TABLE_NAME='signal_processing_admissions' THEN
  IF action_key IN('listening_discovery_review','study_analysis','topic_prototype_embeddings') AND signal_listening_study_policy_exposure_v1(scope.id)>scope.budget_micro_usd THEN RAISE EXCEPTION 'r16_policy_scope_budget_exhausted';END IF;
  -- A newly granted prototype action is authority for the admitted Listening
  -- cycle only. Existing separately governed Brand Context receipts retain
  -- their independent legacy action and monetary guards.
  IF action_key='topic_prototype_embeddings' AND action_key=ANY(scope.restricted_actions) AND NEW.brand_context_prototype_receipt_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM signal_listening_prototype_runs owner JOIN signal_listening_preparations flow ON flow.id=owner.preparation_id
    WHERE owner.run_id=NEW.target_id AND owner.policy_version_id=NEW.policy_version_id AND owner.workspace_id=NEW.workspace_id AND(
     EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents i JOIN signal_listening_study_policy_owners booking ON booking.kind='listening_initial' AND booking.owner_id=i.id AND booking.scope_id=scope.id WHERE i.preparation_id=flow.id)
     OR EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN signal_listening_study_policy_owners booking ON booking.kind='listening_parent' AND booking.owner_id=r.execution_id AND booking.scope_id=scope.id WHERE flow.idempotency_key='listening-discovery-child:'||r.id::text)))
  THEN RAISE EXCEPTION 'r16_policy_prototype_owner_required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_processing_admissions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_listening_discovery_initial_intents FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
CREATE TRIGGER aaa_r16_policy_scope BEFORE INSERT ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_money_scope_v1();
-- Prototype exposure is a sublimit inside Listening, not another additive
-- owner allocation. Only linked R16 prototype runs are counted; legacy Voyage
-- retains its existing policy. Known paid evidence is always recordable.
CREATE FUNCTION signal_listening_study_policy_prototype_budget_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE scope signal_listening_study_policy_scopes;amount numeric;
BEGIN
 IF NEW.status NOT IN('reserved','in_flight') OR TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW;END IF;
 SELECT receipt.* INTO scope FROM signal_listening_prototype_runs owner
 JOIN signal_listening_study_policy_bindings binding ON binding.policy_id=owner.policy_version_id
 JOIN signal_listening_study_policy_scopes receipt ON receipt.id=binding.scope_id WHERE owner.run_id=NEW.run_id;
 IF scope.id IS NULL OR scope.prototype_cap_micro_usd IS NULL THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||scope.organization_id::text,0));
 PERFORM 1 FROM signal_listening_study_policy_scopes WHERE id=scope.id FOR UPDATE;
 -- Separate query AFTER the scope lock observes a competing committed batch.
 SELECT COALESCE(sum(CASE WHEN c.status='settled' THEN c.settled_micro_usd WHEN c.status='definitely_not_sent' THEN 0
  ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END),0) INTO amount
 FROM signal_workspace_embedding_calls c JOIN signal_listening_prototype_runs owner ON owner.run_id=c.run_id
 JOIN signal_listening_study_policy_bindings binding ON binding.policy_id=owner.policy_version_id WHERE binding.scope_id=scope.id;
 IF amount>scope.prototype_cap_micro_usd THEN RAISE EXCEPTION 'r16_policy_prototype_budget_exhausted';END IF;RETURN NEW;
END $$;
CREATE TRIGGER zzz_r16_policy_prototype_budget AFTER INSERT OR UPDATE ON signal_workspace_embedding_calls
 FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_prototype_budget_v1();
-- A definitively closed owner cannot acquire future paid work after its unused
-- reservation has been released. Unknown owners retain their complete cap.
CREATE FUNCTION signal_listening_study_policy_no_reopen_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF OLD.status IN('completed','failed','stale','budget_exhausted') AND NEW.status IN('active','building','queued','running')
  AND EXISTS(SELECT 1 FROM signal_listening_study_policy_bindings WHERE policy_id=OLD.policy_version_id)
 THEN RAISE EXCEPTION 'r16_policy_owner_closed';END IF;RETURN NEW;
END $$;
CREATE TRIGGER zzz_r16_policy_no_reopen BEFORE UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_no_reopen_v1();
CREATE TRIGGER zzz_r16_policy_no_reopen BEFORE UPDATE ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_study_policy_no_reopen_v1();
CREATE FUNCTION signal_listening_study_policy_no_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'r16_policy_receipt_immutable';END $$;
CREATE TRIGGER retain_r16_policy_scope BEFORE TRUNCATE ON signal_listening_study_policy_scopes EXECUTE FUNCTION signal_listening_study_policy_no_truncate_v1();
CREATE TRIGGER retain_r16_policy_binding BEFORE TRUNCATE ON signal_listening_study_policy_bindings EXECUTE FUNCTION signal_listening_study_policy_no_truncate_v1();
CREATE TRIGGER retain_r16_policy_owner BEFORE TRUNCATE ON signal_listening_study_policy_owners EXECUTE FUNCTION signal_listening_study_policy_no_truncate_v1();
ALTER TABLE signal_listening_study_policy_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_listening_study_policy_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_listening_study_policy_bindings,signal_listening_study_policy_owners FROM PUBLIC;
ALTER TABLE signal_listening_study_policy_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_listening_study_policy_scopes FROM PUBLIC;
DO $$DECLARE role_name text;fn text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE signal_listening_study_policy_scopes,signal_listening_study_policy_bindings,signal_listening_study_policy_owners FROM %I',role_name);END IF;END LOOP;
 FOR fn IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'signal_listening_study_policy_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC';FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name);END IF;END LOOP;
 END LOOP;
END $$;
