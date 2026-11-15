-- Explicit original-request authority, never inferred from a completed ledger row.
-- Historical preparations/executions keep NULL provenance; no backfill or permission.
ALTER TABLE signal_listening_preparations ADD COLUMN discovery_origin text,
 ADD COLUMN auto_discovery boolean,
 ADD CHECK((discovery_origin IS NULL)=(auto_discovery IS NULL)),
 ADD CHECK(discovery_origin IS NULL OR discovery_origin IN('initial','discovery_child')),
 ADD CHECK(auto_discovery IS DISTINCT FROM true OR discovery_origin='initial');
CREATE TABLE signal_listening_discovery_initial_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),preparation_id uuid NOT NULL UNIQUE,configuration_id uuid NOT NULL,map_id uuid NOT NULL,
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),configuration_digest text NOT NULL,human_revision_digest text NOT NULL,
 map_digest text NOT NULL,preparation_run_id uuid NOT NULL,input_revision bigint NOT NULL,entity_context_digest text NOT NULL,embedding_config_digest text NOT NULL,
 seed_generation_id uuid NOT NULL,seed_generation_digest text NOT NULL,source_census_digest text NOT NULL,
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),auto_discovery boolean NOT NULL CHECK(auto_discovery),origin text NOT NULL CHECK(origin='initial'),
 automatic boolean NOT NULL CHECK(NOT automatic),review_configuration_digest text NOT NULL,jev_configuration_digest text NOT NULL,
 request_digest text NOT NULL,initial_run_id uuid UNIQUE,processing_admission_id uuid UNIQUE REFERENCES signal_processing_admissions(id),
 confirmed_generation_id uuid UNIQUE,execution_id uuid UNIQUE,status text NOT NULL DEFAULT 'preparing' CHECK(status IN('preparing','admitted','waiting_recovery','started','stale','failed')),
 error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,preparation_id) REFERENCES signal_listening_preparations(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,seed_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,initial_run_id) REFERENCES signal_labeling_runs(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,confirmed_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((initial_run_id IS NULL)=(processing_admission_id IS NULL)),CHECK((execution_id IS NULL)=(confirmed_generation_id IS NULL)),
 CHECK((status='started')=(execution_id IS NOT NULL))
);
CREATE INDEX signal_listening_discovery_initial_pending ON signal_listening_discovery_initial_intents(created_at,id) WHERE status IN('preparing','admitted','waiting_recovery');
ALTER TABLE signal_listening_discovery_executions ADD COLUMN initial_intent_id uuid UNIQUE;
ALTER TABLE signal_listening_discovery_executions ADD FOREIGN KEY(workspace_id,initial_intent_id) REFERENCES signal_listening_discovery_initial_intents(workspace_id,id);

CREATE FUNCTION signal_listening_discovery_initial_census_v1(gid uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(COALESCE(jsonb_agg(jsonb_build_array(root_id,proof->>'source_text_sha256') ORDER BY root_id),'[]'::jsonb))
 FROM signal_listening_discovery_roots WHERE generation_id=gid
$$;
CREATE FUNCTION signal_listening_discovery_initial_current_v1(i signal_listening_discovery_initial_intents) RETURNS boolean LANGUAGE sql STABLE
SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(i.origin='initial' AND i.auto_discovery AND NOT i.automatic
 AND f.discovery_origin='initial' AND f.auto_discovery AND f.actor_user_id=i.actor_user_id AND f.cap_micro_usd=i.cap_micro_usd
 AND f.configuration_id=i.configuration_id AND f.map_id=i.map_id AND f.policy_version_id=i.policy_version_id
 AND signal_processing_actor_v1(i.workspace_id,i.actor_user_id)
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=i.workspace_id AND feature='mass_labeling')
 AND w.organization_id=i.organization_id AND policy.organization_id=i.organization_id AND policy.status='active'
 AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
 AND review.provider='anthropic' AND review.model='claude-sonnet-4-6' AND review.configuration=signal_listening_discovery_review_configuration_v1()
 AND review.configuration_digest=i.review_configuration_digest AND(review.max_execution_micro_usd IS NULL OR i.cap_micro_usd<=review.max_execution_micro_usd)
 AND jev.provider='typesafe' AND jev.model='jev-1.13.0' AND jev.configuration='{"contract_version":"mass-labeling-jev-v2","provider":"typesafe","model":"jev-1.13.0"}'::jsonb
 AND jev.configuration_digest=i.jev_configuration_digest AND(jev.max_execution_micro_usd IS NULL OR i.cap_micro_usd<=jev.max_execution_micro_usd)
 AND cfg.state='published' AND cfg.configuration_digest=i.configuration_digest
 AND cfg.id=(SELECT id FROM signal_listening_configurations WHERE workspace_id=i.workspace_id AND state='published' ORDER BY revision DESC LIMIT 1)
 AND signal_listening_discovery_human_revision_v1(cfg.id)=i.human_revision_digest
 AND ROW(m.map_digest,m.preparation_run_id,m.input_revision,m.entity_context_digest,m.embedding_config_digest)
  IS NOT DISTINCT FROM ROW(i.map_digest,i.preparation_run_id,i.input_revision,i.entity_context_digest,i.embedding_config_digest)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state s WHERE s.workspace_id=i.workspace_id AND s.input_revision=i.input_revision)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_runs p WHERE p.id=i.preparation_run_id AND p.workspace_id=i.workspace_id AND p.status='completed' AND(p.policy_valid_until IS NULL OR p.policy_valid_until>clock_timestamp()))
 AND g.status='ready' AND g.configuration_id=i.configuration_id AND g.map_id=i.map_id AND g.snapshot_digest=i.seed_generation_digest
 AND signal_listening_discovery_initial_census_v1(g.id)=i.source_census_digest
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_roots r LEFT JOIN signal_mass_labeling_items item ON item.workspace_id=i.workspace_id AND item.map_id=i.map_id AND item.root_id=r.root_id
  WHERE r.generation_id=g.id AND(item.root_id IS NULL OR NOT signal_listening_root_right_v1(i.workspace_id,r.root_id,'llm-processing')
   OR r.proof->>'source_text_sha256' IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(item.text,'UTF8')),'hex'))),false)
 FROM signal_listening_preparations f JOIN signal_workspaces w ON w.id=f.workspace_id
 JOIN signal_processing_policy_versions policy ON policy.id=i.policy_version_id
 JOIN signal_processing_policy_actions review ON review.policy_version_id=policy.id AND review.action='listening_discovery_review'
 JOIN signal_processing_policy_actions jev ON jev.policy_version_id=policy.id AND jev.action='mass_labeling_jev'
 JOIN signal_listening_configurations cfg ON cfg.id=i.configuration_id AND cfg.workspace_id=i.workspace_id
 JOIN signal_mass_labeling_maps m ON m.id=i.map_id AND m.workspace_id=i.workspace_id
 JOIN signal_listening_discovery_generations g ON g.id=i.seed_generation_id AND g.workspace_id=i.workspace_id
 WHERE f.id=i.preparation_id AND f.workspace_id=i.workspace_id
$$;
CREATE FUNCTION signal_listening_discovery_initial_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE seal text;r signal_labeling_runs;ad signal_processing_admissions;p signal_listening_discovery_executions;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'listening_discovery_initial_immutable';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  IF NEW.status<>'preparing' OR NEW.initial_run_id IS NOT NULL OR NEW.execution_id IS NOT NULL OR NEW.error_code IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM signal_listening_preparations f WHERE f.id=NEW.preparation_id AND f.workspace_id=NEW.workspace_id
    AND f.xmin::text::bigint=txid_current()%4294967296 AND f.discovery_origin='initial' AND f.auto_discovery)
   OR NOT COALESCE(signal_listening_discovery_initial_current_v1(NEW),false) THEN RAISE EXCEPTION 'listening_discovery_initial_request_invalid';END IF;
  seal:=signal_labeling_digest_v1(to_jsonb(NEW)-ARRAY['request_digest','initial_run_id','processing_admission_id','confirmed_generation_id','execution_id','status','error_code','created_at','updated_at']);
  IF NEW.request_digest IS NOT NULL AND NEW.request_digest<>seal THEN RAISE EXCEPTION 'listening_discovery_initial_seal_invalid';END IF;NEW.request_digest:=seal;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['initial_run_id','processing_admission_id','confirmed_generation_id','execution_id','status','error_code','updated_at'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['initial_run_id','processing_admission_id','confirmed_generation_id','execution_id','status','error_code','updated_at'])
   OR OLD.status IN('started','stale','failed') OR OLD.initial_run_id IS NOT NULL AND ROW(NEW.initial_run_id,NEW.processing_admission_id) IS DISTINCT FROM ROW(OLD.initial_run_id,OLD.processing_admission_id)
   THEN RAISE EXCEPTION 'listening_discovery_initial_immutable';END IF;
  IF OLD.status='preparing' AND NEW.status='admitted' THEN
   SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.initial_run_id AND workspace_id=NEW.workspace_id;
   SELECT * INTO ad FROM signal_processing_admissions WHERE id=r.processing_admission_id;
   IF NOT COALESCE(signal_listening_discovery_initial_current_v1(NEW),false) OR NEW.processing_admission_id IS DISTINCT FROM ad.id
    OR ad.policy_version_id IS DISTINCT FROM NEW.policy_version_id OR ad.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR ad.action<>'mass_labeling_jev' OR ad.provider<>'typesafe' OR ad.model<>'jev-1.13.0' OR ad.automatic
    OR ad.configuration_digest IS DISTINCT FROM NEW.jev_configuration_digest OR ad.request_digest IS DISTINCT FROM r.request_digest
    OR NOT EXISTS(SELECT 1 FROM signal_listening_runs o WHERE o.run_id=r.id AND o.workspace_id=NEW.workspace_id AND o.preparation_id=NEW.preparation_id
     AND o.configuration_id=NEW.configuration_id AND o.map_id=NEW.map_id)
    OR NOT EXISTS(SELECT 1 FROM signal_labeling_runs n WHERE n.id=r.id AND n.xmin::text::bigint=txid_current()%4294967296)
    OR NOT EXISTS(SELECT 1 FROM signal_processing_admissions n WHERE n.id=ad.id AND n.xmin::text::bigint=txid_current()%4294967296)
    THEN RAISE EXCEPTION 'listening_discovery_initial_admission_invalid';END IF;
  ELSIF OLD.status IN('admitted','waiting_recovery') AND NEW.status='started' THEN
   SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
   IF p.initial_intent_id IS DISTINCT FROM NEW.id OR p.initial_generation_id IS DISTINCT FROM NEW.confirmed_generation_id
    OR p.initial_classification_run_id IS DISTINCT FROM NEW.initial_run_id OR p.cap_micro_usd IS DISTINCT FROM NEW.cap_micro_usd
    OR NOT COALESCE(signal_listening_discovery_initial_current_v1(NEW),false) THEN RAISE EXCEPTION 'listening_discovery_initial_parent_invalid';END IF;
  ELSIF NEW.status='waiting_recovery' AND OLD.status IN('admitted','waiting_recovery') AND NEW.error_code IS NOT NULL
   AND EXISTS(SELECT 1 FROM signal_labeling_runs recovery_run WHERE recovery_run.id=NEW.initial_run_id AND recovery_run.workspace_id=NEW.workspace_id AND recovery_run.status IN('failed','running')
    AND(recovery_run.error_code='labeling_outcome_unknown' OR EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=recovery_run.id AND c.raw_storage_key IS NOT NULL AND NOT c.results_applied)))
   AND ROW(NEW.initial_run_id,NEW.processing_admission_id,NEW.confirmed_generation_id,NEW.execution_id) IS NOT DISTINCT FROM ROW(OLD.initial_run_id,OLD.processing_admission_id,OLD.confirmed_generation_id,OLD.execution_id) THEN NULL;
  ELSIF NEW.status NOT IN('stale','failed') OR NEW.error_code IS NULL OR ROW(NEW.initial_run_id,NEW.processing_admission_id,NEW.confirmed_generation_id,NEW.execution_id)
    IS DISTINCT FROM ROW(OLD.initial_run_id,OLD.processing_admission_id,OLD.confirmed_generation_id,OLD.execution_id) THEN RAISE EXCEPTION 'listening_discovery_initial_state_invalid';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_initial_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_initial_intents FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_initial_guard_v1();
CREATE FUNCTION signal_listening_discovery_initial_preparation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.auto_discovery IS TRUE AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents i WHERE i.preparation_id=NEW.id AND i.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'listening_discovery_initial_intent_required';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_initial_preparation AFTER INSERT ON signal_listening_preparations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_initial_preparation_v1();
CREATE FUNCTION signal_listening_discovery_initial_label_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM signal_listening_preparations f WHERE f.id=NEW.preparation_id AND f.auto_discovery)
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents i JOIN signal_labeling_runs r ON r.id=i.initial_run_id
  WHERE i.preparation_id=NEW.preparation_id AND i.workspace_id=NEW.workspace_id AND i.initial_run_id=NEW.run_id AND i.processing_admission_id=r.processing_admission_id AND i.status='admitted') THEN RAISE EXCEPTION 'listening_discovery_initial_admission_required';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_initial_label AFTER INSERT ON signal_listening_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_initial_label_v1();
CREATE FUNCTION signal_listening_discovery_initial_parent_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE i signal_listening_discovery_initial_intents;g signal_listening_discovery_generations;
BEGIN
 IF NEW.initial_intent_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents original WHERE original.workspace_id=NEW.workspace_id AND original.initial_run_id=NEW.initial_classification_run_id) THEN RAISE EXCEPTION 'listening_discovery_initial_intent_required';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO i FROM signal_listening_discovery_initial_intents WHERE id=NEW.initial_intent_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.initial_generation_id AND workspace_id=NEW.workspace_id;
 IF i.id IS NULL OR i.status NOT IN('admitted','waiting_recovery') OR NOT COALESCE(signal_listening_discovery_initial_current_v1(i),false)
 OR ROW(NEW.actor_user_id,NEW.organization_id,NEW.initial_preparation_id,NEW.initial_classification_run_id,NEW.initial_configuration_id,NEW.map_id,NEW.policy_version_id,NEW.cap_micro_usd)
  IS DISTINCT FROM ROW(i.actor_user_id,i.organization_id,i.preparation_id,i.initial_run_id,i.configuration_id,i.map_id,i.policy_version_id,i.cap_micro_usd)
 OR g.kind<>'confirmed_members' OR g.source_generation_id IS DISTINCT FROM i.seed_generation_id
 OR signal_listening_discovery_initial_census_v1(g.id) IS DISTINCT FROM i.source_census_digest THEN RAISE EXCEPTION 'listening_discovery_initial_parent_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_listening_discovery_initial_parent BEFORE INSERT ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_initial_parent_v1();
CREATE FUNCTION signal_listening_discovery_initial_parent_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.initial_intent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_initial_intents i WHERE i.id=NEW.initial_intent_id AND i.execution_id=NEW.id AND i.status='started') THEN RAISE EXCEPTION 'listening_discovery_initial_parent_unlinked';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_initial_parent_complete AFTER INSERT ON signal_listening_discovery_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_initial_parent_complete_v1();
CREATE FUNCTION signal_listening_discovery_initial_no_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'listening_discovery_initial_immutable';END $$;
CREATE TRIGGER signal_listening_discovery_initial_no_truncate BEFORE TRUNCATE ON signal_listening_discovery_initial_intents EXECUTE FUNCTION signal_listening_discovery_initial_no_truncate_v1();
ALTER TABLE signal_listening_discovery_initial_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_listening_discovery_initial_intents FROM PUBLIC;
DO $$DECLARE role_name text;fn text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE signal_listening_discovery_initial_intents FROM %I',role_name);END IF;END LOOP;
 FOR fn IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'signal_listening_discovery_initial_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC';FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name);END IF;END LOOP;
 END LOOP;
END $$;
