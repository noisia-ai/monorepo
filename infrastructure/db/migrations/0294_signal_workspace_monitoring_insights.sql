-- Native aggregate monthly editorial. Installation creates no opt-in, policy,
-- admission, provider request or spend. Existing owner/call history is unchanged.
ALTER TABLE signal_workspace_features DROP CONSTRAINT signal_workspace_features_feature_check;
ALTER TABLE signal_workspace_features ADD CONSTRAINT signal_workspace_features_feature_check
 CHECK(feature IN('mention_facets','concept_membership','mfp_discovery','mass_labeling','monitoring_insights'));
-- Workspace-owned mass classification. Installation creates no policy, activation or spend.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings','topic_fit',
 'topic_interpretation','topic_fit_incremental','topic_interpretation_incremental','topic_consolidation',
 'topic_consolidation_numeric','interest_decision','mention_facets','concept_membership',
 'concept_membership_jev','concept_membership_claude','mass_labeling_jev','monitoring_insights'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric')
  AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
  action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation','interest_decision','monitoring_insights')
    AND provider='anthropic' AND model='claude-sonnet-4-6'
  OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large'
  OR action IN('mention_facets','concept_membership') AND
    (provider='anthropic' AND model='claude-sonnet-5-5' OR provider='typesafe' AND model IN('jev-latest','jev-1.13.0'))
  OR action IN('concept_membership_jev','mass_labeling_jev') AND provider='typesafe' AND model='jev-1.13.0'
  OR action='concept_membership_claude' AND provider='anthropic' AND model='claude-sonnet-5-5')));


CREATE FUNCTION signal_monitoring_insights_configuration_v1(target_workspace uuid) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT '{"contract_version":"signal-workspace-monitoring-insights-config-v1","locales":["es-MX","en-US"],"conversation_segments":["all","conversation","advertising","hashtags"],"provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:1fab044cbe6f32c559da85db82717e2a71736a6baa43338a4bc90d479544fe41","schema_digest":"sha256:8f0d73a4e2e5459f51127b650c4b09dd634f31422b117fa5b4a9b28ab36d9956","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"pricing_source":"https://platform.claude.com/docs/en/about-claude/pricing","model_source":"https://platform.claude.com/docs/en/models/sonnet-4-6/overview","max_output_tokens":2048,"max_request_bytes":32768}'::jsonb||jsonb_build_object('workspace_id',target_workspace) $$;
-- Indexed private identity read: a new map/catalog generation invalidates a
-- cached packet even when no corpus revision or selection row was changed.
CREATE FUNCTION signal_monitoring_insights_map_identity_v1(target_workspace uuid) RETURNS text
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
  'selection',(SELECT to_jsonb(s) FROM signal_mass_labeling_selections s WHERE workspace_id=target_workspace),
  'maps',COALESCE((SELECT jsonb_agg(jsonb_build_array(m.id,m.map_digest,m.source_engine_execution_id,m.input_revision,
    e.status,e.generation_id,e.request_digest) ORDER BY m.created_at,m.id)
   FROM signal_mass_labeling_maps m JOIN signal_topic_catalog_executions e ON e.id=m.source_engine_execution_id
   WHERE m.workspace_id=target_workspace),'[]'::jsonb))) $$;
CREATE TABLE signal_monitoring_insight_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,admission_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_intent_digest text NOT NULL CHECK(request_intent_digest~'^sha256:[0-9a-f]{64}$'),
 packet jsonb NOT NULL CHECK(jsonb_typeof(packet)='object' AND octet_length(packet::text)<=262144),
 packet_digest text NOT NULL CHECK(packet_digest~'^sha256:[0-9a-f]{64}$'),scope_digest text NOT NULL CHECK(scope_digest~'^sha256:[0-9a-f]{64}$'),
 configuration jsonb NOT NULL,request_body text NOT NULL CHECK(octet_length(request_body)<=32768),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 budget_cap_micro_usd bigint NOT NULL CHECK(budget_cap_micro_usd BETWEEN 1 AND 2000000),
 reservation_micro_usd bigint NOT NULL CHECK(reservation_micro_usd BETWEEN 1 AND budget_cap_micro_usd),
 source_proof jsonb NOT NULL CHECK(jsonb_typeof(source_proof)='object'),source_not_after timestamptz,
 input_revision bigint NOT NULL,input_token_upper_bound bigint NOT NULL CHECK(input_token_upper_bound>0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','outcome_unknown')),
 execution_token uuid,execution_expires_at timestamptz,
 dispatch_status text NOT NULL DEFAULT 'pending' CHECK(dispatch_status IN('pending','dispatching','dispatched')),
 dispatch_token uuid,dispatch_expires_at timestamptz,dispatch_attempts int NOT NULL DEFAULT 0 CHECK(dispatch_attempts>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 result jsonb,result_call_id uuid,error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),UNIQUE(admission_id),
 FOREIGN KEY(workspace_id,admission_id) REFERENCES signal_processing_admissions(workspace_id,id) ON DELETE RESTRICT,
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),
 CHECK((dispatch_token IS NULL)=(dispatch_expires_at IS NULL)),
 CHECK((result IS NULL)=(result_call_id IS NULL)),
 CHECK(status<>'completed' OR result IS NOT NULL AND completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX monitoring_insight_one_active ON signal_monitoring_insight_runs(workspace_id) WHERE status IN('queued','running');
CREATE INDEX monitoring_insight_recent ON signal_monitoring_insight_runs(workspace_id,created_at DESC,id DESC);
CREATE INDEX monitoring_insight_dispatch ON signal_monitoring_insight_runs(dispatch_status,available_at,id) WHERE status IN('queued','running');
CREATE TABLE signal_monitoring_insight_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,run_id uuid NOT NULL,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 packet_digest text NOT NULL,request_digest text NOT NULL,attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','in_flight','response_persisted','settled','outcome_unknown','definitely_not_sent')),
 budget_date date NOT NULL,budget_timezone text NOT NULL,reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
 settled_micro_usd bigint CHECK(settled_micro_usd>=0),usage jsonb,
 response_body bytea CHECK(octet_length(response_body)<=2097152),response_sha256 text,response_http_status int CHECK(response_http_status BETWEEN 100 AND 599),
 response_complete boolean,provider_request_id text CHECK(length(provider_request_id)<=200),error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,settled_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(run_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_monitoring_insight_runs(workspace_id,id) ON DELETE RESTRICT,
 CHECK((response_body IS NULL)=(response_sha256 IS NULL)),
 CHECK(response_sha256 IS NULL OR response_sha256='sha256:'||encode(sha256(response_body),'hex')),
 CHECK((state='settled')=(settled_micro_usd IS NOT NULL)),
 CHECK(state<>'settled' OR response_body IS NOT NULL AND response_complete AND usage IS NOT NULL AND settled_at IS NOT NULL)
);
-- A definitely-unsent local failure may be explicitly admitted again. A paid,
-- reserved or uncertain physical request can never be duplicated by a new key.
CREATE UNIQUE INDEX monitoring_insight_packet_once ON signal_monitoring_insight_calls(workspace_id,packet_digest)
 WHERE state<>'definitely_not_sent';
CREATE INDEX monitoring_insight_calls_budget ON signal_monitoring_insight_calls(organization_id,budget_date);
ALTER TABLE signal_monitoring_insight_runs ADD CONSTRAINT monitoring_insight_result_call
 FOREIGN KEY(workspace_id,result_call_id) REFERENCES signal_monitoring_insight_calls(workspace_id,id) ON DELETE RESTRICT;

CREATE FUNCTION guard_signal_monitoring_insight_admission_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT signal_processing_actor_v1(NEW.workspace_id,NEW.actor_user_id)
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND primary_role IN('noisia_admin','analyst') AND status='active')
  OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='monitoring_insights')
  OR NEW.configuration IS DISTINCT FROM signal_monitoring_insights_configuration_v1(NEW.workspace_id)
  OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd NOT BETWEEN 1 AND 2000000 OR NEW.automatic THEN
  RAISE EXCEPTION 'monitoring_insights_admission_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER monitoring_insight_admission BEFORE INSERT ON signal_processing_admissions
 FOR EACH ROW WHEN(NEW.action='monitoring_insights') EXECUTE FUNCTION guard_signal_monitoring_insight_admission_v1();

CREATE FUNCTION guard_signal_monitoring_insight_owner_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE a signal_processing_admissions%ROWTYPE;c signal_monitoring_insight_calls%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'monitoring_insights_history_retained' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO a FROM signal_processing_admissions WHERE id=NEW.admission_id;
  IF a.id IS NULL OR ROW(a.workspace_id,a.actor_user_id,a.target_id,a.action,a.request_digest,a.execution_cap_micro_usd,a.configuration)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.actor_user_id,NEW.id,'monitoring_insights'::text,NEW.request_intent_digest,NEW.budget_cap_micro_usd,NEW.configuration)
   OR NEW.configuration IS DISTINCT FROM signal_monitoring_insights_configuration_v1(NEW.workspace_id)
   OR NEW.packet->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
   OR NEW.packet->>'contract_version' IS DISTINCT FROM 'signal-workspace-monitoring-insight-packet-v1'
   OR NOT COALESCE(NEW.packet->>'scope_segment'=ANY(ARRAY['all','conversation','advertising','hashtags']),false)
   OR NOT COALESCE(NEW.packet->>'locale'=ANY(ARRAY['es-MX','en-US']),false)
   OR NEW.input_revision IS DISTINCT FROM (SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=NEW.workspace_id)
   OR NEW.source_proof->>'input_revision' IS DISTINCT FROM NEW.input_revision::text
   OR NEW.source_proof->>'metadata_revision' IS DISTINCT FROM (SELECT revision::text FROM signal_monitoring_insight_input_state WHERE workspace_id=NEW.workspace_id)
   OR NEW.source_proof->>'map_identity' IS DISTINCT FROM signal_monitoring_insights_map_identity_v1(NEW.workspace_id)
   OR NEW.source_not_after<=clock_timestamp()
   OR NEW.input_token_upper_bound<>octet_length(NEW.request_body)*4+8192
   OR NEW.reservation_micro_usd<>(NEW.input_token_upper_bound*3000000+2048::bigint*15000000+999999)/1000000
   OR NEW.request_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object('request_body',NEW.request_body,'configuration',NEW.configuration)) THEN
   RAISE EXCEPTION 'monitoring_insights_owner_invalid' USING ERRCODE='23514'; END IF;
  PERFORM signal_processing_capacity_v1(NEW.workspace_id,NEW.actor_user_id,NEW.id,NEW.admission_id,
   ARRAY['monitoring_insights'],'anthropic','claude-sonnet-4-6',NEW.configuration,NEW.budget_cap_micro_usd);
 ELSIF (to_jsonb(NEW)-ARRAY['status','execution_token','execution_expires_at','dispatch_status','dispatch_token','dispatch_expires_at',
   'dispatch_attempts','available_at','result','result_call_id','error_code','updated_at','completed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','execution_token','execution_expires_at','dispatch_status','dispatch_token','dispatch_expires_at',
   'dispatch_attempts','available_at','result','result_call_id','error_code','updated_at','completed_at'])
  OR OLD.status='completed' AND NEW IS DISTINCT FROM OLD
  OR OLD.result IS NOT NULL AND (NEW.result IS DISTINCT FROM OLD.result OR NEW.result_call_id IS DISTINCT FROM OLD.result_call_id) THEN
  RAISE EXCEPTION 'monitoring_insights_owner_immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.result IS NOT NULL THEN
  SELECT * INTO c FROM signal_monitoring_insight_calls WHERE id=NEW.result_call_id AND workspace_id=NEW.workspace_id AND run_id=NEW.id;
  IF c.id IS NULL OR c.state<>'settled' OR c.packet_digest<>NEW.packet_digest OR NEW.result->>'candidate_hash' IS DISTINCT FROM NEW.packet_digest THEN
   RAISE EXCEPTION 'monitoring_insights_result_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER monitoring_insight_owner BEFORE INSERT OR UPDATE OR DELETE ON signal_monitoring_insight_runs
 FOR EACH ROW EXECUTE FUNCTION guard_signal_monitoring_insight_owner_v1();

CREATE FUNCTION assert_signal_monitoring_insight_admission_owner_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_monitoring_insight_runs r WHERE r.id=NEW.target_id AND r.workspace_id=NEW.workspace_id
  AND r.actor_user_id=NEW.actor_user_id AND r.admission_id=NEW.id AND r.request_intent_digest=NEW.request_digest) THEN
  RAISE EXCEPTION 'monitoring_insights_owner_required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER monitoring_insight_admission_owner AFTER INSERT ON signal_processing_admissions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.action='monitoring_insights')
 EXECUTE FUNCTION assert_signal_monitoring_insight_admission_owner_v1();

-- Retain the complete historical exposure query, adding only this new ledger.
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
WITH prior(confirmed_micro_usd,reserved_micro_usd,ambiguous_micro_usd,total_micro_usd) AS (

 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0221_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 fresh AS(SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'
   OR c.status='failed' AND c.settled_micro_usd IS NOT NULL),0)::bigint confirmed,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::bigint reserved,
 (COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)+COALESCE(sum(c.terminal_exposure_micro_usd),0))::bigint ambiguous
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
 WHERE w.organization_id=target_org AND c.budget_date=target_day AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false))
 SELECT old.confirmed_micro_usd+fresh.confirmed,old.reserved_micro_usd+fresh.reserved,old.ambiguous_micro_usd+COALESCE(fresh.ambiguous,0),
 old.total_micro_usd+fresh.confirmed+fresh.reserved+COALESCE(fresh.ambiguous,0) FROM old,fresh
 
), monthly AS (
 SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE state='settled'),0)::bigint confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE state IN('reserved','in_flight','response_persisted')),0)::bigint reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE state='outcome_unknown'),0)::bigint ambiguous
 FROM signal_monitoring_insight_calls WHERE organization_id=target_org AND budget_date=target_day
  AND NOT COALESCE(excluded_ledger='monitoring_insights' AND id=excluded_id,false)
)
SELECT prior.confirmed_micro_usd+monthly.confirmed,prior.reserved_micro_usd+monthly.reserved,
 prior.ambiguous_micro_usd+monthly.ambiguous,prior.total_micro_usd+monthly.confirmed+monthly.reserved+monthly.ambiguous FROM prior,monthly
$$;

CREATE FUNCTION signal_monitoring_insights_capacity_v1(target_run uuid,excluded_call uuid,amount bigint,reserved_time timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_monitoring_insight_runs%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;day date;spent bigint;run_spent bigint;
BEGIN
 SELECT * INTO r FROM signal_monitoring_insight_runs WHERE id=target_run;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=r.admission_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 IF r.id IS NULL OR a.id IS NULL THEN RAISE EXCEPTION 'monitoring_insights_authority_invalid' USING ERRCODE='23514'; END IF;
 -- Reuse the common policy/date/actor/config checks and lock order. No fake engine
 -- ledger is supplied; this action performs its own exact run sum below.
 PERFORM signal_processing_capacity_v1(r.workspace_id,r.actor_user_id,r.id,r.admission_id,
  ARRAY['monitoring_insights'],'anthropic','claude-sonnet-4-6',r.configuration,r.budget_cap_micro_usd,
  NULL,NULL,0,reserved_time);
 -- Common capacity has locked the actor/workspace (including timezone). Match
 -- the application order before reading source facts: input, epoch, then owner.
 PERFORM workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=r.workspace_id FOR UPDATE;
 PERFORM workspace_id FROM signal_monitoring_insight_input_state WHERE workspace_id=r.workspace_id FOR UPDATE;
 SELECT * INTO r FROM signal_monitoring_insight_runs WHERE id=target_run FOR UPDATE;
 IF r.id IS NULL OR a.id IS NULL OR r.status<>'running' OR NOT COALESCE(r.execution_expires_at>clock_timestamp(),false)
  OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='monitoring_insights')
  OR r.source_proof->>'input_revision' IS DISTINCT FROM (SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=r.workspace_id)
  OR r.source_proof->>'metadata_revision' IS DISTINCT FROM (SELECT revision::text FROM signal_monitoring_insight_input_state WHERE workspace_id=r.workspace_id)
  OR r.source_proof->>'map_identity' IS DISTINCT FROM signal_monitoring_insights_map_identity_v1(r.workspace_id)
  OR r.source_proof->>'timezone' IS DISTINCT FROM (SELECT timezone FROM signal_workspaces WHERE id=r.workspace_id)
  OR r.source_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'monitoring_insights_authority_invalid' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 SELECT COALESCE(sum(CASE WHEN state='settled' THEN settled_micro_usd WHEN state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
  INTO run_spent FROM signal_monitoring_insight_calls WHERE run_id=r.id AND id<>excluded_call;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(a.organization_id,day,p.budget_timezone,'monitoring_insights',excluded_call);
 IF amount<=0 OR run_spent+amount>r.budget_cap_micro_usd OR run_spent+amount>a.execution_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 IF spent+amount>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION signal_monitoring_insight_usage_cost_v1(usage jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(usage)<>'object' OR NOT COALESCE((usage->>'input_tokens')~'^[0-9]+$',false)
  OR NOT COALESCE((usage->>'output_tokens')~'^[0-9]+$',false)
  OR COALESCE((usage->>'cache_read_input_tokens')::numeric,0)<>0
  OR COALESCE((usage->>'cache_creation_input_tokens')::numeric,0)<>0
  OR COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::numeric,0)<>0 THEN
  RAISE EXCEPTION 'monitoring_insights_usage_invalid' USING ERRCODE='23514'; END IF;
 n:=ceil(((usage->>'input_tokens')::numeric*3000000+(usage->>'output_tokens')::numeric*15000000)/1000000);
 IF n>9007199254740991 THEN RAISE EXCEPTION 'monitoring_insights_usage_invalid' USING ERRCODE='23514'; END IF;
 RETURN n::bigint;
END $$;

CREATE FUNCTION guard_signal_monitoring_insight_call_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_monitoring_insight_runs%ROWTYPE;a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;raw jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'monitoring_insights_history_retained' USING ERRCODE='55000'; END IF;
 -- Lock policy/day before the monetary owner, including direct SQL writes.
 SELECT admission.* INTO a FROM signal_processing_admissions admission JOIN signal_monitoring_insight_runs owner ON owner.admission_id=admission.id WHERE owner.id=NEW.run_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'monitoring_insights_call_scope_invalid' USING ERRCODE='23514'; END IF;
 -- Settlement of an already-sent call remains possible after expiry/revocation,
 -- under its original day lock; only a new reservation/send revalidates authority.
 PERFORM signal_processing_lock_v1(a.organization_id,NEW.budget_date);
 IF TG_OP='INSERT' OR NEW.state='in_flight' AND OLD.state='reserved' THEN
  -- Capacity acquires input/epoch before this owner, matching normal dispatch.
  SELECT * INTO r FROM signal_monitoring_insight_runs WHERE id=NEW.run_id;
 ELSE SELECT * INTO r FROM signal_monitoring_insight_runs WHERE id=NEW.run_id FOR UPDATE; END IF;
 IF ROW(NEW.workspace_id,NEW.organization_id,NEW.packet_digest,NEW.request_digest,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
  IS DISTINCT FROM ROW(r.workspace_id,a.organization_id,r.packet_digest,r.request_digest,r.reservation_micro_usd,a.budget_date,a.budget_timezone) THEN
  RAISE EXCEPTION 'monitoring_insights_call_scope_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'reserved' OR NEW.response_body IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL THEN
   RAISE EXCEPTION 'monitoring_insights_call_invalid' USING ERRCODE='23514'; END IF;
  PERFORM signal_monitoring_insights_capacity_v1(r.id,NEW.id,NEW.reserved_micro_usd,NEW.created_at);
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','settled_micro_usd','usage','response_body','response_sha256','response_http_status','response_complete',
    'provider_request_id','error_code','updated_at','sent_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','settled_micro_usd','usage','response_body','response_sha256','response_http_status','response_complete',
    'provider_request_id','error_code','updated_at','sent_at','settled_at'])
   OR OLD.state IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD
   OR OLD.response_body IS NOT NULL AND ROW(NEW.response_body,NEW.response_sha256,NEW.response_http_status,NEW.response_complete,NEW.provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_body,OLD.response_sha256,OLD.response_http_status,OLD.response_complete,OLD.provider_request_id) THEN
   RAISE EXCEPTION 'monitoring_insights_call_immutable' USING ERRCODE='23514'; END IF;
  IF NOT(NEW.state=OLD.state OR OLD.state='reserved' AND NEW.state IN('in_flight','definitely_not_sent')
   OR OLD.state='in_flight' AND NEW.state IN('response_persisted','outcome_unknown','definitely_not_sent')
   OR OLD.state='response_persisted' AND NEW.state IN('settled','outcome_unknown')
   OR OLD.state='outcome_unknown' AND NEW.state='response_persisted') THEN
   RAISE EXCEPTION 'monitoring_insights_call_transition_invalid' USING ERRCODE='23514'; END IF;
  IF OLD.state='reserved' AND NEW.state='in_flight' THEN
   PERFORM signal_monitoring_insights_capacity_v1(r.id,NEW.id,NEW.reserved_micro_usd,NEW.created_at);
  END IF;
 END IF;
 IF NEW.state='definitely_not_sent' AND (NEW.response_body IS NOT NULL OR NEW.response_sha256 IS NOT NULL
  OR NEW.response_http_status IS NOT NULL OR NEW.response_complete IS NOT NULL OR NEW.usage IS NOT NULL
  OR NEW.provider_request_id IS NOT NULL) THEN
  RAISE EXCEPTION 'monitoring_insights_receipt_cannot_be_unsent' USING ERRCODE='23514'; END IF;
 IF NEW.response_body IS NOT NULL AND NEW.state NOT IN('response_persisted','settled','outcome_unknown') THEN
  RAISE EXCEPTION 'monitoring_insights_receipt_state_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.state IN('response_persisted','settled') AND (NEW.response_body IS NULL OR NOT COALESCE(NEW.response_complete,false)) THEN
  RAISE EXCEPTION 'monitoring_insights_receipt_required' USING ERRCODE='23514'; END IF;
 IF NEW.state='settled' THEN
  raw:=convert_from(NEW.response_body,'UTF8')::jsonb;
  IF COALESCE(NEW.response_http_status<>200 OR raw->>'model'<>'claude-sonnet-4-6' OR raw->>'role'<>'assistant'
   OR NEW.usage IS DISTINCT FROM raw->'usage' OR NEW.settled_micro_usd IS DISTINCT FROM signal_monitoring_insight_usage_cost_v1(NEW.usage),true) THEN
   RAISE EXCEPTION 'monitoring_insights_usage_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER monitoring_insight_call BEFORE INSERT OR UPDATE OR DELETE ON signal_monitoring_insight_calls
 FOR EACH ROW EXECUTE FUNCTION guard_signal_monitoring_insight_call_v1();

ALTER TABLE signal_monitoring_insight_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_monitoring_insight_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_monitoring_insight_runs,signal_monitoring_insight_calls FROM PUBLIC;

-- A private invalidation counter, not a new corpus or classification authority.
-- Provider observations are append-only, but can be superseded without changing
-- the preparation revision. Polling must not rescan their full population.
CREATE TABLE signal_monitoring_insight_input_state (
 workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE signal_monitoring_insight_input_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_monitoring_insight_input_state FROM PUBLIC;
CREATE FUNCTION invalidate_signal_monitoring_insights_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE changed text;
BEGIN
 IF TG_OP='INSERT' THEN changed:='SELECT DISTINCT workspace_id FROM new_rows';
 ELSIF TG_OP='DELETE' THEN changed:='SELECT DISTINCT workspace_id FROM old_rows';
 ELSE changed:='SELECT workspace_id FROM new_rows UNION SELECT workspace_id FROM old_rows'; END IF;
 IF TG_TABLE_NAME='record_feature_values' THEN
  IF TG_OP='INSERT' THEN changed:='SELECT DISTINCT m.workspace_id FROM new_rows f JOIN mentions m ON m.id=f.subject_id WHERE f.subject_type=''mention''';
  ELSIF TG_OP='DELETE' THEN changed:='SELECT DISTINCT m.workspace_id FROM old_rows f JOIN mentions m ON m.id=f.subject_id WHERE f.subject_type=''mention''';
  ELSE changed:='SELECT m.workspace_id FROM new_rows f JOIN mentions m ON m.id=f.subject_id WHERE f.subject_type=''mention'' UNION SELECT m.workspace_id FROM old_rows f JOIN mentions m ON m.id=f.subject_id WHERE f.subject_type=''mention'''; END IF;
 END IF;
 EXECUTE 'INSERT INTO signal_monitoring_insight_input_state(workspace_id,revision)
  SELECT change.workspace_id,1 FROM ('||changed||') change
  JOIN signal_workspace_features feature ON feature.workspace_id=change.workspace_id AND feature.feature=''monitoring_insights''
  ORDER BY change.workspace_id ON CONFLICT(workspace_id) DO UPDATE SET
   revision=signal_monitoring_insight_input_state.revision+1,updated_at=clock_timestamp()';
 RETURN NULL;
END $$;
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['mentions','signal_provider_mention_observations','signal_workspace_features',
  'signal_mass_labeling_overrides','signal_mass_labeling_root_segments','signal_mass_labeling_topic_probabilities',
  'signal_mass_labeling_study_policies','signal_mass_labeling_selections','signal_provenance_policy_bindings',
  'signal_retention_policies','signal_licensing_policies','signal_licensing_policy_usages','import_batches','data_sources',
  'signal_mass_labeling_maps','signal_topic_catalog_executions','signal_classification_generations','analysis_artifacts','signal_corpus_preparation_runs','record_feature_values',
  'signal_labeling_runs','signal_mass_labeling_runs','signal_mass_labeling_results','signal_mass_labeling_default_lexicons',
  'signal_mass_labeling_localizations','signal_mass_labeling_r13_results','signal_mass_labeling_r13_interest_results','signal_mass_labeling_study_interest_results'] LOOP
  -- Alphabetically AFTER existing corpus revision triggers: payment also locks
  -- corpus input_state before this counter. Never introduce the reverse order.
  EXECUTE format('CREATE TRIGGER zz_monitoring_epoch_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
   FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_monitoring_insights_v1()',relation_name);
  EXECUTE format('CREATE TRIGGER zz_monitoring_epoch_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
   FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_monitoring_insights_v1()',relation_name);
  EXECUTE format('CREATE TRIGGER zz_monitoring_epoch_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
   FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_monitoring_insights_v1()',relation_name);
 END LOOP;
END $$;
DO $$ DECLARE signature text;role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['signal_monitoring_insights_map_identity_v1(uuid)','signal_monitoring_insights_configuration_v1(uuid)','guard_signal_monitoring_insight_admission_v1()',
  'guard_signal_monitoring_insight_owner_v1()','assert_signal_monitoring_insight_admission_owner_v1()',
  'signal_monitoring_insights_capacity_v1(uuid,uuid,bigint,timestamptz)','signal_monitoring_insight_usage_cost_v1(jsonb)',
  'guard_signal_monitoring_insight_call_v1()','invalidate_signal_monitoring_insights_v1()'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM '||quote_ident(role_name); END IF;
  END LOOP;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE 'REVOKE ALL ON signal_monitoring_insight_runs,signal_monitoring_insight_calls,signal_monitoring_insight_input_state FROM '||quote_ident(role_name); END IF;
 END LOOP;
END $$;
