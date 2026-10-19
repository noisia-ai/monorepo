-- One metered editorial repair for a complete, settled invalid answer. The
-- original receipt/cost/configuration is retained; this is a different request,
-- never a retry_of successor of a sent/settled provider call.
CREATE UNIQUE INDEX uq_workspace_editorial_repair_source
 ON engine_cost_events(((metadata->'editorial_repair'->>'source_call_id')::uuid))
 WHERE workspace_contract='workspace-engine-interpretation-v1'
  AND metadata ? 'editorial_repair' AND retry_of_call_id IS NULL;

CREATE FUNCTION guard_workspace_engine_editorial_repair_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE repair jsonb; source engine_cost_events%ROWTYPE; prior engine_cost_events%ROWTYPE;
 execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 repair:=NEW.metadata->'editorial_repair';
 IF TG_OP='UPDATE' THEN
  IF repair IS DISTINCT FROM OLD.metadata->'editorial_repair' THEN
   RAISE EXCEPTION 'Editorial repair identity is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT (OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN RETURN NEW; END IF;
 END IF;
 IF repair IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(repair) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(repair))<>6
  OR NOT COALESCE(repair->>'contract_version'='workspace-editorial-repair-v1'
   AND repair->>'diagnostic'='output_invalid'
   AND repair->>'source_call_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
   AND repair->>'source_request_digest'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'source_response_sha256'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'protocol_digest'='sha256:7b113e97b33c00fc94a6043ac1f1f4a6c7aa99c5e792c465a384587e9b72e3d3',false) THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
 SELECT * INTO execution FROM signal_topic_catalog_executions
  WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO source FROM engine_cost_events WHERE id=(repair->>'source_call_id')::uuid FOR UPDATE;
 IF execution.status IS DISTINCT FROM 'running' OR execution.result_summary->'fit_checkpoint' IS NULL
  OR execution.input_snapshot->'interpretation_config' IS NULL
  OR source.id IS NULL OR source.workspace_contract IS DISTINCT FROM NEW.workspace_contract
  OR source.workspace_id IS DISTINCT FROM NEW.workspace_id OR source.catalog_execution_id IS DISTINCT FROM NEW.catalog_execution_id
  OR source.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR source.call_state IS DISTINCT FROM 'settled'
  OR source.response_storage_key IS NULL OR source.response_http_status IS DISTINCT FROM 200
  OR NOT COALESCE((source.metadata->>'response_complete')::boolean,true)
  OR source.metadata ? 'editorial_repair'
  OR source.request_digest IS DISTINCT FROM repair->>'source_request_digest'
  OR source.response_sha256 IS DISTINCT FROM repair->>'source_response_sha256'
  OR source.request_digest=NEW.request_digest OR source.call_configuration IS DISTINCT FROM NEW.call_configuration
  OR NEW.call_configuration IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->'call_configuration'
  OR EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=NEW.catalog_execution_id
    AND artifact.metadata->>'call_id'=source.id::text) THEN
   RAISE EXCEPTION 'Editorial repair requires its unmaterialized settled source receipt.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM engine_cost_events other WHERE other.catalog_execution_id=NEW.catalog_execution_id
   AND other.id<>NEW.id AND other.call_state IN('in_flight','response_persisted','outcome_unknown')) THEN
  RAISE EXCEPTION 'Unresolved provider outcome blocks editorial repair.' USING ERRCODE='23514'; END IF;
 IF NEW.retry_of_call_id IS NOT NULL THEN
  SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
  IF prior.call_state IS DISTINCT FROM 'definitely_not_sent' OR prior.metadata->'editorial_repair' IS DISTINCT FROM repair THEN
   RAISE EXCEPTION 'Only an unsent repair attempt can have a transport successor.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_editorial_repair
 BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_engine_editorial_repair_v1();
REVOKE ALL ON FUNCTION guard_workspace_engine_editorial_repair_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_engine_editorial_repair_v1() FROM %I',role_name);
 END LOOP;
END; $$;
