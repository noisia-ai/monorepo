-- The Signal dashboard aggregates (platform_distribution, content_type_distribution)
-- and the corpus browser computed `resolved_platform` / `content_type` /
-- `batch_entity_label` INLINE by extracting from raw_metadata jsonb (and joining
-- import_batches) for every mention on every render. Over a 160K-mention corpus
-- this blows past Supabase's 2-min statement_timeout on the pooler, so the report
-- rendered empty ("No publicado", "0 menciones publicadas").
--
-- Materialize them as real, indexable columns so the aggregates are simple
-- GROUP BYs that finish in milliseconds. Populated at ingest going forward
-- (see infrastructure/db/sentione-csv-ingest.ts) and backfilled for existing rows.
ALTER TABLE "mentions"
  ADD COLUMN IF NOT EXISTS "resolved_platform" text,
  ADD COLUMN IF NOT EXISTS "content_type" text,
  ADD COLUMN IF NOT EXISTS "batch_entity_label" text;

CREATE INDEX IF NOT EXISTS "idx_mentions_corpus_resolved_platform"
  ON "mentions" ("study_corpus_id", "resolved_platform");
CREATE INDEX IF NOT EXISTS "idx_mentions_corpus_content_type"
  ON "mentions" ("study_corpus_id", "content_type");
-- Supports the snapshot-scoped timeline / window aggregates.
CREATE INDEX IF NOT EXISTS "idx_mentions_corpus_published_at"
  ON "mentions" ("study_corpus_id", "published_at");
