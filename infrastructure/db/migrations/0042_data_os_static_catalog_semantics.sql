-- Represent master/catalog data without fabricating an event or measurement date.
-- Static observations remain queryable as governed attributes but are excluded
-- from temporal series until a real effective period is supplied.

ALTER TABLE "data_observations"
  DROP CONSTRAINT IF EXISTS "data_observations_period_semantics_check";

ALTER TABLE "data_observations"
  ADD CONSTRAINT "data_observations_period_semantics_check"
  CHECK ("period_semantics" IN ('measurement', 'event', 'snapshot', 'static', 'unknown'))
  NOT VALID;

ALTER TABLE "data_observations"
  VALIDATE CONSTRAINT "data_observations_period_semantics_check";

CREATE INDEX IF NOT EXISTS "idx_data_observations_static_catalog"
  ON "data_observations" ("study_corpus_id", "data_asset_id", "metric_family")
  WHERE "period_semantics" = 'static' AND "quality_status" = 'accepted';
