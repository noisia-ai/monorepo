-- A paid original + one paid repair may still be structurally invalid. Preserve
-- both receipts and quarantine the whole logical batch so one group cannot stop
-- every later group. This table grants no provider authority and owns no output.
CREATE TABLE signal_workspace_interpretation_exceptions(
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 original_call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 repair_call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 original_request_digest text NOT NULL CHECK(original_request_digest~'^sha256:[0-9a-f]{64}$'),
 repair_request_digest text NOT NULL CHECK(repair_request_digest~'^sha256:[0-9a-f]{64}$'),
 original_response_sha256 text NOT NULL CHECK(original_response_sha256~'^sha256:[0-9a-f]{64}$'),
 repair_response_sha256 text NOT NULL CHECK(repair_response_sha256~'^sha256:[0-9a-f]{64}$'),
 input_digest text NOT NULL CHECK(input_digest~'^sha256:[0-9a-f]{64}$'),
 fit_checkpoint_digest text NOT NULL CHECK(fit_checkpoint_digest~'^sha256:[0-9a-f]{64}$'),
 configuration_digest text NOT NULL CHECK(configuration_digest~'^sha256:[0-9a-f]{64}$'),
 batch_digest text NOT NULL CHECK(batch_digest~'^sha256:[0-9a-f]{64}$'),
 unit_digest text NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 unit_manifest jsonb NOT NULL CHECK(jsonb_typeof(unit_manifest)='array' AND jsonb_array_length(unit_manifest) BETWEEN 1 AND 128),
 validator_version text NOT NULL CHECK(length(validator_version) BETWEEN 1 AND 120),
 diagnostic_code text NOT NULL CHECK(diagnostic_code='workspace_engine_interpretation_repair_invalid'),
 status text NOT NULL DEFAULT 'quarantined' CHECK(status='quarantined'),
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(execution_id,repair_call_id)
);

CREATE FUNCTION guard_signal_workspace_interpretation_exception_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; original engine_cost_events%ROWTYPE;
 repair engine_cost_events%ROWTYPE; calculated_digest text; duplicate_unit boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Interpretation exceptions are append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO original FROM engine_cost_events WHERE id=NEW.original_call_id FOR UPDATE;
 SELECT * INTO repair FROM engine_cost_events WHERE id=NEW.repair_call_id FOR UPDATE;
 SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(value)::text||E'\n','' ORDER BY value COLLATE "C"),''),'UTF8')),'hex'),
   count(*)<>count(DISTINCT value) INTO calculated_digest,duplicate_unit FROM jsonb_array_elements_text(NEW.unit_manifest) unit(value);
 IF run.id IS NULL OR run.input_contract IS DISTINCT FROM 'workspace-topic-engine-v1' OR run.status IS DISTINCT FROM 'running'
  OR run.input_digest IS DISTINCT FROM NEW.input_digest
  OR run.result_summary->'fit_checkpoint'->>'checkpoint_digest' IS DISTINCT FROM NEW.fit_checkpoint_digest
  OR original.id IS NULL OR repair.id IS NULL
  OR original.workspace_id IS DISTINCT FROM NEW.workspace_id OR repair.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR original.catalog_execution_id IS DISTINCT FROM NEW.execution_id OR repair.catalog_execution_id IS DISTINCT FROM NEW.execution_id
  OR original.actor_user_id IS DISTINCT FROM run.actor_user_id OR repair.actor_user_id IS DISTINCT FROM run.actor_user_id
  OR original.call_state IS DISTINCT FROM 'settled' OR repair.call_state IS DISTINCT FROM 'settled'
  OR original.response_storage_key IS NULL OR repair.response_storage_key IS NULL
  OR NOT COALESCE((original.metadata->>'response_complete')::boolean,true)
  OR NOT COALESCE((repair.metadata->>'response_complete')::boolean,true)
  OR original.metadata ? 'editorial_repair' OR NOT (repair.metadata ? 'editorial_repair')
  OR repair.metadata->'editorial_repair'->>'contract_version' IS DISTINCT FROM 'workspace-editorial-repair-v1'
  OR repair.metadata->'editorial_repair'->>'diagnostic' IS DISTINCT FROM 'output_invalid'
  OR repair.metadata->'editorial_repair'->>'source_call_id' IS DISTINCT FROM original.id::text
  OR repair.metadata->'editorial_repair'->>'source_request_digest' IS DISTINCT FROM original.request_digest
  OR repair.metadata->'editorial_repair'->>'source_response_sha256' IS DISTINCT FROM original.response_sha256
  OR original.request_digest IS DISTINCT FROM NEW.original_request_digest OR repair.request_digest IS DISTINCT FROM NEW.repair_request_digest
  OR original.response_sha256 IS DISTINCT FROM NEW.original_response_sha256 OR repair.response_sha256 IS DISTINCT FROM NEW.repair_response_sha256
  OR original.call_configuration IS DISTINCT FROM repair.call_configuration
  OR NEW.configuration_digest<>'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(repair.call_configuration),'UTF8')),'hex')
  OR NEW.created_by_user_id IS DISTINCT FROM run.actor_user_id OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
  OR calculated_digest IS DISTINCT FROM NEW.unit_digest OR duplicate_unit IS DISTINCT FROM false
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.unit_manifest) unit(value) WHERE value!~'^[A-Za-z0-9:._-]{1,200}$')
  OR EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=NEW.execution_id
    AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
    AND ((artifact.metadata->>'call_id')::uuid IN(NEW.original_call_id,NEW.repair_call_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(artifact.metadata->'unit_keys') prior(value)
        JOIN jsonb_array_elements_text(NEW.unit_manifest) incoming(value) USING(value))))
  OR EXISTS(SELECT 1 FROM signal_workspace_interpretation_exceptions prior
    CROSS JOIN LATERAL jsonb_array_elements_text(prior.unit_manifest) prior_unit(value)
    JOIN LATERAL jsonb_array_elements_text(NEW.unit_manifest) incoming(value) ON incoming.value=prior_unit.value
    WHERE prior.execution_id=NEW.execution_id) THEN
  RAISE EXCEPTION 'Interpretation exception evidence is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER trg_signal_workspace_interpretation_exception
 BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_interpretation_exceptions
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_interpretation_exception_v1();

ALTER TABLE signal_workspace_interpretation_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_workspace_interpretation_exceptions FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_signal_workspace_interpretation_exception_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE signal_workspace_interpretation_exceptions FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_workspace_interpretation_exception_v1() FROM %I',role_name);
 END LOOP;
END $$;
