-- Bind approved SentiOne query potential to the exact query iteration and later import.
-- Refinement samples and the fresh confirmation holdout remain separately auditable.

ALTER TABLE "query_iterations"
  ADD COLUMN IF NOT EXISTS "latest_query_validation_run_id" uuid
    REFERENCES "query_validation_runs"("id") ON DELETE SET NULL;

ALTER TABLE "query_iterations"
  ADD COLUMN IF NOT EXISTS "approved_query_validation_run_id" uuid
    REFERENCES "query_validation_runs"("id") ON DELETE SET NULL;

ALTER TABLE "query_validation_attempts"
  ADD COLUMN IF NOT EXISTS "attempt_kind" text NOT NULL DEFAULT 'refinement';

ALTER TABLE "query_validation_attempts"
  ADD COLUMN IF NOT EXISTS "unique_sample_size" integer NOT NULL DEFAULT 0;

ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "query_validation_run_id" uuid
    REFERENCES "query_validation_runs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_query_iterations_latest_validation"
  ON "query_iterations" ("latest_query_validation_run_id");

CREATE INDEX IF NOT EXISTS "idx_query_iterations_approved_validation"
  ON "query_iterations" ("approved_query_validation_run_id");

CREATE INDEX IF NOT EXISTS "idx_query_validation_attempts_kind"
  ON "query_validation_attempts" ("query_validation_run_id", "query_pack_id", "attempt_kind");

CREATE INDEX IF NOT EXISTS "idx_import_batches_validation_run"
  ON "import_batches" ("query_validation_run_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_query_validation_attempt_kind'
  ) THEN
    ALTER TABLE "query_validation_attempts"
      ADD CONSTRAINT "chk_query_validation_attempt_kind"
      CHECK ("attempt_kind" IN ('refinement', 'confirmation'));
  END IF;
END
$$;
