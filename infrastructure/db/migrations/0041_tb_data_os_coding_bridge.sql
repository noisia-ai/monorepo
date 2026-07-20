-- Bridge Triggers & Barriers mention codings into the generic Data OS layer.
-- This migration is additive: analysis-specific provenance is explicit and
-- the methodology catalog is seeded without changing existing coded records.

ALTER TABLE "record_tags"
  ADD COLUMN IF NOT EXISTS "tb_analysis_id" uuid;

ALTER TABLE "record_feature_values"
  ADD COLUMN IF NOT EXISTS "tb_analysis_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'record_tags_tb_analysis_id_tb_analyses_id_fk'
  ) THEN
    ALTER TABLE "record_tags"
      ADD CONSTRAINT "record_tags_tb_analysis_id_tb_analyses_id_fk"
      FOREIGN KEY ("tb_analysis_id") REFERENCES "tb_analyses"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'record_feature_values_tb_analysis_id_tb_analyses_id_fk'
  ) THEN
    ALTER TABLE "record_feature_values"
      ADD CONSTRAINT "record_feature_values_tb_analysis_id_tb_analyses_id_fk"
      FOREIGN KEY ("tb_analysis_id") REFERENCES "tb_analyses"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_record_tags_tb_analysis"
  ON "record_tags" ("tb_analysis_id", "subject_type", "taxonomy_term_id");

CREATE INDEX IF NOT EXISTS "idx_record_feature_values_tb_analysis"
  ON "record_feature_values" ("tb_analysis_id", "subject_type", "feature_key");

INSERT INTO "taxonomies" (
  "taxonomy_key", "name", "description", "scope", "methodology_slug", "status"
)
VALUES
  ('trigger', 'Triggers', 'Motivadores observables que acercan a una audiencia a una decision, marca o accion.', 'global', NULL, 'active'),
  ('barrier', 'Barriers', 'Fricciones observables que alejan a una audiencia de una decision, marca o accion.', 'global', NULL, 'active'),
  ('tb_layer', 'Triggers & Barriers layer', 'Capa de lectura personal, psicologica, social o cultural del metodo Triggers & Barriers.', 'methodology', 'triggers-barriers', 'active')
ON CONFLICT ("taxonomy_key") DO UPDATE SET
  "status" = 'active';

WITH catalog("taxonomy_key", "term_key", "label", "description", "sort_order", "metadata") AS (
  VALUES
    ('trigger', 'emergent', 'Emergent trigger', 'Candidate trigger discovered in a governed T&B analysis.', 900, '{"candidate_parent":true,"contract":"tb_data_os_v1"}'::jsonb),
    ('barrier', 'emergent', 'Emergent barrier', 'Candidate barrier discovered in a governed T&B analysis.', 900, '{"candidate_parent":true,"contract":"tb_data_os_v1"}'::jsonb),
    ('tb_layer', 'personal', 'Personal', 'Individual, practical or directly experienced layer.', 10, '{"contract":"tb_data_os_v1"}'::jsonb),
    ('tb_layer', 'psicologico', 'Psychological', 'Cognitive, emotional or identity-related layer.', 20, '{"contract":"tb_data_os_v1"}'::jsonb),
    ('tb_layer', 'social', 'Social', 'Relational, group or status-related layer.', 30, '{"contract":"tb_data_os_v1"}'::jsonb),
    ('tb_layer', 'cultural', 'Cultural', 'Norm, narrative or shared-symbol layer.', 40, '{"contract":"tb_data_os_v1"}'::jsonb)
)
INSERT INTO "taxonomy_terms" (
  "taxonomy_id", "term_key", "label", "description", "sort_order", "metadata", "status"
)
SELECT
  t.id,
  catalog.term_key,
  catalog.label,
  catalog.description,
  catalog.sort_order,
  catalog.metadata,
  'active'
FROM catalog
JOIN taxonomies t ON t.taxonomy_key = catalog.taxonomy_key
ON CONFLICT ("taxonomy_id", "term_key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sort_order" = EXCLUDED."sort_order",
  "metadata" = "taxonomy_terms"."metadata" || EXCLUDED."metadata",
  "status" = 'active';

WITH bindings("taxonomy_key", "role", "required") AS (
  VALUES
    ('trigger', 'output', true),
    ('barrier', 'output', true),
    ('tb_layer', 'dimension', true)
)
INSERT INTO "methodology_taxonomy_bindings" (
  "methodology_slug", "taxonomy_id", "role", "required", "metadata"
)
SELECT
  'triggers-barriers',
  t.id,
  bindings.role,
  bindings.required,
  '{"contract":"tb_data_os_v1"}'::jsonb
FROM bindings
JOIN taxonomies t ON t.taxonomy_key = bindings.taxonomy_key
ON CONFLICT ("methodology_slug", "taxonomy_id", "role") DO UPDATE SET
  "required" = EXCLUDED."required",
  "metadata" = "methodology_taxonomy_bindings"."metadata" || EXCLUDED."metadata";
