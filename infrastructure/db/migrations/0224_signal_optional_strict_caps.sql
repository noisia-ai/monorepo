-- NULL is no strict maximum, never an estimate promoted into an authorization cap.
-- Existing values and immutable admissions are preserved. Only new MFP/corpus actions may omit their execution cap.
ALTER TABLE signal_processing_policy_versions ALTER COLUMN daily_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_processing_policy_actions ALTER COLUMN max_execution_micro_usd DROP NOT NULL;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT processing_nullable_action_cap CHECK(max_execution_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings'));
ALTER TABLE signal_processing_admissions ALTER COLUMN execution_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT processing_nullable_admission_cap CHECK(execution_cap_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings'));
ALTER TABLE signal_workspace_embedding_runs ALTER COLUMN hard_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_workspace_embedding_runs ADD CONSTRAINT embedding_nullable_corpus_cap CHECK(hard_cap_micro_usd IS NOT NULL OR input_contract='corpus');

CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation' AND (NEW.execution_cap_micro_usd NOT BETWEEN 1 AND 30000000 OR NEW.automatic OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6') THEN RAISE EXCEPTION 'topic_editorial_admission_invalid' USING ERRCODE='23514'; END IF;
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
  OR (a.max_execution_micro_usd IS NOT NULL AND (NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd)) OR NEW.automatic AND NOT a.automatic_allowed
  OR NEW.budget_timezone<>p.budget_timezone OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after>(CASE WHEN NEW.action IN('mention_facets','concept_membership') THEN p.valid_until ELSE least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone)) END)
  OR NEW.admission_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(p.organization_id,NEW.budget_date,p.budget_timezone);
 IF NEW.execution_cap_micro_usd>0 AND exposure+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION admit_signal_processing_v1(target_workspace uuid,target_actor uuid,target_action text,target_run uuid,
 request_key text,request_hash text,requested_cap bigint,request_automatic boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 receipt signal_processing_admissions%ROWTYPE;w signal_workspaces%ROWTYPE;day date;
BEGIN
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN
  day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
  PERFORM signal_processing_lock_v1(w.organization_id,day);
 END IF;
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
  CASE WHEN target_action IN('mention_facets','concept_membership') THEN p.valid_until ELSE least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)) END,request_automatic,'pending') RETURNING * INTO receipt;
 RETURN jsonb_build_object('replayed',false,'receipt',to_jsonb(receipt));
END; $$;
CREATE OR REPLACE FUNCTION signal_processing_capacity_pre0160_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
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
 IF admission_id IS NULL AND client_actor THEN
  RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
 -- Historical internal work without a live product policy keeps the SQL0155
 -- compatibility path. Every policy-backed path takes the day lock before any
 -- actor/grant row lock, matching admission and revocation lock order.
 IF admission_id IS NULL AND (p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until) THEN RETURN; END IF;
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(org,day);
 IF admission_id IS NOT NULL THEN
  SELECT * INTO r FROM signal_processing_admissions WHERE id=admission_id;
  IF r.action IN('brand_context_proposal','topic_prototype_embeddings') THEN
   PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
  ELSE PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor); END IF;
  IF r.workspace_id IS DISTINCT FROM target_workspace OR r.organization_id IS DISTINCT FROM org
   OR r.actor_user_id IS DISTINCT FROM target_actor OR r.target_id IS DISTINCT FROM target_run
   OR NOT r.action=ANY(allowed_actions) OR r.provider IS DISTINCT FROM actual_provider OR r.model IS DISTINCT FROM actual_model
   OR NOT signal_processing_configuration_allows_v1(r.action,r.configuration,actual_configuration)
   OR (r.execution_cap_micro_usd IS NOT NULL AND (owner_cap IS NULL OR owner_cap>r.execution_cap_micro_usd)) OR r.policy_version_id IS DISTINCT FROM p.id
   OR clock_timestamp()>=r.admission_not_after THEN
   RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 END IF;
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
