-- Gate D strategic populations are a server-owned union of the attributable
-- semantic base. 0074 accidentally pinned strategic derivations to the
-- primary-brand-only base. Replace only the affected derivation guards;
-- no policy, population, membership, compilation or binding is created here.

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
        NEW.workspace_id, 'all-governed', NEW.base_population_id
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
       target_workspace_id, 'all-governed', target_base_population_id
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

COMMENT ON FUNCTION ensure_signal_strategic_population_derivation_v1(
  uuid,uuid,uuid,text,text,uuid
) IS 'Ensures one strategic analysis population derived from the neutral attributable semantic base; never from an operational population or pointer.';
