-- R16b: what the classifier decided when it was asked to choose between two
-- topics for one post. A pair of topics that is accepted together very often
-- is settled post by post with one question (left, right, both or neither);
-- that answer replaces the two separate yes-or-no answers of the post for
-- those topics. The original answers are kept untouched: this table only says
-- which way each of them counts now.
-- Additive: one table. Safe to re-run. Server-side access only.

CREATE TABLE IF NOT EXISTS signal_listening_answer_overrides (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 -- The topic question whose answer is replaced, and the post.
 question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 root_id uuid NOT NULL,
 belongs boolean NOT NULL,
 -- The question that asked the classifier to choose.
 decided_by_question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (question_id, root_id)
);
CREATE INDEX IF NOT EXISTS signal_listening_answer_overrides_root ON signal_listening_answer_overrides (workspace_id, root_id);

DO $$ DECLARE role_name text; BEGIN
 ALTER TABLE signal_listening_answer_overrides ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON TABLE signal_listening_answer_overrides FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_listening_answer_overrides FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
