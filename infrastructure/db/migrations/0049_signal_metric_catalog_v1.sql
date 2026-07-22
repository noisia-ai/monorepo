-- Version the existing metric_definitions registry for Signal metric catalog V1.
-- No parallel catalog is introduced; semantic_models remains the grouping layer.

ALTER TABLE metric_definitions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metric_group_key text,
  ADD COLUMN IF NOT EXISTS formula_hash text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal';

ALTER TABLE metric_definitions
  DROP CONSTRAINT IF EXISTS metric_definitions_metric_key_key;

ALTER TABLE metric_definitions
  DROP CONSTRAINT IF EXISTS uq_metric_definitions_key_version;

ALTER TABLE metric_definitions
  ADD CONSTRAINT uq_metric_definitions_key_version UNIQUE (metric_key, version);

ALTER TABLE metric_definitions
  DROP CONSTRAINT IF EXISTS metric_definitions_version_positive;
ALTER TABLE metric_definitions
  ADD CONSTRAINT metric_definitions_version_positive CHECK (version >= 1);

ALTER TABLE metric_definitions
  DROP CONSTRAINT IF EXISTS metric_definitions_visibility;
ALTER TABLE metric_definitions
  ADD CONSTRAINT metric_definitions_visibility CHECK (
    visibility IN ('internal', 'client', 'both')
  );

ALTER TABLE metric_definitions
  DROP CONSTRAINT IF EXISTS metric_definitions_formula_hash;
ALTER TABLE metric_definitions
  ADD CONSTRAINT metric_definitions_formula_hash CHECK (
    formula_hash IS NULL OR formula_hash ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE INDEX IF NOT EXISTS idx_metric_definitions_group_version
  ON metric_definitions (metric_group_key, version, status)
  WHERE metric_group_key IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_metric_definition_formula_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.metric_key IS DISTINCT FROM OLD.metric_key
     OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'Metric key and version are immutable; insert a new version.'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.definition->'formula') IS DISTINCT FROM (OLD.definition->'formula') THEN
    RAISE EXCEPTION 'Metric formula changes require a new metric version.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_metric_definitions_formula_version ON metric_definitions;
CREATE TRIGGER trg_metric_definitions_formula_version
  BEFORE UPDATE OF metric_key, version, definition
  ON metric_definitions
  FOR EACH ROW
  EXECUTE FUNCTION protect_metric_definition_formula_version();
