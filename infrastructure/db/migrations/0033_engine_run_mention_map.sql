-- Materialized mention map per engine run.
-- This freezes the provenance set for a lens run before coding, so parallel
-- methodology workers do not repeatedly fan out over mention_query_sources.

CREATE TABLE IF NOT EXISTS "engine_run_mention_map" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_analysis_id" uuid NOT NULL REFERENCES "engine_analyses"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  "source_study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE SET NULL,
  "query_pack_id" uuid REFERENCES "query_packs"("id") ON DELETE SET NULL,
  "query_iteration_id" uuid REFERENCES "query_iterations"("id") ON DELETE SET NULL,
  "import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE SET NULL,
  "lens_slug" text NOT NULL,
  "signal_intent" text,
  "scope" text,
  "entity_id" text,
  "corpus_entity_id" uuid REFERENCES "corpus_entities"("id") ON DELETE SET NULL,
  "match_quality" numeric(4,3),
  "quality_score" integer,
  "selection_rank" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_engine_run_mention_map_analysis_mention"
  ON "engine_run_mention_map" ("engine_analysis_id", "mention_id");
CREATE INDEX IF NOT EXISTS "idx_engine_run_mention_map_analysis_rank"
  ON "engine_run_mention_map" ("engine_analysis_id", "selection_rank");
CREATE INDEX IF NOT EXISTS "idx_engine_run_mention_map_pack"
  ON "engine_run_mention_map" ("query_pack_id");
CREATE INDEX IF NOT EXISTS "idx_engine_run_mention_map_corpus_lens"
  ON "engine_run_mention_map" ("study_corpus_id", "lens_slug", "scope", "signal_intent");
