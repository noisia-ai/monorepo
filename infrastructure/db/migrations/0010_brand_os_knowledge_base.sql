-- ============================================================
-- Brand OS + Knowledge Base
-- Persistent pre-corpus context used before query generation.
-- ============================================================

CREATE TABLE IF NOT EXISTS "brand_knowledge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "source_kind" text NOT NULL,
  "title" text NOT NULL,
  "original_file_name" text,
  "mime_type" text,
  "source_period_start" date,
  "source_period_end" date,
  "raw_text" text,
  "extracted_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'processed',
  "error_message" text,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_source_scope"
    CHECK ("brand_id" IS NOT NULL OR "study_corpus_id" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "idx_bks_brand"
  ON "brand_knowledge_sources"("brand_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bks_corpus"
  ON "brand_knowledge_sources"("study_corpus_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bks_org"
  ON "brand_knowledge_sources"("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bks_kind"
  ON "brand_knowledge_sources"("source_kind", "status");
