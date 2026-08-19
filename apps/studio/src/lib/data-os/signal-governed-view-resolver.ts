import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  SignalBackendContractError,
  assertSignalGovernedPolicyViewContractV1,
  assertSignalGovernedViewCompatibilityV1,
  compileSignalPopulationPolicyBundleV1,
  normalizeSignalGovernedViewKeyV1,
  normalizeSignalGovernedViewModuleKeyV1,
  signalDataUsagePurposesForModuleViewV1,
  signalGovernedViewCompilationPlanHashV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  type SignalGovernedViewDescriptorV1,
  type SignalGovernedViewKeyV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalMentionScopeV1,
  type SignalPolicyEligibilityKeyV1,
  type SignalPolicyVisibilityClassV1,
  type SignalPolicyDenominatorKeyV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

export type SignalGovernedViewBindingStoreRow = {
  workspace_id: string;
  evaluation_now: string;
  binding_id: string;
  binding_version: number;
  module_key: string;
  view_key: string;
  binding_status: string;
  binding_effective_from: string;
  binding_effective_to: string | null;
  policy_bundle_id: string;
  policy_workspace_id: string;
  policy_key: string;
  policy_version: number;
  policy_status: string;
  policy_effective_from: string;
  policy_effective_to: string | null;
  policy_definition_hash: string;
  bundle_definition_hash: string;
  authorized_modules: string[];
  allowed_scopes: string[];
  allowed_entities: Array<{ scope: string; entity_type: string; entity_id: string }>;
  acceptance_status: string;
  quality_contract_status: string;
  quality_policy_key: string | null;
  quality_policy_version: number | null;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  eligibility_policy: string;
  deduplication_policy: string;
  visibility_class: string;
  denominator_key: string;
  period_start: string | null;
  period_end: string | null;
  timezone: string | null;
  retention_policy_ref: string | null;
  licensing_policy_ref: string | null;
  data_governance_contract_status: string;
  quality_policy_id: string | null;
  required_usage_purposes: string[];
  population_id: string | null;
  population_workspace_id: string | null;
  population_status: string | null;
  population_key: string | null;
  population_version: number | null;
  population_definition_hash: string | null;
  membership_digest: string | null;
  policy_compilation_id: string | null;
  compilation_workspace_id: string | null;
  compilation_policy_bundle_id: string | null;
  compilation_population_id: string | null;
  compilation_population_version: number | null;
  compiled_plan_hash: string | null;
  compilation_status: string | null;
  compilation_is_current: boolean | null;
  compilation_policy_definition_hash: string | null;
  compilation_population_definition_hash: string | null;
  compilation_membership_digest: string | null;
  compilation_invalidated: boolean;
  compilation_module_key: string | null;
  compilation_view_key: string | null;
  compilation_next_policy_transition_at: string | null;
  compilation_temporally_valid: boolean;
  governance_data_watermark_id: string | null;
  governance_data_watermark_workspace_id: string | null;
  governance_data_watermark_population_id: string | null;
  population_derivation_valid: boolean;
  live_entity_authority_valid: boolean;
};

export type SignalOperationalBrandBridgeStoreRow = {
  workspace_id: string;
  population_id: string;
  population_key: string;
  population_version: number;
  population_definition_hash: string;
  membership_digest: string | null;
  acceptance_status: "included" | "any";
  allowed_scopes: SignalMentionScopeV1[];
  min_quality_score: number | null;
  period_start: string | null;
  period_end: string | null;
};

export interface SignalGovernedViewResolverStore {
  loadCurrentBinding(args: {
    workspaceId: string;
    moduleKey: SignalGovernedViewModuleKeyV1;
    viewKey: SignalGovernedViewKeyV1;
  }): Promise<SignalGovernedViewBindingStoreRow | null>;
  loadOperationalBrandBridge(workspaceId: string): Promise<SignalOperationalBrandBridgeStoreRow | null>;
}

export type SignalGovernedViewResolverQuery = <Row>(
  sql: string,
  values: unknown[]
) => Promise<Row[]>;

export async function resolveSignalGovernedViewV1(
  workspace: ResolvedSignalWorkspace,
  input: { module_key: unknown; view_key: unknown },
  store: SignalGovernedViewResolverStore = postgresSignalGovernedViewResolverStore
): Promise<SignalGovernedViewDescriptorV1> {
  let moduleKey: SignalGovernedViewModuleKeyV1;
  let viewKey: SignalGovernedViewKeyV1;
  try {
    moduleKey = normalizeSignalGovernedViewModuleKeyV1(input.module_key);
    viewKey = normalizeSignalGovernedViewKeyV1(input.view_key);
    assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  } catch (error) {
    throw new SignalBackendContractError(
      "invalid_filter",
      error instanceof Error ? error.message : "Governed view identity is invalid.",
      { reason: "governed_view_identity_invalid" }
    );
  }

  const row = await store.loadCurrentBinding({ workspaceId: workspace.id, moduleKey, viewKey });
  if (!row) {
    return resolveOperationalBrandBridge(workspace, moduleKey, viewKey, store);
  }
  const bindingIsEffective = isEffectiveAt(
    row.binding_effective_from,
    row.binding_effective_to,
    row.evaluation_now
  );
  const policyIsEffective = isEffectiveAt(
    row.policy_effective_from,
    row.policy_effective_to,
    row.evaluation_now
  );
  if (row.workspace_id !== workspace.id
    || row.module_key !== moduleKey
    || row.view_key !== viewKey
    || row.binding_status !== "current"
    || !bindingIsEffective
    || row.policy_workspace_id !== workspace.id
    || row.policy_status !== "active"
    || !policyIsEffective
    || row.bundle_definition_hash !== row.policy_definition_hash
    || !row.population_id
    || row.population_workspace_id !== workspace.id
    || !["draft", "active"].includes(row.population_status ?? "")
    || !row.population_key
    || !row.population_version
    || !row.population_definition_hash
    || !row.membership_digest
    || !row.policy_compilation_id
    || row.compilation_workspace_id !== workspace.id
    || row.compilation_policy_bundle_id !== row.policy_bundle_id
    || row.compilation_population_id !== row.population_id
    || row.compilation_population_version !== row.population_version
    || row.compilation_status !== "ready"
    || row.compilation_is_current !== true
    || row.compilation_policy_definition_hash !== row.policy_definition_hash
    || row.compilation_population_definition_hash !== row.population_definition_hash
    || row.compilation_membership_digest !== row.membership_digest
    || row.compilation_invalidated
    || row.compilation_module_key !== moduleKey
    || row.compilation_view_key !== viewKey
    || !row.compilation_temporally_valid
    || !row.governance_data_watermark_id
    || row.governance_data_watermark_workspace_id !== workspace.id
    || row.governance_data_watermark_population_id !== row.population_id
    || !row.population_derivation_valid
    || !row.live_entity_authority_valid) {
    throw unavailable("governed_view_binding_contract_invalid");
  }

  try {
    const definition = validateSignalPopulationPolicyBundleDefinitionV1({
      contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
      workspace_id: row.workspace_id,
      policy_key: row.policy_key,
      policy_version: row.policy_version,
      authorized_modules: row.authorized_modules,
      allowed_scopes: row.allowed_scopes as SignalMentionScopeV1[],
      allowed_entities: row.allowed_entities,
      acceptance_status: row.acceptance_status,
      quality_contract_status: row.quality_contract_status,
      quality_policy_key: row.quality_policy_key,
      quality_policy_version: row.quality_policy_version,
      min_quality_score: row.min_quality_score,
      required_quality_flags: row.required_quality_flags,
      forbidden_quality_flags: row.forbidden_quality_flags,
      eligibility_policy: row.eligibility_policy as SignalPolicyEligibilityKeyV1,
      deduplication_policy: row.deduplication_policy,
      visibility_class: row.visibility_class as SignalPolicyVisibilityClassV1,
      denominator_key: row.denominator_key as SignalPolicyDenominatorKeyV1,
      period_start: row.period_start,
      period_end: row.period_end,
      timezone: row.timezone,
      retention_policy_ref: row.retention_policy_ref,
      licensing_policy_ref: row.licensing_policy_ref,
      data_governance_contract_status: row.data_governance_contract_status,
      quality_policy_id: row.quality_policy_id,
      required_usage_purposes: row.required_usage_purposes
    });
    const compiled = compileSignalPopulationPolicyBundleV1({
      policy_bundle_id: row.policy_bundle_id,
      definition_hash: row.policy_definition_hash,
      definition
    });
    const modulePlanHash = signalGovernedViewCompilationPlanHashV1({
      base_plan_hash: compiled.plan_hash,
      module_key: moduleKey,
      view_key: viewKey,
      authorized_modules: definition.authorized_modules,
      capability_usage_purposes: definition.required_usage_purposes
    });
    if (row.population_id && row.compiled_plan_hash !== modulePlanHash) {
      throw new Error("Governed population compilation hash is stale.");
    }
    assertSignalGovernedPolicyViewContractV1(moduleKey, viewKey, definition);
    const moduleUsagePurposes = signalDataUsagePurposesForModuleViewV1(moduleKey, viewKey);
    return {
      contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
      workspace_id: workspace.id,
      module_key: moduleKey,
      view_key: viewKey,
      resolution_source: "governed-binding",
      binding: {
        workspace_id: workspace.id,
        binding_id: row.binding_id,
        binding_version: row.binding_version,
        module_key: moduleKey,
        view_key: viewKey
      },
      policy: compiled.policy,
      population: row.population_id && row.population_key && row.population_version
        && row.population_definition_hash
        ? {
            population_id: row.population_id,
            population_key: row.population_key,
            population_version: row.population_version,
            definition_hash: row.population_definition_hash,
            membership_digest: row.membership_digest,
            policy_compilation_id: row.policy_compilation_id,
            compiled_plan_hash: row.compiled_plan_hash,
            compilation_status: row.compilation_status as "ready"
          }
        : null,
      read_contract: {
        authority_source: "compiled-policy",
        predicate: {
          ...compiled.predicate,
          data_governance: {
            ...compiled.predicate.data_governance,
            required_usage_purposes: moduleUsagePurposes
          }
        }
      },
      visibility_class: definition.visibility_class,
      denominator: compiled.denominator
    };
  } catch {
    throw unavailable("governed_view_policy_contract_invalid");
  }
}

async function resolveOperationalBrandBridge(
  workspace: ResolvedSignalWorkspace,
  moduleKey: SignalGovernedViewModuleKeyV1,
  viewKey: SignalGovernedViewKeyV1,
  store: SignalGovernedViewResolverStore
): Promise<SignalGovernedViewDescriptorV1> {
  const bridgeEligible = viewKey === "brand"
    && ["brand-monitoring", "mentions", "topics-narratives"].includes(moduleKey);
  if (!bridgeEligible) throw unavailable("governed_view_binding_not_available");
  const bridge = await store.loadOperationalBrandBridge(workspace.id);
  if (!bridge || bridge.workspace_id !== workspace.id) {
    throw unavailable("operational_brand_bridge_not_available");
  }
  return {
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspace.id,
    module_key: moduleKey,
    view_key: viewKey,
    resolution_source: "operational-brand-bridge",
    binding: null,
    policy: {
      workspace_id: workspace.id,
      policy_bundle_id: null,
      policy_key: "operational-pointer-brand-bridge",
      policy_version: bridge.population_version,
      definition_hash: bridge.population_definition_hash
    },
    population: {
      population_id: bridge.population_id,
      population_key: bridge.population_key,
      population_version: bridge.population_version,
      definition_hash: bridge.population_definition_hash,
      membership_digest: bridge.membership_digest,
      policy_compilation_id: null,
      compiled_plan_hash: null,
      compilation_status: null
    },
    read_contract: {
      authority_source: "operational-population",
      acceptance_status: bridge.acceptance_status,
      allowed_scopes: bridge.allowed_scopes,
      min_quality_score: bridge.min_quality_score,
      period_start: bridge.period_start,
      period_end: bridge.period_end
    },
    visibility_class: "client-safe",
    denominator: {
      key: "eligible-canonical-roots",
      unit: "canonical-root",
      deduplication_policy: "canonical-root"
    }
  };
}

function unavailable(reason: string) {
  return new SignalBackendContractError(
    "not_available",
    "Governed view is unavailable for this workspace.",
    { reason }
  );
}

function isEffectiveAt(from: string, to: string | null, at: string): boolean {
  const fromMillis = Date.parse(from);
  const toMillis = to == null ? null : Date.parse(to);
  const atMillis = Date.parse(at);
  return Number.isFinite(fromMillis)
    && Number.isFinite(atMillis)
    && (toMillis == null || Number.isFinite(toMillis))
    && fromMillis <= atMillis
    && (toMillis == null || toMillis > atMillis);
}

export function createPostgresSignalGovernedViewResolverStore(
  query: SignalGovernedViewResolverQuery
): SignalGovernedViewResolverStore {
  return {
    async loadCurrentBinding(args) {
      const rows = await query<SignalGovernedViewBindingStoreRow>(`
      SELECT
        binding.workspace_id::text,
        statement_timestamp()::text AS evaluation_now,
        binding.id::text AS binding_id,
        binding.binding_version,
        binding.module_key,
        binding.view_key,
        binding.binding_status,
        binding.effective_from::text AS binding_effective_from,
        binding.effective_to::text AS binding_effective_to,
        bundle.id::text AS policy_bundle_id,
        bundle.workspace_id::text AS policy_workspace_id,
        bundle.policy_key,
        bundle.policy_version,
        bundle.status AS policy_status,
        bundle.effective_from::text AS policy_effective_from,
        bundle.effective_to::text AS policy_effective_to,
        binding.policy_definition_hash,
        bundle.definition_hash AS bundle_definition_hash,
        bundle.authorized_modules,
        bundle.allowed_scopes,
        COALESCE(entity.entities, '[]'::jsonb) AS allowed_entities,
        bundle.acceptance_status,
        bundle.quality_contract_status,
        bundle.quality_policy_key,
        bundle.quality_policy_version,
        bundle.min_quality_score,
        bundle.required_quality_flags,
        bundle.forbidden_quality_flags,
        bundle.eligibility_policy,
        bundle.deduplication_policy,
        bundle.visibility_class,
        bundle.denominator_key,
        bundle.period_start::text,
        bundle.period_end::text,
        bundle.timezone,
        bundle.retention_policy_ref,
        bundle.licensing_policy_ref,
        bundle.data_governance_contract_status,
        bundle.quality_policy_id::text,
        bundle.required_usage_purposes,
        population.id::text AS population_id,
        population.workspace_id::text AS population_workspace_id,
        population.status AS population_status,
        population.population_key,
        population.version AS population_version,
        population.definition_hash AS population_definition_hash,
        population.membership_digest,
        compilation.id::text AS policy_compilation_id,
        compilation.workspace_id::text AS compilation_workspace_id,
        compilation.policy_bundle_id::text AS compilation_policy_bundle_id,
        compilation.population_id::text AS compilation_population_id,
        compilation.population_version AS compilation_population_version,
        compilation.compiled_plan_hash,
        compilation.compilation_status,
        compilation.is_current AS compilation_is_current,
        compilation.policy_definition_hash AS compilation_policy_definition_hash,
        compilation.population_definition_hash AS compilation_population_definition_hash,
        compilation.membership_digest AS compilation_membership_digest,
        compilation.module_key AS compilation_module_key,
        compilation.view_key AS compilation_view_key,
        compilation.next_policy_transition_at::text AS compilation_next_policy_transition_at,
        (compilation.next_policy_transition_at IS NULL
          OR compilation.next_policy_transition_at > statement_timestamp()) AS compilation_temporally_valid,
        compilation.governance_data_watermark_id::text,
        watermark.workspace_id::text AS governance_data_watermark_workspace_id,
        watermark.population_id::text AS governance_data_watermark_population_id,
        (derivation.id IS NOT NULL) AS population_derivation_valid,
        EXISTS (
          SELECT 1
          FROM signal_workspaces active_workspace
          WHERE active_workspace.id = bundle.workspace_id
            AND active_workspace.status = 'active'
        ) AND NOT EXISTS (
          SELECT 1
          FROM signal_population_policy_entities governed_entity
          JOIN signal_workspaces governed_workspace
            ON governed_workspace.id = bundle.workspace_id
          WHERE governed_entity.policy_bundle_id = bundle.id
            AND governed_entity.workspace_id = bundle.workspace_id
            AND NOT CASE governed_entity.scope
              WHEN 'primary_brand' THEN governed_entity.entity_type = 'brand'
                AND governed_entity.entity_id = governed_workspace.brand_id
              WHEN 'competitor' THEN governed_entity.entity_type = 'competitor'
                AND EXISTS (
                  SELECT 1
                  FROM competitors competitor
                  JOIN brand_seeds seed
                    ON seed.id = competitor.competitor_brand_seed_id
                  WHERE competitor.id = governed_entity.entity_id
                    AND competitor.brand_id = governed_workspace.brand_id
                    AND competitor.status = 'current'
                    AND seed.active
                )
              WHEN 'category' THEN governed_entity.entity_type = 'category'
                AND EXISTS (
                  SELECT 1
                  FROM intelligence_entities intelligence_entity
                  WHERE intelligence_entity.id = governed_entity.entity_id
                    AND intelligence_entity.organization_id = governed_workspace.organization_id
                    AND intelligence_entity.brand_id = governed_workspace.brand_id
                    AND intelligence_entity.entity_type = 'category'
                    AND intelligence_entity.status = 'active'
                )
              WHEN 'reference' THEN governed_entity.entity_type = 'reference'
                AND EXISTS (
                  SELECT 1
                  FROM intelligence_entities intelligence_entity
                  WHERE intelligence_entity.id = governed_entity.entity_id
                    AND intelligence_entity.organization_id = governed_workspace.organization_id
                    AND intelligence_entity.brand_id = governed_workspace.brand_id
                    AND intelligence_entity.entity_type = 'reference'
                    AND intelligence_entity.status = 'active'
                )
              ELSE false
            END
        ) AS live_entity_authority_valid,
        EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
          WHERE invalidation.policy_compilation_id = compilation.id) AS compilation_invalidated
      FROM signal_governed_view_bindings binding
      JOIN signal_population_policy_bundles bundle
        ON bundle.id = binding.policy_bundle_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'scope', allowed.scope,
          'entity_type', allowed.entity_type,
          'entity_id', allowed.entity_id::text
        ) ORDER BY allowed.scope, allowed.entity_type, allowed.entity_id) AS entities
        FROM signal_population_policy_entities allowed
        WHERE allowed.policy_bundle_id = bundle.id
          AND allowed.workspace_id = bundle.workspace_id
      ) entity ON true
      LEFT JOIN signal_population_definitions population
        ON population.id = binding.population_id
      LEFT JOIN signal_population_policy_compilations compilation
        ON compilation.id = binding.policy_compilation_id
      LEFT JOIN signal_data_watermarks watermark
        ON watermark.id = compilation.governance_data_watermark_id
      LEFT JOIN signal_governed_view_population_derivations derivation
        ON derivation.workspace_id = binding.workspace_id
       AND derivation.module_key = binding.module_key
       AND derivation.view_key = binding.view_key
       AND derivation.policy_bundle_id = binding.policy_bundle_id
       AND derivation.resolved_population_id = binding.population_id
       AND derivation.policy_definition_hash = binding.policy_definition_hash
       AND derivation.compiled_plan_hash = compilation.compiled_plan_hash
      WHERE binding.workspace_id = $1::uuid
        AND binding.module_key = $2
        AND binding.view_key = $3
        AND binding.binding_status = 'current'
      LIMIT 1
      `, [args.workspaceId, args.moduleKey, args.viewKey]);
      return rows[0] ?? null;
    },

    async loadOperationalBrandBridge(workspaceId) {
      const rows = await query<SignalOperationalBrandBridgeStoreRow>(`
      SELECT
        pointer.workspace_id::text,
        definition.id::text AS population_id,
        definition.population_key,
        definition.version AS population_version,
        definition.definition_hash AS population_definition_hash,
        definition.membership_digest,
        definition.acceptance_status,
        definition.allowed_scopes,
        definition.min_quality_score,
        definition.period_start::text,
        definition.period_end::text
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition
        ON definition.id = pointer.population_id
       AND definition.workspace_id = pointer.workspace_id
      WHERE pointer.workspace_id = $1::uuid
        AND pointer.purpose = 'operational'
        AND definition.status = 'active'
        AND definition.acceptance_status = 'included'
        AND definition.allowed_scopes = ARRAY['primary_brand']::text[]
      LIMIT 1
      `, [workspaceId]);
      return rows[0] ?? null;
    }
  };
}

const postgresSignalGovernedViewResolverStore = createPostgresSignalGovernedViewResolverStore(
  async <Row>(sql: string, values: unknown[]) => {
    const { pool } = await import("@/lib/db");
    const result = await pool.query(sql, values);
    return result.rows as Row[];
  }
);
