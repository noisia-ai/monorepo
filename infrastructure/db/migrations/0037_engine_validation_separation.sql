-- Separate query-potential validation from corpus certification.
-- Query validation records SentiOne preview attempts before import.
-- Corpus assessments are bound to an explicit corpus revision after import/cleanup.

ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "corpus_revision" integer NOT NULL DEFAULT 1;

ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "latest_assessed_revision" integer;

CREATE TABLE IF NOT EXISTS "query_validation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "query_iteration_id" uuid NOT NULL REFERENCES "query_iterations"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'running',
  "source_system" text NOT NULL DEFAULT 'sentione',
  "source_project_id" text,
  "sample_size_per_pack" integer NOT NULL DEFAULT 25,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "pipeline_version" text NOT NULL,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_query_validation_runs_iteration"
  ON "query_validation_runs" ("query_iteration_id", "started_at");
CREATE INDEX IF NOT EXISTS "idx_query_validation_runs_corpus"
  ON "query_validation_runs" ("study_corpus_id", "started_at");

CREATE TABLE IF NOT EXISTS "query_validation_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "query_validation_run_id" uuid NOT NULL REFERENCES "query_validation_runs"("id") ON DELETE CASCADE,
  "query_pack_id" uuid NOT NULL REFERENCES "query_packs"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "query_text" text NOT NULL,
  "sample_size" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "proposed_adjustments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model" text,
  "evaluated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_query_validation_attempt" UNIQUE (
    "query_validation_run_id",
    "query_pack_id",
    "attempt_number"
  )
);

CREATE INDEX IF NOT EXISTS "idx_query_validation_attempts_pack"
  ON "query_validation_attempts" ("query_pack_id", "evaluated_at");

CREATE TABLE IF NOT EXISTS "query_validation_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "query_validation_attempt_id" uuid NOT NULL REFERENCES "query_validation_attempts"("id") ON DELETE CASCADE,
  "external_mention_id" text NOT NULL,
  "relevance" text NOT NULL,
  "signal_types" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "reason" text,
  "mention_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_query_validation_mention" UNIQUE (
    "query_validation_attempt_id",
    "external_mention_id"
  )
);

CREATE INDEX IF NOT EXISTS "idx_query_validation_mentions_attempt"
  ON "query_validation_mentions" ("query_validation_attempt_id", "relevance");

CREATE TABLE IF NOT EXISTS "corpus_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "corpus_revision" integer NOT NULL,
  "population_size" integer NOT NULL,
  "sample_size" integer NOT NULL,
  "sample_strategy" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "ready_for_study" boolean,
  "confidence" numeric(5, 2),
  "verdict" text,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "findings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "model" text,
  "pipeline_version" text NOT NULL,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_corpus_assessments_revision"
  ON "corpus_assessments" ("study_corpus_id", "corpus_revision", "started_at");
CREATE INDEX IF NOT EXISTS "idx_corpus_assessments_status"
  ON "corpus_assessments" ("study_corpus_id", "status");

CREATE TABLE IF NOT EXISTS "corpus_assessment_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "corpus_assessment_id" uuid NOT NULL REFERENCES "corpus_assessments"("id") ON DELETE CASCADE,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  "relevance" text NOT NULL,
  "signal_types" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "reason" text,
  "classification_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_corpus_assessment_mention" UNIQUE (
    "corpus_assessment_id",
    "mention_id"
  )
);

CREATE INDEX IF NOT EXISTS "idx_corpus_assessment_mentions_assessment"
  ON "corpus_assessment_mentions" ("corpus_assessment_id", "relevance");
