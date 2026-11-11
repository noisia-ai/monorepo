-- Preserve the original unknown call and technical error before recovering its
-- already-paid bytes. Installation does not reconcile or enqueue any work.
CREATE TABLE signal_mass_labeling_jev_receipt_recoveries (
 call_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,run_id uuid NOT NULL,map_id uuid NOT NULL,root_id uuid NOT NULL,
 request_digest text NOT NULL,raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 raw_storage_key text NOT NULL,raw_size_bytes bigint NOT NULL CHECK(raw_size_bytes BETWEEN 1 AND 8388608),
 original_call jsonb NOT NULL,original_result jsonb NOT NULL,recovered_result jsonb NOT NULL,
 usage jsonb NOT NULL,settled_micro_usd bigint NOT NULL CHECK(settled_micro_usd>=0),
 recovered_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,call_id) REFERENCES signal_labeling_calls(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id)
);
ALTER TABLE signal_mass_labeling_jev_receipt_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_jev_receipt_recoveries FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_mass_labeling_jev_receipt_recoveries FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION guard_signal_mass_labeling_jev_recovery_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_labeling_calls%ROWTYPE; outcome signal_mass_labeling_results%ROWTYPE;
BEGIN
 SELECT * INTO receipt FROM signal_labeling_calls WHERE workspace_id=NEW.workspace_id AND id=NEW.call_id FOR UPDATE;
 SELECT * INTO outcome FROM signal_mass_labeling_results WHERE workspace_id=NEW.workspace_id AND map_id=NEW.map_id AND root_id=NEW.root_id FOR UPDATE;
 IF receipt.id IS NULL OR outcome.call_id IS DISTINCT FROM receipt.id OR receipt.run_id IS DISTINCT FROM NEW.run_id
  OR receipt.provider<>'typesafe' OR receipt.transport<>'sync' OR receipt.status<>'unknown'
  OR receipt.settled_micro_usd IS NOT NULL OR receipt.usage IS NOT NULL OR receipt.terminal_exposure_micro_usd<>0
  OR NOT receipt.results_applied OR outcome.status<>'error' OR receipt.request_digest IS DISTINCT FROM NEW.request_digest
  OR NEW.original_call IS DISTINCT FROM to_jsonb(receipt) OR NEW.original_result IS DISTINCT FROM to_jsonb(outcome)
  OR NEW.raw_storage_key IS DISTINCT FROM 'workspace-engine/'||NEW.workspace_id||'/'||NEW.run_id||'/response-'||NEW.call_id||'.json.'||substr(NEW.raw_sha256,8)||'.parts.json'
  OR NEW.recovered_result->>'root_id' IS DISTINCT FROM NEW.root_id::text
  OR NEW.recovered_result->>'input_digest' IS DISTINCT FROM receipt.inputs->0->>'input_digest'
  OR NOT COALESCE(NEW.recovered_result->>'status' IN('labeled','abstained'),false)
  OR receipt.raw_sha256 IS NOT NULL AND receipt.raw_sha256 IS DISTINCT FROM NEW.raw_sha256
  OR receipt.raw_storage_key IS NOT NULL AND receipt.raw_storage_key IS DISTINCT FROM NEW.raw_storage_key
  OR NOT EXISTS(SELECT 1 FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
    JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id AND admission.target_id=run.id AND admission.workspace_id=run.workspace_id
    WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND run.kind='mass_labeling'
     AND run.actor_user_id=NEW.recovered_by_user_id AND run.status='failed' AND run.error_code='labeling_outcome_unknown'
     AND (run.lease_until IS NULL OR run.lease_until<now())
     AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2') THEN
  RAISE EXCEPTION 'mass_labeling_jev_recovery_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_jev_recovery_lineage BEFORE INSERT ON signal_mass_labeling_jev_receipt_recoveries
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_jev_recovery_v1();
CREATE TRIGGER mass_labeling_jev_recovery_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_jev_receipt_recoveries
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();

CREATE FUNCTION guard_signal_mass_labeling_result_recovery_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR OLD.status<>'error' OR NEW.status NOT IN('labeled','abstained')
  OR ROW(NEW.workspace_id,NEW.map_id,NEW.root_id,NEW.run_id,NEW.call_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.map_id,OLD.root_id,OLD.run_id,OLD.call_id,OLD.created_at)
  OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_jev_receipt_recoveries recovery
    JOIN signal_labeling_calls receipt ON receipt.id=recovery.call_id AND receipt.workspace_id=recovery.workspace_id
    WHERE recovery.call_id=OLD.call_id AND recovery.original_result=to_jsonb(OLD)
      AND recovery.recovered_result->>'status'=NEW.status AND NEW.error_code IS NULL
      AND recovery.recovered_result->'probabilities'=NEW.probabilities
      AND receipt.status='settled' AND receipt.raw_sha256=recovery.raw_sha256
      AND receipt.raw_storage_key=recovery.raw_storage_key AND receipt.raw_size_bytes=recovery.raw_size_bytes
      AND receipt.raw_storage_verified_at IS NOT NULL AND receipt.raw_storage_verified_key=receipt.raw_storage_key
      AND receipt.usage=recovery.usage AND receipt.settled_micro_usd=recovery.settled_micro_usd
      AND receipt.results_applied AND receipt.results=jsonb_build_array(recovery.recovered_result)) THEN
  RAISE EXCEPTION 'mass_labeling_history_is_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER mass_labeling_results_immutable ON signal_mass_labeling_results;
CREATE TRIGGER mass_labeling_results_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_results
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_result_recovery_v1();
CREATE TRIGGER mass_labeling_zrecovery_lineage BEFORE UPDATE ON signal_mass_labeling_results
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_result_v1();
CREATE TRIGGER mass_labeling_serving_recovered_results AFTER UPDATE ON signal_mass_labeling_results
 REFERENCING NEW TABLE AS serving_results FOR EACH STATEMENT EXECUTE FUNCTION materialize_signal_mass_labeling_serving_results_v1();
REVOKE ALL ON FUNCTION guard_signal_mass_labeling_jev_recovery_v1(),guard_signal_mass_labeling_result_recovery_v1() FROM PUBLIC;
