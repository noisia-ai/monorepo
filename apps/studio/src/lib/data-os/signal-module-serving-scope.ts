import {
  SIGNAL_SERVING_SCOPE_CONTRACT_VERSION,
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  SignalBackendContractError,
  buildSignalPopulationMentionReadPredicateV1,
  buildSignalWorkspaceCanonicalMentionReadPredicateV1,
  normalizeSignalClientGovernedViewKeyV1,
  signalGovernedModuleViewContractV1,
  signalServingScopeIdentityHashV1,
  signalServingUsagePurposesForModuleViewV1,
  validateSignalServingScopeDescriptorV1,
  validateSignalCoverageDescriptorV1,
  type SignalFilterV1,
  type SignalClientGovernedViewKeyV1,
  type SignalGovernedViewDescriptorV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalOperationalReadModeV1,
  type SignalServingScopeDescriptorV1
} from "@noisia/query-engine";

import {
  resolveSignalGovernedViewV1,
  type SignalGovernedViewResolverStore
} from "@/lib/data-os/signal-governed-view-resolver";
import {
  resolveSignalOperationalReadScopeV1,
  signalOperationalReadMode,
  type SignalOperationalReadScopeV1
} from "@/lib/data-os/signal-operational-read-scope";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

export const SIGNAL_BRAND_SERVING_MODULE_KEYS = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalGovernedViewModuleKeyV1[];

export type SignalBrandServingModuleKeyV1 =
  (typeof SIGNAL_BRAND_SERVING_MODULE_KEYS)[number];

export type SignalModuleGovernedResolutionV1 =
  | {
      state: "available";
      descriptor: SignalGovernedViewDescriptorV1;
      readScope: SignalOperationalReadScopeV1;
    }
  | {
      state: "not_available";
      reason: string;
      descriptor: null;
      readScope: null;
    };

/**
 * Server-owned resolution for one product module and the canonical `brand` view.
 *
 * The browser never supplies a population, binding, policy bundle or rollout mode.
 * Shadow keeps the legacy read scope visible while retaining the exact governed
 * population that background reconciliation must use.
 */
export type SignalModuleServingScopeV1 = {
  workspace_id: string;
  module_key: SignalBrandServingModuleKeyV1;
  view_key: SignalClientGovernedViewKeyV1;
  rollout_mode: SignalOperationalReadModeV1;
  visible_source: "legacy" | "governed-binding" | "operational-brand-bridge";
  readScope: SignalOperationalReadScopeV1;
  governed: SignalModuleGovernedResolutionV1;
};

export type SignalClientEvidenceServingScopeV1 =
  | {
      state: "available";
      reason: null;
      readScope: SignalOperationalReadScopeV1;
      servingScope: SignalServingScopeDescriptorV1;
    }
  | {
      state: "not_available";
      reason: string;
      readScope: null;
      servingScope: null;
    };

type SignalModuleServingScopeDependencies = {
  resolveLegacyScope?: typeof resolveSignalOperationalReadScopeV1;
  resolveGovernedView?: typeof resolveSignalGovernedViewV1;
  governedStore?: SignalGovernedViewResolverStore;
};

export type SignalModuleServingQueryable = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

const FORBIDDEN_CLIENT_AUTHORITY_PARAMS = [
  "population_id",
  "populationId",
  "policy_bundle_id",
  "policyBundleId",
  "binding_id",
  "bindingId",
  "read_mode",
  "readMode",
  "mode",
  "view_key"
] as const;

/**
 * Parses the single public product selector. All authority identities stay
 * server-owned and are rejected instead of being silently ignored.
 */
export function signalClientServingViewFromRequestV1(
  request: Request
): SignalClientGovernedViewKeyV1 {
  const params = new URL(request.url).searchParams;
  const forbidden = FORBIDDEN_CLIENT_AUTHORITY_PARAMS.find((key) => params.has(key));
  if (forbidden) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Signal serving authority is resolved by the authenticated server boundary.",
      { field: forbidden, reason: "client_serving_authority_not_allowed" }
    );
  }
  return requireClientServingViewKey(params.get("view") ?? "brand");
}

export async function resolveSignalModuleServingScopeV1(
  workspace: ResolvedSignalWorkspace,
  moduleKeyInput: SignalBrandServingModuleKeyV1,
  options: {
    mode?: SignalOperationalReadModeV1;
    viewKey?: unknown;
    dependencies?: SignalModuleServingScopeDependencies;
  } = {}
): Promise<SignalModuleServingScopeV1> {
  const moduleKey = requireBrandServingModuleKey(moduleKeyInput);
  const viewKey = requireClientServingViewKey(options.viewKey ?? "brand");
  const mode = options.mode ?? signalOperationalReadMode();
  const resolveLegacy = options.dependencies?.resolveLegacyScope
    ?? resolveSignalOperationalReadScopeV1;
  const resolveGoverned = options.dependencies?.resolveGovernedView
    ?? resolveSignalGovernedViewV1;

  if (mode === "legacy") {
    requireBrandBridgeView(viewKey, mode);
    const readScope = await resolveLegacy(workspace, { mode: "legacy" });
    return {
      workspace_id: workspace.id,
      module_key: moduleKey,
      view_key: viewKey,
      rollout_mode: mode,
      visible_source: "legacy",
      readScope,
      governed: {
        state: "not_available",
        reason: "governed_resolution_not_requested",
        descriptor: null,
        readScope: null
      }
    };
  }

  let descriptor: SignalGovernedViewDescriptorV1;
  try {
    descriptor = await resolveGoverned(
      workspace,
      { module_key: moduleKey, view_key: viewKey },
      options.dependencies?.governedStore
    );
  } catch (error) {
    if (mode === "governed" || viewKey !== "brand") throw error;
    const readScope = await resolveLegacy(workspace, { mode: "legacy" });
    return {
      workspace_id: workspace.id,
      module_key: moduleKey,
      view_key: viewKey,
      rollout_mode: mode,
      visible_source: "legacy",
      readScope: asShadowLegacyScope(readScope, null),
      governed: {
        state: "not_available",
        reason: contractReason(error),
        descriptor: null,
        readScope: null
      }
    };
  }

  const governedReadScope = governedDescriptorReadScope(
    workspace,
    descriptor,
    mode,
    viewKey
  );
  if (mode === "governed") {
    return {
      workspace_id: workspace.id,
      module_key: moduleKey,
      view_key: viewKey,
      rollout_mode: mode,
      visible_source: descriptor.resolution_source,
      readScope: governedReadScope,
      governed: {
        state: "available",
        descriptor,
        readScope: governedReadScope
      }
    };
  }

  requireBrandBridgeView(viewKey, mode);
  const legacyReadScope = await resolveLegacy(workspace, { mode: "legacy" });
  return {
    workspace_id: workspace.id,
    module_key: moduleKey,
    view_key: viewKey,
    rollout_mode: mode,
    visible_source: "legacy",
    readScope: asShadowLegacyScope(legacyReadScope, governedReadScope),
    governed: {
      state: "available",
      descriptor,
      readScope: governedReadScope
    }
  };
}

/**
 * Resolves the client-visible Mentions capability used by metric modules.
 *
 * Evidence is a narrower capability than metrics. A stale, missing, bridged or
 * otherwise invalid Mentions authority therefore withholds rows/excerpts without
 * widening the metric population or making the metric module unreadable. Unknown
 * infrastructure errors still propagate; only governed contract unavailability is
 * converted into an explicit, literal `not_available` capability.
 */
export async function resolveSignalClientEvidenceServingScopeV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  viewKey?: unknown;
  resolvedScope?: SignalModuleServingScopeV1;
  dependencies?: SignalModuleServingScopeDependencies;
  queryable?: SignalModuleServingQueryable;
}): Promise<SignalClientEvidenceServingScopeV1> {
  try {
    const viewKey = requireClientServingViewKey(
      args.viewKey ?? args.resolvedScope?.view_key ?? "brand"
    );
    const scope = args.resolvedScope ?? await resolveSignalModuleServingScopeV1(
      args.workspace,
      "mentions",
      {
        mode: "governed",
        viewKey,
        ...(args.dependencies ? { dependencies: args.dependencies } : {})
      }
    );
    if (scope.workspace_id !== args.workspace.id
      || scope.module_key !== "mentions"
      || scope.view_key !== viewKey
      || scope.rollout_mode !== "governed"
      || scope.visible_source !== "governed-binding"
      || scope.governed.state !== "available"
      || scope.governed.descriptor.resolution_source !== "governed-binding") {
      return {
        state: "not_available",
        reason: "mentions_capability_not_available",
        readScope: null,
        servingScope: null
      };
    }
    const servingScope = await finalizeSignalModuleServingScopeV1({
      scope,
      filter: args.filter,
      ...(args.queryable ? { queryable: args.queryable } : {})
    });
    return {
      state: "available",
      reason: null,
      readScope: scope.readScope,
      servingScope
    };
  } catch (error) {
    if (!(error instanceof SignalBackendContractError)) throw error;
    return {
      state: "not_available",
      reason: contractReason(error),
      readScope: null,
      servingScope: null
    };
  }
}

export function governedDescriptorReadScope(
  workspace: ResolvedSignalWorkspace,
  descriptor: SignalGovernedViewDescriptorV1,
  mode: "shadow" | "governed",
  viewKeyInput: unknown = descriptor.view_key
): SignalOperationalReadScopeV1 {
  const viewKey = requireClientServingViewKey(viewKeyInput);
  if (descriptor.workspace_id !== workspace.id
    || descriptor.view_key !== viewKey
    || !SIGNAL_BRAND_SERVING_MODULE_KEYS.includes(
      descriptor.module_key as SignalBrandServingModuleKeyV1
    )
    || !descriptor.population) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed module serving scope is incompatible with this workspace.",
      { reason: "governed_module_scope_incompatible" }
    );
  }
  const contract = descriptor.read_contract;
  const compiledPredicate = contract.authority_source === "compiled-policy"
    ? contract.predicate
    : null;
  const semanticAssertion = compiledPredicate?.semantic_assertion ?? null;
  const acceptanceStatus = contract.authority_source === "compiled-policy"
    ? contract.predicate.acceptance_status
    : contract.acceptance_status;
  const allowedScopes = contract.authority_source === "compiled-policy"
    ? contract.predicate.semantic_assertion?.allowed_scopes ?? []
    : contract.allowed_scopes;
  const moduleViewContract = signalGovernedModuleViewContractV1(
    descriptor.module_key,
    viewKey
  );
  const compiledUsages = compiledPredicate?.data_governance.required_usage_purposes ?? [];
  const allowedEntities = semanticAssertion?.allowed_entities ?? [];
  const exactScopes = [...allowedScopes].sort().join("|")
    === [...moduleViewContract.allowed_scopes].sort().join("|");
  const governedUnionScopes = allowedScopes.length > 0
    && allowedScopes.every((scope) => moduleViewContract.allowed_scopes.includes(
      scope as (typeof moduleViewContract.allowed_scopes)[number]
    ));
  const expectedUsages = signalServingUsagePurposesForModuleViewV1(
    descriptor.module_key,
    viewKey
  );
  const entityScopes = [...new Set(allowedEntities.map((entity) => entity.scope))].sort();
  const policyContractValid = contract.authority_source === "compiled-policy"
    ? Boolean(semanticAssertion)
      && compiledPredicate?.quality.contract_status === "resolved"
      && compiledPredicate.data_governance.contract_status === "resolved"
      && (moduleViewContract.scope_mode === "exact" ? exactScopes : governedUnionScopes)
      && compiledUsages.length === expectedUsages.length
      && expectedUsages.every((purpose) => compiledUsages.includes(purpose))
      && entityScopes.join("|") === [...allowedScopes].sort().join("|")
      && allowedEntities.every((entity) =>
        allowedScopes.includes(entity.scope)
        && moduleViewContract.allowed_entity_types.includes(entity.entity_type)
        && expectedEntityTypeForScope(entity.scope) === entity.entity_type)
      && (viewKey !== "brand" || (
        allowedEntities.length === 1
        && allowedEntities[0]?.entity_type === "brand"
        && allowedEntities[0]?.entity_id === workspace.subject.id
      ))
    : viewKey === "brand"
      && exactScopes
      && descriptor.resolution_source === "operational-brand-bridge";
  if (acceptanceStatus !== "included"
    || !policyContractValid
    || (descriptor.resolution_source === "governed-binding"
      && (contract.authority_source !== "compiled-policy" || !semanticAssertion))
    || (descriptor.resolution_source === "operational-brand-bridge"
      && (viewKey !== "brand" || contract.authority_source !== "operational-population"))) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed module serving policy is incompatible with this client view.",
      { reason: "governed_module_policy_contract_invalid" }
    );
  }
  const quality = compiledPredicate?.quality ?? null;
  const period = compiledPredicate?.period ?? null;
  const bridgeMinQualityScore = contract.authority_source === "operational-population"
    ? contract.min_quality_score
    : null;
  const bridgePeriodStart = contract.authority_source === "operational-population"
    ? contract.period_start
    : null;
  const bridgePeriodEnd = contract.authority_source === "operational-population"
    ? contract.period_end
    : null;
  const population = {
    id: descriptor.population.population_id,
    key: descriptor.population.population_key,
    version: descriptor.population.population_version,
    definition_hash: descriptor.population.definition_hash,
    acceptance_status: acceptanceStatus,
    allowed_scopes: [...allowedScopes],
    quality_contract_status: quality?.contract_status ?? "not_available",
    quality_policy_key: quality?.policy_key ?? null,
    quality_policy_version: quality?.policy_version ?? null,
    min_quality_score: quality?.min_score ?? bridgeMinQualityScore,
    required_quality_flags: quality ? [...quality.required_flags] : [],
    forbidden_quality_flags: quality ? [...quality.forbidden_flags] : [],
    period_start: period?.start ?? bridgePeriodStart,
    period_end: period?.end ?? bridgePeriodEnd,
    timezone: period?.timezone ?? null
  };
  return {
    descriptor: {
      contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: workspace.id,
      mode,
      visible_source: "governed_population",
      policy_key: descriptor.policy.policy_key,
      population: {
        id: population.id,
        key: population.key,
        version: population.version,
        definition_hash: population.definition_hash,
        acceptance_status: population.acceptance_status,
        allowed_scopes: population.allowed_scopes
      },
      legacy_corpus_id: null
    },
    workspace,
    mode,
    visibleSource: "governed_population",
    legacyCorpus: null,
    population
  };
}

/**
 * Finalizes filter-time authority metadata after the module/view identity has
 * been resolved. Keeping this separate from request authentication prevents a
 * denominator measured for one period or filter from being reused elsewhere.
 */
export async function finalizeSignalModuleServingScopeV1(args: {
  scope: SignalModuleServingScopeV1;
  filter: SignalFilterV1 | null;
  queryable?: SignalModuleServingQueryable;
}): Promise<SignalServingScopeDescriptorV1> {
  if (args.scope.governed.state !== "available") {
    throw new SignalBackendContractError(
      "not_available",
      "Governed module authority is unavailable for this request.",
      { reason: args.scope.governed.reason }
    );
  }
  const queryable = args.queryable ?? (await import("@/lib/db")).pool;
  const descriptor = args.scope.governed.descriptor;
  const proof = descriptor.resolution_source === "governed-binding"
    ? await loadServingAuthorityProofV1(args.scope, queryable)
    : null;
  const coverage = await loadServingCoverageV1({
    workspaceId: args.scope.workspace_id,
    populationId: descriptor.population!.population_id,
    filter: args.filter,
    quality: proof ? {
      available: proof.quality_contract_status === "resolved",
      minScore: proof.min_quality_score,
      requiredFlags: proof.required_quality_flags,
      forbiddenFlags: proof.forbidden_quality_flags
    } : {
      available: false,
      minScore: null,
      requiredFlags: [],
      forbiddenFlags: []
    },
    queryable
  });
  const usedByView = coverage.used_by_view.count;
  if (usedByView == null) {
    throw new SignalBackendContractError(
      "not_available",
      "The governed denominator is not measurable.",
      { reason: "governed_denominator_not_available" }
    );
  }
  const isInvalidated = Boolean(proof && proof.invalidation_count > 0);
  return validateSignalServingScopeDescriptorV1({
    contract_version: SIGNAL_SERVING_SCOPE_CONTRACT_VERSION,
    workspace_id: args.scope.workspace_id,
    module_key: args.scope.module_key,
    view_key: args.scope.view_key,
    rollout_mode: args.scope.rollout_mode,
    resolution_source: descriptor.resolution_source,
    visible_source: args.scope.visible_source,
    binding: descriptor.binding,
    policy: descriptor.policy,
    population: descriptor.population,
    compilation: descriptor.resolution_source === "governed-binding" ? {
      policy_compilation_id: descriptor.population!.policy_compilation_id,
      compiled_plan_hash: descriptor.population!.compiled_plan_hash,
      compilation_status: "ready"
    } : null,
    visibility_class: descriptor.visibility_class,
    usage_purposes: signalServingUsagePurposesForModuleViewV1(
      args.scope.module_key,
      args.scope.view_key
    ),
    watermark: proof ? {
      availability: "available",
      data_watermark_hash: proof.data_watermark_hash,
      source_watermark_hash: proof.source_watermark_hash,
      governance_digest: proof.governance_digest,
      captured_at: proof.captured_at,
      next_policy_transition_at: proof.next_policy_transition_at
    } : {
      availability: "not_available",
      data_watermark_hash: null,
      source_watermark_hash: null,
      governance_digest: null,
      captured_at: null,
      next_policy_transition_at: null
    },
    freshness: proof && proof.data_freshness_state !== "not_available" ? {
      state: isInvalidated ? "stale" : proof.data_freshness_state,
      invalidation_state: isInvalidated ? "invalidated" : "valid",
      invalidated_at: isInvalidated ? proof.invalidated_at : null
    } : {
      state: "not_available",
      invalidation_state: "not_available",
      invalidated_at: null
    },
    coverage,
    denominator: {
      ...descriptor.denominator,
      count: usedByView
    },
    period: args.filter ? {
      start: args.filter.date_range.start,
      end: args.filter.date_range.end,
      timezone: args.filter.timezone
    } : null
  });
}

/**
 * Extends an existing response identity only when governed serving is visible.
 * Legacy and shadow keep their historical ETag seed byte-for-byte.
 */
export function signalModuleServingEtagSeedV1(
  legacySeed: string,
  servingScope: SignalServingScopeDescriptorV1 | null
) {
  return servingScope
    ? `${signalServingScopeIdentityHashV1(servingScope)}:${legacySeed}`
    : legacySeed;
}

type ServingAuthorityProofV1 = {
  workspace_id: string;
  module_key: string;
  view_key: string;
  binding_id: string;
  policy_bundle_id: string;
  population_id: string;
  policy_compilation_id: string;
  source_watermark_hash: string;
  governance_digest: string;
  governance_data_watermark_id: string;
  data_watermark_hash: string;
  data_freshness_state: "fresh" | "stale" | "partial" | "not_available";
  captured_at: string;
  next_policy_transition_at: string | null;
  quality_contract_status: string;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  invalidation_count: number;
  invalidated_at: string | null;
};

async function loadServingAuthorityProofV1(
  scope: SignalModuleServingScopeV1,
  queryable: SignalModuleServingQueryable
): Promise<ServingAuthorityProofV1> {
  if (scope.governed.state !== "available"
    || !scope.governed.descriptor.binding
    || !scope.governed.descriptor.population?.policy_compilation_id) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed serving authority is incomplete.",
      { reason: "governed_serving_authority_incomplete" }
    );
  }
  const authority = scope.governed.descriptor;
  const binding = authority.binding;
  const population = authority.population;
  if (!binding || !population?.policy_compilation_id) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed serving authority is incomplete.",
      { reason: "governed_serving_authority_incomplete" }
    );
  }
  const result = await queryable.query<ServingAuthorityProofV1>(`
    SELECT
      binding.workspace_id::text,
      binding.module_key,
      binding.view_key,
      binding.id::text AS binding_id,
      bundle.id::text AS policy_bundle_id,
      population.id::text AS population_id,
      compilation.id::text AS policy_compilation_id,
      compilation.source_watermark_hash,
      compilation.governance_digest,
      compilation.governance_data_watermark_id::text,
      'sha256:' || encode(sha256(convert_to(concat_ws('|',
        watermark.source_key,
        watermark.corpus_revision::text,
        COALESCE(watermark.max_observed_at::text, 'not_available'),
        watermark.accepted_at::text,
        watermark.materialized_at::text,
        watermark.source_freshness_state,
        watermark.data_freshness_state
      ), 'UTF8')), 'hex') AS data_watermark_hash,
      watermark.data_freshness_state,
      GREATEST(watermark.max_observed_at, watermark.accepted_at,
        watermark.materialized_at)::text AS captured_at,
      compilation.next_policy_transition_at::text,
      bundle.quality_contract_status,
      bundle.min_quality_score,
      bundle.required_quality_flags,
      bundle.forbidden_quality_flags,
      count(invalidation.id)::int AS invalidation_count,
      max(invalidation.created_at)::text AS invalidated_at
    FROM signal_governed_view_bindings binding
    JOIN signal_population_policy_bundles bundle
      ON bundle.id = binding.policy_bundle_id
     AND bundle.workspace_id = binding.workspace_id
    JOIN signal_population_definitions population
      ON population.id = binding.population_id
     AND population.workspace_id = binding.workspace_id
    JOIN signal_population_policy_compilations compilation
      ON compilation.id = binding.policy_compilation_id
     AND compilation.workspace_id = binding.workspace_id
    JOIN signal_data_watermarks watermark
      ON watermark.id = compilation.governance_data_watermark_id
     AND watermark.workspace_id = binding.workspace_id
     AND watermark.population_id = population.id
    LEFT JOIN signal_data_governance_invalidations invalidation
      ON invalidation.policy_compilation_id = compilation.id
     AND invalidation.workspace_id = binding.workspace_id
    WHERE binding.id = $2::uuid
      AND binding.workspace_id = $1::uuid
      AND binding.module_key = $3
      AND binding.view_key = $7
      AND bundle.id = $4::uuid
      AND population.id = $5::uuid
      AND compilation.id = $6::uuid
    GROUP BY binding.workspace_id, binding.module_key, binding.view_key,
      binding.id, bundle.id, population.id, compilation.id, watermark.id
  `, [
    scope.workspace_id,
    binding.binding_id,
    scope.module_key,
    authority.policy.policy_bundle_id,
    population.population_id,
    population.policy_compilation_id,
    scope.view_key
  ]);
  const row = result.rows[0];
  if (!row
    || row.workspace_id !== scope.workspace_id
    || row.module_key !== scope.module_key
    || row.view_key !== scope.view_key
    || row.binding_id !== binding.binding_id
    || row.policy_bundle_id !== authority.policy.policy_bundle_id
    || row.population_id !== population.population_id
    || row.policy_compilation_id !== population.policy_compilation_id) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed serving proof no longer matches the resolved binding.",
      { reason: "governed_serving_proof_mismatch" }
    );
  }
  return row;
}

/**
 * Durable identity captured by the HTTP shadow outbox. It deliberately includes
 * every authority that can supersede a comparison while keeping the visible
 * legacy response independent from the background work.
 */
export type SignalModuleShadowAuthorityV1 = {
  contract_version: "signal-module-shadow-authority-v1";
  workspace_id: string;
  module_key: SignalBrandServingModuleKeyV1;
  view_key: "brand";
  resolution_source: "governed-binding";
  binding: {
    id: string;
    version: number;
  };
  policy: {
    bundle_id: string;
    key: string;
    version: number;
    definition_hash: string;
  };
  population: {
    id: string;
    key: string;
    version: number;
    definition_hash: string;
    membership_digest: string;
  };
  compilation: {
    id: string;
    plan_hash: string;
    status: "ready";
  };
  watermark: {
    id: string;
    data_hash: string;
    source_hash: string;
    governance_digest: string;
    captured_at: string;
    next_policy_transition_at: string | null;
  };
};

export async function loadSignalModuleShadowAuthorityV1(args: {
  scope: SignalModuleServingScopeV1;
  queryable?: SignalModuleServingQueryable;
}): Promise<SignalModuleShadowAuthorityV1> {
  if (args.scope.view_key !== "brand"
    || args.scope.rollout_mode !== "shadow"
    || args.scope.governed.state !== "available"
    || args.scope.governed.descriptor.resolution_source !== "governed-binding") {
    throw new SignalBackendContractError(
      "not_available",
      "Current governed binding authority is unavailable for shadow.",
      { reason: "governed_shadow_binding_not_available" }
    );
  }
  const descriptor = args.scope.governed.descriptor;
  const binding = descriptor.binding;
  const population = descriptor.population;
  if (!binding || !population?.membership_digest || !population.policy_compilation_id
    || !population.compiled_plan_hash || population.compilation_status !== "ready") {
    throw new SignalBackendContractError(
      "not_available",
      "Current governed binding authority is incomplete for shadow.",
      { reason: "governed_shadow_binding_incomplete" }
    );
  }
  const queryable = args.queryable ?? (await import("@/lib/db")).pool;
  const proof = await loadServingAuthorityProofV1(args.scope, queryable);
  if (proof.invalidation_count > 0
    || !/^sha256:[0-9a-f]{64}$/u.test(proof.data_watermark_hash)
    || !/^sha256:[0-9a-f]{64}$/u.test(proof.source_watermark_hash)
    || !/^sha256:[0-9a-f]{64}$/u.test(proof.governance_digest)
    || !proof.governance_data_watermark_id) {
    throw new SignalBackendContractError(
      "not_available",
      "Current governed binding authority is stale or lacks a durable watermark.",
      { reason: "governed_shadow_authority_invalid" }
    );
  }
  return {
    contract_version: "signal-module-shadow-authority-v1",
    workspace_id: args.scope.workspace_id,
    module_key: args.scope.module_key,
    view_key: "brand",
    resolution_source: "governed-binding",
    binding: { id: binding.binding_id, version: binding.binding_version },
    policy: {
      bundle_id: descriptor.policy.policy_bundle_id!,
      key: descriptor.policy.policy_key,
      version: descriptor.policy.policy_version,
      definition_hash: descriptor.policy.definition_hash
    },
    population: {
      id: population.population_id,
      key: population.population_key,
      version: population.population_version,
      definition_hash: population.definition_hash,
      membership_digest: population.membership_digest
    },
    compilation: {
      id: population.policy_compilation_id,
      plan_hash: population.compiled_plan_hash,
      status: "ready"
    },
    watermark: {
      id: proof.governance_data_watermark_id,
      data_hash: proof.data_watermark_hash,
      source_hash: proof.source_watermark_hash,
      governance_digest: proof.governance_digest,
      captured_at: proof.captured_at,
      next_policy_transition_at: proof.next_policy_transition_at
    }
  };
}

async function loadServingCoverageV1(args: {
  workspaceId: string;
  populationId: string;
  filter: SignalFilterV1 | null;
  quality: {
    available: boolean;
    minScore: number | null;
    requiredFlags: string[];
    forbiddenFlags: string[];
  };
  queryable: SignalModuleServingQueryable;
}) {
  const workspacePredicate = args.filter
    ? buildSignalWorkspaceCanonicalMentionReadPredicateV1(
        args.filter,
        args.workspaceId
      )
    : {
        sql: "(m.workspace_id = $1::uuid) AND (m.canonical_mention_id = m.id)",
        params: [args.workspaceId]
      };
  const captured = await args.queryable.query<{
    captured: number;
    quality_eligible: number;
    reviewed: number;
    resolved_attributed: number;
    unattributed: number;
  }>(`
    WITH captured AS (
      SELECT m.*
      FROM mentions m
      WHERE ${workspacePredicate.sql}
        AND m.inclusion_status = 'included'
    ), review_state AS (
      SELECT captured.id,
        bool_or(assertion.review_status IN ('approved', 'rejected')) AS reviewed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'eligible'
          AND assertion.scope <> 'unattributed') AS resolved_attributed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'not_eligible'
          AND assertion.scope = 'unattributed'
          AND assertion.entity_id IS NULL) AS unattributed
      FROM captured
      LEFT JOIN signal_mention_attributions assertion
        ON assertion.workspace_id = $${workspacePredicate.params.length + 1}::uuid
       AND assertion.mention_id = captured.id
       AND assertion.attribution_basis = 'mention_semantic'
       AND assertion.is_current
      GROUP BY captured.id
    )
    SELECT
      (SELECT count(*)::int FROM captured) AS captured,
      (SELECT count(*)::int FROM captured mention
       WHERE ($${workspacePredicate.params.length + 2}::int IS NULL
          OR COALESCE(mention.quality_score, -1) >= $${workspacePredicate.params.length + 2}::int)
         AND NOT EXISTS (
           SELECT 1 FROM unnest($${workspacePredicate.params.length + 3}::text[]) required(flag)
           WHERE NOT (COALESCE(mention.quality_flags, '[]'::jsonb) ? required.flag)
         )
         AND NOT EXISTS (
           SELECT 1 FROM unnest($${workspacePredicate.params.length + 4}::text[]) forbidden(flag)
           WHERE COALESCE(mention.quality_flags, '[]'::jsonb) ? forbidden.flag
         )) AS quality_eligible,
      (SELECT count(*)::int FROM review_state WHERE reviewed) AS reviewed,
      (SELECT count(*)::int FROM review_state WHERE resolved_attributed) AS resolved_attributed,
      (SELECT count(*)::int FROM review_state WHERE unattributed) AS unattributed
  `, [
    ...workspacePredicate.params,
    args.workspaceId,
    args.quality.minScore,
    args.quality.requiredFlags,
    args.quality.forbiddenFlags
  ]);
  const populationPredicate = args.filter
    ? buildSignalPopulationMentionReadPredicateV1(
        args.filter,
        args.populationId,
        args.workspaceId
      )
    : {
        sql: `(m.workspace_id = $1::uuid)
          AND (m.canonical_mention_id = m.id)
          AND EXISTS (
            SELECT 1
            FROM signal_population_memberships population_membership
            WHERE population_membership.population_id = $2::uuid
              AND population_membership.workspace_id = m.workspace_id
              AND population_membership.mention_id = m.id
              AND population_membership.membership_status = 'included'
              AND population_membership.removed_at IS NULL
          )`,
        params: [args.workspaceId, args.populationId]
      };
  const used = await args.queryable.query<{ used_by_view: number }>(`
    SELECT count(DISTINCT m.id)::int AS used_by_view
    FROM mentions m
    WHERE ${populationPredicate.sql}
  `, populationPredicate.params);
  const row = captured.rows[0];
  const usedRow = used.rows[0];
  if (!row || !usedRow) {
    throw new SignalBackendContractError(
      "not_available",
      "Signal coverage could not be measured.",
      { reason: "governed_coverage_not_available" }
    );
  }
  const measured = {
    captured: measuredCoverageCount(row.captured),
    qualityEligible: measuredCoverageCount(row.quality_eligible),
    reviewed: measuredCoverageCount(row.reviewed),
    resolvedAttributed: measuredCoverageCount(row.resolved_attributed),
    unattributed: measuredCoverageCount(row.unattributed),
    usedByView: measuredCoverageCount(usedRow.used_by_view)
  };
  if (Object.values(measured).some((count) => count == null)) {
    throw new SignalBackendContractError(
      "not_available",
      "Signal coverage returned an invalid measurement.",
      { reason: "governed_coverage_measurement_invalid" }
    );
  }
  const available = (count: number) => ({ availability: "available" as const, count });
  const unavailable = { availability: "not_available" as const, count: null };
  return validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: available(measured.captured!),
    quality_eligible: args.quality.available
      ? available(measured.qualityEligible!)
      : unavailable,
    unreviewed: available(measured.captured! - measured.reviewed!),
    reviewed: available(measured.reviewed!),
    resolved_attributed: available(measured.resolvedAttributed!),
    abstained: unavailable,
    unattributed: available(measured.unattributed!),
    used_by_view: available(measured.usedByView!)
  });
}

function measuredCoverageCount(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function asShadowLegacyScope(
  legacyScope: SignalOperationalReadScopeV1,
  governedScope: SignalOperationalReadScopeV1 | null
): SignalOperationalReadScopeV1 {
  return {
    ...legacyScope,
    mode: "shadow",
    population: governedScope?.population ?? null,
    descriptor: {
      ...legacyScope.descriptor,
      mode: "shadow",
      population: governedScope?.descriptor.population ?? null
    }
  };
}

function requireBrandServingModuleKey(
  input: SignalBrandServingModuleKeyV1
): SignalBrandServingModuleKeyV1 {
  if (!SIGNAL_BRAND_SERVING_MODULE_KEYS.includes(input)) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Signal serving module is not available.",
      { reason: "signal_serving_module_not_supported" }
    );
  }
  return input;
}

export function requireClientServingViewKey(
  input: unknown
): SignalClientGovernedViewKeyV1 {
  try {
    return normalizeSignalClientGovernedViewKeyV1(input);
  } catch (error) {
    throw new SignalBackendContractError(
      "invalid_filter",
      error instanceof Error ? error.message : "Signal view is not available.",
      { field: "view", reason: "signal_client_view_not_supported" }
    );
  }
}

function requireBrandBridgeView(
  viewKey: SignalClientGovernedViewKeyV1,
  mode: SignalOperationalReadModeV1
) {
  if (viewKey === "brand") return;
  throw new SignalBackendContractError(
    "not_available",
    "This governed view has no current server-owned binding.",
    { reason: "governed_view_binding_not_available", view_key: viewKey, read_mode: mode }
  );
}

function expectedEntityTypeForScope(scope: string) {
  switch (scope) {
    case "primary_brand": return "brand";
    case "competitor": return "competitor";
    case "category": return "category";
    case "reference": return "reference";
    default: return null;
  }
}

function contractReason(error: unknown) {
  return error instanceof SignalBackendContractError
    && typeof error.details.reason === "string"
    ? error.details.reason
    : "governed_module_scope_not_available";
}
