-- Deterministic Signal metric materializations. Existing rows remain readable as
-- legacy Data OS materializations; workspace-scoped rows use the stricter V1 shape.

ALTER TABLE metric_materializations
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS materialization_key text,
  ADD COLUMN IF NOT EXISTS metric_key text,
  ADD COLUMN IF NOT EXISTS metric_version integer,
  ADD COLUMN IF NOT EXISTS metric_group_key text,
  ADD COLUMN IF NOT EXISTS granularity text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS normalized_filter jsonb,
  ADD COLUMN IF NOT EXISTS typed_payload jsonb,
  ADD COLUMN IF NOT EXISTS value numeric,
  ADD COLUMN IF NOT EXISTS denominator numeric,
  ADD COLUMN IF NOT EXISTS sample_size integer,
  ADD COLUMN IF NOT EXISTS quality_state text,
  ADD COLUMN IF NOT EXISTS data_watermark_id uuid REFERENCES signal_data_watermarks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_watermark jsonb,
  ADD COLUMN IF NOT EXISTS data_watermark_hash text,
  ADD COLUMN IF NOT EXISTS materialization_state text,
  ADD COLUMN IF NOT EXISTS cache_scope text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE metric_materializations
  DROP CONSTRAINT IF EXISTS metric_materializations_signal_v1_shape;
ALTER TABLE metric_materializations
  ADD CONSTRAINT metric_materializations_signal_v1_shape CHECK (
    workspace_id IS NULL OR (
      materialization_key IS NOT NULL
      AND metric_key IS NOT NULL
      AND metric_version >= 1
      AND metric_group_key IS NOT NULL
      AND granularity IN ('day', 'week', 'month')
      AND period_start IS NOT NULL
      AND period_end >= period_start
      AND normalized_filter IS NOT NULL
      AND filters_hash ~ '^sha256:[0-9a-f]{64}$'
      AND typed_payload IS NOT NULL
      AND sample_size >= 0
      AND quality_state IN ('pass', 'partial', 'failed', 'unknown')
      AND data_watermark IS NOT NULL
      AND data_watermark_hash ~ '^sha256:[0-9a-f]{64}$'
      AND materialization_state IN ('fresh', 'stale', 'pending', 'partial', 'not_available')
      AND cache_scope IN ('default', 'precomputed', 'ad_hoc')
    )
  );

ALTER TABLE metric_materializations
  DROP CONSTRAINT IF EXISTS metric_materializations_null_semantics;
ALTER TABLE metric_materializations
  ADD CONSTRAINT metric_materializations_null_semantics CHECK (
    workspace_id IS NULL
    OR materialization_state NOT IN ('pending', 'not_available')
    OR value IS NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_materializations_signal_key
  ON metric_materializations (materialization_key)
  WHERE materialization_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_series
  ON metric_materializations (
    workspace_id, metric_group_key, metric_key, metric_version,
    filters_hash, granularity, period_start
  )
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_freshness
  ON metric_materializations (workspace_id, materialization_state, stale_after, computed_at)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_corpus_period
  ON metric_materializations (study_corpus_id, period_start, period_end)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_ad_hoc_expiry
  ON metric_materializations (expires_at)
  WHERE cache_scope = 'ad_hoc';

CREATE INDEX IF NOT EXISTS idx_mentions_signal_materialization
  ON mentions (study_corpus_id, published_at, id)
  WHERE inclusion_status = 'included';

COMMENT ON TABLE metric_materializations IS
  'Canonical deterministic metric cache. Workspace-scoped V1 rows are source of truth; chart_aggregates is legacy projection only.';
