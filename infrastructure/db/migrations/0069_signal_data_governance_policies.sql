-- Canonical quality, retention and licensing authorities for governed views.
--
-- This migration is additive and deliberately creates no policy, provenance binding,
-- population membership, governed-view binding or current pointer. Text references
-- introduced in 0068 remain compatibility metadata, but cannot prove a client-safe
-- compilation is ready after this migration.

CREATE OR REPLACE FUNCTION signal_data_governance_actor_is_valid(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM signal_workspaces workspace
    JOIN users actor ON actor.id = target_actor_user_id
    WHERE workspace.id = target_workspace_id
      AND workspace.status = 'active'
      AND actor.status = 'active'
      AND (
        actor.user_type = 'noisia_internal'
        OR actor.organization_id IS NOT DISTINCT FROM workspace.organization_id
      )
  );
$$;

CREATE TABLE IF NOT EXISTS signal_quality_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  min_quality_score integer,
  required_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  forbidden_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  canonical_root_disposition text NOT NULL DEFAULT 'evaluate',
  definition_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  creation_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_quality_policy_version UNIQUE (workspace_id, policy_key, policy_version),
  CONSTRAINT uq_signal_quality_policy_creation UNIQUE (workspace_id, creation_idempotency_key),
  CONSTRAINT signal_quality_policy_key CHECK (policy_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_quality_policy_version CHECK (policy_version >= 1),
  CONSTRAINT signal_quality_policy_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_quality_policy_score CHECK (min_quality_score IS NULL OR min_quality_score BETWEEN 0 AND 10),
  CONSTRAINT signal_quality_policy_flags CHECK (
    NOT (required_quality_flags && forbidden_quality_flags)
    AND (cardinality(required_quality_flags) = 0
      OR array_to_string(required_quality_flags, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$')
    AND (cardinality(forbidden_quality_flags) = 0
      OR array_to_string(forbidden_quality_flags, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$')
  ),
  CONSTRAINT signal_quality_policy_disposition CHECK (
    canonical_root_disposition IN ('evaluate', 'blocked', 'not_available')
  ),
  CONSTRAINT signal_quality_policy_hash CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_quality_policy_idempotency CHECK (creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_quality_policy_lifecycle CHECK (
    (status = 'draft' AND activated_by_user_id IS NULL AND activated_at IS NULL)
    OR (status IN ('active', 'retired') AND activated_by_user_id IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CONSTRAINT signal_quality_policy_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_quality_policy_active
  ON signal_quality_policies (workspace_id, policy_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_signal_quality_policies_workspace
  ON signal_quality_policies (workspace_id, status, policy_key, policy_version DESC);

CREATE TABLE IF NOT EXISTS signal_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  retention_state text NOT NULL,
  retention_mode text NOT NULL,
  retain_until timestamptz,
  expiry_action text NOT NULL,
  approval_evidence_hash text,
  definition_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  creation_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_retention_policy_version UNIQUE (workspace_id, policy_key, policy_version),
  CONSTRAINT uq_signal_retention_policy_creation UNIQUE (workspace_id, creation_idempotency_key),
  CONSTRAINT signal_retention_policy_key CHECK (policy_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_retention_policy_version CHECK (policy_version >= 1),
  CONSTRAINT signal_retention_policy_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_retention_policy_state CHECK (retention_state IN ('allowed', 'blocked', 'not_available')),
  CONSTRAINT signal_retention_policy_mode CHECK (retention_mode IN ('indefinite', 'until', 'not_available')),
  CONSTRAINT signal_retention_policy_expiry_action CHECK (
    expiry_action IN ('block_use', 'review_required', 'not_available')
  ),
  CONSTRAINT signal_retention_policy_shape CHECK (
    (retention_state = 'not_available' AND retention_mode = 'not_available' AND retain_until IS NULL)
    OR (retention_state <> 'not_available' AND retention_mode = 'indefinite' AND retain_until IS NULL)
    OR (retention_state <> 'not_available' AND retention_mode = 'until' AND retain_until IS NOT NULL)
  ),
  CONSTRAINT signal_retention_policy_approval CHECK (
    status = 'draft'
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND approval_evidence_hash ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_retention_policy_hash CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_retention_policy_idempotency CHECK (creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_retention_policy_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_retention_policy_active
  ON signal_retention_policies (workspace_id, policy_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_signal_retention_policies_workspace
  ON signal_retention_policies (workspace_id, status, policy_key, policy_version DESC);

CREATE TABLE IF NOT EXISTS signal_licensing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  approval_evidence_hash text,
  definition_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  creation_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_licensing_policy_version UNIQUE (workspace_id, policy_key, policy_version),
  CONSTRAINT uq_signal_licensing_policy_creation UNIQUE (workspace_id, creation_idempotency_key),
  CONSTRAINT signal_licensing_policy_key CHECK (policy_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_licensing_policy_version CHECK (policy_version >= 1),
  CONSTRAINT signal_licensing_policy_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_licensing_policy_approval CHECK (
    status = 'draft'
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND approval_evidence_hash ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_licensing_policy_hash CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_licensing_policy_idempotency CHECK (creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_licensing_policy_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_licensing_policy_active
  ON signal_licensing_policies (workspace_id, policy_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_signal_licensing_policies_workspace
  ON signal_licensing_policies (workspace_id, status, policy_key, policy_version DESC);

CREATE TABLE IF NOT EXISTS signal_licensing_policy_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  licensing_policy_id uuid NOT NULL REFERENCES signal_licensing_policies(id) ON DELETE CASCADE,
  usage_purpose text NOT NULL,
  decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_licensing_policy_usage UNIQUE (licensing_policy_id, usage_purpose),
  CONSTRAINT signal_licensing_policy_usage_purpose CHECK (usage_purpose IN (
    'internal-qa', 'client-derived-metrics', 'client-mention-list',
    'client-text-or-excerpt', 'llm-processing', 'strategic-analysis'
  )),
  CONSTRAINT signal_licensing_policy_usage_decision CHECK (
    decision IN ('allowed', 'prohibited', 'not_available')
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_licensing_policy_usages_workspace
  ON signal_licensing_policy_usages (workspace_id, usage_purpose, decision, licensing_policy_id);

CREATE TABLE IF NOT EXISTS signal_provenance_policy_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
  binding_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  quality_policy_id uuid NOT NULL REFERENCES signal_quality_policies(id) ON DELETE RESTRICT,
  retention_policy_id uuid NOT NULL REFERENCES signal_retention_policies(id) ON DELETE RESTRICT,
  licensing_policy_id uuid NOT NULL REFERENCES signal_licensing_policies(id) ON DELETE RESTRICT,
  definition_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  creation_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_provenance_policy_binding_version
    UNIQUE NULLS NOT DISTINCT (workspace_id, data_source_id, import_batch_id, binding_version),
  CONSTRAINT uq_signal_provenance_policy_binding_creation
    UNIQUE (workspace_id, creation_idempotency_key),
  CONSTRAINT signal_provenance_policy_binding_version CHECK (binding_version >= 1),
  CONSTRAINT signal_provenance_policy_binding_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_provenance_policy_binding_hash CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_provenance_policy_binding_idempotency CHECK (creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_provenance_policy_binding_lifecycle CHECK (
    (status = 'draft' AND activated_by_user_id IS NULL AND activated_at IS NULL)
    OR (status IN ('active', 'retired') AND activated_by_user_id IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CONSTRAINT signal_provenance_policy_binding_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_provenance_policy_binding_active
  ON signal_provenance_policy_bindings (
    workspace_id, data_source_id, COALESCE(import_batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_signal_provenance_policy_bindings_source
  ON signal_provenance_policy_bindings (workspace_id, data_source_id, import_batch_id, status);

CREATE TABLE IF NOT EXISTS signal_data_governance_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  object_kind text NOT NULL,
  object_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  input_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_data_governance_policy_event UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT signal_data_governance_policy_event_kind CHECK (
    object_kind IN ('quality-policy', 'retention-policy', 'licensing-policy', 'provenance-binding')
  ),
  CONSTRAINT signal_data_governance_policy_event_action CHECK (action IN ('activate', 'retire')),
  CONSTRAINT signal_data_governance_policy_event_hash CHECK (
    input_hash ~ '^sha256:[0-9a-f]{64}$' AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_data_governance_policy_events_object
  ON signal_data_governance_policy_events (workspace_id, object_kind, object_id, created_at, id);

ALTER TABLE signal_population_policy_bundles
  ADD COLUMN IF NOT EXISTS data_governance_contract_status text NOT NULL DEFAULT 'not_available',
  ADD COLUMN IF NOT EXISTS quality_policy_id uuid REFERENCES signal_quality_policies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS required_usage_purposes text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE signal_population_policy_bundles
  DROP CONSTRAINT IF EXISTS signal_population_policy_bundle_data_governance_contract,
  ADD CONSTRAINT signal_population_policy_bundle_data_governance_contract CHECK (
    (data_governance_contract_status = 'not_available'
      AND quality_policy_id IS NULL AND cardinality(required_usage_purposes) = 0)
    OR (data_governance_contract_status = 'resolved'
      AND quality_policy_id IS NOT NULL AND cardinality(required_usage_purposes) > 0)
  ),
  DROP CONSTRAINT IF EXISTS signal_population_policy_bundle_usage_purposes,
  ADD CONSTRAINT signal_population_policy_bundle_usage_purposes CHECK (
    required_usage_purposes <@ ARRAY[
      'internal-qa', 'client-derived-metrics', 'client-mention-list',
      'client-text-or-excerpt', 'llm-processing', 'strategic-analysis'
    ]::text[]
  );

-- The semantic V2 candidate remains a shared, workspace-owned base. Rights,
-- retention and quality can produce different denominators per product module,
-- so each named module/view receives a stable derived population. This is not
-- a population per UI filter: the identity is closed to the product manifest.
CREATE TABLE IF NOT EXISTS signal_governed_view_population_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  view_key text NOT NULL,
  policy_bundle_id uuid NOT NULL
    REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  base_population_id uuid NOT NULL
    REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  resolved_population_id uuid NOT NULL
    REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  policy_definition_hash text NOT NULL,
  compiled_plan_hash text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_governed_view_population_derivation
    UNIQUE (workspace_id, module_key, view_key, policy_bundle_id),
  CONSTRAINT uq_signal_governed_view_resolved_population UNIQUE (resolved_population_id),
  CONSTRAINT signal_governed_view_population_derivation_identity CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key = 'brand'
  ),
  CONSTRAINT signal_governed_view_population_derivation_distinct CHECK (
    base_population_id <> resolved_population_id
  ),
  CONSTRAINT signal_governed_view_population_derivation_hashes CHECK (
    policy_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND compiled_plan_hash ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_governed_view_population_derivations_base
  ON signal_governed_view_population_derivations (
    workspace_id, base_population_id, module_key, view_key
  );

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_population_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE base signal_population_definitions%ROWTYPE;
DECLARE resolved signal_population_definitions%ROWTYPE;
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  SELECT * INTO base FROM signal_population_definitions WHERE id = NEW.base_population_id;
  SELECT * INTO resolved FROM signal_population_definitions WHERE id = NEW.resolved_population_id;
  IF bundle.id IS NULL OR base.id IS NULL OR resolved.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR base.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR resolved.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR bundle.status = 'retired'
     OR base.purpose <> 'operational' OR base.status <> 'draft'
     OR base.definition->>'contract_version'
       <> 'signal-operational-primary-brand-semantic-v2'
     OR resolved.purpose <> 'operational' OR resolved.status <> 'draft'
     OR resolved.definition->>'contract_version'
       <> 'signal-governed-view-resolved-population-v1'
     OR resolved.definition->>'module_key' <> NEW.module_key
     OR resolved.definition->>'view_key' <> NEW.view_key
     OR resolved.definition->>'policy_bundle_id' <> NEW.policy_bundle_id::text
     OR resolved.definition->>'base_population_id' <> NEW.base_population_id::text
     OR resolved.definition->>'policy_definition_hash' <> NEW.policy_definition_hash
     OR resolved.definition->>'compiled_plan_hash' <> NEW.compiled_plan_hash THEN
    RAISE EXCEPTION 'Governed view population derivation is cross-workspace or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_population_derivation
  ON signal_governed_view_population_derivations;
CREATE TRIGGER trg_signal_governed_view_population_derivation
  BEFORE INSERT OR UPDATE ON signal_governed_view_population_derivations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_view_population_derivation();

CREATE OR REPLACE FUNCTION protect_signal_governed_view_population_derivation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Governed view population derivations are append-only.' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_population_derivation_append_only
  ON signal_governed_view_population_derivations;
CREATE TRIGGER trg_signal_governed_view_population_derivation_append_only
  BEFORE UPDATE OR DELETE ON signal_governed_view_population_derivations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_governed_view_population_derivation();

CREATE OR REPLACE FUNCTION ensure_signal_governed_view_population_derivation(
  target_workspace_id uuid,
  target_policy_bundle_id uuid,
  target_base_population_id uuid,
  target_module_key text,
  target_view_key text,
  target_policy_definition_hash text,
  target_compiled_plan_hash text,
  target_actor_user_id uuid
)
RETURNS TABLE (
  derivation_id uuid,
  resolved_population_id uuid,
  population_key text,
  population_version integer,
  population_definition_hash text,
  created boolean
)
LANGUAGE plpgsql
AS $$
DECLARE persisted record;
DECLARE target_population_key text;
DECLARE next_version integer;
DECLARE target_population_definition_hash text;
DECLARE empty_digest text := 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
BEGIN
  IF target_view_key <> 'brand'
     OR target_module_key NOT IN ('brand-monitoring','mentions','topics-narratives') THEN
    RAISE EXCEPTION 'Governed view population identity is unsupported.' USING ERRCODE = '23514';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id, target_actor_user_id) THEN
    RAISE EXCEPTION 'Governed view population actor is not authorized.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO bundle FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id
    AND candidate.workspace_id = target_workspace_id
    AND candidate.status = 'draft';
  IF bundle.id IS NULL
     OR bundle.definition_hash IS DISTINCT FROM target_policy_definition_hash
     OR NOT (target_module_key = ANY(bundle.authorized_modules))
     OR NOT EXISTS (
       SELECT 1 FROM signal_population_definitions base
       WHERE base.id = target_base_population_id
         AND base.workspace_id = target_workspace_id
         AND base.purpose = 'operational' AND base.status = 'draft'
         AND base.definition->>'contract_version'
           = 'signal-operational-primary-brand-semantic-v2'
     ) THEN
    RAISE EXCEPTION 'Governed view population inputs are unavailable or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'governed-view-population', target_workspace_id::text,
    target_module_key, target_view_key, target_policy_bundle_id::text), 0));
  SELECT derivation.id, population.id AS resolved_population_id,
    population.population_key, population.version,
    population.definition_hash AS population_definition_hash
  INTO persisted
  FROM signal_governed_view_population_derivations derivation
  JOIN signal_population_definitions population
    ON population.id = derivation.resolved_population_id
  WHERE derivation.workspace_id = target_workspace_id
    AND derivation.module_key = target_module_key
    AND derivation.view_key = target_view_key
    AND derivation.policy_bundle_id = target_policy_bundle_id
  FOR UPDATE OF derivation;
  IF persisted.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM signal_governed_view_population_derivations derivation
      WHERE derivation.id = persisted.id
        AND derivation.base_population_id = target_base_population_id
        AND derivation.policy_definition_hash = target_policy_definition_hash
        AND derivation.compiled_plan_hash = target_compiled_plan_hash
    ) THEN
      RAISE EXCEPTION 'Existing governed view population derivation has incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT persisted.id, persisted.resolved_population_id,
      persisted.population_key, persisted.version, persisted.population_definition_hash, false;
    RETURN;
  END IF;
  target_population_key := target_module_key || '-' || target_view_key || '-governed';
  SELECT COALESCE(max(population.version), 0) + 1 INTO next_version
  FROM signal_population_definitions population
  WHERE population.workspace_id = target_workspace_id
    AND population.population_key = target_population_key;
  target_population_definition_hash := 'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'signal-governed-view-resolved-population-v1', target_workspace_id::text,
    target_policy_bundle_id::text, target_base_population_id::text,
    target_module_key, target_view_key, target_policy_definition_hash,
    target_compiled_plan_hash, target_population_key, next_version::text
  ), 'UTF8')), 'hex');
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, min_quality_score,
    period_start, period_end, definition_hash, policy_key, policy_version,
    timezone, membership_digest, created_by_user_id, definition
  ) VALUES (
    target_workspace_id, target_population_key, next_version, 'operational', 'draft',
    bundle.acceptance_status, bundle.allowed_scopes, bundle.min_quality_score,
    bundle.period_start, bundle.period_end, target_population_definition_hash,
    bundle.policy_key, bundle.policy_version::text, bundle.timezone, empty_digest,
    target_actor_user_id, jsonb_build_object(
      'contract_version', 'signal-governed-view-resolved-population-v1',
      'module_key', target_module_key,
      'view_key', target_view_key,
      'policy_bundle_id', target_policy_bundle_id::text,
      'base_population_id', target_base_population_id::text,
      'policy_definition_hash', target_policy_definition_hash,
      'compiled_plan_hash', target_compiled_plan_hash,
      'deduplication_policy', 'canonical-root',
      'promotion_state', 'candidate_not_bound'
    )
  ) RETURNING id INTO resolved_population_id;
  INSERT INTO signal_governed_view_population_derivations (
    workspace_id, module_key, view_key, policy_bundle_id,
    base_population_id, resolved_population_id, policy_definition_hash,
    compiled_plan_hash, created_by_user_id
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, target_policy_bundle_id,
    target_base_population_id, resolved_population_id, target_policy_definition_hash,
    target_compiled_plan_hash, target_actor_user_id
  ) RETURNING id INTO derivation_id;
  population_key := target_population_key;
  population_version := next_version;
  population_definition_hash := target_population_definition_hash;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_signal_governed_view_population_membership_digest(
  target_population_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE computed_digest text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signal_governed_view_population_derivations derivation
    JOIN signal_population_definitions population
      ON population.id = derivation.resolved_population_id
    WHERE derivation.resolved_population_id = target_population_id
      AND population.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Governed view population is unavailable or not draft.' USING ERRCODE = '23514';
  END IF;
  SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
    membership.mention_id::text, ',' ORDER BY membership.mention_id
  ) FILTER (WHERE membership.membership_status = 'included'
      AND membership.removed_at IS NULL), ''), 'UTF8')), 'hex')
  INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id = target_population_id;
  UPDATE signal_population_definitions
  SET membership_digest = computed_digest, updated_at = now()
  WHERE id = target_population_id AND status = 'draft';
  RETURN computed_digest;
END;
$$;

CREATE TABLE IF NOT EXISTS signal_data_governance_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_bundle_id uuid NOT NULL REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  quality_policy_id uuid NOT NULL REFERENCES signal_quality_policies(id) ON DELETE RESTRICT,
  usage_purposes text[] NOT NULL,
  evaluation_status text NOT NULL DEFAULT 'draft',
  candidate_root_count integer NOT NULL DEFAULT 0,
  authorized_root_count integer NOT NULL DEFAULT 0,
  quality_blocked_count integer NOT NULL DEFAULT 0,
  retention_blocked_count integer NOT NULL DEFAULT 0,
  licensing_blocked_count integer NOT NULL DEFAULT 0,
  governance_unknown_count integer NOT NULL DEFAULT 0,
  retention_policy_digest text NOT NULL,
  licensing_policy_digest text NOT NULL,
  policy_evaluation_watermark timestamptz NOT NULL,
  governance_digest text NOT NULL,
  definition_hash text NOT NULL,
  evaluated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_data_governance_evaluation UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT signal_data_governance_evaluation_status CHECK (evaluation_status IN ('draft', 'complete')),
  CONSTRAINT signal_data_governance_evaluation_counts CHECK (
    candidate_root_count >= 0 AND authorized_root_count >= 0
    AND quality_blocked_count >= 0 AND retention_blocked_count >= 0
    AND licensing_blocked_count >= 0 AND governance_unknown_count >= 0
    AND authorized_root_count <= candidate_root_count
  ),
  CONSTRAINT signal_data_governance_evaluation_usage CHECK (
    cardinality(usage_purposes) > 0
    AND usage_purposes <@ ARRAY[
      'internal-qa', 'client-derived-metrics', 'client-mention-list',
      'client-text-or-excerpt', 'llm-processing', 'strategic-analysis'
    ]::text[]
  ),
  CONSTRAINT signal_data_governance_evaluation_hashes CHECK (
    retention_policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND licensing_policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND governance_digest ~ '^sha256:[0-9a-f]{64}$'
    AND definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_data_governance_evaluation_finalization CHECK (
    (evaluation_status = 'draft' AND finalized_at IS NULL)
    OR (evaluation_status = 'complete' AND finalized_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_data_governance_evaluations_population
  ON signal_data_governance_evaluations (workspace_id, population_id, evaluation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_data_governance_evaluation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES signal_data_governance_evaluations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  decision text NOT NULL,
  reason_code text NOT NULL,
  import_membership_id uuid REFERENCES signal_mention_import_memberships(id) ON DELETE RESTRICT,
  provenance_binding_id uuid REFERENCES signal_provenance_policy_bindings(id) ON DELETE RESTRICT,
  quality_policy_id uuid NOT NULL REFERENCES signal_quality_policies(id) ON DELETE RESTRICT,
  retention_policy_id uuid REFERENCES signal_retention_policies(id) ON DELETE RESTRICT,
  licensing_policy_id uuid REFERENCES signal_licensing_policies(id) ON DELETE RESTRICT,
  governance_path_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_data_governance_evaluation_item UNIQUE (evaluation_id, mention_id),
  CONSTRAINT signal_data_governance_evaluation_item_decision CHECK (decision IN ('included', 'excluded', 'blocked')),
  CONSTRAINT signal_data_governance_evaluation_item_reason CHECK (reason_code IN (
    'quality_not_eligible', 'retention_expired', 'retention_blocked',
    'retention_not_available', 'licensing_prohibited', 'licensing_not_available',
    'no_authorized_provenance', 'semantic_not_eligible', 'policy_eligible'
  )),
  CONSTRAINT signal_data_governance_evaluation_item_hash CHECK (
    governance_path_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_data_governance_evaluation_item_included CHECK (
    decision <> 'included'
    OR (reason_code = 'policy_eligible' AND import_membership_id IS NOT NULL
      AND provenance_binding_id IS NOT NULL AND retention_policy_id IS NOT NULL
      AND licensing_policy_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_data_governance_evaluation_items_reason
  ON signal_data_governance_evaluation_items (evaluation_id, decision, reason_code, mention_id);
CREATE INDEX IF NOT EXISTS idx_signal_data_governance_evaluation_items_source
  ON signal_data_governance_evaluation_items (workspace_id, provenance_binding_id, mention_id);

ALTER TABLE signal_population_policy_compilations
  ADD COLUMN IF NOT EXISTS governance_evaluation_id uuid
    REFERENCES signal_data_governance_evaluations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quality_policy_id uuid REFERENCES signal_quality_policies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quality_policy_version integer,
  ADD COLUMN IF NOT EXISTS quality_policy_hash text,
  ADD COLUMN IF NOT EXISTS retention_policy_digest text,
  ADD COLUMN IF NOT EXISTS licensing_policy_digest text,
  ADD COLUMN IF NOT EXISTS usage_purposes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS authorized_root_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_blocked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_blocked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS licensing_blocked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS governance_unknown_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS policy_evaluation_watermark timestamptz,
  ADD COLUMN IF NOT EXISTS governance_digest text;

ALTER TABLE signal_population_policy_compilations
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_governance_counts,
  ADD CONSTRAINT signal_population_policy_compilation_governance_counts CHECK (
    authorized_root_count >= 0 AND quality_blocked_count >= 0 AND retention_blocked_count >= 0
    AND licensing_blocked_count >= 0 AND governance_unknown_count >= 0
  ),
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_governance_hashes,
  ADD CONSTRAINT signal_population_policy_compilation_governance_hashes CHECK (
    (quality_policy_hash IS NULL OR quality_policy_hash ~ '^sha256:[0-9a-f]{64}$')
    AND (retention_policy_digest IS NULL OR retention_policy_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (licensing_policy_digest IS NULL OR licensing_policy_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (governance_digest IS NULL OR governance_digest ~ '^sha256:[0-9a-f]{64}$')
  );

CREATE TABLE IF NOT EXISTS signal_data_governance_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  policy_compilation_id uuid NOT NULL
    REFERENCES signal_population_policy_compilations(id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  object_kind text NOT NULL,
  object_identity_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_data_governance_invalidation UNIQUE (idempotency_key),
  CONSTRAINT signal_data_governance_invalidation_reason CHECK (reason_code IN (
    'quality-policy-changed', 'quality-state-changed', 'retention-policy-changed',
    'licensing-policy-changed', 'provenance-binding-changed', 'provenance-changed',
    'canonical-identity-changed', 'semantic-assertion-changed',
    'population-membership-changed', 'watermark-changed'
  )),
  CONSTRAINT signal_data_governance_invalidation_kind CHECK (object_kind IN (
    'quality-policy', 'retention-policy', 'licensing-policy', 'provenance-binding',
    'mention', 'attribution', 'membership', 'watermark'
  )),
  CONSTRAINT signal_data_governance_invalidation_hashes CHECK (
    object_identity_hash ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_data_governance_invalidations_compilation
  ON signal_data_governance_invalidations (policy_compilation_id, created_at DESC);

-- Definition hashes include relational authority identity and closed usage purposes.
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
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = target_policy_bundle_id;
  IF bundle.id IS NULL THEN
    RAISE EXCEPTION 'Policy bundle is unavailable.' USING ERRCODE = '23514';
  END IF;
  canonical_definition := concat_ws(chr(31),
    'signal-governed-views-v1', bundle.workspace_id::text, bundle.policy_key,
    bundle.policy_version::text,
    COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(bundle.authorized_modules) value), ''),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(bundle.allowed_scopes) value), ''),
    COALESCE((SELECT string_agg(entity.scope || ':' || entity.entity_type || ':' || entity.entity_id::text,
      ',' ORDER BY entity.scope, entity.entity_type, entity.entity_id)
      FROM signal_population_policy_entities entity WHERE entity.policy_bundle_id = bundle.id), ''),
    bundle.acceptance_status, bundle.quality_contract_status,
    COALESCE(bundle.quality_policy_key, '∅'), COALESCE(bundle.quality_policy_version::text, '∅'),
    COALESCE(bundle.min_quality_score::text, '∅'),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(bundle.required_quality_flags) value), ''),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(bundle.forbidden_quality_flags) value), ''),
    bundle.eligibility_policy, bundle.deduplication_policy, bundle.visibility_class,
    bundle.denominator_key, COALESCE(bundle.period_start::text, '∅'),
    COALESCE(bundle.period_end::text, '∅'), COALESCE(bundle.timezone, '∅'),
    COALESCE(bundle.retention_policy_ref, '∅'), COALESCE(bundle.licensing_policy_ref, '∅'),
    bundle.data_governance_contract_status, COALESCE(bundle.quality_policy_id::text, '∅'),
    COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(bundle.required_usage_purposes) value), '')
  );
  RETURN 'sha256:' || encode(sha256(convert_to(canonical_definition, 'UTF8')), 'hex');
END;
$$;

-- Draft bundles are mutable by definition; align their hash with the extended contract.
UPDATE signal_population_policy_bundles bundle
SET definition_hash = signal_population_policy_bundle_definition_hash(bundle.id), updated_at = now()
WHERE bundle.status = 'draft';

CREATE OR REPLACE FUNCTION enforce_signal_quality_policy_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_organization_id uuid;
BEGIN
  SELECT organization_id INTO target_organization_id
  FROM signal_workspaces WHERE id = NEW.workspace_id;
  IF target_organization_id IS NULL OR NEW.organization_id IS DISTINCT FROM target_organization_id
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Data governance policy is cross-workspace or actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.activated_by_user_id IS NOT NULL
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.activated_by_user_id) THEN
    RAISE EXCEPTION 'Data governance activation actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.definition_hash IS DISTINCT FROM
    ('sha256:' || encode(sha256(convert_to(concat_ws(chr(31), 'quality-policy-v1', NEW.workspace_id::text,
      NEW.policy_key, NEW.policy_version::text, COALESCE(NEW.min_quality_score::text, '∅'),
      COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(NEW.required_quality_flags) value), ''),
      COALESCE((SELECT string_agg(value, ',' ORDER BY value) FROM unnest(NEW.forbidden_quality_flags) value), ''),
      NEW.canonical_root_disposition), 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Quality policy definition hash is invalid.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_retention_policy_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_organization_id uuid;
BEGIN
  SELECT organization_id INTO target_organization_id
  FROM signal_workspaces WHERE id = NEW.workspace_id;
  IF target_organization_id IS NULL OR NEW.organization_id IS DISTINCT FROM target_organization_id
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Data governance policy is cross-workspace or actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.definition_hash IS DISTINCT FROM
    ('sha256:' || encode(sha256(convert_to(concat_ws(chr(31), 'retention-policy-v1', NEW.workspace_id::text,
      NEW.policy_key, NEW.policy_version::text, NEW.retention_state, NEW.retention_mode,
      COALESCE(to_char(NEW.retain_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '∅'), NEW.expiry_action,
      COALESCE(NEW.approval_evidence_hash, '∅')), 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Retention policy definition hash is invalid.' USING ERRCODE = '23514';
  END IF;
  IF NEW.approved_by_user_id IS NOT NULL
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.approved_by_user_id) THEN
    RAISE EXCEPTION 'Retention policy approval actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_quality_policy_contract ON signal_quality_policies;
CREATE TRIGGER trg_signal_quality_policy_contract BEFORE INSERT OR UPDATE ON signal_quality_policies
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_quality_policy_contract();
DROP TRIGGER IF EXISTS trg_signal_retention_policy_contract ON signal_retention_policies;
CREATE TRIGGER trg_signal_retention_policy_contract BEFORE INSERT OR UPDATE ON signal_retention_policies
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_retention_policy_contract();

CREATE OR REPLACE FUNCTION enforce_signal_licensing_policy_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_organization_id uuid;
DECLARE expected_hash text;
BEGIN
  SELECT organization_id INTO target_organization_id FROM signal_workspaces WHERE id = NEW.workspace_id;
  IF target_organization_id IS NULL OR NEW.organization_id IS DISTINCT FROM target_organization_id
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Licensing policy is cross-workspace or actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.approved_by_user_id IS NOT NULL
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.approved_by_user_id) THEN
    RAISE EXCEPTION 'Licensing policy approval actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  -- Child usage rows are inserted while draft. Their digest is checked again before activation/compilation.
  IF NEW.definition_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Licensing policy definition hash is invalid.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('active', 'retired')
     AND NEW.definition_hash IS DISTINCT FROM signal_licensing_policy_definition_hash(NEW.id) THEN
    RAISE EXCEPTION 'Licensing policy definition hash does not match its governed usages.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_licensing_policy_contract ON signal_licensing_policies;
CREATE TRIGGER trg_signal_licensing_policy_contract BEFORE INSERT OR UPDATE ON signal_licensing_policies
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_licensing_policy_contract();

CREATE OR REPLACE FUNCTION signal_licensing_policy_definition_hash(target_policy_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'licensing-policy-v1', policy.workspace_id::text, policy.policy_key,
    policy.policy_version::text, COALESCE(policy.approval_evidence_hash, '∅'),
    COALESCE((SELECT string_agg(usage.usage_purpose || ':' || usage.decision, ','
      ORDER BY usage.usage_purpose) FROM signal_licensing_policy_usages usage
      WHERE usage.licensing_policy_id = policy.id), '')
  ), 'UTF8')), 'hex')
  FROM signal_licensing_policies policy WHERE policy.id = target_policy_id;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_licensing_usage_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE policy signal_licensing_policies%ROWTYPE;
DECLARE target signal_licensing_policy_usages%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD; ELSE target := NEW; END IF;
  SELECT * INTO policy FROM signal_licensing_policies WHERE id = target.licensing_policy_id;
  IF policy.id IS NULL OR policy.workspace_id IS DISTINCT FROM target.workspace_id OR policy.status <> 'draft' THEN
    RAISE EXCEPTION 'Licensing usages may only be authored inside their workspace draft.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_licensing_usage_contract ON signal_licensing_policy_usages;
CREATE TRIGGER trg_signal_licensing_usage_contract BEFORE INSERT OR UPDATE OR DELETE
  ON signal_licensing_policy_usages FOR EACH ROW EXECUTE FUNCTION enforce_signal_licensing_usage_contract();

CREATE OR REPLACE FUNCTION enforce_signal_provenance_policy_binding_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE source_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO source_workspace_id FROM data_sources WHERE id = NEW.data_source_id;
  IF source_workspace_id IS DISTINCT FROM NEW.workspace_id
     OR (NEW.import_batch_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM import_batches batch WHERE batch.id = NEW.import_batch_id
         AND batch.workspace_id = NEW.workspace_id AND batch.data_source_id = NEW.data_source_id
     ))
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.created_by_user_id)
     OR NOT EXISTS (SELECT 1 FROM signal_quality_policies policy
       WHERE policy.id = NEW.quality_policy_id AND policy.workspace_id = NEW.workspace_id)
     OR NOT EXISTS (SELECT 1 FROM signal_retention_policies policy
       WHERE policy.id = NEW.retention_policy_id AND policy.workspace_id = NEW.workspace_id)
     OR NOT EXISTS (SELECT 1 FROM signal_licensing_policies policy
       WHERE policy.id = NEW.licensing_policy_id AND policy.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'Provenance policy binding is cross-workspace or unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.activated_by_user_id IS NOT NULL
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.activated_by_user_id) THEN
    RAISE EXCEPTION 'Provenance binding activation actor is unauthorized.' USING ERRCODE = '23514';
  END IF;
  IF NEW.definition_hash IS DISTINCT FROM ('sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'signal-provenance-policy-binding-v1', NEW.workspace_id::text, NEW.data_source_id::text,
    COALESCE(NEW.import_batch_id::text, '∅'), NEW.binding_version::text,
    NEW.quality_policy_id::text, NEW.retention_policy_id::text,
    NEW.licensing_policy_id::text), 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Provenance binding definition hash is invalid.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'active' AND (
    NOT EXISTS (SELECT 1 FROM signal_quality_policies policy WHERE policy.id = NEW.quality_policy_id AND policy.status = 'active')
    OR NOT EXISTS (SELECT 1 FROM signal_retention_policies policy WHERE policy.id = NEW.retention_policy_id AND policy.status = 'active')
    OR NOT EXISTS (SELECT 1 FROM signal_licensing_policies policy WHERE policy.id = NEW.licensing_policy_id AND policy.status = 'active')
  ) THEN
    RAISE EXCEPTION 'Active provenance binding requires active authority policies.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_provenance_policy_binding_contract ON signal_provenance_policy_bindings;
CREATE TRIGGER trg_signal_provenance_policy_binding_contract BEFORE INSERT OR UPDATE
  ON signal_provenance_policy_bindings FOR EACH ROW EXECUTE FUNCTION enforce_signal_provenance_policy_binding_contract();

CREATE OR REPLACE FUNCTION protect_signal_data_governance_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Data governance history is append-only.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'active' AND NEW.status = 'retired'
     AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status','effective_to','updated_at']::text[])
       IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','effective_to','updated_at']::text[]) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'active'
     AND NEW.activated_by_user_id IS NOT NULL AND NEW.activated_at IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status','activated_by_user_id','activated_at','updated_at']::text[])
       IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','activated_by_user_id','activated_at','updated_at']::text[]) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Activated data governance policies are immutable.' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_quality_policy_history ON signal_quality_policies;
CREATE TRIGGER trg_signal_quality_policy_history BEFORE UPDATE OR DELETE ON signal_quality_policies
  FOR EACH ROW EXECUTE FUNCTION protect_signal_data_governance_history();
DROP TRIGGER IF EXISTS trg_signal_provenance_policy_binding_history ON signal_provenance_policy_bindings;
CREATE TRIGGER trg_signal_provenance_policy_binding_history BEFORE UPDATE OR DELETE ON signal_provenance_policy_bindings
  FOR EACH ROW EXECUTE FUNCTION protect_signal_data_governance_history();

CREATE OR REPLACE FUNCTION protect_signal_retention_policy_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retention policy history is append-only.' USING ERRCODE = '55000'; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'active' AND NEW.approved_by_user_id IS NOT NULL
     AND NEW.approved_at IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status','approved_by_user_id','approved_at','updated_at']::text[])
       IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approved_by_user_id','approved_at','updated_at']::text[]) THEN RETURN NEW; END IF;
  IF OLD.status = 'active' AND NEW.status = 'retired' AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status','effective_to','updated_at']::text[])
       IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','effective_to','updated_at']::text[]) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Activated retention policies are immutable.' USING ERRCODE = '55000';
END; $$;

DROP TRIGGER IF EXISTS trg_signal_retention_policy_history ON signal_retention_policies;
CREATE TRIGGER trg_signal_retention_policy_history BEFORE UPDATE OR DELETE ON signal_retention_policies
  FOR EACH ROW EXECUTE FUNCTION protect_signal_retention_policy_history();
DROP TRIGGER IF EXISTS trg_signal_licensing_policy_history ON signal_licensing_policies;
CREATE TRIGGER trg_signal_licensing_policy_history BEFORE UPDATE OR DELETE ON signal_licensing_policies
  FOR EACH ROW EXECUTE FUNCTION protect_signal_retention_policy_history();

CREATE OR REPLACE FUNCTION enforce_signal_data_governance_evaluation_item_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
BEGIN
  SELECT * INTO evaluation FROM signal_data_governance_evaluations WHERE id = NEW.evaluation_id;
  IF evaluation.id IS NULL OR evaluation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR evaluation.evaluation_status <> 'draft'
     OR NOT EXISTS (SELECT 1 FROM mentions mention WHERE mention.id = NEW.mention_id
       AND mention.workspace_id = NEW.workspace_id AND mention.canonical_mention_id = mention.id)
     OR NEW.quality_policy_id IS DISTINCT FROM evaluation.quality_policy_id THEN
    RAISE EXCEPTION 'Governance evaluation item is cross-workspace or not canonical.' USING ERRCODE = '23514';
  END IF;
  IF NEW.import_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM signal_mention_import_memberships membership
    JOIN mentions provenance_mention
      ON provenance_mention.id = membership.mention_id
     AND provenance_mention.workspace_id = membership.workspace_id
    WHERE membership.id = NEW.import_membership_id AND membership.workspace_id = NEW.workspace_id
      AND provenance_mention.canonical_mention_id = NEW.mention_id
  ) THEN RAISE EXCEPTION 'Governance evidence provenance is invalid.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_data_governance_evaluation_item_contract
  ON signal_data_governance_evaluation_items;
CREATE TRIGGER trg_signal_data_governance_evaluation_item_contract BEFORE INSERT OR UPDATE
  ON signal_data_governance_evaluation_items FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_data_governance_evaluation_item_contract();

CREATE OR REPLACE FUNCTION protect_signal_data_governance_evaluation_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Governance evaluations are append-only.' USING ERRCODE = '55000'; END IF;
  IF OLD.evaluation_status = 'draft' AND NEW.evaluation_status = 'complete'
     AND NEW.finalized_at IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['evaluation_status','candidate_root_count','authorized_root_count',
       'quality_blocked_count','retention_blocked_count','licensing_blocked_count',
       'governance_unknown_count','retention_policy_digest','licensing_policy_digest',
       'governance_digest','definition_hash','next_policy_transition_at','finalized_at']::text[])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['evaluation_status','candidate_root_count','authorized_root_count',
       'quality_blocked_count','retention_blocked_count','licensing_blocked_count',
       'governance_unknown_count','retention_policy_digest','licensing_policy_digest',
       'governance_digest','definition_hash','next_policy_transition_at','finalized_at']::text[]) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Finalized governance evaluations are immutable.' USING ERRCODE = '55000';
END; $$;

DROP TRIGGER IF EXISTS trg_signal_data_governance_evaluation_history
  ON signal_data_governance_evaluations;
CREATE TRIGGER trg_signal_data_governance_evaluation_history BEFORE UPDATE OR DELETE
  ON signal_data_governance_evaluations FOR EACH ROW
  EXECUTE FUNCTION protect_signal_data_governance_evaluation_history();

CREATE OR REPLACE FUNCTION validate_signal_data_governance_evaluation_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE observed_candidate integer;
DECLARE observed_authorized integer;
DECLARE observed_quality integer;
DECLARE observed_retention integer;
DECLARE observed_licensing integer;
DECLARE observed_unknown integer;
DECLARE observed_retention_digest text;
DECLARE observed_licensing_digest text;
DECLARE observed_governance_digest text;
DECLARE observed_definition_hash text;
BEGIN
  IF NOT (OLD.evaluation_status = 'draft' AND NEW.evaluation_status = 'complete') THEN RETURN NEW; END IF;
  SELECT count(*)::int,
    count(*) FILTER (WHERE decision = 'included')::int,
    count(*) FILTER (WHERE reason_code = 'quality_not_eligible')::int,
    count(*) FILTER (WHERE reason_code IN ('retention_expired','retention_blocked'))::int,
    count(*) FILTER (WHERE reason_code = 'licensing_prohibited')::int,
    count(*) FILTER (WHERE reason_code IN (
      'retention_not_available','licensing_not_available','no_authorized_provenance'
    ))::int
  INTO observed_candidate, observed_authorized, observed_quality,
    observed_retention, observed_licensing, observed_unknown
  FROM signal_data_governance_evaluation_items item WHERE item.evaluation_id = NEW.id;

  SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(DISTINCT
      policy.id::text || ':' || policy.definition_hash, ',' ORDER BY
      policy.id::text || ':' || policy.definition_hash), ''), 'UTF8')), 'hex')
  INTO observed_retention_digest
  FROM signal_data_governance_evaluation_items item
  LEFT JOIN signal_retention_policies policy ON policy.id = item.retention_policy_id
  WHERE item.evaluation_id = NEW.id;
  SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(DISTINCT
      policy.id::text || ':' || policy.definition_hash, ',' ORDER BY
      policy.id::text || ':' || policy.definition_hash), ''), 'UTF8')), 'hex')
  INTO observed_licensing_digest
  FROM signal_data_governance_evaluation_items item
  LEFT JOIN signal_licensing_policies policy ON policy.id = item.licensing_policy_id
  WHERE item.evaluation_id = NEW.id;
  SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws(':',
      item.mention_id::text, item.decision, item.reason_code,
      COALESCE(item.import_membership_id::text, '∅'),
      COALESCE(item.provenance_binding_id::text, '∅'), item.quality_policy_id::text,
      COALESCE(item.retention_policy_id::text, '∅'),
      COALESCE(item.licensing_policy_id::text, '∅'), item.governance_path_hash
    ), ',' ORDER BY item.mention_id), ''), 'UTF8')), 'hex')
  INTO observed_governance_digest
  FROM signal_data_governance_evaluation_items item WHERE item.evaluation_id = NEW.id;
  observed_definition_hash := 'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'signal-data-governance-evaluation-v1', NEW.workspace_id::text,
    NEW.policy_bundle_id::text, NEW.population_id::text, NEW.quality_policy_id::text,
    NEW.module_key, NEW.view_key,
    array_to_string(NEW.usage_purposes, ','), NEW.policy_evaluation_watermark::text,
    observed_candidate::text, observed_authorized::text, observed_quality::text,
    observed_retention::text, observed_licensing::text, observed_unknown::text,
    observed_retention_digest, observed_licensing_digest, observed_governance_digest
  ), 'UTF8')), 'hex');

  IF NEW.candidate_root_count IS DISTINCT FROM observed_candidate
     OR NEW.authorized_root_count IS DISTINCT FROM observed_authorized
     OR NEW.quality_blocked_count IS DISTINCT FROM observed_quality
     OR NEW.retention_blocked_count IS DISTINCT FROM observed_retention
     OR NEW.licensing_blocked_count IS DISTINCT FROM observed_licensing
     OR NEW.governance_unknown_count IS DISTINCT FROM observed_unknown
     OR NEW.retention_policy_digest IS DISTINCT FROM observed_retention_digest
     OR NEW.licensing_policy_digest IS DISTINCT FROM observed_licensing_digest
     OR NEW.governance_digest IS DISTINCT FROM observed_governance_digest
     OR NEW.definition_hash IS DISTINCT FROM observed_definition_hash THEN
    RAISE EXCEPTION 'Governance evaluation summary does not match its relational items.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM signal_data_governance_evaluation_items item
    JOIN signal_mention_import_memberships membership ON membership.id = item.import_membership_id
    JOIN mentions provenance_mention
      ON provenance_mention.id = membership.mention_id
     AND provenance_mention.workspace_id = membership.workspace_id
    JOIN signal_provenance_policy_bindings binding ON binding.id = item.provenance_binding_id
    JOIN signal_quality_policies quality ON quality.id = item.quality_policy_id
    JOIN signal_retention_policies retention ON retention.id = item.retention_policy_id
    JOIN signal_licensing_policies licensing ON licensing.id = item.licensing_policy_id
    WHERE item.evaluation_id = NEW.id AND item.decision = 'included'
      AND (
        membership.workspace_id <> NEW.workspace_id
        OR provenance_mention.canonical_mention_id <> item.mention_id
        OR binding.workspace_id <> NEW.workspace_id OR binding.data_source_id <> membership.data_source_id
        OR binding.quality_policy_id <> NEW.quality_policy_id
        OR binding.retention_policy_id <> retention.id OR binding.licensing_policy_id <> licensing.id
        OR binding.status <> 'active' OR binding.effective_from > NEW.policy_evaluation_watermark
        OR (binding.effective_to IS NOT NULL AND binding.effective_to <= NEW.policy_evaluation_watermark)
        OR (binding.import_batch_id IS NOT NULL AND binding.import_batch_id <> membership.import_batch_id)
        OR (binding.import_batch_id IS NULL AND EXISTS (
          SELECT 1 FROM signal_provenance_policy_bindings import_override
          WHERE import_override.workspace_id = NEW.workspace_id
            AND import_override.data_source_id = membership.data_source_id
            AND import_override.import_batch_id = membership.import_batch_id
            AND import_override.status = 'active'
            AND import_override.effective_from <= NEW.policy_evaluation_watermark
            AND (import_override.effective_to IS NULL OR import_override.effective_to > NEW.policy_evaluation_watermark)
        ))
        OR quality.status <> 'active' OR quality.canonical_root_disposition <> 'evaluate'
        OR retention.status <> 'active' OR retention.retention_state <> 'allowed'
        OR retention.effective_from > NEW.policy_evaluation_watermark
        OR (retention.effective_to IS NOT NULL AND retention.effective_to <= NEW.policy_evaluation_watermark)
        OR (retention.retention_mode = 'until' AND retention.retain_until <= NEW.policy_evaluation_watermark)
        OR licensing.status <> 'active' OR licensing.effective_from > NEW.policy_evaluation_watermark
        OR (licensing.effective_to IS NOT NULL AND licensing.effective_to <= NEW.policy_evaluation_watermark)
        OR EXISTS (
          SELECT 1 FROM unnest(NEW.usage_purposes) required(purpose)
          WHERE NOT EXISTS (
            SELECT 1 FROM signal_licensing_policy_usages usage
            WHERE usage.licensing_policy_id = licensing.id
              AND usage.usage_purpose = required.purpose AND usage.decision = 'allowed'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Included governance evaluation item lacks an active authorized provenance.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_signal_data_governance_evaluation_finalization
  ON signal_data_governance_evaluations;
CREATE TRIGGER trg_validate_signal_data_governance_evaluation_finalization
  BEFORE UPDATE OF evaluation_status ON signal_data_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION validate_signal_data_governance_evaluation_finalization();

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_compilation_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE quality signal_quality_policies%ROWTYPE;
DECLARE included_count integer;
DECLARE proof_count integer;
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  IF NOT EXISTS (
    SELECT 1
    FROM signal_governed_view_population_derivations derivation
    WHERE derivation.workspace_id = NEW.workspace_id
      AND derivation.module_key = NEW.module_key
      AND derivation.view_key = NEW.view_key
      AND derivation.policy_bundle_id = NEW.policy_bundle_id
      AND derivation.resolved_population_id = NEW.population_id
      AND derivation.policy_definition_hash = NEW.policy_definition_hash
      AND derivation.compiled_plan_hash = NEW.compiled_plan_hash
  ) THEN
    RAISE EXCEPTION 'Policy compilation lacks an exact module/view population derivation.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.compilation_status <> 'ready' OR bundle.visibility_class <> 'client-safe' THEN RETURN NEW; END IF;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations WHERE id = NEW.governance_evaluation_id;
  SELECT * INTO quality FROM signal_quality_policies WHERE id = NEW.quality_policy_id;
  IF bundle.data_governance_contract_status <> 'resolved'
     OR bundle.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR NOT (NEW.usage_purposes <@ bundle.required_usage_purposes)
     OR NEW.usage_purposes IS DISTINCT FROM (CASE NEW.module_key
       WHEN 'brand-monitoring' THEN ARRAY['client-derived-metrics']::text[]
       WHEN 'mentions' THEN ARRAY['client-mention-list','client-text-or-excerpt']::text[]
       WHEN 'topics-narratives' THEN ARRAY['client-derived-metrics']::text[]
       ELSE ARRAY[]::text[] END)
     OR quality.status <> 'active' OR quality.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR quality.canonical_root_disposition <> 'evaluate'
     OR quality.definition_hash IS DISTINCT FROM NEW.quality_policy_hash
     OR quality.policy_version IS DISTINCT FROM NEW.quality_policy_version
     OR evaluation.evaluation_status <> 'complete'
     OR evaluation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR evaluation.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR evaluation.population_id IS DISTINCT FROM NEW.population_id
     OR evaluation.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR evaluation.usage_purposes IS DISTINCT FROM NEW.usage_purposes
     OR evaluation.retention_policy_digest IS DISTINCT FROM NEW.retention_policy_digest
     OR evaluation.licensing_policy_digest IS DISTINCT FROM NEW.licensing_policy_digest
     OR evaluation.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR evaluation.policy_evaluation_watermark IS DISTINCT FROM NEW.policy_evaluation_watermark
     OR evaluation.authorized_root_count IS DISTINCT FROM NEW.authorized_root_count
     OR evaluation.retention_blocked_count IS DISTINCT FROM NEW.retention_blocked_count
     OR evaluation.licensing_blocked_count IS DISTINCT FROM NEW.licensing_blocked_count
     OR evaluation.governance_unknown_count IS DISTINCT FROM NEW.governance_unknown_count THEN
    RAISE EXCEPTION 'Client-safe compilation lacks exact relational governance authority.' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::int INTO included_count FROM signal_population_memberships membership
  WHERE membership.population_id = NEW.population_id AND membership.workspace_id = NEW.workspace_id
    AND membership.membership_status = 'included' AND membership.removed_at IS NULL;
  SELECT count(*)::int INTO proof_count FROM signal_data_governance_evaluation_items item
  WHERE item.evaluation_id = evaluation.id AND item.workspace_id = NEW.workspace_id
    AND item.decision = 'included' AND item.reason_code = 'policy_eligible';
  IF included_count <> proof_count OR included_count <> NEW.authorized_root_count OR EXISTS (
    SELECT 1 FROM signal_population_memberships membership
    WHERE membership.population_id = NEW.population_id AND membership.workspace_id = NEW.workspace_id
      AND membership.membership_status = 'included' AND membership.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM signal_data_governance_evaluation_items item
        WHERE item.evaluation_id = evaluation.id AND item.mention_id = membership.mention_id
          AND item.decision = 'included' AND item.reason_code = 'policy_eligible')
  ) THEN
    RAISE EXCEPTION 'Client-safe compilation membership lacks exact authorized provenance proof.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_compilation_governance
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_signal_population_policy_compilation_governance BEFORE INSERT
  ON signal_population_policy_compilations FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_policy_compilation_governance();

CREATE OR REPLACE FUNCTION enforce_signal_governed_binding_governance_contract()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.population_id IS NOT NULL AND (
    NEW.policy_compilation_id IS NULL
    OR EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
      WHERE invalidation.policy_compilation_id = NEW.policy_compilation_id)
    OR NOT EXISTS (SELECT 1 FROM signal_population_policy_compilations compilation
      WHERE compilation.id = NEW.policy_compilation_id
        AND compilation.governance_evaluation_id IS NOT NULL
        AND compilation.governance_digest IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Governed binding requires current non-invalidated governance proof.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_signal_governed_binding_governance_contract ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_governed_binding_governance_contract BEFORE INSERT OR UPDATE
  ON signal_governed_view_bindings FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_governed_binding_governance_contract();

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_compilations(
  target_workspace_id uuid,
  target_reason_code text,
  target_object_kind text,
  target_object_identity text,
  target_mention_id uuid DEFAULT NULL,
  target_population_id uuid DEFAULT NULL,
  target_authority_id uuid DEFAULT NULL,
  target_data_source_id uuid DEFAULT NULL,
  target_usage_purposes text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer := 0;
BEGIN
  WITH candidates AS (
    SELECT compilation.id, compilation.population_id
    FROM signal_population_policy_compilations compilation
    WHERE compilation.workspace_id = target_workspace_id AND compilation.is_current
      AND (target_population_id IS NULL OR compilation.population_id = target_population_id)
      AND (target_mention_id IS NULL OR EXISTS (
        SELECT 1 FROM signal_data_governance_evaluation_items item
        WHERE item.evaluation_id = compilation.governance_evaluation_id
          AND item.mention_id = target_mention_id
      ))
      AND (target_authority_id IS NULL OR (
        (target_object_kind = 'quality-policy' AND compilation.quality_policy_id = target_authority_id)
        OR (target_object_kind = 'retention-policy' AND EXISTS (
          SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id = compilation.governance_evaluation_id
            AND item.retention_policy_id = target_authority_id))
        OR (target_object_kind = 'licensing-policy' AND EXISTS (
          SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id = compilation.governance_evaluation_id
            AND item.licensing_policy_id = target_authority_id))
        OR (target_object_kind = 'provenance-binding' AND EXISTS (
          SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id = compilation.governance_evaluation_id
            AND item.provenance_binding_id = target_authority_id))
      ))
      AND (target_data_source_id IS NULL OR EXISTS (
        SELECT 1
        FROM signal_data_governance_evaluation_items item
        JOIN signal_mention_import_memberships membership
          ON membership.id = item.import_membership_id
        WHERE item.evaluation_id = compilation.governance_evaluation_id
          AND membership.data_source_id = target_data_source_id
      ))
  ), inserted AS (
    INSERT INTO signal_data_governance_invalidations (
      workspace_id, policy_compilation_id, reason_code, object_kind,
      object_identity_hash, idempotency_key
    )
    SELECT target_workspace_id, candidate.id, target_reason_code, target_object_kind,
      'sha256:' || encode(sha256(convert_to(target_object_identity, 'UTF8')), 'hex'),
      'sha256:' || encode(sha256(convert_to(concat_ws(':', 'governance-invalidation-v1',
        candidate.id::text, target_reason_code, target_object_identity, txid_current()::text), 'UTF8')), 'hex')
    FROM candidates candidate
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, policy_compilation_id
  ), queued AS (
    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, population_id, data_watermark_id,
      source_key, idempotency_key, reason, affected_from, affected_through, scope
    )
    SELECT target_workspace_id, NULL, compilation.population_id, watermark.id,
      'data-governance-policy',
      'sha256:' || encode(sha256(convert_to(concat_ws(':',
        'data-governance-invalidation-v1', invalidation.id::text), 'UTF8')), 'hex'),
      target_reason_code, NULL, NULL,
      jsonb_build_object(
        'kind', 'governed_population',
        'population_id', compilation.population_id,
        'population_version', population.version,
        'population_definition_hash', population.definition_hash,
        'policy_compilation_id', compilation.id,
        'governance_invalidation_id', invalidation.id,
        'reason_code', target_reason_code,
        'object_kind', target_object_kind
      )
    FROM inserted invalidation
    JOIN signal_population_policy_compilations compilation
      ON compilation.id = invalidation.policy_compilation_id
    JOIN signal_population_definitions population
      ON population.id = compilation.population_id
    JOIN LATERAL (
      SELECT candidate.id
      FROM signal_data_watermarks candidate
      WHERE candidate.workspace_id = target_workspace_id
        AND candidate.study_corpus_id IS NULL
        AND candidate.population_id = compilation.population_id
      ORDER BY candidate.accepted_at DESC, candidate.id DESC
      LIMIT 1
    ) watermark ON true
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  ) SELECT count(*)::int INTO affected FROM inserted;

  UPDATE metric_materializations materialization
  SET materialization_state = CASE WHEN materialization.materialization_state = 'not_available'
      THEN 'not_available' ELSE 'stale' END,
      stale_after = LEAST(COALESCE(materialization.stale_after, now()), now())
  WHERE materialization.workspace_id = target_workspace_id
    AND materialization.population_id IN (
      SELECT compilation.population_id FROM signal_population_policy_compilations compilation
      JOIN signal_data_governance_invalidations invalidation
        ON invalidation.policy_compilation_id = compilation.id
      WHERE compilation.workspace_id = target_workspace_id
    );
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_from_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
DECLARE reason text;
DECLARE kind text;
DECLARE source_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD; ELSE target := NEW; END IF;
  IF TG_TABLE_NAME = 'signal_quality_policies' THEN kind := 'quality-policy'; reason := 'quality-policy-changed';
  ELSIF TG_TABLE_NAME = 'signal_retention_policies' THEN kind := 'retention-policy'; reason := 'retention-policy-changed';
  ELSIF TG_TABLE_NAME = 'signal_licensing_policies' THEN kind := 'licensing-policy'; reason := 'licensing-policy-changed';
  ELSE kind := 'provenance-binding'; reason := 'provenance-binding-changed'; source_id := target.data_source_id; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to THEN RETURN NEW; END IF;
  PERFORM invalidate_signal_data_governance_compilations(
    target.workspace_id, reason, kind, target.id::text, NULL, NULL,
    CASE WHEN kind = 'provenance-binding' THEN NULL ELSE target.id END,
    source_id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_signal_quality_policy_invalidate ON signal_quality_policies;
CREATE TRIGGER trg_signal_quality_policy_invalidate AFTER INSERT OR UPDATE OF status, effective_to
  ON signal_quality_policies FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_retention_policy_invalidate ON signal_retention_policies;
CREATE TRIGGER trg_signal_retention_policy_invalidate AFTER INSERT OR UPDATE OF status, effective_to
  ON signal_retention_policies FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_licensing_policy_invalidate ON signal_licensing_policies;
CREATE TRIGGER trg_signal_licensing_policy_invalidate AFTER INSERT OR UPDATE OF status, effective_to
  ON signal_licensing_policies FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_provenance_policy_binding_invalidate ON signal_provenance_policy_bindings;
CREATE TRIGGER trg_signal_provenance_policy_binding_invalidate AFTER INSERT OR UPDATE OF status, effective_to
  ON signal_provenance_policy_bindings FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_from_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_workspace uuid;
DECLARE mention_id uuid;
DECLARE population_id uuid;
DECLARE reason_code text;
DECLARE object_kind text;
DECLARE identity text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_workspace := OLD.workspace_id; ELSE target_workspace := NEW.workspace_id; END IF;
  IF TG_TABLE_NAME = 'mentions' THEN
    mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.canonical_mention_id ELSE NEW.canonical_mention_id END;
    reason_code := CASE WHEN NEW.canonical_mention_id IS DISTINCT FROM OLD.canonical_mention_id
      THEN 'canonical-identity-changed' ELSE 'quality-state-changed' END;
    object_kind := 'mention'; identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_mention_attributions' THEN
    mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END; reason_code := 'semantic-assertion-changed';
    object_kind := 'attribution'; identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_mention_import_memberships' THEN
    mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END; reason_code := 'provenance-changed';
    object_kind := 'membership'; identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_population_memberships' THEN
    mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    population_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.population_id ELSE NEW.population_id END;
    reason_code := 'population-membership-changed'; object_kind := 'membership';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSE
    reason_code := 'watermark-changed'; object_kind := 'watermark';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  END IF;
  PERFORM invalidate_signal_data_governance_compilations(
    workspace_id, reason_code, object_kind, identity, mention_id, population_id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_signal_data_governance_mentions_invalidate ON mentions;
CREATE TRIGGER trg_signal_data_governance_mentions_invalidate
  AFTER UPDATE OF quality_score, quality_flags, canonical_mention_id ON mentions
  FOR EACH ROW WHEN (
    OLD.quality_score IS DISTINCT FROM NEW.quality_score
    OR OLD.quality_flags IS DISTINCT FROM NEW.quality_flags
    OR OLD.canonical_mention_id IS DISTINCT FROM NEW.canonical_mention_id
  ) EXECUTE FUNCTION invalidate_signal_data_governance_from_row();
DROP TRIGGER IF EXISTS trg_signal_data_governance_attributions_invalidate ON signal_mention_attributions;
CREATE TRIGGER trg_signal_data_governance_attributions_invalidate
  AFTER INSERT OR DELETE OR UPDATE OF attribution_basis, is_current, review_status,
    eligibility_status, scope, entity_type, entity_id ON signal_mention_attributions
  FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_row();
DROP TRIGGER IF EXISTS trg_signal_data_governance_provenance_invalidate ON signal_mention_import_memberships;
CREATE TRIGGER trg_signal_data_governance_provenance_invalidate
  AFTER INSERT OR DELETE OR UPDATE ON signal_mention_import_memberships
  FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_row();
DROP TRIGGER IF EXISTS trg_signal_data_governance_membership_invalidate ON signal_population_memberships;
CREATE TRIGGER trg_signal_data_governance_membership_invalidate
  AFTER INSERT OR DELETE OR UPDATE OF membership_status, removed_at ON signal_population_memberships
  FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_row();
DROP TRIGGER IF EXISTS trg_signal_data_governance_watermark_invalidate ON signal_data_watermarks;
CREATE TRIGGER trg_signal_data_governance_watermark_invalidate
  AFTER INSERT OR UPDATE OF accepted_at, max_observed_at, data_freshness_state ON signal_data_watermarks
  FOR EACH ROW EXECUTE FUNCTION invalidate_signal_data_governance_from_row();

CREATE OR REPLACE FUNCTION enforce_signal_data_governance_policy_event_contract()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Data governance event actor is not authorized for the workspace.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.object_kind = 'quality-policy' AND NOT EXISTS (
      SELECT 1 FROM signal_quality_policies object WHERE object.id = NEW.object_id AND object.workspace_id = NEW.workspace_id))
    OR (NEW.object_kind = 'retention-policy' AND NOT EXISTS (
      SELECT 1 FROM signal_retention_policies object WHERE object.id = NEW.object_id AND object.workspace_id = NEW.workspace_id))
    OR (NEW.object_kind = 'licensing-policy' AND NOT EXISTS (
      SELECT 1 FROM signal_licensing_policies object WHERE object.id = NEW.object_id AND object.workspace_id = NEW.workspace_id))
    OR (NEW.object_kind = 'provenance-binding' AND NOT EXISTS (
      SELECT 1 FROM signal_provenance_policy_bindings object WHERE object.id = NEW.object_id AND object.workspace_id = NEW.workspace_id)) THEN
    RAISE EXCEPTION 'Data governance event object does not belong to the workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_signal_data_governance_policy_event_contract
  ON signal_data_governance_policy_events;
CREATE TRIGGER trg_signal_data_governance_policy_event_contract BEFORE INSERT
  ON signal_data_governance_policy_events FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_data_governance_policy_event_contract();

CREATE OR REPLACE FUNCTION protect_signal_data_governance_invalidation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Data governance invalidations are append-only.' USING ERRCODE = '55000'; END; $$;
DROP TRIGGER IF EXISTS trg_signal_data_governance_invalidation_append_only
  ON signal_data_governance_invalidations;
CREATE TRIGGER trg_signal_data_governance_invalidation_append_only BEFORE UPDATE OR DELETE
  ON signal_data_governance_invalidations FOR EACH ROW
  EXECUTE FUNCTION protect_signal_data_governance_invalidation();

DROP TRIGGER IF EXISTS trg_signal_data_governance_policy_events_append_only
  ON signal_data_governance_policy_events;
CREATE TRIGGER trg_signal_data_governance_policy_events_append_only BEFORE UPDATE OR DELETE
  ON signal_data_governance_policy_events FOR EACH ROW
  EXECUTE FUNCTION protect_signal_data_governance_invalidation();

COMMENT ON TABLE signal_quality_policies IS
  'Versioned authority that evaluates observed canonical-root quality without rewriting the observation.';
COMMENT ON TABLE signal_retention_policies IS
  'Versioned, effective-dated retention authority; contains no implied legal duration.';
COMMENT ON TABLE signal_licensing_policies IS
  'Versioned licensing authority with closed usage decisions authored by an approved operator.';
COMMENT ON TABLE signal_provenance_policy_bindings IS
  'Effective-dated source/import authority binding. Exact import binding takes precedence over source binding.';
COMMENT ON TABLE signal_data_governance_evaluations IS
  'Immutable evaluation header proving quality and data-rights decisions for a candidate population.';
COMMENT ON TABLE signal_data_governance_evaluation_items IS
  'One canonical-root decision and selected provenance proof per governance evaluation.';
COMMENT ON TABLE signal_data_governance_invalidations IS
  'Append-only audit that invalidates an otherwise immutable governed policy compilation.';

-- ---------------------------------------------------------------------------
-- Backend 03 hardening: atomic writers, module-scoped use, temporal proof and
-- provenance-complete invalidation. 0068 intentionally remains unchanged.

ALTER TABLE signal_data_governance_evaluations
  ADD COLUMN IF NOT EXISTS module_key text NOT NULL DEFAULT 'brand-monitoring',
  ADD COLUMN IF NOT EXISTS view_key text NOT NULL DEFAULT 'brand',
  ADD COLUMN IF NOT EXISTS next_policy_transition_at timestamptz;

ALTER TABLE signal_data_governance_evaluations
  DROP CONSTRAINT IF EXISTS signal_data_governance_evaluation_module,
  ADD CONSTRAINT signal_data_governance_evaluation_module CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key = 'brand'
  ),
  DROP CONSTRAINT IF EXISTS signal_data_governance_evaluation_transition,
  ADD CONSTRAINT signal_data_governance_evaluation_transition CHECK (
    next_policy_transition_at IS NULL
    OR next_policy_transition_at > policy_evaluation_watermark
  );

ALTER TABLE signal_population_policy_compilations
  ADD COLUMN IF NOT EXISTS module_key text NOT NULL DEFAULT 'brand-monitoring',
  ADD COLUMN IF NOT EXISTS view_key text NOT NULL DEFAULT 'brand',
  ADD COLUMN IF NOT EXISTS next_policy_transition_at timestamptz,
  ADD COLUMN IF NOT EXISTS governance_data_watermark_id uuid
    REFERENCES signal_data_watermarks(id) ON DELETE RESTRICT;

ALTER TABLE signal_population_policy_compilations
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_module,
  ADD CONSTRAINT signal_population_policy_compilation_module CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key = 'brand'
  ),
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_transition,
  ADD CONSTRAINT signal_population_policy_compilation_transition CHECK (
    next_policy_transition_at IS NULL
    OR policy_evaluation_watermark IS NULL
    OR next_policy_transition_at > policy_evaluation_watermark
  );

DROP INDEX IF EXISTS uq_signal_population_policy_compilation_current;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_population_policy_compilation_current
  ON signal_population_policy_compilations (
    policy_bundle_id, population_id, module_key, view_key
  ) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_signal_population_policy_compilation_transition
  ON signal_population_policy_compilations (
    workspace_id, next_policy_transition_at, module_key, view_key
  ) WHERE is_current AND next_policy_transition_at IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_signal_data_governance_evaluation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE expected_usages text[];
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  expected_usages := CASE NEW.module_key
    WHEN 'brand-monitoring' THEN ARRAY['client-derived-metrics']::text[]
    WHEN 'mentions' THEN ARRAY['client-mention-list','client-text-or-excerpt']::text[]
    WHEN 'topics-narratives' THEN ARRAY['client-derived-metrics']::text[]
    ELSE ARRAY[]::text[]
  END;
  IF bundle.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status = 'retired'
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR NEW.usage_purposes IS DISTINCT FROM expected_usages
     OR NOT (NEW.usage_purposes <@ bundle.required_usage_purposes)
     OR bundle.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.evaluated_by_user_id)
     OR NOT EXISTS (
       SELECT 1 FROM signal_governed_view_population_derivations derivation
       WHERE derivation.workspace_id = NEW.workspace_id
         AND derivation.policy_bundle_id = NEW.policy_bundle_id
         AND derivation.resolved_population_id = NEW.population_id
         AND derivation.module_key = NEW.module_key
         AND derivation.view_key = NEW.view_key
         AND derivation.policy_definition_hash = bundle.definition_hash
     ) THEN
    RAISE EXCEPTION 'Governance evaluation requires an exact module/view population derivation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_signal_data_governance_evaluation_scope
  ON signal_data_governance_evaluations;
CREATE TRIGGER trg_00_signal_data_governance_evaluation_scope
  BEFORE INSERT ON signal_data_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_data_governance_evaluation_scope();

CREATE OR REPLACE FUNCTION signal_data_governance_next_transition(
  target_evaluation_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  WITH evaluation AS (
    SELECT * FROM signal_data_governance_evaluations WHERE id = target_evaluation_id
  ), candidate_sources AS (
    SELECT DISTINCT membership.data_source_id, membership.import_batch_id
    FROM evaluation
    JOIN signal_data_governance_evaluation_items item ON item.evaluation_id = evaluation.id
    JOIN mentions provenance
      ON provenance.workspace_id = evaluation.workspace_id
     AND provenance.canonical_mention_id = item.mention_id
    JOIN signal_mention_import_memberships membership
      ON membership.workspace_id = evaluation.workspace_id
     AND membership.mention_id = provenance.id
  ), boundaries AS (
    SELECT bundle.effective_from AS boundary FROM evaluation
      JOIN signal_population_policy_bundles bundle ON bundle.id = evaluation.policy_bundle_id
    UNION ALL SELECT bundle.effective_to FROM evaluation
      JOIN signal_population_policy_bundles bundle ON bundle.id = evaluation.policy_bundle_id
    UNION ALL SELECT quality.effective_from FROM evaluation
      JOIN signal_quality_policies quality ON quality.id = evaluation.quality_policy_id
    UNION ALL SELECT quality.effective_to FROM evaluation
      JOIN signal_quality_policies quality ON quality.id = evaluation.quality_policy_id
    UNION ALL
      SELECT binding.effective_from FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
    UNION ALL
      SELECT binding.effective_to FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
    UNION ALL
      SELECT retention.effective_from FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
      JOIN signal_retention_policies retention ON retention.id = binding.retention_policy_id
    UNION ALL
      SELECT retention.effective_to FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
      JOIN signal_retention_policies retention ON retention.id = binding.retention_policy_id
    UNION ALL
      SELECT retention.retain_until FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
      JOIN signal_retention_policies retention ON retention.id = binding.retention_policy_id
    UNION ALL
      SELECT licensing.effective_from FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
      JOIN signal_licensing_policies licensing ON licensing.id = binding.licensing_policy_id
    UNION ALL
      SELECT licensing.effective_to FROM evaluation
      JOIN candidate_sources source ON true
      JOIN signal_provenance_policy_bindings binding
        ON binding.workspace_id = evaluation.workspace_id
       AND binding.data_source_id = source.data_source_id
       AND (binding.import_batch_id IS NULL OR binding.import_batch_id = source.import_batch_id)
       AND binding.status = 'active'
      JOIN signal_licensing_policies licensing ON licensing.id = binding.licensing_policy_id
  )
  SELECT min(boundary)
  FROM boundaries, evaluation
  WHERE boundary > evaluation.policy_evaluation_watermark;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_data_governance_evaluation_temporal_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE expected_transition timestamptz;
BEGIN
  IF NEW.evaluation_status <> 'complete' THEN RETURN NEW; END IF;
  expected_transition := signal_data_governance_next_transition(NEW.id);
  IF NEW.next_policy_transition_at IS DISTINCT FROM expected_transition THEN
    RAISE EXCEPTION 'Governance evaluation next policy transition is not reproducible.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_signal_data_governance_evaluation_temporal_proof
  ON signal_data_governance_evaluations;
CREATE TRIGGER trg_00_signal_data_governance_evaluation_temporal_proof
  BEFORE UPDATE OF evaluation_status ON signal_data_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_data_governance_evaluation_temporal_proof();

CREATE OR REPLACE FUNCTION create_signal_quality_policy_draft(
  target_organization_id uuid, target_workspace_id uuid, target_actor_user_id uuid,
  target_policy_key text, target_policy_version integer, target_min_quality_score integer,
  target_required_flags text[], target_forbidden_flags text[], target_disposition text,
  target_definition_hash text, target_idempotency_key text,
  target_effective_from timestamptz DEFAULT now(), target_effective_to timestamptz DEFAULT NULL
)
RETURNS TABLE(object_id uuid, object_status text, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE existing signal_quality_policies%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'quality-draft', target_workspace_id::text, target_policy_key, target_policy_version::text), 0));
  SELECT * INTO existing FROM signal_quality_policies
    WHERE workspace_id = target_workspace_id AND creation_idempotency_key = target_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.definition_hash IS DISTINCT FROM target_definition_hash
       OR existing.policy_key IS DISTINCT FROM target_policy_key
       OR existing.policy_version IS DISTINCT FROM target_policy_version THEN
      RAISE EXCEPTION 'Quality policy idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, false;
    RETURN;
  END IF;
  INSERT INTO signal_quality_policies (
    organization_id, workspace_id, policy_key, policy_version, status,
    min_quality_score, required_quality_flags, forbidden_quality_flags,
    canonical_root_disposition, definition_hash, created_by_user_id,
    creation_idempotency_key, effective_from, effective_to
  ) VALUES (
    target_organization_id, target_workspace_id, target_policy_key, target_policy_version, 'draft',
    target_min_quality_score, target_required_flags, target_forbidden_flags,
    target_disposition, target_definition_hash, target_actor_user_id,
    target_idempotency_key, target_effective_from, target_effective_to
  ) RETURNING id, status INTO object_id, object_status;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION create_signal_retention_policy_draft(
  target_organization_id uuid, target_workspace_id uuid, target_actor_user_id uuid,
  target_policy_key text, target_policy_version integer, target_retention_state text,
  target_retention_mode text, target_retain_until timestamptz, target_expiry_action text,
  target_approval_evidence_hash text, target_definition_hash text,
  target_idempotency_key text, target_effective_from timestamptz DEFAULT now(),
  target_effective_to timestamptz DEFAULT NULL
)
RETURNS TABLE(object_id uuid, object_status text, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE existing signal_retention_policies%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'retention-draft', target_workspace_id::text, target_policy_key, target_policy_version::text), 0));
  SELECT * INTO existing FROM signal_retention_policies
    WHERE workspace_id = target_workspace_id AND creation_idempotency_key = target_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.definition_hash IS DISTINCT FROM target_definition_hash
       OR existing.policy_key IS DISTINCT FROM target_policy_key
       OR existing.policy_version IS DISTINCT FROM target_policy_version THEN
      RAISE EXCEPTION 'Retention policy idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, false;
    RETURN;
  END IF;
  INSERT INTO signal_retention_policies (
    organization_id, workspace_id, policy_key, policy_version, status,
    retention_state, retention_mode, retain_until, expiry_action,
    approval_evidence_hash, definition_hash, created_by_user_id,
    creation_idempotency_key, effective_from, effective_to
  ) VALUES (
    target_organization_id, target_workspace_id, target_policy_key, target_policy_version, 'draft',
    target_retention_state, target_retention_mode, target_retain_until, target_expiry_action,
    target_approval_evidence_hash, target_definition_hash, target_actor_user_id,
    target_idempotency_key, target_effective_from, target_effective_to
  ) RETURNING id, status INTO object_id, object_status;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION create_signal_licensing_policy_draft(
  target_organization_id uuid, target_workspace_id uuid, target_actor_user_id uuid,
  target_policy_key text, target_policy_version integer, target_approval_evidence_hash text,
  target_usage_purposes text[], target_usage_decisions text[],
  target_definition_hash text, target_idempotency_key text,
  target_effective_from timestamptz DEFAULT now(), target_effective_to timestamptz DEFAULT NULL
)
RETURNS TABLE(object_id uuid, object_status text, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE existing signal_licensing_policies%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'licensing-draft', target_workspace_id::text, target_policy_key, target_policy_version::text), 0));
  IF cardinality(target_usage_purposes) = 0
     OR cardinality(target_usage_purposes) IS DISTINCT FROM cardinality(target_usage_decisions)
     OR (SELECT count(DISTINCT purpose) FROM unnest(target_usage_purposes) purpose)
        IS DISTINCT FROM cardinality(target_usage_purposes) THEN
    RAISE EXCEPTION 'Licensing policy usages are empty, duplicated or misaligned.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM signal_licensing_policies
    WHERE workspace_id = target_workspace_id AND creation_idempotency_key = target_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.definition_hash IS DISTINCT FROM target_definition_hash
       OR existing.policy_key IS DISTINCT FROM target_policy_key
       OR existing.policy_version IS DISTINCT FROM target_policy_version
       OR existing.definition_hash IS DISTINCT FROM signal_licensing_policy_definition_hash(existing.id) THEN
      RAISE EXCEPTION 'Licensing policy idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, false;
    RETURN;
  END IF;
  INSERT INTO signal_licensing_policies (
    organization_id, workspace_id, policy_key, policy_version, status,
    approval_evidence_hash, definition_hash, created_by_user_id,
    creation_idempotency_key, effective_from, effective_to
  ) VALUES (
    target_organization_id, target_workspace_id, target_policy_key, target_policy_version, 'draft',
    target_approval_evidence_hash, target_definition_hash, target_actor_user_id,
    target_idempotency_key, target_effective_from, target_effective_to
  ) RETURNING id, status INTO object_id, object_status;
  INSERT INTO signal_licensing_policy_usages (
    workspace_id, licensing_policy_id, usage_purpose, decision
  ) SELECT target_workspace_id, object_id, usage.purpose, usage.decision
    FROM unnest(target_usage_purposes, target_usage_decisions) AS usage(purpose, decision)
    ORDER BY usage.purpose;
  IF signal_licensing_policy_definition_hash(object_id) IS DISTINCT FROM target_definition_hash THEN
    RAISE EXCEPTION 'Licensing policy definition hash does not match atomic usages.' USING ERRCODE = '23514';
  END IF;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION create_signal_provenance_policy_binding_draft(
  target_workspace_id uuid, target_actor_user_id uuid, target_data_source_id uuid,
  target_import_batch_id uuid, target_binding_version integer, target_quality_policy_id uuid,
  target_retention_policy_id uuid, target_licensing_policy_id uuid,
  target_definition_hash text, target_idempotency_key text,
  target_effective_from timestamptz DEFAULT now(), target_effective_to timestamptz DEFAULT NULL
)
RETURNS TABLE(object_id uuid, object_status text, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE existing signal_provenance_policy_bindings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'provenance-binding-draft', target_workspace_id::text, target_data_source_id::text,
    COALESCE(target_import_batch_id::text, 'source'), target_binding_version::text), 0));
  SELECT * INTO existing FROM signal_provenance_policy_bindings
    WHERE workspace_id = target_workspace_id AND creation_idempotency_key = target_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.definition_hash IS DISTINCT FROM target_definition_hash
       OR existing.data_source_id IS DISTINCT FROM target_data_source_id
       OR existing.import_batch_id IS DISTINCT FROM target_import_batch_id
       OR existing.binding_version IS DISTINCT FROM target_binding_version THEN
      RAISE EXCEPTION 'Provenance binding idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, false;
    RETURN;
  END IF;
  INSERT INTO signal_provenance_policy_bindings (
    workspace_id, data_source_id, import_batch_id, binding_version, status,
    quality_policy_id, retention_policy_id, licensing_policy_id,
    definition_hash, created_by_user_id, creation_idempotency_key,
    effective_from, effective_to
  ) VALUES (
    target_workspace_id, target_data_source_id, target_import_batch_id, target_binding_version, 'draft',
    target_quality_policy_id, target_retention_policy_id, target_licensing_policy_id,
    target_definition_hash, target_actor_user_id, target_idempotency_key,
    target_effective_from, target_effective_to
  ) RETURNING id, status INTO object_id, object_status;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION activate_signal_data_governance_object(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_object_kind text,
  target_object_id uuid,
  target_input_hash text,
  target_idempotency_key text
)
RETURNS TABLE(object_id uuid, activated boolean, replayed boolean)
LANGUAGE plpgsql
AS $$
DECLARE existing_event signal_data_governance_policy_events%ROWTYPE;
DECLARE target_policy_key text;
DECLARE target_source_id uuid;
DECLARE target_import_id uuid;
DECLARE target_status text;
DECLARE previous_id uuid;
DECLARE table_name text;
DECLARE retirement_key text;
BEGIN
  IF target_object_kind NOT IN (
    'quality-policy', 'retention-policy', 'licensing-policy', 'provenance-binding'
  ) THEN
    RAISE EXCEPTION 'Unsupported governance object kind.' USING ERRCODE = '22023';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id, target_actor_user_id) THEN
    RAISE EXCEPTION 'Governance activation actor is unauthorized.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'governance-activation-request', target_workspace_id::text, target_idempotency_key), 0));
  SELECT * INTO existing_event FROM signal_data_governance_policy_events
    WHERE workspace_id = target_workspace_id AND idempotency_key = target_idempotency_key;
  IF existing_event.id IS NOT NULL THEN
    IF existing_event.object_kind IS DISTINCT FROM target_object_kind
       OR existing_event.object_id IS DISTINCT FROM target_object_id
       OR existing_event.input_hash IS DISTINCT FROM target_input_hash THEN
      RAISE EXCEPTION 'Governance activation idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing_event.object_id, false, true;
    RETURN;
  END IF;

  table_name := CASE target_object_kind
    WHEN 'quality-policy' THEN 'signal_quality_policies'
    WHEN 'retention-policy' THEN 'signal_retention_policies'
    WHEN 'licensing-policy' THEN 'signal_licensing_policies'
    ELSE 'signal_provenance_policy_bindings'
  END;

  IF target_object_kind = 'provenance-binding' THEN
    SELECT binding.data_source_id, binding.import_batch_id, binding.status
      INTO target_source_id, target_import_id, target_status
    FROM signal_provenance_policy_bindings binding
    WHERE binding.id = target_object_id AND binding.workspace_id = target_workspace_id;
    IF target_source_id IS NULL OR target_status <> 'draft' THEN
      RAISE EXCEPTION 'Governance object is unavailable, cross-workspace or not draft.' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
      'governance-object', target_workspace_id::text, target_object_kind,
      target_source_id::text, COALESCE(target_import_id::text, 'source')), 0));
    SELECT binding.status INTO target_status
    FROM signal_provenance_policy_bindings binding
    WHERE binding.id = target_object_id AND binding.workspace_id = target_workspace_id
    FOR UPDATE;
    IF target_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Governance object changed while waiting for its activation lock.'
        USING ERRCODE = '23514';
    END IF;
    SELECT binding.id INTO previous_id
    FROM signal_provenance_policy_bindings binding
    WHERE binding.workspace_id = target_workspace_id
      AND binding.data_source_id = target_source_id
      AND binding.import_batch_id IS NOT DISTINCT FROM target_import_id
      AND binding.status = 'active'
    FOR UPDATE;
  ELSE
    EXECUTE format('SELECT policy_key, status FROM %I WHERE id=$1 AND workspace_id=$2', table_name)
      INTO target_policy_key, target_status USING target_object_id, target_workspace_id;
    IF target_policy_key IS NULL OR target_status <> 'draft' THEN
      RAISE EXCEPTION 'Governance object is unavailable, cross-workspace or not draft.' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
      'governance-object', target_workspace_id::text, target_object_kind, target_policy_key), 0));
    EXECUTE format(
      'SELECT status FROM %I WHERE id=$1 AND workspace_id=$2 FOR UPDATE', table_name
    ) INTO target_status USING target_object_id, target_workspace_id;
    IF target_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Governance object changed while waiting for its activation lock.'
        USING ERRCODE = '23514';
    END IF;
    EXECUTE format(
      'SELECT id FROM %I WHERE workspace_id=$1 AND policy_key=$2 AND status=''active'' FOR UPDATE',
      table_name
    ) INTO previous_id USING target_workspace_id, target_policy_key;
  END IF;

  IF previous_id IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I SET status=''retired'', effective_to=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1',
      table_name
    ) USING previous_id;
    retirement_key := 'sha256:' || encode(sha256(convert_to(concat_ws(':',
      target_idempotency_key, 'retire', previous_id::text), 'UTF8')), 'hex');
    INSERT INTO signal_data_governance_policy_events (
      workspace_id, object_kind, object_id, action, actor_user_id,
      input_hash, idempotency_key
    ) VALUES (
      target_workspace_id, target_object_kind, previous_id, 'retire', target_actor_user_id,
      target_input_hash, retirement_key
    );
  END IF;

  IF target_object_kind IN ('quality-policy', 'provenance-binding') THEN
    EXECUTE format(
      'UPDATE %I SET status=''active'', activated_by_user_id=$2, activated_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1',
      table_name
    ) USING target_object_id, target_actor_user_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET status=''active'', approved_by_user_id=$2, approved_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1',
      table_name
    ) USING target_object_id, target_actor_user_id;
  END IF;
  INSERT INTO signal_data_governance_policy_events (
    workspace_id, object_kind, object_id, action, actor_user_id,
    input_hash, idempotency_key
  ) VALUES (
    target_workspace_id, target_object_kind, target_object_id, 'activate',
    target_actor_user_id, target_input_hash, target_idempotency_key
  );
  RETURN QUERY SELECT target_object_id, true, false;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_compilation_temporal_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
BEGIN
  IF NEW.governance_evaluation_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations
    WHERE id = NEW.governance_evaluation_id;
  IF evaluation.id IS NULL
     OR evaluation.module_key IS DISTINCT FROM NEW.module_key
     OR evaluation.view_key IS DISTINCT FROM NEW.view_key
     OR evaluation.next_policy_transition_at IS DISTINCT FROM NEW.next_policy_transition_at
     OR (NEW.next_policy_transition_at IS NOT NULL
       AND NEW.next_policy_transition_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Policy compilation has stale or incompatible temporal governance proof.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.compilation_status = 'ready' AND NEW.governance_data_watermark_id IS NULL THEN
    RAISE EXCEPTION 'Ready client-safe compilation requires a durable population watermark.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.governance_data_watermark_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_data_watermarks watermark
    WHERE watermark.id = NEW.governance_data_watermark_id
      AND watermark.workspace_id = NEW.workspace_id
      AND watermark.population_id = NEW.population_id
  ) THEN
    RAISE EXCEPTION 'Compilation watermark is unavailable or cross-workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_signal_population_policy_compilation_temporal_proof
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_00_signal_population_policy_compilation_temporal_proof
  BEFORE INSERT ON signal_population_policy_compilations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_population_policy_compilation_temporal_proof();

CREATE OR REPLACE FUNCTION enforce_signal_governed_binding_governance_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.population_id IS NOT NULL AND (
    NEW.policy_compilation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM signal_data_governance_invalidations invalidation
      WHERE invalidation.policy_compilation_id = NEW.policy_compilation_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM signal_population_policy_compilations compilation
      JOIN signal_data_governance_evaluations evaluation
        ON evaluation.id = compilation.governance_evaluation_id
      WHERE compilation.id = NEW.policy_compilation_id
        AND compilation.workspace_id = NEW.workspace_id
        AND compilation.population_id = NEW.population_id
        AND compilation.policy_bundle_id = NEW.policy_bundle_id
        AND compilation.module_key = NEW.module_key
        AND compilation.view_key = NEW.view_key
        AND compilation.compilation_status = 'ready'
        AND compilation.is_current
        AND compilation.governance_data_watermark_id IS NOT NULL
        AND compilation.governance_digest IS NOT NULL
        AND compilation.next_policy_transition_at IS NOT DISTINCT FROM evaluation.next_policy_transition_at
        AND (compilation.next_policy_transition_at IS NULL
          OR compilation.next_policy_transition_at > clock_timestamp())
    )
  ) THEN
    RAISE EXCEPTION 'Governed binding requires current, durable and temporally valid governance proof.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_binding_governance_contract
  ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_governed_binding_governance_contract
  BEFORE INSERT OR UPDATE ON signal_governed_view_bindings
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_binding_governance_contract();

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_compilations(
  target_workspace_id uuid,
  target_reason_code text,
  target_object_kind text,
  target_object_identity text,
  target_mention_id uuid DEFAULT NULL,
  target_population_id uuid DEFAULT NULL,
  target_authority_id uuid DEFAULT NULL,
  target_data_source_id uuid DEFAULT NULL,
  target_usage_purposes text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer := 0;
BEGIN
  WITH candidates AS (
    SELECT compilation.id, compilation.population_id, compilation.governance_data_watermark_id
    FROM signal_population_policy_compilations compilation
    WHERE compilation.workspace_id = target_workspace_id
      AND compilation.is_current
      AND (target_population_id IS NULL OR compilation.population_id = target_population_id)
      AND (target_usage_purposes IS NULL
        OR compilation.usage_purposes && target_usage_purposes)
      AND (target_mention_id IS NULL OR EXISTS (
        SELECT 1 FROM signal_data_governance_evaluation_items item
        WHERE item.evaluation_id = compilation.governance_evaluation_id
          AND item.mention_id = COALESCE((
            SELECT mention.canonical_mention_id FROM mentions mention
            WHERE mention.id = target_mention_id AND mention.workspace_id = target_workspace_id
          ), target_mention_id)
      ))
      AND (
        target_authority_id IS NULL
        OR (target_object_kind = 'quality-policy'
          AND compilation.quality_policy_id = target_authority_id)
        OR (target_object_kind = 'retention-policy' AND EXISTS (
          SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id = compilation.governance_evaluation_id
            AND item.retention_policy_id = target_authority_id
        ))
        OR (target_object_kind = 'licensing-policy' AND EXISTS (
          SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id = compilation.governance_evaluation_id
            AND item.licensing_policy_id = target_authority_id
        ))
        OR (target_object_kind = 'provenance-binding' AND EXISTS (
          SELECT 1
          FROM signal_provenance_policy_bindings changed_binding
          JOIN signal_data_governance_evaluation_items item
            ON item.evaluation_id = compilation.governance_evaluation_id
          JOIN mentions provenance
            ON provenance.workspace_id = target_workspace_id
           AND provenance.canonical_mention_id = item.mention_id
          JOIN signal_mention_import_memberships membership
            ON membership.workspace_id = target_workspace_id
           AND membership.mention_id = provenance.id
           AND membership.data_source_id = changed_binding.data_source_id
           AND (changed_binding.import_batch_id IS NULL
             OR membership.import_batch_id = changed_binding.import_batch_id)
          WHERE changed_binding.id = target_authority_id
            AND changed_binding.workspace_id = target_workspace_id
        ))
      )
      AND (target_data_source_id IS NULL OR EXISTS (
        SELECT 1
        FROM signal_data_governance_evaluation_items item
        JOIN mentions provenance
          ON provenance.workspace_id = target_workspace_id
         AND provenance.canonical_mention_id = item.mention_id
        JOIN signal_mention_import_memberships membership
          ON membership.workspace_id = target_workspace_id
         AND membership.mention_id = provenance.id
        WHERE item.evaluation_id = compilation.governance_evaluation_id
          AND membership.data_source_id = target_data_source_id
      ))
  ), inserted AS (
    INSERT INTO signal_data_governance_invalidations (
      workspace_id, policy_compilation_id, reason_code, object_kind,
      object_identity_hash, idempotency_key
    )
    SELECT target_workspace_id, candidate.id, target_reason_code, target_object_kind,
      'sha256:' || encode(sha256(convert_to(target_object_identity, 'UTF8')), 'hex'),
      'sha256:' || encode(sha256(convert_to(concat_ws(':',
        'governance-invalidation-v2', candidate.id::text, target_reason_code,
        target_object_identity, txid_current()::text), 'UTF8')), 'hex')
    FROM candidates candidate
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, policy_compilation_id
  ), queued AS (
    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, population_id, data_watermark_id,
      source_key, idempotency_key, reason, affected_from, affected_through, scope
    )
    SELECT target_workspace_id, NULL, compilation.population_id,
      compilation.governance_data_watermark_id, 'data-governance-policy',
      'sha256:' || encode(sha256(convert_to(concat_ws(':',
        'data-governance-invalidation-v2', invalidation.id::text), 'UTF8')), 'hex'),
      target_reason_code, NULL, NULL,
      jsonb_build_object(
        'kind', 'governed_population',
        'population_id', compilation.population_id,
        'population_version', population.version,
        'population_definition_hash', population.definition_hash,
        'policy_compilation_id', compilation.id,
        'governance_invalidation_id', invalidation.id,
        'module_key', compilation.module_key,
        'view_key', compilation.view_key,
        'reason_code', target_reason_code,
        'object_kind', target_object_kind
      )
    FROM inserted invalidation
    JOIN signal_population_policy_compilations compilation
      ON compilation.id = invalidation.policy_compilation_id
    JOIN signal_population_definitions population
      ON population.id = compilation.population_id
    WHERE compilation.governance_data_watermark_id IS NOT NULL
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  ), materializations AS (
    UPDATE metric_materializations materialization
    SET materialization_state = CASE
          WHEN materialization.materialization_state = 'not_available' THEN 'not_available'
          ELSE 'stale'
        END,
        stale_after = LEAST(COALESCE(materialization.stale_after, now()), now())
    FROM inserted invalidation
    JOIN signal_population_policy_compilations compilation
      ON compilation.id = invalidation.policy_compilation_id
    WHERE materialization.workspace_id = target_workspace_id
      AND materialization.population_id = compilation.population_id
    RETURNING materialization.id
  )
  SELECT count(*)::int INTO affected FROM inserted;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_from_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target record;
DECLARE reason text;
DECLARE kind text;
DECLARE source_id uuid;
DECLARE authority_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD; ELSE target := NEW; END IF;
  IF TG_TABLE_NAME = 'signal_quality_policies' THEN
    kind := 'quality-policy'; reason := 'quality-policy-changed'; authority_id := target.id;
  ELSIF TG_TABLE_NAME = 'signal_retention_policies' THEN
    kind := 'retention-policy'; reason := 'retention-policy-changed'; authority_id := target.id;
  ELSIF TG_TABLE_NAME = 'signal_licensing_policies' THEN
    kind := 'licensing-policy'; reason := 'licensing-policy-changed'; authority_id := target.id;
  ELSE
    kind := 'provenance-binding'; reason := 'provenance-binding-changed';
    source_id := target.data_source_id; authority_id := target.id;
  END IF;
  IF TG_OP = 'INSERT' AND target.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from
     AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to THEN
    RETURN NEW;
  END IF;
  PERFORM invalidate_signal_data_governance_compilations(
    target.workspace_id, reason, kind, target.id::text, NULL, NULL,
    authority_id, source_id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_quality_policy_invalidate ON signal_quality_policies;
CREATE TRIGGER trg_signal_quality_policy_invalidate
  AFTER INSERT OR UPDATE OF status, effective_from, effective_to
  ON signal_quality_policies FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_retention_policy_invalidate ON signal_retention_policies;
CREATE TRIGGER trg_signal_retention_policy_invalidate
  AFTER INSERT OR UPDATE OF status, effective_from, effective_to, retain_until
  ON signal_retention_policies FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_licensing_policy_invalidate ON signal_licensing_policies;
CREATE TRIGGER trg_signal_licensing_policy_invalidate
  AFTER INSERT OR UPDATE OF status, effective_from, effective_to
  ON signal_licensing_policies FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();
DROP TRIGGER IF EXISTS trg_signal_provenance_policy_binding_invalidate
  ON signal_provenance_policy_bindings;
CREATE TRIGGER trg_signal_provenance_policy_binding_invalidate
  AFTER INSERT OR UPDATE OF status, effective_from, effective_to
  ON signal_provenance_policy_bindings FOR EACH ROW
  EXECUTE FUNCTION invalidate_signal_data_governance_from_authority();

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_from_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_workspace uuid;
DECLARE mention_id uuid;
DECLARE population_id uuid;
DECLARE reason_code text;
DECLARE object_kind text;
DECLARE identity text;
DECLARE row_mention_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target_workspace := OLD.workspace_id; ELSE target_workspace := NEW.workspace_id; END IF;
  IF TG_TABLE_NAME = 'mentions' THEN
    mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.canonical_mention_id ELSE NEW.canonical_mention_id END;
    reason_code := CASE WHEN TG_OP <> 'DELETE'
      AND NEW.canonical_mention_id IS DISTINCT FROM OLD.canonical_mention_id
      THEN 'canonical-identity-changed' ELSE 'quality-state-changed' END;
    object_kind := 'mention';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_mention_attributions' THEN
    row_mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    SELECT mention.canonical_mention_id INTO mention_id FROM mentions mention
      WHERE mention.id = row_mention_id AND mention.workspace_id = target_workspace;
    reason_code := 'semantic-assertion-changed'; object_kind := 'attribution';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_mention_import_memberships' THEN
    row_mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    SELECT mention.canonical_mention_id INTO mention_id FROM mentions mention
      WHERE mention.id = row_mention_id AND mention.workspace_id = target_workspace;
    reason_code := 'provenance-changed'; object_kind := 'membership';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME = 'signal_population_memberships' THEN
    row_mention_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    SELECT mention.canonical_mention_id INTO mention_id FROM mentions mention
      WHERE mention.id = row_mention_id AND mention.workspace_id = target_workspace;
    population_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.population_id ELSE NEW.population_id END;
    reason_code := 'population-membership-changed'; object_kind := 'membership';
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSE
    reason_code := 'watermark-changed'; object_kind := 'watermark';
    population_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.population_id ELSE NEW.population_id END;
    identity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  END IF;
  PERFORM invalidate_signal_data_governance_compilations(
    target_workspace, reason_code, object_kind, identity, mention_id, population_id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
