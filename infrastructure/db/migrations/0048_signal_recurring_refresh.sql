-- Recurring Signal ingestion, watermarks and selective downstream invalidation.
-- Safe default: every refresh policy is disabled until explicitly enabled.

CREATE TABLE IF NOT EXISTS signal_refresh_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  adapter_key text NOT NULL DEFAULT 'manual_import',
  cadence text NOT NULL DEFAULT 'manual',
  timezone text NOT NULL DEFAULT 'UTC',
  enabled boolean NOT NULL DEFAULT false,
  expected_next_run timestamptz,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_refresh_policies_source_key_present CHECK (btrim(source_key) <> ''),
  CONSTRAINT signal_refresh_policies_adapter_key_present CHECK (btrim(adapter_key) <> ''),
  CONSTRAINT signal_refresh_policies_timezone_present CHECK (btrim(timezone) <> ''),
  CONSTRAINT signal_refresh_policies_cadence CHECK (
    cadence IN ('manual', 'hourly', 'daily', 'weekly', 'monthly')
  ),
  CONSTRAINT signal_refresh_policies_enabled_schedule CHECK (
    enabled = false OR (cadence <> 'manual' AND expected_next_run IS NOT NULL)
  ),
  CONSTRAINT uq_signal_refresh_policies_workspace_source UNIQUE (workspace_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_refresh_policies_due
  ON signal_refresh_policies (expected_next_run, workspace_id)
  WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_signal_refresh_policies_data_source
  ON signal_refresh_policies (data_source_id)
  WHERE data_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_data_watermarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  corpus_revision integer NOT NULL,
  last_source_sync_run_id uuid REFERENCES source_sync_runs(id) ON DELETE SET NULL,
  last_import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  max_observed_at timestamptz,
  accepted_at timestamptz NOT NULL,
  materialized_at timestamptz NOT NULL,
  source_freshness_state text NOT NULL DEFAULT 'not_available',
  data_freshness_state text NOT NULL DEFAULT 'not_available',
  stale_after timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_data_watermarks_revision_nonnegative CHECK (corpus_revision >= 0),
  CONSTRAINT signal_data_watermarks_source_state CHECK (
    source_freshness_state IN ('fresh', 'stale', 'partial', 'failed', 'not_available')
  ),
  CONSTRAINT signal_data_watermarks_data_state CHECK (
    data_freshness_state IN ('fresh', 'stale', 'partial', 'not_available')
  ),
  CONSTRAINT signal_data_watermarks_materialized_after_accept CHECK (materialized_at >= accepted_at),
  CONSTRAINT uq_signal_data_watermarks_scope UNIQUE (workspace_id, study_corpus_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_data_watermarks_workspace_freshness
  ON signal_data_watermarks (workspace_id, data_freshness_state, max_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_data_watermarks_corpus_source
  ON signal_data_watermarks (study_corpus_id, source_key, accepted_at DESC);

CREATE TABLE IF NOT EXISTS signal_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refresh_policy_id uuid REFERENCES signal_refresh_policies(id) ON DELETE SET NULL,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid REFERENCES study_corpora(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  idempotency_key text NOT NULL,
  bullmq_job_id text,
  trigger text NOT NULL DEFAULT 'scheduled',
  status text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 1,
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_refresh_runs_status CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'dead_letter', 'skipped')
  ),
  CONSTRAINT signal_refresh_runs_trigger CHECK (trigger IN ('scheduled', 'manual', 'import')),
  CONSTRAINT signal_refresh_runs_attempt_positive CHECK (attempt >= 1),
  CONSTRAINT uq_signal_refresh_runs_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_refresh_runs_workspace_status
  ON signal_refresh_runs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_refresh_runs_policy_status
  ON signal_refresh_runs (refresh_policy_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_data_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  data_watermark_id uuid NOT NULL REFERENCES signal_data_watermarks(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  idempotency_key text NOT NULL,
  reason text NOT NULL DEFAULT 'data_accepted',
  affected_from date,
  affected_through date,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT signal_data_invalidations_status CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')
  ),
  CONSTRAINT signal_data_invalidations_attempt_nonnegative CHECK (attempt >= 0),
  CONSTRAINT signal_data_invalidations_window CHECK (
    affected_from IS NULL OR affected_through IS NULL OR affected_from <= affected_through
  ),
  CONSTRAINT uq_signal_data_invalidations_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_data_invalidations_pending
  ON signal_data_invalidations (status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_signal_data_invalidations_scope
  ON signal_data_invalidations (workspace_id, study_corpus_id, affected_from, affected_through);

CREATE TABLE IF NOT EXISTS signal_interpretation_freshness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  metric_group_key text NOT NULL,
  filters_hash text NOT NULL,
  data_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_watermark_hash text,
  interpretation_watermark_hash text,
  state text NOT NULL DEFAULT 'not_available',
  reason text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_interpretation_freshness_state CHECK (
    state IN ('fresh', 'stale', 'pending', 'partial', 'not_available')
  ),
  CONSTRAINT uq_signal_interpretation_freshness_scope UNIQUE (
    workspace_id, metric_group_key, filters_hash
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_interpretation_freshness_workspace_state
  ON signal_interpretation_freshness (workspace_id, state, evaluated_at DESC);

CREATE OR REPLACE FUNCTION record_signal_data_acceptance(
  p_study_corpus_id uuid,
  p_source_key text,
  p_data_source_id uuid DEFAULT NULL,
  p_source_sync_run_id uuid DEFAULT NULL,
  p_import_batch_id uuid DEFAULT NULL,
  p_corpus_revision integer DEFAULT NULL,
  p_accepted_at timestamptz DEFAULT now(),
  p_materialized_at timestamptz DEFAULT now()
)
RETURNS TABLE (watermark_id uuid, invalidation_id uuid, workspace_id uuid, changed boolean)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  effective_revision integer;
  effective_data_source_id uuid := p_data_source_id;
  observed_from date;
  observed_through date;
  observed_max timestamptz;
  event_key text;
  membership record;
  changed_watermark_id uuid;
  created_invalidation_id uuid;
BEGIN
  IF btrim(COALESCE(p_source_key, '')) = '' THEN
    RAISE EXCEPTION 'source_key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_source_sync_run_id IS NULL AND p_import_batch_id IS NULL THEN
    RAISE EXCEPTION 'A sync run or import batch is required.' USING ERRCODE = '23514';
  END IF;
  IF p_source_sync_run_id IS NOT NULL AND p_import_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only one accepted source event is allowed.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(p_corpus_revision, corpus_revision)
  INTO effective_revision
  FROM study_corpora
  WHERE id = p_study_corpus_id;
  IF effective_revision IS NULL THEN
    RAISE EXCEPTION 'Study corpus not found.' USING ERRCODE = '23503';
  END IF;

  IF p_import_batch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM import_batches
      WHERE id = p_import_batch_id
        AND study_corpus_id = p_study_corpus_id
        AND status = 'completed'
    ) THEN
      RAISE EXCEPTION 'Completed import batch does not belong to the corpus.' USING ERRCODE = '23514';
    END IF;
    SELECT min(published_at)::date, max(published_at)::date, max(published_at)
    INTO observed_from, observed_through, observed_max
    FROM mentions
    WHERE study_corpus_id = p_study_corpus_id
      AND source_file_id = p_import_batch_id;
    event_key := 'import:' || p_import_batch_id::text;
  ELSE
    SELECT ds.id,
      COALESCE(ssr.coverage_start, canonical_window.observed_from),
      COALESCE(ssr.coverage_end, canonical_window.observed_through),
      CASE WHEN COALESCE(ssr.coverage_end, canonical_window.observed_through) IS NULL THEN NULL
        ELSE (COALESCE(ssr.coverage_end, canonical_window.observed_through) + 1)::timestamptz - interval '1 microsecond' END
    INTO effective_data_source_id, observed_from, observed_through, observed_max
    FROM source_sync_runs ssr
    JOIN data_sources ds ON ds.id = ssr.data_source_id
    LEFT JOIN LATERAL (
      SELECT min(period_start) AS observed_from, max(period_end) AS observed_through
      FROM (
        SELECT period_start, COALESCE(period_end, period_start) AS period_end
        FROM data_observations
        WHERE source_sync_run_id = ssr.id
        UNION ALL
        SELECT period_start, COALESCE(period_end, period_start) AS period_end
        FROM data_asset_records
        WHERE source_sync_run_id = ssr.id
      ) accepted_rows
    ) canonical_window ON true
    WHERE ssr.id = p_source_sync_run_id
      AND ssr.status = 'completed'
      AND ds.study_corpus_id = p_study_corpus_id
      AND (p_data_source_id IS NULL OR ds.id = p_data_source_id);
    IF effective_data_source_id IS NULL THEN
      RAISE EXCEPTION 'Completed source sync does not belong to the corpus.' USING ERRCODE = '23514';
    END IF;
    event_key := 'sync:' || p_source_sync_run_id::text;
  END IF;

  FOR membership IN
    SELECT sw.id AS workspace_id, swc.role
    FROM signal_workspace_corpora swc
    JOIN signal_workspaces sw ON sw.id = swc.workspace_id
    WHERE swc.study_corpus_id = p_study_corpus_id
      AND swc.valid_to IS NULL
      AND sw.status = 'active'
  LOOP
    changed_watermark_id := NULL;
    INSERT INTO signal_data_watermarks (
      workspace_id, study_corpus_id, data_source_id, source_key, corpus_revision,
      last_source_sync_run_id, last_import_batch_id, max_observed_at, accepted_at,
      materialized_at, source_freshness_state, data_freshness_state, stale_after, metadata
    ) VALUES (
      membership.workspace_id, p_study_corpus_id, effective_data_source_id, p_source_key,
      effective_revision, p_source_sync_run_id, p_import_batch_id, observed_max,
      p_accepted_at, GREATEST(p_materialized_at, p_accepted_at), 'fresh',
      CASE WHEN observed_max IS NULL THEN 'partial' ELSE 'fresh' END,
      NULL, jsonb_build_object('accepted_event', event_key)
    )
    ON CONFLICT (workspace_id, study_corpus_id, source_key)
    DO UPDATE SET
      data_source_id = COALESCE(EXCLUDED.data_source_id, signal_data_watermarks.data_source_id),
      corpus_revision = GREATEST(signal_data_watermarks.corpus_revision, EXCLUDED.corpus_revision),
      last_source_sync_run_id = EXCLUDED.last_source_sync_run_id,
      last_import_batch_id = EXCLUDED.last_import_batch_id,
      max_observed_at = CASE
        WHEN signal_data_watermarks.max_observed_at IS NULL THEN EXCLUDED.max_observed_at
        WHEN EXCLUDED.max_observed_at IS NULL THEN signal_data_watermarks.max_observed_at
        ELSE GREATEST(signal_data_watermarks.max_observed_at, EXCLUDED.max_observed_at)
      END,
      accepted_at = EXCLUDED.accepted_at,
      materialized_at = EXCLUDED.materialized_at,
      source_freshness_state = EXCLUDED.source_freshness_state,
      data_freshness_state = EXCLUDED.data_freshness_state,
      stale_after = NULL,
      metadata = signal_data_watermarks.metadata || EXCLUDED.metadata,
      updated_at = now()
    WHERE signal_data_watermarks.last_source_sync_run_id IS DISTINCT FROM EXCLUDED.last_source_sync_run_id
       OR signal_data_watermarks.last_import_batch_id IS DISTINCT FROM EXCLUDED.last_import_batch_id
    RETURNING id INTO changed_watermark_id;

    IF changed_watermark_id IS NOT NULL THEN
      created_invalidation_id := NULL;
      INSERT INTO signal_data_invalidations (
        workspace_id, study_corpus_id, data_watermark_id, source_key,
        idempotency_key, affected_from, affected_through, scope
      ) VALUES (
        membership.workspace_id, p_study_corpus_id, changed_watermark_id, p_source_key,
        membership.workspace_id::text || ':' || event_key,
        observed_from, observed_through,
        jsonb_build_object(
          'workspace_id', membership.workspace_id,
          'study_corpus_id', p_study_corpus_id,
          'source_key', p_source_key,
          'corpus_role', membership.role,
          'targets', jsonb_build_array('metric_materializations', 'interpretation_freshness')
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO created_invalidation_id;

      watermark_id := changed_watermark_id;
      invalidation_id := created_invalidation_id;
      workspace_id := membership.workspace_id;
      changed := true;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
