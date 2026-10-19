-- Engine comparativo: tablas generalizadas para metodologias no-T&B.
-- Idempotente y sin activar runtime. T&B permanece intacto.

CREATE TABLE IF NOT EXISTS "engine_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_corpus_id" uuid NOT NULL,
  "snapshot_id" uuid,
  "methodology_slug" text NOT NULL,
  "methodology_version" text NOT NULL,
  "pipeline_version" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "current_step" text NOT NULL DEFAULT 'preflight',
  "business_question" text,
  "params" jsonb,
  "meta_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "limitations" jsonb DEFAULT '[]'::jsonb,
  "executed_by_user_id" uuid,
  "executed_at" timestamp with time zone DEFAULT now(),
  "failed_at" timestamp with time zone,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "engine_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_analysis_id" uuid NOT NULL,
  "study_corpus_id" uuid NOT NULL,
  "methodology_slug" text NOT NULL,
  "finding_key" text NOT NULL,
  "entity_id" text,
  "unit_kind" text NOT NULL,
  "name" text NOT NULL,
  "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "frequency" integer NOT NULL DEFAULT 0,
  "intensity" numeric(3,2),
  "sentiment" numeric(4,3),
  "share_pct" numeric(5,2),
  "composite_score" numeric(6,3),
  "ownership" text,
  "differentiation_index" numeric(4,3),
  "confidence" text,
  "confidence_factors" jsonb,
  "period_start" date,
  "period_end" date,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "engine_codings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_analysis_id" uuid NOT NULL,
  "study_corpus_id" uuid NOT NULL,
  "methodology_slug" text NOT NULL,
  "mention_id" uuid,
  "source_id" uuid,
  "finding_id" uuid,
  "entity_id" text,
  "labels" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "intensity" numeric(3,2),
  "span" text,
  "ambiguous" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "engine_finding_citations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "finding_id" uuid NOT NULL,
  "mention_id" uuid,
  "source_id" uuid,
  "is_protagonist" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "engine_pipeline_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_analysis_id" uuid NOT NULL,
  "step" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "bullmq_job_id" text,
  "attempt" integer NOT NULL DEFAULT 1,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "duration_ms" integer,
  "error_message" text,
  "result_summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_analyses_corpus_fk') THEN
    ALTER TABLE "engine_analyses" ADD CONSTRAINT "engine_analyses_corpus_fk"
      FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_analyses_snapshot_fk') THEN
    ALTER TABLE "engine_analyses" ADD CONSTRAINT "engine_analyses_snapshot_fk"
      FOREIGN KEY ("snapshot_id") REFERENCES "public"."corpus_snapshots"("id") ON DELETE set null;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_analyses_user_fk') THEN
    ALTER TABLE "engine_analyses" ADD CONSTRAINT "engine_analyses_user_fk"
      FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_findings_analysis_fk') THEN
    ALTER TABLE "engine_findings" ADD CONSTRAINT "engine_findings_analysis_fk"
      FOREIGN KEY ("engine_analysis_id") REFERENCES "public"."engine_analyses"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_findings_corpus_fk') THEN
    ALTER TABLE "engine_findings" ADD CONSTRAINT "engine_findings_corpus_fk"
      FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_codings_analysis_fk') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_codings_analysis_fk"
      FOREIGN KEY ("engine_analysis_id") REFERENCES "public"."engine_analyses"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_codings_corpus_fk') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_codings_corpus_fk"
      FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_codings_mention_fk') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_codings_mention_fk"
      FOREIGN KEY ("mention_id") REFERENCES "public"."mentions"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_codings_source_fk') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_codings_source_fk"
      FOREIGN KEY ("source_id") REFERENCES "public"."brand_knowledge_sources"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_codings_finding_fk') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_codings_finding_fk"
      FOREIGN KEY ("finding_id") REFERENCES "public"."engine_findings"("id") ON DELETE set null;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_coding_has_source') THEN
    ALTER TABLE "engine_codings" ADD CONSTRAINT "engine_coding_has_source"
      CHECK ("mention_id" IS NOT NULL OR "source_id" IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_citations_finding_fk') THEN
    ALTER TABLE "engine_finding_citations" ADD CONSTRAINT "engine_citations_finding_fk"
      FOREIGN KEY ("finding_id") REFERENCES "public"."engine_findings"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_citations_mention_fk') THEN
    ALTER TABLE "engine_finding_citations" ADD CONSTRAINT "engine_citations_mention_fk"
      FOREIGN KEY ("mention_id") REFERENCES "public"."mentions"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_citations_source_fk') THEN
    ALTER TABLE "engine_finding_citations" ADD CONSTRAINT "engine_citations_source_fk"
      FOREIGN KEY ("source_id") REFERENCES "public"."brand_knowledge_sources"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_citation_has_source') THEN
    ALTER TABLE "engine_finding_citations" ADD CONSTRAINT "engine_citation_has_source"
      CHECK ("mention_id" IS NOT NULL OR "source_id" IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_steps_analysis_fk') THEN
    ALTER TABLE "engine_pipeline_steps" ADD CONSTRAINT "engine_steps_analysis_fk"
      FOREIGN KEY ("engine_analysis_id") REFERENCES "public"."engine_analyses"("id") ON DELETE cascade;
  END IF;
END $$;

ALTER TABLE "published_outputs"
  ADD COLUMN IF NOT EXISTS "engine_analysis_id" uuid;

ALTER TABLE "published_outputs"
  ALTER COLUMN "tb_analysis_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'published_outputs_engine_analysis_fk') THEN
    ALTER TABLE "published_outputs" ADD CONSTRAINT "published_outputs_engine_analysis_fk"
      FOREIGN KEY ("engine_analysis_id") REFERENCES "public"."engine_analyses"("id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'published_outputs_has_exactly_one_analysis') THEN
    ALTER TABLE "published_outputs" ADD CONSTRAINT "published_outputs_has_exactly_one_analysis"
      CHECK ((("tb_analysis_id" IS NOT NULL)::int + ("engine_analysis_id" IS NOT NULL)::int) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_engine_analyses_corpus"
  ON "engine_analyses" ("study_corpus_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_engine_analyses_slug"
  ON "engine_analyses" ("methodology_slug", "status");
CREATE INDEX IF NOT EXISTS "idx_engine_findings_analysis"
  ON "engine_findings" ("engine_analysis_id", "unit_kind", "position");
CREATE INDEX IF NOT EXISTS "idx_engine_findings_entity"
  ON "engine_findings" ("engine_analysis_id", "entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_engine_findings_key"
  ON "engine_findings" ("engine_analysis_id", "finding_key", COALESCE("entity_id",''));
CREATE INDEX IF NOT EXISTS "idx_engine_codings_analysis"
  ON "engine_codings" ("engine_analysis_id", "finding_id");
CREATE INDEX IF NOT EXISTS "idx_engine_codings_mention"
  ON "engine_codings" ("mention_id");
CREATE INDEX IF NOT EXISTS "idx_engine_codings_source"
  ON "engine_codings" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_engine_citations_finding"
  ON "engine_finding_citations" ("finding_id", "position");
CREATE INDEX IF NOT EXISTS "idx_engine_steps_analysis"
  ON "engine_pipeline_steps" ("engine_analysis_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_outputs_engine_analysis"
  ON "published_outputs" ("engine_analysis_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_outputs_engine_analysis_type"
  ON "published_outputs" ("engine_analysis_id", "output_type")
  WHERE "engine_analysis_id" IS NOT NULL;
