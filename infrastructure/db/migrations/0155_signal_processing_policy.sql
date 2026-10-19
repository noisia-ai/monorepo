-- Product policy substrate only. No policy, admission, run, grant or provider is activated.
-- Money remains in the three existing ledgers. Receipts do not reserve money.
CREATE TABLE signal_processing_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL CONSTRAINT fk_processing_policy_org REFERENCES organizations(id) ON DELETE RESTRICT,
 version bigint NOT NULL CONSTRAINT signal_processing_policy_version_positive CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CONSTRAINT signal_processing_policy_status CHECK(status IN('draft','active','revoked')),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 budget_timezone text NOT NULL,daily_cap_micro_usd bigint NOT NULL CONSTRAINT signal_processing_policy_cap CHECK(daily_cap_micro_usd>=0),
 policy_digest text CONSTRAINT signal_processing_policy_digest CHECK(policy_digest~'^sha256:[0-9a-f]{64}$'),
 created_by_user_id uuid NOT NULL CONSTRAINT fk_processing_policy_creator REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,
 CONSTRAINT signal_processing_policy_versions_organization_id_version_key UNIQUE(organization_id,version),
 CONSTRAINT signal_processing_policy_versions_organization_id_id_key UNIQUE(organization_id,id),
 CONSTRAINT signal_processing_policy_window CHECK(valid_from<valid_until),CONSTRAINT signal_processing_policy_revoked CHECK((status='revoked')=(revoked_at IS NOT NULL)),
 CONSTRAINT signal_processing_policy_sealed CHECK(status='draft' OR policy_digest IS NOT NULL)
);
CREATE UNIQUE INDEX uq_signal_processing_policy_active ON signal_processing_policy_versions(organization_id) WHERE status='active';
CREATE TABLE signal_processing_policy_actions (
 policy_version_id uuid NOT NULL CONSTRAINT fk_processing_action_policy REFERENCES signal_processing_policy_versions(id) ON DELETE RESTRICT,
 action text NOT NULL CONSTRAINT signal_processing_action_name CHECK(action IN('brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings',
  'topic_fit','topic_interpretation','topic_fit_incremental','topic_interpretation_incremental')),
 kind text NOT NULL CONSTRAINT signal_processing_action_kind CHECK(kind IN('free','provider')),provider text,model text,
 configuration jsonb NOT NULL CONSTRAINT signal_processing_action_configuration CHECK(jsonb_typeof(configuration)='object' AND pg_column_size(configuration)<=32768),
 configuration_digest text NOT NULL CONSTRAINT signal_processing_action_digest CHECK(configuration_digest~'^sha256:[0-9a-f]{64}$'),
 max_execution_micro_usd bigint NOT NULL CONSTRAINT signal_processing_action_cap CHECK(max_execution_micro_usd>=0),automatic_allowed boolean NOT NULL DEFAULT false,
 CONSTRAINT pk_processing_policy_actions PRIMARY KEY(policy_version_id,action),
 CONSTRAINT signal_processing_action_provider CHECK((kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental')
    AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
  OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND ((action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental')
    AND provider='anthropic' AND model='claude-sonnet-4-6') OR (action IN('topic_prototype_embeddings','corpus_embeddings')
    AND provider='voyage' AND model='voyage-4-large'))))
);
CREATE TABLE signal_processing_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL CONSTRAINT fk_processing_admission_org REFERENCES organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL CONSTRAINT fk_processing_admission_workspace REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 brand_id uuid NOT NULL CONSTRAINT fk_processing_admission_brand REFERENCES brands(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL CONSTRAINT fk_processing_admission_actor REFERENCES users(id) ON DELETE RESTRICT,
 policy_version_id uuid NOT NULL,action text NOT NULL,target_id uuid NOT NULL,
 idempotency_key text NOT NULL CONSTRAINT signal_processing_admission_key CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CONSTRAINT signal_processing_admission_request_digest CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 provider text,model text,configuration jsonb NOT NULL,configuration_digest text NOT NULL,
 execution_cap_micro_usd bigint NOT NULL CONSTRAINT signal_processing_admission_cap CHECK(execution_cap_micro_usd>=0),
 budget_date date NOT NULL,budget_timezone text NOT NULL,admission_not_after timestamptz NOT NULL,
 automatic boolean NOT NULL DEFAULT false,receipt_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_signal_processing_admission_idempotency UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CONSTRAINT signal_processing_admissions_workspace_id_id_key UNIQUE(workspace_id,id),
 CONSTRAINT fk_processing_admission_policy_scope FOREIGN KEY(organization_id,policy_version_id) REFERENCES signal_processing_policy_versions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_processing_admission_policy_action FOREIGN KEY(policy_version_id,action) REFERENCES signal_processing_policy_actions(policy_version_id,action) ON DELETE RESTRICT
);

CREATE FUNCTION signal_processing_actor_v1(target_workspace uuid,target_actor uuid) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id JOIN users u ON u.id=target_actor AND u.organization_id=o.id
  JOIN user_brand_access a ON a.brand_id=b.id AND a.user_id=u.id AND a.revoked_at IS NULL AND a.access_level='admin'
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
   AND u.status='active' AND u.user_type='client' AND u.primary_role='client_admin')
$$;
-- All policy writers/reservations use policy lock before the day lock. Existing
-- owner locks remain scoped to their execution; this helper never locks another owner.
CREATE FUNCTION signal_processing_lock_v1(target_org uuid,target_day date) RETURNS void
 LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||target_org::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-org-budget:'||target_org::text||':'||target_day::text,0));
END; $$;
CREATE FUNCTION signal_processing_policy_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE actor users%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'processing_policy_history_retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||NEW.organization_id::text,0));
 IF TG_OP='INSERT' THEN
  NEW.created_at:=clock_timestamp();
  SELECT * INTO actor FROM users WHERE id=NEW.created_by_user_id FOR SHARE;
  IF actor.status IS DISTINCT FROM 'active' OR actor.user_type IS DISTINCT FROM 'noisia_internal'
   OR actor.primary_role NOT IN('noisia_admin','founder','admin') OR NEW.status<>'draft' OR NEW.policy_digest IS NOT NULL THEN
   RAISE EXCEPTION 'processing_policy_creator_forbidden' USING ERRCODE='23514'; END IF;
 ELSIF (to_jsonb(NEW)-ARRAY['status','policy_digest','revoked_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','policy_digest','revoked_at']) OR OLD.status='revoked'
   OR NOT (OLD.status='draft' AND NEW.status='active' OR OLD.status='active' AND NEW.status='revoked') THEN
  RAISE EXCEPTION 'processing_policy_version_immutable' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM signal_processing_policy_versions prior WHERE prior.organization_id=NEW.organization_id
  AND prior.id<>NEW.id AND prior.status<>'draft' AND prior.budget_timezone<>NEW.budget_timezone) THEN
  RAISE EXCEPTION 'processing_budget_timezone_immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.budget_timezone) THEN
  RAISE EXCEPTION 'processing_policy_timezone_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status='revoked' THEN NEW.revoked_at:=clock_timestamp(); END IF;
 IF TG_OP='UPDATE' AND NEW.status='active' THEN
  IF NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=NEW.id) THEN
   RAISE EXCEPTION 'processing_policy_actions_required' USING ERRCODE='23514'; END IF;
  NEW.policy_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
   'organization_id',NEW.organization_id,'version',NEW.version,'valid_from',NEW.valid_from,'valid_until',NEW.valid_until,
   'budget_timezone',NEW.budget_timezone,'daily_cap_micro_usd',NEW.daily_cap_micro_usd,
   'actions',(SELECT jsonb_agg(to_jsonb(a)-'policy_version_id' ORDER BY action) FROM signal_processing_policy_actions a WHERE policy_version_id=NEW.id)));
 ELSIF TG_OP='UPDATE' AND NEW.policy_digest IS DISTINCT FROM OLD.policy_digest THEN
  RAISE EXCEPTION 'processing_policy_digest_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER processing_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_processing_policy_versions
 FOR EACH ROW EXECUTE FUNCTION signal_processing_policy_guard_v1();
CREATE FUNCTION signal_processing_action_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_policy_action_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id FOR UPDATE;
 IF p.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'processing_policy_action_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(NEW.configuration) THEN
  RAISE EXCEPTION 'processing_configuration_digest_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER processing_action_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_processing_policy_actions
 FOR EACH ROW EXECUTE FUNCTION signal_processing_action_guard_v1();

-- Seal future monetary ownership; retained rows remain NULL with a documented
-- workspace fallback. No backfill reattributes historical money.
ALTER TABLE signal_semantic_context_budget_reservations ADD COLUMN processing_organization_id uuid CONSTRAINT fk_semantic_budget_processing_org REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE signal_workspace_embedding_calls ADD COLUMN processing_organization_id uuid CONSTRAINT fk_embedding_call_processing_org REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE engine_cost_events ADD COLUMN processing_organization_id uuid CONSTRAINT fk_engine_cost_processing_org REFERENCES organizations(id) ON DELETE RESTRICT;
CREATE FUNCTION signal_processing_money_organization_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.processing_organization_id IS DISTINCT FROM OLD.processing_organization_id THEN
   RAISE EXCEPTION 'processing_money_organization_immutable' USING ERRCODE='23514'; END IF;
 ELSE
  -- Assign from the relational workspace, ignoring any caller-supplied value.
  SELECT organization_id INTO NEW.processing_organization_id FROM signal_workspaces
   WHERE id=(to_jsonb(NEW)->>'workspace_id')::uuid FOR SHARE;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER aaa_processing_00_organization BEFORE INSERT OR UPDATE ON signal_semantic_context_budget_reservations FOR EACH ROW EXECUTE FUNCTION signal_processing_money_organization_v1();
CREATE TRIGGER aaa_processing_00_organization BEFORE INSERT OR UPDATE ON signal_workspace_embedding_calls FOR EACH ROW EXECUTE FUNCTION signal_processing_money_organization_v1();
CREATE TRIGGER aaa_processing_00_organization BEFORE INSERT OR UPDATE ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION signal_processing_money_organization_v1();

-- Timestamps are projected into the policy timezone, never compared as dates from
-- a different actor's budget timezone. Unknown is a category, not an extra sum.
CREATE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH entries AS (
  SELECT CASE WHEN r.status='settled' THEN 'confirmed' WHEN run.provider_call_state='outcome_unknown' THEN 'ambiguous' ELSE 'reserved' END kind,
   CASE WHEN r.status='settled' THEN r.actual_micro_usd ELSE r.reservation_micro_usd END amount
  FROM signal_semantic_context_budget_reservations r JOIN signal_workspaces w ON w.id=r.workspace_id
  JOIN signal_semantic_context_proposal_runs run ON run.id=r.run_id
  WHERE COALESCE(r.processing_organization_id,w.organization_id)=target_org AND (r.reserved_at AT TIME ZONE target_timezone)::date=target_day AND r.status<>'released'
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

-- Authentication is still supplied by the server. This lock/read revalidates the
-- relational identity and holds revocation, role and tenant rows through COMMIT.
CREATE FUNCTION signal_processing_lock_actor_v1(target_workspace uuid,target_actor uuid,require_request boolean DEFAULT true) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM u.id FROM users u JOIN signal_workspaces w ON w.id=target_workspace
  JOIN brands b ON b.id=w.brand_id JOIN organizations o ON o.id=w.organization_id
  WHERE u.id=target_actor FOR SHARE OF u,w,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces w ON w.brand_id=a.brand_id
  WHERE w.id=target_workspace AND a.user_id=target_actor AND a.revoked_at IS NULL ORDER BY a.id FOR SHARE OF a;
 IF (require_request AND NOT signal_processing_actor_v1(target_workspace,target_actor))
  OR (NOT require_request AND NOT EXISTS(SELECT 1 FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id
    JOIN organizations o ON o.id=w.organization_id JOIN users u ON u.id=target_actor
    WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active' AND u.status='active'
      AND ((u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
        OR u.user_type='client' AND u.organization_id=w.organization_id AND b.organization_id=w.organization_id
          AND u.primary_role IN('client_admin','client_viewer','brand_manager','client_owner','agency_insights')
          AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.user_id=u.id AND a.brand_id=b.id
            AND a.revoked_at IS NULL AND a.access_level IN('read','comment','admin'))))) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
END; $$;
CREATE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 -- The organization advisory lock fences policy transitions. A row SHARE here
 -- would invert the row-lock-before-trigger order of policy revocation.
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
 NEW.created_at:=clock_timestamp();
 NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');
 RETURN NEW;
END; $$;
CREATE TRIGGER processing_admission_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_processing_admissions
 FOR EACH ROW EXECUTE FUNCTION signal_processing_admission_guard_v1();

CREATE FUNCTION admit_signal_processing_v1(target_workspace uuid,target_actor uuid,target_action text,target_run uuid,
 request_key text,request_hash text,requested_cap bigint,request_automatic boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 receipt signal_processing_admissions%ROWTYPE;w signal_workspaces%ROWTYPE;day date;
BEGIN
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor,false);
 SELECT * INTO receipt FROM signal_processing_admissions WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF receipt.id IS NOT NULL THEN
  IF ROW(receipt.action,receipt.target_id,receipt.request_digest,receipt.execution_cap_micro_usd,receipt.automatic)
   IS DISTINCT FROM ROW(target_action,target_run,request_hash,requested_cap,request_automatic) THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',to_jsonb(receipt));
 END IF;
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor);
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(w.organization_id,day);
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action=target_action;
 IF a.action IS NULL THEN RAISE EXCEPTION 'processing_action_unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO signal_processing_admissions(organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,
  budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(w.organization_id,w.id,w.brand_id,target_actor,p.id,target_action,target_run,request_key,request_hash,
  a.provider,a.model,a.configuration,a.configuration_digest,requested_cap,day,p.budget_timezone,
  least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)),request_automatic,'pending') RETURNING * INTO receipt;
 RETURN jsonb_build_object('replayed',false,'receipt',to_jsonb(receipt));
END; $$;

ALTER TABLE signal_semantic_context_proposal_runs ADD COLUMN processing_admission_id uuid CONSTRAINT fk_semantic_run_processing_admission REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT;
ALTER TABLE signal_workspace_embedding_runs ADD COLUMN processing_admission_id uuid CONSTRAINT fk_embedding_run_processing_admission REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT;
ALTER TABLE signal_corpus_preparation_runs ADD COLUMN processing_admission_id uuid CONSTRAINT fk_corpus_run_processing_admission REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT;
ALTER TABLE signal_topic_catalog_executions
 ADD COLUMN processing_admission_id uuid CONSTRAINT fk_catalog_run_processing_admission REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT;

-- Shared fence for capacity creation only. Settlement, released reservations,
-- cache/read-back and persisted-response recovery never invoke this function.
CREATE FUNCTION signal_processing_capacity_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE org uuid;p signal_processing_policy_versions%ROWTYPE;r signal_processing_admissions%ROWTYPE;
 day date;spent bigint;run_spent bigint;client_actor boolean;
BEGIN
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 IF org IS NULL THEN RAISE EXCEPTION 'processing_scope_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 SELECT user_type='client' INTO client_actor FROM users WHERE id=target_actor;
 IF admission_id IS NOT NULL THEN
  SELECT * INTO r FROM signal_processing_admissions WHERE id=admission_id;
  PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor);
  IF r.workspace_id IS DISTINCT FROM target_workspace OR r.organization_id IS DISTINCT FROM org
   OR r.actor_user_id IS DISTINCT FROM target_actor OR r.target_id IS DISTINCT FROM target_run
   OR NOT r.action=ANY(allowed_actions) OR r.provider IS DISTINCT FROM actual_provider OR r.model IS DISTINCT FROM actual_model
   OR r.configuration IS DISTINCT FROM actual_configuration OR owner_cap>r.execution_cap_micro_usd
   OR r.policy_version_id IS DISTINCT FROM p.id OR clock_timestamp()>=r.admission_not_after THEN
   RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 ELSIF client_actor THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514';
 END IF;
 -- Internal history without product policy remains on its existing stricter gates.
 IF admission_id IS NULL AND (p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until) THEN RETURN; END IF;
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(org,day);
 IF admission_id IS NOT NULL AND r.budget_date<>day
  OR reserved_time IS NOT NULL AND (reserved_time AT TIME ZONE p.budget_timezone)::date<>day THEN
  RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(org,day,p.budget_timezone,ledger_kind,ledger_id);
 IF admission_id IS NOT NULL AND ledger_kind IS NOT NULL THEN
  IF ledger_kind='semantic' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_micro_usd WHEN status='released' THEN 0 ELSE reservation_micro_usd END),0)
    INTO run_spent FROM signal_semantic_context_budget_reservations WHERE run_id=target_run AND id<>ledger_id;
  ELSIF ledger_kind='voyage' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd WHEN status='definitely_not_sent' THEN 0
    ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0) INTO run_spent
    FROM signal_workspace_embedding_calls WHERE run_id=target_run AND id<>ledger_id;
  ELSE
   SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
    INTO run_spent FROM engine_cost_events WHERE catalog_execution_id=target_run AND id<>ledger_id;
  END IF;
  IF run_spent+amount>r.execution_cap_micro_usd THEN
   RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 END IF;
 IF amount>0 AND spent+amount>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
END; $$;

-- Compatibility for provider-free corpus preparation only. Import authorization
-- is not product spending authority and never applies to any other owner table.
CREATE FUNCTION signal_processing_lock_corpus_actor_v1(target_workspace uuid,target_actor uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM u.id FROM users u JOIN signal_workspaces w ON w.id=target_workspace
  JOIN brands b ON b.id=w.brand_id JOIN organizations o ON o.id=w.organization_id
  WHERE u.id=target_actor FOR SHARE OF u,w,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces w ON w.brand_id=a.brand_id
  WHERE w.id=target_workspace AND a.user_id=target_actor AND a.revoked_at IS NULL ORDER BY a.id FOR SHARE OF a;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN signal_workspaces w ON w.id=target_workspace
  JOIN brands b ON b.id=w.brand_id JOIN organizations o ON o.id=w.organization_id
  WHERE u.id=target_actor AND u.status='active' AND w.status='active' AND b.status='active'
   AND ((u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
    OR u.user_type='client' AND u.primary_role IN('client_admin','brand_manager','client_owner')
     AND o.status='active' AND u.organization_id=w.organization_id AND b.organization_id=w.organization_id
     AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.user_id=u.id AND a.brand_id=b.id
       AND a.revoked_at IS NULL AND a.access_level IN('comment','admin')))) THEN
  RAISE EXCEPTION 'corpus_preparation_forbidden' USING ERRCODE='42501'; END IF;
END; $$;

CREATE FUNCTION signal_processing_owner_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE actor uuid;actions text[];provider text;model text;configuration jsonb;cap bigint;kind text;request_actor text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.processing_admission_id IS DISTINCT FROM OLD.processing_admission_id THEN
   RAISE EXCEPTION 'processing_admission_binding_immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='signal_corpus_preparation_runs' AND NEW.processing_admission_id IS NULL THEN
   -- Dispatch/lease recovery is mechanical. Never poison a multi-owner batch
   -- because one historical actor was revoked; the actual claim is fenced.
   IF (NEW.status='running' AND (OLD.status<>'running' OR NEW.execution_token IS DISTINCT FROM OLD.execution_token
     OR NEW.execution_expires_at IS DISTINCT FROM OLD.execution_expires_at))
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id THEN
    PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   END IF;
   -- A new reader can reuse completed evidence without renewing its old author.
   -- Validate each newly accepted request's actor, with the exact workspace fence.
   IF NEW.request_keys IS DISTINCT FROM OLD.request_keys THEN
    IF NOT OLD.request_keys <@ NEW.request_keys THEN
     RAISE EXCEPTION 'corpus_preparation_idempotency_conflict' USING ERRCODE='23514'; END IF;
    FOR request_actor IN SELECT value FROM jsonb_each_text(NEW.request_keys) entry WHERE NOT OLD.request_keys ? entry.key LOOP
     IF request_actor IS NULL OR request_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'corpus_preparation_forbidden' USING ERRCODE='42501'; END IF;
     PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,request_actor::uuid);
    END LOOP;
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 actor:=COALESCE((to_jsonb(NEW)->>'actor_user_id')::uuid,(to_jsonb(NEW)->>'created_by_user_id')::uuid);
 IF TG_TABLE_NAME='signal_corpus_preparation_runs' AND NEW.processing_admission_id IS NULL THEN
  PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,actor);RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
  actions:=ARRAY['brand_context_proposal'];provider:=NEW.provider;model:=NEW.model;cap:=NEW.hard_cap_micro_usd;
  SELECT jsonb_object_agg(key,value) INTO configuration FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(ARRAY[
   'provider','model','model_version','pricing_version','max_input_tokens','max_output_tokens',
   'input_usd_per_million_tokens','output_usd_per_million_tokens']);
 ELSIF TG_TABLE_NAME='signal_workspace_embedding_runs' THEN
  kind:=to_jsonb(NEW)->>'input_contract';
  actions:=CASE WHEN kind='topic_prototypes' THEN ARRAY['topic_prototype_embeddings'] ELSE ARRAY['corpus_embeddings'] END;
  provider:=NEW.profile->>'provider';model:=NEW.profile->>'model';configuration:=NEW.profile;cap:=NEW.hard_cap_micro_usd;
 ELSIF TG_TABLE_NAME='signal_corpus_preparation_runs' THEN
  actions:=ARRAY['corpus_preparation'];configuration:='{}';cap:=0;
 ELSE
  IF NEW.input_contract='workspace-incremental-editorial-v1' AND EXISTS(SELECT 1 FROM users WHERE id=actor AND user_type='client') THEN
   RAISE EXCEPTION 'processing_interpretation_binding_unavailable' USING ERRCODE='23514'; END IF;
  actions:=CASE WHEN NEW.input_contract='workspace-incremental-editorial-v1'
    THEN ARRAY['topic_interpretation_incremental']
    WHEN NEW.input_snapshot ? 'numeric_descriptor' THEN ARRAY['topic_fit_incremental'] ELSE ARRAY['topic_fit'] END;
  configuration:='{}';cap:=0;
 END IF;
 -- Admission-bearing owners cannot be attached to existing history by UPDATE.
 -- New client execution paths remain disabled by their existing actor predicates.
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,NEW.id,NEW.processing_admission_id,
  actions,provider,model,configuration,cap);
 RETURN NEW;
END; $$;
CREATE TRIGGER aaa_processing_owner BEFORE INSERT OR UPDATE ON signal_semantic_context_proposal_runs FOR EACH ROW EXECUTE FUNCTION signal_processing_owner_guard_v1();
CREATE TRIGGER aaa_processing_owner BEFORE INSERT OR UPDATE ON signal_workspace_embedding_runs FOR EACH ROW EXECUTE FUNCTION signal_processing_owner_guard_v1();
CREATE TRIGGER aaa_processing_owner BEFORE INSERT OR UPDATE ON signal_corpus_preparation_runs FOR EACH ROW EXECUTE FUNCTION signal_processing_owner_guard_v1();
CREATE TRIGGER aaa_processing_owner BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions FOR EACH ROW EXECUTE FUNCTION signal_processing_owner_guard_v1();

CREATE FUNCTION signal_processing_ledger_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner jsonb;actor uuid;admission uuid;actions text[];provider text;model text;configuration jsonb;cap bigint;
 amount bigint;stamp timestamptz;kind text;entry_id uuid;reservation_org uuid;
BEGIN
 IF TG_TABLE_NAME='signal_semantic_context_budget_reservations' THEN
  IF TG_OP='UPDATE' AND NOT (OLD.status='released' AND NEW.status='reserved') THEN RETURN NEW; END IF;
  IF NEW.status<>'reserved' THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_semantic_context_proposal_runs r WHERE id=NEW.run_id;
  kind:='semantic';amount:=NEW.reservation_micro_usd;stamp:=NEW.reserved_at;entry_id:=NEW.id;
 ELSIF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
  IF NOT (OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight') THEN RETURN NEW; END IF;
  owner:=to_jsonb(NEW);kind:='semantic';
  SELECT id,reservation_micro_usd,reserved_at,processing_organization_id INTO entry_id,amount,stamp,reservation_org
   FROM signal_semantic_context_budget_reservations WHERE run_id=NEW.id AND status='reserved';
  IF reservation_org IS NOT NULL AND reservation_org IS DISTINCT FROM
    (SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id) THEN
   RAISE EXCEPTION 'processing_money_scope_changed' USING ERRCODE='23514'; END IF;
  IF entry_id IS NULL THEN RAISE EXCEPTION 'processing_reservation_required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='signal_workspace_embedding_calls' THEN
  IF TG_OP='UPDATE' AND NOT (OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_workspace_embedding_runs r WHERE id=NEW.run_id;
  kind:='voyage';amount:=NEW.reserved_micro_usd;stamp:=NEW.reserved_at;entry_id:=NEW.id;
 ELSE
  IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NOT (OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_topic_catalog_executions r WHERE id=NEW.catalog_execution_id;
  kind:='interpretation';amount:=NEW.reserved_micro_usd;stamp:=NEW.created_at;entry_id:=NEW.id;
 END IF;
 IF TG_TABLE_NAME<>'signal_semantic_context_proposal_runs' THEN
  IF NEW.processing_organization_id IS NOT NULL AND NEW.processing_organization_id IS DISTINCT FROM
    (SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id) THEN
   RAISE EXCEPTION 'processing_money_scope_changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF kind='semantic' THEN
  actor:=(owner->>'created_by_user_id')::uuid;actions:=ARRAY['brand_context_proposal'];provider:=owner->>'provider';model:=owner->>'model';
  SELECT jsonb_object_agg(key,value) INTO configuration FROM jsonb_each(owner) WHERE key=ANY(ARRAY[
   'provider','model','model_version','pricing_version','max_input_tokens','max_output_tokens','input_usd_per_million_tokens','output_usd_per_million_tokens']);
  cap:=(owner->>'hard_cap_micro_usd')::bigint;admission:=(owner->>'processing_admission_id')::uuid;
 ELSIF kind='voyage' THEN
  actor:=(owner->>'actor_user_id')::uuid;actions:=CASE WHEN owner->>'input_contract'='topic_prototypes' THEN ARRAY['topic_prototype_embeddings'] ELSE ARRAY['corpus_embeddings'] END;
  configuration:=owner->'profile';provider:=configuration->>'provider';model:=configuration->>'model';
  cap:=(owner->>'hard_cap_micro_usd')::bigint;admission:=(owner->>'processing_admission_id')::uuid;
 ELSE
  actor:=NEW.actor_user_id;actions:=ARRAY['topic_interpretation','topic_interpretation_incremental'];
  provider:=NEW.provider;model:=NEW.model;configuration:=NEW.call_configuration;
  -- Phase 5 must supply a validated atomic binding; no client Claude send is
  -- authorized by the free fit admission or by merely knowing a target UUID.
  admission:=NULL;cap:=0;
 END IF;
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,(owner->>'id')::uuid,admission,actions,
  provider,model,configuration,cap,kind,entry_id,amount,stamp);
 RETURN NEW;
END; $$;
CREATE TRIGGER aaa_processing_ledger BEFORE INSERT OR UPDATE ON signal_semantic_context_budget_reservations FOR EACH ROW EXECUTE FUNCTION signal_processing_ledger_guard_v1();
CREATE TRIGGER aaa_processing_ledger BEFORE UPDATE ON signal_semantic_context_proposal_runs FOR EACH ROW EXECUTE FUNCTION signal_processing_ledger_guard_v1();
CREATE TRIGGER aaa_processing_ledger BEFORE INSERT OR UPDATE ON signal_workspace_embedding_calls FOR EACH ROW EXECUTE FUNCTION signal_processing_ledger_guard_v1();
CREATE TRIGGER aaa_processing_ledger BEFORE INSERT OR UPDATE ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION signal_processing_ledger_guard_v1();

REVOKE ALL ON signal_processing_policy_versions,signal_processing_policy_actions,signal_processing_admissions FROM PUBLIC;
-- Match existing server-only financial tables, including deployments with Supabase roles.
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_processing_policy_versions,signal_processing_policy_actions,signal_processing_admissions FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

-- These functions expose server-only authority, budget reads and locks. Do not
-- inherit PostgreSQL default EXECUTE PUBLIC, even for the pure lock helper.
REVOKE ALL ON FUNCTION signal_processing_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_lock_v1(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_policy_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_action_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_money_organization_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_org_exposure_v1(uuid,date,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_lock_actor_v1(uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_admission_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION admit_signal_processing_v1(uuid,uuid,text,uuid,text,text,bigint,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_capacity_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_lock_corpus_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_owner_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_ledger_guard_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; function_identity text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOREACH function_identity IN ARRAY ARRAY[
    'signal_processing_actor_v1(uuid,uuid)',
    'signal_processing_lock_v1(uuid,date)',
    'signal_processing_policy_guard_v1()',
    'signal_processing_action_guard_v1()',
    'signal_processing_money_organization_v1()',
    'signal_processing_org_exposure_v1(uuid,date,text,text,uuid)',
    'signal_processing_lock_actor_v1(uuid,uuid,boolean)',
    'signal_processing_admission_guard_v1()',
    'admit_signal_processing_v1(uuid,uuid,text,uuid,text,text,bigint,boolean)',
    'signal_processing_capacity_v1(uuid,uuid,uuid,uuid,text[],text,text,jsonb,bigint,text,uuid,bigint,timestamptz)',
    'signal_processing_lock_corpus_actor_v1(uuid,uuid)',
    'signal_processing_owner_guard_v1()',
    'signal_processing_ledger_guard_v1()'
   ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_identity,role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;
