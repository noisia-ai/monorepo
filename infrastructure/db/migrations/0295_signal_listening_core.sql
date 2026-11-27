-- R16b Listening core. Additive: tables and indexes only, no triggers.
-- Validation lives in TypeScript (zod); R15 tables and labels are untouched.
-- Safe to re-run.

-- Versioned listening configuration of a workspace (Brand OS). Append-only by
-- convention: a change is a new revision; history is never rewritten.
CREATE TABLE IF NOT EXISTS signal_listening_configurations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 revision integer NOT NULL CHECK (revision > 0),
 configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
 configuration_digest text NOT NULL CHECK (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
 provenance text NOT NULL CHECK (provenance IN ('human', 'agent', 'migration')),
 note text,
 created_by_user_id uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (workspace_id, revision)
);

-- One row per distinct question ever sent to JEV for a workspace. The digest
-- covers the model and the exact wire, so the same question is never paid twice.
CREATE TABLE IF NOT EXISTS signal_listening_questions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 question_digest text NOT NULL CHECK (question_digest ~ '^sha256:[0-9a-f]{64}$'),
 model text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('noul', 'choice')),
 wire jsonb NOT NULL CHECK (jsonb_typeof(wire) = 'object'),
 label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (workspace_id, question_digest)
);

-- A JEV pass over a set of roots. The plan names the planner and its
-- parameters. The cap is fixed before the first request and checked per page.
CREATE TABLE IF NOT EXISTS signal_listening_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 kind text NOT NULL CHECK (kind IN ('listening', 'topics_round', 'study', 'legacy_request')),
 plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
 status text NOT NULL DEFAULT 'queued'
   CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cap_reached', 'canceled')),
 cap_micro_usd bigint NOT NULL CHECK (cap_micro_usd > 0),
 spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
 input_tokens bigint NOT NULL DEFAULT 0,
 roots_done integer NOT NULL DEFAULT 0,
 roots_failed integer NOT NULL DEFAULT 0,
 pages integer NOT NULL DEFAULT 0,
 receipt jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(receipt) = 'object'),
 error_code text,
 lease_token uuid,
 lease_until timestamptz,
 requested_by_user_id uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS signal_listening_runs_pending
 ON signal_listening_runs (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS signal_listening_runs_workspace
 ON signal_listening_runs (workspace_id, created_at DESC);

-- Raw provider responses: one compressed JSONL object per page in private storage.
CREATE TABLE IF NOT EXISTS signal_listening_raw_pages (
 run_id uuid NOT NULL REFERENCES signal_listening_runs(id),
 page_no integer NOT NULL CHECK (page_no > 0),
 storage_key text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
 size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
 responses integer NOT NULL CHECK (responses >= 0),
 input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (run_id, page_no)
);

-- The answer cache: one row per root and question. `input_sha` is the digest of
-- the text fragment that was classified; an answer only counts for that text.
-- noul: probability = P(true). choice: probability = confidence of `choice`.
CREATE TABLE IF NOT EXISTS signal_listening_answers (
 question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 root_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 input_sha bytea NOT NULL CHECK (octet_length(input_sha) = 32),
 probability real NOT NULL CHECK (probability BETWEEN 0 AND 1),
 choice text,
 probabilities jsonb,
 run_id uuid NOT NULL REFERENCES signal_listening_runs(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (question_id, root_id)
);
CREATE INDEX IF NOT EXISTS signal_listening_answers_root
 ON signal_listening_answers (workspace_id, root_id);
CREATE INDEX IF NOT EXISTS signal_listening_answers_run
 ON signal_listening_answers (run_id, root_id);

-- Same exposure rule as the R15 tables: server-side access only.
DO $$ DECLARE table_name text; role_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['signal_listening_configurations', 'signal_listening_questions',
   'signal_listening_runs', 'signal_listening_raw_pages', 'signal_listening_answers'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
