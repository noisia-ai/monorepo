ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "competitor_id" uuid,
  ADD COLUMN IF NOT EXISTS "entity_kind" text,
  ADD COLUMN IF NOT EXISTS "entity_label" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'import_batches_competitor_id_competitors_id_fk'
  ) THEN
    ALTER TABLE "import_batches"
      ADD CONSTRAINT "import_batches_competitor_id_competitors_id_fk"
      FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_import_batches_entity"
  ON "import_batches" ("study_corpus_id", "mention_type", "entity_kind");

CREATE INDEX IF NOT EXISTS "idx_import_batches_competitor"
  ON "import_batches" ("study_corpus_id", "competitor_id");
