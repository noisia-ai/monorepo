-- Explicit Stage1 DNC renewal. Original admission, receipt, run identity and
-- reservation stay immutable. No policy, provider call or reservation is created.
CREATE TABLE signal_brand_context_semantic_renewals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 parent_receipt_id uuid NOT NULL REFERENCES signal_brand_context_processing_receipts(id) ON DELETE RESTRICT,
 admission_id uuid NOT NULL REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT,
 run_id uuid NOT NULL REFERENCES signal_semantic_context_proposal_runs(id) ON DELETE RESTRICT,
 reservation_id uuid NOT NULL REFERENCES signal_semantic_context_budget_reservations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 generation_id uuid NOT NULL REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT,
 supersedes_renewal_id uuid REFERENCES signal_brand_context_semantic_renewals(id) ON DELETE RESTRICT,
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id) ON DELETE RESTRICT,
 budget_date date NOT NULL,budget_timezone text NOT NULL,admission_not_after timestamptz NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 quote_digest text NOT NULL CHECK(quote_digest~'^sha256:[0-9a-f]{64}$'),
 quote_snapshot jsonb NOT NULL CHECK(jsonb_typeof(quote_snapshot)='object' AND pg_column_size(quote_snapshot)<=32768),
 confirmation text NOT NULL CHECK(confirmation='renew_brand_context_semantic_within_shown_cap'),
 receipt_digest text NOT NULL CHECK(receipt_digest~'^sha256:[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_bc_semantic_renewal_request UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CONSTRAINT uq_bc_semantic_renewal_successor UNIQUE(supersedes_renewal_id)
);
CREATE UNIQUE INDEX uq_bc_semantic_renewal_first ON signal_brand_context_semantic_renewals(parent_receipt_id)
 WHERE supersedes_renewal_id IS NULL;
CREATE INDEX idx_bc_semantic_renewal_reservation ON signal_brand_context_semantic_renewals(reservation_id,created_at DESC);
ALTER TABLE signal_brand_context_semantic_renewals ENABLE ROW LEVEL SECURITY;

-- Read-only quote is not an authorization. The mutator recomputes it under
-- semantic -> policy -> day -> actor locks. NOWAIT owner locks prevent a cycle
-- with a legacy sender holding this owner while waiting for the policy lock.
CREATE FUNCTION signal_brand_context_semantic_renewal_lock_v1(parent_id uuid,target_actor uuid,take_owner boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_brand_context_processing_receipts%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_id AND actor_user_id=target_actor;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||parent.workspace_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||parent.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=parent.organization_id AND status='active';
 PERFORM signal_processing_lock_v1(parent.organization_id,CASE WHEN p.id IS NULL THEN parent.budget_date
  ELSE (clock_timestamp() AT TIME ZONE p.budget_timezone)::date END);
 PERFORM signal_brand_context_processing_lock_actor_v1(parent.workspace_id,target_actor);
 IF (SELECT organization_id FROM signal_workspaces WHERE id=parent.workspace_id) IS DISTINCT FROM parent.organization_id THEN
  RAISE EXCEPTION 'processing_scope_invalid' USING ERRCODE='23514'; END IF;
 IF take_owner THEN
 PERFORM id FROM signal_semantic_context_proposal_runs WHERE id=parent.semantic_run_id FOR UPDATE NOWAIT;
 PERFORM id FROM signal_semantic_context_budget_reservations WHERE run_id=parent.semantic_run_id FOR UPDATE NOWAIT;
 PERFORM id FROM signal_semantic_context_proposal_outbox WHERE run_id=parent.semantic_run_id FOR UPDATE NOWAIT;
 END IF;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'brand_context_semantic_renewal_busy' USING ERRCODE='55P03';
END; $$;

CREATE FUNCTION quote_signal_brand_context_semantic_renewal_v1(parent_id uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_brand_context_processing_receipts%ROWTYPE;run signal_semantic_context_proposal_runs%ROWTYPE;
 admission signal_processing_admissions%ROWTYPE;reservation signal_semantic_context_budget_reservations%ROWTYPE;
 outbox signal_semantic_context_proposal_outbox%ROWTYPE;prior signal_brand_context_semantic_renewals%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 instant timestamptz:=clock_timestamp();day date;spent bigint;snapshot jsonb;quote_end timestamptz;
BEGIN
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_id AND actor_user_id=target_actor;
 IF parent.id IS NULL OR NOT signal_brand_context_processing_actor_v1(parent.workspace_id,target_actor) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO run FROM signal_semantic_context_proposal_runs WHERE id=parent.semantic_run_id;
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=parent.semantic_admission_id;
 SELECT * INTO reservation FROM signal_semantic_context_budget_reservations WHERE run_id=run.id;
 SELECT * INTO outbox FROM signal_semantic_context_proposal_outbox WHERE run_id=run.id;
 SELECT * INTO prior FROM signal_brand_context_semantic_renewals r WHERE r.parent_receipt_id=parent.id
  AND NOT EXISTS(SELECT 1 FROM signal_brand_context_semantic_renewals s WHERE s.supersedes_renewal_id=r.id);
 IF NOT COALESCE(run.status='failed' AND run.provider_call_state='not_started' AND run.provider_call_count=0
  AND run.provider_response_private IS NULL AND run.provider_response_digest IS NULL AND run.provider_request_id IS NULL
  AND run.input_tokens IS NULL AND run.output_tokens IS NULL AND run.settled_micro_usd IS NULL
  AND run.appended_operation_id IS NULL AND run.result_digest IS NULL AND run.validated_output_digest IS NULL
  AND COALESCE(run.proposal_count,0)=0 AND run.lease_token IS NULL AND run.lease_expires_at IS NULL
  AND run.workspace_id=parent.workspace_id AND run.generation_id=parent.generation_id AND run.created_by_user_id=target_actor
  AND run.processing_admission_id=admission.id AND run.brand_context_preparation_operation_id IS NULL
  AND admission.brand_context_processing_receipt_id=parent.id AND admission.action='brand_context_proposal'
  AND admission.target_id=run.id AND admission.actor_user_id=target_actor AND admission.workspace_id=parent.workspace_id
  AND admission.organization_id=parent.organization_id AND admission.brand_id=parent.brand_id
  AND reservation.status='reserved' AND reservation.workspace_id=parent.workspace_id
  AND reservation.processing_organization_id=parent.organization_id AND reservation.reservation_micro_usd=run.reservation_micro_usd
  AND outbox.workspace_id=parent.workspace_id AND outbox.status IN('pending','failed','dispatched','dispatching')
  AND (outbox.lease_token IS NULL OR outbox.lease_expires_at<=instant),false) THEN
  RAISE EXCEPTION 'brand_context_semantic_run_not_renewable' USING ERRCODE='23514'; END IF;
 IF instant<COALESCE(prior.admission_not_after,admission.admission_not_after) THEN
  RAISE EXCEPTION 'brand_context_semantic_authorization_not_expired' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_processing_source_current_v1(parent.generation_id)
  OR NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations g WHERE g.id=parent.generation_id AND g.status='draft'
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations child WHERE child.supersedes_generation_id=g.id)) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM signal_brand_context_semantic_renewals WHERE run_id=run.id)
  +(SELECT count(*) FROM signal_governance_control_operations WHERE workspace_id=parent.workspace_id
   AND action='retry-semantic-context-proposal-run' AND status='completed' AND result->>'run_id'=run.id::text)>=8 THEN
  RAISE EXCEPTION 'brand_context_semantic_retry_limit' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=parent.organization_id AND status='active';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='brand_context_proposal';
 IF p.id IS NULL OR instant<p.valid_from OR instant>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 IF a.kind IS DISTINCT FROM 'provider' OR a.provider IS DISTINCT FROM admission.provider OR a.model IS DISTINCT FROM admission.model
  OR a.configuration IS DISTINCT FROM admission.configuration OR a.configuration_digest IS DISTINCT FROM admission.configuration_digest
  OR a.max_execution_micro_usd IS DISTINCT FROM admission.execution_cap_micro_usd
  OR run.hard_cap_micro_usd IS DISTINCT FROM admission.execution_cap_micro_usd
  OR p.budget_timezone IS DISTINCT FROM admission.budget_timezone
  OR (SELECT organization_id FROM signal_workspaces WHERE id=parent.workspace_id) IS DISTINCT FROM parent.organization_id THEN
  RAISE EXCEPTION 'brand_context_semantic_policy_incompatible' USING ERRCODE='23514'; END IF;
 day:=(instant AT TIME ZONE p.budget_timezone)::date;
 -- Exclude the SAME reservation before imputing it to this authorization day.
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(parent.organization_id,day,p.budget_timezone,'semantic',reservation.id);
 IF spent+reservation.reservation_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 quote_end:=least(to_timestamp(floor(extract(epoch FROM instant)/300)*300)+interval '5 minutes',p.valid_until,
  ((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 snapshot:=jsonb_build_object('contract_version','brand-context-semantic-renewal-authority-v1',
  'parent_receipt_id',parent.id,'parent_receipt_digest',parent.receipt_digest,'workspace_id',parent.workspace_id,
  'organization_id',parent.organization_id,'actor_user_id',target_actor,'generation_id',parent.generation_id,
  'source_authority_digest',parent.source_authority_digest,'admission_id',admission.id,'admission_digest',admission.receipt_digest,
  'run_id',run.id,'reservation_id',reservation.id,'reservation_snapshot_digest',signal_semantic_context_digest_json_v2(to_jsonb(reservation)),
  'reservation_micro_usd',reservation.reservation_micro_usd::text,'execution_cap_micro_usd',run.hard_cap_micro_usd::text,
  'supersedes_renewal_id',prior.id,'policy_version_id',p.id,'policy_digest',p.policy_digest,'configuration',a.configuration,
  'configuration_digest',a.configuration_digest,'budget_date',day,'budget_timezone',p.budget_timezone,
  'admission_not_after',least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)),
  'quote_expires_at',quote_end,'available_today_micro_usd',(p.daily_cap_micro_usd-spent-reservation.reservation_micro_usd)::text);
 RETURN jsonb_build_object('quote_digest',signal_semantic_context_digest_json_v2(snapshot),'quote_snapshot',snapshot);
END; $$;

CREATE FUNCTION validate_signal_brand_context_semantic_renewal_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE quoted jsonb;s jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'brand_context_semantic_renewal_immutable' USING ERRCODE='23514'; END IF;
 PERFORM signal_brand_context_semantic_renewal_lock_v1(NEW.parent_receipt_id,NEW.actor_user_id);
 quoted:=quote_signal_brand_context_semantic_renewal_v1(NEW.parent_receipt_id,NEW.actor_user_id);s:=quoted->'quote_snapshot';
 IF NEW.quote_snapshot IS DISTINCT FROM s OR NEW.quote_digest IS DISTINCT FROM quoted->>'quote_digest'
  OR NEW.workspace_id IS DISTINCT FROM (s->>'workspace_id')::uuid OR NEW.organization_id IS DISTINCT FROM (s->>'organization_id')::uuid
  OR NEW.generation_id IS DISTINCT FROM (s->>'generation_id')::uuid OR NEW.admission_id IS DISTINCT FROM (s->>'admission_id')::uuid
  OR NEW.run_id IS DISTINCT FROM (s->>'run_id')::uuid OR NEW.reservation_id IS DISTINCT FROM (s->>'reservation_id')::uuid
  OR NEW.supersedes_renewal_id IS DISTINCT FROM (s->>'supersedes_renewal_id')::uuid
  OR NEW.policy_version_id IS DISTINCT FROM (s->>'policy_version_id')::uuid OR NEW.budget_date IS DISTINCT FROM (s->>'budget_date')::date
  OR NEW.budget_timezone IS DISTINCT FROM s->>'budget_timezone'
  OR NEW.admission_not_after IS DISTINCT FROM (s->>'admission_not_after')::timestamptz
  OR NEW.confirmation IS DISTINCT FROM 'renew_brand_context_semantic_within_shown_cap'
  OR NEW.request_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'parent_receipt_id',NEW.parent_receipt_id,'actor_user_id',NEW.actor_user_id,'quote_digest',NEW.quote_digest,'confirmation',NEW.confirmation)) THEN
  RAISE EXCEPTION 'brand_context_semantic_renewal_invalid' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;
CREATE TRIGGER bc_semantic_renewal_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_brand_context_semantic_renewals
 FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_semantic_renewal_v1();

CREATE FUNCTION complete_signal_brand_context_semantic_renewal_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run
  JOIN signal_semantic_context_budget_reservations reservation ON reservation.id=NEW.reservation_id AND reservation.run_id=run.id
  JOIN signal_semantic_context_proposal_outbox outbox ON outbox.run_id=run.id
  WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND run.generation_id=NEW.generation_id
   AND run.processing_admission_id=NEW.admission_id AND run.status='queued' AND run.provider_call_state='not_started'
   AND run.provider_call_count=0 AND run.provider_response_private IS NULL AND run.lease_token IS NULL
   AND reservation.status='reserved' AND signal_semantic_context_digest_json_v2(to_jsonb(reservation))=NEW.quote_snapshot->>'reservation_snapshot_digest'
   AND outbox.status='pending' AND outbox.lease_token IS NULL
   AND signal_brand_context_processing_source_current_v1(NEW.generation_id)) THEN
  RAISE EXCEPTION 'brand_context_semantic_renewal_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER bc_semantic_renewal_complete AFTER INSERT ON signal_brand_context_semantic_renewals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_signal_brand_context_semantic_renewal_v1();

-- The renewal changes the effective authorization day, not the immutable ledger.
-- Exactly one latest grant supplies a day for the original reservation; settled
-- and released keep the normal ledger classification, with no second amount.
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH entries AS (
  SELECT CASE WHEN r.status='settled' THEN 'confirmed' WHEN run.provider_call_state='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END kind,
   CASE WHEN r.status='settled' THEN r.actual_micro_usd ELSE r.reservation_micro_usd END amount
  FROM signal_semantic_context_budget_reservations r JOIN signal_workspaces w ON w.id=r.workspace_id
  JOIN signal_semantic_context_proposal_runs run ON run.id=r.run_id
  LEFT JOIN LATERAL(SELECT candidate.budget_date FROM signal_brand_context_semantic_renewals candidate
   WHERE candidate.reservation_id=r.id AND candidate.run_id=r.run_id
    AND NOT EXISTS(SELECT 1 FROM signal_brand_context_semantic_renewals successor WHERE successor.supersedes_renewal_id=candidate.id)
   ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) renewal ON true
  WHERE COALESCE(r.processing_organization_id,w.organization_id)=target_org AND COALESCE(renewal.budget_date,(r.reserved_at AT TIME ZONE target_timezone)::date)=target_day AND r.status<>'released'
   AND NOT COALESCE(excluded_ledger='semantic' AND r.id=excluded_id,false)
  UNION ALL
  SELECT CASE WHEN c.status='settled' THEN 'confirmed' WHEN c.status='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END,
   CASE WHEN c.status='settled' THEN c.settled_micro_usd ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END
  FROM signal_workspace_embedding_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
  WHERE COALESCE(c.processing_organization_id,w.organization_id)=target_org AND (c.reserved_at AT TIME ZONE target_timezone)::date=target_day AND c.status<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='voyage' AND c.id=excluded_id,false)
  UNION ALL
  SELECT CASE WHEN c.call_state='settled' THEN 'confirmed' WHEN c.call_state='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END,
   CASE WHEN c.call_state='settled' THEN c.settled_micro_usd ELSE c.reserved_micro_usd END
  FROM engine_cost_events c JOIN signal_workspaces w ON w.id=c.workspace_id
  WHERE COALESCE(c.processing_organization_id,w.organization_id)=target_org AND c.workspace_contract='workspace-engine-interpretation-v1'
   AND (c.created_at AT TIME ZONE target_timezone)::date=target_day AND c.call_state<>'definitely_not_sent'
   AND NOT COALESCE(excluded_ledger='interpretation' AND c.id=excluded_id,false)
 ) SELECT COALESCE(sum(amount) FILTER(WHERE kind='confirmed'),0)::bigint,
  COALESCE(sum(amount) FILTER(WHERE kind='reserved'),0)::bigint,
  COALESCE(sum(amount) FILTER(WHERE kind='ambiguous'),0)::bigint,COALESCE(sum(amount),0)::bigint FROM entries
$$;

-- Preserve every non-renewed path verbatim. For the exact Stage1 reservation,
-- use the latest explicit authority and its accounting day before mark-sent.
ALTER FUNCTION signal_processing_capacity_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz)
 RENAME TO signal_processing_capacity_pre0160_v1;
CREATE FUNCTION signal_processing_capacity_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE renewal signal_brand_context_semantic_renewals%ROWTYPE;parent signal_brand_context_processing_receipts%ROWTYPE;
 admission signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 reservation signal_semantic_context_budget_reservations%ROWTYPE;run signal_semantic_context_proposal_runs%ROWTYPE;spent bigint;
BEGIN
 SELECT * INTO renewal FROM signal_brand_context_semantic_renewals r WHERE r.admission_id=signal_processing_capacity_v1.admission_id
  AND NOT EXISTS(SELECT 1 FROM signal_brand_context_semantic_renewals s WHERE s.supersedes_renewal_id=r.id);
 IF renewal.id IS NULL THEN
  PERFORM signal_processing_capacity_pre0160_v1(target_workspace,target_actor,target_run,admission_id,allowed_actions,
   actual_provider,actual_model,actual_configuration,owner_cap,ledger_kind,ledger_id,amount,reserved_time);RETURN;
 END IF;
 PERFORM signal_processing_lock_v1(renewal.organization_id,renewal.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=renewal.parent_receipt_id;
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=renewal.admission_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=renewal.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='brand_context_proposal';
 SELECT * INTO reservation FROM signal_semantic_context_budget_reservations WHERE id=renewal.reservation_id;
 SELECT * INTO run FROM signal_semantic_context_proposal_runs WHERE id=renewal.run_id;
 IF renewal.workspace_id IS DISTINCT FROM target_workspace OR renewal.actor_user_id IS DISTINCT FROM target_actor
  OR renewal.run_id IS DISTINCT FROM target_run OR allowed_actions IS DISTINCT FROM ARRAY['brand_context_proposal']
  OR (SELECT organization_id FROM signal_workspaces WHERE id=target_workspace) IS DISTINCT FROM renewal.organization_id
  OR parent.semantic_run_id IS DISTINCT FROM run.id OR parent.semantic_admission_id IS DISTINCT FROM admission.id
  OR run.processing_admission_id IS DISTINCT FROM admission.id OR run.brand_context_preparation_operation_id IS NOT NULL
  OR actual_provider IS DISTINCT FROM admission.provider OR actual_model IS DISTINCT FROM admission.model
  OR NOT signal_processing_configuration_allows_v1('brand_context_proposal',admission.configuration,actual_configuration)
  OR owner_cap IS DISTINCT FROM admission.execution_cap_micro_usd
  OR p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR clock_timestamp()>=renewal.admission_not_after
  OR renewal.budget_date IS DISTINCT FROM (clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR p.policy_digest IS DISTINCT FROM renewal.quote_snapshot->>'policy_digest'
  OR a.configuration IS DISTINCT FROM admission.configuration OR a.configuration_digest IS DISTINCT FROM admission.configuration_digest
  OR a.max_execution_micro_usd IS DISTINCT FROM admission.execution_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 IF run.provider_call_state IS DISTINCT FROM 'not_started' OR run.provider_call_count IS DISTINCT FROM 0
  OR run.provider_response_private IS NOT NULL OR run.provider_response_digest IS NOT NULL
  OR run.appended_operation_id IS NOT NULL OR run.settled_micro_usd IS NOT NULL
  OR reservation.status IS DISTINCT FROM 'reserved' OR reservation.run_id IS DISTINCT FROM run.id
  OR reservation.processing_organization_id IS DISTINCT FROM renewal.organization_id
  OR reservation.reservation_micro_usd IS DISTINCT FROM run.reservation_micro_usd
  OR (ledger_kind IS NOT NULL AND (ledger_kind<>'semantic' OR ledger_id IS DISTINCT FROM reservation.id
   OR amount IS DISTINCT FROM reservation.reservation_micro_usd OR reserved_time IS DISTINCT FROM reservation.reserved_at))
  OR (ledger_kind IS NULL AND (ledger_id IS NOT NULL OR amount<>0 OR reserved_time IS NOT NULL)) THEN
  RAISE EXCEPTION 'brand_context_semantic_run_not_renewable' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_processing_source_current_v1(renewal.generation_id) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(renewal.organization_id,renewal.budget_date,
  renewal.budget_timezone,'semantic',reservation.id);
 IF spent+reservation.reservation_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION renew_signal_brand_context_semantic_admission_v1(parent_id uuid,target_actor uuid,request_key text,
 quote_hash text,stable_confirmation text,runtime_configuration jsonb,runtime_cap bigint,runtime_available boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_brand_context_semantic_renewals%ROWTYPE;parent signal_brand_context_processing_receipts%ROWTYPE;
 quoted jsonb;s jsonb;request_hash text;state text;changed integer;
BEGIN
 IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR quote_hash IS NULL OR quote_hash !~ '^sha256:[0-9a-f]{64}$'
  OR stable_confirmation IS DISTINCT FROM 'renew_brand_context_semantic_within_shown_cap' THEN
  RAISE EXCEPTION 'brand_context_semantic_renewal_request_invalid' USING ERRCODE='22023'; END IF;
 -- An immutable replay needs actor/tenant locks, but never waits for the Worker owner.
 PERFORM signal_brand_context_semantic_renewal_lock_v1(parent_id,target_actor,NOT EXISTS(
  SELECT 1 FROM signal_brand_context_semantic_renewals WHERE parent_receipt_id=parent_id
   AND actor_user_id=target_actor AND idempotency_key=request_key));
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_id;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('parent_receipt_id',parent_id,
  'actor_user_id',target_actor,'quote_digest',quote_hash,'confirmation',stable_confirmation));
 SELECT * INTO prior FROM signal_brand_context_semantic_renewals WHERE workspace_id=parent.workspace_id
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.parent_receipt_id IS DISTINCT FROM parent_id OR prior.request_digest IS DISTINCT FROM request_hash THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
 ELSE
  quoted:=quote_signal_brand_context_semantic_renewal_v1(parent_id,target_actor);s:=quoted->'quote_snapshot';
  IF quoted->>'quote_digest' IS DISTINCT FROM quote_hash THEN
   RAISE EXCEPTION 'brand_context_semantic_renewal_quote_changed' USING ERRCODE='23514'; END IF;
  IF runtime_available IS DISTINCT FROM true THEN RAISE EXCEPTION 'brand_context_processing_runtime_unavailable' USING ERRCODE='23514'; END IF;
  IF NOT signal_processing_configuration_allows_v1('brand_context_proposal',runtime_configuration,s->'configuration')
   OR runtime_cap IS NULL OR runtime_cap<(s->>'execution_cap_micro_usd')::bigint THEN
   RAISE EXCEPTION 'brand_context_processing_runtime_drift' USING ERRCODE='23514'; END IF;
  INSERT INTO signal_brand_context_semantic_renewals(parent_receipt_id,admission_id,run_id,reservation_id,workspace_id,
   organization_id,actor_user_id,generation_id,supersedes_renewal_id,policy_version_id,budget_date,budget_timezone,admission_not_after,
   idempotency_key,request_digest,quote_digest,quote_snapshot,confirmation,receipt_digest)
  VALUES(parent_id,(s->>'admission_id')::uuid,(s->>'run_id')::uuid,(s->>'reservation_id')::uuid,(s->>'workspace_id')::uuid,
   (s->>'organization_id')::uuid,target_actor,(s->>'generation_id')::uuid,(s->>'supersedes_renewal_id')::uuid,
   (s->>'policy_version_id')::uuid,(s->>'budget_date')::date,s->>'budget_timezone',(s->>'admission_not_after')::timestamptz,
   request_key,request_hash,quote_hash,s,stable_confirmation,'pending') RETURNING * INTO prior;
  UPDATE signal_semantic_context_proposal_runs SET status='queued',failed_at=NULL,error_code=NULL,error_summary=NULL,
   updated_at=clock_timestamp() WHERE id=prior.run_id AND status='failed' AND provider_call_state='not_started'
   AND provider_call_count=0 AND provider_response_private IS NULL AND lease_token IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'brand_context_semantic_renewal_incomplete' USING ERRCODE='23514'; END IF;
  UPDATE signal_semantic_context_proposal_outbox SET status='pending',available_at=clock_timestamp(),error_summary=NULL,
   lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE run_id=prior.run_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'brand_context_semantic_renewal_incomplete' USING ERRCODE='23514'; END IF;
  INSERT INTO signal_semantic_context_proposal_run_events(workspace_id,run_id,transition_key,event_kind,state_digest,detail)
   VALUES(prior.workspace_id,prior.run_id,'renewal-'||prior.id::text,'recovery_queued',prior.receipt_digest,
    jsonb_build_object('renewal_id',prior.id,'budget_date',prior.budget_date));
 END IF;
 SELECT status INTO state FROM signal_semantic_context_proposal_runs WHERE id=prior.run_id;
 RETURN jsonb_build_object('contract_version','brand-context-semantic-renewal-v1','parent_receipt_id',parent_id,
  'workspace_id',prior.workspace_id,'run_id',prior.run_id,'admission_id',prior.admission_id,'reservation_id',prior.reservation_id,
  'renewal_id',prior.id,'status',state,'replayed',s IS NULL,'admission_not_after',prior.admission_not_after);
END; $$;

-- Server-only surfaces. Quote digests never confer SQL/browser privileges.
REVOKE ALL ON signal_brand_context_semantic_renewals FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_semantic_renewal_lock_v1(uuid,uuid,boolean),
 quote_signal_brand_context_semantic_renewal_v1(uuid,uuid),validate_signal_brand_context_semantic_renewal_v1(),
 complete_signal_brand_context_semantic_renewal_v1(),
 renew_signal_brand_context_semantic_admission_v1(uuid,uuid,text,text,text,jsonb,bigint,boolean),
 signal_processing_capacity_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz) FROM PUBLIC;
DO $$ DECLARE role_name text;function_identity text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_brand_context_semantic_renewals FROM %I',role_name);
   FOREACH function_identity IN ARRAY ARRAY[
    'signal_brand_context_semantic_renewal_lock_v1(uuid,uuid,boolean)','quote_signal_brand_context_semantic_renewal_v1(uuid,uuid)',
    'validate_signal_brand_context_semantic_renewal_v1()','complete_signal_brand_context_semantic_renewal_v1()',
    'renew_signal_brand_context_semantic_admission_v1(uuid,uuid,text,text,text,jsonb,bigint,boolean)',
    'signal_processing_capacity_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz)',
    'signal_processing_capacity_pre0160_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz)'
   ] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_identity,role_name); END LOOP;
  END IF;
 END LOOP;
END $$;
