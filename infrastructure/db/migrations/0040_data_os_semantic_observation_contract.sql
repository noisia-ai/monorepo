-- Data OS semantic observation contract.
-- Keeps source facts auditable by separating measurement time from materialization
-- time and by persisting semantic quality issues instead of treating every number
-- as an accepted observation.

ALTER TABLE "data_observations"
  ADD COLUMN IF NOT EXISTS "metric_currency_code" text,
  ADD COLUMN IF NOT EXISTS "period_semantics" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "quality_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "materialized_at" timestamp with time zone NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'data_observations_period_semantics_check'
  ) THEN
    ALTER TABLE "data_observations"
      ADD CONSTRAINT "data_observations_period_semantics_check"
      CHECK ("period_semantics" IN ('measurement', 'event', 'snapshot', 'unknown'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'data_observations_quality_status_check'
  ) THEN
    ALTER TABLE "data_observations"
      ADD CONSTRAINT "data_observations_quality_status_check"
      CHECK ("quality_status" IN ('accepted', 'needs_mapping_review', 'rejected'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'data_observations_metric_unit_check'
  ) THEN
    ALTER TABLE "data_observations"
      ADD CONSTRAINT "data_observations_metric_unit_check"
      CHECK ("metric_unit" IS NULL OR "metric_unit" IN ('count', 'currency', 'ratio', 'score'))
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_data_observations_corpus_quality"
  ON "data_observations" ("study_corpus_id", "quality_status", "dataset_role");

CREATE INDEX IF NOT EXISTS "idx_data_observations_currency"
  ON "data_observations" ("study_corpus_id", "metric_currency_code", "period_start")
  WHERE "metric_currency_code" IS NOT NULL;
