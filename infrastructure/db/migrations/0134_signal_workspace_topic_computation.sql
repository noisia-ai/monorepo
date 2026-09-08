-- Workspace-native search evidence uses the existing Topics catalog and execution
-- ledger. It neither creates final assignments nor changes serving/publication.
-- Evidence offsets are UTF-16, while PostgreSQL substring indexes code points.
-- Only the bounded fragment leaves PostgreSQL, including for assets larger than
-- the optional Worker text cache. Invalid/split boundaries never get clipped.
CREATE FUNCTION signal_topic_utf16_fragment_v1(source_text text,start0 integer,end0 integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE character_count integer; astral_count integer; lower_bound integer; upper_bound integer;
 middle integer; position_utf16 bigint; start_character integer; fragment text;
 fragment_characters integer; offset_utf16 integer:=0; wanted integer;
BEGIN
 IF start0<0 OR end0<start0 OR end0::bigint-start0>1400 THEN
  RAISE EXCEPTION 'Invalid UTF-16 evidence range.' USING ERRCODE='22023'; END IF;
 character_count:=char_length(source_text);
 astral_count:=regexp_count(source_text,U&'[\+010000-\+10FFFF]');
 IF end0::bigint>character_count::bigint+astral_count THEN
  RAISE EXCEPTION 'UTF-16 evidence range exceeds the text.' USING ERRCODE='22023'; END IF;
 IF astral_count=0 THEN RETURN substring(source_text FROM start0+1 FOR end0-start0); END IF;
 lower_bound:=greatest(0,start0-astral_count); upper_bound:=least(start0,character_count);
 WHILE lower_bound<=upper_bound LOOP
  middle:=lower_bound+(upper_bound-lower_bound)/2;
  position_utf16:=middle::bigint+regexp_count(left(source_text,middle),U&'[\+010000-\+10FFFF]');
  IF position_utf16=start0 THEN start_character:=middle; EXIT;
  ELSIF position_utf16<start0 THEN lower_bound:=middle+1;
  ELSE upper_bound:=middle-1; END IF;
 END LOOP;
 IF start_character IS NULL THEN
  RAISE EXCEPTION 'UTF-16 evidence range splits a surrogate pair.' USING ERRCODE='22023'; END IF;
 wanted:=end0-start0;
 IF wanted=0 THEN RETURN ''; END IF;
 fragment:=substring(source_text FROM start_character+1 FOR wanted);
 fragment_characters:=char_length(fragment);
 FOR i IN 1..fragment_characters LOOP
  offset_utf16:=offset_utf16+CASE WHEN ascii(substring(fragment FROM i FOR 1))>65535 THEN 2 ELSE 1 END;
  IF offset_utf16=wanted THEN RETURN left(fragment,i); END IF;
  IF offset_utf16>wanted THEN
   RAISE EXCEPTION 'UTF-16 evidence range splits a surrogate pair.' USING ERRCODE='22023'; END IF;
 END LOOP;
 RAISE EXCEPTION 'UTF-16 evidence range exceeds the text.' USING ERRCODE='22023';
END; $$;

ALTER TABLE signal_topic_catalog_executions
 ALTER COLUMN study_corpus_id DROP NOT NULL,
 ADD COLUMN input_contract text NOT NULL DEFAULT 'legacy-topic-catalog-v1',
 ADD COLUMN embedding_run_id uuid,
 ADD COLUMN preparation_run_id uuid,
 ADD COLUMN input_revision bigint,
 ADD COLUMN embedding_config_digest text,
 ADD COLUMN input_snapshot jsonb,
 ADD COLUMN input_digest text,
 ADD COLUMN policy_valid_until timestamptz,
 ADD COLUMN execution_token uuid,
 ADD COLUMN execution_expires_at timestamptz,
 ADD COLUMN cursor_root_id uuid,
 ADD COLUMN processed_roots integer NOT NULL DEFAULT 0 CHECK(processed_roots>=0),
 ADD COLUMN processed_chunks bigint NOT NULL DEFAULT 0 CHECK(processed_chunks>=0),
 ADD COLUMN expected_chunks bigint,
 ADD COLUMN dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),
 ADD CONSTRAINT workspace_topic_embedding_fk FOREIGN KEY(workspace_id,embedding_run_id)
  REFERENCES signal_workspace_embedding_runs(workspace_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_topic_preparation_fk FOREIGN KEY(workspace_id,preparation_run_id)
  REFERENCES signal_corpus_preparation_runs(workspace_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_topic_input_shape CHECK(
  (input_contract='legacy-topic-catalog-v1' AND study_corpus_id IS NOT NULL
   AND embedding_run_id IS NULL AND preparation_run_id IS NULL AND input_snapshot IS NULL AND input_digest IS NULL)
  OR COALESCE((input_contract='workspace-topic-computation-v1' AND study_corpus_id IS NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NULL
   AND source_execution_id IS NULL AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL
   AND input_revision>0 AND embedding_config_digest~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(input_snapshot)='object' AND input_digest~'^sha256:[0-9a-f]{64}$'
   AND expected_chunks>=0 AND processed_roots<=denominator AND processed_chunks<=expected_chunks),false)),
 ADD CONSTRAINT workspace_topic_execution_lease CHECK((execution_token IS NULL)=(execution_expires_at IS NULL));
CREATE INDEX idx_workspace_topic_ready ON signal_topic_catalog_executions(workspace_id,completed_at DESC,id DESC)
 WHERE input_contract='workspace-topic-computation-v1' AND status='ready';

ALTER TABLE signal_topic_classification_items ADD COLUMN computation_evidence jsonb;
ALTER TABLE signal_topic_classification_suggestions ADD COLUMN computation_evidence jsonb;
ALTER TABLE signal_topic_definition_embeddings
 ADD COLUMN embedding_config_digest text CHECK(embedding_config_digest~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN input_text_sha256 text CHECK(input_text_sha256~'^sha256:[0-9a-f]{64}$'),
 ADD CONSTRAINT topic_definition_complete_profile CHECK((embedding_config_digest IS NULL)=(input_text_sha256 IS NULL));
CREATE UNIQUE INDEX uq_topic_definition_profile ON signal_topic_definition_embeddings(workspace_id,embedding_config_digest,definition_digest)
 WHERE embedding_config_digest IS NOT NULL;

CREATE FUNCTION guard_workspace_topic_execution_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF embedded.id IS NULL OR embedded.status<>'completed' OR embedded.preparation_run_id<>NEW.preparation_run_id
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
CREATE TRIGGER trg_workspace_topic_execution BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_topic_execution_v1();

CREATE FUNCTION guard_workspace_topic_search_evidence_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
DECLARE root_item signal_corpus_preparation_items%ROWTYPE;
BEGIN
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.execution_id ELSE NEW.execution_id END;
 IF execution.input_contract<>'workspace-topic-computation-v1' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Workspace topic results are immutable.' USING ERRCODE='55000'; END IF;
 SELECT * INTO root_item FROM signal_corpus_preparation_items item WHERE item.run_id=execution.preparation_run_id
  AND item.workspace_id=NEW.workspace_id AND item.root_id=NEW.canonical_root_id AND item.disposition='eligible';
 IF execution.status<>'running' OR execution.workspace_id<>NEW.workspace_id OR root_item.root_id IS NULL
  OR NOT COALESCE(jsonb_typeof(NEW.computation_evidence)='object'
   AND NEW.computation_evidence->>'embedding_config_digest'=execution.embedding_config_digest
   AND NEW.computation_evidence->>'asset_sha256'=root_item.asset_sha256
   AND NEW.computation_evidence->>'quality'='uncalibrated' AND NEW.computation_evidence->>'approval_policy'='none',false) THEN
  RAISE EXCEPTION 'Workspace topic result authority is invalid.' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='signal_topic_classification_suggestions' THEN
  IF NEW.disposition<>'doubt' OR NEW.method<>'semantic' OR NEW.lexical_match OR NEW.excluded_by_rule OR NEW.excluded_by_negative
   OR NEW.semantic_score IS NULL OR NEW.semantic_score NOT BETWEEN -1 AND 1
   OR NEW.negative_semantic_score IS NOT NULL AND NEW.negative_semantic_score NOT BETWEEN -1 AND 1 THEN
   RAISE EXCEPTION 'Workspace topic evidence is retrieval only.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.resolution_state NOT IN('doubt','not_relevant') OR NOT COALESCE(
    NEW.computation_evidence->>'root_fingerprint'=root_item.fingerprint
    AND (NEW.computation_evidence->>'processed_chunks')::bigint=(
     SELECT jsonb_array_length(chunks->'chunks') FROM signal_corpus_text_assets
     WHERE workspace_id=root_item.workspace_id AND text_sha256=root_item.asset_sha256 AND chunk_policy_version=root_item.chunk_policy_version),false) THEN
   RAISE EXCEPTION 'Workspace topic root coverage is invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_topic_item_evidence BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_classification_items
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_topic_search_evidence_v1();
CREATE TRIGGER trg_workspace_topic_suggestion_evidence BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_classification_suggestions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_topic_search_evidence_v1();
CREATE FUNCTION guard_workspace_topic_prototype_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.embedding_config_digest IS NOT NULL THEN
  RAISE EXCEPTION 'Versioned Topic prototypes are immutable.' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND NEW.embedding_config_digest IS NOT NULL THEN
  RAISE EXCEPTION 'Legacy Topic prototypes cannot claim complete provenance.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER trg_workspace_topic_prototype BEFORE UPDATE OR DELETE ON signal_topic_definition_embeddings
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_topic_prototype_v1();
ALTER TABLE signal_topic_catalog_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_classification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_classification_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_definition_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_topic_catalog_executions,signal_topic_classification_items,signal_topic_classification_suggestions,signal_topic_definition_embeddings FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_workspace_topic_execution_v1(),guard_workspace_topic_search_evidence_v1(),guard_workspace_topic_prototype_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_topic_catalog_executions,signal_topic_classification_items,signal_topic_classification_suggestions,signal_topic_definition_embeddings FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_topic_execution_v1(),guard_workspace_topic_search_evidence_v1(),guard_workspace_topic_prototype_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
