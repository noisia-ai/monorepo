-- Monthly live intelligence cuts + persisted Composer editorial state.
-- Additive only: published Signal snapshots keep working as-is.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_output_window"
  ON "signal_observations" ("canonical_signal_id", "published_output_id", "window_start", "window_end")
  WHERE "published_output_id" IS NOT NULL
    AND "snapshot_id" IS NULL
    AND "tb_analysis_id" IS NULL
    AND "engine_analysis_id" IS NULL;

CREATE TABLE IF NOT EXISTS "signal_composer_edits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "output_id" uuid NOT NULL REFERENCES "published_outputs"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'draft',
  "selection" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "draft" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_composer_edits_output"
  ON "signal_composer_edits" ("output_id");

CREATE INDEX IF NOT EXISTS "idx_signal_composer_edits_corpus"
  ON "signal_composer_edits" ("study_corpus_id", "updated_at");
