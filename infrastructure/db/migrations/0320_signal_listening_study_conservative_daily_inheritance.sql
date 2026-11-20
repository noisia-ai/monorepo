-- A tighter organization/day limit may inherit an existing R16 scope.
-- This grants no additional authority: the same root, owner reservations,
-- settled/uncertain exposure, per-owner caps, validity and quiescence remain.
-- NULL is unbounded: NULL -> finite tightens; finite -> NULL or larger denies.
CREATE OR REPLACE FUNCTION signal_listening_study_policy_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql
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
  IF EXISTS(SELECT 1 FROM signal_processing_policy_actions prior_action LEFT JOIN signal_processing_policy_actions fresh ON fresh.policy_version_id=successor.id AND fresh.action=prior_action.action
   WHERE prior_action.policy_version_id=prior.id AND prior_action.action=ANY(scope.restricted_actions)
    AND fresh.action IS NOT NULL AND(to_jsonb(prior_action)-'policy_version_id') IS DISTINCT FROM(to_jsonb(fresh)-'policy_version_id')) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM signal_processing_policy_actions a WHERE a.policy_version_id=successor.id AND a.action=ANY(scope.restricted_actions)
  AND NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions prior_action WHERE prior_action.policy_version_id=prior.id AND prior_action.action=a.action)
  AND(a.max_execution_micro_usd IS NULL OR a.max_execution_micro_usd>CASE a.action WHEN 'listening_discovery_review' THEN scope.discovery_cap_micro_usd WHEN 'study_analysis' THEN scope.study_cap_micro_usd ELSE scope.prototype_cap_micro_usd END)) THEN RAISE EXCEPTION 'r16_policy_scope_widened';END IF;
 IF prior.id IS NULL OR prior.status<>'active' OR successor.status<>'draft' OR prior.organization_id<>scope.organization_id OR successor.organization_id<>scope.organization_id
 OR prior.valid_from>clock_timestamp() OR prior.valid_until<=clock_timestamp() OR successor.valid_from<prior.valid_from OR successor.valid_until>prior.valid_until OR successor.valid_until<=clock_timestamp()
 OR (prior.daily_cap_micro_usd IS NOT NULL AND(successor.daily_cap_micro_usd IS NULL OR successor.daily_cap_micro_usd>prior.daily_cap_micro_usd))
 OR successor.budget_timezone<>prior.budget_timezone OR successor.version<=prior.version
 OR signal_listening_study_policy_busy_v1(scope.organization_id) THEN RAISE EXCEPTION 'r16_policy_active_work_or_changed';END IF;
 RETURN NEW;
END $$;
