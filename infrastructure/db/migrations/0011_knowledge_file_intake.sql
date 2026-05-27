-- ============================================================
-- Knowledge source file intake
-- Keeps original uploads addressable by async workers.
-- ============================================================

ALTER TABLE "brand_knowledge_sources"
  ADD COLUMN IF NOT EXISTS "storage_path" text,
  ADD COLUMN IF NOT EXISTS "file_size_bytes" integer,
  ADD COLUMN IF NOT EXISTS "file_hash" text;

CREATE INDEX IF NOT EXISTS "idx_bks_status_created"
  ON "brand_knowledge_sources"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bks_hash"
  ON "brand_knowledge_sources"("file_hash");
