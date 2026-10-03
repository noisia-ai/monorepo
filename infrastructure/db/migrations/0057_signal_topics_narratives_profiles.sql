-- Signal Topics & Narratives: versioned workspace profiles and canonical enrichment scope.
-- Forward-only and additive. Existing taxonomy/tag/run stores remain canonical.

CREATE TABLE IF NOT EXISTS signal_taxonomy_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  taxonomy_id uuid NOT NULL REFERENCES taxonomies(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  context_hash text NOT NULL,
  rule_set_id uuid NOT NULL REFERENCES tagging_rule_sets(id) ON DELETE RESTRICT,
  model_version_id uuid NOT NULL REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_taxonomy_profiles_kind CHECK (kind IN ('topic', 'narrative')),
  CONSTRAINT signal_taxonomy_profiles_version_positive CHECK (version >= 1),
  CONSTRAINT signal_taxonomy_profiles_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_taxonomy_profiles_context_hash CHECK (
    context_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_taxonomy_profiles_active_approval CHECK (
    status <> 'active'
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT uq_signal_taxonomy_profiles_workspace_kind_version
    UNIQUE (workspace_id, kind, version),
  CONSTRAINT uq_signal_taxonomy_profiles_taxonomy UNIQUE (taxonomy_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_taxonomy_profiles_active_kind
  ON signal_taxonomy_profiles (workspace_id, kind)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_signal_taxonomy_profiles_workspace_history
  ON signal_taxonomy_profiles (workspace_id, kind, version DESC);

CREATE INDEX IF NOT EXISTS idx_signal_taxonomy_profiles_model
  ON signal_taxonomy_profiles (model_version_id, rule_set_id);

CREATE OR REPLACE FUNCTION validate_signal_taxonomy_profile_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rule_taxonomy_id uuid;
  model_rule_set_id uuid;
BEGIN
  SELECT taxonomy_id
  INTO rule_taxonomy_id
  FROM tagging_rule_sets
  WHERE id = NEW.rule_set_id;

  IF rule_taxonomy_id IS DISTINCT FROM NEW.taxonomy_id THEN
    RAISE EXCEPTION 'Signal taxonomy profile rule set must belong to the same taxonomy';
  END IF;

  SELECT tagging_rule_set_id
  INTO model_rule_set_id
  FROM tagging_model_versions
  WHERE id = NEW.model_version_id;

  IF model_rule_set_id IS DISTINCT FROM NEW.rule_set_id THEN
    RAISE EXCEPTION 'Signal taxonomy profile model version must belong to the selected rule set';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('active', 'retired')
    AND (
      NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.taxonomy_id IS DISTINCT FROM OLD.taxonomy_id
      OR NEW.context_hash IS DISTINCT FROM OLD.context_hash
      OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
      OR NEW.model_version_id IS DISTINCT FROM OLD.model_version_id
    )
  THEN
    RAISE EXCEPTION 'Activated or retired Signal taxonomy profile structure is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_signal_taxonomy_profile_scope_trigger
  ON signal_taxonomy_profiles;
CREATE TRIGGER validate_signal_taxonomy_profile_scope_trigger
BEFORE INSERT OR UPDATE ON signal_taxonomy_profiles
FOR EACH ROW
EXECUTE FUNCTION validate_signal_taxonomy_profile_scope();

ALTER TABLE record_tags
  ADD COLUMN IF NOT EXISTS signal_taxonomy_profile_id uuid
    REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_record_tags_signal_profile_assignment
  ON record_tags (
    subject_id,
    signal_taxonomy_profile_id,
    taxonomy_term_id,
    model_version_id
  )
  WHERE subject_type = 'mention'
    AND signal_taxonomy_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_record_tags_signal_profile_review
  ON record_tags (
    signal_taxonomy_profile_id,
    review_status,
    taxonomy_term_id,
    subject_id
  )
  WHERE subject_type = 'mention'
    AND signal_taxonomy_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_signal_taxonomy_record_tag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_taxonomy_id uuid;
  profile_model_version_id uuid;
  profile_workspace_id uuid;
  term_taxonomy_id uuid;
BEGIN
  IF NEW.signal_taxonomy_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.subject_type <> 'mention'
    OR NEW.study_corpus_id IS NULL
    OR NEW.model_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Signal taxonomy tags require mention, corpus, profile and model version';
  END IF;

  SELECT taxonomy_id, model_version_id, workspace_id
  INTO profile_taxonomy_id, profile_model_version_id, profile_workspace_id
  FROM signal_taxonomy_profiles
  WHERE id = NEW.signal_taxonomy_profile_id;

  SELECT taxonomy_id
  INTO term_taxonomy_id
  FROM taxonomy_terms
  WHERE id = NEW.taxonomy_term_id;

  IF term_taxonomy_id IS DISTINCT FROM profile_taxonomy_id THEN
    RAISE EXCEPTION 'Signal taxonomy tag term does not belong to its profile';
  END IF;

  IF NEW.model_version_id IS DISTINCT FROM profile_model_version_id THEN
    RAISE EXCEPTION 'Signal taxonomy tag model version does not match its profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM mentions mention
    JOIN signal_workspace_corpora membership
      ON membership.workspace_id = profile_workspace_id
     AND membership.study_corpus_id = mention.study_corpus_id
     AND membership.valid_to IS NULL
    WHERE mention.id = NEW.subject_id
      AND mention.study_corpus_id = NEW.study_corpus_id
  ) THEN
    RAISE EXCEPTION 'Signal taxonomy tag mention is outside its workspace/corpus scope';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_signal_taxonomy_record_tag_trigger ON record_tags;
CREATE TRIGGER validate_signal_taxonomy_record_tag_trigger
BEFORE INSERT OR UPDATE OF
  subject_type,
  subject_id,
  study_corpus_id,
  taxonomy_term_id,
  model_version_id,
  signal_taxonomy_profile_id
ON record_tags
FOR EACH ROW
EXECUTE FUNCTION validate_signal_taxonomy_record_tag();

ALTER TABLE signal_refresh_runs
  ADD COLUMN IF NOT EXISTS run_type text NOT NULL DEFAULT 'source_refresh',
  ADD COLUMN IF NOT EXISTS taxonomy_profile_id uuid
    REFERENCES signal_taxonomy_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_version_id uuid
    REFERENCES tagging_model_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_corpus_revision integer,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS budget_cap_usd numeric(12,6),
  ADD COLUMN IF NOT EXISTS actual_cost_usd numeric(12,6),
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer;

ALTER TABLE signal_refresh_runs
  DROP CONSTRAINT IF EXISTS signal_refresh_runs_run_type;
ALTER TABLE signal_refresh_runs
  ADD CONSTRAINT signal_refresh_runs_run_type CHECK (
    run_type IN ('source_refresh', 'taxonomy_enrichment')
  );

ALTER TABLE signal_refresh_runs
  DROP CONSTRAINT IF EXISTS signal_refresh_runs_enrichment_scope;
ALTER TABLE signal_refresh_runs
  ADD CONSTRAINT signal_refresh_runs_enrichment_scope CHECK (
    run_type <> 'taxonomy_enrichment'
    OR (
      taxonomy_profile_id IS NOT NULL
      AND model_version_id IS NOT NULL
      AND input_corpus_revision IS NOT NULL
      AND input_corpus_revision >= 0
    )
  );

ALTER TABLE signal_refresh_runs
  DROP CONSTRAINT IF EXISTS signal_refresh_runs_enrichment_cost;
ALTER TABLE signal_refresh_runs
  ADD CONSTRAINT signal_refresh_runs_enrichment_cost CHECK (
    (budget_cap_usd IS NULL OR budget_cap_usd >= 0)
    AND (actual_cost_usd IS NULL OR actual_cost_usd >= 0)
    AND (budget_cap_usd IS NULL OR actual_cost_usd IS NULL OR actual_cost_usd <= budget_cap_usd)
    AND (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
  );

CREATE INDEX IF NOT EXISTS idx_signal_refresh_runs_taxonomy_recovery
  ON signal_refresh_runs (status, heartbeat_at, created_at, id)
  WHERE run_type = 'taxonomy_enrichment'
    AND status IN ('queued', 'running', 'failed');

CREATE OR REPLACE FUNCTION activate_signal_taxonomy_profile(
  target_profile_id uuid,
  reviewer_user_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql
AS $$
DECLARE
  target signal_taxonomy_profiles%ROWTYPE;
  activated signal_taxonomy_profiles%ROWTYPE;
BEGIN
  SELECT *
  INTO target
  FROM signal_taxonomy_profiles
  WHERE id = target_profile_id
  FOR UPDATE;

  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Signal taxonomy profile not found';
  END IF;

  IF target.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft Signal taxonomy profile can be activated';
  END IF;

  IF reviewer_user_id IS NULL THEN
    RAISE EXCEPTION 'Human reviewer is required to activate Signal taxonomy profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM taxonomy_terms term
    WHERE term.taxonomy_id = target.taxonomy_id
      AND term.status IN ('candidate', 'active')
  ) THEN
    RAISE EXCEPTION 'Signal taxonomy profile requires at least one reviewed term';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target.workspace_id::text || ':' || target.kind, 0)
  );

  UPDATE signal_taxonomy_profiles
  SET status = 'retired', updated_at = now()
  WHERE workspace_id = target.workspace_id
    AND kind = target.kind
    AND status = 'active'
    AND id <> target.id;

  UPDATE taxonomies
  SET status = 'active'
  WHERE id = target.taxonomy_id;

  UPDATE taxonomy_terms
  SET status = 'active'
  WHERE taxonomy_id = target.taxonomy_id
    AND status = 'candidate';

  UPDATE signal_taxonomy_profiles
  SET status = 'active',
    approved_by_user_id = reviewer_user_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = target.id
  RETURNING * INTO activated;

  RETURN activated;
END;
$$;

CREATE OR REPLACE FUNCTION reject_signal_taxonomy_profile(
  target_profile_id uuid,
  reviewer_user_id uuid,
  review_notes text
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql
AS $$
DECLARE
  target signal_taxonomy_profiles%ROWTYPE;
  rejected signal_taxonomy_profiles%ROWTYPE;
BEGIN
  SELECT *
  INTO target
  FROM signal_taxonomy_profiles
  WHERE id = target_profile_id
  FOR UPDATE;

  IF target.id IS NULL OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'Only an existing draft Signal taxonomy profile can be rejected';
  END IF;

  IF reviewer_user_id IS NULL OR btrim(COALESCE(review_notes, '')) = '' THEN
    RAISE EXCEPTION 'Human reviewer and notes are required to reject Signal taxonomy profile';
  END IF;

  UPDATE taxonomy_terms
  SET status = 'rejected'
  WHERE taxonomy_id = target.taxonomy_id
    AND status = 'candidate';

  UPDATE taxonomies
  SET status = 'retired'
  WHERE id = target.taxonomy_id;

  UPDATE signal_taxonomy_profiles
  SET status = 'retired',
    metadata = metadata || jsonb_build_object(
      'review_decision', 'rejected',
      'reviewer_user_id', reviewer_user_id,
      'review_notes', review_notes,
      'reviewed_at', now()
    ),
    updated_at = now()
  WHERE id = target.id
  RETURNING * INTO rejected;

  RETURN rejected;
END;
$$;

COMMENT ON TABLE signal_taxonomy_profiles IS
  'Versioned active topic/narrative vocabulary binding for a Signal workspace.';
COMMENT ON COLUMN record_tags.signal_taxonomy_profile_id IS
  'Exact topic/narrative profile version that produced this canonical tag.';
COMMENT ON COLUMN signal_refresh_runs.run_type IS
  'Extends the durable refresh outbox for independent taxonomy enrichment without a parallel run store.';

