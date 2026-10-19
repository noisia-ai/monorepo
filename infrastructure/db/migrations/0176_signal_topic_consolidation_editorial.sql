-- Paid editorial consolidation is a new owner and ledger. No policy, admission,
-- dispatch or provider call is created by installing this migration.
CREATE FUNCTION signal_topic_editorial_configuration_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT '{"contract_version":"signal-topic-editorial-execution-config-v1","screening":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"screening","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:c532831e7a01703aa88f1f4b53977a347756916505f8ef45a8eabe838fef3534","schema_digest":"sha256:e364fb061253c5f210b27deede7964ac36de014b8279d5d8b2de26f54828eee5","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":16384},"global":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"global","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:6be2bf3ba2fd08195f49faea1cf8a2900ea482a35e965144fd3e93730f46ec78","schema_digest":"sha256:bacd94f93bed7975bb581c078a4f232bcdafa8a124529c5972109bf4a3c00b8c","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":65536},"screening_batch_size":40,"max_call_attempts":3}'::jsonb $$;

CREATE TABLE signal_topic_editorial_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),actor_user_id uuid NOT NULL REFERENCES users(id),
 numeric_run_id uuid NOT NULL UNIQUE,source_engine_execution_id uuid NOT NULL,
 source_binding jsonb NOT NULL,source_digest text NOT NULL CHECK(source_digest~'^sha256:[a-f0-9]{64}$'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object' AND octet_length(plan::text)<=67108864),
 plan_digest text NOT NULL CHECK(plan_digest~'^sha256:[a-f0-9]{64}$'),
 processing_admission_id uuid NOT NULL UNIQUE,hard_cap_micro_usd bigint NOT NULL CHECK(hard_cap_micro_usd BETWEEN 1 AND 20000000),
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),request_digest text NOT NULL,
 quote_reference text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','failed','review_ready','completed')),
 dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation BETWEEN 1 AND 20),
 execution_token uuid,execution_expires_at timestamptz,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),
 state_body text,state_digest text CHECK(state_digest~'^sha256:[a-f0-9]{64}$'),
 result_revision_id uuid REFERENCES signal_topic_consolidation_revisions(id),error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(numeric_run_id,workspace_id,source_engine_execution_id) REFERENCES signal_topic_consolidation_runs(id,workspace_id,source_engine_execution_id),
 FOREIGN KEY(workspace_id,processing_admission_id) REFERENCES signal_processing_admissions(workspace_id,id),
 CHECK((status='running')=(execution_token IS NOT NULL AND execution_expires_at IS NOT NULL)),
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),CHECK((state_body IS NULL)=(state_digest IS NULL)),
 CHECK(state_body IS NULL OR octet_length(state_body)<=16777216),
 CHECK((status='completed')=(result_revision_id IS NOT NULL AND completed_at IS NOT NULL)),
 CHECK((status='failed')=(error_code IS NOT NULL))
);
CREATE TABLE signal_topic_editorial_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN('screening','global')),batch_index integer NOT NULL CHECK(batch_index BETWEEN 0 AND 124),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),request_body text NOT NULL,
 configuration jsonb NOT NULL,receipts jsonb NOT NULL,
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(execution_id,phase,batch_index),UNIQUE(execution_id,request_digest),UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id),
 CHECK(phase<>'global' OR batch_index=0),CHECK(octet_length(request_body) BETWEEN 1 AND 4000000)
);
CREATE TABLE signal_topic_editorial_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,organization_id uuid NOT NULL REFERENCES organizations(id),
 execution_id uuid NOT NULL,request_id uuid NOT NULL,attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
 retry_of_call_id uuid UNIQUE REFERENCES signal_topic_editorial_calls(id),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','in_flight','response_persisted','settled','definitely_not_sent','outcome_unknown')),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),settled_micro_usd bigint CHECK(settled_micro_usd>=0),
 observed_micro_usd bigint CHECK(observed_micro_usd>=0),budget_date date NOT NULL,budget_timezone text NOT NULL,
 response_body_private text,response_sha256 text,response_storage_key text,response_output jsonb,
 error_code text,reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,response_at timestamptz,settled_at timestamptz,
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES signal_topic_editorial_requests(workspace_id,id),
 CHECK((status='settled')=(settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL)),
 CHECK((response_body_private IS NULL)=(response_sha256 IS NULL)),CHECK((response_body_private IS NULL)=(response_storage_key IS NULL)),
 CHECK(response_body_private IS NULL OR octet_length(response_body_private)<=8388608),
 CHECK(status NOT IN('response_persisted','settled') OR response_body_private IS NOT NULL)
);
CREATE UNIQUE INDEX uq_topic_editorial_live_call ON signal_topic_editorial_calls(request_id) WHERE status<>'definitely_not_sent';
CREATE INDEX idx_topic_editorial_exposure ON signal_topic_editorial_calls(organization_id,budget_date) WHERE status<>'definitely_not_sent';
CREATE TABLE signal_topic_editorial_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,dispatch_generation integer NOT NULL,
 worker_job_id text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','dispatching','dispatched','completed','failed')),
 lease_token uuid,lease_expires_at timestamptz,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempt_count integer NOT NULL DEFAULT 0,
 UNIQUE(execution_id,dispatch_generation),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id),
 CHECK(worker_job_id='topic-editorial-'||execution_id::text||'-'||dispatch_generation::text)
);
CREATE TABLE signal_topic_editorial_request_keys (
 workspace_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,
 execution_id uuid NOT NULL,request_digest text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,actor_user_id,idempotency_key),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id)
);

-- The old three ledgers retain their exact accounting, including reconciled
-- terminal calls and semantic renewals. A new call is counted exactly once.
ALTER FUNCTION signal_processing_org_exposure_v1(uuid,date,text,text,uuid) RENAME TO signal_processing_org_exposure_pre0176_v1;
CREATE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0176_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 new AS(SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE status='settled'),0)::bigint confirmed,
 COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status NOT IN('settled','outcome_unknown')),0)::bigint reserved,
 COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status='outcome_unknown'),0)::bigint ambiguous
 FROM signal_topic_editorial_calls WHERE organization_id=target_org AND budget_date=target_day AND status<>'definitely_not_sent'
 AND NOT COALESCE(excluded_ledger='topic_editorial' AND id=excluded_id,false))
 SELECT old.confirmed_micro_usd+new.confirmed,old.reserved_micro_usd+new.reserved,old.ambiguous_micro_usd+new.ambiguous,
 old.total_micro_usd+new.confirmed+new.reserved+new.ambiguous FROM old,new $$;

CREATE FUNCTION signal_topic_editorial_source_v1(target_run uuid) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('numeric_run_id',r.id,'workspace_id',r.workspace_id,'source_engine_execution_id',r.source_engine_execution_id,
  'census_digest',r.census_digest,'configuration_digest',r.configuration_digest,'community_plan_digest',r.community_plan_digest,
  'source_checkpoint_digest',r.source_checkpoint_digest,'context_digest',r.context_digest,'expected_group_count',r.expected_group_count,
  'centroid_artifact_id',r.centroid_artifact_id,'centroid_artifact_sha256',r.centroid_artifact_sha256,
  'numeric_source_binding',c.source_binding,'semantic_generation_id',g.id,'semantic_pack_digest',g.pack_digest)
 FROM signal_topic_consolidation_runs r JOIN signal_topic_consolidation_executions c ON c.consolidation_run_id=r.id
  AND c.workspace_id=r.workspace_id AND c.status='ready' AND c.census_digest=r.census_digest
 JOIN LATERAL(SELECT candidate.id,candidate.pack_digest FROM signal_semantic_context_generations candidate
  WHERE candidate.workspace_id=r.workspace_id AND candidate.status='published'
  ORDER BY candidate.generation_version DESC LIMIT 1) g ON true
 WHERE r.id=target_run AND r.status IN('ready_for_review','reviewing','validated')
  AND signal_brand_context_processing_source_current_v1(g.id)
  AND c.source_binding=signal_topic_consolidation_source_binding_v1(r.source_engine_execution_id)
  AND r.expected_group_count BETWEEN 1 AND 5000 AND r.community_plan_digest IS NOT NULL
  AND r.expected_group_count=(SELECT count(*) FROM signal_topic_atomic_groups WHERE consolidation_run_id=r.id)
  AND r.expected_group_count=(SELECT count(*) FROM signal_topic_consolidation_community_members WHERE consolidation_run_id=r.id)
 $$;
CREATE FUNCTION signal_topic_editorial_plan_valid_v1(target_run uuid,body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_topic_consolidation_runs%ROWTYPE;b jsonb;receipt jsonb;n integer:=0;seen text[]:='{}';
BEGIN
 SELECT * INTO r FROM signal_topic_consolidation_runs WHERE id=target_run;
 IF r.id IS NULL OR body->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v1'
  OR body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' OR body->>'source_context_digest' IS DISTINCT FROM r.context_digest
  OR body->>'batch_size' IS DISTINCT FROM '40' OR body->>'expected_group_count' IS DISTINCT FROM r.expected_group_count::text
  OR body->>'plan_digest' IS DISTINCT FROM signal_semantic_context_digest_json_v2(body-'plan_digest')
  OR jsonb_typeof(body->'batches') IS DISTINCT FROM 'array'
  OR jsonb_array_length(body->'batches')<>(r.expected_group_count+39)/40 THEN RETURN false;END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(body->'batches') LOOP
  IF b->>'batch_index' IS DISTINCT FROM n::text OR b->'configuration' IS DISTINCT FROM signal_topic_editorial_configuration_v1()->'screening'
   OR b->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' OR b->>'source_context_digest' IS DISTINCT FROM r.context_digest
   OR b->>'editorial_context_digest' IS DISTINCT FROM body->>'editorial_context_digest'
   OR b->>'request_digest' IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object('request_body',b->>'request_body',
    'configuration',b->'configuration','group_receipts',b->'group_receipts'))
   OR b->>'batch_key' IS DISTINCT FROM 'topic-consolidation-screen-v1:'||n::text||':'||substr(b->>'request_digest',8,16)
   OR octet_length(b->>'request_body') NOT BETWEEN 1 AND 1500000
   OR jsonb_array_length(b->'group_receipts') NOT BETWEEN 1 AND 40
   OR jsonb_array_length(b->'group_keys')<>jsonb_array_length(b->'group_receipts') THEN RETURN false;END IF;
  FOR receipt IN SELECT value FROM jsonb_array_elements(b->'group_receipts') LOOP
   IF receipt->>'group_key'=ANY(seen) OR NOT (b->'group_keys' ? (receipt->>'group_key')) OR NOT EXISTS(
    SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=r.id AND g.group_key=receipt->>'group_key'
     AND g.group_digest=receipt->>'group_digest' AND g.dossier_digest=receipt->>'dossier_digest'
     AND COALESCE((SELECT jsonb_agg(e.ref_id ORDER BY e.ref_id COLLATE "C") FROM signal_topic_atomic_group_evidence e WHERE e.atomic_group_id=g.id),'[]')=receipt->'evidence_ref_ids')
    THEN RETURN false;END IF;
   seen:=array_append(seen,receipt->>'group_key');
  END LOOP;n:=n+1;
 END LOOP;RETURN cardinality(seen)=r.expected_group_count;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$$;

CREATE FUNCTION signal_topic_editorial_assert_lease_v1(target_execution uuid,target_token uuid,new_spend boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token OR e.execution_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'topic_editorial_lease_conflict' USING ERRCODE='23514';END IF;
 IF NOT new_spend THEN RETURN;END IF;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 IF p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=least(p.valid_until,a.admission_not_after)
  OR a.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date
  OR e.organization_id IS DISTINCT FROM (SELECT organization_id FROM signal_workspaces WHERE id=e.workspace_id)
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_editorial_authority_unavailable' USING ERRCODE='23514';END IF;
END;$$;

CREATE FUNCTION signal_topic_editorial_history_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND TG_TABLE_NAME IN('signal_topic_editorial_requests','signal_topic_editorial_request_keys') THEN
  RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_requests_retained BEFORE UPDATE OR DELETE ON signal_topic_editorial_requests FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_history_guard_v1();
CREATE TRIGGER topic_editorial_keys_retained BEFORE UPDATE OR DELETE ON signal_topic_editorial_request_keys FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_history_guard_v1();
CREATE TRIGGER topic_editorial_calls_retained BEFORE DELETE ON signal_topic_editorial_calls FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_history_guard_v1();
CREATE TRIGGER topic_editorial_outbox_retained BEFORE DELETE ON signal_topic_editorial_outbox FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_history_guard_v1();

CREATE FUNCTION signal_topic_editorial_owner_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE a signal_processing_admissions%ROWTYPE;source jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO a FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
  source:=signal_topic_editorial_source_v1(NEW.numeric_run_id);
  IF a.id IS NULL OR a.action<>'topic_consolidation' OR a.automatic OR a.provider<>'anthropic' OR a.model<>'claude-sonnet-4-6'
   OR ROW(a.target_id,a.workspace_id,a.organization_id,a.actor_user_id,a.idempotency_key,a.request_digest,a.execution_cap_micro_usd)
    IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,NEW.idempotency_key,NEW.request_digest,NEW.hard_cap_micro_usd)
   OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR source IS NULL OR source IS DISTINCT FROM NEW.source_binding
   OR source->>'source_engine_execution_id' IS DISTINCT FROM NEW.source_engine_execution_id::text
   OR NEW.source_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(source)
   OR NOT signal_topic_editorial_plan_valid_v1(NEW.numeric_run_id,NEW.plan) OR NEW.plan_digest IS DISTINCT FROM NEW.plan->>'plan_digest'
   OR NEW.status<>'queued' OR NEW.state_body IS NOT NULL OR NEW.attempt_count<>0 OR NEW.dispatch_generation<>1 THEN
   RAISE EXCEPTION 'topic_editorial_owner_invalid' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_body','state_digest','result_revision_id','error_code','completed_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_body','state_digest','result_revision_id','error_code','completed_at'])
   OR OLD.status IN('review_ready','completed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'topic_editorial_owner_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='queued' AND NEW.status IN('running','failed')
   OR OLD.status='running' AND NEW.status IN('queued','failed','review_ready') OR OLD.status='failed' AND NEW.status='queued') THEN
   RAISE EXCEPTION 'topic_editorial_transition_invalid' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='review_ready' AND (NEW.state_body IS NULL OR NEW.state_body::jsonb->>'phase' IS DISTINCT FROM 'completed') THEN RAISE EXCEPTION 'topic_editorial_review_incomplete' USING ERRCODE='23514';END IF;
 IF NEW.state_body IS NOT NULL AND NEW.state_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.state_body) THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_executions
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_owner_guard_v1();

CREATE FUNCTION signal_topic_editorial_request_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;b jsonb;expected_hash text;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 IF e.id IS NULL OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1()->NEW.phase THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;
 IF NEW.phase='screening' THEN
  b:=e.plan->'batches'->NEW.batch_index;
  IF b IS NULL OR b->>'request_digest' IS DISTINCT FROM NEW.request_digest OR b->>'request_body' IS DISTINCT FROM NEW.request_body
   OR b->'group_receipts' IS DISTINCT FROM NEW.receipts THEN RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;
  expected_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('request_body',NEW.request_body,'configuration',NEW.configuration,'group_receipts',NEW.receipts));
 ELSE
  IF e.state_body IS NULL OR e.state_body::jsonb->>'phase'<>'global'
   OR jsonb_array_length(e.state_body::jsonb->'screening_outputs')<>jsonb_array_length(e.plan->'batches') THEN
   RAISE EXCEPTION 'topic_editorial_screening_incomplete' USING ERRCODE='23514';END IF;
  expected_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('request_body',NEW.request_body,'configuration',NEW.configuration,'eligible_group_receipts',NEW.receipts));
 END IF;
 -- UTF-8 byte count is a conservative token bound, plus the exact output cap.
 IF expected_hash IS DISTINCT FROM NEW.request_digest OR NEW.reserved_micro_usd IS DISTINCT FROM
  octet_length(NEW.request_body)::bigint*3+(NEW.configuration->>'max_output_tokens')::bigint*15 THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_request_guard BEFORE INSERT ON signal_topic_editorial_requests FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_request_guard_v1();

CREATE FUNCTION signal_topic_editorial_admission_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF NEW.action<>'topic_consolidation' THEN RETURN NULL;END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.target_id AND processing_admission_id=NEW.id;
 IF e.id IS NULL OR e.workspace_id<>NEW.workspace_id OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=e.id AND dispatch_generation=1)
  OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys WHERE execution_id=e.id AND request_digest=e.request_digest)
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id AND phase='screening')<>jsonb_array_length(e.plan->'batches') THEN
  RAISE EXCEPTION 'topic_editorial_admission_incomplete' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER topic_editorial_admission_complete AFTER INSERT ON signal_processing_admissions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_admission_complete_v1();

CREATE FUNCTION request_signal_topic_editorial_v1(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,request_key text,expected_quote text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 q jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;hash text;e uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();b jsonb;result jsonb;day date;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v1\.[0-9]{10}\.[a-f0-9]{64}$',false) THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'numeric_run_id',target_run,
  'plan_digest',plan->>'plan_digest','quote_reference',expected_quote));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
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
  plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference)
 VALUES(e,w.id,w.organization_id,target_actor,target_run,(q->'source_binding'->>'source_engine_execution_id')::uuid,q->'source_binding',
  signal_semantic_context_digest_json_v2(q->'source_binding'),plan,plan->>'plan_digest',admission,(q->>'hard_cap_micro_usd')::bigint,request_key,hash,expected_quote);
 FOR b IN SELECT value FROM jsonb_array_elements(plan->'batches') LOOP
  INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,configuration,receipts,reserved_micro_usd)
  VALUES(w.id,e,'screening',(b->>'batch_index')::integer,b->>'request_digest',b->>'request_body',b->'configuration',b->'group_receipts',
   octet_length(b->>'request_body')::bigint*3+16384*15);
 END LOOP;
 INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id) VALUES(w.id,e,1,'topic-editorial-'||e::text||'-1');
 result:=jsonb_build_object('execution_id',e,'worker_job_id','topic-editorial-'||e::text||'-1','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result) VALUES(w.id,target_actor,request_key,e,hash,result);
 RETURN result;
END;$$;

CREATE FUNCTION signal_topic_editorial_quote_v1(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,deadline bigint DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;org uuid;exposure bigint;expiry bigint;body jsonb;cap bigint;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text THEN RETURN '{"status":"source_stale"}'::jsonb;END IF;
 IF NOT signal_topic_editorial_plan_valid_v1(target_run,plan) THEN RAISE EXCEPTION 'topic_editorial_plan_invalid' USING ERRCODE='23514';END IF;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN RETURN '{"status":"policy_required"}'::jsonb;END IF;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF a.action IS NULL OR a.automatic_allowed OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1()
  OR a.provider IS DISTINCT FROM 'anthropic' OR a.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN RETURN '{"status":"policy_action_required"}'::jsonb;END IF;
 cap:=least(a.max_execution_micro_usd,20000000);
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(org,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone);
 IF cap<=0 OR exposure+cap>p.daily_cap_micro_usd THEN RETURN '{"status":"budget_unavailable"}'::jsonb;END IF;
 expiry:=COALESCE(deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '5 minutes',p.valid_until,
  (((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone))))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '5 minutes',p.valid_until,
  (((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone)) THEN RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'source_binding',source,'plan_digest',plan->>'plan_digest',
  'policy_id',p.id,'policy_digest',p.policy_digest,'configuration_digest',a.configuration_digest,'hard_cap_micro_usd',cap::text,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize','quote_reference','v1.'||expiry::text||'.'||substr(signal_semantic_context_digest_json_v2(body),8),
  'quote_expires_at',to_timestamp(expiry),'provider_execution_enabled',false);
END;$$;

CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation' AND (NEW.execution_cap_micro_usd NOT BETWEEN 1 AND 20000000 OR NEW.automatic OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6') THEN RAISE EXCEPTION 'topic_editorial_admission_invalid' USING ERRCODE='23514'; END IF;
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
   IF NEW.action IN('topic_consolidation_numeric','topic_consolidation') THEN
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

-- Long, read-only centroid work pins its execution, not users/brands. Durable
-- writes continue to use assert_signal_topic_consolidation_worker_scope_v1.
CREATE FUNCTION assert_signal_topic_consolidation_worker_lease_v1(target_execution uuid,target_token uuid,
 target_workspace uuid,target_actor uuid,target_source uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_consolidation_executions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_topic_consolidation_executions WHERE id=target_execution FOR SHARE;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token OR e.execution_expires_at<=clock_timestamp()
  OR e.workspace_id IS DISTINCT FROM target_workspace OR e.actor_user_id IS DISTINCT FROM target_actor
  OR target_source IS NOT NULL AND e.source_engine_execution_id IS DISTINCT FROM target_source
  OR signal_topic_consolidation_source_binding_v1(e.source_engine_execution_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_consolidation_lease_conflict' USING ERRCODE='23514';END IF;
END;$$;

CREATE FUNCTION signal_topic_editorial_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;amount bigint;org_amount bigint;body jsonb;usage jsonb;cost bigint;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 IF ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
  IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd,a.budget_date,a.budget_timezone) THEN
  RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,true);
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.response_output IS NOT NULL OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_call_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  IF prior.id IS NOT NULL AND (prior.status<>'definitely_not_sent' OR NEW.retry_of_call_id IS DISTINCT FROM prior.id)
   OR prior.id IS NULL AND NEW.retry_of_call_id IS NOT NULL
   OR (SELECT count(*) FROM signal_topic_editorial_calls WHERE request_id=r.id)>=3 THEN
   RAISE EXCEPTION 'topic_editorial_call_not_retryable' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO amount FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
  SELECT total_micro_usd INTO org_amount FROM signal_processing_org_exposure_v1(e.organization_id,a.budget_date,a.budget_timezone);
  IF amount+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_amount+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'topic_editorial_call_immutable' USING ERRCODE='23514';END IF;
  IF OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output)
   IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output) THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF NEW.status='in_flight' AND OLD.status='reserved' THEN
   PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,true);NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR length(NEW.response_storage_key) NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'topic_editorial_response_invalid' USING ERRCODE='23514';END IF;
  body:=signal_topic_editorial_parse_json_v1(NEW.response_body_private);usage:=body->'usage';
  IF body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
   OR NOT COALESCE(usage->>'input_tokens'~'^[0-9]+$' AND usage->>'output_tokens'~'^[0-9]+$',false)
   OR COALESCE(usage->>'cache_creation_input_tokens','0')<>'0' OR COALESCE(usage->>'cache_read_input_tokens','0')<>'0' THEN
   IF NEW.status='settled' THEN RAISE EXCEPTION 'topic_editorial_usage_invalid' USING ERRCODE='23514';END IF;
  ELSE
   cost:=(usage->>'input_tokens')::bigint*3+(usage->>'output_tokens')::bigint*15;
   IF NEW.status='settled' AND (NEW.settled_micro_usd IS DISTINCT FROM cost OR cost>NEW.reserved_micro_usd) THEN
    RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514';END IF;
   IF NEW.observed_micro_usd IS DISTINCT FROM cost THEN RAISE EXCEPTION 'topic_editorial_usage_invalid' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_call_guard BEFORE INSERT OR UPDATE ON signal_topic_editorial_calls FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_call_guard_v1();

-- A false runtime gate cannot reserve or transition toward a send. This is a
-- private server argument; no public route/Worker exposes it in this release.
CREATE FUNCTION reserve_signal_topic_editorial_call_v1(target_execution uuid,target_token uuid,target_request text,provider_available boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 IF NOT COALESCE(provider_available,false) THEN RAISE EXCEPTION 'topic_editorial_provider_disabled' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 PERFORM signal_topic_editorial_assert_lease_v1(e.id,target_token,true);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE execution_id=e.id AND request_digest=target_request;
 IF r.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_request_missing' USING ERRCODE='23514';END IF;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
 IF c.id IS NULL OR c.status='definitely_not_sent' THEN
  INSERT INTO signal_topic_editorial_calls(workspace_id,organization_id,execution_id,request_id,retry_of_call_id,reserved_micro_usd,budget_date,budget_timezone)
   VALUES(e.workspace_id,e.organization_id,e.id,r.id,c.id,r.reserved_micro_usd,a.budget_date,a.budget_timezone) RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('call_id',c.id,'attempt_token',c.attempt_token,'status',c.status,'reserved_micro_usd',c.reserved_micro_usd::text);
END;$$;
CREATE FUNCTION mark_sent_signal_topic_editorial_call_v1(target_call uuid,target_attempt uuid,target_execution_token uuid,provider_available boolean DEFAULT false)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 IF NOT COALESCE(provider_available,false) THEN RAISE EXCEPTION 'topic_editorial_provider_disabled' USING ERRCODE='23514';END IF;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM signal_topic_editorial_assert_lease_v1(c.execution_id,target_execution_token,true);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status<>'reserved' THEN
  RAISE EXCEPTION 'topic_editorial_call_not_sendable' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_calls SET status='in_flight' WHERE id=c.id;RETURN true;
END;$$;

CREATE FUNCTION signal_topic_editorial_parse_json_v1(body text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
 SET search_path=public,pg_temp AS $$ BEGIN RETURN body::jsonb;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END;$$;
-- Provider object field order and unordered membership lists do not change an
-- interpretation. Multiplicity is retained; this never deduplicates decisions.
CREATE FUNCTION signal_topic_editorial_normalize_output_v1(body jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
 SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 CASE jsonb_typeof(body)
 WHEN 'object' THEN SELECT COALESCE(jsonb_object_agg(key,signal_topic_editorial_normalize_output_v1(value)),'{}') INTO result FROM jsonb_each(body);
 WHEN 'array' THEN SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]') INTO result
  FROM(SELECT signal_topic_editorial_normalize_output_v1(value) v FROM jsonb_array_elements(body)) x;
 WHEN 'string' THEN result:=to_jsonb(btrim(body#>>'{}'));
 ELSE result:=body;END CASE;RETURN result;
END;$$;
CREATE FUNCTION persist_signal_topic_editorial_response_v1(target_call uuid,target_attempt uuid,body text,storage_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;parsed jsonb;output_text text;cost bigint;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status NOT IN('in_flight','outcome_unknown','response_persisted','settled') THEN
  RAISE EXCEPTION 'topic_editorial_response_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.response_body_private IS NOT NULL THEN
  IF c.response_body_private IS DISTINCT FROM body OR c.response_storage_key IS DISTINCT FROM storage_key THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('status',c.status,'replayed',true);END IF;
 parsed:=signal_topic_editorial_parse_json_v1(body);
 IF jsonb_typeof(parsed->'content')='array' THEN
  SELECT string_agg(value->>'text','' ORDER BY ordinal) INTO output_text FROM jsonb_array_elements(parsed->'content') WITH ORDINALITY x(value,ordinal)
   WHERE value->>'type'='text';END IF;
 IF parsed->>'model'='claude-sonnet-4-6' AND parsed->'usage'->>'input_tokens'~'^[0-9]+$' AND parsed->'usage'->>'output_tokens'~'^[0-9]+$'
  AND COALESCE(parsed->'usage'->>'cache_creation_input_tokens','0')='0' AND COALESCE(parsed->'usage'->>'cache_read_input_tokens','0')='0' THEN
  cost:=(parsed->'usage'->>'input_tokens')::bigint*3+(parsed->'usage'->>'output_tokens')::bigint*15;END IF;
 UPDATE signal_topic_editorial_calls SET status='response_persisted',response_body_private=body,response_sha256=signal_semantic_context_digest_v1(body),
  response_storage_key=storage_key,response_output=signal_topic_editorial_parse_json_v1(output_text),observed_micro_usd=cost,response_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('status','response_persisted','replayed',false);
END;$$;
CREATE FUNCTION settle_signal_topic_editorial_call_v1(target_call uuid,target_attempt uuid) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status NOT IN('response_persisted','settled') THEN
  RAISE EXCEPTION 'topic_editorial_settlement_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.status='settled' THEN RETURN jsonb_build_object('status',c.status,'settled_micro_usd',c.settled_micro_usd::text,'replayed',true);END IF;
 IF c.observed_micro_usd IS NULL OR c.observed_micro_usd>c.reserved_micro_usd THEN
  UPDATE signal_topic_editorial_calls SET status='outcome_unknown',error_code='topic_editorial_usage_unresolved' WHERE id=c.id;
  RETURN jsonb_build_object('status','outcome_unknown','replayed',false);END IF;
 UPDATE signal_topic_editorial_calls SET status='settled',settled_micro_usd=observed_micro_usd,settled_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('status','settled','settled_micro_usd',c.observed_micro_usd::text,'replayed',false);
END;$$;
CREATE FUNCTION fail_signal_topic_editorial_call_v1(target_call uuid,target_attempt uuid,definitely_not_sent boolean DEFAULT false)
 RETURNS text LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt THEN RAISE EXCEPTION 'topic_editorial_call_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.status IN('settled','response_persisted','definitely_not_sent','outcome_unknown') THEN RETURN c.status;END IF;
 -- Even a transport exception cannot release a call once markSent committed.
 IF c.status='reserved' AND definitely_not_sent THEN
  UPDATE signal_topic_editorial_calls SET status='definitely_not_sent',error_code='topic_editorial_definitely_not_sent' WHERE id=c.id;RETURN 'definitely_not_sent';
 ELSIF c.status='in_flight' THEN
  UPDATE signal_topic_editorial_calls SET status='outcome_unknown',error_code='topic_editorial_outcome_unknown' WHERE id=c.id;RETURN 'outcome_unknown';
 END IF;
 RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';
END;$$;

CREATE FUNCTION signal_topic_editorial_state_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb;prior jsonb;output jsonb;r signal_topic_editorial_requests%ROWTYPE;seen integer[]:='{}';keys text[];expected text[];
BEGIN
 IF NEW.state_body IS NOT DISTINCT FROM OLD.state_body THEN RETURN NEW;END IF;
 IF OLD.status<>'running' OR OLD.execution_token IS NULL OR OLD.execution_expires_at<=clock_timestamp() OR NEW.state_body IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_state_lease_invalid' USING ERRCODE='23514';END IF;
 body:=NEW.state_body::jsonb;prior:=OLD.state_body::jsonb;
 IF body->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-runner-v1' OR body->>'execution_key' IS DISTINCT FROM NEW.id::text
  OR body->>'plan_digest' IS DISTINCT FROM NEW.plan_digest OR body->>'phase' NOT IN('screening','global','completed')
  OR jsonb_typeof(body->'screening_outputs') IS DISTINCT FROM 'array'
  OR prior IS NOT NULL AND NOT body->'screening_outputs' @> prior->'screening_outputs'
  OR prior->'global' IS DISTINCT FROM 'null'::jsonb AND prior->'global' IS NOT NULL AND body->'global' IS DISTINCT FROM prior->'global' THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 FOR output IN SELECT value FROM jsonb_array_elements(body->'screening_outputs') LOOP
  IF (output->>'batch_index')::integer=ANY(seen) THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
  seen:=array_append(seen,(output->>'batch_index')::integer);
  SELECT * INTO r FROM signal_topic_editorial_requests WHERE execution_id=NEW.id AND phase='screening' AND batch_index=(output->>'batch_index')::integer;
  IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.request_id=r.id AND c.status='settled'
   AND signal_topic_editorial_normalize_output_v1(c.response_output)=signal_topic_editorial_normalize_output_v1(output)) THEN
   RAISE EXCEPTION 'topic_editorial_state_unpaid' USING ERRCODE='23514';END IF;
  SELECT array_agg(value->>'group_key' ORDER BY value->>'group_key' COLLATE "C") INTO keys FROM jsonb_array_elements(output->'decisions');
  SELECT array_agg(value->>'group_key' ORDER BY value->>'group_key' COLLATE "C") INTO expected FROM jsonb_array_elements(r.receipts);
  IF keys IS DISTINCT FROM expected THEN RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 END LOOP;
 IF body->>'phase' IN('global','completed') AND cardinality(seen)<>jsonb_array_length(NEW.plan->'batches')
  OR body->>'phase'='screening' AND cardinality(seen)>=jsonb_array_length(NEW.plan->'batches') THEN
  RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 IF body->>'phase'='completed' THEN
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_requests q JOIN signal_topic_editorial_calls c ON c.request_id=q.id
   WHERE q.execution_id=NEW.id AND q.phase='global' AND q.request_digest=body->'global'->>'request_digest' AND c.status='settled'
   AND signal_topic_editorial_normalize_output_v1(c.response_output)=signal_topic_editorial_normalize_output_v1(body->'global'->'result')) THEN
   RAISE EXCEPTION 'topic_editorial_global_unpaid' USING ERRCODE='23514';END IF;
 ELSE IF body->'global' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_state_guard BEFORE UPDATE ON signal_topic_editorial_executions FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_state_guard_v1();

CREATE FUNCTION claim_signal_topic_editorial_execution_v1(target_execution uuid,expected_job text,lease_seconds integer DEFAULT 180)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;token uuid:=gen_random_uuid();
BEGIN
 IF lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'topic_editorial_lease_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 IF e.id IS NULL OR expected_job IS DISTINCT FROM 'topic-editorial-'||e.id::text||'-'||e.dispatch_generation::text THEN RETURN NULL;END IF;
 IF e.status IN('review_ready','completed') THEN RETURN jsonb_build_object('completed',true,'execution_id',e.id);END IF;
 IF e.status<>'queued' OR e.attempt_count>=20 THEN RETURN NULL;END IF;
 -- Claim grants access to durable recovery only. New money/send still performs
 -- the exact live policy/actor/source fence independently in a short transaction.
 UPDATE signal_topic_editorial_executions SET status='running',execution_token=token,
  execution_expires_at=clock_timestamp()+make_interval(secs=>lease_seconds),attempt_count=attempt_count+1,error_code=NULL WHERE id=e.id;
 RETURN jsonb_build_object('execution_id',e.id,'workspace_id',e.workspace_id,'actor_user_id',e.actor_user_id,'numeric_run_id',e.numeric_run_id,
  'source_execution_id',e.source_engine_execution_id,'execution_token',token,'worker_job_id',expected_job);
END;$$;
CREATE FUNCTION heartbeat_signal_topic_editorial_execution_v1(target_execution uuid,target_token uuid) RETURNS boolean LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_editorial_executions SET execution_expires_at=clock_timestamp()+interval '180 seconds'
 WHERE id=target_execution AND status='running' AND execution_token=target_token AND execution_expires_at>clock_timestamp();RETURN FOUND;
END;$$;
CREATE FUNCTION finish_signal_topic_editorial_execution_v1(target_execution uuid,target_token uuid) RETURNS boolean LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 PERFORM signal_topic_editorial_assert_lease_v1(target_execution,target_token,false);
 UPDATE signal_topic_editorial_executions SET status='review_ready',execution_token=NULL,execution_expires_at=NULL
  WHERE id=target_execution AND state_body::jsonb->>'phase'='completed';
 IF NOT FOUND THEN RAISE EXCEPTION 'topic_editorial_review_incomplete' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_outbox SET status='completed',lease_token=NULL,lease_expires_at=NULL WHERE execution_id=target_execution;
 RETURN true;
END;$$;
CREATE FUNCTION fail_signal_topic_editorial_execution_v1(target_execution uuid,target_token uuid,code text) RETURNS boolean LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_editorial_executions SET status='failed',execution_token=NULL,execution_expires_at=NULL,
  error_code=CASE WHEN code~'^topic_editorial_[a-z_]{1,100}$' THEN code ELSE 'topic_editorial_worker_failed' END
  WHERE id=target_execution AND status='running' AND execution_token=target_token;RETURN FOUND;
END;$$;
CREATE FUNCTION retry_signal_topic_editorial_execution_v1(target_workspace uuid,target_actor uuid,target_execution uuid,request_key text)
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
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status IN('in_flight','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_not_retryable' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_executions SET status='queued',error_code=NULL,dispatch_generation=dispatch_generation+1 WHERE id=e.id;
 INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
  VALUES(e.workspace_id,e.id,e.dispatch_generation+1,'topic-editorial-'||e.id::text||'-'||(e.dispatch_generation+1)::text);
 result:=jsonb_build_object('execution_id',e.id,'worker_job_id','topic-editorial-'||e.id::text||'-'||(e.dispatch_generation+1)::text,'replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result)
  VALUES(target_workspace,target_actor,request_key,e.id,hash,result);RETURN result;
END;$$;
CREATE FUNCTION recover_signal_topic_editorial_executions_v1(batch_limit integer DEFAULT 10) RETURNS integer LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;n integer:=0;
BEGIN
 FOR e IN SELECT * FROM signal_topic_editorial_executions WHERE status='running' AND execution_expires_at<=clock_timestamp()
  ORDER BY execution_expires_at LIMIT greatest(0,least(batch_limit,100)) FOR UPDATE SKIP LOCKED LOOP
  IF EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status IN('in_flight','outcome_unknown')) OR e.dispatch_generation>=20 THEN
   UPDATE signal_topic_editorial_executions SET status='failed',error_code='topic_editorial_recovery_required',execution_token=NULL,execution_expires_at=NULL WHERE id=e.id;
  ELSE
   UPDATE signal_topic_editorial_executions SET status='queued',dispatch_generation=dispatch_generation+1,execution_token=NULL,execution_expires_at=NULL WHERE id=e.id;
   INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id)
    VALUES(e.workspace_id,e.id,e.dispatch_generation+1,'topic-editorial-'||e.id::text||'-'||(e.dispatch_generation+1)::text);
  END IF;n:=n+1;
 END LOOP;RETURN n;
END;$$;
CREATE FUNCTION claim_signal_topic_editorial_dispatch_v1(batch_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 WITH candidates AS(SELECT o.id FROM signal_topic_editorial_outbox o JOIN signal_topic_editorial_executions e ON e.id=o.execution_id
  WHERE e.status='queued' AND e.dispatch_generation=o.dispatch_generation AND o.available_at<=clock_timestamp()
   AND(o.status='queued' OR o.status='dispatching' AND o.lease_expires_at<=clock_timestamp())
  ORDER BY o.available_at,o.id LIMIT greatest(0,least(batch_limit,100)) FOR UPDATE OF o SKIP LOCKED),
 claimed AS(UPDATE signal_topic_editorial_outbox o SET status='dispatching',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '30 seconds',
  attempt_count=attempt_count+1 FROM candidates c WHERE o.id=c.id RETURNING o.*)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('dispatch_id',id,'execution_id',execution_id,'workspace_id',workspace_id,
  'worker_job_id',worker_job_id,'lease_token',lease_token,'attempt',attempt_count)),'[]') INTO result FROM claimed;RETURN result;
END;$$;
CREATE FUNCTION acknowledge_signal_topic_editorial_dispatch_v1(target_dispatch uuid,target_token uuid) RETURNS boolean LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_editorial_outbox SET status='dispatched',lease_token=NULL,lease_expires_at=NULL
 WHERE id=target_dispatch AND status='dispatching' AND lease_token=target_token;RETURN FOUND;
END;$$;
CREATE FUNCTION fail_signal_topic_editorial_dispatch_v1(target_dispatch uuid,target_token uuid) RETURNS boolean LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_topic_editorial_outbox SET status='queued',lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '10 seconds'
 WHERE id=target_dispatch AND status='dispatching' AND lease_token=target_token;RETURN FOUND;
END;$$;

-- Owner-only functions and rows. Installing 0176 never grants a policy/action.
DO $$DECLARE item record;role_name text;BEGIN
 FOR item IN SELECT c.oid::regclass AS identity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN('signal_topic_editorial_executions','signal_topic_editorial_requests','signal_topic_editorial_calls','signal_topic_editorial_outbox','signal_topic_editorial_request_keys') LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',item.identity);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',item.identity);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',item.identity,role_name);END IF;
  END LOOP;
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND(p.proname LIKE '%topic_editorial%v1' OR p.proname IN('signal_processing_org_exposure_v1','signal_processing_org_exposure_pre0176_v1',
   'assert_signal_topic_consolidation_worker_lease_v1','signal_processing_admission_guard_v1')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.identity);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.identity,role_name);END IF;
  END LOOP;
 END LOOP;
END;$$;
