-- Listening keeps admission, actor and physical-clock fences on every row.
-- Historical exposure is checked once against the final statement, not once
-- per call. No transaction-local approval marker or alternate sender exists.
CREATE FUNCTION signal_listening_call_authority_v1(target uuid,call_day date,call_timezone text,reserved_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_labeling_runs;admission signal_processing_admissions;p signal_processing_policy_versions;
 org uuid;day date;
BEGIN
 SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=r.workspace_id;
 IF org IS NULL OR NOT EXISTS(SELECT 1 FROM signal_listening_runs WHERE run_id=r.id AND workspace_id=r.workspace_id) THEN
  RAISE EXCEPTION 'processing_scope_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(org,day);
 PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);
 -- Re-read mutable authority after every lock wait. Admission and its policy
 -- are immutable; lease, actor/grant, calendar and expiry are not.
 SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
 IF admission.id IS NULL OR admission.workspace_id IS DISTINCT FROM r.workspace_id OR admission.organization_id IS DISTINCT FROM org
  OR admission.actor_user_id IS DISTINCT FROM r.actor_user_id OR admission.target_id IS DISTINCT FROM r.id
  OR admission.action IS DISTINCT FROM 'mass_labeling_jev' OR admission.provider IS DISTINCT FROM 'typesafe'
  OR admission.model IS DISTINCT FROM 'jev-1.13.0'
  OR NOT COALESCE(signal_processing_configuration_allows_v1(admission.action,admission.configuration,admission.configuration),false)
  OR admission.policy_version_id IS DISTINCT FROM p.id
  OR admission.execution_cap_micro_usd IS NOT NULL AND (r.cap_micro_usd IS NULL OR r.cap_micro_usd>admission.execution_cap_micro_usd)
  OR clock_timestamp()>=admission.admission_not_after
  OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 IF r.status IS DISTINCT FROM 'running' OR r.lease_token IS NULL OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'labeling_lease_lost' USING ERRCODE='23514'; END IF;
 IF day IS DISTINCT FROM (clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR admission.budget_date IS DISTINCT FROM day
  OR reserved_at IS NOT NULL AND (reserved_at AT TIME ZONE p.budget_timezone)::date IS DISTINCT FROM day THEN
  RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
 IF call_day IS DISTINCT FROM admission.budget_date OR call_timezone IS DISTINCT FROM admission.budget_timezone THEN
  RAISE EXCEPTION 'listening_budget_invalid' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION signal_listening_statement_money_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE targets uuid[];target uuid;r signal_labeling_runs;admission signal_processing_admissions;action_cap bigint;
 policy record;spent bigint;parent record;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT array_agg(DISTINCT n.run_id ORDER BY n.run_id) INTO targets FROM listening_new_calls n
   JOIN signal_listening_runs owner ON owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id;
 ELSE
  SELECT array_agg(DISTINCT n.run_id ORDER BY n.run_id) INTO targets FROM listening_new_calls n
   JOIN listening_old_calls o ON o.id=n.id JOIN signal_listening_runs owner ON owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id
   WHERE o.status='reserved' AND n.status='submitting';
 END IF;
 IF targets IS NULL THEN RETURN NULL; END IF;
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
  SELECT max_execution_micro_usd INTO action_cap FROM signal_processing_policy_actions
   WHERE policy_version_id=admission.policy_version_id AND action=admission.action;
  IF NOT FOUND THEN RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
  -- Identical to readSignalLabelingRunExposureV1: ambiguous work keeps its
  -- reservation and terminal exposure never disappears behind a failed row.
  SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd
   ELSE reserved_micro_usd END),0) INTO spent FROM signal_labeling_calls WHERE run_id=target;
  IF spent>r.cap_micro_usd OR spent>admission.execution_cap_micro_usd OR spent>action_cap THEN
   RAISE EXCEPTION 'labeling_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR policy IN SELECT DISTINCT p.id,p.organization_id,p.budget_timezone,p.daily_cap_micro_usd,ad.budget_date
  FROM signal_labeling_runs run JOIN signal_processing_admissions ad ON ad.id=run.processing_admission_id
  JOIN signal_processing_policy_versions p ON p.id=ad.policy_version_id WHERE run.id=ANY(targets)
  ORDER BY p.organization_id,ad.budget_date,p.id LOOP
  SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(policy.organization_id,policy.budget_date,policy.budget_timezone);
  IF spent>policy.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR parent IN SELECT DISTINCT execution.id,execution.cap_micro_usd FROM signal_listening_discovery_children child
  JOIN signal_listening_discovery_executions execution ON execution.id=child.execution_id AND execution.workspace_id=child.workspace_id
  WHERE child.run_id=ANY(targets) ORDER BY execution.id LOOP
  PERFORM 1 FROM signal_listening_discovery_executions WHERE id=parent.id FOR UPDATE;
  IF signal_listening_discovery_exposure_v1(parent.id)>parent.cap_micro_usd THEN
   RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted'; END IF;
 END LOOP;
 -- A large final aggregate may cross the physical lease or admission expiry.
 -- Recheck after that work, while all original authority locks remain held.
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER listening_statement_money_insert AFTER INSERT ON signal_labeling_calls
 REFERENCING NEW TABLE AS listening_new_calls FOR EACH STATEMENT EXECUTE FUNCTION signal_listening_statement_money_v1();
CREATE TRIGGER listening_statement_money_update AFTER UPDATE ON signal_labeling_calls
 REFERENCING OLD TABLE AS listening_old_calls NEW TABLE AS listening_new_calls
 FOR EACH STATEMENT EXECUTE FUNCTION signal_listening_statement_money_v1();

-- The following guard preserves 0298 byte-for-byte except for replacing its
-- per-row full exposure scan with the same relational authority fence above.
CREATE OR REPLACE FUNCTION signal_listening_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;c signal_listening_configurations;admission signal_processing_admissions;
 i jsonb;actual jsonb;expected jsonb;questions jsonb;digests jsonb;basis jsonb;selected_count integer;ctx text;requeue jsonb;unsent boolean:=false;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF owner.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='submitting' AND NEW.status='reserved' THEN
   BEGIN requeue:=NULLIF(current_setting('noisia.labeling_unsent_requeue_v1',true),'')::jsonb;
   EXCEPTION WHEN OTHERS THEN requeue:=NULL;END;
   unsent:=COALESCE(requeue->>'contract_version'='signal-labeling-unsent-requeue-v1'
    AND requeue->>'run_id'=r.id::text AND requeue->>'workspace_id'=r.workspace_id::text
    AND requeue->>'lease_token'=r.lease_token::text AND r.status='running' AND r.lease_token IS NOT NULL AND r.lease_until>clock_timestamp()
    AND requeue->'calls' @> jsonb_build_array(jsonb_build_object('id',OLD.id,'request_digest',OLD.request_digest))
    AND OLD.provider_batch_id IS NULL AND OLD.raw_sha256 IS NULL AND OLD.raw_storage_key IS NULL AND OLD.raw_size_bytes IS NULL
    AND OLD.raw_storage_verified_at IS NULL AND OLD.raw_storage_verified_key IS NULL
    AND OLD.usage IS NULL AND OLD.settled_micro_usd IS NULL AND OLD.results IS NULL AND NOT OLD.results_applied
    AND OLD.terminal_exposure_micro_usd=0
    AND NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members member WHERE member.call_id=OLD.id)
    AND (to_jsonb(NEW)-ARRAY['status','updated_at'])=(to_jsonb(OLD)-ARRAY['status','updated_at']),false);
   IF unsent THEN PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);END IF;
  END IF;
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,
      NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,
      OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
   OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
   OR OLD.status='settled' AND ROW(NEW.status,NEW.usage,NEW.settled_micro_usd) IS DISTINCT FROM ROW(OLD.status,OLD.usage,OLD.settled_micro_usd)
   OR OLD.status<>'reserved' AND NEW.status='reserved' AND NOT unsent THEN RAISE EXCEPTION 'listening_call_immutable'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  IF NEW.workspace_id<>owner.workspace_id OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp()
   OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0' OR NEW.transport<>'sync' OR NEW.reserved_micro_usd<=0
   OR jsonb_array_length(NEW.inputs)<>1 THEN RAISE EXCEPTION 'listening_call_invalid'; END IF;
  PERFORM signal_listening_call_authority_v1(NEW.run_id,NEW.budget_date,NEW.budget_timezone,NEW.created_at);
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  IF NEW.budget_date<>admission.budget_date OR NEW.budget_timezone<>admission.budget_timezone THEN RAISE EXCEPTION 'listening_budget_invalid'; END IF;
  i:=NEW.inputs->0;
  SELECT count(*)::int,jsonb_object_agg(p.question_key,p.wire),jsonb_object_agg(p.question_key,to_jsonb(p.question_digest)),
    COALESCE(jsonb_object_agg(p.question_key,to_jsonb(p.scope_basis)) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb)
   INTO selected_count,questions,digests,basis
   FROM signal_listening_population_roots_v1(r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,ARRAY[(i->>'root_id')::uuid],'llm-processing') p
   WHERE p.root_id=(i->>'root_id')::uuid AND p.question_key IN(SELECT jsonb_array_elements_text(i->'question_keys'))
    AND p.input_digest=i->>'input_digest' AND p.candidate AND p.scope_state='included' AND p.answer IS NULL;
  IF selected_count NOT BETWEEN 1 AND 256 OR selected_count<>jsonb_array_length(i->'question_keys')
   OR i->>'configuration_digest' IS DISTINCT FROM c.configuration_digest OR i->>'map_id' IS DISTINCT FROM owner.map_id::text
   OR i->'question_digests' IS DISTINCT FROM digests OR i->'scope_basis' IS DISTINCT FROM basis THEN RAISE EXCEPTION 'listening_call_questions_invalid'; END IF;
  SELECT jsonb_build_object('model','jev-1.13.0','state',item.text,'questions',questions) INTO expected
   FROM signal_mass_labeling_items item WHERE item.workspace_id=r.workspace_id AND item.map_id=owner.map_id AND item.root_id=(i->>'root_id')::uuid;
  IF NEW.request IS DISTINCT FROM expected OR i->>'text' IS DISTINCT FROM expected->>'state'
   OR NEW.request_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('request_version','listening-jev-v1','run_id',r.id,
    'root_id',i->'root_id','input_digest',i->'input_digest','entity_context_digest',r.entity_context_digest,
    'question_digests',digests,'scope_basis',basis,'request',expected)) THEN RAISE EXCEPTION 'listening_request_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Only the labeling branch changes; Voyage keeps its original per-call guard.
CREATE OR REPLACE FUNCTION signal_listening_discovery_child_capacity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent_id uuid;cap bigint;amount bigint;kind text;
BEGIN
 IF TG_TABLE_NAME='signal_labeling_calls' THEN
 SELECT execution_id INTO parent_id FROM signal_listening_discovery_children WHERE run_id=NEW.run_id;
 kind:='labeling';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='submitting') THEN RETURN NEW;END IF;
 -- Keep the same parent lock before any row can become sendable.
 -- The final transition-table check below includes every sibling at once.
 PERFORM 1 FROM signal_listening_discovery_executions WHERE id=parent_id FOR UPDATE;
 RETURN NEW;
 ELSE
 SELECT p.id INTO parent_id FROM signal_listening_discovery_executions p WHERE p.initial_preparation_id IN(SELECT id FROM signal_listening_preparations WHERE prototype_run_id=NEW.run_id)
 UNION SELECT execution_id FROM signal_listening_discovery_children child JOIN signal_listening_preparations flow ON flow.id=child.preparation_id WHERE flow.prototype_run_id=NEW.run_id UNION SELECT r.execution_id FROM signal_listening_discovery_rounds r JOIN signal_listening_preparations flow ON flow.id=r.classification_preparation_id WHERE flow.prototype_run_id=NEW.run_id LIMIT 1;
 kind:='voyage';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW;END IF;
 amount:=NEW.reserved_micro_usd;
 END IF;
 SELECT cap_micro_usd INTO cap FROM signal_listening_discovery_executions WHERE id=parent_id FOR UPDATE;
 IF signal_listening_discovery_exposure_v1(parent_id,kind,NEW.id)+amount>cap THEN RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted';END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION signal_listening_call_authority_v1(uuid,date,text,timestamptz),signal_listening_statement_money_v1() FROM PUBLIC;
DO $$DECLARE role_name text;function_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOR function_name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('signal_listening_call_authority_v1','signal_listening_statement_money_v1') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_name,role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;
