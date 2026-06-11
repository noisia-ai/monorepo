-- Keep live signal observations idempotent per analysis run.
-- Additive only: no data is deleted and published snapshots remain untouched.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_tb_analysis"
  ON "signal_observations" ("canonical_signal_id", "tb_analysis_id")
  WHERE "tb_analysis_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_engine_analysis"
  ON "signal_observations" ("canonical_signal_id", "engine_analysis_id")
  WHERE "engine_analysis_id" IS NOT NULL;
