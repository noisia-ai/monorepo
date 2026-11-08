-- A private, bounded disposition of one paid global response. No send authority.
CREATE TABLE signal_mass_labeling_global_receipt_decisions(
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 call_id uuid NOT NULL UNIQUE REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 response_sha256 text NOT NULL CHECK(response_sha256~'^sha256:[0-9a-f]{64}$'),
 source_groups_digest text NOT NULL CHECK(source_groups_digest~'^sha256:[0-9a-f]{64}$'),
 input_digest text NOT NULL CHECK(input_digest~'^sha256:[0-9a-f]{64}$'),
 fit_checkpoint_digest text NOT NULL CHECK(fit_checkpoint_digest~'^sha256:[0-9a-f]{64}$'),
 decision_digest text NOT NULL CHECK(decision_digest~'^sha256:[0-9a-f]{64}$'),
 decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object' AND pg_column_size(decision)<=16384),
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,execution_id)
);
CREATE FUNCTION guard_mass_labeling_global_receipt_decision_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE; coverage record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Global receipt decisions are append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO call FROM engine_cost_events WHERE id=NEW.call_id;
 SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(NEW.execution_id);
 IF NOT COALESCE(run.id IS NOT NULL AND run.status='failed' AND run.input_contract='workspace-topic-engine-v1'
  AND run.error_code='workspace_engine_worker_failed'
  AND run.actor_user_id=NEW.created_by_user_id AND run.input_digest=NEW.input_digest
  AND run.input_snapshot#>>'{engine_config,profile_version}' IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
  AND run.input_snapshot ? 'interpretation_config' AND NOT run.result_summary ? 'analysis_checkpoint'
  AND run.result_summary#>>'{fit_checkpoint,checkpoint_digest}'=NEW.fit_checkpoint_digest
  AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
  AND coverage.unit_count=(run.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_count}')::bigint
  AND coverage.unit_digest=run.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_digest}'
  AND run.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=run.workspace_id)
  AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
  AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
  AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.created_by_user_id AND actor.status='active'
    AND actor.user_type='noisia_internal' AND actor.primary_role IN('noisia_admin','admin','founder'))
  AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
  AND call.workspace_contract='workspace-engine-interpretation-v1' AND call.workspace_id=NEW.workspace_id AND call.catalog_execution_id=NEW.execution_id
  AND call.actor_user_id=NEW.created_by_user_id AND call.call_state='settled' AND call.settled_micro_usd IS NOT NULL
  AND call.request_digest=NEW.request_digest AND call.response_sha256=NEW.response_sha256 AND call.response_storage_key IS NOT NULL
  AND call.response_http_status=200 AND call.response_size_bytes>0 AND COALESCE((call.metadata->>'response_complete')::boolean,true)
  AND call.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
  AND call.metadata#>>'{mass_labeling_stage,source_groups_digest}'=NEW.source_groups_digest
  AND NOT call.metadata ? 'editorial_repair'
  AND call.call_configuration=workspace_engine_interpretation_configuration_v1(run.id,call.metadata->>'interpretation_revision_digest')
  AND NEW.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v1'
  AND NEW.decision->>'workspace_id'=NEW.workspace_id::text AND NEW.decision->>'execution_id'=NEW.execution_id::text
  AND NEW.decision->>'call_id'=NEW.call_id::text AND NEW.decision->>'request_digest'=NEW.request_digest
  AND NEW.decision->>'response_sha256'=NEW.response_sha256 AND NEW.decision->>'source_groups_digest'=NEW.source_groups_digest
  AND NEW.decision_digest='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(NEW.decision),'UTF8')),'hex')
  AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=run.id
    AND artifact.metadata->>'contract_version'='workspace-mass-labeling-consolidation-v1')
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events pending WHERE pending.catalog_execution_id=run.id
    AND pending.workspace_contract='workspace-engine-interpretation-v1'
    AND (pending.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')
      OR pending.call_state='terminal_confirmed' AND NOT pending.metadata ? 'provider_terminal_billing_reconciliation'))
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events later WHERE later.catalog_execution_id=run.id AND later.id<>call.id
    AND later.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1' AND later.sent_at>call.sent_at),false) THEN
  RAISE EXCEPTION 'workspace_engine_global_receipt_decision_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_receipt_decision BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_global_receipt_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_global_receipt_decision_v1();

-- Bind the execution under its existing row lock. Concurrent repeatable-read
-- writers then serialize/fail rather than seeing a stale absence of the decision.
CREATE FUNCTION bind_mass_labeling_global_receipt_decision_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 UPDATE signal_topic_catalog_executions SET result_summary=result_summary||jsonb_build_object('global_receipt_recovery_decision_id',NEW.id),updated_at=clock_timestamp()
 WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_receipt_bind AFTER INSERT ON signal_mass_labeling_global_receipt_decisions
 FOR EACH ROW EXECUTE FUNCTION bind_mass_labeling_global_receipt_decision_v1();
CREATE FUNCTION guard_mass_labeling_global_receipt_binding_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF OLD.result_summary ? 'global_receipt_recovery_decision_id' AND NEW.result_summary->'global_receipt_recovery_decision_id' IS DISTINCT FROM OLD.result_summary->'global_receipt_recovery_decision_id' THEN
  RAISE EXCEPTION 'Global receipt recovery binding is immutable.' USING ERRCODE='55000'; END IF;
 IF NEW.result_summary ? 'global_receipt_recovery_decision_id' AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_global_receipt_decisions decision
  WHERE decision.id::text=NEW.result_summary->>'global_receipt_recovery_decision_id' AND decision.execution_id=NEW.id
    AND decision.workspace_id=NEW.workspace_id AND decision.created_by_user_id=NEW.actor_user_id AND decision.input_digest=NEW.input_digest
    AND decision.fit_checkpoint_digest=NEW.result_summary#>>'{fit_checkpoint,checkpoint_digest}') THEN
  RAISE EXCEPTION 'workspace_engine_global_receipt_decision_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_receipt_binding BEFORE UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_global_receipt_binding_v1();
CREATE FUNCTION guard_mass_labeling_global_receipt_no_send_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR NEW.call_state='in_flight' AND OLD.call_state='reserved' THEN
  SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id FOR UPDATE;
  IF run.result_summary ? 'global_receipt_recovery_decision_id' THEN
   RAISE EXCEPTION 'workspace_engine_global_receipt_recovery_no_send' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_receipt_no_send BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_global_receipt_no_send_v1();
CREATE FUNCTION guard_mass_labeling_global_receipt_artifact_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE decision signal_mass_labeling_global_receipt_decisions%ROWTYPE;
BEGIN
 IF NEW.metadata->>'contract_version' IS DISTINCT FROM 'workspace-mass-labeling-consolidation-v1' THEN RETURN NEW; END IF;
 SELECT * INTO decision FROM signal_mass_labeling_global_receipt_decisions WHERE execution_id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF decision.id IS NULL AND NOT NEW.metadata ? 'recovery_decision_id' AND NOT NEW.metadata ? 'recovery_decision_digest' THEN RETURN NEW; END IF;
 IF NOT COALESCE(decision.id IS NOT NULL AND NEW.metadata->>'recovery_decision_id'=decision.id::text
  AND NEW.metadata->>'recovery_decision_digest'=decision.decision_digest AND NEW.metadata->>'call_id'=decision.call_id::text
  AND NEW.metadata->>'request_digest'=decision.request_digest AND NEW.metadata->>'response_sha256'=decision.response_sha256
  AND NEW.metadata->>'source_groups_digest'=decision.source_groups_digest,false) THEN
  RAISE EXCEPTION 'workspace_engine_global_receipt_artifact_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_receipt_artifact BEFORE INSERT ON analysis_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_global_receipt_artifact_v1();
ALTER TABLE signal_mass_labeling_global_receipt_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_mass_labeling_global_receipt_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_mass_labeling_global_receipt_decision_v1(),bind_mass_labeling_global_receipt_decision_v1(),guard_mass_labeling_global_receipt_binding_v1(),guard_mass_labeling_global_receipt_no_send_v1(),guard_mass_labeling_global_receipt_artifact_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE signal_mass_labeling_global_receipt_decisions FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION guard_mass_labeling_global_receipt_decision_v1(),bind_mass_labeling_global_receipt_decision_v1(),guard_mass_labeling_global_receipt_binding_v1(),guard_mass_labeling_global_receipt_no_send_v1(),guard_mass_labeling_global_receipt_artifact_v1() FROM %I',role_name);
 END LOOP;
END $$;
