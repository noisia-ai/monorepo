-- Noisia Live Intelligence Store.
-- Adds query-pack provenance and persistent signals/observations.
-- Additive only: existing T&B and published output snapshots remain intact.

CREATE TABLE IF NOT EXISTS "query_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "query_iteration_id" uuid REFERENCES "query_iterations"("id") ON DELETE SET NULL,
  "lens_slug" text NOT NULL,
  "signal_intent" text NOT NULL,
  "scope" text NOT NULL,
  "objective" text,
  "query_text" text,
  "query_components" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seeds" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evaluation" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'planned',
  "mentions_returned" integer,
  "quality_score" numeric(5,2),
  "density_score" numeric(5,2),
  "noise_score" numeric(5,2),
  "cost_budget" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "evaluated_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_query_packs_corpus"
  ON "query_packs" ("study_corpus_id");
CREATE INDEX IF NOT EXISTS "idx_query_packs_lens"
  ON "query_packs" ("study_corpus_id", "lens_slug", "signal_intent", "scope");
CREATE INDEX IF NOT EXISTS "idx_query_packs_status"
  ON "query_packs" ("study_corpus_id", "status");
CREATE INDEX IF NOT EXISTS "idx_query_packs_iteration"
  ON "query_packs" ("query_iteration_id");

CREATE TABLE IF NOT EXISTS "mention_query_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "query_pack_id" uuid REFERENCES "query_packs"("id") ON DELETE SET NULL,
  "query_iteration_id" uuid REFERENCES "query_iterations"("id") ON DELETE SET NULL,
  "import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE SET NULL,
  "lens_slug" text,
  "signal_intent" text,
  "scope" text,
  "corpus_entity_id" uuid REFERENCES "corpus_entities"("id") ON DELETE SET NULL,
  "entity_id" text,
  "match_quality" numeric(4,3),
  "match_reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_mention_query_sources_mention"
  ON "mention_query_sources" ("mention_id");
CREATE INDEX IF NOT EXISTS "idx_mention_query_sources_corpus"
  ON "mention_query_sources" ("study_corpus_id", "lens_slug", "signal_intent", "scope");
CREATE INDEX IF NOT EXISTS "idx_mention_query_sources_pack"
  ON "mention_query_sources" ("query_pack_id");
CREATE INDEX IF NOT EXISTS "idx_mention_query_sources_entity"
  ON "mention_query_sources" ("study_corpus_id", "corpus_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mention_query_source_pack"
  ON "mention_query_sources" ("mention_id", "query_pack_id")
  WHERE "query_pack_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "canonical_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE SET NULL,
  "methodology_slug" text NOT NULL,
  "signal_type" text NOT NULL,
  "canonical_title" text NOT NULL,
  "semantic_key" text NOT NULL,
  "description" text,
  "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "created_from_tb_finding_id" uuid REFERENCES "tb_findings"("id") ON DELETE SET NULL,
  "created_from_engine_finding_id" uuid REFERENCES "engine_findings"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_canonical_signals_brand"
  ON "canonical_signals" ("brand_id", "methodology_slug", "status");
CREATE INDEX IF NOT EXISTS "idx_canonical_signals_theme"
  ON "canonical_signals" ("theme_id", "methodology_slug", "status");
CREATE INDEX IF NOT EXISTS "idx_canonical_signals_org"
  ON "canonical_signals" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "idx_canonical_signals_corpus"
  ON "canonical_signals" ("study_corpus_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_canonical_signal_scope_key"
  ON "canonical_signals" (
    COALESCE("organization_id"::text, ''),
    COALESCE("brand_id"::text, ''),
    COALESCE("theme_id"::text, ''),
    "methodology_slug",
    "signal_type",
    "semantic_key"
  );

CREATE TABLE IF NOT EXISTS "signal_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_signal_id" uuid NOT NULL REFERENCES "canonical_signals"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "snapshot_id" uuid REFERENCES "corpus_snapshots"("id") ON DELETE SET NULL,
  "tb_analysis_id" uuid REFERENCES "tb_analyses"("id") ON DELETE SET NULL,
  "engine_analysis_id" uuid REFERENCES "engine_analyses"("id") ON DELETE SET NULL,
  "published_output_id" uuid REFERENCES "published_outputs"("id") ON DELETE SET NULL,
  "methodology_slug" text NOT NULL,
  "signal_type" text NOT NULL,
  "window_start" date,
  "window_end" date,
  "frequency" integer NOT NULL DEFAULT 0,
  "share_pct" numeric(6,2),
  "intensity" numeric(3,2),
  "sentiment" numeric(4,3),
  "composite_score" numeric(6,3),
  "confidence" text,
  "rank" integer,
  "delta_vs_previous" numeric(8,3),
  "status" text NOT NULL DEFAULT 'observed',
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_signal_observations_signal"
  ON "signal_observations" ("canonical_signal_id", "window_start", "window_end");
CREATE INDEX IF NOT EXISTS "idx_signal_observations_corpus"
  ON "signal_observations" ("study_corpus_id", "methodology_slug", "signal_type");
CREATE INDEX IF NOT EXISTS "idx_signal_observations_snapshot"
  ON "signal_observations" ("snapshot_id");
CREATE INDEX IF NOT EXISTS "idx_signal_observations_tb"
  ON "signal_observations" ("tb_analysis_id");
CREATE INDEX IF NOT EXISTS "idx_signal_observations_engine"
  ON "signal_observations" ("engine_analysis_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_snapshot"
  ON "signal_observations" ("canonical_signal_id", "snapshot_id")
  WHERE "snapshot_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "signal_observation_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "signal_observation_id" uuid NOT NULL REFERENCES "signal_observations"("id") ON DELETE CASCADE,
  "mention_id" uuid REFERENCES "mentions"("id") ON DELETE CASCADE,
  "source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE CASCADE,
  "tb_finding_citation_id" uuid REFERENCES "tb_finding_citations"("id") ON DELETE SET NULL,
  "engine_finding_citation_id" uuid REFERENCES "engine_finding_citations"("id") ON DELETE SET NULL,
  "quote" text,
  "evidence_role" text,
  "is_protagonist" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signal_observation_evidence_has_source"
    CHECK ("mention_id" IS NOT NULL OR "source_id" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "idx_signal_observation_evidence_observation"
  ON "signal_observation_evidence" ("signal_observation_id", "position");
CREATE INDEX IF NOT EXISTS "idx_signal_observation_evidence_mention"
  ON "signal_observation_evidence" ("mention_id");
CREATE INDEX IF NOT EXISTS "idx_signal_observation_evidence_source"
  ON "signal_observation_evidence" ("source_id");
