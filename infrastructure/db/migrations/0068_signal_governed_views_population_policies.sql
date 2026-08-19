-- Governed views and composable population policies (foundation only).
--
-- This migration adds versioned policy and binding identities. It deliberately:
-- - creates no policy bundle, binding, population, membership or pointer;
-- - does not change any operational reader or materialization;
-- - preserves signal_workspace_population_pointers as the temporary brand bridge.

-- 0064 originally created its semantic candidate immediately after a workspace
-- INSERT. Brand provisioning creates the active v1 definition and pointer later
-- in the same call, so an immediate trigger could reserve version 1 as draft and
-- make the fail-closed pointer insert impossible. Defer only candidate creation
-- until the surrounding transaction has finished provisioning v1.
DROP TRIGGER IF EXISTS trg_signal_semantic_candidate_workspace_insert
  ON signal_workspaces;
CREATE CONSTRAINT TRIGGER trg_signal_semantic_candidate_workspace_insert
  AFTER INSERT ON signal_workspaces
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION ensure_signal_semantic_candidate_after_workspace_insert();

CREATE TABLE IF NOT EXISTS signal_population_policy_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  authorized_modules text[] NOT NULL,
  allowed_scopes text[] NOT NULL,
  acceptance_status text NOT NULL DEFAULT 'included',
  quality_contract_status text NOT NULL DEFAULT 'not_available',
  quality_policy_key text,
  quality_policy_version integer,
  min_quality_score integer,
  required_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  forbidden_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  eligibility_policy text NOT NULL,
  deduplication_policy text NOT NULL DEFAULT 'canonical-root',
  visibility_class text NOT NULL,
  denominator_key text NOT NULL,
  period_start date,
  period_end date,
  timezone text,
  retention_policy_ref text,
  licensing_policy_ref text,
  definition_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_population_policy_bundle_version
    UNIQUE (workspace_id, policy_key, policy_version),
  CONSTRAINT signal_population_policy_bundle_key
    CHECK (policy_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_population_policy_bundle_version_positive
    CHECK (policy_version >= 1 AND (quality_policy_version IS NULL OR quality_policy_version >= 1)),
  CONSTRAINT signal_population_policy_bundle_status
    CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_population_policy_bundle_modules CHECK (
    cardinality(authorized_modules) > 0
    AND authorized_modules <@ ARRAY[
      'brand-monitoring', 'mentions', 'topics-narratives',
      'triggers-barriers', 'admin-mentions'
    ]::text[]
  ),
  CONSTRAINT signal_population_policy_bundle_scopes CHECK (
    allowed_scopes <@ ARRAY[
      'primary_brand', 'competitor', 'category', 'reference', 'unattributed'
    ]::text[]
  ),
  CONSTRAINT signal_population_policy_bundle_acceptance
    CHECK (acceptance_status IN ('included', 'any')),
  CONSTRAINT signal_population_policy_bundle_quality_contract CHECK (
    (quality_contract_status = 'resolved'
      AND quality_policy_key ~ '^[a-z][a-z0-9-]*$'
      AND quality_policy_version IS NOT NULL)
    OR (quality_contract_status = 'not_available'
      AND quality_policy_key IS NULL
      AND quality_policy_version IS NULL
      AND min_quality_score IS NULL
      AND cardinality(required_quality_flags) = 0
      AND cardinality(forbidden_quality_flags) = 0)
  ),
  CONSTRAINT signal_population_policy_bundle_quality_score
    CHECK (min_quality_score IS NULL OR min_quality_score BETWEEN 0 AND 10),
  CONSTRAINT signal_population_policy_bundle_quality_flags CHECK (
    NOT (required_quality_flags && forbidden_quality_flags)
    AND (
      cardinality(required_quality_flags) = 0
      OR array_to_string(required_quality_flags, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$'
    )
    AND (
      cardinality(forbidden_quality_flags) = 0
      OR array_to_string(forbidden_quality_flags, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$'
    )
  ),
  CONSTRAINT signal_population_policy_bundle_eligibility CHECK (
    eligibility_policy IN (
      'semantic-approved-eligible', 'workspace-reservoir', 'snapshot-membership'
    )
  ),
  CONSTRAINT signal_population_policy_bundle_deduplication
    CHECK (deduplication_policy = 'canonical-root'),
  CONSTRAINT signal_population_policy_bundle_visibility
    CHECK (visibility_class IN ('client-safe', 'operator-only', 'strategic-internal')),
  CONSTRAINT signal_population_policy_bundle_denominator CHECK (
    denominator_key IN (
      'eligible-canonical-roots', 'workspace-canonical-roots',
      'snapshot-canonical-roots'
    )
  ),
  CONSTRAINT signal_population_policy_bundle_period CHECK (
    (period_start IS NULL AND period_end IS NULL AND timezone IS NULL)
    OR (
      period_start IS NOT NULL AND period_end IS NOT NULL
      AND period_start <= period_end AND NULLIF(btrim(timezone), '') IS NOT NULL
      AND timezone <> '∅' AND strpos(timezone, chr(31)) = 0
    )
  ),
  CONSTRAINT signal_population_policy_bundle_refs CHECK (
    (retention_policy_ref IS NULL OR retention_policy_ref ~ '^[a-z][a-z0-9-]*$')
    AND (licensing_policy_ref IS NULL OR licensing_policy_ref ~ '^[a-z][a-z0-9-]*$')
  ),
  CONSTRAINT signal_population_policy_bundle_hash
    CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_population_policy_bundle_activation CHECK (
    (status = 'draft' AND activated_by_user_id IS NULL AND activated_at IS NULL)
    OR (status IN ('active', 'retired') AND activated_by_user_id IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CONSTRAINT signal_population_policy_bundle_effective_window
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_signal_population_policy_bundles_workspace
  ON signal_population_policy_bundles (workspace_id, status, policy_key, policy_version DESC);
CREATE INDEX IF NOT EXISTS idx_signal_population_policy_bundles_effective
  ON signal_population_policy_bundles (workspace_id, effective_from, effective_to)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS signal_population_policy_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_bundle_id uuid NOT NULL
    REFERENCES signal_population_policy_bundles(id) ON DELETE CASCADE,
  scope text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_population_policy_entity_scope
    CHECK (scope IN ('primary_brand', 'competitor', 'category', 'reference')),
  CONSTRAINT signal_population_policy_entity_type
    CHECK (entity_type IN ('brand', 'competitor', 'category', 'reference')),
  CONSTRAINT signal_population_policy_entity_shape CHECK (
    (scope = 'primary_brand' AND entity_type = 'brand')
    OR (scope = 'competitor' AND entity_type = 'competitor')
    OR (scope = 'category' AND entity_type = 'category')
    OR (scope = 'reference' AND entity_type = 'reference')
  ),
  CONSTRAINT uq_signal_population_policy_entity
    UNIQUE (policy_bundle_id, scope, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_population_policy_entities_bundle
  ON signal_population_policy_entities (policy_bundle_id, scope, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_signal_population_policy_entities_workspace
  ON signal_population_policy_entities (workspace_id, entity_type, entity_id);

CREATE OR REPLACE FUNCTION signal_population_policy_bundle_definition_hash(
  target_policy_bundle_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE canonical_definition text;
BEGIN
  SELECT * INTO bundle
  FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id;
  IF bundle.id IS NULL THEN
    RAISE EXCEPTION 'Policy bundle is unavailable.' USING ERRCODE = '23514';
  END IF;
  canonical_definition := concat_ws(chr(31),
    'signal-governed-views-v1',
    bundle.workspace_id::text,
    bundle.policy_key,
    bundle.policy_version::text,
    COALESCE((SELECT string_agg(value, ',' ORDER BY value)
      FROM unnest(bundle.authorized_modules) value), ''),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value)
      FROM unnest(bundle.allowed_scopes) value), ''),
    COALESCE((SELECT string_agg(
      entity.scope || ':' || entity.entity_type || ':' || entity.entity_id::text,
      ',' ORDER BY entity.scope, entity.entity_type, entity.entity_id
    ) FROM signal_population_policy_entities entity
      WHERE entity.policy_bundle_id = bundle.id), ''),
    bundle.acceptance_status,
    bundle.quality_contract_status,
    COALESCE(bundle.quality_policy_key, '∅'),
    COALESCE(bundle.quality_policy_version::text, '∅'),
    COALESCE(bundle.min_quality_score::text, '∅'),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value)
      FROM unnest(bundle.required_quality_flags) value), ''),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value)
      FROM unnest(bundle.forbidden_quality_flags) value), ''),
    bundle.eligibility_policy,
    bundle.deduplication_policy,
    bundle.visibility_class,
    bundle.denominator_key,
    COALESCE(bundle.period_start::text, '∅'),
    COALESCE(bundle.period_end::text, '∅'),
    COALESCE(bundle.timezone, '∅'),
    COALESCE(bundle.retention_policy_ref, '∅'),
    COALESCE(bundle.licensing_policy_ref, '∅')
  );
  RETURN 'sha256:' || encode(sha256(convert_to(canonical_definition, 'UTF8')), 'hex');
END;
$$;

CREATE TABLE IF NOT EXISTS signal_population_policy_compilations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_bundle_id uuid NOT NULL
    REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  population_id uuid NOT NULL
    REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  compilation_version integer NOT NULL,
  compiled_plan_hash text NOT NULL,
  policy_definition_hash text NOT NULL,
  population_version integer NOT NULL,
  population_definition_hash text NOT NULL,
  membership_digest text NOT NULL,
  source_watermark_hash text NOT NULL,
  source_watermark_at timestamptz,
  compilation_status text NOT NULL,
  blocking_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_current boolean NOT NULL DEFAULT true,
  compiled_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  compiled_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_population_policy_compilation_version
    UNIQUE (policy_bundle_id, population_id, compilation_version),
  CONSTRAINT signal_population_policy_compilation_version_positive
    CHECK (compilation_version >= 1 AND population_version >= 1),
  CONSTRAINT signal_population_policy_compilation_hashes CHECK (
    compiled_plan_hash ~ '^sha256:[0-9a-f]{64}$'
    AND policy_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND membership_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_watermark_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_population_policy_compilation_status
    CHECK (compilation_status IN ('ready', 'stale', 'blocked')),
  CONSTRAINT signal_population_policy_compilation_blockers CHECK (
    (
      cardinality(blocking_reasons) = 0
      OR array_to_string(blocking_reasons, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$'
    )
    AND (
      (compilation_status = 'ready' AND cardinality(blocking_reasons) = 0)
      OR compilation_status = 'stale'
      OR (compilation_status = 'blocked' AND cardinality(blocking_reasons) > 0)
    )
  ),
  CONSTRAINT signal_population_policy_compilation_current_window CHECK (
    (is_current AND retired_at IS NULL)
    OR (NOT is_current AND retired_at IS NOT NULL AND retired_at >= compiled_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_population_policy_compilation_current
  ON signal_population_policy_compilations (policy_bundle_id, population_id)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_signal_population_policy_compilations_workspace
  ON signal_population_policy_compilations (
    workspace_id, compilation_status, policy_bundle_id, population_id
  ) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_signal_population_policy_compilations_population
  ON signal_population_policy_compilations (population_id, compilation_status, is_current);

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_compilation_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE target_organization_id uuid;
BEGIN
  SELECT * INTO bundle
  FROM signal_population_policy_bundles candidate
  WHERE candidate.id = NEW.policy_bundle_id;
  SELECT * INTO population
  FROM signal_population_definitions candidate
  WHERE candidate.id = NEW.population_id;
  IF bundle.id IS NULL OR population.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR population.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status = 'retired'
     OR population.status = 'retired'
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR population.version IS DISTINCT FROM NEW.population_version
     OR population.definition_hash IS DISTINCT FROM NEW.population_definition_hash
     OR population.membership_digest IS DISTINCT FROM NEW.membership_digest THEN
    RAISE EXCEPTION 'Policy compilation cannot cross workspaces or misstate governed artifacts.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.compilation_status = 'ready' AND bundle.visibility_class = 'client-safe' AND (
    bundle.quality_contract_status <> 'resolved'
    OR bundle.retention_policy_ref IS NULL
    OR bundle.licensing_policy_ref IS NULL
  ) THEN
    RAISE EXCEPTION 'Client-safe policy compilation is blocked by unavailable governance policies.'
      USING ERRCODE = '23514';
  END IF;
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.compiled_by_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Policy compilation actor is not valid for the workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_compilation_contract
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_signal_population_policy_compilation_contract
  BEFORE INSERT ON signal_population_policy_compilations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_population_policy_compilation_contract();

CREATE OR REPLACE FUNCTION protect_signal_population_policy_compilation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Policy compilation history is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.is_current IS NOT TRUE
     OR NEW.is_current IS NOT FALSE
     OR NEW.retired_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['is_current', 'retired_at']::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['is_current', 'retired_at']::text[]) THEN
    RAISE EXCEPTION 'Policy compilations may only transition from current to retired.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_compilation_history
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_signal_population_policy_compilation_history
  BEFORE UPDATE OR DELETE ON signal_population_policy_compilations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_population_policy_compilation_history();

CREATE TABLE IF NOT EXISTS signal_governed_view_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  view_key text NOT NULL,
  binding_version integer NOT NULL,
  policy_bundle_id uuid NOT NULL
    REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  policy_definition_hash text NOT NULL,
  population_id uuid REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  policy_compilation_id uuid
    REFERENCES signal_population_policy_compilations(id) ON DELETE RESTRICT,
  binding_status text NOT NULL DEFAULT 'current',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  promoted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_governed_view_binding_version
    UNIQUE (workspace_id, module_key, view_key, binding_version),
  CONSTRAINT signal_governed_view_binding_module CHECK (
    module_key IN (
      'brand-monitoring', 'mentions', 'topics-narratives',
      'triggers-barriers', 'admin-mentions'
    )
  ),
  CONSTRAINT signal_governed_view_binding_view CHECK (
    view_key IN (
      'brand', 'competition', 'category', 'all-governed',
      'strategic', 'admin-reservoir'
    )
  ),
  CONSTRAINT signal_governed_view_binding_version_positive
    CHECK (binding_version >= 1),
  CONSTRAINT signal_governed_view_binding_hash
    CHECK (policy_definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_governed_view_binding_compilation_shape CHECK (
    (population_id IS NULL AND policy_compilation_id IS NULL)
    OR (population_id IS NOT NULL AND policy_compilation_id IS NOT NULL)
  ),
  CONSTRAINT signal_governed_view_binding_status
    CHECK (binding_status IN ('current', 'retired')),
  CONSTRAINT signal_governed_view_binding_window CHECK (
    (binding_status = 'current' AND effective_to IS NULL)
    OR (binding_status = 'retired' AND effective_to IS NOT NULL AND effective_to >= effective_from)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_governed_view_binding_current
  ON signal_governed_view_bindings (workspace_id, module_key, view_key)
  WHERE binding_status = 'current';
CREATE INDEX IF NOT EXISTS idx_signal_governed_view_bindings_policy
  ON signal_governed_view_bindings (policy_bundle_id, binding_status);
CREATE INDEX IF NOT EXISTS idx_signal_governed_view_bindings_population
  ON signal_governed_view_bindings (population_id, binding_status)
  WHERE population_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_governed_view_bindings_compilation
  ON signal_governed_view_bindings (policy_compilation_id, binding_status)
  WHERE policy_compilation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_governed_view_binding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  view_key text NOT NULL,
  action text NOT NULL,
  previous_binding_id uuid REFERENCES signal_governed_view_bindings(id) ON DELETE RESTRICT,
  next_binding_id uuid NOT NULL REFERENCES signal_governed_view_bindings(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_governed_view_binding_event_module CHECK (
    module_key IN (
      'brand-monitoring', 'mentions', 'topics-narratives',
      'triggers-barriers', 'admin-mentions'
    )
  ),
  CONSTRAINT signal_governed_view_binding_event_view CHECK (
    view_key IN (
      'brand', 'competition', 'category', 'all-governed',
      'strategic', 'admin-reservoir'
    )
  ),
  CONSTRAINT signal_governed_view_binding_event_action
    CHECK (action IN ('promote', 'rollback')),
  CONSTRAINT signal_governed_view_binding_event_key
    CHECK (idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT uq_signal_governed_view_binding_event_idempotency
    UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_governed_view_binding_events_history
  ON signal_governed_view_binding_events (workspace_id, module_key, view_key, created_at, id);

CREATE OR REPLACE FUNCTION signal_governed_view_pair_is_valid(
  target_module_key text,
  target_view_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE target_module_key
    WHEN 'brand-monitoring' THEN target_view_key IN ('brand', 'competition', 'category', 'all-governed')
    WHEN 'mentions' THEN target_view_key IN ('brand', 'competition', 'category', 'all-governed')
    WHEN 'topics-narratives' THEN target_view_key IN ('brand', 'competition', 'category', 'all-governed')
    WHEN 'triggers-barriers' THEN target_view_key = 'strategic'
    WHEN 'admin-mentions' THEN target_view_key = 'admin-reservoir'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_entity_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_bundle signal_population_policy_bundles%ROWTYPE;
DECLARE target_brand_id uuid;
BEGIN
  SELECT * INTO target_bundle
  FROM signal_population_policy_bundles bundle
  WHERE bundle.id = NEW.policy_bundle_id;
  IF target_bundle.id IS NULL
     OR target_bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR target_bundle.status <> 'draft' THEN
    RAISE EXCEPTION 'Policy entity must belong to a draft bundle in the same workspace.'
      USING ERRCODE = '23514';
  END IF;
  SELECT workspace.brand_id INTO target_brand_id
  FROM signal_workspaces workspace
  WHERE workspace.id = NEW.workspace_id;
  IF NEW.entity_type = 'brand' THEN
    IF NEW.entity_id IS DISTINCT FROM target_brand_id THEN
      RAISE EXCEPTION 'Brand policy entity must identify the workspace brand.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.entity_type = 'competitor' THEN
    IF NOT EXISTS (
      SELECT 1 FROM competitors competitor
      WHERE competitor.id = NEW.entity_id AND competitor.brand_id = target_brand_id
    ) THEN
      RAISE EXCEPTION 'Competitor policy entity must be governed by the workspace brand.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM intelligence_entities entity
      WHERE entity.id = NEW.entity_id
        AND entity.brand_id = target_brand_id
        AND entity.entity_type = NEW.entity_type
        AND entity.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Policy entity must be an active governed workspace entity.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_entity_contract
  ON signal_population_policy_entities;
CREATE TRIGGER trg_signal_population_policy_entity_contract
  BEFORE INSERT OR UPDATE OF workspace_id, policy_bundle_id, scope, entity_type, entity_id
  ON signal_population_policy_entities
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_population_policy_entity_contract();

CREATE OR REPLACE FUNCTION protect_signal_population_policy_entity_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM signal_population_policy_bundles bundle
    WHERE bundle.id = OLD.policy_bundle_id AND bundle.status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'Entities of an active or retired policy bundle are immutable.'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_entity_history
  ON signal_population_policy_entities;
CREATE TRIGGER trg_signal_population_policy_entity_history
  BEFORE DELETE ON signal_population_policy_entities
  FOR EACH ROW EXECUTE FUNCTION protect_signal_population_policy_entity_history();

CREATE OR REPLACE FUNCTION protect_signal_population_policy_bundle_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'Retired policy bundles are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'active' THEN
    IF NEW.status <> 'retired'
       OR EXISTS (
         SELECT 1 FROM signal_governed_view_bindings binding
         WHERE binding.policy_bundle_id = OLD.id AND binding.binding_status = 'current'
       )
       OR (to_jsonb(NEW) - ARRAY['status', 'effective_to', 'updated_at']::text[])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'effective_to', 'updated_at']::text[]) THEN
      RAISE EXCEPTION 'Active policy bundles are immutable while referenced by a current binding.'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.effective_to IS NULL THEN
      RAISE EXCEPTION 'Retiring a policy bundle requires effective_to.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('draft', 'active', 'retired') THEN
    RAISE EXCEPTION 'Invalid policy bundle lifecycle transition.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'draft' AND (
    NEW.activated_by_user_id IS NULL OR NEW.activated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Policy bundle activation requires a server-resolved actor.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_bundle_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_organization_id uuid;
BEGIN
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace
  WHERE workspace.id = NEW.workspace_id;
  IF target_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.created_by_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Policy bundle creator is not valid for the workspace.' USING ERRCODE = '23514';
  END IF;
  IF NEW.activated_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.activated_by_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Policy bundle activation actor is not valid for the workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_bundle_actor
  ON signal_population_policy_bundles;
CREATE TRIGGER trg_signal_population_policy_bundle_actor
  BEFORE INSERT OR UPDATE OF workspace_id, created_by_user_id, activated_by_user_id
  ON signal_population_policy_bundles
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_population_policy_bundle_actor();

DROP TRIGGER IF EXISTS trg_signal_population_policy_bundle_history
  ON signal_population_policy_bundles;
CREATE TRIGGER trg_signal_population_policy_bundle_history
  BEFORE UPDATE ON signal_population_policy_bundles
  FOR EACH ROW EXECUTE FUNCTION protect_signal_population_policy_bundle_history();

CREATE OR REPLACE FUNCTION assert_signal_population_policy_bundle_contract(
  target_policy_bundle_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE missing_scope text;
BEGIN
  SELECT * INTO bundle
  FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id;
  IF bundle.id IS NULL OR bundle.status = 'retired' THEN
    RAISE EXCEPTION 'Policy bundle is unavailable.' USING ERRCODE = '23514';
  END IF;
  IF cardinality(bundle.authorized_modules) <> (
       SELECT count(DISTINCT value)::int FROM unnest(bundle.authorized_modules) value
     )
     OR cardinality(bundle.allowed_scopes) <> (
       SELECT count(DISTINCT value)::int FROM unnest(bundle.allowed_scopes) value
     )
     OR cardinality(bundle.required_quality_flags) <> (
       SELECT count(DISTINCT value)::int FROM unnest(bundle.required_quality_flags) value
     )
     OR cardinality(bundle.forbidden_quality_flags) <> (
       SELECT count(DISTINCT value)::int FROM unnest(bundle.forbidden_quality_flags) value
     ) THEN
    RAISE EXCEPTION 'Policy bundle arrays must be duplicate-free.' USING ERRCODE = '23514';
  END IF;
  IF bundle.definition_hash IS DISTINCT FROM
     signal_population_policy_bundle_definition_hash(bundle.id) THEN
    RAISE EXCEPTION 'Policy bundle definition hash does not match its governed content.'
      USING ERRCODE = '23514';
  END IF;
  IF bundle.eligibility_policy = 'semantic-approved-eligible' THEN
    IF cardinality(bundle.allowed_scopes) = 0 OR 'unattributed' = ANY(bundle.allowed_scopes) THEN
      RAISE EXCEPTION 'Semantic policies require attributable governed scopes.' USING ERRCODE = '23514';
    END IF;
    SELECT scope INTO missing_scope
    FROM unnest(bundle.allowed_scopes) scope
    WHERE NOT EXISTS (
      SELECT 1 FROM signal_population_policy_entities entity
      WHERE entity.policy_bundle_id = bundle.id AND entity.scope = scope
    )
    LIMIT 1;
    IF missing_scope IS NOT NULL THEN
      RAISE EXCEPTION 'Policy scope % has no governed entity allowlist.', missing_scope
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF bundle.visibility_class = 'client-safe' AND (
    bundle.eligibility_policy <> 'semantic-approved-eligible'
    OR bundle.acceptance_status <> 'included'
    OR bundle.denominator_key <> 'eligible-canonical-roots'
  ) THEN
    RAISE EXCEPTION 'Client-safe policy bundle is not denominator-safe.' USING ERRCODE = '23514';
  END IF;
  IF bundle.eligibility_policy = 'workspace-reservoir' AND (
    bundle.visibility_class <> 'operator-only'
    OR bundle.denominator_key <> 'workspace-canonical-roots'
  ) THEN
    RAISE EXCEPTION 'Workspace reservoir policy must be operator-only.' USING ERRCODE = '23514';
  END IF;
  IF bundle.eligibility_policy = 'snapshot-membership' AND (
    bundle.visibility_class <> 'strategic-internal'
    OR bundle.denominator_key <> 'snapshot-canonical-roots'
  ) THEN
    RAISE EXCEPTION 'Snapshot policy must use a strategic denominator.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_binding_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE compilation signal_population_policy_compilations%ROWTYPE;
DECLARE target_organization_id uuid;
BEGIN
  IF NOT signal_governed_view_pair_is_valid(NEW.module_key, NEW.view_key) THEN
    RAISE EXCEPTION 'Governed module/view pair is incompatible.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO bundle
  FROM signal_population_policy_bundles candidate
  WHERE candidate.id = NEW.policy_bundle_id;
  IF bundle.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status <> 'active'
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR bundle.effective_from > NEW.effective_from
     OR (bundle.effective_to IS NOT NULL AND bundle.effective_to <= NEW.effective_from) THEN
    RAISE EXCEPTION 'Governed binding policy is unavailable or cross-workspace.' USING ERRCODE = '23514';
  END IF;
  IF NEW.population_id IS NOT NULL THEN
    SELECT * INTO population
    FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id;
    IF population.id IS NULL OR population.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'Governed binding population is cross-workspace.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO compilation
    FROM signal_population_policy_compilations candidate
    WHERE candidate.id = NEW.policy_compilation_id;
    IF compilation.id IS NULL
       OR compilation.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR compilation.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
       OR compilation.population_id IS DISTINCT FROM NEW.population_id
       OR compilation.compilation_status <> 'ready'
       OR compilation.is_current IS NOT TRUE
       OR compilation.policy_definition_hash IS DISTINCT FROM bundle.definition_hash
       OR compilation.population_version IS DISTINCT FROM population.version
       OR compilation.population_definition_hash IS DISTINCT FROM population.definition_hash
       OR compilation.membership_digest IS DISTINCT FROM population.membership_digest THEN
      RAISE EXCEPTION 'Governed binding population lacks an exact ready policy compilation.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.promoted_by_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Governed binding actor is not valid for the workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_binding_contract
  ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_governed_view_binding_contract
  BEFORE INSERT OR UPDATE OF workspace_id, module_key, view_key, policy_bundle_id,
    policy_definition_hash, population_id, policy_compilation_id,
    binding_status, effective_from, effective_to
  ON signal_governed_view_bindings
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_view_binding_contract();

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_binding_event_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE next_binding signal_governed_view_bindings%ROWTYPE;
DECLARE previous_binding signal_governed_view_bindings%ROWTYPE;
DECLARE target_organization_id uuid;
BEGIN
  SELECT * INTO next_binding
  FROM signal_governed_view_bindings binding
  WHERE binding.id = NEW.next_binding_id;
  IF next_binding.id IS NULL
     OR next_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR next_binding.module_key IS DISTINCT FROM NEW.module_key
     OR next_binding.view_key IS DISTINCT FROM NEW.view_key THEN
    RAISE EXCEPTION 'Governed binding event target is cross-workspace or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.actor_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Governed binding event actor is not valid for the workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_binding_id IS NOT NULL THEN
    SELECT * INTO previous_binding
    FROM signal_governed_view_bindings binding
    WHERE binding.id = NEW.previous_binding_id;
    IF previous_binding.id IS NULL
       OR previous_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR previous_binding.module_key IS DISTINCT FROM NEW.module_key
       OR previous_binding.view_key IS DISTINCT FROM NEW.view_key THEN
      RAISE EXCEPTION 'Governed binding event history is cross-workspace or incompatible.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_binding_event_contract
  ON signal_governed_view_binding_events;
CREATE TRIGGER trg_signal_governed_view_binding_event_contract
  BEFORE INSERT ON signal_governed_view_binding_events
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_view_binding_event_contract();

CREATE OR REPLACE FUNCTION prevent_signal_governed_view_binding_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Governed view binding events are append-only.' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_binding_events_append_only
  ON signal_governed_view_binding_events;
CREATE TRIGGER trg_signal_governed_view_binding_events_append_only
  BEFORE UPDATE OR DELETE ON signal_governed_view_binding_events
  FOR EACH ROW EXECUTE FUNCTION prevent_signal_governed_view_binding_event_mutation();

CREATE OR REPLACE FUNCTION promote_signal_governed_view_binding(
  target_workspace_id uuid,
  target_module_key text,
  target_view_key text,
  target_policy_bundle_id uuid,
  target_population_id uuid,
  target_actor_user_id uuid,
  target_action text,
  target_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE workspace signal_workspaces%ROWTYPE;
DECLARE actor users%ROWTYPE;
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE target_compilation signal_population_policy_compilations%ROWTYPE;
DECLARE current_binding signal_governed_view_bindings%ROWTYPE;
DECLARE persisted_event signal_governed_view_binding_events%ROWTYPE;
DECLARE persisted_binding signal_governed_view_bindings%ROWTYPE;
DECLARE next_version integer;
DECLARE transition_at timestamptz := clock_timestamp();
BEGIN
  IF NOT signal_governed_view_pair_is_valid(target_module_key, target_view_key)
     OR target_action NOT IN ('promote', 'rollback')
     OR target_idempotency_key IS NULL
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Governed view promotion contract is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_module_key || ':' || target_view_key, 0
  ));
  SELECT * INTO persisted_event
  FROM signal_governed_view_binding_events event
  WHERE event.workspace_id = target_workspace_id
    AND event.idempotency_key = target_idempotency_key;
  IF persisted_event.id IS NOT NULL THEN
    SELECT * INTO persisted_binding
    FROM signal_governed_view_bindings binding
    WHERE binding.id = persisted_event.next_binding_id;
    IF persisted_event.module_key IS DISTINCT FROM target_module_key
       OR persisted_event.view_key IS DISTINCT FROM target_view_key
       OR persisted_event.action IS DISTINCT FROM target_action
       OR persisted_event.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted_binding.policy_bundle_id IS DISTINCT FROM target_policy_bundle_id
       OR persisted_binding.population_id IS DISTINCT FROM target_population_id THEN
      RAISE EXCEPTION 'Governed view idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN persisted_binding.id;
  END IF;
  SELECT * INTO workspace FROM signal_workspaces candidate
  WHERE candidate.id = target_workspace_id AND candidate.status = 'active';
  SELECT * INTO actor FROM users candidate WHERE candidate.id = target_actor_user_id;
  IF workspace.id IS NULL OR actor.id IS NULL OR NOT (
    actor.user_type = 'noisia_internal'
    OR actor.organization_id IS NOT DISTINCT FROM workspace.organization_id
  ) THEN
    RAISE EXCEPTION 'Governed view promotion actor is not valid for the workspace.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO bundle
  FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id
  FOR UPDATE;
  IF bundle.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM target_workspace_id
     OR bundle.status = 'retired'
     OR NOT (target_module_key = ANY(bundle.authorized_modules)) THEN
    RAISE EXCEPTION 'Governed view policy is unavailable or cross-workspace.' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_signal_population_policy_bundle_contract(bundle.id);
  IF target_view_key = 'brand' AND bundle.allowed_scopes <> ARRAY['primary_brand']::text[] THEN
    RAISE EXCEPTION 'Brand view requires an exact primary_brand policy.' USING ERRCODE = '23514';
  ELSIF target_view_key = 'competition' AND bundle.allowed_scopes <> ARRAY['competitor']::text[] THEN
    RAISE EXCEPTION 'Competition view requires an exact competitor policy.' USING ERRCODE = '23514';
  ELSIF target_view_key = 'category' AND bundle.allowed_scopes <> ARRAY['category']::text[] THEN
    RAISE EXCEPTION 'Category view requires an exact category policy.' USING ERRCODE = '23514';
  ELSIF target_view_key = 'all-governed' AND (
    bundle.eligibility_policy <> 'semantic-approved-eligible'
    OR 'unattributed' = ANY(bundle.allowed_scopes)
  ) THEN
    RAISE EXCEPTION 'All-governed view requires attributable semantic policies.' USING ERRCODE = '23514';
  ELSIF target_view_key = 'strategic' AND bundle.visibility_class <> 'strategic-internal' THEN
    RAISE EXCEPTION 'Strategic view requires strategic visibility.' USING ERRCODE = '23514';
  ELSIF target_view_key = 'admin-reservoir' AND bundle.eligibility_policy <> 'workspace-reservoir' THEN
    RAISE EXCEPTION 'Admin reservoir requires workspace-reservoir eligibility.' USING ERRCODE = '23514';
  END IF;
  IF target_action = 'rollback' AND NOT EXISTS (
    SELECT 1
    FROM signal_governed_view_bindings historical
    WHERE historical.workspace_id = target_workspace_id
      AND historical.module_key = target_module_key
      AND historical.view_key = target_view_key
      AND historical.policy_bundle_id = target_policy_bundle_id
      AND historical.population_id IS NOT DISTINCT FROM target_population_id
  ) THEN
    RAISE EXCEPTION 'Rollback target was never a binding for this governed view.'
      USING ERRCODE = '23514';
  END IF;
  IF target_population_id IS NOT NULL THEN
    SELECT compilation.* INTO target_compilation
    FROM signal_population_policy_compilations compilation
    JOIN signal_population_definitions population
      ON population.id = compilation.population_id
     AND population.workspace_id = compilation.workspace_id
    WHERE compilation.workspace_id = target_workspace_id
      AND compilation.policy_bundle_id = target_policy_bundle_id
      AND compilation.population_id = target_population_id
      AND compilation.is_current
      AND compilation.compilation_status = 'ready'
      AND compilation.policy_definition_hash = bundle.definition_hash
      AND compilation.population_version = population.version
      AND compilation.population_definition_hash = population.definition_hash
      AND compilation.membership_digest = population.membership_digest
    LIMIT 1;
    IF target_compilation.id IS NULL THEN
      RAISE EXCEPTION 'Governed population has no exact ready policy compilation.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF bundle.status = 'draft' THEN
    UPDATE signal_population_policy_bundles
    SET status = 'active', activated_by_user_id = target_actor_user_id,
        activated_at = transition_at, updated_at = transition_at
    WHERE id = bundle.id;
    bundle.status := 'active';
  END IF;
  SELECT * INTO current_binding
  FROM signal_governed_view_bindings binding
  WHERE binding.workspace_id = target_workspace_id
    AND binding.module_key = target_module_key
    AND binding.view_key = target_view_key
    AND binding.binding_status = 'current'
  FOR UPDATE;
  IF current_binding.id IS NOT NULL
     AND current_binding.policy_bundle_id IS NOT DISTINCT FROM target_policy_bundle_id
     AND current_binding.population_id IS NOT DISTINCT FROM target_population_id THEN
    INSERT INTO signal_governed_view_binding_events (
      workspace_id, module_key, view_key, action,
      previous_binding_id, next_binding_id, actor_user_id, idempotency_key
    ) VALUES (
      target_workspace_id, target_module_key, target_view_key, target_action,
      current_binding.id, current_binding.id, target_actor_user_id, target_idempotency_key
    );
    RETURN current_binding.id;
  END IF;
  IF current_binding.id IS NOT NULL THEN
    UPDATE signal_governed_view_bindings
    SET binding_status = 'retired', effective_to = transition_at
    WHERE id = current_binding.id;
  END IF;
  SELECT COALESCE(max(binding.binding_version), 0) + 1 INTO next_version
  FROM signal_governed_view_bindings binding
  WHERE binding.workspace_id = target_workspace_id
    AND binding.module_key = target_module_key
    AND binding.view_key = target_view_key;
  INSERT INTO signal_governed_view_bindings (
    workspace_id, module_key, view_key, binding_version,
    policy_bundle_id, policy_definition_hash, population_id, policy_compilation_id,
    binding_status, effective_from, promoted_by_user_id
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, next_version,
    target_policy_bundle_id, bundle.definition_hash, target_population_id, target_compilation.id,
    'current', transition_at, target_actor_user_id
  ) RETURNING * INTO persisted_binding;
  INSERT INTO signal_governed_view_binding_events (
    workspace_id, module_key, view_key, action,
    previous_binding_id, next_binding_id, actor_user_id, idempotency_key
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, target_action,
    current_binding.id, persisted_binding.id, target_actor_user_id, target_idempotency_key
  );
  RETURN persisted_binding.id;
END;
$$;

COMMENT ON TABLE signal_population_policy_bundles IS
  'Versioned server-owned policy source of truth; contains no mention IDs or serving payloads.';
COMMENT ON TABLE signal_population_policy_compilations IS
  'Append-only proof that one derived population version and membership digest were compiled from an exact policy bundle and plan hash.';
COMMENT ON TABLE signal_governed_view_bindings IS
  'Stable workspace/module/view binding to a policy bundle and optional derived population.';
COMMENT ON TABLE signal_governed_view_binding_events IS
  'Append-only promotion and rollback history for governed view bindings.';
COMMENT ON FUNCTION promote_signal_governed_view_binding IS
  'Atomically promotes or rolls back a versioned governed view binding without moving legacy operational pointers.';
