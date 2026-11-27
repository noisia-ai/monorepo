-- R16b closed discovery loop and later edits. Additive: tables and indexes only.
-- Validation lives in TypeScript. Safe to re-run.

-- One automatic loop over a brand's population: signals, map review, re-ask,
-- measure, and again, up to the round limit. The thresholds and the stop rule
-- are frozen in `policy` before the first step.
CREATE TABLE IF NOT EXISTS signal_listening_cycles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 base_map_id uuid NOT NULL,
 configuration_id uuid NOT NULL REFERENCES signal_listening_configurations(id),
 lexicon_revision integer NOT NULL CHECK (lexicon_revision >= 0),
 policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
 cap_micro_usd bigint NOT NULL CHECK (cap_micro_usd > 0),
 spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
 stop_reason text,
 error_code text,
 receipt jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(receipt) = 'object'),
 lease_token uuid,
 lease_until timestamptz,
 requested_by_user_id uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (workspace_id, base_map_id) REFERENCES signal_mass_labeling_maps(workspace_id, id)
);
CREATE INDEX IF NOT EXISTS signal_listening_cycles_pending
 ON signal_listening_cycles (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS signal_listening_cycles_workspace
 ON signal_listening_cycles (workspace_id, created_at DESC);

-- A round is one version of the topic map and what was measured on it.
-- `step` records how far the round got, so a restart resumes after the last
-- finished step instead of paying for it again.
CREATE TABLE IF NOT EXISTS signal_listening_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cycle_id uuid NOT NULL REFERENCES signal_listening_cycles(id),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 round_no integer NOT NULL CHECK (round_no BETWEEN 1 AND 3),
 step text NOT NULL DEFAULT 'created'
   CHECK (step IN ('created', 'asked', 'measured', 'regrouped', 'reviewed')),
 catalog jsonb NOT NULL CHECK (jsonb_typeof(catalog) = 'array'),
 themes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(themes) = 'array'),
 evidence jsonb,
 orphan_groups jsonb,
 review jsonb,
 run_id uuid REFERENCES signal_listening_runs(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (cycle_id, round_no)
);

-- The topics of a round, with the question they are asked as and the centroid
-- used to pick each root's closest candidates.
CREATE TABLE IF NOT EXISTS signal_listening_round_topics (
 round_id uuid NOT NULL REFERENCES signal_listening_rounds(id),
 topic_key text NOT NULL CHECK (topic_key ~ '^[a-z][a-z0-9_]{0,119}$'),
 question_id bigint NOT NULL REFERENCES signal_listening_questions(id),
 centroid vector(1024),
 confirmed_members integer NOT NULL DEFAULT 0 CHECK (confirmed_members >= 0),
 PRIMARY KEY (round_id, topic_key)
);

-- What a person changed after the process finished. Edits are appended, never
-- rewritten; the latest edit for a root and topic wins over the classifier,
-- and an edited topic is frozen for the agent in later cycles.
CREATE TABLE IF NOT EXISTS signal_listening_human_edits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 operation text NOT NULL CHECK (operation IN ('remove_label', 'add_label', 'merge_topics', 'rename_topic')),
 topic_key text NOT NULL CHECK (topic_key ~ '^[a-z][a-z0-9_]{0,119}$'),
 root_id uuid,
 payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((operation IN ('remove_label', 'add_label')) = (root_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS signal_listening_human_edits_topic
 ON signal_listening_human_edits (workspace_id, topic_key, created_at DESC);
CREATE INDEX IF NOT EXISTS signal_listening_human_edits_root
 ON signal_listening_human_edits (workspace_id, root_id, topic_key, created_at DESC) WHERE root_id IS NOT NULL;

-- Same exposure rule as every listening table: server-side access only.
DO $$ DECLARE table_name text; role_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['signal_listening_cycles', 'signal_listening_rounds',
   'signal_listening_round_topics', 'signal_listening_human_edits'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
