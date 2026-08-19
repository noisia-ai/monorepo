-- Signal operational serving: additive population-scoped materializations and invalidations.
-- Legacy corpus rows remain valid and readable for rollback.

ALTER TABLE metric_materializations
  ADD COLUMN IF NOT EXISTS population_id uuid
    REFERENCES signal_population_definitions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS population_version integer,
  ADD COLUMN IF NOT EXISTS population_definition_hash text;

ALTER TABLE metric_materializations
  DROP CONSTRAINT IF EXISTS metric_materializations_operational_scope,
  ADD CONSTRAINT metric_materializations_operational_scope CHECK (
    workspace_id IS NULL
    OR (
      (study_corpus_id IS NOT NULL AND population_id IS NULL
        AND population_version IS NULL AND population_definition_hash IS NULL)
      OR
      (study_corpus_id IS NULL AND population_id IS NOT NULL
        AND population_version >= 1
        AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$')
    )
  );

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_population_facade
  ON metric_materializations (
    workspace_id, population_id, population_version, filters_hash,
    metric_key, metric_version, computed_at DESC
  )
  WHERE workspace_id IS NOT NULL AND population_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_population_period
  ON metric_materializations (population_id, population_version, period_start, period_end)
  WHERE population_id IS NOT NULL;

ALTER TABLE signal_data_invalidations
  ADD COLUMN IF NOT EXISTS population_id uuid
    REFERENCES signal_population_definitions(id) ON DELETE CASCADE;

ALTER TABLE signal_data_invalidations
  ALTER COLUMN study_corpus_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS signal_data_invalidations_operational_scope,
  ADD CONSTRAINT signal_data_invalidations_operational_scope CHECK (
    (study_corpus_id IS NOT NULL AND population_id IS NULL)
    OR (study_corpus_id IS NULL AND population_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_signal_data_invalidations_population_scope
  ON signal_data_invalidations (
    workspace_id, population_id, affected_from, affected_through, created_at
  )
  WHERE population_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_operational_serving_shadow_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE CASCADE,
  legacy_study_corpus_id uuid REFERENCES study_corpora(id) ON DELETE SET NULL,
  module text NOT NULL,
  filters_hash text NOT NULL,
  population_version integer NOT NULL,
  population_definition_hash text NOT NULL,
  state text NOT NULL,
  contract_violation_count integer NOT NULL DEFAULT 0,
  unexplained_count integer NOT NULL DEFAULT 0,
  legacy_differences_by_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  governed_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_operational_serving_shadow_module CHECK (
    module IN ('brand_monitoring', 'mentions', 'topics_narratives')
  ),
  CONSTRAINT signal_operational_serving_shadow_state CHECK (
    state IN ('exact', 'correct_with_explained_legacy_differences', 'failed')
  ),
  CONSTRAINT signal_operational_serving_shadow_nonnegative CHECK (
    contract_violation_count >= 0 AND unexplained_count >= 0 AND duration_ms >= 0
  ),
  CONSTRAINT signal_operational_serving_shadow_hash CHECK (
    filters_hash ~ '^sha256:[0-9a-f]{64}$'
    AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_operational_serving_shadow_latest
  ON signal_operational_serving_shadow_results (workspace_id, module, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_signal_population_materialization_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.population_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
      AND definition.version = NEW.population_version
      AND definition.definition_hash = NEW.population_definition_hash
  ) THEN
    RAISE EXCEPTION 'Population materialization scope does not match the workspace definition.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_materialization_scope
  ON metric_materializations;
CREATE TRIGGER trg_signal_population_materialization_scope
  BEFORE INSERT OR UPDATE OF workspace_id, population_id,
    population_version, population_definition_hash
  ON metric_materializations FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_materialization_scope();

CREATE OR REPLACE FUNCTION enforce_signal_population_invalidation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.population_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Population invalidation does not belong to the workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM signal_data_watermarks watermark
    WHERE watermark.id = NEW.data_watermark_id
      AND watermark.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Invalidation watermark does not belong to the workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_invalidation_scope
  ON signal_data_invalidations;
CREATE TRIGGER trg_signal_population_invalidation_scope
  BEFORE INSERT OR UPDATE OF workspace_id, population_id, data_watermark_id
  ON signal_data_invalidations FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_invalidation_scope();

CREATE OR REPLACE FUNCTION enforce_signal_operational_shadow_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
      AND definition.version = NEW.population_version
      AND definition.definition_hash = NEW.population_definition_hash
  ) THEN
    RAISE EXCEPTION 'Operational shadow population does not match the workspace definition.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.legacy_study_corpus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_workspace_corpora membership
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.study_corpus_id = NEW.legacy_study_corpus_id
  ) THEN
    RAISE EXCEPTION 'Operational shadow legacy corpus does not belong to the workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_operational_shadow_scope
  ON signal_operational_serving_shadow_results;
CREATE TRIGGER trg_signal_operational_shadow_scope
  BEFORE INSERT OR UPDATE OF workspace_id, population_id,
    population_version, population_definition_hash, legacy_study_corpus_id
  ON signal_operational_serving_shadow_results FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_operational_shadow_scope();

CREATE OR REPLACE FUNCTION record_signal_workspace_data_acceptance_v2(
  target_workspace_id uuid,
  target_source_key text,
  target_data_source_id uuid,
  target_import_batch_id uuid,
  target_accepted_at timestamptz,
  target_materialized_at timestamptz
)
RETURNS TABLE (
  watermark_id uuid,
  workspace_id uuid,
  population_id uuid,
  invalidation_id uuid,
  changed boolean
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE accepted record;
DECLARE target_invalidation_id uuid;
DECLARE affected_start date;
DECLARE affected_end date;
DECLARE target_definition_version integer;
DECLARE target_definition_hash text;
BEGIN
  SELECT * INTO accepted
  FROM record_signal_workspace_data_acceptance(
    target_workspace_id,
    target_source_key,
    target_data_source_id,
    target_import_batch_id,
    target_accepted_at,
    target_materialized_at
  );
  IF accepted.population_id IS NULL THEN
    RAISE EXCEPTION 'Workspace acceptance requires an active operational population.'
      USING ERRCODE = '23514';
  END IF;
  SELECT definition.version, definition.definition_hash
  INTO target_definition_version, target_definition_hash
  FROM signal_population_definitions definition
  WHERE definition.id = accepted.population_id
    AND definition.workspace_id = target_workspace_id
    AND definition.purpose = 'operational'
    AND definition.status = 'active';
  IF target_definition_version IS NULL THEN
    RAISE EXCEPTION 'Workspace acceptance population is not active.'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    min((mention.published_at AT TIME ZONE workspace.timezone)::date),
    max((mention.published_at AT TIME ZONE workspace.timezone)::date)
  INTO affected_start, affected_end
  FROM signal_mention_import_memberships membership
  JOIN mentions mention
    ON mention.id = membership.mention_id
   AND mention.workspace_id = membership.workspace_id
   AND mention.canonical_mention_id = mention.id
  JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
  WHERE membership.workspace_id = target_workspace_id
    AND membership.import_batch_id = target_import_batch_id;
  IF accepted.changed THEN
    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, population_id, data_watermark_id,
      source_key, idempotency_key, reason, affected_from, affected_through,
      scope
    ) VALUES (
      target_workspace_id, NULL, accepted.population_id, accepted.watermark_id,
      target_source_key,
      'sha256:' || encode(sha256(convert_to(
        concat_ws(':', 'workspace-acceptance-v2', target_workspace_id::text,
          accepted.population_id::text, target_definition_version::text,
          target_definition_hash, target_import_batch_id::text),
        'UTF8')), 'hex'),
      'workspace_data_accepted', affected_start, affected_end,
      jsonb_build_object(
        'kind', 'governed_population',
        'population_id', accepted.population_id,
        'population_version', target_definition_version,
        'population_definition_hash', target_definition_hash
      )
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING id INTO target_invalidation_id;
  ELSE
    SELECT invalidation.id INTO target_invalidation_id
    FROM signal_data_invalidations invalidation
    WHERE invalidation.idempotency_key = 'sha256:' || encode(sha256(convert_to(
      concat_ws(':', 'workspace-acceptance-v2', target_workspace_id::text,
        accepted.population_id::text, target_definition_version::text,
        target_definition_hash, target_import_batch_id::text),
      'UTF8')), 'hex');
  END IF;
  watermark_id := accepted.watermark_id;
  workspace_id := accepted.workspace_id;
  population_id := accepted.population_id;
  invalidation_id := target_invalidation_id;
  changed := accepted.changed;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_signal_operational_population_materializations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE latest_watermark_id uuid;
DECLARE affected_start date;
DECLARE affected_end date;
DECLARE definition_version integer;
DECLARE definition_hash text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.purpose = 'operational' THEN
      UPDATE metric_materializations
      SET materialization_state = 'stale', stale_after = now()
      WHERE workspace_id = OLD.workspace_id
        AND population_id = OLD.population_id
        AND materialization_state <> 'stale';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.purpose <> 'operational'
    OR (TG_OP = 'UPDATE' AND OLD.population_id = NEW.population_id) THEN
    RETURN NEW;
  END IF;
  UPDATE metric_materializations
  SET materialization_state = 'stale', stale_after = now()
  WHERE workspace_id = NEW.workspace_id
    AND population_id IN (NEW.population_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.population_id ELSE NEW.population_id END)
    AND materialization_state <> 'stale';
  UPDATE signal_data_watermarks
  SET population_id = NEW.population_id,
      data_freshness_state = CASE
        WHEN data_freshness_state = 'fresh' THEN 'stale'
        ELSE data_freshness_state
      END,
      updated_at = now()
  WHERE workspace_id = NEW.workspace_id
    AND study_corpus_id IS NULL
    AND population_id IS DISTINCT FROM NEW.population_id;
  SELECT definition.version, definition.definition_hash
  INTO definition_version, definition_hash
  FROM signal_population_definitions definition
  WHERE definition.id = NEW.population_id;
  SELECT watermark.id INTO latest_watermark_id
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id = NEW.workspace_id
    AND watermark.study_corpus_id IS NULL
  ORDER BY watermark.accepted_at DESC, watermark.id DESC
  LIMIT 1;
  SELECT min(mention.published_at::date), max(mention.published_at::date)
  INTO affected_start, affected_end
  FROM signal_population_memberships membership
  JOIN mentions mention ON mention.id = membership.mention_id
  WHERE membership.population_id = NEW.population_id
    AND membership.workspace_id = NEW.workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  IF latest_watermark_id IS NOT NULL THEN
    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, population_id, data_watermark_id,
      source_key, idempotency_key, reason, affected_from, affected_through, scope
    ) VALUES (
      NEW.workspace_id, NULL, NEW.population_id, latest_watermark_id,
      'population:' || NEW.population_id::text,
      'sha256:' || encode(sha256(convert_to(
        concat_ws(':', 'population-promotion-v1', NEW.workspace_id::text,
          NEW.population_id::text, NEW.promoted_at::text),
        'UTF8')), 'hex'),
      'operational_population_promoted', affected_start, affected_end,
      jsonb_build_object(
        'kind', 'governed_population',
        'population_id', NEW.population_id,
        'population_version', definition_version,
        'population_definition_hash', definition_hash
      )
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_pointer_materialization_invalidate
  ON signal_workspace_population_pointers;
CREATE TRIGGER trg_signal_population_pointer_materialization_invalidate
  AFTER INSERT OR UPDATE OF population_id OR DELETE
  ON signal_workspace_population_pointers FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_operational_population_materializations();
