-- R16b Studies: a methodology applied to a cut of a brand's corpus.
-- Additive: tables and indexes only. Validation lives in TypeScript. Safe to re-run.
-- A study reuses the corpus roots, their vectors and the listening answers; its
-- own questions go through the same answer cache as any other question.

CREATE TABLE IF NOT EXISTS signal_studies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 base_map_id uuid NOT NULL,
 configuration_id uuid NOT NULL REFERENCES signal_listening_configurations(id),
 lexicon_revision integer NOT NULL CHECK (lexicon_revision >= 0),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 -- The methodology template as it was when the study was created: nothing of
 -- the methodology is read from code afterwards.
 methodology jsonb NOT NULL CHECK (jsonb_typeof(methodology) = 'object'),
 subject jsonb NOT NULL CHECK (jsonb_typeof(subject) = 'object'),
 cut jsonb NOT NULL CHECK (jsonb_typeof(cut) = 'object'),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
 step text NOT NULL DEFAULT 'created',
 cap_micro_usd bigint NOT NULL CHECK (cap_micro_usd > 0),
 spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
 -- Working data between steps (groups, samples, passes, run ids).
 state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object'),
 -- The published result. Marked directional until validated by sampling.
 output jsonb,
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
CREATE INDEX IF NOT EXISTS signal_studies_pending ON signal_studies (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS signal_studies_workspace ON signal_studies (workspace_id, created_at DESC);

-- The motives of a study. One key per motive: the same motive can push and
-- hold back, so direction is a distribution of its members, not part of its identity.
-- The layer is a property of the motive, never asked mention by mention.
CREATE TABLE IF NOT EXISTS signal_study_motives (
 study_id uuid NOT NULL REFERENCES signal_studies(id),
 motive_key text NOT NULL CHECK (motive_key ~ '^[a-z][a-z0-9_]{0,119}$'),
 wording jsonb NOT NULL CHECK (jsonb_typeof(wording) = 'object'),
 layer text NOT NULL CHECK (layer IN ('psychological', 'personal', 'social', 'cultural', 'unclear')),
 permission text NOT NULL CHECK (permission IN ('movable', 'partial', 'structural_align_or_exit', 'no_permission')),
 -- Diagnostics, literal proof, both blind passes and any override, with its written reason.
 layer_record jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(layer_record) = 'object'),
 group_keys text[] NOT NULL DEFAULT '{}',
 centroid vector(1024),
 question_id bigint REFERENCES signal_listening_questions(id),
 PRIMARY KEY (study_id, motive_key)
);

-- Explicit bridge to the report: a person chose to carry motives of a study
-- into the brand's defined topics. Never automatic.
CREATE TABLE IF NOT EXISTS signal_study_promotions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 study_id uuid NOT NULL REFERENCES signal_studies(id),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 motive_key text NOT NULL,
 defined_topic_key text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (study_id, motive_key)
);

DO $$ DECLARE table_name text; role_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['signal_studies', 'signal_study_motives', 'signal_study_promotions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
