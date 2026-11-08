-- An explicit pilot grant supplements one active base without changing any
-- policy/action/admission row or foreign key. It never authorizes another kind.
CREATE TABLE signal_mass_labeling_policy_extensions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
 base_policy_version_id uuid NOT NULL,base_policy_digest text NOT NULL,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),map_id uuid NOT NULL,
 map_digest text NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd BETWEEN 1 AND 9007199254740991),
 configuration jsonb NOT NULL,configuration_digest text NOT NULL,extension_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,base_policy_version_id) REFERENCES signal_processing_policy_versions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id) ON DELETE RESTRICT,
 UNIQUE(base_policy_version_id,workspace_id,map_id,actor_user_id),
 UNIQUE(id,base_policy_version_id,workspace_id,map_id,actor_user_id)
);
CREATE TABLE signal_mass_labeling_scoped_admissions(
 id uuid PRIMARY KEY,extension_id uuid NOT NULL UNIQUE,organization_id uuid NOT NULL,
 policy_version_id uuid NOT NULL,workspace_id uuid NOT NULL,map_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 target_id uuid NOT NULL UNIQUE,idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 execution_cap_micro_usd bigint NOT NULL CHECK(execution_cap_micro_usd>0),
 budget_date date NOT NULL,budget_timezone text NOT NULL,admission_not_after timestamptz NOT NULL,
 receipt_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(extension_id,policy_version_id,workspace_id,map_id,actor_user_id)
  REFERENCES signal_mass_labeling_policy_extensions(id,base_policy_version_id,workspace_id,map_id,actor_user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,policy_version_id) REFERENCES signal_processing_policy_versions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,target_id) REFERENCES signal_labeling_runs(workspace_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(workspace_id,actor_user_id,idempotency_key)
);
-- Protocol identity, derived from the published massLabelingJevIdentityV1.
-- A future prompt/price/model change requires a new explicit authority version.
CREATE FUNCTION signal_mass_labeling_scoped_identity_v1() RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'sha256:5f386b9c763edfd8721b06d02af2fb21be751bec32f49aa102e345fe1af78f67'::text $$;
CREATE FUNCTION signal_mass_labeling_extension_base_v1(target uuid) RETURNS signal_processing_policy_versions
 LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_mass_labeling_policy_extensions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM signal_mass_labeling_policy_extensions WHERE id=target;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=e.base_policy_version_id;
 IF NOT COALESCE(e.id IS NOT NULL AND p.status='active' AND p.organization_id=e.organization_id AND p.policy_digest=e.base_policy_digest
  AND clock_timestamp()>=p.valid_from AND clock_timestamp()<p.valid_until
  AND signal_workspace_classification_actor_v1(e.workspace_id,e.actor_user_id)
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=e.actor_user_id AND u.status='active' AND u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','admin','founder'))
  AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=e.workspace_id AND feature='mass_labeling')
  AND EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_workspaces w ON w.id=m.workspace_id AND w.organization_id=e.organization_id AND w.status='active'
   JOIN signal_corpus_preparation_input_state state ON state.workspace_id=m.workspace_id AND state.input_revision=m.input_revision
   JOIN signal_corpus_preparation_runs prep ON prep.id=m.preparation_run_id AND prep.workspace_id=m.workspace_id AND prep.status='completed'
    AND (prep.policy_valid_until IS NULL OR prep.policy_valid_until>clock_timestamp())
   JOIN signal_topic_catalog_executions engine ON engine.id=m.source_engine_execution_id AND engine.workspace_id=m.workspace_id AND engine.status='ready'
   WHERE m.id=e.map_id AND m.workspace_id=e.workspace_id AND m.map_digest=e.map_digest),false) THEN
  RAISE EXCEPTION 'mass_labeling_extension_invalid' USING ERRCODE='23514'; END IF;
 RETURN p;
END $$;
CREATE FUNCTION guard_mass_labeling_extension_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;spent bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Mass labeling extensions are append-only.' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||NEW.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.base_policy_version_id;
 IF NOT COALESCE(p.organization_id=NEW.organization_id AND p.status='active' AND p.policy_digest=NEW.base_policy_digest
   AND clock_timestamp()>=p.valid_from AND clock_timestamp()<p.valid_until
   AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)
   AND EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder'))
   AND EXISTS(SELECT 1 FROM signal_workspaces WHERE id=NEW.workspace_id AND organization_id=NEW.organization_id)
   AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
   AND EXISTS(SELECT 1 FROM signal_mass_labeling_maps WHERE workspace_id=NEW.workspace_id AND id=NEW.map_id AND map_digest=NEW.map_digest),false) THEN
  RAISE EXCEPTION 'mass_labeling_extension_invalid' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone);
 IF p.daily_cap_micro_usd IS NOT NULL AND spent+NEW.cap_micro_usd>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.configuration=jsonb_build_object('contract_version','mass-labeling-jev-v1','workspace_id',NEW.workspace_id,'map_id',NEW.map_id,
  'map_digest',NEW.map_digest,'actor_user_id',NEW.actor_user_id,'extension_id',NEW.id,'labeler_digest',signal_mass_labeling_scoped_identity_v1(),'provider','typesafe','model','jev-1.13.0');
 NEW.configuration_digest=signal_semantic_context_digest_json_v2(NEW.configuration);NEW.created_at=clock_timestamp();
 NEW.extension_digest=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'extension_digest');RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_extension BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_policy_extensions FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_extension_v1();
CREATE FUNCTION guard_mass_labeling_scoped_admission_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_mass_labeling_policy_extensions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;spent bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Scoped mass admissions are append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO e FROM signal_mass_labeling_policy_extensions WHERE id=NEW.extension_id;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 p=signal_mass_labeling_extension_base_v1(NEW.extension_id);
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 IF ROW(NEW.organization_id,NEW.policy_version_id,NEW.workspace_id,NEW.map_id,NEW.actor_user_id)
   IS DISTINCT FROM ROW(e.organization_id,e.base_policy_version_id,e.workspace_id,e.map_id,e.actor_user_id)
  OR NEW.execution_cap_micro_usd>e.cap_micro_usd OR NEW.budget_timezone<>p.budget_timezone
  OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after>least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone))
  OR NEW.admission_not_after<=clock_timestamp() THEN RAISE EXCEPTION 'mass_labeling_scoped_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(NEW.organization_id,NEW.budget_date,p.budget_timezone);
 IF p.daily_cap_micro_usd IS NOT NULL AND spent+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at=clock_timestamp();NEW.receipt_digest=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_scoped_admission BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_scoped_admissions
 FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_scoped_admission_v1();
CREATE FUNCTION signal_mass_labeling_scoped_policy_v1(target_run uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_labeling_runs%ROWTYPE;a signal_mass_labeling_scoped_admissions%ROWTYPE;e signal_mass_labeling_policy_extensions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;mass signal_mass_labeling_runs%ROWTYPE;spent bigint;run_spent bigint;
BEGIN
 SELECT * INTO r FROM signal_labeling_runs WHERE id=target_run;
 SELECT * INTO a FROM signal_mass_labeling_scoped_admissions WHERE target_id=target_run;
 IF a.id IS NULL THEN
  IF r.kind='mass_labeling' THEN
   IF r.processing_admission_id IS NULL THEN RAISE EXCEPTION 'mass_labeling_scoped_admission_required' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM signal_processing_admissions native WHERE native.id=r.processing_admission_id AND native.workspace_id=r.workspace_id
     AND native.target_id=r.id AND native.actor_user_id=r.actor_user_id AND native.action='mass_labeling_jev' AND native.provider='typesafe' AND native.model='jev-1.13.0') THEN
    RAISE EXCEPTION 'mass_labeling_native_admission_invalid' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO e FROM signal_mass_labeling_policy_extensions WHERE id=a.extension_id;
 SELECT * INTO mass FROM signal_mass_labeling_runs WHERE run_id=target_run;
 PERFORM signal_processing_lock_v1(a.organization_id,(clock_timestamp() AT TIME ZONE a.budget_timezone)::date);
 p=signal_mass_labeling_extension_base_v1(a.extension_id);
 IF NOT COALESCE(r.workspace_id=a.workspace_id AND r.actor_user_id=a.actor_user_id AND r.kind='mass_labeling' AND r.processing_admission_id IS NULL
   AND r.cap_micro_usd IS NOT NULL AND r.cap_micro_usd>0 AND r.cap_micro_usd<=a.execution_cap_micro_usd AND r.cap_micro_usd<=e.cap_micro_usd
   AND r.concept_set_digest=e.map_digest AND mass.map_id=e.map_id AND mass.workspace_id=e.workspace_id
   AND r.entity_context_digest=(SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=e.map_id)
   AND EXISTS(SELECT 1 FROM signal_labeler_versions l WHERE l.id=r.labeler_version_id AND l.kind='mass_labeling' AND l.provider='typesafe' AND l.model='jev-1.13.0'
     AND l.identity#>>'{params,request_version}'='mass-labeling-jev-v1' AND l.labeler_digest=signal_mass_labeling_scoped_identity_v1()
     AND signal_labeling_digest_v1(l.identity)=l.labeler_digest)
   AND a.budget_date=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date AND a.budget_timezone=p.budget_timezone AND clock_timestamp()<a.admission_not_after,false) THEN
  RAISE EXCEPTION 'mass_labeling_scoped_admission_invalid' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('organization_id',a.organization_id,'budget_date',a.budget_date,'budget_timezone',p.budget_timezone,
   'daily_cap_micro_usd',p.daily_cap_micro_usd::text,'max_execution_micro_usd',a.execution_cap_micro_usd::text,'provider','typesafe','model','jev-1.13.0','action','mass_labeling_jev');
END $$;
CREATE FUNCTION signal_mass_labeling_scoped_capacity_v1(target_run uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE policy jsonb;run_spent bigint;spent bigint;run_cap bigint;
BEGIN
 policy=signal_mass_labeling_scoped_policy_v1(target_run);IF policy IS NULL THEN RETURN NULL;END IF;
 SELECT cap_micro_usd INTO run_cap FROM signal_labeling_runs WHERE id=target_run;
 SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)
  INTO run_spent FROM signal_labeling_calls WHERE run_id=target_run;
 IF run_spent>run_cap OR run_spent>(policy->>'max_execution_micro_usd')::bigint THEN RAISE EXCEPTION 'labeling_cap_exhausted' USING ERRCODE='23514';END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1((policy->>'organization_id')::uuid,(policy->>'budget_date')::date,policy->>'budget_timezone');
 IF policy->>'daily_cap_micro_usd' IS NOT NULL AND spent>(policy->>'daily_cap_micro_usd')::bigint THEN RAISE EXCEPTION 'labeling_daily_cap_exhausted' USING ERRCODE='23514';END IF;
 RETURN policy;
END $$;
CREATE FUNCTION guard_mass_labeling_scoped_owner_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='signal_mass_labeling_scoped_admissions' THEN PERFORM signal_mass_labeling_scoped_capacity_v1(NEW.target_id);
 ELSE PERFORM signal_mass_labeling_scoped_capacity_v1(NEW.id);END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mass_labeling_scoped_owner AFTER INSERT ON signal_labeling_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.kind='mass_labeling') EXECUTE FUNCTION guard_mass_labeling_scoped_owner_v1();
CREATE CONSTRAINT TRIGGER mass_labeling_scoped_admission_owner AFTER INSERT ON signal_mass_labeling_scoped_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_scoped_owner_v1();
CREATE FUNCTION guard_mass_labeling_scoped_run_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_mass_labeling_scoped_admissions WHERE target_id=OLD.id) AND
  ROW(NEW.workspace_id,NEW.kind,NEW.labeler_version_id,NEW.actor_user_id,NEW.processing_admission_id,NEW.cap_micro_usd,NEW.concept_set_digest,NEW.entity_context_digest,NEW.preparation_run_id)
   IS DISTINCT FROM ROW(OLD.workspace_id,OLD.kind,OLD.labeler_version_id,OLD.actor_user_id,OLD.processing_admission_id,OLD.cap_micro_usd,COALESCE(OLD.concept_set_digest,NEW.concept_set_digest),OLD.entity_context_digest,OLD.preparation_run_id) THEN
  RAISE EXCEPTION 'mass_labeling_scoped_owner_immutable' USING ERRCODE='55000'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_scoped_run BEFORE UPDATE ON signal_labeling_runs FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_scoped_run_v1();
CREATE FUNCTION guard_mass_labeling_scoped_money_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_labeling_runs%ROWTYPE;a signal_mass_labeling_scoped_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.run_id IS DISTINCT FROM OLD.run_id AND EXISTS(SELECT 1 FROM signal_labeling_runs owner
   WHERE owner.id IN(OLD.run_id,NEW.run_id) AND owner.kind='mass_labeling' AND owner.processing_admission_id IS NULL) THEN
  RAISE EXCEPTION 'mass_labeling_scoped_call_immutable' USING ERRCODE='55000';END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
 IF r.kind<>'mass_labeling' OR r.processing_admission_id IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
    IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone)
    OR OLD.status<>'reserved' AND NEW.status='reserved' OR OLD.status='reserved' AND NEW.status='submitted'
    OR NEW.status='submitting' AND OLD.status NOT IN('reserved','submitting')
    OR OLD.status='settled' AND ROW(NEW.status,NEW.settled_micro_usd,NEW.usage) IS DISTINCT FROM ROW(OLD.status,OLD.settled_micro_usd,OLD.usage) THEN
   RAISE EXCEPTION 'mass_labeling_scoped_call_immutable' USING ERRCODE='55000';END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  SELECT * INTO a FROM signal_mass_labeling_scoped_admissions WHERE target_id=NEW.run_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'mass_labeling_scoped_admission_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_processing_lock_v1(a.organization_id,a.budget_date);p=signal_mass_labeling_extension_base_v1(a.extension_id);
  IF TG_OP='INSERT' AND NEW.status<>'reserved' OR NEW.workspace_id<>a.workspace_id OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0'
   OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp()
   OR NEW.transport<>'sync' OR NEW.budget_date<>a.budget_date OR NEW.budget_timezone<>a.budget_timezone OR NEW.reserved_micro_usd<=0 THEN
   RAISE EXCEPTION 'mass_labeling_scoped_call_invalid' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_scoped_money BEFORE INSERT OR UPDATE ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_scoped_money_v1();
-- Transition tables bound full exposure checks to one per affected run/page,
-- not one per row. BEFORE retains the shared mutex and fresh base/date fence.
CREATE FUNCTION guard_mass_labeling_scoped_money_total_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  FOR target IN SELECT DISTINCT n.run_id FROM scoped_new_calls n JOIN signal_mass_labeling_scoped_admissions a ON a.target_id=n.run_id LOOP
   PERFORM signal_mass_labeling_scoped_capacity_v1(target);
  END LOOP;
 ELSE
  FOR target IN SELECT DISTINCT n.run_id FROM scoped_new_calls n JOIN scoped_old_calls o ON o.id=n.id
    JOIN signal_mass_labeling_scoped_admissions a ON a.target_id=n.run_id WHERE n.status='submitting' AND o.status='reserved' LOOP
   PERFORM signal_mass_labeling_scoped_capacity_v1(target);
  END LOOP;
 END IF;RETURN NULL;
END $$;
CREATE TRIGGER mass_labeling_scoped_insert_total AFTER INSERT ON signal_labeling_calls REFERENCING NEW TABLE AS scoped_new_calls
 FOR EACH STATEMENT EXECUTE FUNCTION guard_mass_labeling_scoped_money_total_v1();
CREATE TRIGGER mass_labeling_scoped_update_total AFTER UPDATE ON signal_labeling_calls REFERENCING OLD TABLE AS scoped_old_calls NEW TABLE AS scoped_new_calls
 FOR EACH STATEMENT EXECUTE FUNCTION guard_mass_labeling_scoped_money_total_v1();
CREATE FUNCTION guard_mass_labeling_scoped_continuation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF OLD.smoke_root_limit IS NOT NULL AND NEW.smoke_root_limit IS NULL AND EXISTS(SELECT 1 FROM signal_mass_labeling_scoped_admissions WHERE target_id=NEW.run_id) THEN
  PERFORM signal_mass_labeling_scoped_capacity_v1(NEW.run_id);END IF;RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_scoped_continuation BEFORE UPDATE ON signal_mass_labeling_runs FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_scoped_continuation_v1();
ALTER TABLE signal_mass_labeling_policy_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_mass_labeling_scoped_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_policy_extensions,signal_mass_labeling_scoped_admissions FROM PUBLIC;
DO $$ DECLARE role_name text;function_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF role_name='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   IF role_name<>'PUBLIC' THEN EXECUTE format('REVOKE ALL ON signal_mass_labeling_policy_extensions,signal_mass_labeling_scoped_admissions FROM %I',role_name); END IF;
   FOR function_name IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('signal_mass_labeling_scoped_identity_v1','signal_mass_labeling_extension_base_v1','guard_mass_labeling_extension_v1','guard_mass_labeling_scoped_admission_v1','signal_mass_labeling_scoped_policy_v1','signal_mass_labeling_scoped_capacity_v1','guard_mass_labeling_scoped_owner_v1','guard_mass_labeling_scoped_run_v1','guard_mass_labeling_scoped_money_v1','guard_mass_labeling_scoped_money_total_v1','guard_mass_labeling_scoped_continuation_v1') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',function_name,CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   END LOOP;
  END IF;
 END LOOP;
END $$;
