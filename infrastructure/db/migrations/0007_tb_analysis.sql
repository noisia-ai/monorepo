-- ============================================================
-- Triggers & Barriers analysis pipeline tables
-- Spec: docs/product/03_TRIGGERS_BARRIERS_DEEPDIVE.md
-- ============================================================

-- 1. Master row per run of the T&B pipeline against a corpus snapshot
CREATE TABLE IF NOT EXISTS "tb_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "snapshot_id" uuid NOT NULL REFERENCES "corpus_snapshots"("id"),
  "pipeline_version" text NOT NULL,
  "methodology_version" text NOT NULL,

  "status" text NOT NULL DEFAULT 'running',
  -- running | needs_review | approved_by_im | approved_by_kam | failed | aborted_preflight

  "current_step" text NOT NULL DEFAULT 'preflight',
  -- preflight | step1_open_pass | step2_coding | step3_hierarchy |
  -- step4_mobility | step5_comparative | step6_synthesis | review | done

  "business_question" text,
  "decision_to_inform" text,

  -- Hot blocks (still jsonb because they're rich and rarely queried column-wise)
  "meta_json" jsonb,
  "corpus_snapshot_json" jsonb,

  -- Cold blocks emitted by step 6
  "activation_playbook" jsonb,
  "friction_removal_plan" jsonb,
  "comparative_brief" jsonb,
  "limitations" jsonb,
  "confidence_per_finding" jsonb,

  "executed_by_user_id" uuid REFERENCES "users"("id"),
  "approved_by_im_user_id" uuid REFERENCES "users"("id"),
  "approved_by_kam_user_id" uuid REFERENCES "users"("id"),
  "executed_at" timestamp with time zone DEFAULT now(),
  "im_approved_at" timestamp with time zone,
  "kam_approved_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "failure_reason" text,

  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tb_analyses_corpus" ON "tb_analyses"("study_corpus_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tb_analyses_status" ON "tb_analyses"("status");

-- 2. Each trigger/barrier as a row. This is the hot path for the dashboard.
CREATE TABLE IF NOT EXISTS "tb_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "finding_id" text NOT NULL, -- "T-PSI-01" — human readable id used by Claude
  "polarity" text NOT NULL,   -- 'trigger' | 'barrier'
  "layer" text NOT NULL,      -- 'psicologico' | 'personal' | 'social' | 'cultural'
  "nombre_comercial" text NOT NULL,

  -- Evidence block flattened
  "frecuencia" integer NOT NULL DEFAULT 0,
  "intensidad_promedio" numeric(3, 2),
  "capacidad_predictiva" numeric(3, 2),
  "score_compuesto" numeric(4, 2),

  "movilidad" text, -- 'movible_por_marca' | 'parcialmente_movible' | 'estructural'
  "movilidad_razon" text,
  "confidence" text, -- 'alta' | 'media' | 'baja_direccional'

  "cita_protagonista" jsonb,
  "raw_data" jsonb,

  "position_in_layer" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),

  UNIQUE("tb_analysis_id", "finding_id")
);

CREATE INDEX IF NOT EXISTS "idx_tb_findings_kanban" ON "tb_findings"("tb_analysis_id", "polarity", "layer", "position_in_layer");
CREATE INDEX IF NOT EXISTS "idx_tb_findings_top" ON "tb_findings"("tb_analysis_id", "score_compuesto" DESC);

-- 3. Citations (verbatims) linked to mentions for referential integrity.
CREATE TABLE IF NOT EXISTS "tb_finding_citations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "finding_id" uuid NOT NULL REFERENCES "tb_findings"("id") ON DELETE CASCADE,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  "is_protagonist" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),

  UNIQUE("finding_id", "mention_id")
);

CREATE INDEX IF NOT EXISTS "idx_tb_citations_finding" ON "tb_finding_citations"("finding_id", "position");
CREATE INDEX IF NOT EXISTS "idx_tb_citations_mention" ON "tb_finding_citations"("mention_id");

-- 4. Many-to-many: each mention can be coded against multiple findings, and
-- the coding is scoped to a specific analysis run (so re-runs don't clobber).
CREATE TABLE IF NOT EXISTS "tb_mention_codings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  "finding_id" uuid REFERENCES "tb_findings"("id") ON DELETE CASCADE,
  -- finding_id is nullable so step 2 can record the polarity/layer coding even
  -- before step 3 has consolidated the findings.
  "polarity" text NOT NULL, -- 'trigger' | 'barrier' | 'mixed' | 'irrelevant'
  "layer" text,
  "intensity_score" numeric(3, 2),
  "emergent_tags" text[],   -- from step 1 (open pass)
  "ambiguous" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),

  UNIQUE("tb_analysis_id", "mention_id", "finding_id")
);

CREATE INDEX IF NOT EXISTS "idx_tb_codings_analysis_finding" ON "tb_mention_codings"("tb_analysis_id", "finding_id");
CREATE INDEX IF NOT EXISTS "idx_tb_codings_mention" ON "tb_mention_codings"("mention_id");
CREATE INDEX IF NOT EXISTS "idx_tb_codings_analysis_polarity_layer" ON "tb_mention_codings"("tb_analysis_id", "polarity", "layer");

-- 5. Recommendations split by kind (activation playbook + friction removal + structural)
CREATE TABLE IF NOT EXISTS "tb_recommendations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "finding_id" uuid REFERENCES "tb_findings"("id") ON DELETE CASCADE,
  "kind" text NOT NULL, -- 'activation' | 'friction_removal' | 'structural_note'

  -- activation fields
  "medio_recomendado" text,
  "tono_recomendado" text,
  "riesgo_saturacion" text,
  "categoria_donde_aplica" text[],

  -- friction_removal fields
  "intervencion_sugerida" text,
  "tipo_intervencion" text,
  "inversion_estimada" text,
  "indicador_exito" text,
  "responsable_sugerido" text,

  -- structural_note fields
  "razon_estructural" text,
  "recomendacion" text,

  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tb_recs_analysis" ON "tb_recommendations"("tb_analysis_id", "kind", "position");
CREATE INDEX IF NOT EXISTS "idx_tb_recs_finding" ON "tb_recommendations"("finding_id");

-- 6. The 7 quality gates that run before status=needs_review
CREATE TABLE IF NOT EXISTS "tb_quality_gates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "gate_name" text NOT NULL,
  "passed" boolean NOT NULL,
  "notes" text,
  "checked_at" timestamp with time zone DEFAULT now(),

  UNIQUE("tb_analysis_id", "gate_name")
);

CREATE INDEX IF NOT EXISTS "idx_tb_gates_analysis" ON "tb_quality_gates"("tb_analysis_id");

-- 7. Execution log per step so the UI can show "in step 3, last attempt failed"
-- and the IM can re-run individual steps.
CREATE TABLE IF NOT EXISTS "tb_pipeline_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tb_analysis_id" uuid NOT NULL REFERENCES "tb_analyses"("id") ON DELETE CASCADE,
  "step" text NOT NULL, -- 'preflight' | 'step1_open_pass' | ... | 'step6_synthesis' | 'quality_gates'
  "status" text NOT NULL DEFAULT 'queued', -- queued | running | completed | failed | skipped
  "bullmq_job_id" text,
  "attempt" integer NOT NULL DEFAULT 1,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "duration_ms" integer,
  "error_message" text,
  "result_summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tb_steps_analysis" ON "tb_pipeline_steps"("tb_analysis_id", "created_at" DESC);

-- 8. Lock column on study_corpora so the IM knows the corpus is frozen
-- during an analysis run. Force-unlock allowed if a run hangs.
ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "locked_by_analysis_id" uuid REFERENCES "tb_analyses"("id");
