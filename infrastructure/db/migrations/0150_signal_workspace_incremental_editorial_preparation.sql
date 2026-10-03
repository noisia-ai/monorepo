-- Free evidence preparation has its own delivery receipt; no engine/cost state
-- or monetary admission is created or changed by this migration.
ALTER TABLE signal_classification_operations DROP CONSTRAINT signal_classification_operations_operation_kind_check;
ALTER TABLE signal_classification_operations ADD CONSTRAINT signal_classification_operations_operation_kind_check CHECK(operation_kind IN(
 'create-generation','append-results','finalize-generation','supersede-assignment','register-labeling-function','register-approval-policy','register-gold-set',
 'register-model','transition-model','evaluate-classifier','evaluate-classifier-slice','project-generation','authorize-interpretation','revoke-interpretation','prepare-incremental-editorial'));
ALTER TABLE signal_topic_classification_outbox DROP CONSTRAINT signal_topic_classification_outbox_dispatch_kind_check;
ALTER TABLE signal_topic_classification_outbox ADD CONSTRAINT signal_topic_classification_outbox_dispatch_kind_check
 CHECK(dispatch_kind IN('execution','engine_progress','incremental_projection','incremental_editorial_evidence'));
ALTER TABLE signal_topic_classification_outbox
 ADD COLUMN preparation_operation_id uuid REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
 ADD COLUMN preparation_plan_artifact_id uuid REFERENCES analysis_artifacts(id) ON DELETE RESTRICT,
 ADD COLUMN preparation_token uuid,
 ADD COLUMN preparation_expires_at timestamptz;
ALTER TABLE signal_topic_classification_outbox ADD CONSTRAINT workspace_incremental_editorial_preparation_shape CHECK(
 (dispatch_kind<>'incremental_editorial_evidence' AND preparation_operation_id IS NULL AND preparation_plan_artifact_id IS NULL AND preparation_token IS NULL AND preparation_expires_at IS NULL)
 OR (dispatch_kind='incremental_editorial_evidence' AND preparation_operation_id IS NOT NULL
  AND ((status='completed' AND preparation_plan_artifact_id IS NOT NULL) OR (status<>'completed' AND preparation_plan_artifact_id IS NULL))
  AND ((preparation_token IS NULL AND preparation_expires_at IS NULL) OR
    (preparation_token IS NOT NULL AND preparation_expires_at IS NOT NULL AND status IN('dispatching','dispatched')))));

CREATE FUNCTION workspace_incremental_editorial_preparation_source_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('contract_version','workspace-incremental-editorial-preparation-source-v1','numeric_execution_id',source.id::text,
  'numeric_checkpoint_digest',source.result_summary->'numeric_checkpoint'->>'checkpoint_digest','input_revision',source.input_revision::text,
  'context_digest',source.input_snapshot->>'context_digest','catalog_digest',source.input_snapshot->>'catalog_digest',
  'census_digest',workspace_incremental_editorial_census_v1(source.id),
  'history_cut_digest',signal_workspace_incremental_projection_editorial_digest_v1(source.id),
  'units_digest',(SELECT workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(jsonb_build_object(
    'identity',unit.identity,'claimed_by',unit.claimed_by,'emergent',unit.emergent) ORDER BY unit.identity->'unit'->>'unit_key' COLLATE "C"),'[]'::jsonb))
    FROM workspace_incremental_editorial_units_v1(source.id) unit),
  'origins_digest',(SELECT workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(origin ORDER BY origin->>'execution_id'),'[]'::jsonb)) FROM(
    SELECT DISTINCT jsonb_build_object('execution_id',owner.id::text,'numeric_checkpoint',owner.result_summary->'numeric_checkpoint',
      'fit_checkpoint_digest',owner.result_summary->'fit_checkpoint'->>'checkpoint_digest') origin
    FROM analysis_artifacts component JOIN signal_topic_catalog_executions owner ON owner.id::text=component.metadata->'model_origin'->>'execution_id' AND owner.workspace_id=component.workspace_id
    WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1') origins))
 FROM signal_topic_catalog_executions source WHERE source.id=target AND source.input_contract='workspace-topic-engine-v1'
  AND source.input_snapshot ? 'numeric_descriptor' AND source.result_summary ? 'numeric_checkpoint'
$$;

CREATE FUNCTION guard_workspace_incremental_editorial_preparation_request_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ DECLARE source jsonb; BEGIN
 IF NEW.operation_kind<>'prepare-incremental-editorial' THEN RETURN NEW; END IF;
 source:=workspace_incremental_editorial_preparation_source_v1((NEW.result->>'numeric_execution_id')::uuid);
 IF NOT COALESCE(NEW.status='completed' AND NEW.completed_at IS NOT NULL
  AND NEW.result->>'contract_version'='workspace-incremental-editorial-preparation-request-v1'
  AND NEW.result->>'operation_id'=NEW.id::text AND NEW.result->>'workspace_id'=NEW.workspace_id::text
  AND NEW.result->>'actor_user_id'=NEW.actor_user_id::text AND NEW.result->'charge_micro_usd'='0'::jsonb
  AND pg_column_size(NEW.result)<=16384
  AND NEW.result->'source'=source AND NEW.result->>'source_digest'=workspace_incremental_editorial_digest_v1(source)
  AND NEW.result->>'worker_job_id'='workspace-incremental-editorial-evidence-'||(NEW.result->>'numeric_execution_id')||'-'||substr(NEW.result->>'source_digest',8)
  AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,NEW.actor_user_id)
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.id::text=NEW.result->>'numeric_execution_id' AND run.workspace_id=NEW.workspace_id
    AND workspace_incremental_editorial_source_v1(run.id)),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_request_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_preparation_request BEFORE INSERT ON signal_classification_operations
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_preparation_request_v1();

CREATE FUNCTION guard_workspace_incremental_editorial_preparation_dispatch_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ DECLARE operation signal_classification_operations; BEGIN
 IF TG_OP='UPDATE' AND OLD.dispatch_kind='incremental_editorial_evidence' AND
   (NEW.dispatch_kind<>OLD.dispatch_kind OR NEW.execution_id<>OLD.execution_id OR NEW.workspace_id<>OLD.workspace_id) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_dispatch_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.dispatch_kind<>'incremental_editorial_evidence' THEN RETURN NEW; END IF;
 SELECT * INTO operation FROM signal_classification_operations WHERE id=NEW.preparation_operation_id AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(operation.operation_kind='prepare-incremental-editorial' AND operation.status='completed'
  AND operation.result->>'numeric_execution_id'=NEW.execution_id::text AND operation.result->>'worker_job_id'=NEW.worker_job_id
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.id=NEW.execution_id AND run.workspace_id=NEW.workspace_id
    AND run.status='ready' AND run.input_snapshot ? 'numeric_descriptor' AND (run.input_snapshot->>'claude_cap_micro_usd')::bigint=0),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_dispatch_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR NEW.preparation_operation_id IS DISTINCT FROM OLD.preparation_operation_id
   OR (NEW.preparation_token IS NOT NULL AND NEW.preparation_token IS DISTINCT FROM OLD.preparation_token) THEN
  IF NOT COALESCE(workspace_incremental_editorial_source_v1(NEW.execution_id)
   AND operation.result->'source'=workspace_incremental_editorial_preparation_source_v1(NEW.execution_id)
   AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,operation.actor_user_id),false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_preparation_source_stale' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.preparation_token IS NOT NULL AND OLD.preparation_expires_at>clock_timestamp() THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_preparation_busy' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id=NEW.preparation_plan_artifact_id
   AND plan.workspace_id=NEW.workspace_id AND plan.metadata->>'numeric_execution_id'=NEW.execution_id::text
   AND plan.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1'
   AND plan.metadata->>'history_cut_digest'=operation.result->'source'->>'history_cut_digest') THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_plan_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status<>'completed') AND NOT COALESCE(
    OLD.preparation_token IS NOT NULL AND OLD.preparation_expires_at>clock_timestamp()
    AND operation.result->'source'=workspace_incremental_editorial_preparation_source_v1(NEW.execution_id)
    AND workspace_incremental_editorial_plan_valid_v1(NEW.preparation_plan_artifact_id),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_completion_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_preparation_dispatch BEFORE INSERT OR UPDATE ON signal_topic_classification_outbox
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_preparation_dispatch_v1();

CREATE FUNCTION guard_workspace_incremental_editorial_preparation_complete_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.operation_kind='prepare-incremental-editorial' AND NOT EXISTS(SELECT 1 FROM signal_topic_classification_outbox dispatch
  WHERE dispatch.execution_id::text=NEW.result->>'numeric_execution_id' AND dispatch.workspace_id=NEW.workspace_id
   AND dispatch.dispatch_kind='incremental_editorial_evidence' AND dispatch.worker_job_id=NEW.result->>'worker_job_id') THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_dispatch_missing' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER trg_workspace_incremental_editorial_preparation_complete AFTER INSERT ON signal_classification_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_preparation_complete_v1();

DO $$ DECLARE routine regprocedure; role_name text; BEGIN
 FOR routine IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('workspace_incremental_editorial_preparation_source_v1','guard_workspace_incremental_editorial_preparation_request_v1',
    'guard_workspace_incremental_editorial_preparation_dispatch_v1','guard_workspace_incremental_editorial_preparation_complete_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',routine);
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',routine,role_name);
  END LOOP;
 END LOOP;
END $$;
COMMENT ON FUNCTION guard_workspace_incremental_editorial_preparation_dispatch_v1() IS 'workspace-incremental-editorial-preparation-v1';
