-- Link each import batch to the iteration it belongs to (brand vs industry CSV)
ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "query_iteration_id" uuid REFERENCES "query_iterations"("id");

ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "mention_type" text;

CREATE INDEX IF NOT EXISTS "idx_import_batches_iteration"
  ON "import_batches"("query_iteration_id");
