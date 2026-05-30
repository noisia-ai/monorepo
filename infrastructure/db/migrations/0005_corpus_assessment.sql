-- Stores the latest corpus-level readiness verdict from the meta-evaluator
ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "latest_assessment" jsonb;

ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "latest_assessed_at" timestamp with time zone;
