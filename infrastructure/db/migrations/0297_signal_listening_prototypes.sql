-- Listening prototype preparation reuses the governed Voyage ledger. Installation
-- creates no workflow, admission, provider request, vector or policy permission.
CREATE TABLE signal_listening_preparations(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,map_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 idempotency_key text NOT NULL,request_digest text NOT NULL,cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),
 prototype_cap_micro_usd bigint NOT NULL CHECK(prototype_cap_micro_usd>=0 AND prototype_cap_micro_usd<cap_micro_usd),
 quote jsonb NOT NULL,planned_prototype_run_id uuid,prototype_run_id uuid UNIQUE,listening_run_id uuid UNIQUE,
 status text NOT NULL CHECK(status IN('preparing','waiting_prototypes','ready_for_labeling','labeling','completed','failed')),
 error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,prototype_run_id) REFERENCES signal_workspace_embedding_runs(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,listening_run_id) REFERENCES signal_labeling_runs(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((prototype_cap_micro_usd>0)=(planned_prototype_run_id IS NOT NULL)),
 CHECK(prototype_run_id IS NULL OR prototype_run_id=planned_prototype_run_id)
);
CREATE INDEX signal_listening_preparations_pending ON signal_listening_preparations(created_at,id)
 WHERE status IN('preparing','waiting_prototypes','ready_for_labeling','labeling');
CREATE TABLE signal_listening_prototype_runs(
 run_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,preparation_id uuid NOT NULL UNIQUE,
 configuration_id uuid NOT NULL,map_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 plan jsonb NOT NULL,plan_digest text NOT NULL,quote_digest text NOT NULL,request_digest text NOT NULL,
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,run_id),
 FOREIGN KEY(workspace_id,preparation_id) REFERENCES signal_listening_preparations(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_workspace_embedding_runs(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE signal_listening_question_vectors(
 workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,question_key text NOT NULL,question_digest text NOT NULL,
 embedding_config_digest text NOT NULL,prototype_embedding_id uuid NOT NULL REFERENCES signal_topic_definition_embeddings(id),
 source_embedding_call_id uuid NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(configuration_id,question_key,embedding_config_digest),
 FOREIGN KEY(workspace_id,configuration_id,question_key) REFERENCES signal_listening_questions(workspace_id,configuration_id,question_key),
 FOREIGN KEY(workspace_id,source_embedding_call_id) REFERENCES signal_workspace_embedding_calls(workspace_id,id)
);
ALTER TABLE signal_listening_runs ADD COLUMN preparation_id uuid UNIQUE REFERENCES signal_listening_preparations(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION signal_listening_vector_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE q signal_listening_questions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND question_key=NEW.question_key;
 IF q.question_digest IS DISTINCT FROM NEW.question_digest OR q.definition->>'topic_source' IS DISTINCT FROM 'defined'
  OR NOT EXISTS(SELECT 1 FROM signal_topic_definition_embeddings p
   JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=p.workspace_id AND cache.config_digest=p.embedding_config_digest
    AND cache.chunk_sha256=p.input_text_sha256 AND cache.embedding=p.embedding AND cache.call_id=p.source_embedding_call_id
   JOIN signal_workspace_embedding_calls call ON call.id=cache.call_id AND call.workspace_id=cache.workspace_id
   WHERE p.id=NEW.prototype_embedding_id AND p.workspace_id=NEW.workspace_id AND p.provider='voyage' AND p.embedding_model='voyage-4-large'
    AND p.embedding_config_digest=NEW.embedding_config_digest AND p.source_embedding_call_id=NEW.source_embedding_call_id
    AND p.input_text_sha256='sha256:'||encode(sha256(convert_to(q.definition->>'positive','UTF8')),'hex') AND call.status='settled')
 THEN RAISE EXCEPTION 'listening_prototype_vector_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_vector_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_question_vectors
 FOR EACH ROW EXECUTE FUNCTION signal_listening_vector_guard_v1();

CREATE FUNCTION signal_listening_prototype_plan_valid_v1(w uuid,cid uuid,value jsonb) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE($3->>'contract_version'='listening-prototype-v1' AND $3->>'workspace_id'=w::text
  AND $3->>'configuration_id'=cid::text AND $3->>'configuration_digest'=c.configuration_digest
  AND $3->>'plan_digest'=signal_labeling_digest_v1($3-'plan_digest')
  AND EXISTS(SELECT 1 FROM signal_processing_policy_versions policy JOIN signal_processing_policy_actions p ON p.policy_version_id=policy.id
   WHERE policy.organization_id=workspace.organization_id AND p.action='topic_prototype_embeddings' AND p.configuration=$3->'embedding_profile')
  AND jsonb_typeof($3->'topics')='array' AND jsonb_typeof($3->'inputs')='array' AND jsonb_typeof($3->'texts')='object'
  AND jsonb_array_length($3->'topics')=jsonb_array_length($3->'inputs')
  AND jsonb_array_length($3->'inputs')=(SELECT count(*) FROM signal_listening_questions q WHERE q.configuration_id=cid AND q.definition->>'topic_source'='defined')
  AND jsonb_array_length($3->'inputs')>8
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($3->'inputs') i LEFT JOIN signal_listening_questions q
   ON q.configuration_id=cid AND q.workspace_id=w AND q.question_key=i->>'question_key' AND q.definition->>'topic_source'='defined'
   WHERE q.question_key IS NULL OR i->>'input_digest' IS DISTINCT FROM q.question_digest
    OR i->>'text_sha256' IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(q.definition->>'positive','UTF8')),'hex')
    OR $3->'texts'->>(i->>'text_sha256') IS DISTINCT FROM q.definition->>'positive'
    OR NOT $3->'topics' @> jsonb_build_array(jsonb_build_object('question_key',q.question_key,'input_digests',jsonb_build_array(q.question_digest))))
  AND (SELECT count(DISTINCT i->>'question_key') FROM jsonb_array_elements($3->'inputs') i)=jsonb_array_length($3->'inputs')
  AND (SELECT count(*) FROM jsonb_object_keys($3->'texts'))=(SELECT count(DISTINCT i->>'text_sha256') FROM jsonb_array_elements($3->'inputs') i),false)
 FROM signal_listening_configurations c JOIN signal_workspaces workspace ON workspace.id=w
 WHERE c.id=cid AND c.workspace_id=w AND c.state='published'
$$;
CREATE FUNCTION signal_listening_prototype_owner_valid_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(r.input_contract='topic_prototypes' AND r.taxonomy_profile_id IS NULL
  AND r.brand_context_preparation_operation_id IS NULL AND r.preparation_run_id IS NULL AND r.input_revision IS NULL
  AND r.topic_input_snapshot=o.plan AND r.topic_input_digest=o.plan_digest AND r.profile=o.plan->'embedding_profile'
  AND r.quote_digest=o.quote_digest AND r.hard_cap_micro_usd=o.cap_micro_usd
  AND r.workspace_id=o.workspace_id AND r.actor_user_id=o.actor_user_id
  AND a.workspace_id=o.workspace_id AND a.actor_user_id=o.actor_user_id AND a.target_id=r.id AND a.policy_version_id=o.policy_version_id
  AND a.action='topic_prototype_embeddings' AND a.provider='voyage' AND a.model='voyage-4-large' AND NOT a.automatic
  AND a.configuration=r.profile AND a.execution_cap_micro_usd=r.hard_cap_micro_usd
  AND a.brand_context_processing_receipt_id IS NULL AND a.brand_context_prototype_receipt_id IS NULL
  AND f.workspace_id=o.workspace_id AND f.configuration_id=o.configuration_id AND f.map_id=o.map_id AND f.actor_user_id=o.actor_user_id
  AND f.policy_version_id=o.policy_version_id AND f.planned_prototype_run_id=o.run_id AND f.prototype_cap_micro_usd=o.cap_micro_usd
  AND signal_listening_prototype_plan_valid_v1(o.workspace_id,o.configuration_id,o.plan),false)
 FROM signal_listening_prototype_runs o JOIN signal_workspace_embedding_runs r ON r.id=o.run_id
 JOIN signal_processing_admissions a ON a.id=r.processing_admission_id
 JOIN signal_listening_preparations f ON f.id=o.preparation_id WHERE o.run_id=target
$$;
CREATE FUNCTION signal_listening_prototype_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_listening_prototype_owner_valid_v1(target) AND NOT EXISTS(
  SELECT 1 FROM signal_listening_prototype_runs o CROSS JOIN LATERAL jsonb_array_elements(o.plan->'inputs') i
  WHERE o.run_id=target AND NOT EXISTS(SELECT 1 FROM signal_listening_configurations c
   JOIN signal_listening_questions q ON q.configuration_id=c.id AND q.workspace_id=c.workspace_id
   WHERE c.workspace_id=o.workspace_id AND c.state='published'
    AND c.revision=(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=o.workspace_id AND state='published')
    AND q.question_key=i->>'question_key' AND q.question_digest=i->>'input_digest'))
$$;
CREATE FUNCTION signal_listening_prototype_owner_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE flow signal_listening_preparations;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable';END IF;
 SELECT * INTO flow FROM signal_listening_preparations WHERE id=NEW.preparation_id AND workspace_id=NEW.workspace_id;
 IF flow.id IS NULL OR ROW(NEW.configuration_id,NEW.map_id,NEW.actor_user_id,NEW.policy_version_id,NEW.cap_micro_usd,NEW.run_id)
  IS DISTINCT FROM ROW(flow.configuration_id,flow.map_id,flow.actor_user_id,flow.policy_version_id,flow.prototype_cap_micro_usd,flow.planned_prototype_run_id)
  OR NOT COALESCE(signal_listening_prototype_plan_valid_v1(NEW.workspace_id,NEW.configuration_id,NEW.plan),false)
  OR NEW.plan_digest IS DISTINCT FROM NEW.plan->>'plan_digest' THEN RAISE EXCEPTION 'listening_prototype_owner_invalid';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_prototype_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_prototype_runs
 FOR EACH ROW EXECUTE FUNCTION signal_listening_prototype_owner_guard_v1();
CREATE FUNCTION signal_listening_prototype_owner_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT COALESCE(signal_listening_prototype_owner_valid_v1(NEW.run_id),false) THEN RAISE EXCEPTION 'listening_prototype_atomic_bundle_required';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_prototype_owner_complete AFTER INSERT ON signal_listening_prototype_runs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_prototype_owner_complete_v1();

ALTER TABLE signal_workspace_embedding_runs DROP CONSTRAINT workspace_embedding_input_contract;
ALTER TABLE signal_workspace_embedding_runs ADD CONSTRAINT workspace_embedding_input_contract CHECK(
 (input_contract='corpus' AND preparation_run_id IS NOT NULL AND input_revision IS NOT NULL
   AND taxonomy_profile_id IS NULL AND topic_input_snapshot IS NULL AND topic_input_digest IS NULL AND cursor_input_sha256 IS NULL)
 OR COALESCE((input_contract='topic_prototypes' AND preparation_run_id IS NULL AND input_revision IS NULL
   AND taxonomy_profile_id IS NOT NULL AND jsonb_typeof(topic_input_snapshot)='object' AND topic_input_digest IS NOT NULL
   AND cursor_asset_sha256 IS NULL AND cursor_chunk_index IS NULL),false)
 OR COALESCE((input_contract='topic_prototypes' AND preparation_run_id IS NULL AND input_revision IS NULL
   AND taxonomy_profile_id IS NULL AND topic_input_snapshot->>'contract_version'='listening-prototype-v1'
   AND topic_input_digest IS NOT NULL AND cursor_asset_sha256 IS NULL AND cursor_chunk_index IS NULL),false));

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
  IF EXISTS(SELECT 1 FROM signal_listening_prototype_runs WHERE run_id=NEW.target_id) THEN
   IF NOT EXISTS(SELECT 1 FROM signal_listening_prototype_runs owner
    JOIN signal_listening_preparations flow ON flow.id=owner.preparation_id AND flow.workspace_id=owner.workspace_id
    WHERE owner.run_id=NEW.target_id AND owner.workspace_id=NEW.workspace_id AND owner.actor_user_id=NEW.actor_user_id
     AND owner.policy_version_id=NEW.policy_version_id AND owner.cap_micro_usd=NEW.execution_cap_micro_usd
     AND NEW.provider='voyage' AND NEW.model='voyage-4-large' AND NEW.configuration=owner.plan->'embedding_profile'
     AND flow.planned_prototype_run_id=owner.run_id AND flow.prototype_cap_micro_usd=owner.cap_micro_usd
     AND flow.cap_micro_usd>owner.cap_micro_usd AND NOT NEW.automatic
     AND NEW.brand_context_processing_receipt_id IS NULL AND NEW.brand_context_prototype_receipt_id IS NULL
     AND signal_listening_prototype_plan_valid_v1(owner.workspace_id,owner.configuration_id,owner.plan))
    THEN RAISE EXCEPTION 'listening_prototype_admission_invalid';END IF;
   PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  ELSE
  SELECT * INTO child FROM signal_brand_context_prototype_receipts WHERE id=NEW.brand_context_prototype_receipt_id;
  IF child.id IS NULL OR ROW(child.parent_receipt_id,child.admission_id,child.run_id,child.workspace_id,child.organization_id,
    child.brand_id,child.actor_user_id,child.policy_version_id,child.idempotency_key,child.request_digest,child.execution_cap_micro_usd,
    child.budget_date,child.budget_timezone,child.admission_not_after)
   IS DISTINCT FROM ROW(NEW.brand_context_processing_receipt_id,NEW.id,NEW.target_id,NEW.workspace_id,NEW.organization_id,
    NEW.brand_id,NEW.actor_user_id,NEW.policy_version_id,NEW.idempotency_key,NEW.request_digest,NEW.execution_cap_micro_usd,
    NEW.budget_date,NEW.budget_timezone,NEW.admission_not_after) THEN
   RAISE EXCEPTION 'brand_context_prototype_receipt_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  END IF;
 ELSE
  IF NEW.brand_context_prototype_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_receipt_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.action='brand_context_proposal' THEN
   IF NEW.brand_context_processing_receipt_id IS NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_required' USING ERRCODE='23514'; END IF;
   PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  ELSE
   IF NEW.brand_context_processing_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_invalid' USING ERRCODE='23514'; END IF;
   IF NEW.action IN('topic_consolidation_numeric','topic_consolidation','topic_interpretation') THEN
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
  OR NEW.admission_not_after>(CASE WHEN NEW.action IN('mention_facets','concept_membership','topic_interpretation') THEN p.valid_until ELSE least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone)) END)
  OR NEW.admission_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(p.organization_id,NEW.budget_date,p.budget_timezone);
 IF NEW.execution_cap_micro_usd>0 AND exposure+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;


CREATE OR REPLACE FUNCTION guard_signal_topic_prototype_embedding_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_topics integer; expected_inputs integer; expected_unique integer;
BEGIN
 IF NEW.input_contract<>'topic_prototypes' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
 IF NEW.topic_input_snapshot->>'contract_version'='listening-prototype-v1' THEN
  IF NOT COALESCE(signal_listening_prototype_owner_valid_v1(NEW.id),false) THEN
   -- The row is not visible yet during BEFORE INSERT. Validate its complete
   -- pre-existing owner/admission here; the deferred owner checks the run too.
   IF NOT EXISTS(SELECT 1 FROM signal_listening_prototype_runs owner
    JOIN signal_processing_admissions admission ON admission.id=NEW.processing_admission_id
    WHERE owner.run_id=NEW.id AND owner.workspace_id=NEW.workspace_id AND owner.actor_user_id=NEW.actor_user_id
     AND NEW.taxonomy_profile_id IS NULL AND NEW.brand_context_preparation_operation_id IS NULL
     AND owner.plan=NEW.topic_input_snapshot AND owner.plan_digest=NEW.topic_input_digest
     AND NEW.profile=owner.plan->'embedding_profile' AND NEW.quote_digest=owner.quote_digest
     AND NEW.hard_cap_micro_usd=owner.cap_micro_usd AND admission.target_id=NEW.id
     AND admission.workspace_id=owner.workspace_id AND admission.actor_user_id=owner.actor_user_id
     AND admission.policy_version_id=owner.policy_version_id AND admission.action='topic_prototype_embeddings'
     AND admission.configuration=NEW.profile AND admission.execution_cap_micro_usd=NEW.hard_cap_micro_usd
     AND NOT admission.automatic AND signal_listening_prototype_plan_valid_v1(owner.workspace_id,owner.configuration_id,owner.plan)) THEN
    RAISE EXCEPTION 'listening_prototype_snapshot_invalid';END IF;
  END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=NEW.taxonomy_profile_id
   AND profile.workspace_id=NEW.workspace_id AND profile.kind='topic')
  OR NOT COALESCE(NEW.topic_input_snapshot->>'contract_version'='signal-workspace-topic-prototype-plan-v1'
   AND NEW.topic_input_snapshot->>'plan_digest'=NEW.topic_input_digest
   AND NEW.topic_input_snapshot->>'taxonomy_profile_id'=NEW.taxonomy_profile_id::text
   AND NEW.topic_input_snapshot->'embedding_profile'=NEW.profile
   AND jsonb_typeof(NEW.topic_input_snapshot->'topics')='array'
   AND jsonb_typeof(NEW.topic_input_snapshot->'inputs')='array'
   AND jsonb_typeof(NEW.topic_input_snapshot->'texts')='object',false)
  OR NEW.topic_input_digest<>'sha256:'||encode(sha256(convert_to(
    signal_semantic_context_canonical_json_v1(NEW.topic_input_snapshot-'plan_digest'),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Prototype input snapshot is invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT count(*),COALESCE(sum(jsonb_array_length(topic->'input_digests')),0) INTO expected_topics,expected_inputs
  FROM jsonb_array_elements(NEW.topic_input_snapshot->'topics') topic;
 expected_inputs:=expected_inputs+jsonb_array_length(COALESCE(NEW.topic_input_snapshot->'context_inputs','[]'::jsonb));
 SELECT count(*) INTO expected_unique FROM jsonb_object_keys(NEW.topic_input_snapshot->'texts');
 ELSE
  expected_topics:=(OLD.counts->>'total_topics')::integer;
  expected_inputs:=(OLD.counts->>'total_input_references')::integer;
  expected_unique:=(OLD.counts->>'total_unique_inputs')::integer;
 END IF;
 IF NOT COALESCE((NEW.counts->>'total_topics')::integer=expected_topics
   AND (NEW.counts->>'total_input_references')::integer=expected_inputs
   AND (NEW.counts->>'total_unique_inputs')::integer=expected_unique
   AND (NEW.counts->>'completed_topics')::integer>=0
   AND (NEW.counts->>'partial_topics')::integer>=0 AND (NEW.counts->>'pending_topics')::integer>=0
   AND (NEW.counts->>'completed_topics')::integer+(NEW.counts->>'partial_topics')::integer+(NEW.counts->>'pending_topics')::integer=expected_topics
   AND (NEW.counts->>'processed_input_references')::integer BETWEEN 0 AND expected_inputs
   AND (NEW.counts->>'processed_unique_inputs')::integer BETWEEN 0 AND expected_unique,false)
  OR NEW.counts ? 'eligible_roots' THEN
  RAISE EXCEPTION 'Prototype coverage counters are invalid.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'queued' OR NEW.cursor_input_sha256 IS NOT NULL
  OR (NEW.counts->>'processed_unique_inputs')::integer<>0) THEN
  RAISE EXCEPTION 'Prototype execution must start queued.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='completed' AND NEW.cursor_input_sha256 IS DISTINCT FROM OLD.cursor_input_sha256 THEN
  RAISE EXCEPTION 'Completed prototype cursor is immutable.' USING ERRCODE='55000'; END IF;
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' AND (
  (NEW.counts->>'completed_topics')::integer<>expected_topics
  OR (NEW.counts->>'processed_unique_inputs')::integer<>expected_unique
  OR (NEW.counts->>'processed_input_references')::integer<>expected_inputs
  OR EXISTS(SELECT 1 FROM jsonb_to_recordset(NEW.topic_input_snapshot->'inputs') input(input_digest text,text_sha256 text)
   LEFT JOIN signal_topic_definition_embeddings prototype ON prototype.workspace_id=NEW.workspace_id
    AND prototype.definition_digest=input.input_digest AND prototype.embedding_config_digest=NEW.config_digest
    AND prototype.input_text_sha256=input.text_sha256
   LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=NEW.workspace_id
    AND cache.config_digest=NEW.config_digest AND cache.chunk_sha256=input.text_sha256
   WHERE prototype.id IS NULL OR cache.chunk_sha256 IS NULL OR prototype.embedding<>cache.embedding)) THEN
  RAISE EXCEPTION 'Prototype coverage is incomplete.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;


CREATE OR REPLACE FUNCTION signal_listening_population_v1(w uuid,cid uuid,mid uuid,ctx text,purpose text DEFAULT 'llm-processing')
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH config AS MATERIALIZED(SELECT * FROM signal_listening_configurations WHERE workspace_id=w AND id=cid AND state='published'),
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 items AS MATERIALIZED(SELECT i.*,signal_listening_input_digest_v1(i) listening_input_digest,m.published_at,m.platform,
  signal_mass_labeling_r13_hashtags_v1(m.text_clean) hashtag_only,
  signal_mass_labeling_category_matches_v1(m.text_clean,ARRAY(SELECT jsonb_array_elements_text(c.configuration->'lexicon_terms'))) category_match
  FROM signal_mass_labeling_items i JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=w AND i.map_id=mid AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   AND signal_listening_root_right_v1(w,i.root_id,purpose)),
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)) basis,
   ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=cid AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=mid))) AND prototype.workspace_id=w
    JOIN signal_mass_labeling_maps map ON map.id=mid AND map.workspace_id=w
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=w AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.definition->>'topic_source'='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) defined_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  LEFT JOIN signal_listening_answers v ON v.workspace_id=w AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=ctx AND v.question_digest=vq.question_digest
  LEFT JOIN signal_listening_answers p ON p.workspace_id=w AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=ctx AND p.question_digest=pq.question_digest)
 SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key)
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.voice->>'choice'='individual' AND (i.promotion->>'noul')::double precision<=0.7 AND NOT i.hashtag_only AND i.category_match THEN 'included'
   ELSE 'excluded' END,
  a.answer,a.call_id,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END
 FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a ON a.workspace_id=w AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=ctx AND a.question_digest=q.question_digest
$$;

-- The compiler sends all eligible configured questions in one phase (up to256).
CREATE OR REPLACE FUNCTION signal_listening_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;c signal_listening_configurations;admission signal_processing_admissions;
 i jsonb;actual jsonb;expected jsonb;questions jsonb;digests jsonb;basis jsonb;selected_count integer;ctx text;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF owner.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,
      NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,
      OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
   OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
   OR OLD.status='settled' AND ROW(NEW.status,NEW.usage,NEW.settled_micro_usd) IS DISTINCT FROM ROW(OLD.status,OLD.usage,OLD.settled_micro_usd)
   OR OLD.status<>'reserved' AND NEW.status='reserved' THEN RAISE EXCEPTION 'listening_call_immutable'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  IF NEW.workspace_id<>owner.workspace_id OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp()
   OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0' OR NEW.transport<>'sync' OR NEW.reserved_micro_usd<=0
   OR jsonb_array_length(NEW.inputs)<>1 THEN RAISE EXCEPTION 'listening_call_invalid'; END IF;
  PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_processing_capacity_v1(r.workspace_id,r.actor_user_id,r.id,admission.id,ARRAY['mass_labeling_jev'],
    'typesafe','jev-1.13.0',admission.configuration,r.cap_micro_usd,'labeling',NEW.id,NEW.reserved_micro_usd,NEW.created_at);
  IF NEW.budget_date<>admission.budget_date OR NEW.budget_timezone<>admission.budget_timezone THEN RAISE EXCEPTION 'listening_budget_invalid'; END IF;
  i:=NEW.inputs->0;
  SELECT count(*)::int,jsonb_object_agg(p.question_key,p.wire),jsonb_object_agg(p.question_key,to_jsonb(p.question_digest)),
    COALESCE(jsonb_object_agg(p.question_key,to_jsonb(p.scope_basis)) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb)
   INTO selected_count,questions,digests,basis
   FROM signal_listening_population_v1(r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest) p
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
-- An ambiguous physical outcome cannot be retried with a new run key.
CREATE FUNCTION signal_listening_prior_outcome_unresolved_v1(w uuid,cid uuid,mid uuid,ctx text,except_run uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_listening_population_v1(w,cid,mid,ctx) pending
  JOIN signal_listening_call_questions link ON link.workspace_id=w AND link.root_id=pending.root_id AND link.question_digest=pending.question_digest
  JOIN signal_labeling_calls call ON call.workspace_id=w AND call.id=link.call_id
  JOIN signal_labeling_runs run ON run.id=call.run_id AND run.workspace_id=w AND run.entity_context_digest=ctx
  WHERE pending.answer IS NULL AND pending.candidate AND pending.scope_state<>'excluded' AND call.run_id IS DISTINCT FROM except_run
   AND call.inputs->0->>'input_digest'=pending.input_digest
   AND (call.status IN('submitting','submitted','unknown') OR call.terminal_exposure_micro_usd>0
    OR call.status='failed' AND COALESCE(call.settled_micro_usd,0)>0 OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied))
$$;
CREATE FUNCTION signal_listening_cross_run_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
 IF owner.run_id IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
  IF signal_listening_prior_outcome_unresolved_v1(NEW.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,r.id)
   THEN RAISE EXCEPTION 'listening_prior_outcome_unresolved';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_cross_run_call_guard BEFORE INSERT OR UPDATE ON signal_labeling_calls
 FOR EACH ROW EXECUTE FUNCTION signal_listening_cross_run_call_guard_v1();

CREATE OR REPLACE FUNCTION signal_listening_run_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_listening_configurations;r signal_labeling_runs;map signal_mass_labeling_maps;l signal_labeler_versions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND state='published';
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO l FROM signal_labeler_versions WHERE id=r.labeler_version_id;
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 IF signal_listening_prior_outcome_unresolved_v1(NEW.workspace_id,NEW.configuration_id,NEW.map_id,r.entity_context_digest,NEW.run_id) THEN RAISE EXCEPTION 'listening_prior_outcome_unresolved';END IF;
 IF cfg.id IS NULL OR r.id IS NULL OR map.id IS NULL OR NEW.configuration_digest IS DISTINCT FROM cfg.configuration_digest
  OR r.kind<>'mass_labeling' OR l.kind<>'mass_labeling' OR l.provider<>'typesafe' OR l.model<>'jev-1.13.0'
  OR l.identity#>>'{params,request_version}' IS DISTINCT FROM 'listening-jev-v1'
  OR l.identity#>'{params,configuration}' IS DISTINCT FROM cfg.configuration
  OR l.identity#>>'{params,configuration_digest}' IS DISTINCT FROM cfg.configuration_digest
  OR l.labeler_digest IS DISTINCT FROM signal_labeling_digest_v1(l.identity)
  OR r.entity_context_digest IS DISTINCT FROM map.entity_context_digest OR r.preparation_run_id IS DISTINCT FROM map.preparation_run_id
  OR r.membership_snapshot IS DISTINCT FROM jsonb_build_object('contract_version','signal-listening-run-v1','configuration_id',cfg.id,
   'configuration_digest',cfg.configuration_digest,'map_id',map.id,'map_digest',map.map_digest,'full_corpus',true)
  OR r.processing_admission_id IS NULL OR r.cap_micro_usd IS NULL OR r.cap_micro_usd<=0
  OR (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=cfg.id)<>jsonb_array_length(cfg.configuration->'questions')
  OR cfg.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published')
 THEN RAISE EXCEPTION 'listening_run_binding_invalid'; END IF;
 IF (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=cfg.id AND definition->>'topic_source'='defined')>8
  AND EXISTS(SELECT 1 FROM signal_listening_questions q LEFT JOIN signal_topic_definition_embeddings p ON p.id=COALESCE(q.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
     WHERE v.configuration_id=cfg.id AND v.question_key=q.question_key AND v.embedding_config_digest=map.embedding_config_digest))
   WHERE q.configuration_id=cfg.id AND q.definition->>'topic_source'='defined'
    AND (p.id IS NULL OR p.embedding_config_digest IS DISTINCT FROM map.embedding_config_digest)) THEN
  RAISE EXCEPTION 'listening_topic_prototype_required'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION signal_listening_vectors_ready_v1(w uuid,cid uuid,mid uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT (SELECT count(*)<=8 FROM signal_listening_questions WHERE configuration_id=cid AND workspace_id=w AND definition->>'topic_source'='defined')
 OR NOT EXISTS(SELECT 1 FROM signal_listening_questions q JOIN signal_mass_labeling_maps m ON m.workspace_id=w AND m.id=mid
  LEFT JOIN signal_listening_question_vectors v ON v.configuration_id=q.configuration_id AND v.question_key=q.question_key AND v.embedding_config_digest=m.embedding_config_digest
  LEFT JOIN signal_topic_definition_embeddings p ON p.id=COALESCE(q.prototype_embedding_id,v.prototype_embedding_id) AND p.workspace_id=w
  WHERE q.workspace_id=w AND q.configuration_id=cid AND q.definition->>'topic_source'='defined'
   AND (p.id IS NULL OR p.embedding_config_digest IS DISTINCT FROM m.embedding_config_digest))
$$;
CREATE FUNCTION signal_listening_preparation_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prototype signal_workspace_embedding_runs;labels signal_labeling_runs;confirmed bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'listening_history_immutable';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  IF NEW.status NOT IN('preparing','ready_for_labeling') OR NEW.prototype_run_id IS NOT NULL OR NEW.listening_run_id IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
   OR NEW.quote->>'contract_version' IS DISTINCT FROM 'signal-listening-preparation-quote-v1'
   OR NEW.quote->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
   OR NEW.quote->>'configuration_id' IS DISTINCT FROM NEW.configuration_id::text OR NEW.quote->>'map_id' IS DISTINCT FROM NEW.map_id::text
   OR NEW.quote->>'policy_version_id' IS DISTINCT FROM NEW.policy_version_id::text
   OR (NEW.quote#>>'{prototype_quote,estimated_upper_micro_usd}')::bigint IS DISTINCT FROM NEW.prototype_cap_micro_usd
   OR NOT EXISTS(SELECT 1 FROM signal_workspaces w JOIN signal_processing_policy_versions policy ON policy.organization_id=w.organization_id
    WHERE w.id=NEW.workspace_id AND policy.id=NEW.policy_version_id AND policy.status='active' AND policy.valid_from<=now() AND policy.valid_until>now())
   OR NEW.idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR NEW.request_digest !~ '^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'listening_preparation_invalid';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['prototype_run_id','listening_run_id','status','error_code','updated_at'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['prototype_run_id','listening_run_id','status','error_code','updated_at'])
   OR OLD.prototype_run_id IS NOT NULL AND NEW.prototype_run_id IS DISTINCT FROM OLD.prototype_run_id
   OR OLD.listening_run_id IS NOT NULL AND NEW.listening_run_id IS DISTINCT FROM OLD.listening_run_id
   THEN RAISE EXCEPTION 'listening_preparation_immutable';END IF;
 END IF;
 IF NEW.prototype_run_id IS NOT NULL THEN
  SELECT * INTO prototype FROM signal_workspace_embedding_runs WHERE id=NEW.prototype_run_id AND workspace_id=NEW.workspace_id;
  IF prototype.id IS NULL OR NOT COALESCE(signal_listening_prototype_owner_valid_v1(prototype.id),false)
   OR prototype.hard_cap_micro_usd<>NEW.prototype_cap_micro_usd THEN RAISE EXCEPTION 'listening_preparation_prototype_invalid';END IF;
 END IF;
 IF NEW.status IN('ready_for_labeling','labeling','completed') THEN
  IF NOT signal_listening_vectors_ready_v1(NEW.workspace_id,NEW.configuration_id,NEW.map_id)
   OR NEW.prototype_run_id IS NOT NULL AND (prototype.status<>'completed' OR prototype.reserved_micro_usd<>0
    OR prototype.unknown_reserved_micro_usd<>0 OR prototype.observed_exception_micro_usd<>0) THEN
   RAISE EXCEPTION 'listening_preparation_not_ready';END IF;
 END IF;
 IF NEW.listening_run_id IS NOT NULL THEN
  SELECT * INTO labels FROM signal_labeling_runs WHERE id=NEW.listening_run_id AND workspace_id=NEW.workspace_id;
  confirmed:=COALESCE(prototype.settled_micro_usd,0);
  IF labels.id IS NULL OR labels.actor_user_id<>NEW.actor_user_id OR labels.cap_micro_usd<>NEW.cap_micro_usd-confirmed
   OR NOT EXISTS(SELECT 1 FROM signal_listening_runs owner WHERE owner.run_id=labels.id AND owner.preparation_id=NEW.id
     AND owner.workspace_id=NEW.workspace_id AND owner.configuration_id=NEW.configuration_id AND owner.map_id=NEW.map_id)
   THEN RAISE EXCEPTION 'listening_preparation_cap_binding_invalid';END IF;
 END IF;
 IF NEW.status='labeling' AND NEW.listening_run_id IS NULL OR NEW.status='completed' AND labels.status IS DISTINCT FROM 'completed'
 THEN RAISE EXCEPTION 'listening_preparation_state_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_preparation_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_preparations
 FOR EACH ROW EXECUTE FUNCTION signal_listening_preparation_guard_v1();
CREATE FUNCTION signal_listening_preparation_label_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE flow signal_listening_preparations;labels signal_labeling_runs;spent bigint;
BEGIN
 IF NEW.preparation_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO flow FROM signal_listening_preparations WHERE id=NEW.preparation_id FOR UPDATE;
 SELECT * INTO labels FROM signal_labeling_runs WHERE id=NEW.run_id;
 SELECT COALESCE(settled_micro_usd,0) INTO spent FROM signal_workspace_embedding_runs WHERE id=flow.prototype_run_id;
 IF flow.id IS NULL OR flow.status<>'ready_for_labeling' OR flow.listening_run_id IS NOT NULL
  OR NEW.workspace_id<>flow.workspace_id OR NEW.configuration_id<>flow.configuration_id OR NEW.map_id<>flow.map_id
  OR labels.actor_user_id<>flow.actor_user_id OR labels.cap_micro_usd<>flow.cap_micro_usd-COALESCE(spent,0)
  OR NOT signal_listening_vectors_ready_v1(flow.workspace_id,flow.configuration_id,flow.map_id) THEN
  RAISE EXCEPTION 'listening_preparation_label_binding_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_preparation_label_guard BEFORE INSERT ON signal_listening_runs
 FOR EACH ROW EXECUTE FUNCTION signal_listening_preparation_label_guard_v1();
CREATE FUNCTION signal_listening_prototype_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_listening_prototype_runs WHERE run_id=NEW.run_id) THEN RETURN NEW;END IF;
 IF NOT COALESCE(signal_listening_prototype_owner_valid_v1(NEW.run_id),false) THEN RAISE EXCEPTION 'listening_prototype_call_owner_invalid';END IF;
 IF EXISTS(SELECT 1 FROM signal_workspace_embedding_calls prior WHERE prior.workspace_id=NEW.workspace_id AND prior.config_digest=NEW.config_digest
  AND prior.id<>NEW.id AND prior.input_keys&&NEW.input_keys AND prior.status<>'definitely_not_sent'
  AND (prior.status<>'settled' OR EXISTS(SELECT 1 FROM unnest(prior.input_keys) input(key) WHERE input.key=ANY(NEW.input_keys)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache WHERE cache.workspace_id=NEW.workspace_id
     AND cache.config_digest=NEW.config_digest AND cache.chunk_sha256=input.key)))) THEN
  RAISE EXCEPTION 'listening_prototype_prior_outcome_unresolved';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_prototype_call_guard BEFORE INSERT ON signal_workspace_embedding_calls
 FOR EACH ROW EXECUTE FUNCTION signal_listening_prototype_call_guard_v1();

-- Append-only calibration evidence. No synthetic tokenizer estimate is stored.
CREATE TABLE signal_listening_calibrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,source_run_id uuid NOT NULL,
 scope_digest text NOT NULL,source_digest text NOT NULL,profile jsonb NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(scope_digest,source_digest),FOREIGN KEY(workspace_id,source_run_id) REFERENCES signal_listening_runs(workspace_id,run_id)
);
CREATE INDEX signal_listening_calibration_lookup ON signal_listening_calibrations(workspace_id,
 (profile#>>'{scope,configuration_digest}'),(profile#>>'{scope,model}'),(profile#>>'{scope,shape_digest}'),created_at DESC,id DESC);
CREATE FUNCTION signal_listening_calibration_shape_v1(configuration jsonb,keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH selected AS(SELECT q FROM jsonb_array_elements(configuration->'questions') q WHERE q->>'key'=ANY(keys)),
 descriptors AS(SELECT jsonb_build_object('type',q->>'type','scope',q->>'scope','topic_source',q->'topic_source',
  'option_count',CASE WHEN q->>'type'='choice' THEN jsonb_array_length(q->'options') ELSE 0 END) d FROM selected),
 shape AS(SELECT jsonb_build_object('compiler_version','listening-jev-v1','model',configuration->>'model',
  'phase',(SELECT CASE WHEN bool_and(q->>'origin'='base') THEN 'base' WHEN bool_and(q->>'scope'='all') THEN 'all'
   WHEN bool_and(q->>'scope'='consumer_category') THEN 'consumer_category' ELSE 'mixed' END FROM selected),
  'questions',jsonb_agg(d ORDER BY signal_labeling_digest_v1(d))) value FROM descriptors HAVING count(*)=cardinality(keys) AND count(*)>0)
 SELECT value||jsonb_build_object('shape_digest',signal_labeling_digest_v1(value)) FROM shape
$$;
CREATE FUNCTION signal_listening_calibration_evidence_v1(w uuid,target uuid,shape_digest text) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH owner AS(SELECT o.*,cfg.configuration,r.entity_context_digest,r.actor_user_id,r.processing_admission_id
  FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id
  JOIN signal_listening_configurations cfg ON cfg.id=o.configuration_id AND cfg.workspace_id=o.workspace_id
  JOIN signal_processing_admissions a ON a.id=r.processing_admission_id AND a.workspace_id=w AND a.target_id=r.id
   AND a.actor_user_id=r.actor_user_id AND a.action='mass_labeling_jev' AND a.provider='typesafe' AND a.model='jev-1.13.0'
  WHERE o.workspace_id=w AND o.run_id=target),
 recent AS MATERIALIZED(SELECT c.id,c.request_digest,c.raw_sha256,c.usage,c.created_at,
  octet_length(convert_to(signal_labeling_json_v1(c.request),'UTF8')) request_bytes,
  (c.usage->>'input_tokens')::bigint input_tokens,shape.value shape
  FROM owner o JOIN signal_labeling_calls c ON c.workspace_id=o.workspace_id AND c.run_id=o.run_id
  CROSS JOIN LATERAL(SELECT signal_listening_calibration_shape_v1(o.configuration,ARRAY(SELECT jsonb_object_keys(c.request->'questions'))) value) shape
  WHERE c.provider='typesafe' AND c.model='jev-1.13.0' AND c.status='settled' AND c.settled_micro_usd IS NOT NULL
   AND c.raw_sha256 IS NOT NULL AND c.raw_storage_verified_at IS NOT NULL AND c.raw_storage_verified_key=c.raw_storage_key
   AND c.results_applied AND jsonb_array_length(c.inputs)=1 AND jsonb_array_length(c.results)=1 AND c.results->0->>'status' IN('labeled','abstained')
   AND c.inputs->0->>'configuration_digest'=o.configuration_digest
   AND c.inputs->0->>'map_id'=o.map_id::text AND c.results->0->>'entity_context_digest'=o.entity_context_digest
   AND (c.usage->>'input_tokens')~'^[1-9][0-9]*$' AND shape.value->>'shape_digest'=$3
   AND EXISTS(SELECT 1 FROM signal_listening_call_questions link WHERE link.call_id=c.id AND link.run_id=o.run_id AND link.workspace_id=w)
  ORDER BY c.created_at DESC,c.id DESC LIMIT 32),
 aggregate AS(SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC) ids,min(request_bytes) lo,max(request_bytes) hi,
  max(input_tokens::numeric/request_bytes::numeric)*1.25 ratio,count(*) n,
  jsonb_agg(jsonb_build_object('call_id',id,'request_digest',request_digest,'raw_sha256',raw_sha256,'usage',usage,'request_bytes',request_bytes)
   ORDER BY created_at DESC,id DESC) receipts FROM recent WHERE request_bytes>0),
 scoped AS(SELECT jsonb_build_object('workspace_id',o.workspace_id,'configuration_digest',o.configuration_digest,
  'model',o.configuration->>'model','compiler_version','listening-jev-v1','shape_digest',$3,
  'phase',(SELECT shape->>'phase' FROM recent LIMIT 1)) value FROM owner o),
 profile AS(SELECT jsonb_build_object('scope',scoped.value,'scope_digest',signal_labeling_digest_v1(scoped.value),
  'source_digest',signal_labeling_digest_v1(jsonb_build_object('source_run_id',target,'receipts',a.receipts)),
  'source_call_ids',a.ids,'source_run_id',target,'request_min_bytes',a.lo,'request_max_bytes',a.hi,
  'max_input_tokens_per_byte',a.ratio,'sample_count',a.n,'status','measured') value FROM aggregate a CROSS JOIN scoped WHERE a.n>0)
 SELECT value FROM profile
$$;
CREATE FUNCTION signal_listening_calibration_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 IF NOT EXISTS(SELECT 1 FROM signal_labeling_runs r JOIN signal_listening_runs o ON o.run_id=r.id AND o.workspace_id=r.workspace_id
  WHERE r.id=NEW.source_run_id AND r.workspace_id=NEW.workspace_id AND r.actor_user_id=NEW.created_by_user_id)
 THEN RAISE EXCEPTION 'listening_calibration_owner_invalid';END IF;
 expected:=signal_listening_calibration_evidence_v1(NEW.workspace_id,NEW.source_run_id,NEW.profile#>>'{scope,shape_digest}');
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.profile OR NEW.scope_digest IS DISTINCT FROM expected->>'scope_digest'
  OR NEW.source_digest IS DISTINCT FROM expected->>'source_digest' THEN RAISE EXCEPTION 'listening_calibration_evidence_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_calibration_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_calibrations
 FOR EACH ROW EXECUTE FUNCTION signal_listening_calibration_guard_v1();

DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_preparations','signal_listening_prototype_runs','signal_listening_question_vectors','signal_listening_calibrations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'signal_listening_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
END $$;
