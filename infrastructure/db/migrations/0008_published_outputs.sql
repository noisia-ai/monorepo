-- ============================================================
-- Published outputs
-- Internal analyses become stable client-facing Signal reports.
-- ============================================================

CREATE TABLE IF NOT EXISTS "published_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "methodology_slug" text NOT NULL,
  "output_type" text NOT NULL DEFAULT 'narrative_dashboard',
  "status" text NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "headline" text,
  "summary" text,
  "manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "published_by_user_id" uuid REFERENCES "users"("id"),
  "published_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_outputs_analysis_type" UNIQUE ("tb_analysis_id", "output_type")
);

CREATE INDEX IF NOT EXISTS "idx_outputs_corpus"
  ON "published_outputs"("study_corpus_id", "status", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_outputs_brand"
  ON "published_outputs"("brand_id", "status", "published_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_outputs_analysis"
  ON "published_outputs"("tb_analysis_id");
