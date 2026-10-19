-- Gate D strategic consumption authority and durable execution foundation.
--
-- Forward-only and data-neutral. This migration creates no policy bundle,
-- derivation, compilation, binding, snapshot, analysis, reservation or job.
-- It does not promote a pointer or invoke a provider.

CREATE OR REPLACE FUNCTION signal_governed_view_required_usage_purposes_v1(
  target_module_key text,
  target_view_key text
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN target_module_key = 'brand-monitoring'
      AND target_view_key IN ('brand','competition','category','all-governed')
      THEN ARRAY['client-derived-metrics']::text[]
    WHEN target_module_key = 'mentions'
      AND target_view_key IN ('brand','competition','category','all-governed')
      THEN ARRAY['client-mention-list','client-text-or-excerpt']::text[]
    WHEN target_module_key = 'topics-narratives'
      AND target_view_key IN ('brand','competition','category','all-governed')
      THEN ARRAY['client-derived-metrics']::text[]
    WHEN target_module_key = 'triggers-barriers' AND target_view_key = 'strategic'
      THEN ARRAY['llm-processing','strategic-analysis']::text[]
    ELSE NULL::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION signal_governed_view_bundle_scopes_match_v1(
  target_policy_bundle_id uuid,
  target_view_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM signal_population_policy_bundles bundle
    WHERE bundle.id = target_policy_bundle_id
      AND CASE target_view_key
        WHEN 'brand' THEN cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes = ARRAY['primary_brand']::text[]
        WHEN 'competition' THEN cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes = ARRAY['competitor']::text[]
        WHEN 'category' THEN cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes = ARRAY['category']::text[]
        WHEN 'all-governed' THEN cardinality(bundle.allowed_scopes) > 0
          AND cardinality(bundle.allowed_scopes) = (
            SELECT count(DISTINCT scope)::int FROM unnest(bundle.allowed_scopes) scope
          )
          AND bundle.allowed_scopes <@ ARRAY[
            'primary_brand','competitor','category','reference'
          ]::text[]
        WHEN 'strategic' THEN cardinality(bundle.allowed_scopes) > 0
          AND cardinality(bundle.allowed_scopes) = (
            SELECT count(DISTINCT scope)::int FROM unnest(bundle.allowed_scopes) scope
          )
          AND bundle.allowed_scopes <@ ARRAY[
            'primary_brand','competitor','category','reference'
          ]::text[]
        ELSE false
      END
      AND NOT EXISTS (
        SELECT 1 FROM signal_population_policy_entities entity
        WHERE entity.policy_bundle_id = bundle.id
          AND (
            NOT (entity.scope = ANY(bundle.allowed_scopes))
            OR NOT signal_population_policy_entity_is_governed_v1(
              bundle.workspace_id, entity.scope, entity.entity_type, entity.entity_id
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(bundle.allowed_scopes) scope
        WHERE NOT EXISTS (
          SELECT 1 FROM signal_population_policy_entities entity
          WHERE entity.policy_bundle_id = bundle.id AND entity.scope = scope
        )
      )
  );
$$;

ALTER TABLE signal_governed_view_population_derivations
  DROP CONSTRAINT IF EXISTS signal_governed_view_population_derivation_identity,
  ADD CONSTRAINT signal_governed_view_population_derivation_identity CHECK (
    (module_key IN ('brand-monitoring','mentions','topics-narratives')
      AND view_key IN ('brand','competition','category','all-governed'))
    OR (module_key = 'triggers-barriers' AND view_key = 'strategic')
  );

ALTER TABLE signal_data_governance_evaluations
  DROP CONSTRAINT IF EXISTS signal_data_governance_evaluation_module,
  ADD CONSTRAINT signal_data_governance_evaluation_module CHECK (
    (module_key IN ('brand-monitoring','mentions','topics-narratives')
      AND view_key IN ('brand','competition','category','all-governed'))
    OR (module_key = 'triggers-barriers' AND view_key = 'strategic')
  );

ALTER TABLE signal_population_policy_compilations
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_module,
  ADD CONSTRAINT signal_population_policy_compilation_module CHECK (
    (module_key IN ('brand-monitoring','mentions','topics-narratives')
      AND view_key IN ('brand','competition','category','all-governed'))
    OR (module_key = 'triggers-barriers' AND view_key = 'strategic')
  );

-- A missing governance measurement is not an observed zero. Draft evaluations
-- and blocked/stale compilations persist NULL until a complete evaluation has
-- measured the unknown set. Ready state remains fail-closed on an exact zero.
ALTER TABLE signal_data_governance_evaluations
  ALTER COLUMN governance_unknown_count DROP DEFAULT,
  ALTER COLUMN governance_unknown_count DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS signal_data_governance_evaluation_counts,
  ADD CONSTRAINT signal_data_governance_evaluation_counts CHECK (
    candidate_root_count >= 0 AND authorized_root_count >= 0
    AND quality_blocked_count >= 0 AND retention_blocked_count >= 0
    AND licensing_blocked_count >= 0
    AND (governance_unknown_count IS NULL OR governance_unknown_count >= 0)
    AND authorized_root_count <= candidate_root_count
  );

ALTER TABLE signal_population_policy_compilations
  ALTER COLUMN governance_unknown_count DROP DEFAULT,
  ALTER COLUMN governance_unknown_count DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_governance_counts,
  ADD CONSTRAINT signal_population_policy_compilation_governance_counts CHECK (
    authorized_root_count >= 0 AND quality_blocked_count >= 0
    AND retention_blocked_count >= 0 AND licensing_blocked_count >= 0
    AND (governance_unknown_count IS NULL OR governance_unknown_count >= 0)
  );

CREATE OR REPLACE FUNCTION enforce_signal_governance_unknown_availability_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'signal_data_governance_evaluations' THEN
    IF NEW.evaluation_status = 'complete' AND NEW.governance_unknown_count IS NULL THEN
      RAISE EXCEPTION 'A complete governance evaluation must measure unknown roots.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.compilation_status = 'ready'
        AND NEW.governance_unknown_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'A ready policy compilation requires measured zero governance unknowns.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governance_unknown_evaluation_availability
  ON signal_data_governance_evaluations;
CREATE TRIGGER trg_signal_governance_unknown_evaluation_availability
  BEFORE INSERT OR UPDATE OF evaluation_status,governance_unknown_count
  ON signal_data_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governance_unknown_availability_v1();

DROP TRIGGER IF EXISTS trg_signal_governance_unknown_compilation_availability
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_signal_governance_unknown_compilation_availability
  BEFORE INSERT OR UPDATE OF compilation_status,governance_unknown_count
  ON signal_population_policy_compilations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governance_unknown_availability_v1();

-- Brand identity and workspace availability are registry authority for every
-- primary_brand policy, including all-governed bundles that contain it.
CREATE OR REPLACE FUNCTION invalidate_signal_governed_workspace_brand_registry_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.brand_id IS NOT NULL THEN
    PERFORM invalidate_signal_governed_entity_dependents_v1(
      'primary_brand','brand',OLD.brand_id,
      concat_ws(':','signal-workspace-brand',OLD.id::text,OLD.brand_id::text,
        OLD.status,NEW.status,txid_current()::text)
    );
  END IF;
  IF NEW.brand_id IS NOT NULL AND NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    PERFORM invalidate_signal_governed_entity_dependents_v1(
      'primary_brand','brand',NEW.brand_id,
      concat_ws(':','signal-workspace-brand',NEW.id::text,NEW.brand_id::text,
        OLD.status,NEW.status,txid_current()::text)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_workspace_brand_registry_invalidation
  ON signal_workspaces;
CREATE TRIGGER trg_signal_governed_workspace_brand_registry_invalidation
  AFTER UPDATE OF brand_id,status ON signal_workspaces
  FOR EACH ROW WHEN (
    OLD.brand_id IS DISTINCT FROM NEW.brand_id OR OLD.status IS DISTINCT FROM NEW.status
  ) EXECUTE FUNCTION invalidate_signal_governed_workspace_brand_registry_v1();

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_population_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE resolved signal_population_definitions%ROWTYPE;
DECLARE base_is_valid boolean;
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  SELECT * INTO resolved FROM signal_population_definitions WHERE id = NEW.resolved_population_id;
  base_is_valid := CASE
    WHEN NEW.module_key = 'triggers-barriers' AND NEW.view_key = 'strategic' THEN
      signal_governed_view_base_contract_is_valid_v1(
        NEW.workspace_id, 'brand', NEW.base_population_id
      )
    ELSE signal_governed_view_base_contract_is_valid_v1(
      NEW.workspace_id, NEW.view_key, NEW.base_population_id
    )
  END;
  IF bundle.id IS NULL OR resolved.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR resolved.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR bundle.status = 'retired'
     OR NOT signal_governed_view_pair_is_valid(NEW.module_key, NEW.view_key)
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, NEW.view_key)
     OR NOT base_is_valid
     OR resolved.status <> 'draft'
     OR (NEW.view_key = 'strategic' AND resolved.purpose <> 'analysis')
     OR (NEW.view_key <> 'strategic' AND resolved.purpose <> 'operational')
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

-- Strategic derivations use the existing relational derivation/population store.
-- The browser never calls this function and cannot choose any authority ID.
CREATE OR REPLACE FUNCTION ensure_signal_strategic_population_derivation_v1(
  target_workspace_id uuid,
  target_policy_bundle_id uuid,
  target_base_population_id uuid,
  target_policy_definition_hash text,
  target_compiled_plan_hash text,
  target_actor_user_id uuid
)
RETURNS TABLE (
  derivation_id uuid,
  resolved_population_id uuid,
  population_definition_hash text,
  created boolean
)
LANGUAGE plpgsql
AS $$
DECLARE persisted record;
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE population_key_value constant text := 'triggers-barriers-strategic-governed';
DECLARE population_version_value integer;
DECLARE population_hash_value text;
DECLARE empty_digest constant text :=
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
BEGIN
  IF target_policy_definition_hash !~ '^sha256:[0-9a-f]{64}$'
     OR target_compiled_plan_hash !~ '^sha256:[0-9a-f]{64}$'
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id, target_actor_user_id) THEN
    RAISE EXCEPTION 'Strategic derivation inputs or actor are invalid.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'strategic-governed-derivation', target_workspace_id::text,
    target_policy_bundle_id::text
  ), 0));
  SELECT * INTO bundle FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id
    AND candidate.workspace_id = target_workspace_id
    AND candidate.status <> 'retired';
  IF bundle.id IS NULL OR bundle.definition_hash IS DISTINCT FROM target_policy_definition_hash
     OR NOT ('triggers-barriers' = ANY(bundle.authorized_modules))
     OR bundle.visibility_class <> 'strategic-internal'
     OR bundle.required_usage_purposes IS DISTINCT FROM
       ARRAY['llm-processing','strategic-analysis']::text[]
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, 'strategic')
     OR NOT signal_governed_view_base_contract_is_valid_v1(
       target_workspace_id, 'brand', target_base_population_id
     ) THEN
    RAISE EXCEPTION 'Strategic policy authority is unavailable or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  SELECT derivation.id, derivation.resolved_population_id,
    population.definition_hash INTO persisted
  FROM signal_governed_view_population_derivations derivation
  JOIN signal_population_definitions population
    ON population.id = derivation.resolved_population_id
  WHERE derivation.workspace_id = target_workspace_id
    AND derivation.module_key = 'triggers-barriers'
    AND derivation.view_key = 'strategic'
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
      RAISE EXCEPTION 'Existing strategic derivation has incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT persisted.id, persisted.resolved_population_id,
      persisted.definition_hash, false;
    RETURN;
  END IF;
  IF bundle.status <> 'draft' THEN
    RAISE EXCEPTION 'A new strategic derivation requires a draft bundle.'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO population_version_value
  FROM signal_population_definitions
  WHERE workspace_id = target_workspace_id AND population_key = population_key_value;
  population_hash_value := 'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'signal-governed-view-resolved-population-v1', target_workspace_id::text,
    target_policy_bundle_id::text, target_base_population_id::text,
    'triggers-barriers', 'strategic', target_policy_definition_hash,
    target_compiled_plan_hash, population_key_value, population_version_value::text
  ), 'UTF8')), 'hex');
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, min_quality_score,
    period_start, period_end, definition_hash, policy_key, policy_version,
    timezone, membership_digest, created_by_user_id, definition
  ) VALUES (
    target_workspace_id, population_key_value, population_version_value,
    'analysis', 'draft', bundle.acceptance_status, bundle.allowed_scopes,
    bundle.min_quality_score, bundle.period_start, bundle.period_end,
    population_hash_value, bundle.policy_key, bundle.policy_version::text,
    bundle.timezone, empty_digest, target_actor_user_id,
    jsonb_build_object(
      'contract_version','signal-governed-view-resolved-population-v1',
      'module_key','triggers-barriers','view_key','strategic',
      'policy_bundle_id',target_policy_bundle_id::text,
      'base_population_id',target_base_population_id::text,
      'policy_definition_hash',target_policy_definition_hash,
      'compiled_plan_hash',target_compiled_plan_hash,
      'deduplication_policy','canonical-root','promotion_state','candidate_not_bound'
    )
  ) RETURNING id INTO resolved_population_id;
  INSERT INTO signal_governed_view_population_derivations (
    workspace_id,module_key,view_key,policy_bundle_id,base_population_id,
    resolved_population_id,policy_definition_hash,compiled_plan_hash,created_by_user_id
  ) VALUES (
    target_workspace_id,'triggers-barriers','strategic',target_policy_bundle_id,
    target_base_population_id,resolved_population_id,target_policy_definition_hash,
    target_compiled_plan_hash,target_actor_user_id
  ) RETURNING id INTO derivation_id;
  population_definition_hash := population_hash_value;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_strategic_compilation_authority_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE included_count integer;
BEGIN
  IF NEW.module_key <> 'triggers-barriers' OR NEW.view_key <> 'strategic' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations
    WHERE id = NEW.governance_evaluation_id;
  SELECT * INTO population FROM signal_population_definitions WHERE id = NEW.population_id;
  SELECT count(*)::int INTO included_count FROM signal_population_memberships membership
  WHERE membership.population_id = NEW.population_id
    AND membership.workspace_id = NEW.workspace_id
    AND membership.membership_status = 'included' AND membership.removed_at IS NULL;
  IF bundle.id IS NULL OR evaluation.id IS NULL OR population.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status <> 'active' OR bundle.visibility_class <> 'strategic-internal'
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR bundle.required_usage_purposes IS DISTINCT FROM
       ARRAY['llm-processing','strategic-analysis']::text[]
     OR NEW.usage_purposes IS DISTINCT FROM
       ARRAY['llm-processing','strategic-analysis']::text[]
     OR NEW.compilation_status <> 'ready' OR NEW.is_current IS NOT TRUE
     OR NEW.governance_unknown_count IS DISTINCT FROM 0
     OR NEW.next_policy_transition_at IS NOT NULL
        AND NEW.next_policy_transition_at <= clock_timestamp()
     OR evaluation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR evaluation.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR evaluation.population_id IS DISTINCT FROM NEW.population_id
     OR evaluation.module_key <> 'triggers-barriers' OR evaluation.view_key <> 'strategic'
     OR evaluation.evaluation_status <> 'complete'
     OR evaluation.usage_purposes IS DISTINCT FROM NEW.usage_purposes
     OR evaluation.governance_unknown_count IS DISTINCT FROM 0
     OR evaluation.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR evaluation.retention_policy_digest IS DISTINCT FROM NEW.retention_policy_digest
     OR evaluation.licensing_policy_digest IS DISTINCT FROM NEW.licensing_policy_digest
     OR evaluation.authorized_root_count IS DISTINCT FROM NEW.authorized_root_count
     OR population.membership_digest IS DISTINCT FROM NEW.membership_digest
     OR included_count IS DISTINCT FROM NEW.authorized_root_count
     OR NOT EXISTS (
       SELECT 1 FROM signal_governed_view_population_derivations derivation
       WHERE derivation.workspace_id = NEW.workspace_id
         AND derivation.module_key = 'triggers-barriers'
         AND derivation.view_key = 'strategic'
         AND derivation.policy_bundle_id = NEW.policy_bundle_id
         AND derivation.resolved_population_id = NEW.population_id
         AND derivation.policy_definition_hash = NEW.policy_definition_hash
         AND derivation.compiled_plan_hash = NEW.compiled_plan_hash
     )
     OR EXISTS (
       SELECT 1 FROM signal_population_memberships membership
       WHERE membership.population_id = NEW.population_id
         AND membership.membership_status = 'included' AND membership.removed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM signal_data_governance_evaluation_items item
           WHERE item.evaluation_id = evaluation.id
             AND item.mention_id = membership.mention_id
             AND item.decision = 'included' AND item.reason_code = 'policy_eligible'
         )
     ) THEN
    RAISE EXCEPTION 'Strategic compilation lacks exact governed authority.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_compilation_authority_v1
  ON signal_population_policy_compilations;
CREATE TRIGGER trg_signal_strategic_compilation_authority_v1
  BEFORE INSERT OR UPDATE ON signal_population_policy_compilations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_compilation_authority_v1();

CREATE OR REPLACE FUNCTION enforce_signal_strategic_binding_compilation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.module_key = 'triggers-barriers' AND NEW.view_key = 'strategic'
     AND NOT EXISTS (
       SELECT 1 FROM signal_population_policy_compilations compilation
       WHERE compilation.id = NEW.policy_compilation_id
         AND compilation.workspace_id = NEW.workspace_id
         AND compilation.policy_bundle_id = NEW.policy_bundle_id
         AND compilation.population_id = NEW.population_id
         AND compilation.module_key = NEW.module_key
         AND compilation.view_key = NEW.view_key
         AND compilation.compilation_status = 'ready'
         AND compilation.is_current
         AND compilation.governance_unknown_count = 0
         AND compilation.usage_purposes = ARRAY[
           'llm-processing','strategic-analysis'
         ]::text[]
         AND (compilation.next_policy_transition_at IS NULL
           OR compilation.next_policy_transition_at > NEW.effective_from)
     ) THEN
    RAISE EXCEPTION 'Strategic binding lacks its exact current governed compilation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_binding_compilation_v1
  ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_strategic_binding_compilation_v1
  BEFORE INSERT OR UPDATE ON signal_governed_view_bindings
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_binding_compilation_v1();

ALTER TABLE corpus_snapshots
  ADD COLUMN IF NOT EXISTS strategic_authority_version text,
  ADD COLUMN IF NOT EXISTS policy_bundle_id uuid
    REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS policy_compilation_id uuid
    REFERENCES signal_population_policy_compilations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS governance_evaluation_id uuid
    REFERENCES signal_data_governance_evaluations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS policy_definition_hash text,
  ADD COLUMN IF NOT EXISTS compiled_plan_hash text,
  ADD COLUMN IF NOT EXISTS governance_digest text,
  ADD COLUMN IF NOT EXISTS provenance_digest text,
  ADD COLUMN IF NOT EXISTS usage_purposes text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE corpus_snapshots
  DROP CONSTRAINT IF EXISTS corpus_snapshots_strategic_authority_v2,
  ADD CONSTRAINT corpus_snapshots_strategic_authority_v2 CHECK (
    (strategic_authority_version IS NULL
      AND policy_bundle_id IS NULL AND policy_compilation_id IS NULL
      AND governance_evaluation_id IS NULL AND policy_definition_hash IS NULL
      AND compiled_plan_hash IS NULL AND governance_digest IS NULL
      AND provenance_digest IS NULL AND cardinality(usage_purposes) = 0)
    OR (
      strategic_authority_version = 'signal-strategic-snapshot-authority-v1'
      AND kind = 'analysis' AND workspace_id IS NOT NULL AND population_id IS NOT NULL
      AND policy_bundle_id IS NOT NULL AND policy_compilation_id IS NOT NULL
      AND governance_evaluation_id IS NOT NULL
      AND policy_definition_hash ~ '^sha256:[0-9a-f]{64}$'
      AND compiled_plan_hash ~ '^sha256:[0-9a-f]{64}$'
      AND governance_digest ~ '^sha256:[0-9a-f]{64}$'
      AND provenance_digest ~ '^sha256:[0-9a-f]{64}$'
      AND usage_purposes = ARRAY['llm-processing','strategic-analysis']::text[]
      AND scope_frozen_at IS NOT NULL
    )
  );

ALTER TABLE tb_analyses
  DROP CONSTRAINT IF EXISTS tb_analyses_strategic_identity,
  ADD CONSTRAINT tb_analyses_strategic_identity CHECK (
    strategic_contract_version IS NULL OR (
      strategic_contract_version IN ('signal-tb-strategic-v1','signal-tb-strategic-v2')
      AND workspace_id IS NOT NULL AND report_key IS NOT NULL
      AND population_id IS NOT NULL AND population_version >= 1
      AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
      AND NULLIF(btrim(timezone), '') IS NOT NULL
      AND run_idempotency_key ~ '^sha256:[0-9a-f]{64}$'
      AND snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
      AND scope_frozen_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_analyses_workspace_report_v2_idempotency
  ON tb_analyses (workspace_id, report_key, run_idempotency_key)
  WHERE strategic_contract_version = 'signal-tb-strategic-v2';

CREATE TABLE IF NOT EXISTS signal_strategic_run_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  report_key text NOT NULL DEFAULT 'triggers-barriers',
  tb_analysis_id uuid NOT NULL UNIQUE REFERENCES tb_analyses(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL UNIQUE REFERENCES corpus_snapshots(id) ON DELETE RESTRICT,
  binding_id uuid NOT NULL REFERENCES signal_governed_view_bindings(id) ON DELETE RESTRICT,
  policy_bundle_id uuid NOT NULL REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  policy_compilation_id uuid NOT NULL REFERENCES signal_population_policy_compilations(id) ON DELETE RESTRICT,
  governance_evaluation_id uuid NOT NULL REFERENCES signal_data_governance_evaluations(id) ON DELETE RESTRICT,
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  preflight_digest text NOT NULL,
  request_digest text NOT NULL,
  snapshot_authority_digest text NOT NULL,
  policy_definition_hash text NOT NULL,
  compiled_plan_hash text NOT NULL,
  membership_digest text NOT NULL,
  governance_digest text NOT NULL,
  provenance_digest text NOT NULL,
  watermark_hash text NOT NULL,
  authority_valid_until timestamptz,
  usage_purposes text[] NOT NULL,
  sample_algorithm text NOT NULL,
  sample_seed text NOT NULL,
  sample_count integer NOT NULL,
  sample_digest text NOT NULL,
  execution_plan_version text NOT NULL,
  execution_plan_digest text NOT NULL,
  execution_plan jsonb NOT NULL,
  planned_provider_calls integer NOT NULL,
  planned_input_tokens bigint NOT NULL,
  planned_output_tokens bigint NOT NULL,
  provider text NOT NULL,
  provider_config_digest text NOT NULL,
  model_version text NOT NULL,
  prompt_version text NOT NULL,
  pricing_version text NOT NULL,
  input_usd_per_million_tokens numeric(14,6) NOT NULL,
  output_usd_per_million_tokens numeric(14,6) NOT NULL,
  estimated_cost_usd numeric(14,6) NOT NULL,
  hard_cap_usd numeric(14,6) NOT NULL,
  reserved_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  actual_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  last_heartbeat_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_run_control_key UNIQUE (workspace_id, report_key, idempotency_key),
  CONSTRAINT signal_strategic_run_control_hashes CHECK (
    preflight_digest ~ '^sha256:[0-9a-f]{64}$'
    AND request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND snapshot_authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND policy_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    AND compiled_plan_hash ~ '^sha256:[0-9a-f]{64}$'
    AND membership_digest ~ '^sha256:[0-9a-f]{64}$'
    AND governance_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provenance_digest ~ '^sha256:[0-9a-f]{64}$'
    AND watermark_hash ~ '^sha256:[0-9a-f]{64}$'
    AND sample_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sample_seed ~ '^sha256:[0-9a-f]{64}$'
    AND execution_plan_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_config_digest ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_strategic_run_control_usage CHECK (
    usage_purposes = ARRAY['llm-processing','strategic-analysis']::text[]
  ),
  CONSTRAINT signal_strategic_run_control_authority_window CHECK (
    authority_valid_until IS NULL OR authority_valid_until > created_at
  ),
  CONSTRAINT signal_strategic_run_control_sample CHECK (
    sample_algorithm = 'canonical-root-sha256-rank-v1' AND sample_count > 0
  ),
  CONSTRAINT signal_strategic_run_control_execution_plan CHECK (
    execution_plan_version = 'signal-strategic-provider-budget-plan-v1'
    AND planned_provider_calls > 0
    AND planned_input_tokens >= 0 AND planned_output_tokens >= 0
    AND planned_input_tokens + planned_output_tokens > 0
    AND jsonb_typeof(execution_plan)='object'
    AND jsonb_typeof(execution_plan->'calls')='array'
  ),
  CONSTRAINT signal_strategic_run_control_provider CHECK (
    provider = 'anthropic' AND btrim(model_version) <> ''
    AND btrim(prompt_version) <> '' AND btrim(pricing_version) <> ''
    AND input_usd_per_million_tokens > 0 AND output_usd_per_million_tokens > 0
  ),
  CONSTRAINT signal_strategic_run_control_budget CHECK (
    estimated_cost_usd >= 0 AND hard_cap_usd > 0
    AND estimated_cost_usd <= hard_cap_usd
    AND reserved_cost_usd >= 0 AND actual_cost_usd >= 0
    AND reserved_cost_usd <= hard_cap_usd AND actual_cost_usd <= hard_cap_usd
  ),
  CONSTRAINT signal_strategic_run_control_status CHECK (
    status IN ('queued','running','needs_review','completed','failed','cancel_requested','cancelled')
  ),
  CONSTRAINT signal_strategic_run_control_cancel CHECK (
    (status = 'cancelled' AND cancel_requested_at IS NOT NULL AND cancelled_at IS NOT NULL)
    OR (status <> 'cancelled' AND cancelled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_strategic_run_controls_workspace
  ON signal_strategic_run_controls (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_strategic_run_controls_recovery
  ON signal_strategic_run_controls (last_heartbeat_at, created_at, id)
  WHERE status IN ('queued','running','cancel_requested');

CREATE OR REPLACE FUNCTION enforce_signal_strategic_run_control_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE analysis tb_analyses%ROWTYPE;
DECLARE snapshot corpus_snapshots%ROWTYPE;
DECLARE compilation signal_population_policy_compilations%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE binding signal_governed_view_bindings%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE expected_authority_valid_until timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NOT (
      (OLD.status='queued' AND NEW.status IN ('queued','running','cancel_requested','failed','cancelled'))
      OR (OLD.status='running' AND NEW.status IN (
        'running','needs_review','completed','failed','cancel_requested','cancelled'))
      OR (OLD.status='needs_review' AND NEW.status IN (
        'needs_review','completed','failed','cancel_requested','cancelled'))
      OR (OLD.status='cancel_requested' AND NEW.status IN ('cancel_requested','cancelled','failed'))
      OR (OLD.status IN ('completed','failed','cancelled') AND NEW.status=OLD.status)
    ) THEN
      RAISE EXCEPTION 'Strategic run status transition is invalid.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO analysis FROM tb_analyses WHERE id=NEW.tb_analysis_id;
  SELECT * INTO snapshot FROM corpus_snapshots WHERE id=NEW.snapshot_id;
  SELECT * INTO compilation FROM signal_population_policy_compilations
    WHERE id=NEW.policy_compilation_id;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations
    WHERE id=NEW.governance_evaluation_id;
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id=NEW.policy_bundle_id;
  SELECT * INTO binding FROM signal_governed_view_bindings WHERE id=NEW.binding_id;
  SELECT * INTO population FROM signal_population_definitions WHERE id=NEW.population_id;
  expected_authority_valid_until := LEAST(
    binding.effective_to,
    bundle.effective_to,
    compilation.next_policy_transition_at
  );
  IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
     OR analysis.id IS NULL OR snapshot.id IS NULL OR binding.id IS NULL
     OR compilation.id IS NULL
     OR evaluation.id IS NULL OR bundle.id IS NULL OR population.id IS NULL
     OR analysis.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR analysis.strategic_contract_version <> 'signal-tb-strategic-v2'
     OR analysis.snapshot_id IS DISTINCT FROM NEW.snapshot_id
     OR analysis.population_id IS DISTINCT FROM NEW.population_id
     OR analysis.model_version IS DISTINCT FROM NEW.model_version
     OR analysis.prompt_version IS DISTINCT FROM NEW.prompt_version
     OR snapshot.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR snapshot.population_id IS DISTINCT FROM NEW.population_id
     OR snapshot.strategic_authority_version <> 'signal-strategic-snapshot-authority-v1'
     OR snapshot.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR snapshot.policy_compilation_id IS DISTINCT FROM NEW.policy_compilation_id
     OR snapshot.governance_evaluation_id IS DISTINCT FROM NEW.governance_evaluation_id
     OR snapshot.policy_definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR snapshot.compiled_plan_hash IS DISTINCT FROM NEW.compiled_plan_hash
     OR snapshot.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR snapshot.provenance_digest IS DISTINCT FROM NEW.provenance_digest
     OR snapshot.source_watermark_digest IS DISTINCT FROM NEW.watermark_hash
     OR snapshot.usage_purposes IS DISTINCT FROM NEW.usage_purposes
     OR binding.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR binding.module_key <> 'triggers-barriers' OR binding.view_key <> 'strategic'
     OR binding.binding_status <> 'current'
     OR binding.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR binding.policy_compilation_id IS DISTINCT FROM NEW.policy_compilation_id
     OR binding.population_id IS DISTINCT FROM NEW.population_id
     OR binding.effective_from > NEW.created_at
     OR (binding.effective_to IS NOT NULL AND binding.effective_to <= NEW.created_at)
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.id IS DISTINCT FROM compilation.policy_bundle_id
     OR bundle.status <> 'active' OR bundle.visibility_class <> 'strategic-internal'
     OR bundle.effective_from > NEW.created_at
     OR (bundle.effective_to IS NOT NULL AND bundle.effective_to <= NEW.created_at)
     OR compilation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR compilation.population_id IS DISTINCT FROM NEW.population_id
     OR compilation.module_key <> 'triggers-barriers' OR compilation.view_key <> 'strategic'
     OR compilation.governance_evaluation_id IS DISTINCT FROM NEW.governance_evaluation_id
     OR compilation.compilation_status <> 'ready' OR NOT compilation.is_current
     OR compilation.policy_definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR compilation.compiled_plan_hash IS DISTINCT FROM NEW.compiled_plan_hash
     OR compilation.membership_digest IS DISTINCT FROM NEW.membership_digest
     OR compilation.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR compilation.source_watermark_hash IS DISTINCT FROM NEW.watermark_hash
     OR compilation.governance_unknown_count IS DISTINCT FROM 0
     OR compilation.usage_purposes IS DISTINCT FROM NEW.usage_purposes
     OR NEW.authority_valid_until IS DISTINCT FROM expected_authority_valid_until
     OR compilation.next_policy_transition_at IS NOT NULL
        AND compilation.next_policy_transition_at <= NEW.created_at
     OR evaluation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR evaluation.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR evaluation.population_id IS DISTINCT FROM NEW.population_id
     OR evaluation.evaluation_status <> 'complete'
     OR evaluation.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR evaluation.governance_unknown_count IS DISTINCT FROM 0
     OR population.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR population.membership_digest IS DISTINCT FROM NEW.membership_digest THEN
    RAISE EXCEPTION 'Strategic run control does not exactly match governed authority.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_run_control_v1
  ON signal_strategic_run_controls;
CREATE TRIGGER trg_signal_strategic_run_control_v1
  BEFORE INSERT OR UPDATE ON signal_strategic_run_controls
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_run_control_v1();

CREATE TABLE IF NOT EXISTS signal_strategic_sealed_sample_items (
  run_control_id uuid NOT NULL REFERENCES signal_strategic_run_controls(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES corpus_snapshots(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  rank_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_control_id, ordinal),
  CONSTRAINT uq_signal_strategic_sealed_sample_root UNIQUE (run_control_id, mention_id),
  CONSTRAINT signal_strategic_sealed_sample_ordinal CHECK (ordinal >= 1),
  CONSTRAINT signal_strategic_sealed_sample_rank CHECK (rank_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION enforce_signal_strategic_sealed_sample_item_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE expected_rank text;
BEGIN
  SELECT * INTO control FROM signal_strategic_run_controls WHERE id=NEW.run_control_id;
  expected_rank := 'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
    control.sample_algorithm,control.sample_seed,lower(NEW.mention_id::text)
  ),'UTF8')),'hex');
  IF NOT EXISTS (
    SELECT 1 FROM signal_strategic_run_controls active_control
    JOIN corpus_snapshot_mentions snapshot_membership
      ON snapshot_membership.snapshot_id=active_control.snapshot_id
     AND snapshot_membership.mention_id=NEW.mention_id
    JOIN mentions mention ON mention.id=NEW.mention_id
    WHERE active_control.id=NEW.run_control_id
      AND active_control.workspace_id=NEW.workspace_id
      AND active_control.snapshot_id=NEW.snapshot_id
      AND mention.workspace_id=NEW.workspace_id
      AND mention.canonical_mention_id=mention.id
  ) OR NEW.rank_hash IS DISTINCT FROM expected_rank THEN
    RAISE EXCEPTION 'Strategic sample item is outside the governed canonical snapshot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_signal_strategic_sealed_sample_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_control_id uuid;
DECLARE expected_count integer;
DECLARE expected_digest text;
DECLARE observed_count integer;
DECLARE observed_digest text;
DECLARE expected_ids text;
DECLARE observed_ids text;
BEGIN
  IF TG_TABLE_NAME = 'signal_strategic_run_controls' THEN
    target_control_id := COALESCE(NEW.id,OLD.id);
  ELSE
    target_control_id := COALESCE(NEW.run_control_id,OLD.run_control_id);
  END IF;
  SELECT sample_count,sample_digest INTO expected_count,expected_digest
  FROM signal_strategic_run_controls WHERE id=target_control_id;
  SELECT count(*)::int,
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
      mention_id::text,',' ORDER BY ordinal
    ),''),'UTF8')),'hex'),
    COALESCE(string_agg(mention_id::text,',' ORDER BY ordinal),'')
  INTO observed_count,observed_digest,observed_ids
  FROM signal_strategic_sealed_sample_items WHERE run_control_id=target_control_id;
  SELECT COALESCE(string_agg(candidate.mention_id::text,',' ORDER BY candidate.rank_hash,candidate.mention_id),'')
  INTO expected_ids FROM (
    SELECT snapshot_membership.mention_id,
      'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
        active_control.sample_algorithm,active_control.sample_seed,
        lower(snapshot_membership.mention_id::text)
      ),'UTF8')),'hex') AS rank_hash
    FROM signal_strategic_run_controls active_control
    JOIN corpus_snapshot_mentions snapshot_membership
      ON snapshot_membership.snapshot_id=active_control.snapshot_id
    WHERE active_control.id=target_control_id
    ORDER BY rank_hash,snapshot_membership.mention_id
    LIMIT expected_count
  ) candidate;
  IF expected_count IS DISTINCT FROM observed_count
     OR expected_digest IS DISTINCT FROM observed_digest
     OR expected_ids IS DISTINCT FROM observed_ids THEN
    RAISE EXCEPTION 'Strategic sealed sample count or digest does not match its run authority.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_sealed_sample_item_v1
  ON signal_strategic_sealed_sample_items;
CREATE TRIGGER trg_signal_strategic_sealed_sample_item_v1
  BEFORE INSERT OR UPDATE ON signal_strategic_sealed_sample_items
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_sealed_sample_item_v1();
DROP TRIGGER IF EXISTS trg_signal_strategic_sealed_sample_complete_v1
  ON signal_strategic_sealed_sample_items;
CREATE CONSTRAINT TRIGGER trg_signal_strategic_sealed_sample_complete_v1
  AFTER INSERT OR UPDATE OR DELETE ON signal_strategic_sealed_sample_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_strategic_sealed_sample_v1();
DROP TRIGGER IF EXISTS trg_signal_strategic_run_control_sample_complete_v1
  ON signal_strategic_run_controls;
CREATE CONSTRAINT TRIGGER trg_signal_strategic_run_control_sample_complete_v1
  AFTER INSERT OR UPDATE OF sample_count,sample_digest ON signal_strategic_run_controls
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_strategic_sealed_sample_v1();

CREATE OR REPLACE FUNCTION protect_signal_strategic_run_authority_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.report_key IS DISTINCT FROM OLD.report_key
     OR NEW.tb_analysis_id IS DISTINCT FROM OLD.tb_analysis_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.binding_id IS DISTINCT FROM OLD.binding_id
     OR NEW.policy_bundle_id IS DISTINCT FROM OLD.policy_bundle_id
     OR NEW.policy_compilation_id IS DISTINCT FROM OLD.policy_compilation_id
     OR NEW.governance_evaluation_id IS DISTINCT FROM OLD.governance_evaluation_id
     OR NEW.population_id IS DISTINCT FROM OLD.population_id
     OR NEW.preflight_digest IS DISTINCT FROM OLD.preflight_digest
     OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
     OR NEW.snapshot_authority_digest IS DISTINCT FROM OLD.snapshot_authority_digest
     OR NEW.policy_definition_hash IS DISTINCT FROM OLD.policy_definition_hash
     OR NEW.compiled_plan_hash IS DISTINCT FROM OLD.compiled_plan_hash
     OR NEW.membership_digest IS DISTINCT FROM OLD.membership_digest
     OR NEW.governance_digest IS DISTINCT FROM OLD.governance_digest
     OR NEW.provenance_digest IS DISTINCT FROM OLD.provenance_digest
     OR NEW.watermark_hash IS DISTINCT FROM OLD.watermark_hash
     OR NEW.authority_valid_until IS DISTINCT FROM OLD.authority_valid_until
     OR NEW.usage_purposes IS DISTINCT FROM OLD.usage_purposes
     OR NEW.sample_algorithm IS DISTINCT FROM OLD.sample_algorithm
     OR NEW.sample_seed IS DISTINCT FROM OLD.sample_seed
     OR NEW.sample_count IS DISTINCT FROM OLD.sample_count
     OR NEW.sample_digest IS DISTINCT FROM OLD.sample_digest
     OR NEW.execution_plan_version IS DISTINCT FROM OLD.execution_plan_version
     OR NEW.execution_plan_digest IS DISTINCT FROM OLD.execution_plan_digest
     OR NEW.execution_plan IS DISTINCT FROM OLD.execution_plan
     OR NEW.planned_provider_calls IS DISTINCT FROM OLD.planned_provider_calls
     OR NEW.planned_input_tokens IS DISTINCT FROM OLD.planned_input_tokens
     OR NEW.planned_output_tokens IS DISTINCT FROM OLD.planned_output_tokens
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_config_digest IS DISTINCT FROM OLD.provider_config_digest
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
     OR NEW.pricing_version IS DISTINCT FROM OLD.pricing_version
     OR NEW.input_usd_per_million_tokens IS DISTINCT FROM OLD.input_usd_per_million_tokens
     OR NEW.output_usd_per_million_tokens IS DISTINCT FROM OLD.output_usd_per_million_tokens
     OR NEW.estimated_cost_usd IS DISTINCT FROM OLD.estimated_cost_usd
     OR NEW.hard_cap_usd IS DISTINCT FROM OLD.hard_cap_usd
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Strategic run authority is immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_signal_strategic_run_authority_v1
  ON signal_strategic_run_controls;
CREATE TRIGGER trg_protect_signal_strategic_run_authority_v1
  BEFORE UPDATE ON signal_strategic_run_controls
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_run_authority_v1();

CREATE OR REPLACE FUNCTION protect_signal_strategic_sealed_sample_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.run_control_id IS DISTINCT FROM OLD.run_control_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.mention_id IS DISTINCT FROM OLD.mention_id
     OR NEW.rank_hash IS DISTINCT FROM OLD.rank_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Strategic sealed sample is append-only.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_signal_strategic_sealed_sample_v1
  ON signal_strategic_sealed_sample_items;
CREATE TRIGGER trg_protect_signal_strategic_sealed_sample_v1
  BEFORE UPDATE OR DELETE ON signal_strategic_sealed_sample_items
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_sealed_sample_v1();

CREATE OR REPLACE FUNCTION assert_signal_strategic_runtime_authority_v1(
  target_run_control_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE binding signal_governed_view_bindings%ROWTYPE;
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE compilation signal_population_policy_compilations%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE invalidation_count integer;
BEGIN
  SELECT * INTO control FROM signal_strategic_run_controls
  WHERE id=target_run_control_id FOR SHARE;
  SELECT * INTO binding FROM signal_governed_view_bindings WHERE id=control.binding_id FOR SHARE;
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id=control.policy_bundle_id FOR SHARE;
  SELECT * INTO compilation FROM signal_population_policy_compilations
    WHERE id=control.policy_compilation_id FOR SHARE;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations
    WHERE id=control.governance_evaluation_id FOR SHARE;
  SELECT * INTO population FROM signal_population_definitions
    WHERE id=control.population_id FOR SHARE;
  SELECT count(*)::int INTO invalidation_count
  FROM signal_data_governance_invalidations invalidation
  WHERE invalidation.policy_compilation_id=control.policy_compilation_id;
  IF control.id IS NULL OR control.status NOT IN ('queued','running')
     OR control.cancel_requested_at IS NOT NULL
     OR (control.authority_valid_until IS NOT NULL
       AND control.authority_valid_until <= clock_timestamp())
     OR invalidation_count <> 0
     OR binding.id IS NULL OR binding.workspace_id IS DISTINCT FROM control.workspace_id
     OR binding.binding_status<>'current' OR binding.module_key<>'triggers-barriers'
     OR binding.view_key<>'strategic' OR binding.policy_bundle_id IS DISTINCT FROM bundle.id
     OR binding.policy_compilation_id IS DISTINCT FROM compilation.id
     OR binding.population_id IS DISTINCT FROM population.id
     OR binding.effective_from>clock_timestamp()
     OR (binding.effective_to IS NOT NULL AND binding.effective_to<=clock_timestamp())
     OR bundle.id IS NULL OR bundle.workspace_id IS DISTINCT FROM control.workspace_id
     OR bundle.status<>'active' OR bundle.effective_from>clock_timestamp()
     OR (bundle.effective_to IS NOT NULL AND bundle.effective_to<=clock_timestamp())
     OR compilation.id IS NULL OR compilation.workspace_id IS DISTINCT FROM control.workspace_id
     OR compilation.compilation_status<>'ready' OR NOT compilation.is_current
     OR compilation.governance_unknown_count IS DISTINCT FROM 0
     OR compilation.policy_definition_hash IS DISTINCT FROM control.policy_definition_hash
     OR compilation.compiled_plan_hash IS DISTINCT FROM control.compiled_plan_hash
     OR compilation.membership_digest IS DISTINCT FROM control.membership_digest
     OR compilation.governance_digest IS DISTINCT FROM control.governance_digest
     OR compilation.source_watermark_hash IS DISTINCT FROM control.watermark_hash
     OR compilation.usage_purposes IS DISTINCT FROM control.usage_purposes
     OR evaluation.id IS NULL OR evaluation.evaluation_status<>'complete'
     OR evaluation.governance_unknown_count IS DISTINCT FROM 0
     OR evaluation.governance_digest IS DISTINCT FROM control.governance_digest
     OR population.id IS NULL OR population.workspace_id IS DISTINCT FROM control.workspace_id
     OR population.membership_digest IS DISTINCT FROM control.membership_digest THEN
    RAISE EXCEPTION 'Strategic governed runtime authority is unavailable.'
      USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
    'contract_version','signal-strategic-runtime-authority-v1',
    'run_control_id',control.id,'authority_valid_until',control.authority_valid_until,
    'status',control.status,'governance_unknown_count',0
  );
END;
$$;

CREATE TABLE IF NOT EXISTS signal_strategic_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_control_id uuid NOT NULL REFERENCES signal_strategic_run_controls(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  reservation_usd numeric(14,6) NOT NULL,
  reserved_input_tokens bigint,
  reserved_output_tokens bigint,
  input_tokens bigint,
  output_tokens bigint,
  actual_usd numeric(14,6),
  status text NOT NULL DEFAULT 'reserved',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT uq_signal_strategic_budget_reservation_key UNIQUE (run_control_id, idempotency_key),
  CONSTRAINT uq_signal_strategic_budget_reservation_operation UNIQUE (run_control_id, operation_key),
  CONSTRAINT signal_strategic_budget_reservation_operation CHECK (operation_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_strategic_budget_reservation_amount CHECK (
    reservation_usd > 0 AND (actual_usd IS NULL OR actual_usd >= 0)
    AND (reserved_input_tokens IS NULL OR reserved_input_tokens >= 0)
    AND (reserved_output_tokens IS NULL OR reserved_output_tokens >= 0)
    AND (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
  ),
  CONSTRAINT signal_strategic_budget_reservation_status CHECK (
    status IN ('reserved','settled','released','cancelled')
  ),
  CONSTRAINT signal_strategic_budget_reservation_key CHECK (idempotency_key ~ '^sha256:[0-9a-f]{64}$')
);

-- Keep the logical paid-operation fence recoverable if a prior attempt stopped after
-- creating the table but before all constraints were installed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_strategic_budget_reservation_operation
  ON signal_strategic_budget_reservations (run_control_id, operation_key);

ALTER TABLE signal_strategic_budget_reservations
  ADD COLUMN IF NOT EXISTS reserved_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS reserved_output_tokens bigint;

CREATE OR REPLACE FUNCTION enforce_signal_strategic_budget_reservation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE other_total numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:'||NEW.run_control_id::text,0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
    WHERE id=NEW.run_control_id FOR UPDATE;
  SELECT COALESCE(sum(CASE WHEN reservation.status='settled'
      THEN reservation.actual_usd ELSE reservation.reservation_usd END),0) INTO other_total
  FROM signal_strategic_budget_reservations reservation
  WHERE reservation.run_control_id=NEW.run_control_id
    AND reservation.id IS DISTINCT FROM NEW.id
    AND reservation.status IN ('reserved','settled');
  IF control.id IS NULL OR control.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR (NEW.status IN ('reserved','settled')
       AND other_total+CASE WHEN NEW.status='settled' THEN NEW.actual_usd
         ELSE NEW.reservation_usd END > control.hard_cap_usd) THEN
    RAISE EXCEPTION 'Strategic budget reservation is cross-workspace or exceeds hard cap.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_budget_reservation_v1
  ON signal_strategic_budget_reservations;
CREATE TRIGGER trg_signal_strategic_budget_reservation_v1
  BEFORE INSERT OR UPDATE ON signal_strategic_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_budget_reservation_v1();

CREATE OR REPLACE FUNCTION reserve_signal_strategic_budget_v1(
  target_run_control_id uuid,
  target_operation_key text,
  target_reservation_usd numeric,
  target_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE persisted signal_strategic_budget_reservations%ROWTYPE;
DECLARE reservation_id uuid;
DECLARE new_total numeric;
BEGIN
  IF target_operation_key !~ '^[a-z][a-z0-9-]*$'
     OR target_reservation_usd <= 0
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Strategic budget reservation input is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:' || target_run_control_id::text, 0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
    WHERE id = target_run_control_id FOR UPDATE;
  PERFORM assert_signal_strategic_runtime_authority_v1(target_run_control_id);
  SELECT * INTO persisted FROM signal_strategic_budget_reservations
    WHERE run_control_id = target_run_control_id
      AND (idempotency_key = target_idempotency_key OR operation_key=target_operation_key)
    FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.operation_key IS DISTINCT FROM target_operation_key
       OR persisted.idempotency_key IS DISTINCT FROM target_idempotency_key
       OR persisted.reservation_usd IS DISTINCT FROM target_reservation_usd THEN
      RAISE EXCEPTION 'Strategic budget idempotency key has incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN persisted.id;
  END IF;
  IF control.id IS NULL OR control.status NOT IN ('queued','running')
     OR control.cancel_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'Strategic run cannot reserve provider budget.' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_usd
      ELSE reservation_usd END), 0) + target_reservation_usd INTO new_total
  FROM signal_strategic_budget_reservations
  WHERE run_control_id = target_run_control_id AND status IN ('reserved','settled');
  IF new_total > control.hard_cap_usd THEN
    RAISE EXCEPTION 'Strategic hard budget cap would be exceeded.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO signal_strategic_budget_reservations (
    run_control_id,workspace_id,operation_key,reservation_usd,idempotency_key
  ) VALUES (
    control.id,control.workspace_id,target_operation_key,target_reservation_usd,target_idempotency_key
  ) RETURNING id INTO reservation_id;
  UPDATE signal_strategic_run_controls SET reserved_cost_usd = new_total, updated_at = now()
    WHERE id = control.id;
  RETURN reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION settle_signal_strategic_budget_v1(
  target_run_control_id uuid,
  target_idempotency_key text,
  target_input_tokens bigint,
  target_output_tokens bigint
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE persisted signal_strategic_budget_reservations%ROWTYPE;
DECLARE computed_actual numeric(14,6);
DECLARE total_actual numeric(14,6);
DECLARE total_committed numeric(14,6);
BEGIN
  IF target_input_tokens < 0 OR target_output_tokens < 0 THEN
    RAISE EXCEPTION 'Observed token counts must be non-negative.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:'||target_run_control_id::text,0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
  WHERE id=target_run_control_id FOR UPDATE;
  SELECT * INTO persisted FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND idempotency_key=target_idempotency_key
  FOR UPDATE;
  IF control.id IS NULL OR persisted.id IS NULL OR persisted.status NOT IN ('reserved','settled') THEN
    RAISE EXCEPTION 'Strategic budget reservation is unavailable for settlement.'
      USING ERRCODE='23514';
  END IF;
  computed_actual := round((
    target_input_tokens::numeric*control.input_usd_per_million_tokens/1000000
    +target_output_tokens::numeric*control.output_usd_per_million_tokens/1000000
  )::numeric,6);
  IF persisted.status='settled' THEN
    IF persisted.input_tokens IS DISTINCT FROM target_input_tokens
       OR persisted.output_tokens IS DISTINCT FROM target_output_tokens
       OR persisted.actual_usd IS DISTINCT FROM computed_actual THEN
      RAISE EXCEPTION 'Strategic budget settlement key has incompatible observed usage.'
        USING ERRCODE='23514';
    END IF;
    RETURN persisted.actual_usd;
  END IF;
  SELECT COALESCE(sum(CASE WHEN reservation.id=persisted.id THEN computed_actual
      ELSE reservation.actual_usd END),0)
  INTO total_actual
  FROM signal_strategic_budget_reservations reservation
  WHERE reservation.run_control_id=target_run_control_id
    AND (reservation.status='settled' OR reservation.id=persisted.id);
  IF computed_actual > persisted.reservation_usd OR total_actual > control.hard_cap_usd THEN
    RAISE EXCEPTION 'Observed provider cost exceeds its reservation or strategic hard cap.'
      USING ERRCODE='P0001';
  END IF;
  UPDATE signal_strategic_budget_reservations SET status='settled',
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,
    actual_usd=computed_actual,settled_at=clock_timestamp()
  WHERE id=persisted.id;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_usd
    ELSE reservation_usd END),0) INTO total_committed
  FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND status IN ('reserved','settled');
  UPDATE signal_strategic_run_controls SET actual_cost_usd=total_actual,
    reserved_cost_usd=total_committed,updated_at=now()
  WHERE id=control.id;
  RETURN computed_actual;
END;
$$;

CREATE OR REPLACE FUNCTION release_signal_strategic_budget_v1(
  target_run_control_id uuid,
  target_idempotency_key text,
  target_reason text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE persisted signal_strategic_budget_reservations%ROWTYPE;
DECLARE total_reserved numeric(14,6);
BEGIN
  IF NULLIF(btrim(target_reason),'') IS NULL THEN
    RAISE EXCEPTION 'A budget release reason is required.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:'||target_run_control_id::text,0
  ));
  SELECT * INTO persisted FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND idempotency_key=target_idempotency_key
  FOR UPDATE;
  IF persisted.id IS NULL THEN RETURN false; END IF;
  IF persisted.status='settled' THEN
    RAISE EXCEPTION 'A settled provider charge cannot be released.' USING ERRCODE='23514';
  END IF;
  IF persisted.status IN ('released','cancelled') THEN RETURN true; END IF;
  UPDATE signal_strategic_budget_reservations SET status='released',settled_at=clock_timestamp()
  WHERE id=persisted.id;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_usd
    ELSE reservation_usd END),0) INTO total_reserved
  FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND status IN ('reserved','settled');
  UPDATE signal_strategic_run_controls SET reserved_cost_usd=total_reserved,updated_at=now()
  WHERE id=target_run_control_id;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS signal_strategic_step_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_control_id uuid NOT NULL REFERENCES signal_strategic_run_controls(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  pipeline_step_id uuid NOT NULL UNIQUE REFERENCES tb_pipeline_steps(id) ON DELETE CASCADE,
  pipeline_step text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  dispatch_attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  bullmq_job_id text,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  lease_token uuid,
  dispatched_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_step_outbox_key UNIQUE (run_control_id, idempotency_key),
  CONSTRAINT uq_signal_strategic_step_outbox_attempt UNIQUE (run_control_id, pipeline_step, attempt),
  CONSTRAINT signal_strategic_step_outbox_step CHECK (pipeline_step IN (
    'preflight','step1_open_pass','step2_coding','step3_hierarchy',
    'step4_mobility','step5_comparative','step6_synthesis','quality_gates'
  )),
  CONSTRAINT signal_strategic_step_outbox_attempt_positive CHECK (attempt >= 1),
  CONSTRAINT signal_strategic_step_outbox_dispatch_attempt CHECK (dispatch_attempt >= 0),
  CONSTRAINT signal_strategic_step_outbox_status CHECK (
    status IN ('pending','dispatching','dispatched','running','completed','failed','dead_letter','cancelled')
  ),
  CONSTRAINT signal_strategic_step_outbox_key CHECK (idempotency_key ~ '^sha256:[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS signal_strategic_step_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES signal_strategic_step_outbox(id) ON DELETE RESTRICT,
  run_control_id uuid NOT NULL REFERENCES signal_strategic_run_controls(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  previous_status text,
  next_status text NOT NULL,
  transition_key text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_step_outbox_event UNIQUE (outbox_id,transition_key),
  CONSTRAINT signal_strategic_step_outbox_event_status CHECK (
    (previous_status IS NULL OR previous_status IN (
      'pending','dispatching','dispatched','running','completed','failed','dead_letter','cancelled'))
    AND next_status IN (
      'pending','dispatching','dispatched','running','completed','failed','dead_letter','cancelled')
  ),
  CONSTRAINT signal_strategic_step_outbox_event_key CHECK (transition_key ~ '^sha256:[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION protect_signal_strategic_step_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Strategic step events are append-only.' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_step_event_v1
  ON signal_strategic_step_outbox_events;
CREATE TRIGGER trg_protect_signal_strategic_step_event_v1
  BEFORE UPDATE OR DELETE ON signal_strategic_step_outbox_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_step_event_v1();

CREATE OR REPLACE FUNCTION enforce_signal_strategic_step_outbox_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.run_control_id IS DISTINCT FROM OLD.run_control_id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.tb_analysis_id IS DISTINCT FROM OLD.tb_analysis_id
       OR NEW.pipeline_step_id IS DISTINCT FROM OLD.pipeline_step_id
       OR NEW.pipeline_step IS DISTINCT FROM OLD.pipeline_step
       OR NEW.attempt IS DISTINCT FROM OLD.attempt
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Strategic step outbox identity is immutable.' USING ERRCODE='23514';
    END IF;
    IF NOT (
      (OLD.status='pending' AND NEW.status IN ('dispatching','cancelled'))
      OR (OLD.status='failed' AND NEW.status IN ('dispatching','cancelled','dead_letter'))
      OR (OLD.status='dispatching' AND NEW.status IN ('dispatched','failed','dead_letter','cancelled'))
      OR (OLD.status='dispatched' AND NEW.status IN ('running','cancelled'))
      OR (OLD.status='running' AND NEW.status IN ('running','completed','failed','dead_letter','cancelled'))
      OR (OLD.status=NEW.status)
    ) THEN
      RAISE EXCEPTION 'Strategic step outbox transition is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM signal_strategic_run_controls control
    JOIN tb_pipeline_steps step ON step.id=NEW.pipeline_step_id
    WHERE control.id=NEW.run_control_id
      AND control.workspace_id=NEW.workspace_id
      AND control.tb_analysis_id=NEW.tb_analysis_id
      AND step.tb_analysis_id=NEW.tb_analysis_id
      AND step.step=NEW.pipeline_step
      AND step.attempt=NEW.attempt
  ) THEN
    RAISE EXCEPTION 'Strategic step outbox is cross-workspace or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_strategic_step_outbox_v1
  ON signal_strategic_step_outbox;
CREATE TRIGGER trg_signal_strategic_step_outbox_v1
  BEFORE INSERT OR UPDATE ON signal_strategic_step_outbox
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_strategic_step_outbox_v1();

CREATE OR REPLACE FUNCTION protect_signal_strategic_step_outbox_delete_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Strategic step outbox is durable and cannot be deleted.' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_step_outbox_delete_v1
  ON signal_strategic_step_outbox;
CREATE TRIGGER trg_protect_signal_strategic_step_outbox_delete_v1
  BEFORE DELETE ON signal_strategic_step_outbox
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_step_outbox_delete_v1();

CREATE OR REPLACE FUNCTION audit_signal_strategic_step_outbox_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transition_key_value text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
  transition_key_value := 'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
    'signal-strategic-step-transition-v1',NEW.id::text,
    COALESCE(OLD.status,'∅'),NEW.status,NEW.dispatch_attempt::text,
    COALESCE(NEW.lease_token::text,'∅'),txid_current()::text
  ),'UTF8')),'hex');
  INSERT INTO signal_strategic_step_outbox_events (
    outbox_id,run_control_id,workspace_id,previous_status,next_status,transition_key,detail
  ) VALUES (
    NEW.id,NEW.run_control_id,NEW.workspace_id,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,transition_key_value,
    jsonb_build_object('dispatch_attempt',NEW.dispatch_attempt,'pipeline_step',NEW.pipeline_step)
  ) ON CONFLICT (outbox_id,transition_key) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_signal_strategic_step_outbox_v1
  ON signal_strategic_step_outbox;
CREATE TRIGGER trg_audit_signal_strategic_step_outbox_v1
  AFTER INSERT OR UPDATE OF status ON signal_strategic_step_outbox
  FOR EACH ROW EXECUTE FUNCTION audit_signal_strategic_step_outbox_v1();

CREATE OR REPLACE FUNCTION claim_signal_strategic_step_dispatch_v1(
  target_limit integer,
  target_lease_seconds integer,
  target_max_attempts integer
)
RETURNS TABLE (
  outbox_id uuid,run_control_id uuid,workspace_id uuid,tb_analysis_id uuid,
  pipeline_step_id uuid,pipeline_step text,dispatch_attempt integer,
  lease_token uuid,bullmq_job_id text
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
  IF target_limit NOT BETWEEN 1 AND 100 OR target_lease_seconds NOT BETWEEN 15 AND 600
     OR target_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Strategic step dispatch claim bounds are invalid.' USING ERRCODE='23514';
  END IF;
  UPDATE tb_pipeline_steps pipeline SET status='failed',completed_at=clock_timestamp(),
    error_message='Strategic dispatch lease exhausted.'
  FROM signal_strategic_step_outbox outbox
  WHERE pipeline.id=outbox.pipeline_step_id AND outbox.status='dispatching'
    AND outbox.lease_expires_at<=clock_timestamp()
    AND outbox.dispatch_attempt>=target_max_attempts;
  UPDATE signal_strategic_step_outbox outbox SET status='dead_letter',
    locked_at=NULL,lease_expires_at=NULL,lease_token=NULL,
    dead_lettered_at=clock_timestamp(),updated_at=clock_timestamp(),
    last_error=jsonb_build_object('code','dispatch-attempts-exhausted')
  WHERE outbox.status='dispatching' AND outbox.lease_expires_at<=clock_timestamp()
    AND outbox.dispatch_attempt>=target_max_attempts;
  UPDATE signal_strategic_run_controls control SET status='failed',updated_at=clock_timestamp()
  WHERE control.status IN ('queued','running') AND EXISTS (
    SELECT 1 FROM signal_strategic_step_outbox outbox
    WHERE outbox.run_control_id=control.id AND outbox.status='dead_letter'
      AND outbox.last_error->>'code'='dispatch-attempts-exhausted'
  );
  UPDATE signal_strategic_run_outbox run_outbox SET status='failed',
    completed_at=COALESCE(completed_at,clock_timestamp()),updated_at=clock_timestamp(),
    last_error=jsonb_build_object('code','dispatch-attempts-exhausted')
  WHERE run_outbox.status NOT IN ('completed','failed','cancelled','dead_letter') AND EXISTS (
    SELECT 1 FROM signal_strategic_step_outbox outbox
    WHERE outbox.tb_analysis_id=run_outbox.tb_analysis_id AND outbox.status='dead_letter'
      AND outbox.last_error->>'code'='dispatch-attempts-exhausted'
  );
  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM signal_strategic_step_outbox outbox
    JOIN signal_strategic_run_controls control ON control.id=outbox.run_control_id
    WHERE (
      outbox.status IN ('pending','failed') AND outbox.available_at<=clock_timestamp()
      OR outbox.status='dispatching' AND outbox.lease_expires_at<=clock_timestamp()
    )
      AND outbox.dispatch_attempt<target_max_attempts
      AND control.status IN ('queued','running') AND control.cancel_requested_at IS NULL
      AND (control.authority_valid_until IS NULL
        OR control.authority_valid_until>clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=control.policy_compilation_id)
    ORDER BY outbox.available_at,outbox.created_at,outbox.id
    FOR UPDATE OF outbox SKIP LOCKED LIMIT target_limit
  ), updated AS (
    UPDATE signal_strategic_step_outbox outbox SET status='dispatching',
      dispatch_attempt=outbox.dispatch_attempt+1,locked_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>target_lease_seconds),
      lease_token=gen_random_uuid(),
      bullmq_job_id=COALESCE(outbox.bullmq_job_id,
        'strategic-step-'||replace(outbox.idempotency_key,'sha256:','')),
      updated_at=clock_timestamp()
    FROM candidates WHERE outbox.id=candidates.id
    RETURNING outbox.*
  )
  SELECT updated.id,updated.run_control_id,updated.workspace_id,updated.tb_analysis_id,
    updated.pipeline_step_id,updated.pipeline_step,updated.dispatch_attempt,
    updated.lease_token,updated.bullmq_job_id FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION complete_signal_strategic_step_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid,target_bullmq_job_id text
)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_strategic_step_outbox SET status='dispatched',
    bullmq_job_id=target_bullmq_job_id,dispatched_at=COALESCE(dispatched_at,clock_timestamp()),
    locked_at=NULL,lease_expires_at=NULL,lease_token=NULL,last_error='{}'::jsonb,
    updated_at=clock_timestamp()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fail_signal_strategic_step_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid,target_retry_at timestamptz,
  target_error jsonb,target_max_attempts integer
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE current_attempt integer;
DECLARE target_analysis_id uuid;
DECLARE target_run_control_id uuid;
BEGIN
  SELECT dispatch_attempt,tb_analysis_id,run_control_id
  INTO current_attempt,target_analysis_id,target_run_control_id
  FROM signal_strategic_step_outbox
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token
  FOR UPDATE;
  IF current_attempt IS NULL THEN RETURN 'lease_lost'; END IF;
  UPDATE signal_strategic_step_outbox SET
    status=CASE WHEN current_attempt>=target_max_attempts THEN 'dead_letter' ELSE 'failed' END,
    available_at=target_retry_at,locked_at=NULL,lease_expires_at=NULL,lease_token=NULL,
    dead_lettered_at=CASE WHEN current_attempt>=target_max_attempts THEN clock_timestamp() ELSE NULL END,
    last_error=COALESCE(target_error,'{}'::jsonb),updated_at=clock_timestamp()
  WHERE id=target_outbox_id;
  UPDATE tb_pipeline_steps SET status='failed',completed_at=clock_timestamp(),
    error_message=COALESCE(target_error->>'message','Strategic dispatch failed')
  WHERE id=(SELECT pipeline_step_id FROM signal_strategic_step_outbox WHERE id=target_outbox_id);
  IF current_attempt>=target_max_attempts THEN
    UPDATE signal_strategic_run_controls SET status='failed',updated_at=clock_timestamp()
    WHERE id=target_run_control_id AND status IN ('queued','running');
    UPDATE signal_strategic_run_outbox SET status='failed',
      completed_at=COALESCE(completed_at,clock_timestamp()),
      last_error=COALESCE(target_error,'{}'::jsonb),updated_at=clock_timestamp()
    WHERE tb_analysis_id=target_analysis_id
      AND status NOT IN ('completed','failed','cancelled','dead_letter');
  END IF;
  RETURN CASE WHEN current_attempt>=target_max_attempts THEN 'dead_letter' ELSE 'failed' END;
END;
$$;

CREATE OR REPLACE FUNCTION claim_signal_strategic_step_v1(
  target_pipeline_step_id uuid,target_lease_token uuid,target_lease_seconds integer
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target_run_control_id uuid;
DECLARE target_analysis_id uuid;
BEGIN
  IF target_lease_token IS NULL OR target_lease_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'Strategic execution lease input is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT run_control_id,tb_analysis_id INTO target_run_control_id,target_analysis_id
  FROM signal_strategic_step_outbox
  WHERE pipeline_step_id=target_pipeline_step_id FOR UPDATE;
  PERFORM assert_signal_strategic_runtime_authority_v1(target_run_control_id);
  UPDATE signal_strategic_step_outbox SET status='running',locked_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>target_lease_seconds),
    lease_token=target_lease_token,updated_at=clock_timestamp()
  WHERE pipeline_step_id=target_pipeline_step_id AND (
    status='dispatched' OR (status='running' AND lease_expires_at<=clock_timestamp())
  );
  IF FOUND THEN
    UPDATE tb_pipeline_steps SET status='running',started_at=COALESCE(started_at,clock_timestamp()),
      completed_at=NULL,error_message=NULL,bullmq_job_id=COALESCE(bullmq_job_id,
        (SELECT bullmq_job_id FROM signal_strategic_step_outbox
         WHERE pipeline_step_id=target_pipeline_step_id))
    WHERE id=target_pipeline_step_id AND tb_analysis_id=target_analysis_id;
    UPDATE signal_strategic_run_controls SET status='running',
      last_heartbeat_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=target_run_control_id AND status IN ('queued','running');
    UPDATE signal_strategic_run_outbox SET status='running',updated_at=clock_timestamp()
    WHERE tb_analysis_id=target_analysis_id
      AND status IN ('pending','dispatching','dispatched','running');
    RETURN true;
  END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_signal_strategic_step_v1(
  target_pipeline_step_id uuid,target_lease_token uuid,target_lease_seconds integer
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target_run_control_id uuid;
BEGIN
  SELECT run_control_id INTO target_run_control_id FROM signal_strategic_step_outbox
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token FOR UPDATE;
  IF target_run_control_id IS NULL THEN RETURN false; END IF;
  PERFORM assert_signal_strategic_runtime_authority_v1(target_run_control_id);
  UPDATE signal_strategic_step_outbox SET lease_expires_at=clock_timestamp()
      +make_interval(secs=>target_lease_seconds),updated_at=clock_timestamp()
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token;
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS complete_signal_strategic_step_v1(uuid,uuid);
CREATE OR REPLACE FUNCTION complete_signal_strategic_step_v1(
  target_pipeline_step_id uuid,target_lease_token uuid,target_result_summary jsonb
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target_analysis_id uuid;
DECLARE target_run_control_id uuid;
DECLARE target_pipeline_step text;
BEGIN
  SELECT tb_analysis_id,run_control_id,pipeline_step
  INTO target_analysis_id,target_run_control_id,target_pipeline_step
  FROM signal_strategic_step_outbox
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token FOR UPDATE;
  IF target_analysis_id IS NULL THEN RETURN false; END IF;
  UPDATE signal_strategic_step_outbox SET status='completed',completed_at=clock_timestamp(),
    locked_at=NULL,lease_expires_at=NULL,lease_token=NULL,updated_at=clock_timestamp()
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token;
  UPDATE tb_pipeline_steps SET status='completed',completed_at=clock_timestamp(),
    result_summary=COALESCE(target_result_summary,'{}'::jsonb),error_message=NULL
  WHERE id=target_pipeline_step_id AND tb_analysis_id=target_analysis_id;
  IF target_pipeline_step='quality_gates' THEN
    UPDATE signal_strategic_run_controls SET status='needs_review',updated_at=clock_timestamp()
    WHERE id=target_run_control_id AND status='running';
    UPDATE signal_strategic_run_outbox SET status='needs_review',updated_at=clock_timestamp()
    WHERE tb_analysis_id=target_analysis_id AND status='running';
    UPDATE tb_analyses SET status='needs_review',current_step='review',updated_at=clock_timestamp()
    WHERE id=target_analysis_id AND status='running';
  ELSE
    UPDATE signal_strategic_run_controls SET last_heartbeat_at=clock_timestamp(),
      updated_at=clock_timestamp() WHERE id=target_run_control_id AND status='running';
  END IF;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS fail_signal_strategic_step_v1(uuid,uuid,timestamptz,jsonb,boolean);
CREATE OR REPLACE FUNCTION fail_signal_strategic_step_v1(
  target_pipeline_step_id uuid,target_lease_token uuid,target_retry_at timestamptz,
  target_error jsonb,target_terminal boolean
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE target_analysis_id uuid;
DECLARE target_run_control_id uuid;
DECLARE cancel_requested boolean;
BEGIN
  SELECT tb_analysis_id,run_control_id INTO target_analysis_id,target_run_control_id
  FROM signal_strategic_step_outbox
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token FOR UPDATE;
  IF target_analysis_id IS NULL THEN RETURN 'lease_lost'; END IF;
  SELECT control.cancel_requested_at IS NOT NULL INTO cancel_requested
  FROM signal_strategic_run_controls control WHERE control.id=target_run_control_id;
  UPDATE signal_strategic_step_outbox SET status=CASE
      WHEN cancel_requested THEN 'cancelled'
      WHEN target_terminal THEN 'dead_letter' ELSE 'failed' END,
    available_at=target_retry_at,locked_at=NULL,lease_expires_at=NULL,lease_token=NULL,
    dead_lettered_at=CASE WHEN target_terminal AND NOT cancel_requested
      THEN clock_timestamp() ELSE NULL END,
    last_error=COALESCE(target_error,'{}'::jsonb),updated_at=clock_timestamp()
  WHERE pipeline_step_id=target_pipeline_step_id AND status='running'
    AND lease_token=target_lease_token;
  UPDATE tb_pipeline_steps SET status='failed',completed_at=clock_timestamp(),
    error_message=COALESCE(target_error->>'message','Strategic step failed')
  WHERE id=target_pipeline_step_id AND tb_analysis_id=target_analysis_id;
  IF cancel_requested THEN
    UPDATE signal_strategic_run_controls SET status='cancelled',
      cancelled_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=target_run_control_id AND status='cancel_requested';
    UPDATE signal_strategic_run_outbox SET status='cancelled',
      completed_at=COALESCE(completed_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE tb_analysis_id=target_analysis_id AND status='cancel_requested';
  ELSIF target_terminal THEN
    UPDATE signal_strategic_run_controls SET status='failed',updated_at=clock_timestamp()
    WHERE id=target_run_control_id AND status IN ('queued','running','cancel_requested');
    UPDATE signal_strategic_run_outbox SET status='failed',
      completed_at=COALESCE(completed_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE tb_analysis_id=target_analysis_id
      AND status NOT IN ('dead_letter','completed','failed','cancelled');
  END IF;
  RETURN CASE WHEN cancel_requested THEN 'cancelled'
    WHEN target_terminal THEN 'dead_letter' ELSE 'failed' END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_signal_strategic_step_outbox_recovery
  ON signal_strategic_step_outbox (available_at, created_at, id)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_signal_strategic_step_outbox_lease
  ON signal_strategic_step_outbox (lease_expires_at, id)
  WHERE status = 'dispatching';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_analyses_workspace_report_open_governed
  ON tb_analyses (workspace_id,report_key)
  WHERE strategic_contract_version IS NOT NULL AND status IN ('running','needs_review');

ALTER TABLE signal_strategic_run_outbox
  DROP CONSTRAINT IF EXISTS signal_strategic_run_outbox_status,
  ADD CONSTRAINT signal_strategic_run_outbox_status CHECK (status IN (
    'pending','dispatching','dispatched','running','needs_review','cancel_requested',
    'completed','failed','cancelled','dead_letter'
  ));

CREATE OR REPLACE FUNCTION signal_strategic_launch_request_digest_v1(target_request jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(
    (target_request-'request_digest')::text,'UTF8')),'hex');
$$;

DROP FUNCTION IF EXISTS signal_strategic_execution_plan_digest_v1(text,integer,bigint,bigint);
CREATE OR REPLACE FUNCTION signal_strategic_execution_plan_digest_v1(
  target_plan jsonb,target_pipeline_version text,target_prompt_version text
)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
    'signal-strategic-execution-plan-authority-v1',target_pipeline_version,
    target_prompt_version,(target_plan-'digest')::text
  ),'UTF8')),'hex');
$$;

CREATE OR REPLACE FUNCTION launch_signal_tb_strategic_run_v2(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_preflight_digest text,
  target_request jsonb
)
RETURNS TABLE (
  run_control_id uuid,tb_analysis_id uuid,snapshot_id uuid,
  run_outbox_id uuid,step_outbox_id uuid,created boolean
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE request_without_digest jsonb;
DECLARE computed_request_digest text;
DECLARE submitted_request_digest text;
DECLARE binding signal_governed_view_bindings%ROWTYPE;
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE compilation signal_population_policy_compilations%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE population signal_population_definitions%ROWTYPE;
DECLARE persisted signal_strategic_run_controls%ROWTYPE;
DECLARE execution_corpus_id uuid;
DECLARE period_start_value date;
DECLARE period_end_value date;
DECLARE timezone_value text;
DECLARE frozen_at timestamptz := clock_timestamp();
DECLARE valid_until_value timestamptz;
DECLARE snapshot_count_value integer;
DECLARE snapshot_digest_value text;
DECLARE sample_count_value integer;
DECLARE sample_seed_value text;
DECLARE sample_digest_value text;
DECLARE computed_sample_digest text;
DECLARE computed_provenance_digest text;
DECLARE snapshot_authority_digest_value text;
DECLARE pipeline_step_id_value uuid;
DECLARE execution_plan_version_value text;
DECLARE execution_plan_digest_value text;
DECLARE planned_provider_calls_value integer;
DECLARE planned_input_tokens_value bigint;
DECLARE planned_output_tokens_value bigint;
DECLARE planned_cost_value numeric(14,6);
DECLARE plan_provider_calls_value integer;
DECLARE plan_input_tokens_value bigint;
DECLARE plan_output_tokens_value bigint;
DECLARE plan_invalid_operation_count integer;
BEGIN
  submitted_request_digest := target_request->>'request_digest';
  request_without_digest := target_request-'request_digest';
  computed_request_digest := signal_strategic_launch_request_digest_v1(target_request);
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_preflight_digest !~ '^sha256:[0-9a-f]{64}$'
     OR submitted_request_digest IS DISTINCT FROM computed_request_digest
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id) THEN
    RAISE EXCEPTION 'Strategic launch request identity or actor is invalid.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-governed-launch:'||target_workspace_id::text||':triggers-barriers',0
  ));
  SELECT * INTO persisted FROM signal_strategic_run_controls control
  WHERE control.workspace_id=target_workspace_id
    AND control.report_key='triggers-barriers'
    AND control.idempotency_key=target_idempotency_key FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.preflight_digest IS DISTINCT FROM target_preflight_digest
       OR persisted.request_digest IS DISTINCT FROM computed_request_digest THEN
      RAISE EXCEPTION 'Strategic launch idempotency key has incompatible inputs.'
        USING ERRCODE='23514';
    END IF;
    SELECT outbox.id INTO run_outbox_id FROM signal_strategic_run_outbox outbox
      WHERE outbox.tb_analysis_id=persisted.tb_analysis_id;
    SELECT outbox.id INTO step_outbox_id FROM signal_strategic_step_outbox outbox
      WHERE outbox.run_control_id=persisted.id AND outbox.pipeline_step='preflight'
        AND outbox.attempt=1;
    run_control_id:=persisted.id;tb_analysis_id:=persisted.tb_analysis_id;
    snapshot_id:=persisted.snapshot_id;created:=false;RETURN NEXT;RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM tb_analyses analysis
    WHERE analysis.workspace_id=target_workspace_id AND analysis.report_key='triggers-barriers'
      AND analysis.strategic_contract_version IS NOT NULL
      AND analysis.status IN ('running','needs_review')) THEN
    RAISE EXCEPTION 'A strategic workspace report run is already open.' USING ERRCODE='23505';
  END IF;

  SELECT * INTO binding FROM signal_governed_view_bindings candidate
  WHERE candidate.id=(target_request->'authority'->>'binding_id')::uuid FOR SHARE;
  SELECT * INTO bundle FROM signal_population_policy_bundles candidate
  WHERE candidate.id=(target_request->'authority'->>'policy_bundle_id')::uuid FOR SHARE;
  SELECT * INTO compilation FROM signal_population_policy_compilations candidate
  WHERE candidate.id=(target_request->'authority'->>'policy_compilation_id')::uuid FOR SHARE;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations candidate
  WHERE candidate.id=(target_request->'authority'->>'governance_evaluation_id')::uuid FOR SHARE;
  SELECT * INTO population FROM signal_population_definitions candidate
  WHERE candidate.id=(target_request->'authority'->>'population_id')::uuid FOR SHARE;
  valid_until_value:=LEAST(binding.effective_to,bundle.effective_to,
    compilation.next_policy_transition_at);
  IF binding.id IS NULL OR bundle.id IS NULL OR compilation.id IS NULL
     OR evaluation.id IS NULL OR population.id IS NULL
     OR binding.workspace_id IS DISTINCT FROM target_workspace_id
     OR binding.module_key<>'triggers-barriers' OR binding.view_key<>'strategic'
     OR binding.binding_status<>'current' OR binding.effective_from>frozen_at
     OR (binding.effective_to IS NOT NULL AND binding.effective_to<=frozen_at)
     OR binding.policy_bundle_id IS DISTINCT FROM bundle.id
     OR binding.policy_compilation_id IS DISTINCT FROM compilation.id
     OR binding.population_id IS DISTINCT FROM population.id
     OR bundle.workspace_id IS DISTINCT FROM target_workspace_id OR bundle.status<>'active'
     OR bundle.visibility_class<>'strategic-internal'
     OR bundle.required_usage_purposes IS DISTINCT FROM
       ARRAY['llm-processing','strategic-analysis']::text[]
     OR bundle.effective_from>frozen_at
     OR (bundle.effective_to IS NOT NULL AND bundle.effective_to<=frozen_at)
     OR compilation.workspace_id IS DISTINCT FROM target_workspace_id
     OR compilation.policy_bundle_id IS DISTINCT FROM bundle.id
     OR compilation.population_id IS DISTINCT FROM population.id
     OR compilation.governance_evaluation_id IS DISTINCT FROM evaluation.id
     OR compilation.module_key<>'triggers-barriers' OR compilation.view_key<>'strategic'
     OR compilation.compilation_status<>'ready' OR NOT compilation.is_current
     OR compilation.governance_unknown_count IS DISTINCT FROM 0
     OR compilation.usage_purposes IS DISTINCT FROM
       ARRAY['llm-processing','strategic-analysis']::text[]
     OR valid_until_value IS NOT NULL AND valid_until_value<=frozen_at
     OR evaluation.workspace_id IS DISTINCT FROM target_workspace_id
     OR evaluation.policy_bundle_id IS DISTINCT FROM bundle.id
     OR evaluation.population_id IS DISTINCT FROM population.id
     OR evaluation.evaluation_status<>'complete'
     OR evaluation.governance_unknown_count IS DISTINCT FROM 0
     OR evaluation.governance_digest IS DISTINCT FROM compilation.governance_digest
     OR population.workspace_id IS DISTINCT FROM target_workspace_id
     OR population.purpose<>'analysis' OR population.status<>'draft'
     OR population.membership_digest IS DISTINCT FROM compilation.membership_digest
     OR EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
       WHERE invalidation.policy_compilation_id=compilation.id)
     OR (target_request->'authority'->>'population_version')::int IS DISTINCT FROM population.version
     OR target_request->'authority'->>'population_definition_hash'
        IS DISTINCT FROM population.definition_hash
     OR target_request->'authority'->>'membership_digest'
        IS DISTINCT FROM compilation.membership_digest
     OR target_request->'authority'->>'policy_definition_hash'
        IS DISTINCT FROM compilation.policy_definition_hash
     OR target_request->'authority'->>'compiled_plan_hash'
        IS DISTINCT FROM compilation.compiled_plan_hash
     OR target_request->'authority'->>'governance_digest'
        IS DISTINCT FROM compilation.governance_digest
     OR target_request->'authority'->>'watermark_hash'
        IS DISTINCT FROM compilation.source_watermark_hash
     OR (target_request->'authority'->>'next_policy_transition_at')::timestamptz
        IS DISTINCT FROM compilation.next_policy_transition_at
     OR ARRAY(SELECT jsonb_array_elements_text(target_request->'authority'->'usage_purposes'))
        IS DISTINCT FROM ARRAY['llm-processing','strategic-analysis']::text[] THEN
    RAISE EXCEPTION 'Strategic launch authority is stale, ambiguous or incompatible.'
      USING ERRCODE='23514';
  END IF;

  execution_corpus_id:=(target_request->'execution'->>'study_corpus_id')::uuid;
  period_start_value:=(target_request->'execution'->>'period_start')::date;
  period_end_value:=(target_request->'execution'->>'period_end')::date;
  timezone_value:=target_request->'execution'->>'timezone';
  execution_plan_version_value:=target_request->'execution_plan'->>'contract_version';
  execution_plan_digest_value:=target_request->'execution_plan'->>'digest';
  planned_provider_calls_value:=(target_request->'execution_plan'->>'planned_provider_calls')::int;
  planned_input_tokens_value:=(target_request->'execution_plan'->>'reserved_input_tokens')::bigint;
  planned_output_tokens_value:=(target_request->'execution_plan'->>'reserved_output_tokens')::bigint;
  SELECT COALESCE(sum(operation.count),0)::int,
    COALESCE(sum(operation.count),0)::bigint
      *(target_request->'execution_plan'->>'max_input_tokens_per_call')::bigint,
    COALESCE(sum(operation.count*operation.max_output_tokens),0)::bigint,
    count(*) FILTER (WHERE operation.operation NOT IN (
      'preflight','step1-open-pass','step2-coding','step3-hierarchy',
      'step4-mobility','step6-synthesis','step6-humanizer'
    ) OR operation.count<=0 OR operation.max_output_tokens<=0)
  INTO plan_provider_calls_value,plan_input_tokens_value,plan_output_tokens_value,
    plan_invalid_operation_count
  FROM jsonb_to_recordset(target_request->'execution_plan'->'calls') AS operation(
    operation text,count integer,max_output_tokens bigint
  );
  -- Match the Query Engine's conservative upper-bound contract exactly. A
  -- planned reservation rounds upward at micro-USD precision; observed usage
  -- settlement may still use ordinary currency rounding below.
  planned_cost_value:=ceil((
    planned_input_tokens_value::numeric*
      (target_request->'execution'->>'input_usd_per_million_tokens')::numeric/1000000
    +planned_output_tokens_value::numeric*
      (target_request->'execution'->>'output_usd_per_million_tokens')::numeric/1000000
  )*1000000)/1000000;
  IF period_start_value>period_end_value OR NULLIF(btrim(timezone_value),'') IS NULL
     OR target_request->'execution'->>'provider_config_digest'
        !~ '^sha256:[0-9a-f]{64}$'
     OR execution_plan_version_value<>'signal-strategic-provider-budget-plan-v1'
     OR execution_plan_digest_value !~ '^sha256:[0-9a-f]{64}$'
     OR execution_plan_digest_value IS DISTINCT FROM signal_strategic_execution_plan_digest_v1(
       target_request->'execution_plan',target_request->'execution'->>'pipeline_version',
       target_request->'execution'->>'prompt_version')
     OR planned_provider_calls_value<=0 OR planned_input_tokens_value<0
     OR planned_output_tokens_value<0
     OR planned_input_tokens_value+planned_output_tokens_value<=0
     OR plan_invalid_operation_count<>0
     OR (SELECT count(*) FROM jsonb_array_elements(target_request->'execution_plan'->'calls'))<>7
     OR (SELECT count(*) FROM jsonb_array_elements(target_request->'execution_plan'->'calls'))
       IS DISTINCT FROM (SELECT count(DISTINCT operation->>'operation')
         FROM jsonb_array_elements(target_request->'execution_plan'->'calls') operation)
     OR plan_provider_calls_value IS DISTINCT FROM planned_provider_calls_value
     OR plan_input_tokens_value IS DISTINCT FROM planned_input_tokens_value
     OR plan_output_tokens_value IS DISTINCT FROM planned_output_tokens_value
     OR (target_request->'execution_plan'->>'reservation_upper_bound_usd')::numeric
       IS DISTINCT FROM planned_cost_value
     OR (target_request->'execution'->>'estimated_cost_usd')::numeric
        IS DISTINCT FROM planned_cost_value
     OR (target_request->'execution'->>'hard_cap_usd')::numeric < planned_cost_value
     OR NOT EXISTS (SELECT 1 FROM signal_workspaces workspace
       WHERE workspace.id=target_workspace_id AND workspace.status='active'
         AND workspace.timezone=timezone_value)
     OR NOT EXISTS (SELECT 1 FROM signal_workspace_reports report
       JOIN signal_workspace_corpora membership ON membership.workspace_id=report.workspace_id
         AND membership.study_corpus_id=execution_corpus_id AND membership.valid_to IS NULL
       JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
       JOIN methodologies methodology ON methodology.id=corpus.methodology_id
       WHERE report.workspace_id=target_workspace_id AND report.report_key='triggers-barriers'
         AND report.status='active' AND methodology.slug='triggers-barriers') THEN
    RAISE EXCEPTION 'Strategic launch execution scope is unavailable.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int,
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
      membership.mention_id::text,',' ORDER BY membership.mention_id),''),'UTF8')),'hex')
  INTO snapshot_count_value,snapshot_digest_value
  FROM signal_population_memberships membership
  JOIN mentions mention ON mention.id=membership.mention_id
    AND mention.workspace_id=target_workspace_id AND mention.canonical_mention_id=mention.id
  WHERE membership.population_id=population.id AND membership.workspace_id=target_workspace_id
    AND membership.membership_status='included' AND membership.removed_at IS NULL
    AND (mention.published_at AT TIME ZONE timezone_value)::date
      BETWEEN period_start_value AND period_end_value;
  IF snapshot_count_value=0 THEN
    RAISE EXCEPTION 'Strategic governed period is empty.' USING ERRCODE='23514';
  END IF;
  sample_count_value:=(target_request->'sample'->>'count')::int;
  sample_seed_value:=target_request->'sample'->>'seed';
  sample_digest_value:=target_request->'sample'->>'digest';
  IF target_request->'sample'->>'algorithm'<>'canonical-root-sha256-rank-v1'
     OR sample_seed_value !~ '^sha256:[0-9a-f]{64}$'
     OR sample_count_value NOT BETWEEN 1 AND snapshot_count_value THEN
    RAISE EXCEPTION 'Strategic deterministic sample request is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
    ranked.mention_id::text,',' ORDER BY ranked.rank_hash,ranked.mention_id),''),'UTF8')),'hex')
  INTO computed_sample_digest FROM (
    SELECT membership.mention_id,
      'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
        'canonical-root-sha256-rank-v1',sample_seed_value,
        lower(membership.mention_id::text)),'UTF8')),'hex') AS rank_hash
    FROM signal_population_memberships membership
    JOIN mentions mention ON mention.id=membership.mention_id
      AND mention.workspace_id=target_workspace_id AND mention.canonical_mention_id=mention.id
    WHERE membership.population_id=population.id AND membership.workspace_id=target_workspace_id
      AND membership.membership_status='included' AND membership.removed_at IS NULL
      AND (mention.published_at AT TIME ZONE timezone_value)::date
        BETWEEN period_start_value AND period_end_value
    ORDER BY rank_hash,membership.mention_id LIMIT sample_count_value
  ) ranked;
  IF sample_digest_value IS DISTINCT FROM computed_sample_digest THEN
    RAISE EXCEPTION 'Strategic deterministic sample digest does not match.' USING ERRCODE='23514';
  END IF;
  SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(concat_ws(':',
    item.mention_id::text,item.governance_path_hash),',' ORDER BY item.mention_id),''),'UTF8')),'hex')
  INTO computed_provenance_digest
  FROM signal_data_governance_evaluation_items item
  JOIN signal_population_memberships membership
    ON membership.population_id=population.id
   AND membership.workspace_id=target_workspace_id
   AND membership.mention_id=item.mention_id
   AND membership.membership_status='included' AND membership.removed_at IS NULL
  JOIN mentions mention ON mention.id=membership.mention_id
    AND mention.workspace_id=target_workspace_id AND mention.canonical_mention_id=mention.id
  WHERE item.evaluation_id=evaluation.id AND item.decision='included'
    AND item.reason_code='policy_eligible'
    AND (mention.published_at AT TIME ZONE timezone_value)::date
      BETWEEN period_start_value AND period_end_value;
  IF target_request->'authority'->>'provenance_digest'
       IS DISTINCT FROM computed_provenance_digest THEN
    RAISE EXCEPTION 'Strategic sample provenance digest does not match governed evidence.'
      USING ERRCODE='23514';
  END IF;

  snapshot_authority_digest_value:='sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
    target_workspace_id::text,binding.id::text,bundle.id::text,compilation.id::text,
    evaluation.id::text,population.id::text,snapshot_digest_value,
    compilation.policy_definition_hash,compilation.compiled_plan_hash,
    compilation.governance_digest,computed_provenance_digest,
    compilation.source_watermark_hash,sample_digest_value,execution_plan_digest_value,
    target_request->'execution'->>'provider',
    target_request->'execution'->>'provider_config_digest',
    target_request->'execution'->>'model_version',
    target_request->'execution'->>'prompt_version',
    target_request->'execution'->>'pricing_version',
    target_request->'execution'->>'input_usd_per_million_tokens',
    target_request->'execution'->>'output_usd_per_million_tokens'
  ),'UTF8')),'hex');
  INSERT INTO corpus_snapshots (
    workspace_id,population_id,population_version,population_definition_hash,
    period_start,period_end,timezone,watermark_captured_at,study_corpus_id,label,kind,
    mention_count,scores_at_snapshot,created_by_user_id,idempotency_key
  ) VALUES (
    target_workspace_id,population.id,population.version,population.definition_hash,
    period_start_value,period_end_value,timezone_value,frozen_at,execution_corpus_id,
    COALESCE(target_request->'execution'->>'label','Triggers & Barriers'),'analysis',
    snapshot_count_value,jsonb_build_object('contract_version','signal-tb-strategic-v2'),
    target_actor_user_id,target_idempotency_key
  ) RETURNING id INTO snapshot_id;
  INSERT INTO corpus_snapshot_mentions (snapshot_id,mention_id)
  SELECT snapshot_id,membership.mention_id
  FROM signal_population_memberships membership JOIN mentions mention
    ON mention.id=membership.mention_id AND mention.workspace_id=target_workspace_id
    AND mention.canonical_mention_id=mention.id
  WHERE membership.population_id=population.id AND membership.workspace_id=target_workspace_id
    AND membership.membership_status='included' AND membership.removed_at IS NULL
    AND (mention.published_at AT TIME ZONE timezone_value)::date
      BETWEEN period_start_value AND period_end_value ORDER BY membership.mention_id;
  UPDATE corpus_snapshots SET snapshot_digest=snapshot_digest_value,
    source_watermark_digest=compilation.source_watermark_hash,scope_frozen_at=frozen_at,
    strategic_authority_version='signal-strategic-snapshot-authority-v1',
    policy_bundle_id=bundle.id,policy_compilation_id=compilation.id,
    governance_evaluation_id=evaluation.id,policy_definition_hash=compilation.policy_definition_hash,
    compiled_plan_hash=compilation.compiled_plan_hash,governance_digest=compilation.governance_digest,
    provenance_digest=computed_provenance_digest,
    usage_purposes=ARRAY['llm-processing','strategic-analysis']::text[]
  WHERE id=snapshot_id;

  INSERT INTO tb_analyses (
    study_corpus_id,snapshot_id,pipeline_version,methodology_version,methodology_slug,
    prompt_version,model_version,corpus_revision,period_start,period_end,
    snapshot_mention_count,snapshot_digest,scope_frozen_at,comparison_compatibility_state,
    status,current_step,business_question,decision_to_inform,meta_json,executed_by_user_id,
    workspace_id,report_key,population_id,population_version,population_definition_hash,
    timezone,run_idempotency_key,strategic_contract_version
  ) VALUES (
    execution_corpus_id,snapshot_id,target_request->'execution'->>'pipeline_version',
    target_request->'execution'->>'methodology_version','triggers-barriers',
    target_request->'execution'->>'prompt_version',target_request->'execution'->>'model_version',
    (target_request->'execution'->>'corpus_revision')::int,period_start_value,period_end_value,
    snapshot_count_value,snapshot_digest_value,frozen_at,'not_evaluated','running','preflight',
    target_request->'execution'->>'business_question',
    target_request->'execution'->>'decision_to_inform',
    jsonb_build_object('strategic_contract_version','signal-tb-strategic-v2'),
    target_actor_user_id,target_workspace_id,'triggers-barriers',population.id,population.version,
    population.definition_hash,timezone_value,target_idempotency_key,'signal-tb-strategic-v2'
  ) RETURNING id INTO tb_analysis_id;
  UPDATE study_corpora SET locked_by_analysis_id=tb_analysis_id,updated_at=now()
  WHERE id=execution_corpus_id AND (locked_by_analysis_id IS NULL OR locked_by_analysis_id=tb_analysis_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Strategic execution corpus is locked.' USING ERRCODE='23505'; END IF;

  INSERT INTO signal_strategic_run_controls (
    workspace_id,report_key,tb_analysis_id,snapshot_id,binding_id,policy_bundle_id,
    policy_compilation_id,governance_evaluation_id,population_id,preflight_digest,
    request_digest,snapshot_authority_digest,policy_definition_hash,compiled_plan_hash,
    membership_digest,governance_digest,provenance_digest,watermark_hash,
    authority_valid_until,usage_purposes,sample_algorithm,sample_seed,sample_count,sample_digest,
    execution_plan_version,execution_plan_digest,execution_plan,planned_provider_calls,
    planned_input_tokens,planned_output_tokens,
    provider,provider_config_digest,model_version,prompt_version,pricing_version,input_usd_per_million_tokens,
    output_usd_per_million_tokens,estimated_cost_usd,hard_cap_usd,created_by_user_id,idempotency_key
  ) VALUES (
    target_workspace_id,'triggers-barriers',tb_analysis_id,snapshot_id,binding.id,bundle.id,
    compilation.id,evaluation.id,population.id,target_preflight_digest,computed_request_digest,
    snapshot_authority_digest_value,compilation.policy_definition_hash,compilation.compiled_plan_hash,
    compilation.membership_digest,compilation.governance_digest,computed_provenance_digest,
    compilation.source_watermark_hash,valid_until_value,
    ARRAY['llm-processing','strategic-analysis']::text[],
    'canonical-root-sha256-rank-v1',sample_seed_value,sample_count_value,sample_digest_value,
    execution_plan_version_value,execution_plan_digest_value,target_request->'execution_plan',
    planned_provider_calls_value,
    planned_input_tokens_value,planned_output_tokens_value,
    target_request->'execution'->>'provider',target_request->'execution'->>'provider_config_digest',
    target_request->'execution'->>'model_version',
    target_request->'execution'->>'prompt_version',target_request->'execution'->>'pricing_version',
    (target_request->'execution'->>'input_usd_per_million_tokens')::numeric,
    (target_request->'execution'->>'output_usd_per_million_tokens')::numeric,
    (target_request->'execution'->>'estimated_cost_usd')::numeric,
    (target_request->'execution'->>'hard_cap_usd')::numeric,
    target_actor_user_id,target_idempotency_key
  ) RETURNING id INTO run_control_id;
  INSERT INTO signal_strategic_sealed_sample_items (
    run_control_id,workspace_id,snapshot_id,ordinal,mention_id,rank_hash
  ) SELECT run_control_id,target_workspace_id,snapshot_id,
      row_number() OVER (ORDER BY ranked.rank_hash,ranked.mention_id)::int,
      ranked.mention_id,ranked.rank_hash
    FROM (
      SELECT membership.mention_id,
        'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
          'canonical-root-sha256-rank-v1',sample_seed_value,
          lower(membership.mention_id::text)),'UTF8')),'hex') AS rank_hash
      FROM corpus_snapshot_mentions membership WHERE membership.snapshot_id=snapshot_id
      ORDER BY rank_hash,membership.mention_id LIMIT sample_count_value
    ) ranked;
  INSERT INTO signal_strategic_run_outbox (
    workspace_id,report_key,tb_analysis_id,snapshot_id,idempotency_key
  ) VALUES (target_workspace_id,'triggers-barriers',tb_analysis_id,snapshot_id,target_idempotency_key)
  RETURNING id INTO run_outbox_id;
  INSERT INTO tb_pipeline_steps (tb_analysis_id,step,status,attempt)
  VALUES (tb_analysis_id,'preflight','queued',1) RETURNING id INTO pipeline_step_id_value;
  INSERT INTO signal_strategic_step_outbox (
    run_control_id,workspace_id,tb_analysis_id,pipeline_step_id,pipeline_step,attempt,idempotency_key
  ) VALUES (run_control_id,target_workspace_id,tb_analysis_id,pipeline_step_id_value,'preflight',1,
    'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
      'signal-strategic-step-outbox-v1',run_control_id::text,'preflight','1'
    ),'UTF8')),'hex')) RETURNING id INTO step_outbox_id;
  created:=true;RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION request_signal_strategic_run_cancel_v1(
  target_workspace_id uuid,
  target_analysis_id uuid,
  target_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
BEGIN
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id, target_actor_user_id) THEN
    RAISE EXCEPTION 'Strategic cancel actor is not authorized.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-run:' || target_workspace_id::text || ':' || target_analysis_id::text, 0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
  WHERE workspace_id = target_workspace_id AND tb_analysis_id = target_analysis_id FOR UPDATE;
  IF control.id IS NULL THEN
    RAISE EXCEPTION 'Strategic run is unavailable in this workspace.' USING ERRCODE = '42501';
  END IF;
  IF control.status IN ('completed','failed','cancelled') THEN RETURN control.status; END IF;
  UPDATE signal_strategic_run_controls SET
    status='cancel_requested', cancel_requested_at=COALESCE(cancel_requested_at, now()), updated_at=now()
  WHERE id=control.id;
  UPDATE signal_strategic_run_outbox SET status='cancel_requested',updated_at=clock_timestamp()
  WHERE tb_analysis_id=control.tb_analysis_id
    AND status IN ('pending','dispatching','dispatched','running');
  UPDATE signal_strategic_step_outbox SET
    status='cancelled', completed_at=COALESCE(completed_at,now()), updated_at=now()
  WHERE run_control_id=control.id AND status IN ('pending','failed','dispatching','dispatched');
  UPDATE tb_pipeline_steps SET status='failed',completed_at=clock_timestamp(),
    error_message='Strategic run cancelled before execution.'
  WHERE id IN (SELECT pipeline_step_id FROM signal_strategic_step_outbox
    WHERE run_control_id=control.id AND status='cancelled')
    AND status IN ('queued','running','failed');
  RETURN 'cancel_requested';
END;
$$;

CREATE OR REPLACE FUNCTION transition_signal_strategic_run_v1(
  target_run_control_id uuid,
  target_expected_statuses text[],
  target_next_status text,
  target_worker_key text
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE persisted signal_strategic_run_controls%ROWTYPE;
BEGIN
  IF cardinality(target_expected_statuses)=0 OR NULLIF(btrim(target_worker_key),'') IS NULL
     OR target_next_status NOT IN (
       'queued','running','needs_review','completed','failed','cancel_requested','cancelled') THEN
    RAISE EXCEPTION 'Strategic run transition input is invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-run-control:'||target_run_control_id::text,0
  ));
  SELECT * INTO persisted FROM signal_strategic_run_controls
  WHERE id=target_run_control_id FOR UPDATE;
  IF persisted.id IS NULL THEN RETURN NULL; END IF;
  IF NOT (persisted.status=ANY(target_expected_statuses)) THEN
    RAISE EXCEPTION 'Strategic run transition lost its expected-status CAS.' USING ERRCODE='40001';
  END IF;
  UPDATE signal_strategic_run_controls SET status=target_next_status,
    last_heartbeat_at=CASE WHEN target_next_status='running' THEN clock_timestamp()
      ELSE last_heartbeat_at END,
    cancel_requested_at=CASE WHEN target_next_status IN ('cancel_requested','cancelled')
      THEN COALESCE(cancel_requested_at,clock_timestamp()) ELSE cancel_requested_at END,
    cancelled_at=CASE WHEN target_next_status='cancelled' THEN clock_timestamp()
      ELSE cancelled_at END,updated_at=clock_timestamp()
  WHERE id=target_run_control_id;
  UPDATE signal_strategic_run_outbox SET status=target_next_status,
    completed_at=CASE WHEN target_next_status IN ('completed','failed','cancelled')
      THEN COALESCE(completed_at,clock_timestamp()) ELSE completed_at END,
    updated_at=clock_timestamp()
  WHERE tb_analysis_id=persisted.tb_analysis_id
    AND status NOT IN ('dead_letter','completed','failed','cancelled');
  RETURN target_next_status;
END;
$$;

CREATE TABLE IF NOT EXISTS signal_strategic_review_release_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_digest text NOT NULL,
  idempotency_key text NOT NULL,
  release_id uuid NOT NULL REFERENCES signal_workspace_releases(id) ON DELETE RESTRICT,
  reviewed_assertion_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_review_release_operation
    UNIQUE (workspace_id,idempotency_key),
  CONSTRAINT signal_strategic_review_release_hashes CHECK (
    request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_strategic_review_release_count CHECK (reviewed_assertion_count>=0)
);

CREATE OR REPLACE FUNCTION protect_signal_strategic_review_release_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Strategic Review/release operations are append-only.' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_review_release_operation_v1
  ON signal_strategic_review_release_operations;
CREATE TRIGGER trg_protect_signal_strategic_review_release_operation_v1
  BEFORE UPDATE OR DELETE ON signal_strategic_review_release_operations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_review_release_operation_v1();

CREATE OR REPLACE FUNCTION signal_strategic_review_release_request_digest_v1(
  target_request jsonb
)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(
    (target_request-'request_digest')::text,'UTF8')),'hex');
$$;

CREATE OR REPLACE FUNCTION review_and_prepare_signal_tb_strategic_v2(
  target_workspace_id uuid,target_analysis_id uuid,target_actor_user_id uuid,
  target_idempotency_key text,target_request_digest text,target_request jsonb
)
RETURNS TABLE (operation_id uuid,release_id uuid,created boolean)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE analysis tb_analyses%ROWTYPE;
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE persisted signal_strategic_review_release_operations%ROWTYPE;
DECLARE decision jsonb;
DECLARE decision_index integer:=0;
DECLARE artifact_count integer;
DECLARE blocked_artifact_count integer;
DECLARE failed_gate_count integer;
DECLARE quality_gate_count integer;
DECLARE reviewed_count integer;
DECLARE quality_gate_evidence jsonb;
DECLARE release_title_value text;
DECLARE operation_key text;
BEGIN
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest IS DISTINCT FROM
       signal_strategic_review_release_request_digest_v1(target_request)
     OR target_request->>'request_digest' IS DISTINCT FROM target_request_digest
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR jsonb_typeof(COALESCE(target_request->'reusable_assertions','[]'::jsonb))<>'array'
     OR jsonb_array_length(COALESCE(target_request->'reusable_assertions','[]'::jsonb))>500 THEN
    RAISE EXCEPTION 'Strategic Review/release request is invalid.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'signal-strategic-review-release:'||target_workspace_id::text||':'||target_analysis_id::text,0
  ));
  SELECT * INTO persisted FROM signal_strategic_review_release_operations operation
  WHERE operation.workspace_id=target_workspace_id
    AND operation.idempotency_key=target_idempotency_key FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.tb_analysis_id IS DISTINCT FROM target_analysis_id
       OR persisted.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted.request_digest IS DISTINCT FROM target_request_digest THEN
      RAISE EXCEPTION 'Strategic Review/release idempotency key has incompatible inputs.'
        USING ERRCODE='23514';
    END IF;
    operation_id:=persisted.id;release_id:=persisted.release_id;created:=false;
    RETURN NEXT;RETURN;
  END IF;
  SELECT * INTO analysis FROM tb_analyses candidate
  WHERE candidate.id=target_analysis_id AND candidate.workspace_id=target_workspace_id
    AND candidate.strategic_contract_version='signal-tb-strategic-v2' FOR UPDATE;
  SELECT * INTO control FROM signal_strategic_run_controls candidate
  WHERE candidate.tb_analysis_id=target_analysis_id
    AND candidate.workspace_id=target_workspace_id FOR UPDATE;
  SELECT count(*)::int,count(*) FILTER (WHERE NOT gate.passed)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
      'gate_name',gate.gate_name,'passed',gate.passed,'checked_at',gate.checked_at
    ) ORDER BY gate.gate_name),'[]'::jsonb)
  INTO quality_gate_count,failed_gate_count,quality_gate_evidence
  FROM tb_quality_gates gate WHERE gate.tb_analysis_id=target_analysis_id;
  SELECT count(*)::int,count(*) FILTER (
    WHERE artifact.review_status NOT IN ('draft','needs_review'))::int
  INTO artifact_count,blocked_artifact_count FROM analysis_artifacts artifact
  WHERE artifact.tb_analysis_id=target_analysis_id;
  IF analysis.id IS NULL OR control.id IS NULL OR analysis.status<>'needs_review'
     OR control.status<>'needs_review' OR quality_gate_count=0 OR failed_gate_count<>0
     OR artifact_count=0 OR blocked_artifact_count<>0 THEN
    RAISE EXCEPTION 'Strategic Review/release state is incomplete or stale.' USING ERRCODE='23514';
  END IF;
  PERFORM assert_signal_tb_snapshot_containment(target_analysis_id,'human_review');
  FOR decision IN SELECT value FROM jsonb_array_elements(
    COALESCE(target_request->'reusable_assertions','[]'::jsonb)
  ) LOOP
    decision_index:=decision_index+1;
    IF decision->>'decision' NOT IN ('approve','correct','reject')
       OR NULLIF(decision->>'record_tag_id','') IS NULL THEN
      RAISE EXCEPTION 'Strategic reusable assertion decision is invalid.' USING ERRCODE='23514';
    END IF;
    operation_key:='sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
      'signal-tb-reusable-assertion-review-v2',target_idempotency_key,
      decision_index::text,decision->>'record_tag_id',decision->>'decision'
    ),'UTF8')),'hex');
    PERFORM review_signal_tb_reusable_assertion(
      target_analysis_id,(decision->>'record_tag_id')::uuid,target_actor_user_id,
      decision->>'decision',left(decision->>'notes',1000),operation_key,
      COALESCE(decision->'correction','{}'::jsonb)
    );
  END LOOP;
  INSERT INTO analysis_artifact_review_events(
    artifact_id,reviewer_user_id,action,previous_status,next_status,patch,notes
  ) SELECT artifact.id,target_actor_user_id,'accept_analysis',artifact.review_status,
    'accepted','{}'::jsonb,'Accepted through governed T&B v2 Review.'
  FROM analysis_artifacts artifact WHERE artifact.tb_analysis_id=target_analysis_id
    AND artifact.review_status IN ('draft','needs_review');
  UPDATE analysis_artifacts SET review_status='accepted',updated_at=clock_timestamp()
  WHERE tb_analysis_id=target_analysis_id AND review_status IN ('draft','needs_review');
  UPDATE tb_analyses SET status='approved_by_im',current_step='done',
    limitations=CASE WHEN target_request ? 'limitations' THEN target_request->'limitations'
      ELSE limitations END,approved_by_im_user_id=target_actor_user_id,
    im_approved_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=target_analysis_id;
  UPDATE signal_strategic_run_controls SET status='completed',updated_at=clock_timestamp()
  WHERE id=control.id;
  UPDATE signal_strategic_run_outbox SET status='completed',
    completed_at=COALESCE(completed_at,clock_timestamp()),updated_at=clock_timestamp()
  WHERE tb_analysis_id=target_analysis_id AND status='needs_review';
  release_title_value:=left(NULLIF(btrim(target_request->>'release_title'),''),300);
  INSERT INTO signal_workspace_releases(
    workspace_id,tb_analysis_id,report_key,report_revision,release_key,title,status,visibility,
    period_start,period_end,corpus_revision,snapshot_id,comparison_base_analysis_id,
    quality_gates,metadata
  ) VALUES (
    target_workspace_id,target_analysis_id,'triggers-barriers',
    COALESCE((SELECT max(existing.report_revision)+1 FROM signal_workspace_releases existing
      WHERE existing.workspace_id=target_workspace_id
        AND existing.report_key='triggers-barriers'),1),
    'strategic:'||analysis.period_end::text||':'||target_analysis_id::text,
    COALESCE(release_title_value,'Strategic release · '||analysis.period_end::text),
    'draft','internal',analysis.period_start,analysis.period_end,analysis.corpus_revision,
    analysis.snapshot_id,analysis.comparison_base_analysis_id,quality_gate_evidence,
    jsonb_build_object('contract_version','signal-tb-strategic-release-v2',
      'created_by_user_id',target_actor_user_id,'request_digest',target_request_digest,
      'client_evidence_authority','withheld')
  ) RETURNING id INTO release_id;
  INSERT INTO signal_workspace_release_artifacts(
    release_id,artifact_id,artifact_revision,position,visibility
  ) SELECT release_id,artifact.id,artifact.revision,
    row_number() OVER (ORDER BY artifact.artifact_type,artifact.position,artifact.artifact_key)::int-1,
    'internal' FROM analysis_artifacts artifact
  WHERE artifact.tb_analysis_id=target_analysis_id AND artifact.review_status='accepted';
  reviewed_count:=jsonb_array_length(COALESCE(target_request->'reusable_assertions','[]'::jsonb));
  INSERT INTO signal_strategic_review_release_operations(
    workspace_id,tb_analysis_id,actor_user_id,request_digest,idempotency_key,
    release_id,reviewed_assertion_count
  ) VALUES (target_workspace_id,target_analysis_id,target_actor_user_id,target_request_digest,
    target_idempotency_key,release_id,reviewed_count) RETURNING id INTO operation_id;
  created:=true;RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION review_and_prepare_signal_tb_strategic_v2(
  uuid,uuid,uuid,text,text,jsonb
) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS signal_strategic_release_promotion_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  report_key text NOT NULL,
  release_id uuid NOT NULL REFERENCES signal_workspace_releases(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  request_digest text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_release_promotion_operation
    UNIQUE (workspace_id,idempotency_key),
  CONSTRAINT signal_strategic_release_promotion_identity CHECK (
    report_key='triggers-barriers' AND action='publish'
  ),
  CONSTRAINT signal_strategic_release_promotion_hashes CHECK (
    request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION protect_signal_strategic_release_promotion_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Strategic release promotion operations are append-only.'
    USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_release_promotion_operation_v1
  ON signal_strategic_release_promotion_operations;
CREATE TRIGGER trg_protect_signal_strategic_release_promotion_operation_v1
  BEFORE UPDATE OR DELETE ON signal_strategic_release_promotion_operations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_release_promotion_operation_v1();

CREATE OR REPLACE FUNCTION signal_strategic_release_promotion_request_digest_v1(
  target_workspace_id uuid,target_report_key text,target_release_id uuid,
  target_actor_user_id uuid,target_action text
)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(concat_ws(chr(31),
    'signal-strategic-release-promotion-request-v1',target_workspace_id::text,
    target_report_key,target_release_id::text,target_actor_user_id::text,target_action
  ),'UTF8')),'hex');
$$;

CREATE OR REPLACE FUNCTION promote_signal_workspace_report_release_v2(
  target_workspace_id uuid,target_report_key text,target_release_id uuid,
  target_actor_user_id uuid,target_idempotency_key text,target_request_digest text
)
RETURNS TABLE (operation_id uuid,release_id uuid,created boolean)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE persisted signal_strategic_release_promotion_operations%ROWTYPE;
DECLARE target_release signal_workspace_releases%ROWTYPE;
DECLARE promoted_release_id uuid;
BEGIN
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest IS DISTINCT FROM
       signal_strategic_release_promotion_request_digest_v1(
         target_workspace_id,target_report_key,target_release_id,target_actor_user_id,'publish'
       )
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id) THEN
    RAISE EXCEPTION 'Strategic release promotion request is invalid.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'signal-strategic-release-promotion:'||target_workspace_id::text||':'||target_report_key,0
  ));
  SELECT * INTO persisted FROM signal_strategic_release_promotion_operations operation
  WHERE operation.workspace_id=target_workspace_id
    AND operation.idempotency_key=target_idempotency_key FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.report_key IS DISTINCT FROM target_report_key
       OR persisted.release_id IS DISTINCT FROM target_release_id
       OR persisted.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted.action<>'publish'
       OR persisted.request_digest IS DISTINCT FROM target_request_digest THEN
      RAISE EXCEPTION 'Strategic release promotion idempotency key has incompatible inputs.'
        USING ERRCODE='23514';
    END IF;
    operation_id:=persisted.id;release_id:=persisted.release_id;created:=false;
    RETURN NEXT;RETURN;
  END IF;
  SELECT * INTO target_release FROM signal_workspace_releases candidate
  WHERE candidate.id=target_release_id FOR UPDATE;
  IF target_report_key<>'triggers-barriers' OR target_release.id IS NULL
     OR target_release.workspace_id IS DISTINCT FROM target_workspace_id
     OR target_release.report_key IS DISTINCT FROM target_report_key
     OR NOT EXISTS (SELECT 1 FROM tb_analyses analysis
       WHERE analysis.id=target_release.tb_analysis_id
         AND analysis.workspace_id=target_workspace_id
         AND analysis.strategic_contract_version='signal-tb-strategic-v2') THEN
    RAISE EXCEPTION 'Strategic release is unavailable in this workspace/report.'
      USING ERRCODE='42501';
  END IF;
  promoted_release_id:=promote_signal_workspace_report_release(
    target_release_id,target_actor_user_id
  );
  IF promoted_release_id IS DISTINCT FROM target_release_id THEN
    RAISE EXCEPTION 'Strategic release promotion returned an incompatible release.'
      USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_strategic_release_promotion_operations(
    workspace_id,report_key,release_id,actor_user_id,action,request_digest,idempotency_key
  ) VALUES (
    target_workspace_id,target_report_key,target_release_id,target_actor_user_id,'publish',
    target_request_digest,target_idempotency_key
  ) RETURNING id INTO operation_id;
  release_id:=target_release_id;created:=true;RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION promote_signal_workspace_report_release_v2(
  uuid,text,uuid,uuid,text,text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION validate_signal_tb_strategic_v2_control_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
BEGIN
  target_id:=COALESCE(NEW.id,OLD.id);
  IF EXISTS (SELECT 1 FROM tb_analyses analysis WHERE analysis.id=target_id
      AND analysis.strategic_contract_version='signal-tb-strategic-v2')
     AND NOT EXISTS (
       SELECT 1 FROM tb_analyses analysis
       JOIN signal_strategic_run_controls control ON control.tb_analysis_id=analysis.id
         AND control.workspace_id=analysis.workspace_id
         AND control.snapshot_id=analysis.snapshot_id
         AND control.population_id=analysis.population_id
       WHERE analysis.id=target_id
     ) THEN
    RAISE EXCEPTION 'A strategic v2 analysis requires its exact durable run control.'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_tb_strategic_v2_control_complete_v1 ON tb_analyses;
CREATE CONSTRAINT TRIGGER trg_signal_tb_strategic_v2_control_complete_v1
  AFTER INSERT OR UPDATE OF strategic_contract_version,workspace_id,snapshot_id,population_id
  ON tb_analyses DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_tb_strategic_v2_control_v1();

CREATE OR REPLACE FUNCTION protect_signal_strategic_run_control_delete_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Strategic run control is durable and cannot be deleted.' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_run_control_delete_v1
  ON signal_strategic_run_controls;
CREATE TRIGGER trg_protect_signal_strategic_run_control_delete_v1
  BEFORE DELETE ON signal_strategic_run_controls
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_run_control_delete_v1();

-- 0062's containment and Review contracts predate v2. Extend those exact
-- functions forward-only; no parallel Review/release store is introduced.
DO $extend_strategic_v2_contracts$
DECLARE source_definition text;
DECLARE function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'enforce_signal_tb_mention_snapshot_containment',
    'enforce_signal_tb_evidence_snapshot_containment',
    'enforce_signal_strategic_release_scope'
  ] LOOP
    SELECT pg_get_functiondef(proc.oid) INTO source_definition
    FROM pg_proc proc JOIN pg_namespace namespace ON namespace.oid=proc.pronamespace
    WHERE namespace.nspname='public' AND proc.proname=function_name
    ORDER BY proc.oid LIMIT 1;
    IF source_definition IS NOT NULL
       AND source_definition NOT LIKE '%signal-tb-strategic-v2%' THEN
      source_definition:=replace(source_definition,
        '= ''signal-tb-strategic-v1''',
        'IN (''signal-tb-strategic-v1'',''signal-tb-strategic-v2'')');
      EXECUTE source_definition;
    END IF;
  END LOOP;
  SELECT pg_get_functiondef(proc.oid) INTO source_definition
  FROM pg_proc proc JOIN pg_namespace namespace ON namespace.oid=proc.pronamespace
  WHERE namespace.nspname='public' AND proc.proname='review_signal_tb_reusable_assertion'
  ORDER BY proc.oid LIMIT 1;
  IF source_definition IS NOT NULL
     AND source_definition NOT LIKE '%signal-tb-strategic-v2%' THEN
    source_definition:=replace(source_definition,
      '<> ''signal-tb-strategic-v1''',
      'NOT IN (''signal-tb-strategic-v1'',''signal-tb-strategic-v2'')');
    EXECUTE source_definition;
  END IF;
END;
$extend_strategic_v2_contracts$;

DO $preserve_legacy_containment$
BEGIN
  IF to_regprocedure('assert_signal_tb_snapshot_containment_v1_legacy(uuid,text)') IS NULL THEN
    ALTER FUNCTION assert_signal_tb_snapshot_containment(uuid,text)
      RENAME TO assert_signal_tb_snapshot_containment_v1_legacy;
  END IF;
END;
$preserve_legacy_containment$;

CREATE OR REPLACE FUNCTION assert_signal_tb_snapshot_containment(
  target_tb_analysis_id uuid,target_stage text DEFAULT 'runtime'
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE analysis tb_analyses%ROWTYPE;
DECLARE snapshot corpus_snapshots%ROWTYPE;
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE actual_count integer;
DECLARE actual_digest text;
DECLARE noncanonical_count integer;
DECLARE post_freeze_count integer;
DECLARE coding_outside_count integer;
DECLARE citation_outside_count integer;
DECLARE evidence_outside_count integer;
BEGIN
  SELECT * INTO analysis FROM tb_analyses WHERE id=target_tb_analysis_id FOR SHARE;
  IF analysis.strategic_contract_version IS DISTINCT FROM 'signal-tb-strategic-v2' THEN
    RETURN assert_signal_tb_snapshot_containment_v1_legacy(target_tb_analysis_id,target_stage);
  END IF;
  SELECT * INTO snapshot FROM corpus_snapshots WHERE id=analysis.snapshot_id FOR SHARE;
  SELECT * INTO control FROM signal_strategic_run_controls
    WHERE tb_analysis_id=analysis.id FOR SHARE;
  SELECT count(*)::int,
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
      membership.mention_id::text,',' ORDER BY membership.mention_id),''),'UTF8')),'hex'),
    count(*) FILTER (WHERE mention.canonical_mention_id<>mention.id)::int,
    count(*) FILTER (WHERE mention.created_at>analysis.scope_frozen_at)::int
  INTO actual_count,actual_digest,noncanonical_count,post_freeze_count
  FROM corpus_snapshot_mentions membership JOIN mentions mention ON mention.id=membership.mention_id
  WHERE membership.snapshot_id=analysis.snapshot_id;
  SELECT count(*)::int INTO coding_outside_count FROM tb_mention_codings coding
  WHERE coding.tb_analysis_id=analysis.id AND NOT EXISTS (
    SELECT 1 FROM corpus_snapshot_mentions member
    WHERE member.snapshot_id=analysis.snapshot_id AND member.mention_id=coding.mention_id);
  SELECT count(*)::int INTO citation_outside_count FROM tb_finding_citations citation
  JOIN tb_findings finding ON finding.id=citation.finding_id
  WHERE finding.tb_analysis_id=analysis.id AND NOT EXISTS (
    SELECT 1 FROM corpus_snapshot_mentions member
    WHERE member.snapshot_id=analysis.snapshot_id AND member.mention_id=citation.mention_id);
  SELECT count(*)::int INTO evidence_outside_count FROM analysis_evidence_links evidence
  JOIN analysis_evidence_groups evidence_group ON evidence_group.id=evidence.evidence_group_id
  JOIN analysis_artifacts artifact ON artifact.id=evidence_group.artifact_id
  WHERE artifact.tb_analysis_id=analysis.id AND evidence.source_type='mention' AND NOT EXISTS (
    SELECT 1 FROM corpus_snapshot_mentions member
    WHERE member.snapshot_id=analysis.snapshot_id AND member.mention_id=evidence.source_id);
  IF snapshot.id IS NULL OR control.id IS NULL
     OR snapshot.strategic_authority_version<>'signal-strategic-snapshot-authority-v1'
     OR snapshot.policy_bundle_id IS DISTINCT FROM control.policy_bundle_id
     OR snapshot.policy_compilation_id IS DISTINCT FROM control.policy_compilation_id
     OR snapshot.governance_evaluation_id IS DISTINCT FROM control.governance_evaluation_id
     OR snapshot.source_watermark_digest IS DISTINCT FROM control.watermark_hash
     OR snapshot.governance_digest IS DISTINCT FROM control.governance_digest
     OR snapshot.provenance_digest IS DISTINCT FROM control.provenance_digest
     OR actual_count IS DISTINCT FROM snapshot.mention_count
     OR actual_count IS DISTINCT FROM analysis.snapshot_mention_count
     OR actual_digest IS DISTINCT FROM snapshot.snapshot_digest
     OR actual_digest IS DISTINCT FROM analysis.snapshot_digest
     OR noncanonical_count<>0 OR post_freeze_count<>0
     OR coding_outside_count<>0 OR citation_outside_count<>0 OR evidence_outside_count<>0 THEN
    RAISE EXCEPTION 'Governed T&B snapshot containment failed at stage %.',target_stage
      USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
    'contract_version','signal-tb-snapshot-containment-v2','stage',target_stage,
    'checked',true,'mention_count',actual_count,'snapshot_digest',actual_digest,
    'source_watermark_digest',snapshot.source_watermark_digest,
    'coding_outside_count',coding_outside_count,'citation_outside_count',citation_outside_count,
    'evidence_outside_count',evidence_outside_count,'contract_violation_count',0
  );
END;
$$;

DROP FUNCTION IF EXISTS reserve_signal_strategic_budget_tokens_v1(uuid,text,bigint,bigint,text);
CREATE OR REPLACE FUNCTION reserve_signal_strategic_budget_tokens_v1(
  target_run_control_id uuid,target_operation_key text,
  target_input_token_cap bigint,target_output_token_cap bigint,
  target_idempotency_key text
)
RETURNS TABLE (reservation_id uuid,created boolean,status text)
LANGUAGE plpgsql AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE persisted signal_strategic_budget_reservations%ROWTYPE;
DECLARE reservation_value numeric(14,6);
BEGIN
  IF target_input_token_cap<0 OR target_output_token_cap<0
     OR target_input_token_cap+target_output_token_cap<=0 THEN
    RAISE EXCEPTION 'Strategic budget token caps are invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:'||target_run_control_id::text,0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
  WHERE id=target_run_control_id FOR UPDATE;
  IF control.id IS NULL THEN
    RAISE EXCEPTION 'Strategic run is unavailable.' USING ERRCODE='23514';
  END IF;
  reservation_value:=ceil((
    target_input_token_cap::numeric*control.input_usd_per_million_tokens/1000000
    +target_output_token_cap::numeric*control.output_usd_per_million_tokens/1000000
  )*1000000)/1000000;
  SELECT * INTO persisted FROM signal_strategic_budget_reservations reservation
  WHERE reservation.run_control_id=target_run_control_id
    AND (reservation.idempotency_key=target_idempotency_key
      OR reservation.operation_key=target_operation_key) FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.operation_key IS DISTINCT FROM target_operation_key
       OR persisted.idempotency_key IS DISTINCT FROM target_idempotency_key
       OR persisted.reservation_usd IS DISTINCT FROM reservation_value
       OR persisted.reserved_input_tokens IS DISTINCT FROM target_input_token_cap
       OR persisted.reserved_output_tokens IS DISTINCT FROM target_output_token_cap THEN
      RAISE EXCEPTION 'Strategic provider operation key has incompatible inputs.'
        USING ERRCODE='23514';
    END IF;
    reservation_id:=persisted.id;created:=false;status:=persisted.status;
    RETURN NEXT;RETURN;
  END IF;
  reservation_id:=reserve_signal_strategic_budget_v1(
    target_run_control_id,target_operation_key,reservation_value,target_idempotency_key
  );
  UPDATE signal_strategic_budget_reservations reservation SET
    reserved_input_tokens=target_input_token_cap,
    reserved_output_tokens=target_output_token_cap
  WHERE reservation.id=reservation_id;
  created:=true;status:='reserved';RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION launch_signal_tb_strategic_run_v2(uuid,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_signal_strategic_budget_v1(uuid,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_signal_strategic_budget_tokens_v1(uuid,text,bigint,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION settle_signal_strategic_budget_v1(uuid,text,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_signal_strategic_budget_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_signal_strategic_step_dispatch_v1(integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_strategic_step_dispatch_v1(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_signal_strategic_step_dispatch_v1(
  uuid,uuid,timestamptz,jsonb,integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_signal_strategic_step_v1(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION heartbeat_signal_strategic_step_v1(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_strategic_step_v1(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_signal_strategic_step_v1(
  uuid,uuid,timestamptz,jsonb,boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_signal_strategic_run_cancel_v1(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_signal_strategic_run_v1(uuid,text[],text,text) FROM PUBLIC;

COMMENT ON TABLE signal_strategic_run_controls IS
  'Gate D server-owned run authority sealing governed policy, snapshot, provider identity and hard budget cap.';
COMMENT ON TABLE signal_strategic_sealed_sample_items IS
  'Deterministic canonical-root sample sealed before provider dispatch.';
COMMENT ON TABLE signal_strategic_budget_reservations IS
  'Transactional per-operation reservations enforcing the run hard cap.';
COMMENT ON TABLE signal_strategic_step_outbox IS
  'Durable recoverable dispatch state for every governed strategic pipeline step.';
