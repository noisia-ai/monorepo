-- Durable failure/retry for preparation before the first provider batch exists.
-- Admission, quote, plan, cap, paid calls, and their historical receipts remain
-- immutable. This migration does not create an admission or authorize spending.

ALTER TABLE signal_topic_editorial_batch_owners_v2
  DROP CONSTRAINT signal_topic_editorial_batch_owners_v2_stage_check,
  ADD CONSTRAINT signal_topic_editorial_batch_owners_v2_stage_check
    CHECK(stage IN('screening','screening_ready','review_pending','preparation_failed'));

-- Serialize preparation against a terminal preparation failure. The existing
-- owner history trigger still permits only the stage column to change.
CREATE FUNCTION signal_topic_editorial_preparation_state_guard_v2() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE current_stage text;
BEGIN
 SELECT stage INTO current_stage FROM signal_topic_editorial_batch_owners_v2
  WHERE execution_id=NEW.execution_id FOR UPDATE;
 IF current_stage IS DISTINCT FROM 'screening' THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER topic_editorial_preparation_state_guard_v2
 BEFORE INSERT ON signal_topic_editorial_provider_batches_v2
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_preparation_state_guard_v2();

-- A Worker may mark a preparation failure only before any provider call or
-- durable provider batch exists. Repeating the same terminal mark is harmless.
CREATE FUNCTION mark_signal_topic_editorial_batch_preparation_failed_v2(target_execution uuid) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=target_execution;
 IF e.id IS NULL OR e.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2'
  OR o.execution_id IS NULL OR o.workspace_id IS DISTINCT FROM e.workspace_id
  OR o.plan_digest IS DISTINCT FROM e.plan_digest
  OR o.stage NOT IN('screening','preparation_failed')
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id)
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id) THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 IF o.stage='screening' THEN
  UPDATE signal_topic_editorial_batch_owners_v2 SET stage='preparation_failed' WHERE execution_id=e.id;
 END IF;
 RETURN jsonb_build_object('execution_id',e.id,'stage','preparation_failed','replayed',o.stage='preparation_failed');
END $$;

-- The actor can resume the already-admitted execution under a fresh key. The
-- digest distinguishes this operation from initial admission/replay while the
-- existing immutable request-key ledger retains each retry receipt forever.
CREATE FUNCTION retry_signal_topic_editorial_batch_preparation_v2(target_workspace uuid,target_actor uuid,
 target_execution uuid,request_key text) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 retry_digest text;result jsonb;is_replay boolean:=false;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN
  RAISE EXCEPTION 'topic_editorial_v2_request_invalid' USING ERRCODE='22023';
 END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));

 SELECT * INTO prior FROM signal_topic_editorial_request_keys
  WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL AND prior.execution_id<>target_execution THEN
  RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';
 END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions
  WHERE id=target_execution AND workspace_id=target_workspace AND actor_user_id=target_actor FOR UPDATE;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2
  WHERE execution_id=e.id AND workspace_id=target_workspace;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 IF e.id IS NULL OR o.execution_id IS NULL
  OR e.plan->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v2'
  OR o.plan_digest IS DISTINCT FROM e.plan_digest
  OR a.id IS NULL OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.actor_user_id IS DISTINCT FROM e.actor_user_id
  OR a.action IS DISTINCT FROM 'topic_consolidation' OR a.target_id IS DISTINCT FROM e.id
  OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR a.idempotency_key IS DISTINCT FROM e.idempotency_key OR a.request_digest IS DISTINCT FROM e.request_digest THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 retry_digest:=signal_topic_editorial_digest_json_v1(jsonb_build_object(
  'action','retry_preparation','workspace_id',e.workspace_id,'actor_user_id',e.actor_user_id,
  'execution_id',e.id,'plan_digest',e.plan_digest,'processing_admission_id',e.processing_admission_id,
  'admission_request_digest',e.request_digest));
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM retry_digest THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';
  END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 IF o.stage IS DISTINCT FROM 'preparation_failed'
  OR e.status NOT IN('queued','running')
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 WHERE execution_id=e.id)
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id)
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(e.plan->'requests')=0
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)
    IS DISTINCT FROM jsonb_array_length(e.plan->'requests') THEN
  RAISE EXCEPTION 'topic_editorial_preparation_retry_unavailable' USING ERRCODE='23514';
 END IF;
 UPDATE signal_topic_editorial_batch_owners_v2 SET stage='screening' WHERE execution_id=e.id;
 result:=jsonb_build_object('execution_id',e.id,'stage','screening','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
  VALUES(e.workspace_id,e.actor_user_id,request_key,e.id,retry_digest,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION signal_topic_editorial_preparation_state_guard_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_signal_topic_editorial_batch_preparation_failed_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION retry_signal_topic_editorial_batch_preparation_v2(uuid,uuid,uuid,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_preparation_state_guard_v2() FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION mark_signal_topic_editorial_batch_preparation_failed_v2(uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION retry_signal_topic_editorial_batch_preparation_v2(uuid,uuid,uuid,text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
