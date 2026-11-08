-- A bounded operator disposition never replaces paid evidence or grants a send.
CREATE TABLE signal_workspace_interpretation_insufficiency_decisions(
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 exception_id uuid NOT NULL REFERENCES signal_workspace_interpretation_exceptions(id) ON DELETE RESTRICT,
 unit_key text NOT NULL CHECK(unit_key~'^(open|guided):[A-Za-z0-9_.:-]{1,180}$'),
 original_call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 repair_call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 original_response_sha256 text NOT NULL CHECK(original_response_sha256~'^sha256:[0-9a-f]{64}$'),
 repair_response_sha256 text NOT NULL CHECK(repair_response_sha256~'^sha256:[0-9a-f]{64}$'),
 input_digest text NOT NULL CHECK(input_digest~'^sha256:[0-9a-f]{64}$'),
 fit_checkpoint_digest text NOT NULL CHECK(fit_checkpoint_digest~'^sha256:[0-9a-f]{64}$'),
 reason text NOT NULL CHECK(reason='missing_general_citations'),
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(exception_id,unit_key)
);
CREATE INDEX workspace_insufficiency_decisions_execution ON signal_workspace_interpretation_insufficiency_decisions(workspace_id,execution_id);
CREATE FUNCTION guard_workspace_insufficiency_decision_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; exception signal_workspace_interpretation_exceptions%ROWTYPE;
 original engine_cost_events%ROWTYPE; repair engine_cost_events%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Operator insufficiency decisions are append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO exception FROM signal_workspace_interpretation_exceptions WHERE id=NEW.exception_id;
 SELECT * INTO original FROM engine_cost_events WHERE id=NEW.original_call_id;
 SELECT * INTO repair FROM engine_cost_events WHERE id=NEW.repair_call_id;
 IF NOT COALESCE(run.id IS NOT NULL AND run.status='failed' AND run.input_contract='workspace-topic-engine-v1'
  AND run.input_snapshot#>>'{engine_config,profile_version}' IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
  AND run.input_snapshot ? 'interpretation_config' AND run.result_summary ? 'fit_checkpoint'
  AND run.actor_user_id=NEW.created_by_user_id AND run.input_digest=NEW.input_digest
  AND run.result_summary#>>'{fit_checkpoint,checkpoint_digest}'=NEW.fit_checkpoint_digest
  AND run.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=run.workspace_id)
  AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
  AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
  AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.created_by_user_id AND actor.status='active'
    AND actor.user_type='noisia_internal' AND actor.primary_role IN('noisia_admin','admin','founder'))
  AND EXISTS(SELECT 1 FROM signal_workspace_features feature WHERE feature.workspace_id=NEW.workspace_id AND feature.feature='mass_labeling')
  AND exception.id IS NOT NULL AND exception.workspace_id=NEW.workspace_id AND exception.execution_id=NEW.execution_id
  AND exception.input_digest=NEW.input_digest AND exception.fit_checkpoint_digest=NEW.fit_checkpoint_digest
  AND exception.unit_manifest ? NEW.unit_key AND exception.original_call_id=original.id AND exception.repair_call_id=repair.id
  AND original.id IS NOT NULL AND repair.id IS NOT NULL AND original.call_state='settled' AND repair.call_state='settled'
  AND original.workspace_id=NEW.workspace_id AND repair.workspace_id=NEW.workspace_id
  AND original.catalog_execution_id=NEW.execution_id AND repair.catalog_execution_id=NEW.execution_id
  AND original.actor_user_id=NEW.created_by_user_id AND repair.actor_user_id=NEW.created_by_user_id
  AND original.workspace_contract='workspace-engine-interpretation-v1' AND repair.workspace_contract='workspace-engine-interpretation-v1'
  AND original.response_http_status=200 AND repair.response_http_status=200
  AND original.response_storage_key IS NOT NULL AND repair.response_storage_key IS NOT NULL
  AND COALESCE((original.metadata->>'response_complete')::boolean,true) AND COALESCE((repair.metadata->>'response_complete')::boolean,true)
  AND original.response_sha256=NEW.original_response_sha256 AND repair.response_sha256=NEW.repair_response_sha256
  AND exception.original_response_sha256=NEW.original_response_sha256 AND exception.repair_response_sha256=NEW.repair_response_sha256
  AND exception.original_request_digest=original.request_digest AND exception.repair_request_digest=repair.request_digest
  AND NOT original.metadata ? 'editorial_repair'
  AND repair.metadata#>>'{editorial_repair,source_call_id}'=original.id::text
  AND repair.metadata#>>'{editorial_repair,source_request_digest}'=original.request_digest
  AND repair.metadata#>>'{editorial_repair,source_response_sha256}'=original.response_sha256
  AND original.call_configuration=repair.call_configuration
  AND repair.call_configuration=workspace_engine_interpretation_configuration_v1(run.id,repair.metadata->>'interpretation_revision_digest')
  AND NOT EXISTS(SELECT 1 FROM signal_workspace_interpretation_exception_resolutions resolution WHERE resolution.exception_id=exception.id)
  AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=run.id
    AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' AND artifact.metadata->'unit_keys' ? NEW.unit_key)
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events pending WHERE pending.catalog_execution_id=run.id
    AND pending.workspace_contract='workspace-engine-interpretation-v1' AND pending.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')),false) THEN
  RAISE EXCEPTION 'workspace_engine_insufficiency_decision_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_insufficiency_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_interpretation_insufficiency_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_insufficiency_decision_v1();

CREATE FUNCTION guard_workspace_insufficiency_checkpoint_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE decision signal_workspace_interpretation_insufficiency_decisions%ROWTYPE; exception signal_workspace_interpretation_exceptions%ROWTYPE;
BEGIN
 IF NOT NEW.metadata ? 'insufficiency_decision_id' THEN RETURN NEW; END IF;
 SELECT * INTO decision FROM signal_workspace_interpretation_insufficiency_decisions WHERE id=(NEW.metadata->>'insufficiency_decision_id')::uuid;
 SELECT * INTO exception FROM signal_workspace_interpretation_exceptions WHERE id=decision.exception_id;
 IF NOT COALESCE(decision.id IS NOT NULL AND decision.workspace_id=NEW.workspace_id AND decision.execution_id=NEW.engine_execution_id
  AND NEW.artifact_type='engine_proposals' AND NEW.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
  AND NEW.metadata->>'call_id'=decision.repair_call_id::text AND NEW.metadata->>'response_sha256'=decision.repair_response_sha256
  AND NEW.metadata->>'fit_checkpoint_digest'=decision.fit_checkpoint_digest AND NEW.metadata->'unit_keys'=exception.unit_manifest,false) THEN
  RAISE EXCEPTION 'workspace_engine_insufficiency_checkpoint_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_insufficiency_checkpoint_guard BEFORE INSERT ON analysis_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_insufficiency_checkpoint_v1();
ALTER TABLE signal_workspace_interpretation_insufficiency_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_workspace_interpretation_insufficiency_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_workspace_insufficiency_decision_v1(),guard_workspace_insufficiency_checkpoint_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE signal_workspace_interpretation_insufficiency_decisions FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_insufficiency_decision_v1(),guard_workspace_insufficiency_checkpoint_v1() FROM %I',role_name);
 END LOOP;
END $$;
