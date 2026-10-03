-- Durable sharded global consolidation stages. These rows are children of the
-- already-authorized topic-consolidation execution: they do not create an
-- alternate policy, quote, admission, or budget ledger.
CREATE TABLE signal_topic_editorial_global_stages_v2 (
 stage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL, organization_id uuid NOT NULL, execution_id uuid NOT NULL,
 processing_admission_id uuid NOT NULL, snapshot_digest text NOT NULL CHECK(snapshot_digest~'^sha256:[0-9a-f]{64}$'),
 screening_review_digest text NOT NULL CHECK(screening_review_digest~'^sha256:[0-9a-f]{64}$'),
 expected_group_count integer NOT NULL CHECK(expected_group_count BETWEEN 1 AND 5000),
 state text NOT NULL DEFAULT 'open' CHECK(state IN('open','complete','blocked','materialized')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz,
 UNIQUE(execution_id,snapshot_digest,screening_review_digest),
 UNIQUE(stage_id,workspace_id,organization_id,execution_id,processing_admission_id),
 UNIQUE(stage_id,workspace_id,organization_id,execution_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id),
 FOREIGN KEY(processing_admission_id) REFERENCES signal_processing_admissions(id)
);

CREATE TABLE signal_topic_editorial_global_stage_requests_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage_id uuid NOT NULL REFERENCES signal_topic_editorial_global_stages_v2(stage_id),
 stage_kind text NOT NULL CHECK(stage_kind IN('shard','merge','rank')), round integer NOT NULL CHECK(round>=0),
 batch_index integer NOT NULL CHECK(batch_index>=0), batch_count integer NOT NULL CHECK(batch_count>batch_index),
 input_digest text NOT NULL CHECK(input_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 stage_identity text NOT NULL CHECK(stage_identity~'^sha256:[0-9a-f]{64}$'),
 input_body text NOT NULL, request_body text NOT NULL, stage_contract_body text NOT NULL,
 custom_id text NOT NULL CHECK(custom_id~'^[A-Za-z0-9_-]{1,64}$'), call_identity text NOT NULL CHECK(call_identity~'^[A-Za-z0-9_-]{1,64}$'),
 model text NOT NULL CHECK(model='claude-sonnet-4-6'), max_tokens integer NOT NULL CHECK(max_tokens>0),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitted','received','validated','failed')),
 raw_text text, raw_sha256 text, validation jsonb, validation_sha256 text, received_at timestamptz, validated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(stage_id,stage_kind,round,batch_index,input_digest,request_digest),
 UNIQUE(stage_id,custom_id), UNIQUE(stage_id,call_identity), UNIQUE(id,stage_id),
 CHECK((raw_text IS NULL AND raw_sha256 IS NULL AND received_at IS NULL) OR
       (raw_text IS NOT NULL AND raw_sha256~'^sha256:[0-9a-f]{64}$' AND received_at IS NOT NULL)),
 CHECK((validation IS NULL AND validation_sha256 IS NULL AND validated_at IS NULL) OR
       (validation IS NOT NULL AND validation_sha256~'^sha256:[0-9a-f]{64}$' AND validated_at IS NOT NULL))
);

-- Stage calls are a distinct transport ledger for immutable sharded requests,
-- but exposure/caps below aggregate them with the original editorial calls.
CREATE TABLE signal_topic_editorial_global_stage_calls_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage_id uuid NOT NULL,
 request_id uuid NOT NULL, workspace_id uuid NOT NULL, organization_id uuid NOT NULL, execution_id uuid NOT NULL,
 retry_of_call_id uuid REFERENCES signal_topic_editorial_global_stage_calls_v2(id),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0), budget_date date NOT NULL, budget_timezone text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','in_flight','submission_unknown','response_persisted','outcome_unknown','settled','definitely_not_sent')),
 observed_micro_usd bigint, settled_micro_usd bigint, provider_batch_id text,
 response_body_private text, response_sha256 text, response_storage_key text, response_http_status smallint,
 response_complete boolean, response_provider_request_id text, error_code text,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz, response_at timestamptz, settled_at timestamptz,
 FOREIGN KEY(request_id,stage_id) REFERENCES signal_topic_editorial_global_stage_requests_v2(id,stage_id),
 FOREIGN KEY(stage_id,workspace_id,organization_id,execution_id) REFERENCES signal_topic_editorial_global_stages_v2(stage_id,workspace_id,organization_id,execution_id),
 CHECK(observed_micro_usd IS NULL OR observed_micro_usd>=0), CHECK(settled_micro_usd IS NULL OR settled_micro_usd>=0),
 CHECK((response_body_private IS NULL AND response_sha256 IS NULL AND response_storage_key IS NULL AND response_http_status IS NULL AND response_complete IS NULL AND response_provider_request_id IS NULL)
    OR (response_body_private IS NOT NULL AND response_sha256~'^sha256:[0-9a-f]{64}$' AND response_storage_key IS NOT NULL AND length(response_storage_key) BETWEEN 1 AND 1024
      AND response_http_status BETWEEN 100 AND 599 AND response_complete IS NOT NULL)),
 UNIQUE(id,request_id,stage_id)
);
CREATE INDEX signal_topic_editorial_global_stage_calls_execution_idx ON signal_topic_editorial_global_stage_calls_v2(execution_id,status);
CREATE UNIQUE INDEX signal_topic_editorial_global_stage_live_call_v2 ON signal_topic_editorial_global_stage_calls_v2(request_id)
 WHERE status NOT IN('settled','definitely_not_sent');

CREATE TABLE signal_topic_editorial_global_stage_batches_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage_id uuid NOT NULL REFERENCES signal_topic_editorial_global_stages_v2(stage_id),
 stage_kind text NOT NULL CHECK(stage_kind IN('shard','merge','rank')), state text NOT NULL DEFAULT 'prepared'
  CHECK(state IN('prepared','submitting','submission_unknown','in_progress','canceling','ended','rejected','imported')),
 manifest_body text NOT NULL, manifest_digest text NOT NULL CHECK(manifest_digest~'^sha256:[0-9a-f]{64}$'),
 provider_batch_id text, provider_receipt_body text, provider_receipt_sha256 text, rejection_http_status smallint,
 lease_token uuid, lease_expires_at timestamptz, next_poll_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), submitted_at timestamptz, ended_at timestamptz,
 FOREIGN KEY(stage_id) REFERENCES signal_topic_editorial_global_stages_v2(stage_id),
 UNIQUE(stage_id,manifest_digest), UNIQUE(provider_batch_id),
 CHECK((provider_receipt_body IS NULL AND provider_receipt_sha256 IS NULL) OR
       (provider_receipt_body IS NOT NULL AND provider_receipt_sha256~'^sha256:[0-9a-f]{64}$'))
);
CREATE TABLE signal_topic_editorial_global_stage_batch_items_v2 (
 batch_id uuid NOT NULL REFERENCES signal_topic_editorial_global_stage_batches_v2(id),
 stage_id uuid NOT NULL, request_id uuid NOT NULL, call_id uuid NOT NULL, custom_id text NOT NULL,
 call_identity text NOT NULL CHECK(call_identity~'^[A-Za-z0-9_-]{1,64}$'),
 outcome text CHECK(outcome IN('succeeded','errored','canceled','expired','submission_rejected')),
 raw_text text,raw_sha256 text,validation jsonb,validation_sha256 text,
 received_at timestamptz, PRIMARY KEY(batch_id,request_id), UNIQUE(batch_id,custom_id),
 FOREIGN KEY(request_id,stage_id) REFERENCES signal_topic_editorial_global_stage_requests_v2(id,stage_id),
 FOREIGN KEY(call_id,request_id,stage_id) REFERENCES signal_topic_editorial_global_stage_calls_v2(id,request_id,stage_id)
 ,CHECK((raw_text IS NULL AND raw_sha256 IS NULL) OR (raw_text IS NOT NULL AND raw_sha256~'^sha256:[0-9a-f]{64}$'))
 ,CHECK((validation IS NULL AND validation_sha256 IS NULL) OR (validation IS NOT NULL AND validation_sha256~'^sha256:[0-9a-f]{64}$'))
);

-- Exact catalog snapshot (including per-group citation sidecar) is retained
-- before handing it to the existing immutable revision materializer.
CREATE TABLE signal_topic_editorial_global_stage_catalog_v2 (
 stage_id uuid PRIMARY KEY REFERENCES signal_topic_editorial_global_stages_v2(stage_id),
 catalog_digest text NOT NULL CHECK(catalog_digest~'^sha256:[0-9a-f]{64}$'),
 catalog_body jsonb NOT NULL, group_evidence jsonb NOT NULL, revision_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), materialized_at timestamptz,
 CHECK(jsonb_typeof(group_evidence)='array')
);

CREATE FUNCTION signal_topic_editorial_global_stage_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;run signal_topic_consolidation_runs%ROWTYPE;
 snapshot_count integer;snapshot_value text;owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'completed_at')
   OR OLD.state NOT IN('open','complete') OR NEW.state NOT IN('blocked','complete','materialized')
   OR (NEW.state='blocked' AND OLD.state<>'open') OR (NEW.state='complete' AND OLD.state<>'open')
   OR (NEW.state='materialized' AND OLD.state NOT IN('open','complete'))
   OR (NEW.state='open')<>(NEW.completed_at IS NULL) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=e.numeric_run_id AND workspace_id=e.workspace_id;
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 SELECT count(DISTINCT request.receipts->'request'->'identity'->>'snapshot_digest'),
   min(request.receipts->'request'->'identity'->>'snapshot_digest')
   INTO snapshot_count,snapshot_value FROM signal_topic_editorial_requests request WHERE request.execution_id=e.id;
 IF e.id IS NULL OR run.id IS NULL OR owner_row.stage<>'review_pending'
  OR NEW.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR NEW.organization_id IS DISTINCT FROM e.organization_id OR NEW.expected_group_count IS DISTINCT FROM run.expected_group_count
  OR snapshot_count<>1 OR snapshot_value IS DISTINCT FROM NEW.snapshot_digest
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)<>NEW.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_source_mismatch' USING ERRCODE='23514';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_stages_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_guard_v2();

CREATE FUNCTION signal_topic_editorial_global_stage_request_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_topic_editorial_global_stages_v2%ROWTYPE;body jsonb;expected_identity text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','raw_text','raw_sha256','validation','validation_sha256','received_at','validated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','raw_text','raw_sha256','validation','validation_sha256','received_at','validated_at'])
   OR OLD.raw_text IS NOT NULL AND ROW(NEW.raw_text,NEW.raw_sha256,NEW.received_at) IS DISTINCT FROM ROW(OLD.raw_text,OLD.raw_sha256,OLD.received_at)
   OR OLD.validation IS NOT NULL AND ROW(NEW.validation,NEW.validation_sha256,NEW.validated_at) IS DISTINCT FROM ROW(OLD.validation,OLD.validation_sha256,OLD.validated_at)
   OR NEW.state<>OLD.state AND NOT(OLD.state='prepared' AND NEW.state IN('submitted','failed')
    OR OLD.state='submitted' AND NEW.state IN('received','failed') OR OLD.state='received' AND NEW.state IN('validated','failed')) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_request_immutable' USING ERRCODE='23514';END IF;
  IF NEW.raw_text IS NOT NULL AND (NEW.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.raw_text)
    OR NEW.state NOT IN('received','validated')) THEN RAISE EXCEPTION 'topic_editorial_global_stage_receipt_invalid' USING ERRCODE='23514';END IF;
  IF NEW.validation IS NOT NULL AND (NEW.validation_sha256 IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.validation)
    OR NEW.raw_text IS NULL OR NEW.state<>'validated') THEN RAISE EXCEPTION 'topic_editorial_global_stage_validation_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO s FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 BEGIN body:=NEW.request_body::jsonb;EXCEPTION WHEN others THEN RAISE EXCEPTION 'topic_editorial_global_stage_request_invalid' USING ERRCODE='23514';END;
 expected_identity:=signal_topic_editorial_digest_json_v1(jsonb_build_object('stage_id',NEW.stage_id::text,'snapshot_digest',s.snapshot_digest,
  'stage_kind',NEW.stage_kind,'round',NEW.round,'batch_index',NEW.batch_index,'input_digest',NEW.input_digest,'request_digest',NEW.request_digest));
 IF s.stage_id IS NULL OR body->>'model' IS DISTINCT FROM NEW.model OR body->>'max_tokens' IS DISTINCT FROM NEW.max_tokens::text
  OR s.state<>'open'
  OR NEW.stage_identity IS DISTINCT FROM expected_identity
  OR (NEW.input_body::jsonb->>'snapshot_digest' IS NOT NULL AND NEW.input_body::jsonb->>'snapshot_digest' IS DISTINCT FROM s.snapshot_digest)
  OR NEW.batch_count>s.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_request_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_request_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_stage_requests_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_request_guard_v2();

CREATE FUNCTION signal_topic_editorial_global_stage_catalog_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_topic_editorial_global_stages_v2%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['revision_id','materialized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision_id','materialized_at'])
   OR OLD.revision_id IS NOT NULL AND ROW(NEW.revision_id,NEW.materialized_at) IS DISTINCT FROM ROW(OLD.revision_id,OLD.materialized_at)
   OR (NEW.revision_id IS NULL)<>(NEW.materialized_at IS NULL) THEN
   RAISE EXCEPTION 'topic_editorial_global_catalog_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_catalog_retained' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=s.execution_id;
 IF s.stage_id IS NULL OR jsonb_typeof(NEW.catalog_body) IS DISTINCT FROM 'object'
  OR NEW.catalog_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.catalog_body)
  OR jsonb_array_length(NEW.group_evidence)<>s.expected_group_count
  OR (SELECT count(DISTINCT item->>'group_key') FROM jsonb_array_elements(NEW.group_evidence) item)<>s.expected_group_count
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.group_evidence) AS entry(value)
    WHERE entry.value->>'status' IS NULL OR entry.value->>'status' NOT IN('topic','narrative','noise','insufficient_evidence')
      OR jsonb_typeof(entry.value->'cited_ref_ids') IS DISTINCT FROM 'array'
      OR entry.value->>'status' IN('topic','narrative','noise') AND jsonb_array_length(entry.value->'cited_ref_ids')=0
      OR (SELECT count(*) FROM jsonb_array_elements_text(entry.value->'cited_ref_ids')) <>
         (SELECT count(DISTINCT ref_id) FROM jsonb_array_elements_text(entry.value->'cited_ref_ids') cited(ref_id))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(entry.value->'cited_ref_ids') cited(ref_id)
        WHERE NOT EXISTS(SELECT 1 FROM signal_topic_atomic_groups g
          JOIN signal_topic_atomic_group_evidence evidence ON evidence.atomic_group_id=g.id
            AND evidence.consolidation_run_id=g.consolidation_run_id AND evidence.workspace_id=g.workspace_id
          WHERE g.consolidation_run_id=e.numeric_run_id AND g.group_key=entry.value->>'group_key'
            AND evidence.ref_id=cited.ref_id)))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.group_evidence) AS entry(value) WHERE NOT EXISTS(
     SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=e.numeric_run_id AND g.group_key=entry.value->>'group_key'))
  OR (SELECT count(*) FROM signal_topic_atomic_groups WHERE consolidation_run_id=e.numeric_run_id)<>s.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_catalog_coverage_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_catalog_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_stage_catalog_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_catalog_guard_v2();

CREATE FUNCTION signal_topic_editorial_global_stage_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;g signal_topic_editorial_global_stages_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;spent bigint;daily_spent bigint;expected bigint;prior signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
 envelope jsonb;cost bigint;request_body text;max_tokens integer;new_send boolean;
BEGIN
 SELECT * INTO g FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=g.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=a.policy_version_id AND action='topic_consolidation';
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 IF g.stage_id IS NULL OR g.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR (NEW.workspace_id,NEW.organization_id,NEW.execution_id,NEW.stage_id)
   IS DISTINCT FROM (e.workspace_id,e.organization_id,e.id,g.stage_id)
  OR a.id IS DISTINCT FROM e.processing_admission_id OR a.action IS DISTINCT FROM 'topic_consolidation'
  OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.organization_id IS DISTINCT FROM e.organization_id
  OR a.actor_user_id IS DISTINCT FROM e.actor_user_id OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR owner_row.execution_id IS NULL OR owner_row.policy_version_id IS DISTINCT FROM a.policy_version_id
  OR NEW.budget_date<>a.budget_date OR NEW.budget_timezone<>a.budget_timezone
  OR action_row.provider IS DISTINCT FROM e.provider OR action_row.model IS DISTINCT FROM e.model
  OR e.provider IS DISTINCT FROM 'anthropic' OR e.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514';
 END IF;
 new_send:=TG_OP='INSERT' OR (OLD.status='reserved' AND NEW.status='in_flight');
 IF new_send AND (p.id IS NULL OR p.organization_id<>e.organization_id OR p.status<>'active'
   OR clock_timestamp()<p.valid_from OR clock_timestamp()>=least(p.valid_until,a.admission_not_after,owner_row.send_not_after)
   OR clock_timestamp()>=a.admission_not_after OR clock_timestamp()>=owner_row.send_not_after) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
    OR NEW.settled_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_global_stage_call_invalid' USING ERRCODE='23514'; END IF;
  SELECT r.request_body,r.max_tokens INTO STRICT request_body,max_tokens FROM signal_topic_editorial_global_stage_requests_v2 r WHERE r.id=NEW.request_id AND r.stage_id=NEW.stage_id;
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.retry_of_call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
   IF prior.id IS NULL OR prior.status<>'settled' OR prior.settled_micro_usd<>0 OR prior.observed_micro_usd<>0
    OR (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=NEW.request_id)>=5
    OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      WHERE i.call_id=prior.id AND b.state='imported' AND i.outcome='errored' AND i.validation->>'status'='provider_error'
       AND prior.response_body_private::jsonb->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%') THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_retry_not_allowed' USING ERRCODE='23514';END IF;
  ELSIF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 prior_call WHERE prior_call.request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_retry_identity_required' USING ERRCODE='23514';
  END IF;
  expected:=(octet_length(request_body)::bigint*3+max_tokens::bigint*15+1)/2;
  IF NEW.reserved_micro_usd<>expected THEN RAISE EXCEPTION 'topic_editorial_global_stage_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  spent:=spent+COALESCE((SELECT sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END)
   FROM signal_topic_editorial_global_stage_calls_v2 WHERE execution_id=e.id AND status<>'definitely_not_sent'),0);
  SELECT total_micro_usd INTO daily_spent FROM signal_processing_org_exposure_v1(e.organization_id,a.budget_date,a.budget_timezone);
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR daily_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514'; END IF;
  NEW.reserved_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256) IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256)
  OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status='definitely_not_sent' AND OLD.provider_batch_id IS NULL
   OR OLD.status='in_flight' AND NEW.status IN('submission_unknown','response_persisted','outcome_unknown')
   OR OLD.status='submission_unknown' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_transition_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='in_flight' AND OLD.status='reserved' THEN NEW.sent_at:=clock_timestamp(); END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_invalid' USING ERRCODE='23514'; END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
    JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
      AND b.stage_id=NEW.stage_id AND b.state IN('ended','imported')) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_binding_invalid' USING ERRCODE='23514'; END IF;
  BEGIN cost:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN cost:=NULL; END;
  IF cost IS NULL THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_usage_unresolved' USING ERRCODE='23514'; END IF;
  ELSIF cost>NEW.reserved_micro_usd OR NEW.observed_micro_usd IS DISTINCT FROM cost
    OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM cost THEN
   RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='settled' THEN NEW.settled_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_call_guard_v2 BEFORE INSERT OR UPDATE
 ON signal_topic_editorial_global_stage_calls_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_call_guard_v2();

CREATE FUNCTION signal_topic_editorial_global_stage_batch_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_batch_immutable' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'prepared' OR NEW.provider_batch_id IS NOT NULL OR NEW.provider_receipt_body IS NOT NULL
   OR NEW.manifest_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.manifest_body::jsonb)
   OR NEW.manifest_body::jsonb->>'stage_kind' IS DISTINCT FROM NEW.stage_kind
   OR jsonb_typeof(NEW.manifest_body::jsonb->'items') IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.manifest_body::jsonb->'items') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_manifest_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','rejection_http_status','lease_token',
   'lease_expires_at','next_poll_at','error_code','submitted_at','ended_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','provider_batch_id','provider_receipt_body','provider_receipt_sha256','rejection_http_status','lease_token',
   'lease_expires_at','next_poll_at','error_code','submitted_at','ended_at'])
   OR OLD.provider_batch_id IS NOT NULL AND NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
   OR OLD.provider_receipt_body IS NOT NULL AND ROW(NEW.provider_receipt_body,NEW.provider_receipt_sha256) IS DISTINCT FROM ROW(OLD.provider_receipt_body,OLD.provider_receipt_sha256)
   OR NEW.state<>OLD.state AND NOT(OLD.state='prepared' AND NEW.state='submitting'
      OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','ended','rejected')
      OR OLD.state='in_progress' AND NEW.state IN('in_progress','canceling','ended')
      OR OLD.state='canceling' AND NEW.state IN('canceling','ended')
      OR OLD.state='ended' AND NEW.state='imported') THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_batch_transition_invalid' USING ERRCODE='23514';END IF;
 IF NEW.provider_receipt_body IS NOT NULL AND NEW.provider_receipt_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.provider_receipt_body) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_provider_receipt_invalid' USING ERRCODE='23514';END IF;
 IF OLD.state='prepared' AND NEW.state='submitting' AND (
   jsonb_array_length(NEW.manifest_body::jsonb->'items')<>(SELECT count(*) FROM signal_topic_editorial_global_stage_batch_items_v2 i WHERE i.batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.manifest_body::jsonb->'items') AS entry(value)
     WHERE NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
       JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.id=i.request_id AND r.stage_id=i.stage_id
       WHERE i.batch_id=NEW.id AND i.custom_id=entry.value->>'custom_id' AND i.call_identity=entry.value->>'call_id'
        AND r.stage_identity=entry.value->>'stage_identity' AND r.request_digest=entry.value->>'request_digest'
        AND r.stage_kind=NEW.stage_kind AND r.state='prepared'))
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
     WHERE i.batch_id=NEW.id AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 c
       WHERE c.id=i.call_id AND c.request_id=i.request_id AND c.stage_id=i.stage_id AND c.status='reserved'))
 ) THEN RAISE EXCEPTION 'topic_editorial_global_stage_manifest_binding_invalid' USING ERRCODE='23514';END IF;
 IF NEW.state='submission_unknown' AND NEW.provider_batch_id IS NOT NULL
   OR NEW.state IN('in_progress','canceling','ended','imported') AND NEW.provider_batch_id IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_provider_identity_missing' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_batch_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_stage_batches_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_batch_guard_v2();

CREATE FUNCTION signal_topic_editorial_global_stage_batch_item_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE req signal_topic_editorial_global_stage_requests_v2%ROWTYPE;call_row signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['outcome','raw_text','raw_sha256','validation','validation_sha256','received_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','raw_text','raw_sha256','validation','validation_sha256','received_at'])
   OR OLD.raw_text IS NOT NULL AND ROW(NEW.raw_text,NEW.raw_sha256) IS DISTINCT FROM ROW(OLD.raw_text,OLD.raw_sha256)
   OR OLD.validation IS NOT NULL AND ROW(NEW.validation,NEW.validation_sha256) IS DISTINCT FROM ROW(OLD.validation,OLD.validation_sha256)
   OR NEW.raw_text IS NOT NULL AND (NEW.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.raw_text)
     OR NEW.outcome IS NULL OR NEW.received_at IS NULL)
   OR NEW.validation IS NOT NULL AND (NEW.validation_sha256 IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.validation) OR NEW.raw_text IS NULL) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO req FROM signal_topic_editorial_global_stage_requests_v2 WHERE id=NEW.request_id AND stage_id=NEW.stage_id;
 SELECT * INTO call_row FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
 IF req.id IS NULL OR call_row.id IS NULL OR req.custom_id<>NEW.custom_id OR
   (req.call_identity<>NEW.call_identity AND call_row.retry_of_call_id IS NULL) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_stage_batch_item_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_stage_batch_items_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_stage_batch_item_guard_v2();

CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0176_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 editorial AS(SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE status='settled'),0)::bigint confirmed,
   COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status NOT IN('settled','outcome_unknown','submission_unknown')),0)::bigint reserved,
   COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status IN('outcome_unknown','submission_unknown')),0)::bigint ambiguous
   FROM signal_topic_editorial_calls WHERE organization_id=target_org AND budget_date=target_day AND status<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='topic_editorial' AND id=excluded_id,false)),
 staged AS(SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE status='settled'),0)::bigint confirmed,
   COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status NOT IN('settled','outcome_unknown','submission_unknown')),0)::bigint reserved,
   COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status IN('outcome_unknown','submission_unknown')),0)::bigint ambiguous
   FROM signal_topic_editorial_global_stage_calls_v2 WHERE organization_id=target_org AND budget_date=target_day AND status<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='topic_editorial_global_stage' AND id=excluded_id,false))
 SELECT old.confirmed_micro_usd+editorial.confirmed+staged.confirmed,old.reserved_micro_usd+editorial.reserved+staged.reserved,
  old.ambiguous_micro_usd+editorial.ambiguous+staged.ambiguous,
  old.total_micro_usd+editorial.confirmed+editorial.reserved+editorial.ambiguous+staged.confirmed+staged.reserved+staged.ambiguous
 FROM old,editorial,staged
$$;
REVOKE ALL ON FUNCTION signal_topic_editorial_global_stage_call_guard_v2(),signal_topic_editorial_global_stage_guard_v2(),
 signal_topic_editorial_global_stage_request_guard_v2(),signal_topic_editorial_global_stage_catalog_guard_v2(),
 signal_topic_editorial_global_stage_batch_guard_v2(),signal_topic_editorial_global_stage_batch_item_guard_v2() FROM PUBLIC;
REVOKE ALL ON TABLE signal_topic_editorial_global_stages_v2,signal_topic_editorial_global_stage_requests_v2,
 signal_topic_editorial_global_stage_calls_v2,signal_topic_editorial_global_stage_batches_v2,
 signal_topic_editorial_global_stage_batch_items_v2,signal_topic_editorial_global_stage_catalog_v2 FROM PUBLIC;
