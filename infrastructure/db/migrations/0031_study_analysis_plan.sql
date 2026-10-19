ALTER TABLE "study_corpora"
  ADD COLUMN IF NOT EXISTS "analysis_plan" jsonb NOT NULL DEFAULT '{"version":1,"primary_methodology_slug":"triggers-barriers","selected_lenses":["triggers-barriers"],"lens_configs":{},"composer_modules":[]}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_study_corpora_analysis_plan"
  ON "study_corpora" USING gin ("analysis_plan" jsonb_path_ops);
