-- Keep a global transport successor on its original sealed stage and source.
-- Terminal billing is an independent audited transition, never a fabricated raw.
CREATE FUNCTION guard_signal_mass_labeling_global_successor_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent engine_cost_events%ROWTYPE; receipt jsonb; billing jsonb;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1'
   OR NEW.retry_of_call_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO parent FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
 IF NOT (NEW.metadata ? 'mass_labeling_stage' OR parent.metadata ? 'mass_labeling_stage') THEN RETURN NEW; END IF;
 IF NEW.metadata->'mass_labeling_stage' IS DISTINCT FROM parent.metadata->'mass_labeling_stage'
   OR NEW.metadata ? 'editorial_repair' OR parent.metadata ? 'editorial_repair' THEN
  RAISE EXCEPTION 'mass_labeling_global_successor_stage_mismatch' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' OR NEW.call_state='in_flight' AND OLD.call_state='reserved' THEN
  IF EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.workspace_id=NEW.workspace_id
    AND artifact.engine_execution_id=NEW.catalog_execution_id
    AND artifact.metadata->>'contract_version'='workspace-mass-labeling-consolidation-v1') THEN
   RAISE EXCEPTION 'mass_labeling_global_artifact_already_persisted' USING ERRCODE='23514';
  END IF;
 END IF;
 IF parent.call_state='terminal_confirmed' THEN
  receipt=parent.metadata->'provider_terminal_receipt';
  billing=parent.metadata->'provider_terminal_billing_reconciliation';
  IF NOT COALESCE(parent.settled_micro_usd IS NOT NULL
    AND receipt->>'contract_version'='workspace-provider-terminal-evidence-v1'
    AND billing->>'contract_version'='workspace-provider-terminal-billing-v1'
    AND billing->>'method'='audited_usage_pricing'
    AND billing->>'provider_request_id'=receipt->>'provider_request_id'
    AND billing->'actual_micro_usd'=to_jsonb(parent.settled_micro_usd)
    AND billing->'usage'=receipt->'usage'
    AND billing->>'terminal_receipt_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(receipt),'UTF8')),'hex'),false) THEN
   RAISE EXCEPTION 'mass_labeling_global_terminal_billing_required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_global_successor BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_global_successor_v1();
REVOKE ALL ON FUNCTION guard_signal_mass_labeling_global_successor_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_mass_labeling_global_successor_v1() FROM %I',role_name);
 END LOOP;
END $$;
