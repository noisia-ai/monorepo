-- Signal Phase 5: recoverable strategic run dispatch.
-- Forward-only hardening for the 0062 outbox. PostgreSQL owns dispatch state;
-- Workers lease rows and reconcile deterministic BullMQ jobs after crashes.

ALTER TABLE signal_strategic_run_outbox
  ADD COLUMN IF NOT EXISTS bullmq_job_id text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

-- Any row left dispatching by the pre-0063 Studio dispatcher must be eligible for
-- immediate recovery. No completed/dispatched row is changed.
UPDATE signal_strategic_run_outbox
SET locked_at = COALESCE(locked_at, updated_at, created_at),
    lease_expires_at = COALESCE(lease_expires_at, now()),
    updated_at = now()
WHERE status = 'dispatching'
  AND lease_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signal_strategic_run_outbox_recovery
  ON signal_strategic_run_outbox (
    status,
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  WHERE status IN ('pending', 'failed', 'dispatching');

CREATE INDEX IF NOT EXISTS idx_signal_strategic_run_outbox_bullmq_job
  ON signal_strategic_run_outbox (bullmq_job_id)
  WHERE bullmq_job_id IS NOT NULL;

COMMENT ON COLUMN signal_strategic_run_outbox.bullmq_job_id IS
  'Deterministic BullMQ identity signal-tb-<tb_analysis_id>; retained for crash reconciliation.';
COMMENT ON COLUMN signal_strategic_run_outbox.lease_expires_at IS
  'Worker dispatch lease. Expired dispatching rows are reclaimable with SKIP LOCKED.';
COMMENT ON COLUMN signal_strategic_run_outbox.lease_token IS
  'Unique claim token; stale workers cannot finalize a lease reclaimed by another process.';
COMMENT ON INDEX idx_signal_strategic_run_outbox_recovery IS
  'Due pending/failed rows and expired dispatch leases drained automatically by Workers.';
