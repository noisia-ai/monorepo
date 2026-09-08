-- Complete workspace engine inputs and private fitted artifacts. No semantic approval,
-- new population, assignment authority, provider call, or corpus copy is created.
ALTER TABLE signal_topic_catalog_executions ADD COLUMN engine_request_keys jsonb;

ALTER TABLE signal_topic_catalog_executions DROP CONSTRAINT workspace_topic_input_shape,
 ADD CONSTRAINT workspace_topic_input_shape CHECK(
  (input_contract='legacy-topic-catalog-v1' AND study_corpus_id IS NOT NULL AND watermark_digest IS NOT NULL
   AND embedding_run_id IS NULL AND preparation_run_id IS NULL AND input_snapshot IS NULL AND input_digest IS NULL)
  OR COALESCE((input_contract='workspace-topic-computation-v1' AND study_corpus_id IS NULL AND watermark_digest IS NOT NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NULL
   AND source_execution_id IS NULL AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL
   AND input_revision>0 AND embedding_config_digest~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(input_snapshot)='object' AND input_digest~'^sha256:[0-9a-f]{64}$'
   AND expected_chunks>=0 AND processed_roots<=denominator AND processed_chunks<=expected_chunks),false)
  OR COALESCE((input_contract='workspace-topic-classification-v1' AND study_corpus_id IS NULL AND watermark_digest IS NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NOT NULL AND source_execution_id IS NULL
   AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL AND input_revision>0
   AND embedding_config_digest~'^sha256:[0-9a-f]{64}$' AND jsonb_typeof(input_snapshot)='object'
   AND input_digest~'^sha256:[0-9a-f]{64}$' AND expected_chunks>=0 AND processed_roots<=denominator
   AND processed_chunks<=expected_chunks),false)
  OR COALESCE((input_contract='workspace-topic-engine-v1' AND study_corpus_id IS NULL AND watermark_digest IS NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NULL AND source_execution_id IS NULL
   AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL AND input_revision>0
   AND embedding_config_digest~'^sha256:[0-9a-f]{64}$' AND jsonb_typeof(input_snapshot)='object'
   AND input_digest~'^sha256:[0-9a-f]{64}$' AND expected_chunks>=0 AND processed_roots<=denominator
   AND processed_chunks<=expected_chunks),false));

ALTER TABLE analysis_artifacts ADD COLUMN engine_execution_id uuid,
 ADD CONSTRAINT workspace_engine_artifact_execution FOREIGN KEY(workspace_id,engine_execution_id)
  REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT;
CREATE INDEX idx_workspace_engine_artifacts ON analysis_artifacts(engine_execution_id,artifact_key,id)
 WHERE engine_execution_id IS NOT NULL;
CREATE INDEX idx_workspace_engine_ready ON signal_topic_catalog_executions(workspace_id,completed_at DESC,id DESC)
 WHERE input_contract='workspace-topic-engine-v1' AND status='ready';

CREATE FUNCTION guard_signal_workspace_engine_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-engine-v1' THEN RAISE EXCEPTION 'Engine history is retained.' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.input_contract<>'workspace-topic-engine-v1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.workspace_id,NEW.actor_user_id,NEW.taxonomy_profile_id,NEW.embedding_run_id,NEW.preparation_run_id,
    NEW.input_revision,NEW.embedding_config_digest,NEW.input_snapshot,NEW.input_digest,NEW.policy_valid_until,
    NEW.request_digest,NEW.idempotency_key,NEW.population_digest,NEW.identity_catalog_digest,NEW.definition_digest,
    NEW.denominator,NEW.expected_chunks,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.actor_user_id,OLD.taxonomy_profile_id,OLD.embedding_run_id,OLD.preparation_run_id,
    OLD.input_revision,OLD.embedding_config_digest,OLD.input_snapshot,OLD.input_digest,OLD.policy_valid_until,
    OLD.request_digest,OLD.idempotency_key,OLD.population_digest,OLD.identity_catalog_digest,OLD.definition_digest,
    OLD.denominator,OLD.expected_chunks,OLD.created_at) THEN
   RAISE EXCEPTION 'Engine snapshot is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT OLD.engine_request_keys <@ NEW.engine_request_keys THEN
   RAISE EXCEPTION 'Engine request keys are append-only.' USING ERRCODE='23514'; END IF;
  IF OLD.status='ready' AND (to_jsonb(NEW)-'engine_request_keys') IS DISTINCT FROM (to_jsonb(OLD)-'engine_request_keys') THEN
   RAISE EXCEPTION 'Complete engine evidence is immutable.' USING ERRCODE='55000'; END IF;
 ELSE
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.embedding_run_id;
  IF embedded.id IS NULL OR embedded.input_contract<>'corpus' OR embedded.status<>'completed'
   OR embedded.preparation_run_id<>NEW.preparation_run_id OR embedded.input_revision<>NEW.input_revision
   OR embedded.config_digest<>NEW.embedding_config_digest OR embedded.policy_valid_until IS DISTINCT FROM NEW.policy_valid_until
   OR NEW.denominator<>(embedded.counts->>'eligible_roots')::bigint
   OR NEW.expected_chunks<>(embedded.counts->>'total_chunk_references')::bigint
   OR NEW.status<>'queued' OR NEW.processed_roots<>0 OR NEW.processed_chunks<>0
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-engine-v1'
     AND NEW.input_snapshot->>'workspace_id'=NEW.workspace_id::text
     AND NEW.input_snapshot->>'taxonomy_profile_id'=NEW.taxonomy_profile_id::text
     AND NEW.input_snapshot->'embedding_profile'=embedded.profile
     AND jsonb_typeof(NEW.input_snapshot->'guides')='array'
     AND jsonb_typeof(NEW.engine_request_keys)='object',false) THEN
   RAISE EXCEPTION 'Engine input authority is invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' AND (NEW.processed_roots<>NEW.denominator OR NEW.processed_chunks<>NEW.expected_chunks
  OR NEW.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact
    WHERE artifact.engine_execution_id=NEW.id AND artifact.artifact_type='engine_output')
  OR NOT COALESCE((NEW.result_summary->>'result_kind'='insufficient_population' AND NEW.result_summary->>'model_version_id' IS NULL)
    OR (NEW.result_summary->>'result_kind'='computational_grouping' AND EXISTS(
      SELECT 1 FROM tagging_model_versions model JOIN analysis_artifacts artifact ON artifact.engine_execution_id=NEW.id
       AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=model.artifact_digest
      WHERE model.id::text=NEW.result_summary->>'model_version_id'
       AND model.configuration->>'execution_id'=NEW.id::text AND model.configuration->>'contract_version'='workspace-topic-engine-v1')),false)) THEN
  RAISE EXCEPTION 'Engine coverage or fitted model is incomplete.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_engine_v1();

CREATE FUNCTION guard_signal_workspace_engine_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR execution.status<>'running'
  OR NEW.workspace_artifact_kind<>'topic_discovery' OR NEW.discovery_run_digest<>'sha256:'||encode(sha256(convert_to(execution.input_digest||':'||execution.id::text,'UTF8')),'hex')
  OR NEW.review_status<>'draft' OR NEW.artifact_type NOT IN('engine_model','engine_output','engine_proposals')
  OR NOT COALESCE(NEW.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (NEW.content->>'size_bytes')::bigint>=0
    AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||execution.id::text||'/%',false)
  OR pg_column_size(NEW.content)>65536 OR pg_column_size(NEW.metadata)>65536 THEN
  RAISE EXCEPTION 'Engine artifact authority is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_engine_artifact BEFORE INSERT ON analysis_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_engine_artifact_v1();

CREATE OR REPLACE FUNCTION guard_signal_topic_prototype_embedding_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_topics integer; expected_inputs integer; expected_unique integer;
BEGIN
 IF NEW.input_contract<>'topic_prototypes' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
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

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-engine-v1' AND NOT EXISTS(
    SELECT 1 FROM signal_topic_catalog_executions execution
    JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
    WHERE execution.id::text=NEW.configuration->>'execution_id' AND execution.input_contract='workspace-topic-engine-v1'
     AND execution.status='running' AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id
     AND execution.actor_user_id=NEW.registered_by_user_id
     AND signal_workspace_classification_actor_v1(execution.workspace_id,NEW.registered_by_user_id)
     AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest) THEN
   RAISE EXCEPTION 'Native fitted model authority is invalid.' USING ERRCODE='23514'; END IF;

  SELECT workspace_id INTO target_workspace_id FROM signal_taxonomy_profiles
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status='draft'
      AND NEW.configuration->>'contract_version'='workspace-topic-engine-v1'
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
       JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
       WHERE execution.id::text=NEW.configuration->>'execution_id'
        AND execution.input_contract='workspace-topic-engine-v1' AND execution.status='running'
        AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id AND execution.actor_user_id=NEW.registered_by_user_id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest)));
  IF target_workspace_id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,NEW.registered_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.registry_operation_id AND operation.workspace_id=target_workspace_id
         AND operation.operation_kind='register-model' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.registered_by_user_id)
     OR (NEW.supersedes_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions prior
       WHERE prior.id=NEW.supersedes_model_version_id
         AND prior.registry_contract_version='signal-tagging-model-registry-v1'
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.model_key=NEW.model_key AND prior.version<>NEW.version)) THEN
    RAISE EXCEPTION 'Tagging model registry authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION guard_signal_workspace_engine_v1(),guard_signal_workspace_engine_artifact_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_workspace_engine_v1(),guard_signal_workspace_engine_artifact_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
