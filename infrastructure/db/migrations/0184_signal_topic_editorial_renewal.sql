-- Renew the temporal authority of an existing, partly paid editorial owner.
-- The owner, sealed plan, original admission and every provider receipt remain immutable.
CREATE TABLE signal_topic_editorial_renewals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 budget_date date NOT NULL,
 budget_timezone text NOT NULL,
 admission_not_after timestamptz NOT NULL,
 grant_cap_micro_usd bigint NOT NULL CHECK(grant_cap_micro_usd BETWEEN 1 AND 30000000),
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),
 quote_reference text NOT NULL CHECK(quote_reference~'^v1\.[0-9]{10}\.[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id),
 UNIQUE(execution_id,budget_date),
 UNIQUE(workspace_id,actor_user_id,idempotency_key)
);
CREATE INDEX idx_topic_editorial_renewal_owner ON signal_topic_editorial_renewals(execution_id,budget_date DESC);

CREATE FUNCTION signal_topic_editorial_renewal_quote_v1(target_workspace uuid,target_actor uuid,target_execution uuid,deadline bigint DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;initial_admission signal_processing_admissions%ROWTYPE;
 previous signal_topic_editorial_renewals%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;day date;expiry bigint;run_used bigint;day_used bigint;owner_day_used bigint;
 maximum bigint;body jsonb;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution AND workspace_id=target_workspace;
 IF e.id IS NULL OR e.actor_user_id<>target_actor OR e.status<>'failed' OR e.dispatch_generation>=20
  OR e.execution_token IS NOT NULL OR e.execution_expires_at IS NOT NULL
  OR NOT signal_topic_editorial_plan_valid_v1(e.numeric_run_id,e.plan)
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RETURN '{"status":"owner_unavailable"}'::jsonb;END IF;
 SELECT * INTO initial_admission FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO previous FROM signal_topic_editorial_renewals WHERE execution_id=e.id ORDER BY budget_date DESC LIMIT 1;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=e.organization_id AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN RETURN '{"status":"policy_required"}'::jsonb;END IF;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF action_row.action IS NULL OR action_row.automatic_allowed OR action_row.provider IS DISTINCT FROM 'anthropic'
  OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() THEN
  RETURN '{"status":"policy_action_required"}'::jsonb;END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 IF p.budget_timezone IS DISTINCT FROM initial_admission.budget_timezone
  OR day<COALESCE(previous.budget_date,initial_admission.budget_date)
  OR clock_timestamp()<COALESCE(previous.admission_not_after,initial_admission.admission_not_after) THEN
  RETURN '{"status":"admission_not_expired"}'::jsonb;END IF;
 -- Only one grant may be issued per owner and budget day. A first same-day
 -- renewal is valid after a shorter policy deadline, with prior spend retained.
 IF previous.id IS NOT NULL AND day=previous.budget_date THEN
  RETURN '{"status":"renewal_already_used_today"}'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id
   AND c.status IN('reserved','in_flight','outcome_unknown'))
  OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox o WHERE o.execution_id=e.id AND o.status IN('queued','dispatching')) THEN
  RETURN '{"status":"recovery_required"}'::jsonb;END IF;
 SELECT COALESCE(sum(CASE WHEN c.status='settled' THEN c.settled_micro_usd
   ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END),0)
  INTO run_used FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id AND c.status<>'definitely_not_sent';
 SELECT total_micro_usd INTO day_used FROM signal_processing_org_exposure_v1(e.organization_id,day,p.budget_timezone);
 SELECT COALESCE(sum(CASE WHEN c.status='settled' THEN c.settled_micro_usd
   ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END),0)
  INTO owner_day_used FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id
   AND c.budget_date=day AND c.status<>'definitely_not_sent';
 maximum:=least(e.hard_cap_micro_usd-run_used,p.daily_cap_micro_usd-day_used,action_row.max_execution_micro_usd);
 IF maximum<=0 THEN RETURN '{"status":"budget_unavailable"}'::jsonb;END IF;
 expiry:=COALESCE(deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '5 minutes',p.valid_until,
  ((day+1)::timestamp AT TIME ZONE p.budget_timezone))))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '5 minutes',p.valid_until,
  ((day+1)::timestamp AT TIME ZONE p.budget_timezone)) THEN RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'execution_id',e.id,
  'plan_digest',e.plan_digest,'source_digest',e.source_digest,'policy_id',p.id,'policy_digest',p.policy_digest,
  'configuration_digest',action_row.configuration_digest,'budget_date',day,'budget_timezone',p.budget_timezone,
  'grant_cap_micro_usd',(owner_day_used+maximum)::text,'remaining_micro_usd',maximum::text,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize',
  'quote_reference','v1.'||expiry::text||'.'||substr(signal_semantic_context_digest_json_v2(body),8),
  'quote_expires_at',to_timestamp(expiry));
END;$$;

-- The latest grant supplies authority only for future sends. The original
-- admission remains the source of the owner identity and original receipt.
CREATE OR REPLACE FUNCTION signal_topic_editorial_assert_lease_v1(target_execution uuid,target_token uuid,new_spend boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;initial_admission signal_processing_admissions%ROWTYPE;
 renewal signal_topic_editorial_renewals%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;effective_day date;effective_zone text;deadline timestamptz;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 IF e.id IS NULL OR e.status<>'running' OR e.execution_token IS DISTINCT FROM target_token
  OR e.execution_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'topic_editorial_lease_conflict' USING ERRCODE='23514';END IF;
 IF NOT new_spend THEN RETURN;END IF;
 SELECT * INTO initial_admission FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO renewal FROM signal_topic_editorial_renewals WHERE execution_id=e.id ORDER BY budget_date DESC LIMIT 1;
 effective_day:=COALESCE(renewal.budget_date,initial_admission.budget_date);
 effective_zone:=COALESCE(renewal.budget_timezone,initial_admission.budget_timezone);
 deadline:=COALESCE(renewal.admission_not_after,initial_admission.admission_not_after);
 PERFORM signal_processing_lock_v1(e.organization_id,effective_day);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=COALESCE(renewal.policy_version_id,initial_admission.policy_version_id);
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from
  OR clock_timestamp()>=least(p.valid_until,deadline)
  OR effective_day<>(clock_timestamp() AT TIME ZONE effective_zone)::date
  OR p.budget_timezone IS DISTINCT FROM effective_zone
  OR action_row.action IS NULL OR action_row.automatic_allowed OR action_row.provider IS DISTINCT FROM 'anthropic'
  OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1()
  OR e.organization_id IS DISTINCT FROM (SELECT organization_id FROM signal_workspaces WHERE id=e.workspace_id)
  OR signal_topic_editorial_source_v1(e.numeric_run_id) IS DISTINCT FROM e.source_binding THEN
  RAISE EXCEPTION 'topic_editorial_authority_unavailable' USING ERRCODE='23514';END IF;
END;$$;

CREATE FUNCTION signal_topic_editorial_renewal_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;q jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_editorial_renewal_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_renewal_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||e.organization_id::text,0));
 PERFORM signal_processing_lock_v1(e.organization_id,NEW.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||NEW.workspace_id::text,0));
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id FOR UPDATE;
 q:=signal_topic_editorial_renewal_quote_v1(NEW.workspace_id,NEW.actor_user_id,NEW.execution_id,
  split_part(NEW.quote_reference,'.',2)::bigint);
 IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM NEW.quote_reference
  OR e.organization_id IS DISTINCT FROM NEW.organization_id OR (q->>'policy_id')::uuid IS DISTINCT FROM NEW.policy_version_id
  OR (q->>'budget_date')::date IS DISTINCT FROM NEW.budget_date OR q->>'budget_timezone' IS DISTINCT FROM NEW.budget_timezone
  OR (q->>'grant_cap_micro_usd')::bigint IS DISTINCT FROM NEW.grant_cap_micro_usd
  OR NEW.admission_not_after IS DISTINCT FROM least(
   (SELECT valid_until FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id),
   ((NEW.budget_date+1)::timestamp AT TIME ZONE NEW.budget_timezone))
  OR NEW.request_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'workspace_id',NEW.workspace_id,'actor_user_id',NEW.actor_user_id,'execution_id',NEW.execution_id,
   'quote_reference',NEW.quote_reference,'grant_cap_micro_usd',NEW.grant_cap_micro_usd::text)) THEN
  RAISE EXCEPTION 'topic_editorial_renewal_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER topic_editorial_renewal_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_renewals
 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_renewal_guard_v1();

CREATE FUNCTION renew_signal_topic_editorial_execution_v1(target_workspace uuid,target_actor uuid,target_execution uuid,
 request_key text,expected_quote text,confirmed_cap bigint)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;prior signal_topic_editorial_renewals%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;q jsonb;hash text;day date;new_id uuid:=gen_random_uuid();
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v1\.[0-9]{10}\.[a-f0-9]{64}$',false)
  OR confirmed_cap NOT BETWEEN 1 AND 30000000 THEN RAISE EXCEPTION 'topic_editorial_renewal_invalid' USING ERRCODE='22023';END IF;
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'topic_editorial_renewal_forbidden' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution AND workspace_id=target_workspace;
 IF e.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_renewal_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||e.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=e.organization_id AND status='active';
 IF p.id IS NOT NULL THEN
  day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
  PERFORM signal_processing_lock_v1(e.organization_id,day);
 END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution AND workspace_id=target_workspace FOR UPDATE;
 hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,
  'execution_id',target_execution,'quote_reference',expected_quote,'grant_cap_micro_usd',confirmed_cap::text));
 SELECT * INTO prior FROM signal_topic_editorial_renewals
  WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.execution_id IS DISTINCT FROM target_execution OR prior.request_digest IS DISTINCT FROM hash THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('renewal_id',prior.id,'execution_id',prior.execution_id,'replayed',true);
 END IF;
 q:=signal_topic_editorial_renewal_quote_v1(target_workspace,target_actor,target_execution,
  split_part(expected_quote,'.',2)::bigint);
 IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM expected_quote
  OR (q->>'grant_cap_micro_usd')::bigint IS DISTINCT FROM confirmed_cap THEN
  RAISE EXCEPTION 'topic_editorial_renewal_quote_stale' USING ERRCODE='23514';END IF;
 INSERT INTO signal_topic_editorial_renewals(id,workspace_id,execution_id,organization_id,actor_user_id,
  policy_version_id,budget_date,budget_timezone,admission_not_after,grant_cap_micro_usd,
  idempotency_key,request_digest,quote_reference)
 VALUES(new_id,target_workspace,target_execution,e.organization_id,target_actor,(q->>'policy_id')::uuid,
  (q->>'budget_date')::date,q->>'budget_timezone',least(p.valid_until,
   (((q->>'budget_date')::date+1)::timestamp AT TIME ZONE p.budget_timezone)),confirmed_cap,
  request_key,hash,expected_quote);
 RETURN jsonb_build_object('renewal_id',new_id,'execution_id',target_execution,'replayed',false);
END;$$;


-- Preserve the 0181 known-rejection trigger split; only its normal guard body changes.
CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;renewal signal_topic_editorial_renewals%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;amount bigint;day_amount bigint;org_amount bigint;body jsonb;usage jsonb;cost bigint;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO renewal FROM signal_topic_editorial_renewals WHERE execution_id=e.id ORDER BY budget_date DESC LIMIT 1;
 PERFORM signal_processing_lock_v1(e.organization_id,NEW.budget_date);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 IF ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd)
  IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd)
  OR NOT (ROW(NEW.budget_date,NEW.budget_timezone)=ROW(a.budget_date,a.budget_timezone)
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_renewals grant_row WHERE grant_row.execution_id=e.id
    AND ROW(grant_row.budget_date,grant_row.budget_timezone)=ROW(NEW.budget_date,NEW.budget_timezone))) THEN
  RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF ROW(NEW.budget_date,NEW.budget_timezone) IS DISTINCT FROM
   ROW(COALESCE(renewal.budget_date,a.budget_date),COALESCE(renewal.budget_timezone,a.budget_timezone)) THEN
   RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
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
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=COALESCE(renewal.policy_version_id,a.policy_version_id);
  SELECT total_micro_usd INTO org_amount FROM signal_processing_org_exposure_v1(e.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO day_amount FROM signal_topic_editorial_calls WHERE execution_id=e.id AND budget_date=NEW.budget_date AND status<>'definitely_not_sent';
  IF amount+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_amount+NEW.reserved_micro_usd>p.daily_cap_micro_usd
   OR renewal.id IS NOT NULL AND day_amount+NEW.reserved_micro_usd>renewal.grant_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['response_http_status','response_complete','response_provider_request_id','status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['response_http_status','response_complete','response_provider_request_id','status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'topic_editorial_call_immutable' USING ERRCODE='23514';END IF;
  IF OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
   IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id) THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF NEW.status='in_flight' AND OLD.status='reserved' THEN
   IF ROW(NEW.budget_date,NEW.budget_timezone) IS DISTINCT FROM
    ROW(COALESCE(renewal.budget_date,a.budget_date),COALESCE(renewal.budget_timezone,a.budget_timezone)) THEN
    RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
   PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,true);NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='settled' AND (NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'topic_editorial_receipt_incomplete' USING ERRCODE='23514';END IF;
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

CREATE OR REPLACE FUNCTION reserve_signal_topic_editorial_call_v1(target_execution uuid,target_token uuid,target_request text,provider_available boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;renewal signal_topic_editorial_renewals%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 IF NOT COALESCE(provider_available,false) THEN RAISE EXCEPTION 'topic_editorial_provider_disabled' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO renewal FROM signal_topic_editorial_renewals WHERE execution_id=e.id ORDER BY budget_date DESC LIMIT 1;
 PERFORM signal_processing_lock_v1(e.organization_id,COALESCE(renewal.budget_date,a.budget_date));
 PERFORM signal_topic_editorial_assert_lease_v1(e.id,target_token,true);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE execution_id=e.id AND request_digest=target_request;
 IF r.id IS NULL THEN RAISE EXCEPTION 'topic_editorial_request_missing' USING ERRCODE='23514';END IF;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
 IF c.id IS NULL OR c.status='definitely_not_sent' THEN
  INSERT INTO signal_topic_editorial_calls(workspace_id,organization_id,execution_id,request_id,retry_of_call_id,reserved_micro_usd,budget_date,budget_timezone)
   VALUES(e.workspace_id,e.organization_id,e.id,r.id,c.id,r.reserved_micro_usd,
    COALESCE(renewal.budget_date,a.budget_date),COALESCE(renewal.budget_timezone,a.budget_timezone)) RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('call_id',c.id,'attempt_token',c.attempt_token,'status',c.status,'reserved_micro_usd',c.reserved_micro_usd::text);
END;$$;

CREATE OR REPLACE FUNCTION mark_sent_signal_topic_editorial_call_v1(target_call uuid,target_attempt uuid,target_execution_token uuid,provider_available boolean DEFAULT false)
 RETURNS boolean LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;renewal signal_topic_editorial_renewals%ROWTYPE;
BEGIN
 IF NOT COALESCE(provider_available,false) THEN RAISE EXCEPTION 'topic_editorial_provider_disabled' USING ERRCODE='23514';END IF;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=c.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO renewal FROM signal_topic_editorial_renewals WHERE execution_id=e.id ORDER BY budget_date DESC LIMIT 1;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 IF ROW(c.budget_date,c.budget_timezone) IS DISTINCT FROM
  ROW(COALESCE(renewal.budget_date,a.budget_date),COALESCE(renewal.budget_timezone,a.budget_timezone)) THEN
  RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
 PERFORM signal_topic_editorial_assert_lease_v1(c.execution_id,target_execution_token,true);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status<>'reserved' THEN
  RAISE EXCEPTION 'topic_editorial_call_not_sendable' USING ERRCODE='23514';END IF;
 UPDATE signal_topic_editorial_calls SET status='in_flight' WHERE id=c.id;RETURN true;
END;$$;

ALTER TABLE signal_topic_editorial_renewals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_topic_editorial_renewals FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_renewal_quote_v1(uuid,uuid,uuid,bigint),
 signal_topic_editorial_renewal_guard_v1(),renew_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text,text,bigint)
 FROM PUBLIC;
DO $$DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_topic_editorial_renewals FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_renewal_quote_v1(uuid,uuid,uuid,bigint), signal_topic_editorial_renewal_guard_v1(), renew_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text,text,bigint) FROM %I',role_name);
  END IF;
 END LOOP;
END;$$;
