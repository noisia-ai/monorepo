-- Recovery records are additional evidence, never replacement provider authority.
CREATE TABLE signal_workspace_interpretation_unit_claims(
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 unit_key text NOT NULL CHECK(unit_key~'^[A-Za-z0-9:._-]{1,200}$'),
 original_call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 original_request_digest text NOT NULL CHECK(original_request_digest~'^sha256:[0-9a-f]{64}$'),
 input_digest text NOT NULL, fit_checkpoint_digest text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(execution_id,unit_key)
);
CREATE INDEX workspace_interpretation_unit_claims_request ON signal_workspace_interpretation_unit_claims(execution_id,original_request_digest);

CREATE TABLE signal_workspace_interpretation_receipt_reviews(
 call_id uuid PRIMARY KEY REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 response_sha256 text NOT NULL CHECK(response_sha256~'^sha256:[0-9a-f]{64}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 unit_manifest jsonb NOT NULL CHECK(jsonb_typeof(unit_manifest)='array' AND jsonb_array_length(unit_manifest) BETWEEN 1 AND 128),
 outcome text NOT NULL CHECK(outcome='needs_repair'),
 validator_version text NOT NULL CHECK(length(validator_version) BETWEEN 1 AND 120),
 input_digest text NOT NULL,fit_checkpoint_digest text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE signal_workspace_interpretation_exception_resolutions(
 exception_id uuid PRIMARY KEY REFERENCES signal_workspace_interpretation_exceptions(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 artifact_id uuid NOT NULL UNIQUE REFERENCES analysis_artifacts(id) ON DELETE RESTRICT,
 call_id uuid NOT NULL REFERENCES engine_cost_events(id) ON DELETE RESTRICT,
 original_response_sha256 text NOT NULL,repair_response_sha256 text NOT NULL,resolved_response_sha256 text NOT NULL,
 validator_version text NOT NULL CHECK(length(validator_version) BETWEEN 1 AND 120),
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION guard_workspace_interpretation_recovery_evidence_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; receipt engine_cost_events%ROWTYPE;
 exception signal_workspace_interpretation_exceptions%ROWTYPE; artifact analysis_artifacts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Interpretation recovery evidence is append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF COALESCE(run.id IS NULL OR run.status<>'running' OR run.execution_expires_at<=clock_timestamp()
  OR run.input_contract<>'workspace-topic-engine-v1'
  OR run.input_snapshot#>>'{engine_config,profile_version}' NOT IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
  OR run.result_summary->'fit_checkpoint' IS NULL OR NEW.created_by_user_id<>run.actor_user_id
  OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id),true) THEN
  RAISE EXCEPTION 'workspace_engine_interpretation_recovery_invalid' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='signal_workspace_interpretation_unit_claims' THEN
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.original_call_id;
  IF COALESCE(NEW.input_digest<>run.input_digest OR NEW.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR receipt.id IS NULL OR receipt.workspace_id<>NEW.workspace_id OR receipt.catalog_execution_id<>NEW.execution_id
   OR receipt.actor_user_id<>run.actor_user_id OR receipt.workspace_contract<>'workspace-engine-interpretation-v1'
   OR receipt.metadata ? 'editorial_repair' OR receipt.metadata ? 'mass_labeling_stage'
   OR receipt.request_digest<>NEW.original_request_digest
   OR receipt.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(run.id,receipt.metadata->>'interpretation_revision_digest')
   OR (receipt.metadata ? 'unit_manifest' AND NOT receipt.metadata->'unit_manifest' ? NEW.unit_key),true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_unit_claim_invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='signal_workspace_interpretation_receipt_reviews' THEN
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.call_id;
  IF COALESCE(NEW.input_digest<>run.input_digest OR NEW.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR receipt.id IS NULL OR receipt.workspace_id<>NEW.workspace_id OR receipt.catalog_execution_id<>NEW.execution_id
   OR receipt.actor_user_id<>run.actor_user_id OR receipt.call_state<>'settled' OR receipt.response_http_status<>200
   OR NOT COALESCE((receipt.metadata->>'response_complete')::boolean,true) OR receipt.response_storage_key IS NULL
   OR receipt.metadata ? 'editorial_repair' OR receipt.metadata ? 'mass_labeling_stage'
   OR receipt.response_sha256<>NEW.response_sha256 OR receipt.request_digest<>NEW.request_digest
   OR receipt.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(run.id,receipt.metadata->>'interpretation_revision_digest')
   OR NEW.unit_manifest IS DISTINCT FROM (SELECT jsonb_agg(claim.unit_key ORDER BY claim.unit_key COLLATE "C")
      FROM signal_workspace_interpretation_unit_claims claim WHERE claim.execution_id=run.id AND claim.original_request_digest=receipt.request_digest)
   OR EXISTS(SELECT 1 FROM engine_cost_events repair WHERE repair.catalog_execution_id=run.id AND repair.metadata#>>'{editorial_repair,source_call_id}'=receipt.id::text),true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_recovery_review_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO exception FROM signal_workspace_interpretation_exceptions WHERE id=NEW.exception_id;
  SELECT * INTO artifact FROM analysis_artifacts WHERE id=NEW.artifact_id;
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.call_id;
  IF COALESCE(exception.id IS NULL OR exception.workspace_id<>run.workspace_id OR exception.execution_id<>run.id
   OR exception.input_digest<>run.input_digest OR exception.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR artifact.id IS NULL OR artifact.workspace_id<>run.workspace_id OR artifact.engine_execution_id<>run.id
   OR artifact.metadata->>'contract_version'<>'workspace-engine-interpretation-checkpoint-v1'
   OR artifact.metadata->'unit_keys' IS DISTINCT FROM exception.unit_manifest
   OR artifact.metadata->>'call_id'<>NEW.call_id::text
   OR receipt.id NOT IN(exception.original_call_id,exception.repair_call_id) OR receipt.call_state<>'settled'
   OR receipt.response_http_status<>200 OR receipt.workspace_id<>run.workspace_id OR receipt.catalog_execution_id<>run.id
   OR receipt.response_sha256<>NEW.resolved_response_sha256 OR artifact.metadata->>'response_sha256'<>receipt.response_sha256
   OR NEW.original_response_sha256<>exception.original_response_sha256 OR NEW.repair_response_sha256<>exception.repair_response_sha256,true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_exception_resolution_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_interpretation_unit_claims_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_interpretation_unit_claims
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_recovery_evidence_v1();
CREATE TRIGGER workspace_interpretation_receipt_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_interpretation_receipt_reviews
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_recovery_evidence_v1();
CREATE TRIGGER workspace_interpretation_exception_resolutions_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_interpretation_exception_resolutions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_recovery_evidence_v1();

CREATE FUNCTION guard_workspace_interpretation_unit_manifest_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE original_digest text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.metadata->'unit_manifest' IS DISTINCT FROM OLD.metadata->'unit_manifest' THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_unit_manifest_immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.workspace_contract='workspace-engine-interpretation-v1' AND NOT NEW.metadata ? 'mass_labeling_stage'
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.id=NEW.catalog_execution_id
    AND run.input_snapshot#>>'{engine_config,profile_version}' IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')) THEN
  original_digest=COALESCE(NEW.metadata#>>'{editorial_repair,source_request_digest}',NEW.request_digest);
  IF jsonb_typeof(NEW.metadata->'unit_manifest') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.metadata->'unit_manifest') NOT BETWEEN 1 AND 128
   OR NEW.metadata->'unit_manifest' IS DISTINCT FROM (SELECT jsonb_agg(claim.unit_key ORDER BY claim.unit_key COLLATE "C")
    FROM signal_workspace_interpretation_unit_claims claim WHERE claim.execution_id=NEW.catalog_execution_id AND claim.original_request_digest=original_digest) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_unit_claims_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_interpretation_unit_manifest_immutable BEFORE UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_unit_manifest_v1();
CREATE CONSTRAINT TRIGGER workspace_interpretation_unit_manifest_owner AFTER INSERT ON engine_cost_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_unit_manifest_v1();
DO $$ DECLARE object_name text;role_name text; BEGIN
 FOREACH object_name IN ARRAY ARRAY['signal_workspace_interpretation_unit_claims','signal_workspace_interpretation_receipt_reviews','signal_workspace_interpretation_exception_resolutions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',object_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
   EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',object_name,role_name);
  END LOOP;
 END LOOP;
 REVOKE ALL ON FUNCTION guard_workspace_interpretation_recovery_evidence_v1(),guard_workspace_interpretation_unit_manifest_v1() FROM PUBLIC;
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_interpretation_recovery_evidence_v1(),guard_workspace_interpretation_unit_manifest_v1() FROM %I',role_name);
 END LOOP;
END $$;
