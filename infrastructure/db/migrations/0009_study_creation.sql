-- ============================================================
-- Study creation UX
-- A corpus is the persisted study container; it now has a human
-- readable name and multiple studies can share brand + methodology.
-- ============================================================

ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "name" text;

UPDATE "study_corpora"
SET "name" = COALESCE(
  NULLIF("business_question", ''),
  'Estudio sin nombre'
)
WHERE "name" IS NULL;

DROP INDEX IF EXISTS "uq_corpus_brand_method";
DROP INDEX IF EXISTS "uq_corpus_theme_method";

CREATE INDEX IF NOT EXISTS "idx_sc_brand_method_created"
  ON "study_corpora"("brand_id", "methodology_id", "created_at" DESC)
  WHERE "brand_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_sc_theme_method_created"
  ON "study_corpora"("theme_id", "methodology_id", "created_at" DESC)
  WHERE "theme_id" IS NOT NULL;
