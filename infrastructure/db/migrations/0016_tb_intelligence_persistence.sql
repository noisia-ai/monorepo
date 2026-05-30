CREATE TABLE IF NOT EXISTS "tb_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "insight_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "finding_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "kb_source_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  "data_basis" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "source_breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sql_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence_quotes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "confidence" text NOT NULL DEFAULT 'media',
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tb_insights_kind"
    CHECK ("kind" IN ('source_pattern', 'unexpected_insight', 'language_code', 'cx_signal', 'product_signal', 'content_signal', 'hypothesis', 'kb_confirmation', 'kb_contradiction', 'kb_nuance')),
  CONSTRAINT "tb_insights_confidence"
    CHECK ("confidence" IN ('alta', 'media', 'baja_direccional'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tb_insights_analysis_insight"
  ON "tb_insights"("tb_analysis_id", "insight_id");

CREATE INDEX IF NOT EXISTS "idx_tb_insights_analysis_kind"
  ON "tb_insights"("tb_analysis_id", "kind", "position");

CREATE TABLE IF NOT EXISTS "tb_open_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "signal_id" text NOT NULL,
  "title" text NOT NULL,
  "signal_type" text NOT NULL DEFAULT 'unexpected_insight',
  "why_it_matters" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "evidence_count" integer NOT NULL DEFAULT 0,
  "source_breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence_quotes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "confidence" text NOT NULL DEFAULT 'baja_direccional',
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tb_open_signals_confidence"
    CHECK ("confidence" IN ('alta', 'media', 'baja_direccional'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tb_open_signals_analysis_signal"
  ON "tb_open_signals"("tb_analysis_id", "signal_id");

CREATE INDEX IF NOT EXISTS "idx_tb_open_signals_analysis_position"
  ON "tb_open_signals"("tb_analysis_id", "position");
