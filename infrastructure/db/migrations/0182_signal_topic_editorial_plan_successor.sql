-- Provider JSON schema evolution invalidates the sealed request bytes of an
-- existing editorial execution. Keep that execution immutable and permit one
-- explicit successor only when the prior execution is terminal, current-plan
-- invalid, and has no paid or ambiguous provider exposure.
CREATE OR REPLACE FUNCTION signal_topic_editorial_configuration_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT '{"contract_version":"signal-topic-editorial-execution-config-v1","screening":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"screening","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:08f97c1229f3a2603a69d5224c97492b7d0cb32bb2c65c868233fae06a551f2e","schema_digest":"sha256:e364fb061253c5f210b27deede7964ac36de014b8279d5d8b2de26f54828eee5","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":8192},"global":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"global","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:13996f4e96d9aeac84712100447d6c0a1ab289bee242f187cf434ef8ddc2121d","schema_digest":"sha256:7b601890771c9992a3be20fbbaefa2c2613993601d159831243ea4dd4406161f","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":32768},"screening_batch_size":40,"max_call_attempts":3}'::jsonb $$;

ALTER TABLE signal_topic_editorial_executions
 DROP CONSTRAINT signal_topic_editorial_executions_numeric_run_id_key,
 ADD COLUMN supersedes_execution_id uuid REFERENCES signal_topic_editorial_executions(id),
 ADD CONSTRAINT topic_editorial_successor_not_self CHECK(supersedes_execution_id IS NULL OR supersedes_execution_id<>id);
CREATE UNIQUE INDEX uq_topic_editorial_live_numeric_run ON signal_topic_editorial_executions(numeric_run_id) WHERE status<>'failed';
CREATE UNIQUE INDEX uq_topic_editorial_successor ON signal_topic_editorial_executions(supersedes_execution_id) WHERE supersedes_execution_id IS NOT NULL;

CREATE FUNCTION signal_topic_editorial_execution_replaceable_v1(target_execution uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(e.status='failed'
  AND NOT signal_topic_editorial_plan_valid_v1(e.numeric_run_id,e.plan)
  AND COALESCE(jsonb_array_length(e.state_body::jsonb->'screening_outputs'),0)=0
  AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id
   AND (c.status<>'settled' OR COALESCE(c.settled_micro_usd,0)<>0) AND c.status<>'definitely_not_sent')
  AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_outbox o WHERE o.execution_id=e.id AND o.status IN('queued','dispatching')),
 false)
 FROM signal_topic_editorial_executions e WHERE e.id=target_execution $$;

CREATE FUNCTION signal_topic_editorial_successor_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF NEW.supersedes_execution_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM signal_topic_editorial_executions e WHERE e.numeric_run_id=NEW.numeric_run_id) THEN
   RAISE EXCEPTION 'topic_editorial_successor_required' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO prior FROM signal_topic_editorial_executions WHERE id=NEW.supersedes_execution_id;
  IF prior.id IS NULL OR ROW(prior.workspace_id,prior.numeric_run_id) IS DISTINCT FROM ROW(NEW.workspace_id,NEW.numeric_run_id)
   OR prior.id IS DISTINCT FROM (SELECT candidate.id FROM signal_topic_editorial_executions candidate
     WHERE candidate.workspace_id=NEW.workspace_id AND candidate.numeric_run_id=NEW.numeric_run_id
     ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1)
   OR NOT signal_topic_editorial_execution_replaceable_v1(prior.id) THEN
   RAISE EXCEPTION 'topic_editorial_successor_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_successor_guard BEFORE INSERT ON signal_topic_editorial_executions
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_successor_guard_v1();

CREATE OR REPLACE FUNCTION request_signal_topic_editorial_v1(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,request_key text,expected_quote text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 q jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;existing signal_topic_editorial_executions%ROWTYPE;
 hash text;e uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();b jsonb;result jsonb;day date;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v1\.[0-9]{10}\.[a-f0-9]{64}$',false) THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'numeric_run_id',target_run,
  'plan_digest',plan->>'plan_digest','quote_reference',expected_quote));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 SELECT * INTO existing FROM signal_topic_editorial_executions
  WHERE workspace_id=target_workspace AND numeric_run_id=target_run ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF existing.id IS NOT NULL AND NOT signal_topic_editorial_execution_replaceable_v1(existing.id) THEN
  RAISE EXCEPTION 'topic_editorial_existing_execution' USING ERRCODE='23514';END IF;
 q:=signal_topic_editorial_quote_v1(target_workspace,target_actor,target_run,plan,split_part(expected_quote,'.',2)::bigint);
 IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM expected_quote THEN
  RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=(q->>'policy_id')::uuid;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission,w.organization_id,w.id,w.brand_id,target_actor,p.id,a.action,e,request_key,hash,a.provider,a.model,a.configuration,a.configuration_digest,
  (q->>'hard_cap_micro_usd')::bigint,day,p.budget_timezone,least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)),false,'pending');
 INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,source_binding,source_digest,
  plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,supersedes_execution_id)
 VALUES(e,w.id,w.organization_id,target_actor,target_run,(q->'source_binding'->>'source_engine_execution_id')::uuid,q->'source_binding',
  signal_topic_editorial_digest_json_v1(q->'source_binding'),plan,plan->>'plan_digest',admission,(q->>'hard_cap_micro_usd')::bigint,request_key,hash,expected_quote,existing.id);
 FOR b IN SELECT value FROM jsonb_array_elements(plan->'batches') LOOP
  INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,configuration,receipts,reserved_micro_usd)
  VALUES(w.id,e,'screening',(b->>'batch_index')::integer,b->>'request_digest',b->>'request_body',b->'configuration',b->'group_receipts',
   octet_length(b->>'request_body')::bigint*3+(b->'configuration'->>'max_output_tokens')::bigint*15);
 END LOOP;
 INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id) VALUES(w.id,e,1,'topic-editorial-'||e::text||'-1');
 result:=jsonb_build_object('execution_id',e,'worker_job_id','topic-editorial-'||e::text||'-1','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result) VALUES(w.id,target_actor,request_key,e,hash,result);
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION retry_signal_topic_editorial_execution_v1(target_workspace uuid,target_actor uuid,target_execution uuid,request_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;prior signal_topic_editorial_request_keys%ROWTYPE;hash text;result jsonb;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('action','retry','workspace_id',target_workspace,'actor_user_id',target_actor,'execution_id',target_execution));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution AND workspace_id=target_workspace FOR UPDATE;
 IF e.id IS NULL OR e.actor_user_id<>target_actor OR e.status<>'failed' OR e.dispatch_generation>=20
  OR NOT signal_topic_editorial_plan_valid_v1(e.numeric_run_id,e.plan)
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status IN('in_flight','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_not_retryable' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_executions SET status='queued',error_code=NULL,dispatch_generation=dispatch_generation+1 WHERE id=e.id;
 INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
  VALUES(e.workspace_id,e.id,e.dispatch_generation+1,'topic-editorial-'||e.id::text||'-'||(e.dispatch_generation+1)::text);
 result:=jsonb_build_object('execution_id',e.id,'worker_job_id','topic-editorial-'||e.id::text||'-'||(e.dispatch_generation+1)::text,'replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
  VALUES(target_workspace,target_actor,request_key,e.id,hash,result);RETURN result;
END;$$;

REVOKE ALL ON FUNCTION signal_topic_editorial_configuration_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_execution_replaceable_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_successor_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION request_signal_topic_editorial_v1(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retry_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text) FROM PUBLIC;

DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_configuration_v1() FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_execution_replaceable_v1(uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_successor_guard_v1() FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION request_signal_topic_editorial_v1(uuid,uuid,uuid,jsonb,text,text) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION retry_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
