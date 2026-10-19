-- Preserve canonical source rows independently from numeric observations.
-- This closes the gap where a profiled catalog, keyword export, ticket file, or
-- document table could be called governed while only its schema and examples
-- survived materialization.

CREATE TABLE IF NOT EXISTS "data_asset_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "data_source_id" uuid REFERENCES "data_sources"("id") ON DELETE SET NULL,
  "data_asset_id" uuid NOT NULL REFERENCES "data_assets"("id") ON DELETE CASCADE,
  "knowledge_source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE SET NULL,
  "source_sync_run_id" uuid REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  "dataset_key" text NOT NULL,
  "dataset_name" text,
  "dataset_role" text,
  "row_index" integer NOT NULL,
  "record_hash" text NOT NULL,
  "period_start" date,
  "period_end" date,
  "period_grain" text NOT NULL DEFAULT 'unknown',
  "period_semantics" text NOT NULL DEFAULT 'unknown',
  "entity_type" text,
  "entity_key" text,
  "entity_label" text,
  "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "record_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lineage" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quality_status" text NOT NULL DEFAULT 'accepted',
  "quality_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "materialized_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_data_asset_records_asset_dataset_row"
    UNIQUE ("data_asset_id", "dataset_key", "row_index"),
  CONSTRAINT "data_asset_records_period_semantics_check"
    CHECK ("period_semantics" IN ('measurement', 'event', 'snapshot', 'static', 'unknown')) NOT VALID,
  CONSTRAINT "data_asset_records_quality_status_check"
    CHECK ("quality_status" IN ('accepted', 'needs_mapping_review', 'rejected')) NOT VALID
);

CREATE INDEX IF NOT EXISTS "idx_data_asset_records_corpus_role"
  ON "data_asset_records" ("study_corpus_id", "dataset_role", "quality_status");

CREATE INDEX IF NOT EXISTS "idx_data_asset_records_asset_dataset"
  ON "data_asset_records" ("data_asset_id", "dataset_key");

CREATE INDEX IF NOT EXISTS "idx_data_asset_records_entity"
  ON "data_asset_records" ("study_corpus_id", "entity_type", "entity_key");

CREATE INDEX IF NOT EXISTS "idx_data_asset_records_period"
  ON "data_asset_records" ("study_corpus_id", "period_grain", "period_start");

CREATE INDEX IF NOT EXISTS "idx_data_asset_records_knowledge_source"
  ON "data_asset_records" ("knowledge_source_id");

ALTER TABLE "data_asset_records"
  VALIDATE CONSTRAINT "data_asset_records_period_semantics_check";

ALTER TABLE "data_asset_records"
  VALIDATE CONSTRAINT "data_asset_records_quality_status_check";

-- Resolution-time metrics are normalized to seconds by the canonical metric
-- dictionary. Keep the database constraint aligned with that dictionary.
ALTER TABLE "data_observations"
  DROP CONSTRAINT IF EXISTS "data_observations_metric_unit_check";

ALTER TABLE "data_observations"
  ADD CONSTRAINT "data_observations_metric_unit_check"
  CHECK (
    "metric_unit" IS NULL
    OR "metric_unit" IN ('count', 'currency', 'ratio', 'score', 'duration_seconds')
  ) NOT VALID;

ALTER TABLE "data_observations"
  VALIDATE CONSTRAINT "data_observations_metric_unit_check";
