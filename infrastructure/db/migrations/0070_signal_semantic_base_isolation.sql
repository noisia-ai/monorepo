-- Isolate the shared semantic Operational V2 candidate from governed-view policy.
--
-- The candidate created by 0064 is a workspace-owned semantic set. Quality,
-- retention, licensing, module/view identity and serving periods belong to the
-- policy bundle, derivation and compilation layers introduced by 0068/0069.
-- This migration normalizes only the semantic candidate definition; it does not
-- change memberships, pointers, bindings, compilations or visible readers.

CREATE OR REPLACE FUNCTION signal_operational_semantic_base_definition_v2()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'contract_version', 'signal-operational-primary-brand-semantic-v2',
    'canonical_only', true,
    'attribution_basis', 'mention_semantic',
    'attribution_review_status', 'approved',
    'eligibility_status', 'eligible',
    'allowed_scopes', jsonb_build_array('primary_brand'),
    'promotion_state', 'candidate_not_promoted'
  );
$$;

CREATE OR REPLACE FUNCTION signal_operational_semantic_base_definition_hash_v2(
  target_workspace_id uuid,
  target_population_version integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-operational-primary-brand-semantic-v2',
    target_workspace_id::text,
    target_population_version::text,
    'primary-brand-semantic',
    '1'
  ), 'UTF8')), 'hex');
$$;

-- Backend 04B ran only in the isolated rehearsal target and may have aligned
-- the shared base to a policy-specific definition. Reconstruct the exact 0064
-- identity deterministically. Membership and lineage columns are untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM signal_population_definitions population
    WHERE population.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
      AND (
        population.population_key IS DISTINCT FROM 'primary-brand-operational'
        OR population.purpose IS DISTINCT FROM 'operational'
        OR population.acceptance_status IS DISTINCT FROM 'included'
        OR population.allowed_scopes IS DISTINCT FROM ARRAY['primary_brand']::text[]
        OR population.min_quality_score IS NOT NULL
        OR population.period_start IS NOT NULL
        OR population.period_end IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Semantic Operational V2 base cannot be normalized because its 0064 structural identity has drifted.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE signal_population_definitions population
SET policy_key = 'primary-brand-semantic',
    policy_version = '1',
    definition_hash = signal_operational_semantic_base_definition_hash_v2(
      population.workspace_id,
      population.version
    ),
    definition = signal_operational_semantic_base_definition_v2(),
    updated_at = now()
WHERE population.definition->>'contract_version'
      = 'signal-operational-primary-brand-semantic-v2'
  AND (
    population.policy_key IS DISTINCT FROM 'primary-brand-semantic'
    OR population.policy_version IS DISTINCT FROM '1'
    OR population.definition_hash IS DISTINCT FROM
      signal_operational_semantic_base_definition_hash_v2(
        population.workspace_id,
        population.version
      )
    OR population.definition IS DISTINCT FROM
      signal_operational_semantic_base_definition_v2()
  );

CREATE OR REPLACE FUNCTION enforce_signal_operational_semantic_base_isolation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE semantic_contract text := 'signal-operational-primary-brand-semantic-v2';
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.definition->>'contract_version' = semantic_contract
     AND NEW.definition->>'contract_version' IS DISTINCT FROM semantic_contract THEN
    RAISE EXCEPTION 'Semantic Operational V2 base identity cannot be replaced.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.definition->>'contract_version' IS DISTINCT FROM semantic_contract THEN
    RETURN NEW;
  END IF;
  IF NEW.population_key IS DISTINCT FROM 'primary-brand-operational'
     OR NEW.purpose IS DISTINCT FROM 'operational'
     OR NEW.acceptance_status IS DISTINCT FROM 'included'
     OR NEW.allowed_scopes IS DISTINCT FROM ARRAY['primary_brand']::text[]
     OR NEW.min_quality_score IS NOT NULL
     OR NEW.period_start IS NOT NULL
     OR NEW.period_end IS NOT NULL
     OR NEW.policy_key IS DISTINCT FROM 'primary-brand-semantic'
     OR NEW.policy_version IS DISTINCT FROM '1'
     OR NEW.definition IS DISTINCT FROM signal_operational_semantic_base_definition_v2()
     OR NEW.definition_hash IS DISTINCT FROM
       signal_operational_semantic_base_definition_hash_v2(NEW.workspace_id, NEW.version) THEN
    RAISE EXCEPTION 'Semantic Operational V2 base cannot contain policy, module, period or governance authority state.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_operational_semantic_base_isolation_v2
  ON signal_population_definitions;
CREATE TRIGGER trg_signal_operational_semantic_base_isolation_v2
  BEFORE INSERT OR UPDATE OF workspace_id, population_key, version, purpose,
    acceptance_status, allowed_scopes, min_quality_score, period_start,
    period_end, definition_hash, policy_key, policy_version, definition
  ON signal_population_definitions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_operational_semantic_base_isolation_v2();

COMMENT ON FUNCTION signal_operational_semantic_base_definition_v2 IS
  'Exact neutral definition of the shared semantic primary-brand candidate introduced by 0064.';
COMMENT ON FUNCTION signal_operational_semantic_base_definition_hash_v2 IS
  'Reproduces the 0064 semantic candidate identity hash without policy-specific state.';
COMMENT ON FUNCTION enforce_signal_operational_semantic_base_isolation_v2 IS
  'Rejects quality, retention, licensing, period, module/view or policy-bundle contamination of the shared semantic candidate.';
