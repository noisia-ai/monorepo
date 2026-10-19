ALTER TABLE "query_packs"
  ADD COLUMN IF NOT EXISTS "entity_key" text;

UPDATE "query_packs"
SET "entity_key" = NULLIF("query_components"->>'entity_key', '')
WHERE "entity_key" IS NULL
  AND NULLIF("query_components"->>'entity_key', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_query_packs_scope_entity"
  ON "query_packs" ("study_corpus_id", "scope", "entity_key");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_query_packs_iteration_lens_intent_scope_entity"
  ON "query_packs" (
    "study_corpus_id",
    (COALESCE("query_iteration_id"::text, '')),
    "lens_slug",
    "signal_intent",
    "scope",
    (COALESCE("entity_key", ''))
  );

DROP INDEX IF EXISTS "uq_query_packs_iteration_lens_intent_scope";
