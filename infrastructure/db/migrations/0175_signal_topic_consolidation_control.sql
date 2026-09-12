-- Explicit consolidation authority and a provider-free numeric dispatcher.
-- No policies, admissions, jobs, reservations or calls are created by this migration.
-- The existing fit remains immutable history; this is a separate owner.
-- Brand creation currently provisions only Brand Context actions. Operators
-- must install an explicit new policy version containing numeric consolidation.
-- No existing active/draft/revoked policy is altered or expanded here.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings',
 'topic_fit','topic_interpretation','topic_fit_incremental','topic_interpretation_incremental','topic_consolidation','topic_consolidation_numeric'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric')
  AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
  action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation')
    AND provider='anthropic' AND model='claude-sonnet-4-6'
  OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large')));
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_consolidation_action CHECK(
 action<>'topic_consolidation' OR (automatic_allowed=false AND max_execution_micro_usd BETWEEN 1 AND 20000000));

CREATE TABLE signal_topic_consolidation_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 input_contract text NOT NULL DEFAULT 'workspace-topic-consolidation-v1' CHECK(input_contract='workspace-topic-consolidation-v1'),
 source_engine_execution_id uuid NOT NULL,
 source_binding jsonb NOT NULL CHECK(jsonb_typeof(source_binding)='object'),
 source_digest text NOT NULL CHECK(source_digest ~ '^sha256:[0-9a-f]{64}$'),
 numeric_configuration jsonb NOT NULL,
 numeric_configuration_digest text NOT NULL CHECK(numeric_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
 processing_admission_id uuid NOT NULL UNIQUE,
 hard_cap_micro_usd bigint NOT NULL CHECK(hard_cap_micro_usd=0),
 provider_execution_enabled boolean NOT NULL DEFAULT false CHECK(provider_execution_enabled=false),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 quote_reference text NOT NULL CHECK(quote_reference ~ '^v1\.[0-9]{10}\.[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','ready','failed')),
 dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation BETWEEN 1 AND 20),
 execution_token uuid,execution_expires_at timestamptz,heartbeat_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),
 consolidation_run_id uuid,
 census_digest text CHECK(census_digest ~ '^sha256:[0-9a-f]{64}$'),
 error_code text CHECK(error_code ~ '^(signal_)?topic_consolidation_[a-z_]{1,100}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,completed_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,source_engine_execution_id) REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,processing_admission_id) REFERENCES signal_processing_admissions(workspace_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(consolidation_run_id,workspace_id,source_engine_execution_id)
  REFERENCES signal_topic_consolidation_runs(id,workspace_id,source_engine_execution_id) ON DELETE RESTRICT,
 CHECK((status='running')=(execution_token IS NOT NULL AND execution_expires_at IS NOT NULL)),
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),
 CHECK((status='ready')=(consolidation_run_id IS NOT NULL AND census_digest IS NOT NULL AND completed_at IS NOT NULL)),
 CHECK((status='failed')=(error_code IS NOT NULL))
);
CREATE UNIQUE INDEX uq_topic_consolidation_live_source ON signal_topic_consolidation_executions(workspace_id,source_engine_execution_id);
CREATE TABLE signal_topic_consolidation_request_keys (
 workspace_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
 execution_id uuid NOT NULL,request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_consolidation_executions(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE signal_topic_consolidation_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,
 dispatch_generation integer NOT NULL CHECK(dispatch_generation BETWEEN 1 AND 20),
 worker_job_id text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','dispatching','dispatched','completed','failed')),
 lease_token uuid,lease_expires_at timestamptz,worker_id text,attempt_count integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(execution_id,dispatch_generation),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_consolidation_executions(workspace_id,id) ON DELETE RESTRICT,
 CHECK(worker_job_id='topic-consolidation-'||execution_id::text||'-'||dispatch_generation::text)
);
CREATE INDEX idx_topic_consolidation_dispatch ON signal_topic_consolidation_outbox(available_at,created_at)
 WHERE status IN('queued','dispatching');

CREATE FUNCTION signal_topic_consolidation_numeric_configuration_v1() RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT '{"contract_version":"signal-topic-consolidation-config-v1","dossier_version":"signal-topic-group-dossier-v1","representative_limit":10,"neighbor_limit":10,"community_algorithm":"centroid-knn-v1","neighbor_k":10,"min_similarity_ppm":720000,"assignment_policy":"partition-all-groups-v1"}'::jsonb
$$;

-- Reads sealed numerical history. No former paid grant or former actor is authority.
CREATE FUNCTION signal_topic_consolidation_source_binding_v1(target_source uuid) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('workspace_id',e.workspace_id,'source_execution_id',e.id,
  'source_checkpoint_digest',e.result_summary->'fit_checkpoint'->>'checkpoint_digest',
  'input_digest',e.input_digest,'input_revision',e.input_revision::text,
  'engine_configuration_digest',e.input_digest,
  'context_digest',e.input_snapshot->>'context_digest',
  'embedding_run_id',e.embedding_run_id,'embedding_config_digest',e.embedding_config_digest,
  'output_artifact_id',o.id,'output_artifact_sha256',o.content->>'sha256',
  'model_artifact_id',m.id,'model_artifact_sha256',m.content->>'sha256',
  'expected_group_count',(e.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::integer)
 FROM signal_topic_catalog_executions e
 JOIN signal_corpus_preparation_input_state s ON s.workspace_id=e.workspace_id AND s.input_revision=e.input_revision
 JOIN signal_workspace_embedding_runs b ON b.id=e.embedding_run_id AND b.workspace_id=e.workspace_id
  AND b.config_digest=e.embedding_config_digest AND b.status='completed'
 JOIN analysis_artifacts o ON o.workspace_id=e.workspace_id AND o.engine_execution_id=e.id
  AND o.id::text=e.result_summary->'fit_checkpoint'->>'output_artifact_id'
  AND o.artifact_type='engine_output' AND o.artifact_key='manifest.json'
 JOIN analysis_artifacts m ON m.workspace_id=e.workspace_id AND m.engine_execution_id=e.id
  AND m.id::text=e.result_summary->'fit_checkpoint'->>'model_artifact_id'
  AND m.artifact_type='engine_model' AND m.artifact_key='model-manifest.json'
 WHERE e.id=target_source AND e.input_contract='workspace-topic-engine-v1'
  AND (e.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::integer BETWEEN 1 AND 5000
  AND o.content->>'sha256' ~ '^sha256:[0-9a-f]{64}$' AND m.content->>'sha256' ~ '^sha256:[0-9a-f]{64}$'
  AND e.result_summary->'fit_checkpoint'->>'checkpoint_digest' ~ '^sha256:[0-9a-f]{64}$'
$$;

ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_consolidation_numeric_action CHECK(
 action<>'topic_consolidation_numeric' OR (kind='free' AND automatic_allowed=false AND max_execution_micro_usd=0
  AND configuration=signal_topic_consolidation_numeric_configuration_v1()));

-- A quote is deterministic for its explicit short deadline. It creates no rows.
CREATE FUNCTION signal_topic_consolidation_quote_v1(target_workspace uuid,target_actor uuid,target_source uuid,
 deadline_epoch bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 binding jsonb;expiry bigint;maximum bigint;exposure bigint;body jsonb;instant timestamptz:=clock_timestamp();
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN jsonb_build_object('status','access_required'); END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 binding:=signal_topic_consolidation_source_binding_v1(target_source);
 IF binding IS NULL OR binding->>'workspace_id' IS DISTINCT FROM target_workspace::text THEN
  RETURN jsonb_build_object('status',CASE WHEN target_source IS NULL THEN 'source_required' ELSE 'source_stale' END); END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RETURN jsonb_build_object('status','policy_required','binding',binding); END IF;
 IF instant<p.valid_from OR instant>=p.valid_until THEN RETURN jsonb_build_object('status','policy_expired','binding',binding); END IF;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation_numeric';
 IF a.action IS NULL OR a.kind IS DISTINCT FROM 'free' OR a.provider IS NOT NULL OR a.model IS NOT NULL OR a.max_execution_micro_usd<>0
  OR a.automatic_allowed IS DISTINCT FROM false THEN RETURN jsonb_build_object('status','policy_action_required','binding',binding); END IF;
 maximum:=0;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(w.organization_id,
  (instant AT TIME ZONE p.budget_timezone)::date,p.budget_timezone);
 IF maximum>0 AND exposure+maximum>p.daily_cap_micro_usd THEN RETURN jsonb_build_object('status','budget_unavailable','binding',binding); END IF;
 expiry:=COALESCE(deadline_epoch,floor(extract(epoch FROM least(instant+interval '5 minutes',p.valid_until,
  (((instant AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone))))::bigint);
 IF expiry<=extract(epoch FROM instant) OR expiry>extract(epoch FROM instant+interval '5 minutes')
  OR to_timestamp(expiry)>least(p.valid_until,(((instant AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone)) THEN
  RETURN jsonb_build_object('status','policy_expired','binding',binding); END IF;
 body:=jsonb_build_object('contract_version','topic-consolidation-quote-v1','workspace_id',target_workspace,'actor_user_id',target_actor,
  'source_binding',binding,'policy_version_id',p.id,'policy_digest',p.policy_digest,'configuration_digest',a.configuration_digest,
  'numeric_configuration_digest',signal_semantic_context_digest_json_v2(signal_topic_consolidation_numeric_configuration_v1()),
  'maximum_micro_usd',maximum::text,'deadline_epoch',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_prepare','quote_reference','v1.'||expiry::text||'.'||
  substr(signal_semantic_context_digest_json_v2(body),8),'quote_expires_at',to_timestamp(expiry),
  'binding',binding,'policy_version_id',p.id,'maximum_micro_usd',maximum::text);
END; $$;

CREATE FUNCTION signal_topic_consolidation_control_history_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='signal_topic_consolidation_request_keys' AND TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'topic_consolidation_history_retained' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='signal_topic_consolidation_outbox' AND TG_OP='UPDATE' AND
  ROW(NEW.id,NEW.workspace_id,NEW.execution_id,NEW.dispatch_generation,NEW.worker_job_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.execution_id,OLD.dispatch_generation,OLD.worker_job_id,OLD.created_at) THEN
  RAISE EXCEPTION 'topic_consolidation_dispatch_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER topic_consolidation_keys_retained BEFORE UPDATE OR DELETE ON signal_topic_consolidation_request_keys
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_control_history_v1();
CREATE TRIGGER topic_consolidation_outbox_retained BEFORE UPDATE OR DELETE ON signal_topic_consolidation_outbox
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_control_history_v1();

CREATE FUNCTION signal_topic_consolidation_status_v1(target_workspace uuid,target_actor uuid,target_source uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source_id uuid:=target_source;quote jsonb;e signal_topic_consolidation_executions%ROWTYPE;
 group_count integer:=0;expected integer;state text;can_request boolean;retryable boolean:=false;binding jsonb;
BEGIN
 can_request:=signal_brand_context_processing_actor_v1(target_workspace,target_actor);
 IF source_id IS NULL THEN
  SELECT run.id INTO source_id FROM signal_topic_catalog_executions run WHERE run.workspace_id=target_workspace
   AND run.input_contract='workspace-topic-engine-v1' AND run.result_summary ? 'fit_checkpoint'
   ORDER BY run.created_at DESC,run.id DESC LIMIT 1;
 END IF;
 quote:=signal_topic_consolidation_quote_v1(target_workspace,target_actor,source_id);
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE workspace_id=target_workspace AND source_engine_execution_id=source_id;
 binding:=COALESCE(quote->'binding',e.source_binding);
 expected:=(binding->>'expected_group_count')::integer;
 state:=COALESCE(quote->>'status','source_required');
 IF e.id IS NOT NULL THEN
  state:=e.status;
  IF e.status='ready' THEN SELECT count(*)::integer INTO group_count FROM signal_topic_atomic_groups WHERE consolidation_run_id=e.consolidation_run_id; END IF;
  retryable:=e.status='failed' AND can_request AND e.actor_user_id=target_actor AND e.dispatch_generation<20
    AND signal_topic_consolidation_source_binding_v1(e.source_engine_execution_id)=e.source_binding;
 END IF;
 RETURN jsonb_build_object('contract_version','signal-topic-consolidation-status-v1','workspace_id',target_workspace,
  'status',state,'can_request',can_request AND (e.id IS NULL AND state='ready_to_prepare' OR COALESCE(retryable,false)),
  'provider_execution_enabled',false,'maximum_micro_usd','0','confirmed_micro_usd','0','reserved_micro_usd','0',
  'expected_group_count',expected,'group_count',group_count,'source_execution_id',source_id,
  'quote_reference',CASE WHEN e.id IS NULL THEN quote->>'quote_reference' END,
  'quote_expires_at',CASE WHEN e.id IS NULL THEN quote->>'quote_expires_at' END,
  'execution',CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('execution_id',e.id,'status',e.status,
    'retry_available',COALESCE(retryable,false),'error_code',e.error_code) END);
END; $$;

CREATE FUNCTION claim_signal_topic_consolidation_dispatch_v1(target_worker text,batch_limit integer DEFAULT 10,lease_seconds integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF batch_limit NOT BETWEEN 1 AND 100 OR lease_seconds NOT BETWEEN 10 AND 300
  OR NOT COALESCE(target_worker ~ '^[A-Za-z0-9._:-]{8,200}$',false) THEN
  RAISE EXCEPTION 'topic_consolidation_dispatch_invalid' USING ERRCODE='22023'; END IF;
 WITH candidates AS (
  SELECT o.id FROM signal_topic_consolidation_outbox o JOIN signal_topic_consolidation_executions e ON e.id=o.execution_id
  WHERE e.status='queued' AND e.dispatch_generation=o.dispatch_generation AND o.available_at<=clock_timestamp()
   AND (o.status='queued' OR o.status='dispatching' AND o.lease_expires_at<=clock_timestamp())
  ORDER BY o.available_at,o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT batch_limit
 ), claimed AS (
  UPDATE signal_topic_consolidation_outbox o SET status='dispatching',lease_token=gen_random_uuid(),
   lease_expires_at=clock_timestamp()+make_interval(secs=>lease_seconds),worker_id=target_worker,attempt_count=o.attempt_count+1
  FROM candidates c WHERE o.id=c.id RETURNING o.*
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('dispatch_id',id,'execution_id',execution_id,'workspace_id',workspace_id,
  'worker_job_id',worker_job_id,'lease_token',lease_token,'attempt',attempt_count)),'[]'::jsonb) INTO result FROM claimed;
 RETURN result;
END; $$;
CREATE FUNCTION acknowledge_signal_topic_consolidation_dispatch_v1(target_dispatch uuid,target_token uuid)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_consolidation_outbox SET status='dispatched',lease_expires_at=NULL
  WHERE id=target_dispatch AND lease_token=target_token AND status='dispatching';
 IF FOUND THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM signal_topic_consolidation_outbox WHERE id=target_dispatch AND lease_token=target_token AND status IN('dispatched','completed'));
END; $$;
CREATE FUNCTION fail_signal_topic_consolidation_dispatch_v1(target_dispatch uuid,target_token uuid,code text)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_consolidation_outbox SET status='queued',lease_token=NULL,lease_expires_at=NULL,
  available_at=clock_timestamp()+make_interval(secs=>least(300,5*greatest(1,attempt_count))),
  error_code=CASE WHEN code ~ '^(signal_)?topic_consolidation_[a-z_]{1,100}$' THEN code ELSE 'topic_consolidation_dispatch_failed' END
 WHERE id=target_dispatch AND lease_token=target_token AND status='dispatching';RETURN FOUND;
END; $$;

CREATE FUNCTION claim_signal_topic_consolidation_execution_v1(target_execution uuid,expected_job text,lease_seconds integer DEFAULT 180)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;token uuid:=gen_random_uuid();
BEGIN
 IF lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'topic_consolidation_lease_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution FOR UPDATE;
 IF e.id IS NULL OR expected_job IS DISTINCT FROM 'topic-consolidation-'||e.id::text||'-'||e.dispatch_generation::text THEN RETURN NULL; END IF;
 IF e.status='ready' THEN RETURN jsonb_build_object('completed',true,'execution_id',e.id); END IF;
 IF e.status<>'queued' OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_outbox WHERE execution_id=e.id
  AND dispatch_generation=e.dispatch_generation AND worker_job_id=expected_job AND status IN('dispatching','dispatched')) THEN RETURN NULL; END IF;
 BEGIN
  PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
  IF signal_topic_consolidation_source_binding_v1(e.source_engine_execution_id) IS DISTINCT FROM e.source_binding THEN
   RAISE EXCEPTION 'topic_consolidation_source_stale' USING ERRCODE='23514'; END IF;
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23514' THEN
  UPDATE signal_topic_consolidation_executions SET status='failed',error_code='topic_consolidation_authority_unavailable' WHERE id=e.id;
  UPDATE signal_topic_consolidation_outbox SET status='failed',lease_expires_at=NULL WHERE execution_id=e.id AND dispatch_generation=e.dispatch_generation;
  RETURN NULL;
 END;
 IF e.attempt_count>=20 THEN
  UPDATE signal_topic_consolidation_executions SET status='failed',error_code='topic_consolidation_attempts_exhausted' WHERE id=e.id;RETURN NULL;
 END IF;
 UPDATE signal_topic_consolidation_executions SET status='running',execution_token=token,
  execution_expires_at=clock_timestamp()+make_interval(secs=>lease_seconds),heartbeat_at=clock_timestamp(),
  started_at=COALESCE(started_at,clock_timestamp()),attempt_count=attempt_count+1,error_code=NULL WHERE id=e.id;
 RETURN jsonb_build_object('execution_id',e.id,'workspace_id',e.workspace_id,'actor_user_id',e.actor_user_id,
  'source_execution_id',e.source_engine_execution_id,'execution_token',token,'worker_job_id',expected_job);
END; $$;
CREATE FUNCTION heartbeat_signal_topic_consolidation_execution_v1(target_execution uuid,target_token uuid)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_consolidation_executions SET heartbeat_at=clock_timestamp(),execution_expires_at=clock_timestamp()+interval '180 seconds'
  WHERE id=target_execution AND status='running' AND execution_token=target_token AND execution_expires_at>clock_timestamp();RETURN FOUND;
END; $$;
CREATE FUNCTION complete_signal_topic_consolidation_execution_v1(target_execution uuid,target_token uuid,target_census uuid)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;run signal_topic_consolidation_runs%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution FOR UPDATE;
 IF e.status='ready' THEN RETURN e.consolidation_run_id=target_census; END IF;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token OR e.execution_expires_at<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=target_census AND workspace_id=e.workspace_id
  AND source_engine_execution_id=e.source_engine_execution_id;
 IF run.id IS NULL THEN RAISE EXCEPTION 'topic_consolidation_result_invalid' USING ERRCODE='23514'; END IF;
 UPDATE signal_topic_consolidation_executions SET status='ready',execution_token=NULL,execution_expires_at=NULL,
  consolidation_run_id=run.id,census_digest=run.census_digest,completed_at=clock_timestamp() WHERE id=e.id;
 UPDATE signal_topic_consolidation_outbox SET status='completed',completed_at=clock_timestamp(),lease_expires_at=NULL
  WHERE execution_id=e.id AND dispatch_generation=e.dispatch_generation;RETURN true;
END; $$;
CREATE FUNCTION fail_signal_topic_consolidation_execution_v1(target_execution uuid,target_token uuid,code text)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution FOR UPDATE;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token THEN RETURN false; END IF;
 UPDATE signal_topic_consolidation_executions SET status='failed',execution_token=NULL,execution_expires_at=NULL,
  error_code=CASE WHEN code ~ '^(signal_)?topic_consolidation_[a-z_]{1,100}$' THEN code ELSE 'topic_consolidation_worker_failed' END WHERE id=e.id;
 UPDATE signal_topic_consolidation_outbox SET status='failed',lease_expires_at=NULL WHERE execution_id=e.id AND dispatch_generation=e.dispatch_generation;
 RETURN true;
END; $$;

CREATE FUNCTION retry_signal_topic_consolidation_v1(target_workspace uuid,target_actor uuid,target_execution uuid,request_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;prior signal_topic_consolidation_request_keys%ROWTYPE;request_hash text;result jsonb;
BEGIN
 IF NOT COALESCE(request_key ~ '^[A-Za-z0-9._:-]{8,200}$',false) THEN RAISE EXCEPTION 'topic_consolidation_request_invalid' USING ERRCODE='22023'; END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-consolidation-request:'||target_workspace::text,0));
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('action','retry_topic_consolidation_numeric',
  'workspace_id',target_workspace,'actor_user_id',target_actor,'execution_id',target_execution));
 SELECT * INTO prior FROM signal_topic_consolidation_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution AND workspace_id=target_workspace AND actor_user_id=target_actor FOR UPDATE;
 IF e.id IS NULL OR e.status<>'failed' OR e.dispatch_generation>=20 OR e.attempt_count>=20
  OR signal_topic_consolidation_source_binding_v1(e.source_engine_execution_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_consolidation_retry_unavailable' USING ERRCODE='23514'; END IF;
 UPDATE signal_topic_consolidation_executions SET status='queued',error_code=NULL,dispatch_generation=dispatch_generation+1 WHERE id=e.id RETURNING * INTO e;
 INSERT INTO signal_topic_consolidation_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
 VALUES(e.workspace_id,e.id,e.dispatch_generation,'topic-consolidation-'||e.id::text||'-'||e.dispatch_generation::text);
 result:=jsonb_build_object('execution_id',e.id,'worker_job_id','topic-consolidation-'||e.id::text||'-'||e.dispatch_generation::text,'replayed',false);
 INSERT INTO signal_topic_consolidation_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
 VALUES(target_workspace,target_actor,request_key,e.id,request_hash,result);RETURN result;
END; $$;
CREATE FUNCTION recover_signal_topic_consolidation_executions_v1(batch_limit integer DEFAULT 20)
 RETURNS integer LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;recovered integer:=0;
BEGIN
 IF batch_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'topic_consolidation_recovery_invalid' USING ERRCODE='22023'; END IF;
 FOR e IN SELECT * FROM signal_topic_consolidation_executions WHERE status='running' AND execution_expires_at<=clock_timestamp()
  ORDER BY execution_expires_at,id FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
  UPDATE signal_topic_consolidation_outbox SET status='completed',completed_at=clock_timestamp(),lease_expires_at=NULL
   WHERE execution_id=e.id AND dispatch_generation=e.dispatch_generation;
  IF e.dispatch_generation>=20 OR e.attempt_count>=20 THEN
   UPDATE signal_topic_consolidation_executions SET status='failed',error_code='topic_consolidation_attempts_exhausted',
    execution_token=NULL,execution_expires_at=NULL WHERE id=e.id;
  ELSE
   -- Mechanical requeue never depends on an actor that may have been revoked.
   -- A subsequent claim revalidates authority under row locks before doing work.
   UPDATE signal_topic_consolidation_executions SET status='queued',dispatch_generation=dispatch_generation+1,
    execution_token=NULL,execution_expires_at=NULL WHERE id=e.id;
   INSERT INTO signal_topic_consolidation_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
   VALUES(e.workspace_id,e.id,e.dispatch_generation+1,'topic-consolidation-'||e.id::text||'-'||(e.dispatch_generation+1)::text);
  END IF;
  recovered:=recovered+1;
 END LOOP;RETURN recovered;
END; $$;

CREATE FUNCTION assert_signal_topic_consolidation_worker_scope_v1(target_execution uuid,target_token uuid,
 target_workspace uuid,target_actor uuid,target_source uuid DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution FOR SHARE;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token OR e.execution_expires_at<=clock_timestamp()
  OR e.workspace_id IS DISTINCT FROM target_workspace OR e.actor_user_id IS DISTINCT FROM target_actor
  OR target_source IS NOT NULL AND e.source_engine_execution_id IS DISTINCT FROM target_source
  OR signal_topic_consolidation_source_binding_v1(e.source_engine_execution_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_consolidation_lease_conflict' USING ERRCODE='23514'; END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
END; $$;
CREATE FUNCTION signal_topic_consolidation_worker_actor_v1(target_execution uuid,target_token uuid,target_source uuid)
 RETURNS uuid LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution;
 PERFORM assert_signal_topic_consolidation_worker_scope_v1(target_execution,target_token,e.workspace_id,e.actor_user_id,target_source);
 RETURN e.actor_user_id;
END; $$;

CREATE FUNCTION signal_topic_consolidation_owner_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE admission signal_processing_admissions%ROWTYPE;binding jsonb;numeric_run signal_topic_consolidation_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_consolidation_history_retained' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
  binding:=signal_topic_consolidation_source_binding_v1(NEW.source_engine_execution_id);
  IF admission.id IS NULL OR ROW(admission.workspace_id,admission.organization_id,admission.actor_user_id,admission.target_id,
    admission.action,admission.execution_cap_micro_usd,admission.idempotency_key,admission.request_digest,admission.automatic)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,NEW.id,'topic_consolidation_numeric'::text,
    NEW.hard_cap_micro_usd,NEW.idempotency_key,NEW.request_digest,false)
   OR binding IS NULL OR NEW.source_binding IS DISTINCT FROM binding
   OR NEW.source_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(binding)
   OR NEW.numeric_configuration IS DISTINCT FROM signal_topic_consolidation_numeric_configuration_v1()
   OR NEW.numeric_configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(NEW.numeric_configuration)
   OR NEW.status<>'queued' OR NEW.dispatch_generation<>1 OR NEW.attempt_count<>0 THEN
   RAISE EXCEPTION 'topic_consolidation_owner_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','heartbeat_at','attempt_count',
    'consolidation_run_id','census_digest','error_code','started_at','completed_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','heartbeat_at','attempt_count',
    'consolidation_run_id','census_digest','error_code','started_at','completed_at']) OR OLD.status='ready' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'topic_consolidation_owner_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='queued' AND NEW.status IN('running','failed')
    OR OLD.status='running' AND NEW.status IN('queued','ready','failed') OR OLD.status='failed' AND NEW.status='queued') THEN
   RAISE EXCEPTION 'topic_consolidation_transition_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='running' AND (TG_OP='INSERT' OR OLD.status<>'running' OR NEW.execution_token IS DISTINCT FROM OLD.execution_token
   OR NEW.execution_expires_at IS DISTINCT FROM OLD.execution_expires_at) THEN
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  IF signal_topic_consolidation_source_binding_v1(NEW.source_engine_execution_id) IS DISTINCT FROM NEW.source_binding THEN
   RAISE EXCEPTION 'topic_consolidation_source_stale' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' THEN
  SELECT * INTO numeric_run FROM signal_topic_consolidation_runs WHERE id=NEW.consolidation_run_id;
  IF numeric_run.id IS NULL OR ROW(numeric_run.workspace_id,numeric_run.source_engine_execution_id,numeric_run.source_checkpoint_digest,
    numeric_run.configuration_digest,numeric_run.census_digest) IS DISTINCT FROM ROW(NEW.workspace_id,NEW.source_engine_execution_id,
    NEW.source_binding->>'source_checkpoint_digest',NEW.numeric_configuration_digest,NEW.census_digest)
   OR numeric_run.status NOT IN('ready_for_review','reviewing','validated','superseded')
   OR numeric_run.community_plan_digest IS NULL THEN RAISE EXCEPTION 'topic_consolidation_result_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER topic_consolidation_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_executions
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_owner_guard_v1();

CREATE FUNCTION signal_topic_consolidation_admission_complete_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.action='topic_consolidation_numeric' AND NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_executions e
  JOIN signal_topic_consolidation_outbox o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id AND o.dispatch_generation=1
  JOIN signal_topic_consolidation_request_keys k ON k.execution_id=e.id AND k.workspace_id=e.workspace_id
    AND k.actor_user_id=NEW.actor_user_id AND k.idempotency_key=NEW.idempotency_key
  WHERE e.id=NEW.target_id AND e.processing_admission_id=NEW.id AND e.workspace_id=NEW.workspace_id
    AND e.actor_user_id=NEW.actor_user_id AND e.request_digest=NEW.request_digest) THEN
  RAISE EXCEPTION 'topic_consolidation_admission_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER topic_consolidation_admission_complete AFTER INSERT ON signal_processing_admissions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_admission_complete_v1();

CREATE FUNCTION request_signal_topic_consolidation_v1(target_workspace uuid,target_actor uuid,target_source uuid,
 request_key text,expected_quote text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 quote jsonb;binding jsonb;prior signal_topic_consolidation_request_keys%ROWTYPE;request_hash text;
 execution_id uuid:=gen_random_uuid();admission_id uuid:=gen_random_uuid();result jsonb;day date;
BEGIN
 IF NOT COALESCE(request_key ~ '^[A-Za-z0-9._:-]{8,200}$' AND expected_quote ~ '^v1\.[0-9]{10}\.[0-9a-f]{64}$',false) THEN
  RAISE EXCEPTION 'topic_consolidation_request_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-consolidation-request:'||target_workspace::text,0));
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('action','topic_consolidation_numeric',
  'workspace_id',target_workspace,'actor_user_id',target_actor,'source_execution_id',target_source,'quote_reference',expected_quote));
 SELECT * INTO prior FROM signal_topic_consolidation_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 quote:=signal_topic_consolidation_quote_v1(target_workspace,target_actor,target_source,split_part(expected_quote,'.',2)::bigint);
 IF quote->>'status' IS DISTINCT FROM 'ready_to_prepare' THEN
  RAISE EXCEPTION 'topic_consolidation_preflight_blocked' USING ERRCODE='23514'; END IF;
 IF quote->>'quote_reference' IS DISTINCT FROM expected_quote THEN RAISE EXCEPTION 'topic_consolidation_quote_stale' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM signal_topic_consolidation_executions WHERE workspace_id=target_workspace AND source_engine_execution_id=target_source) THEN RAISE EXCEPTION 'topic_consolidation_existing_execution' USING ERRCODE='23514'; END IF;
 binding:=quote->'binding';SELECT * INTO p FROM signal_processing_policy_versions WHERE id=(quote->>'policy_version_id')::uuid;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;PERFORM signal_processing_lock_v1(w.organization_id,day);
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation_numeric';
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,
  budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission_id,w.organization_id,w.id,w.brand_id,target_actor,p.id,a.action,execution_id,request_key,request_hash,
  a.provider,a.model,a.configuration,a.configuration_digest,(quote->>'maximum_micro_usd')::bigint,day,p.budget_timezone,
  least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)),false,'pending');
 INSERT INTO signal_topic_consolidation_executions(id,workspace_id,organization_id,actor_user_id,source_engine_execution_id,
  source_binding,source_digest,numeric_configuration,numeric_configuration_digest,processing_admission_id,hard_cap_micro_usd,
  idempotency_key,request_digest,quote_reference)
 VALUES(execution_id,w.id,w.organization_id,target_actor,target_source,binding,signal_semantic_context_digest_json_v2(binding),
  signal_topic_consolidation_numeric_configuration_v1(),signal_semantic_context_digest_json_v2(signal_topic_consolidation_numeric_configuration_v1()),
  admission_id,(quote->>'maximum_micro_usd')::bigint,request_key,request_hash,expected_quote);
 INSERT INTO signal_topic_consolidation_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
 VALUES(w.id,execution_id,1,'topic-consolidation-'||execution_id::text||'-1');
 result:=jsonb_build_object('execution_id',execution_id,'worker_job_id','topic-consolidation-'||execution_id::text||'-1','replayed',false);
 INSERT INTO signal_topic_consolidation_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
 VALUES(w.id,target_actor,request_key,execution_id,request_hash,result);
 RETURN result;
END; $$;

-- Preserve every effective0157 admission branch; add only the new numeric action.
CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation' THEN RAISE EXCEPTION 'topic_consolidation_provider_disabled' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation_numeric' AND (NEW.execution_cap_micro_usd<>0 OR NEW.automatic OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL) THEN
  RAISE EXCEPTION 'topic_consolidation_numeric_admission_invalid' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 IF NEW.action='topic_prototype_embeddings' THEN
  SELECT * INTO child FROM signal_brand_context_prototype_receipts WHERE id=NEW.brand_context_prototype_receipt_id;
  IF child.id IS NULL OR ROW(child.parent_receipt_id,child.admission_id,child.run_id,child.workspace_id,child.organization_id,
    child.brand_id,child.actor_user_id,child.policy_version_id,child.idempotency_key,child.request_digest,child.execution_cap_micro_usd,
    child.budget_date,child.budget_timezone,child.admission_not_after)
   IS DISTINCT FROM ROW(NEW.brand_context_processing_receipt_id,NEW.id,NEW.target_id,NEW.workspace_id,NEW.organization_id,
    NEW.brand_id,NEW.actor_user_id,NEW.policy_version_id,NEW.idempotency_key,NEW.request_digest,NEW.execution_cap_micro_usd,
    NEW.budget_date,NEW.budget_timezone,NEW.admission_not_after) THEN
   RAISE EXCEPTION 'brand_context_prototype_receipt_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 ELSE
  IF NEW.brand_context_prototype_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_receipt_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.action='brand_context_proposal' THEN
   IF NEW.brand_context_processing_receipt_id IS NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_required' USING ERRCODE='23514'; END IF;
   PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  ELSE
   IF NEW.brand_context_processing_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_invalid' USING ERRCODE='23514'; END IF;
   IF NEW.action='topic_consolidation_numeric' THEN
    PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   ELSE
    PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   END IF;
  END IF;
 END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action=NEW.action;
 IF w.organization_id<>NEW.organization_id OR w.brand_id<>NEW.brand_id OR p.organization_id<>NEW.organization_id
  OR p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR a.action IS NULL OR NEW.provider IS DISTINCT FROM a.provider OR NEW.model IS DISTINCT FROM a.model
  OR NEW.configuration IS DISTINCT FROM a.configuration OR NEW.configuration_digest IS DISTINCT FROM a.configuration_digest
  OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd OR NEW.automatic AND NOT a.automatic_allowed
  OR NEW.budget_timezone<>p.budget_timezone OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after>least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone))
  OR NEW.admission_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(p.organization_id,NEW.budget_date,p.budget_timezone);
 IF NEW.execution_cap_micro_usd>0 AND exposure+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;

-- Private control plane. No client can insert a grant or dispatch directly.
ALTER TABLE signal_topic_consolidation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_consolidation_request_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_consolidation_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_topic_consolidation_executions,signal_topic_consolidation_request_keys,signal_topic_consolidation_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_consolidation_numeric_configuration_v1(),signal_topic_consolidation_source_binding_v1(uuid),signal_topic_consolidation_quote_v1(uuid,uuid,uuid,bigint),signal_topic_consolidation_control_history_v1(),signal_topic_consolidation_status_v1(uuid,uuid,uuid),claim_signal_topic_consolidation_dispatch_v1(text,integer,integer),acknowledge_signal_topic_consolidation_dispatch_v1(uuid,uuid),fail_signal_topic_consolidation_dispatch_v1(uuid,uuid,text),claim_signal_topic_consolidation_execution_v1(uuid,text,integer),heartbeat_signal_topic_consolidation_execution_v1(uuid,uuid),complete_signal_topic_consolidation_execution_v1(uuid,uuid,uuid),fail_signal_topic_consolidation_execution_v1(uuid,uuid,text),retry_signal_topic_consolidation_v1(uuid,uuid,uuid,text),recover_signal_topic_consolidation_executions_v1(integer),assert_signal_topic_consolidation_worker_scope_v1(uuid,uuid,uuid,uuid,uuid),signal_topic_consolidation_worker_actor_v1(uuid,uuid,uuid),signal_topic_consolidation_owner_guard_v1(),signal_topic_consolidation_admission_complete_v1(),request_signal_topic_consolidation_v1(uuid,uuid,uuid,text,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON signal_topic_consolidation_executions,signal_topic_consolidation_request_keys,signal_topic_consolidation_outbox FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_consolidation_numeric_configuration_v1(),signal_topic_consolidation_source_binding_v1(uuid),signal_topic_consolidation_quote_v1(uuid,uuid,uuid,bigint),signal_topic_consolidation_control_history_v1(),signal_topic_consolidation_status_v1(uuid,uuid,uuid),claim_signal_topic_consolidation_dispatch_v1(text,integer,integer),acknowledge_signal_topic_consolidation_dispatch_v1(uuid,uuid),fail_signal_topic_consolidation_dispatch_v1(uuid,uuid,text),claim_signal_topic_consolidation_execution_v1(uuid,text,integer),heartbeat_signal_topic_consolidation_execution_v1(uuid,uuid),complete_signal_topic_consolidation_execution_v1(uuid,uuid,uuid),fail_signal_topic_consolidation_execution_v1(uuid,uuid,text),retry_signal_topic_consolidation_v1(uuid,uuid,uuid,text),recover_signal_topic_consolidation_executions_v1(integer),assert_signal_topic_consolidation_worker_scope_v1(uuid,uuid,uuid,uuid,uuid),signal_topic_consolidation_worker_actor_v1(uuid,uuid,uuid),signal_topic_consolidation_owner_guard_v1(),signal_topic_consolidation_admission_complete_v1(),request_signal_topic_consolidation_v1(uuid,uuid,uuid,text,text) FROM %I',role_name);
 END LOOP;
END $$;
