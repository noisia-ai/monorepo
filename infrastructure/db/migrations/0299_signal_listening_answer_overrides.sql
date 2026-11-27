-- R16b: what the classifier decided when it was asked to choose between two
-- topics for one post. A pair of topics that is accepted together very often
-- is settled post by post with one question (left, right, both or neither);
-- that answer replaces the two separate yes-or-no answers of the post for
-- those topics. The original answers are kept untouched: this table only says
-- which way each of them counts now.
-- A decision is made on a text: it carries the digest of the fragment that was
-- classified and only counts for an answer about that same fragment.
-- A decision belongs to the loop that made it: a loop that is still running
-- does not change the map of the one already published.
-- Additive: one table. Safe to re-run. Server-side access only.

CREATE TABLE IF NOT EXISTS signal_listening_answer_overrides (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 cycle_id uuid NOT NULL REFERENCES signal_listening_cycles(id),
 -- The topic question whose answer is replaced, and the post.
 question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 root_id uuid NOT NULL,
 belongs boolean NOT NULL,
 -- The question that asked the classifier to choose, and the text it chose on.
 decided_by_question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 input_sha bytea NOT NULL CHECK (octet_length(input_sha) = 32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (cycle_id, question_id, root_id)
);
CREATE INDEX IF NOT EXISTS signal_listening_answer_overrides_root ON signal_listening_answer_overrides (workspace_id, root_id);

-- A table made before the digest existed gets it from the answer that decided
-- each row. A decision whose text can no longer be told does not count.
ALTER TABLE signal_listening_answer_overrides ADD COLUMN IF NOT EXISTS input_sha bytea;
UPDATE signal_listening_answer_overrides decided SET input_sha = answer.input_sha
 FROM signal_listening_answers answer
 WHERE decided.input_sha IS NULL AND answer.question_id = decided.decided_by_question_id AND answer.root_id = decided.root_id;
DELETE FROM signal_listening_answer_overrides WHERE input_sha IS NULL;
ALTER TABLE signal_listening_answer_overrides ALTER COLUMN input_sha SET NOT NULL;
-- A table made before decisions belonged to a loop: what it holds is what the last finished loop of each brand reads.
ALTER TABLE signal_listening_answer_overrides ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES signal_listening_cycles(id);
UPDATE signal_listening_answer_overrides decided SET cycle_id = (SELECT cycle.id FROM signal_listening_cycles cycle
  WHERE cycle.workspace_id = decided.workspace_id AND cycle.status = 'completed' ORDER BY cycle.completed_at DESC LIMIT 1)
 WHERE decided.cycle_id IS NULL;
DELETE FROM signal_listening_answer_overrides WHERE cycle_id IS NULL;
ALTER TABLE signal_listening_answer_overrides ALTER COLUMN cycle_id SET NOT NULL;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
   WHERE i.indrelid = 'signal_listening_answer_overrides'::regclass AND i.indisprimary) = 2 THEN
  ALTER TABLE signal_listening_answer_overrides DROP CONSTRAINT signal_listening_answer_overrides_pkey;
  ALTER TABLE signal_listening_answer_overrides ADD PRIMARY KEY (cycle_id, question_id, root_id);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signal_listening_answer_overrides_input_sha_check'
   AND conrelid = 'signal_listening_answer_overrides'::regclass) THEN
  ALTER TABLE signal_listening_answer_overrides ADD CONSTRAINT signal_listening_answer_overrides_input_sha_check CHECK (octet_length(input_sha) = 32);
 END IF;
END $$;

DO $$ DECLARE role_name text; BEGIN
 ALTER TABLE signal_listening_answer_overrides ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON TABLE signal_listening_answer_overrides FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_listening_answer_overrides FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
