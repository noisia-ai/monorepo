-- Prototype inputs share the existing physical embedding/cost ledger. They do not
-- create a corpus, prepared mention, classification, publication or provider call.
ALTER TABLE signal_workspace_embedding_runs
 ADD COLUMN input_contract text NOT NULL DEFAULT 'corpus' CHECK(input_contract IN('corpus','topic_prototypes')),
 ALTER COLUMN preparation_run_id DROP NOT NULL,
 ALTER COLUMN input_revision DROP NOT NULL,
 ADD COLUMN taxonomy_profile_id uuid REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
 ADD COLUMN topic_input_snapshot jsonb,
 ADD COLUMN topic_input_digest text CHECK(topic_input_digest~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN cursor_input_sha256 text CHECK(cursor_input_sha256~'^sha256:[0-9a-f]{64}$'),
 ADD CONSTRAINT workspace_embedding_input_contract CHECK(
  (input_contract='corpus' AND preparation_run_id IS NOT NULL AND input_revision IS NOT NULL
   AND taxonomy_profile_id IS NULL AND topic_input_snapshot IS NULL AND topic_input_digest IS NULL AND cursor_input_sha256 IS NULL)
  OR COALESCE((input_contract='topic_prototypes' AND preparation_run_id IS NULL AND input_revision IS NULL
   AND taxonomy_profile_id IS NOT NULL AND jsonb_typeof(topic_input_snapshot)='object' AND topic_input_digest IS NOT NULL
   AND cursor_asset_sha256 IS NULL AND cursor_chunk_index IS NULL),false));

ALTER TABLE signal_topic_definition_embeddings ADD COLUMN source_embedding_call_id uuid,
 ADD CONSTRAINT topic_prototype_physical_receipt FOREIGN KEY(workspace_id,source_embedding_call_id)
  REFERENCES signal_workspace_embedding_calls(workspace_id,id) ON DELETE RESTRICT;

-- Compare sealed columns directly. Serializing run.* would copy a complete Topic
-- context on every heartbeat or monetary counter update.
CREATE OR REPLACE FUNCTION guard_signal_workspace_embedding_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Embedding execution history is retained.' USING ERRCODE='55000'; END IF;
 IF NOT OLD.request_keys <@ NEW.request_keys THEN
  RAISE EXCEPTION 'Embedding request keys are append-only.' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.workspace_id,NEW.preparation_run_id,NEW.actor_user_id,NEW.input_revision,NEW.policy_valid_until,
   NEW.profile,NEW.config_digest,NEW.quote_digest,NEW.hard_cap_micro_usd,NEW.estimated_upper_micro_usd,NEW.created_at,
   NEW.input_contract,NEW.taxonomy_profile_id,NEW.topic_input_digest,NEW.topic_input_snapshot)
  IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.preparation_run_id,OLD.actor_user_id,OLD.input_revision,OLD.policy_valid_until,
   OLD.profile,OLD.config_digest,OLD.quote_digest,OLD.hard_cap_micro_usd,OLD.estimated_upper_micro_usd,OLD.created_at,
   OLD.input_contract,OLD.taxonomy_profile_id,OLD.topic_input_digest,OLD.topic_input_snapshot) THEN
  RAISE EXCEPTION 'Embedding input and budget seal is immutable.' USING ERRCODE='23514'; END IF;
 IF OLD.status='completed' AND (NEW.status<>'completed' OR NEW.counts IS DISTINCT FROM OLD.counts
  OR NEW.cursor_asset_sha256 IS DISTINCT FROM OLD.cursor_asset_sha256 OR NEW.cursor_chunk_index IS DISTINCT FROM OLD.cursor_chunk_index
  OR NEW.cursor_input_sha256 IS DISTINCT FROM OLD.cursor_input_sha256) THEN
  RAISE EXCEPTION 'Completed embedding execution is immutable.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION guard_signal_topic_prototype_embedding_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER trg_workspace_topic_prototype_run BEFORE INSERT OR UPDATE ON signal_workspace_embedding_runs
 FOR EACH ROW EXECUTE FUNCTION guard_signal_topic_prototype_embedding_run_v1();

CREATE FUNCTION guard_signal_topic_prototype_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_embedding_call_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache
  JOIN signal_workspace_embedding_calls call ON call.id=cache.call_id AND call.workspace_id=cache.workspace_id
  WHERE cache.workspace_id=NEW.workspace_id AND cache.config_digest=NEW.embedding_config_digest
   AND cache.chunk_sha256=NEW.input_text_sha256 AND cache.call_id=NEW.source_embedding_call_id
   AND cache.embedding=NEW.embedding AND call.status='settled')
  OR NEW.provider<>'voyage' OR NEW.embedding_model<>'voyage-4-large' THEN
  RAISE EXCEPTION 'Prototype alias does not match a settled physical embedding.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_topic_prototype_receipt BEFORE INSERT ON signal_topic_definition_embeddings
 FOR EACH ROW EXECUTE FUNCTION guard_signal_topic_prototype_receipt_v1();
REVOKE ALL ON FUNCTION guard_signal_topic_prototype_embedding_run_v1(),guard_signal_topic_prototype_receipt_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_topic_prototype_embedding_run_v1(),guard_signal_topic_prototype_receipt_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

-- Search consumes complete corpus embeddings only, never an interest preparation run.
CREATE OR REPLACE FUNCTION guard_workspace_topic_execution_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-computation-v1' THEN RAISE EXCEPTION 'Workspace topic evidence is retained.' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.input_contract='workspace-topic-computation-v1' THEN
  IF (to_jsonb(NEW)-ARRAY['status','progress','result_summary','error_code','heartbeat_at','started_at','completed_at','updated_at',
   'execution_token','execution_expires_at','cursor_root_id','processed_roots','processed_chunks','dispatch_generation'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','progress','result_summary','error_code','heartbeat_at','started_at','completed_at','updated_at',
   'execution_token','execution_expires_at','cursor_root_id','processed_roots','processed_chunks','dispatch_generation']) THEN
   RAISE EXCEPTION 'Workspace topic input snapshot is immutable.' USING ERRCODE='23514'; END IF;
  IF OLD.status='ready' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Complete workspace topic evidence is immutable.' USING ERRCODE='55000'; END IF;
 ELSIF TG_OP='UPDATE' AND NEW.input_contract<>OLD.input_contract THEN
  RAISE EXCEPTION 'Topic input authority cannot be converted in place.' USING ERRCODE='23514';
 END IF;
 IF NEW.input_contract<>'workspace-topic-computation-v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE id=NEW.embedding_run_id AND workspace_id=NEW.workspace_id;
  IF embedded.id IS NULL OR embedded.input_contract<>'corpus' OR embedded.status<>'completed' OR embedded.preparation_run_id<>NEW.preparation_run_id
   OR embedded.input_revision<>NEW.input_revision OR embedded.config_digest<>NEW.embedding_config_digest
   OR embedded.policy_valid_until IS DISTINCT FROM NEW.policy_valid_until
   OR NEW.denominator<>(embedded.counts->>'eligible_roots')::integer
   OR NEW.expected_chunks<>(embedded.counts->>'total_chunk_references')::bigint
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-computation-v1'
    AND NEW.input_snapshot->'embedding_profile'->>'config_digest'=NEW.embedding_config_digest
    AND NEW.input_snapshot->'algorithm_profile'->>'approval_policy'='none'
    AND NEW.input_snapshot->'algorithm_profile'->>'scoring_policy'='chunk-local-contrast-ranking-v1'
    AND NEW.input_snapshot->'algorithm_profile'->>'embedding_config_digest'=NEW.embedding_config_digest
    AND jsonb_typeof(NEW.input_snapshot->'topics')='array',false)
   OR NEW.status<>'queued' OR NEW.processed_roots<>0 OR NEW.processed_chunks<>0 OR NEW.cursor_root_id IS NOT NULL THEN
   RAISE EXCEPTION 'Workspace topic input authority is invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' AND (NEW.processed_roots<>NEW.denominator OR NEW.processed_chunks<>NEW.expected_chunks
  OR NEW.completed_at IS NULL OR (SELECT count(*) FROM signal_topic_classification_items WHERE execution_id=NEW.id)<>NEW.denominator
  OR (SELECT COALESCE(sum((computation_evidence->>'processed_chunks')::bigint),0) FROM signal_topic_classification_items WHERE execution_id=NEW.id)<>NEW.expected_chunks) THEN
  RAISE EXCEPTION 'Workspace topic coverage is incomplete.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
