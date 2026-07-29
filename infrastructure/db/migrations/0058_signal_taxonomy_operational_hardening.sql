-- Signal Topics & Narratives operational hardening.
-- Forward-only: durable partial runs and auditable policy approvals.

ALTER TABLE signal_taxonomy_profiles
  DROP CONSTRAINT IF EXISTS signal_taxonomy_profiles_status;
ALTER TABLE signal_taxonomy_profiles
  ADD CONSTRAINT signal_taxonomy_profiles_status CHECK (
    status IN ('draft', 'activating', 'active', 'retired')
  );

ALTER TABLE signal_taxonomy_profiles
  DROP CONSTRAINT IF EXISTS signal_taxonomy_profiles_active_approval;
ALTER TABLE signal_taxonomy_profiles
  ADD CONSTRAINT signal_taxonomy_profiles_active_approval CHECK (
    status NOT IN ('activating', 'active')
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION activate_signal_taxonomy_profile(
  target_profile_id uuid,
  reviewer_user_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql
AS $$
DECLARE activated signal_taxonomy_profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_profile_id::text, 0));
  IF reviewer_user_id IS NULL THEN
    RAISE EXCEPTION 'Human reviewer is required to activate Signal taxonomy profile';
  END IF;
  UPDATE taxonomies taxonomy
  SET status = 'active'
  FROM signal_taxonomy_profiles profile
  WHERE profile.id = target_profile_id
    AND profile.status = 'draft'
    AND taxonomy.id = profile.taxonomy_id;
  UPDATE taxonomy_terms term
  SET status = 'active'
  FROM signal_taxonomy_profiles profile
  WHERE profile.id = target_profile_id
    AND profile.status = 'draft'
    AND term.taxonomy_id = profile.taxonomy_id
    AND term.status = 'candidate';
  UPDATE signal_taxonomy_profiles
  SET status = 'activating', approved_by_user_id = reviewer_user_id,
      approved_at = now(), updated_at = now()
  WHERE id = target_profile_id AND status = 'draft'
  RETURNING * INTO activated;
  IF activated.id IS NULL THEN
    RAISE EXCEPTION 'Only a draft Signal taxonomy profile can enter activation';
  END IF;
  RETURN activated;
END;
$$;

CREATE OR REPLACE FUNCTION complete_signal_taxonomy_profile_activation(
  target_profile_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql
AS $$
DECLARE target signal_taxonomy_profiles%ROWTYPE;
DECLARE activated signal_taxonomy_profiles%ROWTYPE;
BEGIN
  SELECT * INTO target FROM signal_taxonomy_profiles
  WHERE id = target_profile_id FOR UPDATE;
  IF target.id IS NULL OR target.status <> 'activating' THEN
    RAISE EXCEPTION 'Only an activating profile can complete activation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mentions mention
    JOIN signal_workspace_corpora membership
      ON membership.workspace_id = target.workspace_id
     AND membership.study_corpus_id = mention.study_corpus_id
     AND membership.role = 'operational'
     AND membership.valid_to IS NULL
    WHERE mention.inclusion_status = 'included'
      AND NOT EXISTS (
        SELECT 1 FROM record_feature_values feature
        WHERE feature.subject_type = 'mention'
          AND feature.subject_id = mention.id
          AND feature.feature_key =
            'signal_taxonomy_classification:' || target.id::text
          AND feature.source =
            'signal_taxonomy_profile:' || target.id::text
      )
  ) THEN
    RAISE EXCEPTION 'Activating profile backfill is incomplete';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(target.workspace_id::text || ':' || target.kind, 0)
  );
  UPDATE signal_taxonomy_profiles
  SET status = 'retired', updated_at = now()
  WHERE workspace_id = target.workspace_id AND kind = target.kind
    AND status = 'active' AND id <> target.id;
  UPDATE signal_taxonomy_profiles
  SET status = 'active', updated_at = now()
  WHERE id = target.id
  RETURNING * INTO activated;
  RETURN activated;
END;
$$;

ALTER TABLE signal_refresh_runs
  DROP CONSTRAINT IF EXISTS signal_refresh_runs_status;
ALTER TABLE signal_refresh_runs
  ADD CONSTRAINT signal_refresh_runs_status CHECK (
    status IN (
      'queued', 'running', 'partial', 'blocked',
      'completed', 'failed', 'dead_letter', 'skipped'
    )
  );

DROP INDEX IF EXISTS idx_signal_refresh_runs_taxonomy_recovery;
CREATE INDEX idx_signal_refresh_runs_taxonomy_recovery
  ON signal_refresh_runs (status, heartbeat_at, created_at, id)
  WHERE run_type = 'taxonomy_enrichment'
    AND status IN ('queued', 'running', 'partial', 'blocked', 'failed');

ALTER TABLE record_tags
  ADD COLUMN IF NOT EXISTS approval_source text,
  ADD COLUMN IF NOT EXISTS approval_policy_version text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE record_tags
SET approval_source = 'human',
    approved_at = COALESCE(approved_at, created_at)
WHERE review_status = 'approved'
  AND approval_source IS NULL;

ALTER TABLE record_tags
  DROP CONSTRAINT IF EXISTS record_tags_approval_source;
ALTER TABLE record_tags
  ADD CONSTRAINT record_tags_approval_source CHECK (
    approval_source IS NULL OR approval_source IN ('human', 'policy')
  );

ALTER TABLE record_tags
  DROP CONSTRAINT IF EXISTS record_tags_approved_provenance;
ALTER TABLE record_tags
  ADD CONSTRAINT record_tags_approved_provenance CHECK (
    review_status <> 'approved'
    OR (
      approval_source IS NOT NULL
      AND approved_at IS NOT NULL
      AND (
        approval_source <> 'policy'
        OR NULLIF(btrim(approval_policy_version), '') IS NOT NULL
      )
    )
  );

COMMENT ON COLUMN record_tags.approval_source IS
  'Human review or conservative versioned policy; never a fabricated reviewer.';
COMMENT ON COLUMN record_tags.approval_policy_version IS
  'Required when approval_source=policy; identifies the exact acceptance rule.';
