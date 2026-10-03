-- Signal Pulse data foundation.
-- Adds monthly period aggregates, marketing moves, source registry and
-- structured performance records while keeping existing Signal/T&B outputs live.

CREATE TABLE IF NOT EXISTS "data_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "provider" text NOT NULL,
  "connection_method" text NOT NULL,
  "name" text NOT NULL,
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "mapping_version" integer NOT NULL DEFAULT 1,
  "role" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "visibility" text NOT NULL DEFAULT 'internal',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_data_sources_corpus"
  ON "data_sources" ("study_corpus_id", "source_type", "status");
CREATE INDEX IF NOT EXISTS "idx_data_sources_brand"
  ON "data_sources" ("brand_id", "source_type", "status");

CREATE TABLE IF NOT EXISTS "source_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "data_source_id" uuid NOT NULL REFERENCES "data_sources"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone DEFAULT now(),
  "finished_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'running',
  "records_total" integer,
  "records_valid" integer,
  "records_duplicate" integer,
  "records_failed" integer,
  "coverage_start" date,
  "coverage_end" date,
  "error_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_source_sync_runs_source"
  ON "source_sync_runs" ("data_source_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "report_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "granularity" text NOT NULL DEFAULT 'month',
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "label" text NOT NULL,
  "coverage" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "comparable" boolean NOT NULL DEFAULT true,
  "comparability_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "confidence" text,
  "known_gaps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_report_periods_corpus_grain_start"
    UNIQUE ("study_corpus_id", "granularity", "period_start")
);

CREATE INDEX IF NOT EXISTS "idx_report_periods_corpus_window"
  ON "report_periods" ("study_corpus_id", "granularity", "period_start", "period_end");

CREATE TABLE IF NOT EXISTS "signal_period_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_signal_id" uuid NOT NULL REFERENCES "canonical_signals"("id") ON DELETE CASCADE,
  "period_id" uuid NOT NULL REFERENCES "report_periods"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "volume" integer NOT NULL DEFAULT 0,
  "engagement" numeric,
  "impact_v1" numeric,
  "sentiment_score" numeric,
  "polarity_bucket" text,
  "dominant_emotion" text,
  "emotion_distribution" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_mix" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence_count" integer NOT NULL DEFAULT 0,
  "confidence" text,
  "delta_prev" numeric,
  "delta_window_avg" numeric,
  "rank" integer,
  "lifecycle_state" text,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_signal_period_metrics_signal_period"
    UNIQUE ("canonical_signal_id", "period_id")
);

CREATE INDEX IF NOT EXISTS "idx_signal_period_metrics_corpus_period"
  ON "signal_period_metrics" ("study_corpus_id", "period_id", "rank");
CREATE INDEX IF NOT EXISTS "idx_signal_period_metrics_signal"
  ON "signal_period_metrics" ("canonical_signal_id", "computed_at");

CREATE TABLE IF NOT EXISTS "marketing_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "engine_analysis_id" uuid REFERENCES "engine_analyses"("id") ON DELETE SET NULL,
  "period_id" uuid REFERENCES "report_periods"("id") ON DELETE SET NULL,
  "move_type" text NOT NULL,
  "action_text" text NOT NULL,
  "signal_refs" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  "evidence_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "owner_suggestion" text,
  "timing" text,
  "measurement_suggestion" text,
  "no_go_notes" text,
  "confidence" text,
  "status" text NOT NULL DEFAULT 'candidate',
  "position" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_marketing_moves_corpus_period"
  ON "marketing_moves" ("study_corpus_id", "period_id", "status", "position");
CREATE INDEX IF NOT EXISTS "idx_marketing_moves_engine"
  ON "marketing_moves" ("engine_analysis_id", "status");

CREATE TABLE IF NOT EXISTS "chart_aggregates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "chart_key" text NOT NULL,
  "period_id" uuid REFERENCES "report_periods"("id") ON DELETE CASCADE,
  "filters_hash" text NOT NULL DEFAULT 'default',
  "payload" jsonb NOT NULL,
  "algo_version" text,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stale_after" timestamp with time zone,
  CONSTRAINT "uq_chart_aggregates_ref"
    UNIQUE ("study_corpus_id", "chart_key", "period_id", "filters_hash")
);

CREATE INDEX IF NOT EXISTS "idx_chart_aggregates_lookup"
  ON "chart_aggregates" ("study_corpus_id", "chart_key", "period_id");

CREATE TABLE IF NOT EXISTS "performance_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "data_source_id" uuid REFERENCES "data_sources"("id") ON DELETE SET NULL,
  "import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE SET NULL,
  "external_id" text NOT NULL,
  "entity_kind" text NOT NULL,
  "entity_name" text,
  "parent_external_id" text,
  "platform" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'paid',
  "objective" text,
  "record_date" date NOT NULL,
  "granularity" text NOT NULL DEFAULT 'day',
  "spend" numeric,
  "impressions" bigint,
  "reach" bigint,
  "clicks" bigint,
  "video_views" bigint,
  "engagement" bigint,
  "conversions" numeric,
  "ctr" numeric,
  "cpm" numeric,
  "cpc" numeric,
  "creative_text" text,
  "creative_asset_ref" text,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "raw_metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_performance_records_grain"
    UNIQUE ("study_corpus_id", "platform", "external_id", "record_date", "granularity")
);

CREATE INDEX IF NOT EXISTS "idx_performance_records_date"
  ON "performance_records" ("study_corpus_id", "record_date");
CREATE INDEX IF NOT EXISTS "idx_performance_records_entity"
  ON "performance_records" ("study_corpus_id", "entity_kind", "channel");
CREATE INDEX IF NOT EXISTS "idx_performance_records_source"
  ON "performance_records" ("data_source_id", "record_date");

ALTER TABLE "published_outputs"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'signal',
  ADD COLUMN IF NOT EXISTS "visibility_config" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_outputs_kind_status"
  ON "published_outputs" ("kind", "status", "updated_at");

-- Signal Pulse may materialize one observation per signal x period in a single
-- engine run. The old engine uniqueness only allowed one observation per signal
-- per run, which is still available when window_start/window_end are NULL.
DROP INDEX IF EXISTS "uq_signal_observation_signal_engine_analysis";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_engine_analysis_window"
  ON "signal_observations" (
    "canonical_signal_id",
    "engine_analysis_id",
    COALESCE("window_start", DATE '0001-01-01'),
    COALESCE("window_end", DATE '9999-12-31')
  )
  WHERE "engine_analysis_id" IS NOT NULL;
