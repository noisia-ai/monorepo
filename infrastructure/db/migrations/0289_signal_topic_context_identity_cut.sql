-- A one-time, operator-verified bridge from sealed historical topic identities
-- to the exact entity-context inputs observed at the migration cut.
CREATE TABLE signal_topic_context_identity_cuts_v1 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 cutoff_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sealed_at timestamptz,
 sealed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 inventory_digest text,
 transition_count integer,
 CHECK((sealed_at IS NULL AND sealed_by_user_id IS NULL AND inventory_digest IS NULL AND transition_count IS NULL)
  OR (sealed_at IS NOT NULL AND sealed_by_user_id IS NOT NULL AND inventory_digest ~ '^sha256:[0-9a-f]{64}$'
   AND transition_count>=0))
);
INSERT INTO signal_topic_context_identity_cuts_v1(singleton) VALUES(true);

CREATE TABLE signal_topic_context_identity_bridges_v1 (
 generation_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 source_engine_execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
 legacy_identity jsonb NOT NULL,
 modern_identity jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_classification_generations(workspace_id,id) ON DELETE RESTRICT,
 CHECK(jsonb_typeof(legacy_identity)='object' AND jsonb_typeof(modern_identity)='object'),
 CHECK(legacy_identity ?& ARRAY['catalog_digest','context_digest','compiler_digest','embedding_config_digest','correction_digest']
  AND modern_identity ?& ARRAY['catalog_digest','context_digest','compiler_digest','embedding_config_digest','correction_digest']
  AND legacy_identity-ARRAY['catalog_digest','context_digest','compiler_digest','embedding_config_digest','correction_digest']='{}'::jsonb
  AND modern_identity-ARRAY['catalog_digest','context_digest','compiler_digest','embedding_config_digest','correction_digest']='{}'::jsonb),
 CHECK(modern_identity->>'catalog_digest'=legacy_identity->>'catalog_digest'
  AND modern_identity->>'embedding_config_digest'=legacy_identity->>'embedding_config_digest'
  AND modern_identity->>'correction_digest'=legacy_identity->>'correction_digest'),
 CHECK(legacy_identity IS DISTINCT FROM modern_identity)
);

CREATE FUNCTION guard_signal_topic_context_identity_bridge_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cut signal_topic_context_identity_cuts_v1; generation signal_classification_generations; expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_context_identity_bridge_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT cut FROM signal_topic_context_identity_cuts_v1 WHERE singleton FOR UPDATE;
 IF cut.sealed_at IS NOT NULL THEN RAISE EXCEPTION 'topic_context_identity_cut_already_sealed' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT generation FROM signal_classification_generations
  WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
 IF generation.created_at>cut.cutoff_at OR generation.finalized_at>cut.cutoff_at OR generation.status<>'ready'
  OR generation.input_contract<>'workspace-topic-classification-v1'
  OR generation.input_snapshot->'source_projection'->>'engine_execution_id' IS DISTINCT FROM NEW.source_engine_execution_id::text
  OR NOT COALESCE(signal_workspace_projection_source_current_v1(generation),false)
  OR generation.policy_valid_until IS NOT NULL AND generation.policy_valid_until<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state
   WHERE state.workspace_id=NEW.workspace_id AND state.input_revision=generation.input_revision) THEN
  RAISE EXCEPTION 'topic_context_identity_bridge_source_changed' USING ERRCODE='23514';
 END IF;
 expected:=jsonb_build_object('catalog_digest',generation.input_snapshot#>>'{identity,catalog_digest}',
  'context_digest',generation.input_snapshot#>>'{identity,context_digest}',
  'compiler_digest',generation.input_snapshot#>>'{identity,compiler_digest}',
  'embedding_config_digest',generation.input_snapshot#>>'{identity,embedding_config_digest}',
  'correction_digest',generation.input_snapshot->>'correction_digest');
 IF expected IS DISTINCT FROM NEW.legacy_identity
  OR EXISTS(SELECT 1 FROM jsonb_each_text(NEW.legacy_identity) x WHERE x.value IS NULL OR x.value !~ '^sha256:[0-9a-f]{64}$')
  OR EXISTS(SELECT 1 FROM jsonb_each_text(NEW.modern_identity) x WHERE x.value IS NULL OR x.value !~ '^sha256:[0-9a-f]{64}$') THEN
  RAISE EXCEPTION 'topic_context_identity_bridge_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_context_identity_bridge_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_context_identity_bridges_v1 FOR EACH ROW EXECUTE FUNCTION guard_signal_topic_context_identity_bridge_v1();

CREATE FUNCTION guard_signal_topic_context_identity_cut_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR OLD.sealed_at IS NOT NULL OR NEW.singleton IS DISTINCT FROM OLD.singleton
  OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at OR NEW.sealed_at IS NULL OR NEW.sealed_at<OLD.cutoff_at
  OR NEW.transition_count IS DISTINCT FROM (SELECT count(*)::integer FROM signal_topic_context_identity_bridges_v1)
  OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.sealed_by_user_id AND actor.status='active'
    AND actor.user_type='noisia_internal' AND actor.primary_role IN('noisia_admin','founder','admin')) THEN
  RAISE EXCEPTION 'topic_context_identity_cut_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_context_identity_cut_guard_v1 BEFORE UPDATE OR DELETE
 ON signal_topic_context_identity_cuts_v1 FOR EACH ROW EXECUTE FUNCTION guard_signal_topic_context_identity_cut_v1();

CREATE FUNCTION reject_signal_topic_context_identity_truncate_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN RAISE EXCEPTION 'topic_context_identity_cut_immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER signal_topic_context_identity_cut_no_truncate_v1 BEFORE TRUNCATE
 ON signal_topic_context_identity_cuts_v1 FOR EACH STATEMENT EXECUTE FUNCTION reject_signal_topic_context_identity_truncate_v1();
CREATE TRIGGER signal_topic_context_identity_bridge_no_truncate_v1 BEFORE TRUNCATE
 ON signal_topic_context_identity_bridges_v1 FOR EACH STATEMENT EXECUTE FUNCTION reject_signal_topic_context_identity_truncate_v1();
REVOKE ALL ON FUNCTION reject_signal_topic_context_identity_truncate_v1() FROM PUBLIC;

ALTER TABLE signal_topic_context_identity_cuts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_topic_context_identity_bridges_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_topic_context_identity_cuts_v1,signal_topic_context_identity_bridges_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_signal_topic_context_identity_cut_v1(),guard_signal_topic_context_identity_bridge_v1() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON signal_topic_context_identity_cuts_v1,signal_topic_context_identity_bridges_v1 FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON signal_topic_context_identity_cuts_v1,signal_topic_context_identity_bridges_v1 FROM authenticated;
 END IF;
END $$;
