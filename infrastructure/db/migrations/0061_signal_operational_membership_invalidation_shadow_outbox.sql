-- Signal operational serving hardening.
--
-- 1. Membership eligibility transitions invalidate population-scoped serving.
-- 2. Module shadow comparisons use a durable, deduplicated Postgres outbox.
--
-- This migration is additive. Legacy corpus materializations and readers remain
-- available for rollback.

CREATE OR REPLACE FUNCTION invalidate_signal_population_membership_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_eligible boolean := false;
  next_eligible boolean := false;
  target_workspace_id uuid;
  target_population_id uuid;
  target_mention_id uuid;
  target_population_version integer;
  target_population_hash text;
  target_watermark_id uuid;
  affected_date date;
  transition_key text;
BEGIN
  prior_eligible := CASE WHEN TG_OP = 'INSERT' THEN false ELSE
    OLD.membership_status = 'included' AND OLD.removed_at IS NULL
  END;
  next_eligible := CASE WHEN TG_OP = 'DELETE' THEN false ELSE
    NEW.membership_status = 'included' AND NEW.removed_at IS NULL
  END;

  IF prior_eligible = next_eligible THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Pointer promotion already invalidates both population scopes once in 0060.
  -- Avoid one invalidation per old membership during that bulk transition.
  IF TG_OP = 'UPDATE' AND NEW.membership_reason = 'population_pointer_replaced' THEN
    RETURN NEW;
  END IF;

  target_workspace_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  target_population_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.population_id ELSE NEW.population_id END;
  target_mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;

  SELECT definition.version, definition.definition_hash
  INTO target_population_version, target_population_hash
  FROM signal_population_definitions definition
  WHERE definition.id = target_population_id
    AND definition.workspace_id = target_workspace_id;

  IF target_population_version IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT (mention.published_at AT TIME ZONE workspace.timezone)::date
  INTO affected_date
  FROM mentions mention
  JOIN signal_workspaces workspace ON workspace.id = target_workspace_id
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id;

  UPDATE metric_materializations materialization
  SET materialization_state = CASE
        WHEN materialization.materialization_state = 'not_available'
          THEN materialization.materialization_state
        ELSE 'stale'
      END,
      stale_after = LEAST(COALESCE(materialization.stale_after, now()), now())
  WHERE materialization.workspace_id = target_workspace_id
    AND materialization.study_corpus_id IS NULL
    AND materialization.population_id = target_population_id;

  UPDATE signal_interpretation_freshness freshness
  SET state = CASE WHEN freshness.state = 'not_available' THEN freshness.state ELSE 'stale' END,
      reason = CASE
        WHEN freshness.state = 'not_available' THEN freshness.reason
        ELSE 'population_membership_changed'
      END,
      updated_at = now()
  WHERE freshness.workspace_id = target_workspace_id
    AND freshness.data_scope->>'population_id' = target_population_id::text;

  SELECT watermark.id
  INTO target_watermark_id
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id = target_workspace_id
    AND watermark.study_corpus_id IS NULL
    AND watermark.population_id = target_population_id
  ORDER BY watermark.accepted_at DESC, watermark.id DESC
  LIMIT 1;

  -- A population that has never accepted data has no materialized state to
  -- refresh. Once a watermark exists, every eligibility transition becomes a
  -- durable invalidation for the existing refresh worker.
  IF target_watermark_id IS NOT NULL THEN
    transition_key := 'sha256:' || encode(sha256(convert_to(concat_ws(':',
      'population-membership-v1',
      target_workspace_id::text,
      target_population_id::text,
      target_population_version::text,
      target_population_hash,
      txid_current()::text
    ), 'UTF8')), 'hex');

    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, population_id, data_watermark_id,
      source_key, idempotency_key, reason, affected_from, affected_through,
      scope
    ) VALUES (
      target_workspace_id, NULL, target_population_id, target_watermark_id,
      'operational-population-membership', transition_key,
      'operational_population_membership_changed', affected_date, affected_date,
      jsonb_build_object(
        'kind', 'governed_population',
        'population_id', target_population_id,
        'population_version', target_population_version,
        'population_definition_hash', target_population_hash,
        'mention_id', target_mention_id,
        'eligible_before', prior_eligible,
        'eligible_after', next_eligible,
        'eligible_removed_count', CASE WHEN prior_eligible AND NOT next_eligible THEN 1 ELSE 0 END,
        'eligible_added_count', CASE WHEN next_eligible AND NOT prior_eligible THEN 1 ELSE 0 END,
        'deleted_count', CASE WHEN TG_OP = 'DELETE' THEN 1 ELSE 0 END,
        'transition', CASE
          WHEN TG_OP = 'DELETE' THEN 'deleted'
          WHEN next_eligible THEN 'included'
          ELSE 'excluded'
        END
      )
    ) ON CONFLICT (idempotency_key) DO UPDATE SET
      affected_from = CASE
        WHEN signal_data_invalidations.affected_from IS NULL THEN EXCLUDED.affected_from
        WHEN EXCLUDED.affected_from IS NULL THEN signal_data_invalidations.affected_from
        ELSE LEAST(signal_data_invalidations.affected_from, EXCLUDED.affected_from)
      END,
      affected_through = CASE
        WHEN signal_data_invalidations.affected_through IS NULL THEN EXCLUDED.affected_through
        WHEN EXCLUDED.affected_through IS NULL THEN signal_data_invalidations.affected_through
        ELSE GREATEST(signal_data_invalidations.affected_through, EXCLUDED.affected_through)
      END,
      scope = signal_data_invalidations.scope || jsonb_build_object(
        'eligible_removed_count',
          COALESCE((signal_data_invalidations.scope->>'eligible_removed_count')::int, 0)
          + COALESCE((EXCLUDED.scope->>'eligible_removed_count')::int, 0),
        'eligible_added_count',
          COALESCE((signal_data_invalidations.scope->>'eligible_added_count')::int, 0)
          + COALESCE((EXCLUDED.scope->>'eligible_added_count')::int, 0),
        'deleted_count',
          COALESCE((signal_data_invalidations.scope->>'deleted_count')::int, 0)
          + COALESCE((EXCLUDED.scope->>'deleted_count')::int, 0)
      );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_membership_invalidation
  ON signal_population_memberships;
CREATE TRIGGER trg_signal_population_membership_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF membership_status, removed_at
  ON signal_population_memberships FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_population_membership_change();

CREATE TABLE IF NOT EXISTS signal_operational_shadow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE CASCADE,
  legacy_study_corpus_id uuid REFERENCES study_corpora(id) ON DELETE SET NULL,
  module text NOT NULL,
  filters jsonb NOT NULL,
  filters_hash text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  population_version integer NOT NULL,
  population_definition_hash text NOT NULL,
  is_internal_user boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_operational_shadow_request_dedupe UNIQUE (dedupe_key),
  CONSTRAINT signal_operational_shadow_request_module CHECK (
    module IN ('brand_monitoring', 'mentions', 'topics_narratives')
  ),
  CONSTRAINT signal_operational_shadow_request_status CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'superseded')
  ),
  CONSTRAINT signal_operational_shadow_request_nonnegative CHECK (attempt >= 0),
  CONSTRAINT signal_operational_shadow_request_hashes CHECK (
    filters_hash ~ '^sha256:[0-9a-f]{64}$'
    AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND dedupe_key ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_operational_shadow_requests_recovery
  ON signal_operational_shadow_requests (available_at, created_at, id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_signal_operational_shadow_requests_workspace_module
  ON signal_operational_shadow_requests (workspace_id, module, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_signal_operational_shadow_request_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
      AND definition.version = NEW.population_version
      AND definition.definition_hash = NEW.population_definition_hash
  ) THEN
    RAISE EXCEPTION 'Operational shadow request population does not match its workspace definition.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.legacy_study_corpus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM signal_workspace_corpora membership
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.study_corpus_id = NEW.legacy_study_corpus_id
      AND membership.valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'Operational shadow request legacy corpus does not belong to its workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_operational_shadow_request_scope
  ON signal_operational_shadow_requests;
CREATE TRIGGER trg_signal_operational_shadow_request_scope
  BEFORE INSERT OR UPDATE OF workspace_id, population_id,
    population_version, population_definition_hash, legacy_study_corpus_id
  ON signal_operational_shadow_requests FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_operational_shadow_request_scope();
