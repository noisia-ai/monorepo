-- Noisia Data OS observations.
-- Adds a normalized fact table for uploaded/client sources so Signal can join
-- mentions_monthly, sales_monthly and other source metrics by period with lineage.

CREATE TABLE IF NOT EXISTS "data_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "data_source_id" uuid REFERENCES "data_sources"("id") ON DELETE SET NULL,
  "data_asset_id" uuid REFERENCES "data_assets"("id") ON DELETE SET NULL,
  "knowledge_source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE SET NULL,
  "source_sync_run_id" uuid REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  "dataset_key" text NOT NULL,
  "dataset_name" text,
  "dataset_role" text,
  "row_index" integer,
  "record_hash" text NOT NULL,
  "period_start" date,
  "period_end" date,
  "period_grain" text NOT NULL DEFAULT 'unknown',
  "entity_type" text,
  "entity_key" text,
  "entity_label" text,
  "metric_key" text NOT NULL,
  "metric_family" text NOT NULL,
  "metric_value" numeric NOT NULL,
  "metric_unit" text,
  "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "raw_record" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lineage" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quality_status" text NOT NULL DEFAULT 'accepted',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_observations_source_metric_row" UNIQUE (
    "data_source_id",
    "data_asset_id",
    "dataset_key",
    "row_index",
    "metric_key"
  )
);

CREATE INDEX IF NOT EXISTS "idx_data_observations_corpus_period_metric"
  ON "data_observations" ("study_corpus_id", "period_grain", "period_start", "metric_key");
CREATE INDEX IF NOT EXISTS "idx_data_observations_brand_metric_period"
  ON "data_observations" ("brand_id", "metric_key", "period_start");
CREATE INDEX IF NOT EXISTS "idx_data_observations_asset"
  ON "data_observations" ("data_asset_id", "dataset_key");
CREATE INDEX IF NOT EXISTS "idx_data_observations_knowledge_source"
  ON "data_observations" ("knowledge_source_id");
CREATE INDEX IF NOT EXISTS "idx_data_observations_entity"
  ON "data_observations" ("study_corpus_id", "entity_type", "entity_key");
