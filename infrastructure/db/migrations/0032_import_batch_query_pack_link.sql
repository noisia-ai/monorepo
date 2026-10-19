ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "query_pack_id" uuid REFERENCES "query_packs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_import_batches_query_pack"
  ON "import_batches" ("study_corpus_id", "query_pack_id");
