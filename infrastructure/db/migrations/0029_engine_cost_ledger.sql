-- Engine cost ledger.
-- Additive audit table for model/token/cost events. Does not activate runtime.

CREATE TABLE IF NOT EXISTS "engine_cost_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_analysis_id" uuid NOT NULL REFERENCES "engine_analyses"("id") ON DELETE CASCADE,
  "pipeline_step_id" uuid REFERENCES "engine_pipeline_steps"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "model" text,
  "operation" text NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "estimated_cost_usd" numeric(10,4),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_engine_cost_events_analysis"
  ON "engine_cost_events" ("engine_analysis_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_engine_cost_events_step"
  ON "engine_cost_events" ("pipeline_step_id");
CREATE INDEX IF NOT EXISTS "idx_engine_cost_events_operation"
  ON "engine_cost_events" ("operation", "provider", "model");
