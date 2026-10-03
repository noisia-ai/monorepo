-- Harden recurrent Signal refresh, freshness deadlines and operational corpus identity.
-- Forward-only: published outputs and legacy routes remain untouched.

WITH ranked_operational AS (
  SELECT membership.id,
    row_number() OVER (
      PARTITION BY membership.workspace_id
      ORDER BY
        (
          SELECT max(output.published_at)
          FROM published_outputs output
          WHERE output.study_corpus_id = membership.study_corpus_id
        ) DESC NULLS LAST,
        corpus.updated_at DESC NULLS LAST,
        membership.valid_from DESC,
        membership.study_corpus_id DESC
    ) AS position
  FROM signal_workspace_corpora membership
  JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
  WHERE membership.role = 'operational'
    AND membership.valid_to IS NULL
)
UPDATE signal_workspace_corpora membership
SET valid_to = GREATEST(now(), membership.valid_from + interval '1 microsecond'),
    metadata = membership.metadata || jsonb_build_object(
      'closed_by', '0051_signal_backend_foundation_hardening',
      'reason', 'superseded_operational_corpus'
    ),
    updated_at = now()
FROM ranked_operational ranked
WHERE membership.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_workspace_corpora_one_operational
  ON signal_workspace_corpora (workspace_id)
  WHERE role = 'operational' AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_signal_refresh_runs_outbox_recovery
  ON signal_refresh_runs (scheduled_for, refresh_policy_id, id)
  WHERE trigger = 'scheduled'
    AND status IN ('queued', 'failed')
    AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION signal_refresh_freshness_tolerance(p_cadence text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_cadence
    WHEN 'hourly' THEN interval '15 minutes'
    WHEN 'daily' THEN interval '6 hours'
    WHEN 'weekly' THEN interval '1 day'
    WHEN 'monthly' THEN interval '3 days'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION derive_signal_watermark_freshness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  policy_cadence text;
  policy_timezone text;
  policy_expected_next_run timestamptz;
  policy_tolerance interval;
BEGIN
  SELECT policy.cadence, policy.timezone, policy.expected_next_run
  INTO policy_cadence, policy_timezone, policy_expected_next_run
  FROM signal_refresh_policies policy
  WHERE policy.workspace_id = NEW.workspace_id
    AND policy.source_key = NEW.source_key
  LIMIT 1;

  policy_tolerance := signal_refresh_freshness_tolerance(policy_cadence);
  NEW.stale_after := CASE
    WHEN policy_tolerance IS NULL OR policy_expected_next_run IS NULL THEN NULL
    ELSE policy_expected_next_run + policy_tolerance
  END;
  NEW.source_freshness_state := 'fresh';
  NEW.data_freshness_state := CASE
    WHEN NEW.max_observed_at IS NULL THEN 'partial'
    ELSE 'fresh'
  END;
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
    'freshness_policy', jsonb_build_object(
      'cadence', COALESCE(policy_cadence, 'manual'),
      'timezone', COALESCE(policy_timezone, 'UTC'),
      'expected_next_run', policy_expected_next_run,
      'tolerance_seconds', CASE
        WHEN policy_tolerance IS NULL THEN NULL
        ELSE extract(epoch FROM policy_tolerance)::bigint
      END
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_data_watermarks_freshness ON signal_data_watermarks;
CREATE TRIGGER trg_signal_data_watermarks_freshness
  BEFORE INSERT OR UPDATE OF accepted_at, max_observed_at, source_key, workspace_id
  ON signal_data_watermarks
  FOR EACH ROW
  EXECUTE FUNCTION derive_signal_watermark_freshness();

UPDATE signal_data_watermarks watermark
SET stale_after = CASE
      WHEN signal_refresh_freshness_tolerance(policy.cadence) IS NULL
        OR policy.expected_next_run IS NULL THEN NULL
      ELSE policy.expected_next_run + signal_refresh_freshness_tolerance(policy.cadence)
    END,
    metadata = watermark.metadata || jsonb_build_object(
      'freshness_policy', jsonb_build_object(
        'cadence', policy.cadence,
        'timezone', policy.timezone,
        'expected_next_run', policy.expected_next_run,
        'tolerance_seconds', CASE
          WHEN signal_refresh_freshness_tolerance(policy.cadence) IS NULL THEN NULL
          ELSE extract(epoch FROM signal_refresh_freshness_tolerance(policy.cadence))::bigint
        END
      )
    ),
    updated_at = now()
FROM signal_refresh_policies policy
WHERE policy.workspace_id = watermark.workspace_id
  AND policy.source_key = watermark.source_key;

COMMENT ON INDEX uq_signal_workspace_corpora_one_operational IS
  'Fail-closed invariant: a Signal workspace has at most one active operational corpus.';
COMMENT ON INDEX idx_signal_refresh_runs_outbox_recovery IS
  'Postgres outbox of scheduled occurrences; queued/failed rows are reconciled into BullMQ.';
COMMENT ON FUNCTION derive_signal_watermark_freshness() IS
  'Derives source/data deadlines from cadence, timezone-derived expected_next_run and explicit tolerance.';
