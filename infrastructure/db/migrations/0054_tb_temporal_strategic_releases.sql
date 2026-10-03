-- SB-09: frozen T&B run scope, deterministic temporal metrics/comparison and
-- human-promoted strategic releases. Forward-only and additive.

ALTER TABLE tb_analyses
  ADD COLUMN IF NOT EXISTS methodology_slug text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS corpus_revision integer,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS snapshot_mention_count integer,
  ADD COLUMN IF NOT EXISTS snapshot_digest text,
  ADD COLUMN IF NOT EXISTS scope_frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS comparison_base_analysis_id uuid REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS comparison_compatibility_state text,
  ADD COLUMN IF NOT EXISTS comparison_compatibility jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE tb_analyses analysis
SET methodology_slug = COALESCE(analysis.methodology_slug, 'triggers-barriers'),
    prompt_version = COALESCE(analysis.prompt_version, 'legacy_unknown'),
    model_version = COALESCE(analysis.model_version, 'legacy_unknown'),
    corpus_revision = COALESCE(
      analysis.corpus_revision,
      NULLIF(analysis.meta_json #>> '{analysis_sample,corpus_revision}', '')::integer,
      corpus.corpus_revision
    ),
    period_start = COALESCE(analysis.period_start, snapshot_scope.period_start),
    period_end = COALESCE(analysis.period_end, snapshot_scope.period_end),
    snapshot_mention_count = COALESCE(analysis.snapshot_mention_count, snapshot_scope.mention_count),
    snapshot_digest = COALESCE(analysis.snapshot_digest, snapshot_scope.snapshot_digest),
    scope_frozen_at = COALESCE(
      analysis.scope_frozen_at,
      CASE
        WHEN snapshot_scope.period_start IS NOT NULL
          AND snapshot_scope.period_end IS NOT NULL
          AND COALESCE(
            analysis.corpus_revision,
            NULLIF(analysis.meta_json #>> '{analysis_sample,corpus_revision}', '')::integer,
            corpus.corpus_revision
          ) IS NOT NULL
        THEN COALESCE(analysis.executed_at, analysis.created_at)
      END
    ),
    comparison_compatibility_state = COALESCE(
      analysis.comparison_compatibility_state,
      'not_evaluated'
    )
FROM (
  SELECT
    snapshot.id,
    MIN(mention.published_at)::date AS period_start,
    MAX(mention.published_at)::date AS period_end,
    COUNT(snapshot_mention.mention_id)::integer AS mention_count,
    'md5:' || md5(
      COALESCE(string_agg(snapshot_mention.mention_id::text, ',' ORDER BY snapshot_mention.mention_id), '')
    ) AS snapshot_digest
  FROM corpus_snapshots snapshot
  LEFT JOIN corpus_snapshot_mentions snapshot_mention ON snapshot_mention.snapshot_id = snapshot.id
  LEFT JOIN mentions mention ON mention.id = snapshot_mention.mention_id
  GROUP BY snapshot.id
) snapshot_scope,
study_corpora corpus
WHERE snapshot_scope.id = analysis.snapshot_id
  AND corpus.id = analysis.study_corpus_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_analyses_temporal_period'
      AND conrelid = 'tb_analyses'::regclass
  ) THEN
    ALTER TABLE tb_analyses ADD CONSTRAINT tb_analyses_temporal_period CHECK (
      period_start IS NULL OR period_end IS NULL OR period_start <= period_end
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_analyses_corpus_revision_nonnegative'
      AND conrelid = 'tb_analyses'::regclass
  ) THEN
    ALTER TABLE tb_analyses ADD CONSTRAINT tb_analyses_corpus_revision_nonnegative CHECK (
      corpus_revision IS NULL OR corpus_revision >= 0
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_analyses_snapshot_mention_count_nonnegative'
      AND conrelid = 'tb_analyses'::regclass
  ) THEN
    ALTER TABLE tb_analyses ADD CONSTRAINT tb_analyses_snapshot_mention_count_nonnegative CHECK (
      snapshot_mention_count IS NULL OR snapshot_mention_count >= 0
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_analyses_comparison_compatibility_state'
      AND conrelid = 'tb_analyses'::regclass
  ) THEN
    ALTER TABLE tb_analyses ADD CONSTRAINT tb_analyses_comparison_compatibility_state CHECK (
      comparison_compatibility_state IS NULL
      OR comparison_compatibility_state IN ('not_evaluated', 'compatible', 'incompatible')
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tb_analyses_temporal_scope
  ON tb_analyses (study_corpus_id, period_end DESC, scope_frozen_at DESC);
CREATE INDEX IF NOT EXISTS idx_tb_analyses_comparison_base
  ON tb_analyses (comparison_base_analysis_id)
  WHERE comparison_base_analysis_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_tb_analysis_frozen_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.scope_frozen_at IS NOT NULL AND (
    NEW.study_corpus_id IS DISTINCT FROM OLD.study_corpus_id
    OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
    OR NEW.pipeline_version IS DISTINCT FROM OLD.pipeline_version
    OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
    OR NEW.methodology_slug IS DISTINCT FROM OLD.methodology_slug
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.model_version IS DISTINCT FROM OLD.model_version
    OR NEW.corpus_revision IS DISTINCT FROM OLD.corpus_revision
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.snapshot_mention_count IS DISTINCT FROM OLD.snapshot_mention_count
    OR NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest
  ) THEN
    RAISE EXCEPTION 'tb_analysis_scope_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tb_analysis_frozen_scope ON tb_analyses;
CREATE TRIGGER trg_protect_tb_analysis_frozen_scope
BEFORE UPDATE ON tb_analyses
FOR EACH ROW EXECUTE FUNCTION protect_tb_analysis_frozen_scope();

CREATE TABLE IF NOT EXISTS tb_temporal_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  tb_finding_id uuid REFERENCES tb_findings(id) ON DELETE CASCADE,
  materialization_key text NOT NULL,
  metric_key text NOT NULL,
  metric_version integer NOT NULL DEFAULT 1,
  period_start date NOT NULL,
  period_end date NOT NULL,
  platform text,
  entity_type text,
  entity_key text,
  polarity text,
  layer text,
  finding_key text,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  value numeric,
  denominator numeric,
  sample_size integer,
  quality_state text NOT NULL DEFAULT 'not_available',
  quality_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_id uuid NOT NULL REFERENCES corpus_snapshots(id) ON DELETE RESTRICT,
  corpus_revision integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_temporal_metrics_materialization UNIQUE (materialization_key),
  CONSTRAINT tb_temporal_metrics_period CHECK (period_start <= period_end),
  CONSTRAINT tb_temporal_metrics_version_positive CHECK (metric_version >= 1),
  CONSTRAINT tb_temporal_metrics_sample_nonnegative CHECK (sample_size IS NULL OR sample_size >= 0),
  CONSTRAINT tb_temporal_metrics_quality_state CHECK (
    quality_state IN ('pass', 'partial', 'not_available')
  )
);

CREATE INDEX IF NOT EXISTS idx_tb_temporal_metrics_analysis_metric
  ON tb_temporal_metrics (tb_analysis_id, metric_key, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_tb_temporal_metrics_filter
  ON tb_temporal_metrics (
    tb_analysis_id, polarity, layer, platform, entity_type, entity_key, finding_key
  );
CREATE INDEX IF NOT EXISTS idx_tb_temporal_metrics_finding
  ON tb_temporal_metrics (tb_finding_id, metric_key)
  WHERE tb_finding_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tb_finding_temporal_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  comparison_base_analysis_id uuid REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  current_finding_id uuid REFERENCES tb_findings(id) ON DELETE CASCADE,
  previous_finding_id uuid REFERENCES tb_findings(id) ON DELETE RESTRICT,
  semantic_key text NOT NULL,
  movement text NOT NULL,
  reason text NOT NULL,
  current_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  similarity numeric(7,6),
  quality_state text NOT NULL,
  quality_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_finding_temporal_comparison UNIQUE (tb_analysis_id, semantic_key),
  CONSTRAINT tb_finding_temporal_comparisons_movement CHECK (
    movement IN ('emerging', 'growing', 'declining', 'persistent', 'mutated', 'disappeared')
  ),
  CONSTRAINT tb_finding_temporal_comparisons_quality CHECK (
    quality_state IN ('pass', 'partial', 'not_available')
  ),
  CONSTRAINT tb_finding_temporal_comparisons_pair CHECK (
    current_finding_id IS NOT NULL OR previous_finding_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_tb_finding_temporal_comparisons_analysis
  ON tb_finding_temporal_comparisons (tb_analysis_id, movement, quality_state);
CREATE INDEX IF NOT EXISTS idx_tb_finding_temporal_comparisons_base
  ON tb_finding_temporal_comparisons (comparison_base_analysis_id)
  WHERE comparison_base_analysis_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_workspace_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  release_key text NOT NULL,
  release_type text NOT NULL DEFAULT 'strategic',
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  visibility text NOT NULL DEFAULT 'internal',
  period_start date NOT NULL,
  period_end date NOT NULL,
  corpus_revision integer NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES corpus_snapshots(id) ON DELETE RESTRICT,
  comparison_base_analysis_id uuid REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  quality_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  published_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_workspace_releases_key UNIQUE (workspace_id, release_key),
  CONSTRAINT uq_signal_workspace_releases_analysis UNIQUE (workspace_id, tb_analysis_id),
  CONSTRAINT signal_workspace_releases_type CHECK (release_type = 'strategic'),
  CONSTRAINT signal_workspace_releases_status CHECK (
    status IN ('draft', 'needs_review', 'published', 'rejected')
  ),
  CONSTRAINT signal_workspace_releases_visibility CHECK (
    visibility IN ('internal', 'client')
  ),
  CONSTRAINT signal_workspace_releases_period CHECK (period_start <= period_end),
  CONSTRAINT signal_workspace_releases_approval CHECK (
    (status = 'published' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND published_at IS NOT NULL)
    OR status <> 'published'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_workspace_releases_history
  ON signal_workspace_releases (workspace_id, period_end DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_releases_analysis
  ON signal_workspace_releases (tb_analysis_id);

CREATE TABLE IF NOT EXISTS signal_workspace_release_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES signal_workspace_releases(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL,
  position integer NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'client',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_workspace_release_artifact UNIQUE (release_id, artifact_id),
  CONSTRAINT signal_workspace_release_artifact_revision_positive CHECK (artifact_revision >= 1),
  CONSTRAINT signal_workspace_release_artifact_visibility CHECK (
    visibility IN ('internal', 'client')
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_workspace_release_artifacts_release
  ON signal_workspace_release_artifacts (release_id, visibility, position);

CREATE TABLE IF NOT EXISTS signal_workspace_current_releases (
  workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  release_id uuid NOT NULL UNIQUE REFERENCES signal_workspace_releases(id) ON DELETE RESTRICT,
  promoted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  promoted_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_signal_workspace_current_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_workspace_releases release
    WHERE release.id = NEW.release_id
      AND release.workspace_id = NEW.workspace_id
      AND release.status = 'published'
      AND release.approved_by_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'signal_current_release_scope_or_review_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_signal_workspace_current_release
  ON signal_workspace_current_releases;
CREATE TRIGGER trg_validate_signal_workspace_current_release
BEFORE INSERT OR UPDATE ON signal_workspace_current_releases
FOR EACH ROW EXECUTE FUNCTION validate_signal_workspace_current_release();

CREATE OR REPLACE FUNCTION protect_published_signal_workspace_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published_signal_workspace_release_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_published_signal_workspace_release ON signal_workspace_releases;
CREATE TRIGGER trg_protect_published_signal_workspace_release
BEFORE UPDATE OR DELETE ON signal_workspace_releases
FOR EACH ROW EXECUTE FUNCTION protect_published_signal_workspace_release();

CREATE OR REPLACE FUNCTION protect_published_signal_workspace_release_artifact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_release_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_release_id := OLD.release_id;
  ELSE
    parent_release_id := NEW.release_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM signal_workspace_releases release
    WHERE release.id = parent_release_id AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'published_signal_workspace_release_artifact_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_published_signal_workspace_release_artifact
  ON signal_workspace_release_artifacts;
CREATE TRIGGER trg_protect_published_signal_workspace_release_artifact
BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_release_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_published_signal_workspace_release_artifact();

CREATE OR REPLACE FUNCTION promote_signal_workspace_release(
  requested_release_id uuid,
  reviewer_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  release_row signal_workspace_releases%ROWTYPE;
  analysis_status text;
  failed_gates integer;
  artifact_count integer;
  invalid_artifacts integer;
BEGIN
  IF reviewer_user_id IS NULL THEN
    RAISE EXCEPTION 'signal_release_human_reviewer_required';
  END IF;

  SELECT * INTO release_row
  FROM signal_workspace_releases
  WHERE id = requested_release_id
  FOR UPDATE;
  IF release_row.id IS NULL THEN RAISE EXCEPTION 'signal_release_not_found'; END IF;
  IF release_row.status NOT IN ('draft', 'needs_review') THEN
    RAISE EXCEPTION 'signal_release_not_promotable';
  END IF;

  SELECT status INTO analysis_status
  FROM tb_analyses
  WHERE id = release_row.tb_analysis_id
  FOR SHARE;
  IF analysis_status NOT IN ('approved_by_im', 'approved_by_kam') THEN
    RAISE EXCEPTION 'signal_release_analysis_not_human_approved';
  END IF;

  SELECT COUNT(*) INTO failed_gates
  FROM tb_quality_gates
  WHERE tb_analysis_id = release_row.tb_analysis_id
    AND passed = false;
  IF failed_gates > 0 THEN RAISE EXCEPTION 'signal_release_quality_gates_failed'; END IF;

  SELECT COUNT(*) INTO artifact_count
  FROM signal_workspace_release_artifacts
  WHERE release_id = release_row.id;
  IF artifact_count = 0 THEN RAISE EXCEPTION 'signal_release_artifacts_missing'; END IF;

  SELECT COUNT(*) INTO invalid_artifacts
  FROM signal_workspace_release_artifacts release_artifact
  JOIN analysis_artifacts artifact ON artifact.id = release_artifact.artifact_id
  WHERE release_artifact.release_id = release_row.id
    AND (
      artifact.tb_analysis_id IS DISTINCT FROM release_row.tb_analysis_id
      OR artifact.revision <> release_artifact.artifact_revision
      OR artifact.review_status NOT IN ('accepted', 'corrected', 'limited')
    );
  IF invalid_artifacts > 0 THEN RAISE EXCEPTION 'signal_release_artifact_gate_failed'; END IF;

  UPDATE signal_workspace_releases
  SET status = 'published',
      visibility = 'client',
      approved_by_user_id = reviewer_user_id,
      approved_at = now(),
      published_at = now(),
      updated_at = now()
  WHERE id = release_row.id;

  INSERT INTO signal_workspace_current_releases (
    workspace_id, release_id, promoted_by_user_id, promoted_at
  ) VALUES (
    release_row.workspace_id, release_row.id, reviewer_user_id, now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    release_id = EXCLUDED.release_id,
    promoted_by_user_id = EXCLUDED.promoted_by_user_id,
    promoted_at = EXCLUDED.promoted_at;

  RETURN release_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION protect_released_tb_finding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM signal_workspace_releases release
    WHERE release.tb_analysis_id = OLD.tb_analysis_id
      AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'released_tb_finding_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_released_tb_finding ON tb_findings;
CREATE TRIGGER trg_protect_released_tb_finding
BEFORE UPDATE OR DELETE ON tb_findings
FOR EACH ROW EXECUTE FUNCTION protect_released_tb_finding();

CREATE OR REPLACE FUNCTION protect_released_tb_temporal_materialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  analysis_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    analysis_id := OLD.tb_analysis_id;
  ELSE
    analysis_id := NEW.tb_analysis_id;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM signal_workspace_releases release
    WHERE release.tb_analysis_id = analysis_id
      AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'released_tb_temporal_materialization_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_released_tb_temporal_metric ON tb_temporal_metrics;
CREATE TRIGGER trg_protect_released_tb_temporal_metric
BEFORE INSERT OR UPDATE OR DELETE ON tb_temporal_metrics
FOR EACH ROW EXECUTE FUNCTION protect_released_tb_temporal_materialization();

DROP TRIGGER IF EXISTS trg_protect_released_tb_temporal_comparison
  ON tb_finding_temporal_comparisons;
CREATE TRIGGER trg_protect_released_tb_temporal_comparison
BEFORE INSERT OR UPDATE OR DELETE ON tb_finding_temporal_comparisons
FOR EACH ROW EXECUTE FUNCTION protect_released_tb_temporal_materialization();

COMMENT ON TABLE tb_temporal_metrics IS
  'Deterministic, snapshot-bound T&B methodology metrics; separate from Social Listening metric_definitions.';
COMMENT ON TABLE signal_workspace_current_releases IS
  'Mutable pointer to an immutable human-approved strategic release history.';
