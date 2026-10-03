-- Durable Anthropic Message Batches state for autonomous semantic resolution.
--
-- This is additive only. It does not create or move population pointers and it
-- does not modify the append-only semantic Review contract introduced in 0064.

ALTER TABLE signal_semantic_resolution_runs
  ADD COLUMN IF NOT EXISTS provider_batch_id text,
  ADD COLUMN IF NOT EXISTS provider_batch_status text NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS provider_processing_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_succeeded_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_errored_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_canceled_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_expired_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_results_imported_at timestamptz;

ALTER TABLE signal_semantic_resolution_runs
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_provider_batch_status;

ALTER TABLE signal_semantic_resolution_runs
  ADD CONSTRAINT signal_semantic_resolution_provider_batch_status CHECK (
    provider_batch_status IN (
      'not_submitted', 'submitting', 'in_progress', 'canceling', 'ended'
    )
  );

ALTER TABLE signal_semantic_resolution_runs
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_provider_counts;

ALTER TABLE signal_semantic_resolution_runs
  ADD CONSTRAINT signal_semantic_resolution_provider_counts CHECK (
    provider_processing_items >= 0
    AND provider_succeeded_items >= 0
    AND provider_errored_items >= 0
    AND provider_canceled_items >= 0
    AND provider_expired_items >= 0
    AND provider_processing_items
      + provider_succeeded_items
      + provider_errored_items
      + provider_canceled_items
      + provider_expired_items <= total_items
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_resolution_provider_batch
  ON signal_semantic_resolution_runs(provider_batch_id)
  WHERE provider_batch_id IS NOT NULL;

ALTER TABLE signal_semantic_resolution_run_items
  ADD COLUMN IF NOT EXISTS provider_custom_id text,
  ADD COLUMN IF NOT EXISTS provider_result_status text,
  ADD COLUMN IF NOT EXISTS provider_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_cache_read_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_error_code text;

ALTER TABLE signal_semantic_resolution_run_items
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_provider_result_status;

ALTER TABLE signal_semantic_resolution_run_items
  ADD CONSTRAINT signal_semantic_resolution_provider_result_status CHECK (
    provider_result_status IS NULL
    OR provider_result_status IN ('succeeded', 'errored', 'canceled', 'expired')
  );

ALTER TABLE signal_semantic_resolution_run_items
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_provider_usage;

ALTER TABLE signal_semantic_resolution_run_items
  ADD CONSTRAINT signal_semantic_resolution_provider_usage CHECK (
    provider_input_tokens >= 0
    AND provider_output_tokens >= 0
    AND provider_cache_creation_input_tokens >= 0
    AND provider_cache_read_input_tokens >= 0
    AND provider_cost_usd >= 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_resolution_provider_custom_id
  ON signal_semantic_resolution_run_items(run_id, provider_custom_id)
  WHERE provider_custom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_provider_results
  ON signal_semantic_resolution_run_items(run_id, provider_result_status, provider_custom_id);
