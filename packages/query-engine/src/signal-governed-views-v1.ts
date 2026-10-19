import { createHash } from "node:crypto";

import {
  SIGNAL_MENTION_SCOPES,
  type SignalMentionScopeV1
} from "./signal-workspace-data-plane-v1";

export const SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION =
  "signal-governed-views-v1" as const;

export const SIGNAL_SERVING_SCOPE_CONTRACT_VERSION =
  "signal-serving-scope-v1" as const;

export const SIGNAL_GOVERNED_MODULE_VIEW_CONTRACT_VERSION =
  "signal-governed-module-view-contract-v1" as const;

export const SIGNAL_SERVING_ROLLOUT_MODES = [
  "legacy",
  "shadow",
  "governed"
] as const;

export const SIGNAL_SERVING_RESOLUTION_SOURCES = [
  "governed-binding",
  "operational-brand-bridge"
] as const;

export const SIGNAL_SERVING_VISIBLE_SOURCES = [
  "legacy",
  ...SIGNAL_SERVING_RESOLUTION_SOURCES
] as const;

export const SIGNAL_GOVERNED_VIEW_MODULE_KEYS = [
  "brand-monitoring",
  "mentions",
  "topics-narratives",
  "triggers-barriers",
  "admin-mentions"
] as const;

export const SIGNAL_GOVERNED_VIEW_KEYS = [
  "brand",
  "competition",
  "category",
  "all-governed",
  "strategic",
  "admin-reservoir"
] as const;

export const SIGNAL_CLIENT_GOVERNED_VIEW_KEYS = [
  "brand",
  "competition",
  "category",
  "all-governed"
] as const;

export const SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const;

export const SIGNAL_POLICY_VISIBILITY_CLASSES = [
  "client-safe",
  "operator-only",
  "strategic-internal"
] as const;

export const SIGNAL_POLICY_ELIGIBILITY_KEYS = [
  "semantic-approved-eligible",
  "workspace-reservoir",
  "snapshot-membership"
] as const;

export const SIGNAL_POLICY_DENOMINATOR_KEYS = [
  "eligible-canonical-roots",
  "workspace-canonical-roots",
  "snapshot-canonical-roots"
] as const;

export const SIGNAL_DATA_USAGE_PURPOSES = [
  "internal-qa",
  "client-derived-metrics",
  "client-mention-list",
  "client-text-or-excerpt",
  "llm-processing",
  "strategic-analysis"
] as const;

/**
 * Closed, server-owned data-use authority for every published client
 * `(module_key, view_key)` identity.
 *
 * The values intentionally repeat today. Keeping all twelve cells explicit is
 * what prevents a future view from silently inheriting brand permissions when
 * its product contract diverges.
 */
export const SIGNAL_CLIENT_VIEW_USAGE_PURPOSES = {
  "brand-monitoring": {
    brand: ["client-derived-metrics"],
    competition: ["client-derived-metrics"],
    category: ["client-derived-metrics"],
    "all-governed": ["client-derived-metrics"]
  },
  mentions: {
    brand: ["client-mention-list", "client-text-or-excerpt"],
    competition: ["client-mention-list", "client-text-or-excerpt"],
    category: ["client-mention-list", "client-text-or-excerpt"],
    "all-governed": ["client-mention-list", "client-text-or-excerpt"]
  },
  "topics-narratives": {
    brand: ["client-derived-metrics"],
    competition: ["client-derived-metrics"],
    category: ["client-derived-metrics"],
    "all-governed": ["client-derived-metrics"]
  }
} as const satisfies Record<
  SignalClientGovernedViewModuleKeyV1,
  Record<SignalClientGovernedViewKeyV1, readonly SignalDataUsagePurposeV1[]>
>;

/** Compatibility export for existing brand-only callers; it is not a fallback. */
export const SIGNAL_BRAND_VIEW_USAGE_PURPOSES = {
  "brand-monitoring": SIGNAL_CLIENT_VIEW_USAGE_PURPOSES["brand-monitoring"].brand,
  mentions: SIGNAL_CLIENT_VIEW_USAGE_PURPOSES.mentions.brand,
  "topics-narratives": SIGNAL_CLIENT_VIEW_USAGE_PURPOSES["topics-narratives"].brand
} as const;

export const SIGNAL_DATA_GOVERNANCE_REASON_CODES = [
  "quality_not_eligible",
  "retention_expired",
  "retention_blocked",
  "retention_not_available",
  "licensing_prohibited",
  "licensing_not_available",
  "no_authorized_provenance",
  "semantic_not_eligible",
  "policy_eligible"
] as const;

export type SignalGovernedViewModuleKeyV1 =
  (typeof SIGNAL_GOVERNED_VIEW_MODULE_KEYS)[number];
export type SignalGovernedViewKeyV1 =
  (typeof SIGNAL_GOVERNED_VIEW_KEYS)[number];
export type SignalClientGovernedViewKeyV1 =
  (typeof SIGNAL_CLIENT_GOVERNED_VIEW_KEYS)[number];
export type SignalClientGovernedViewModuleKeyV1 =
  (typeof SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS)[number];
export type SignalPolicyVisibilityClassV1 =
  (typeof SIGNAL_POLICY_VISIBILITY_CLASSES)[number];
export type SignalPolicyEligibilityKeyV1 =
  (typeof SIGNAL_POLICY_ELIGIBILITY_KEYS)[number];
export type SignalPolicyDenominatorKeyV1 =
  (typeof SIGNAL_POLICY_DENOMINATOR_KEYS)[number];
export type SignalDataUsagePurposeV1 =
  (typeof SIGNAL_DATA_USAGE_PURPOSES)[number];
export type SignalDataGovernanceReasonCodeV1 =
  (typeof SIGNAL_DATA_GOVERNANCE_REASON_CODES)[number];
export type SignalServingRolloutModeV1 =
  (typeof SIGNAL_SERVING_ROLLOUT_MODES)[number];
export type SignalServingResolutionSourceV1 =
  (typeof SIGNAL_SERVING_RESOLUTION_SOURCES)[number];
export type SignalServingVisibleSourceV1 =
  (typeof SIGNAL_SERVING_VISIBLE_SOURCES)[number];

export type SignalGovernedModuleViewContractV1 = {
  contract_version: typeof SIGNAL_GOVERNED_MODULE_VIEW_CONTRACT_VERSION;
  module_key: SignalClientGovernedViewModuleKeyV1;
  view_key: SignalClientGovernedViewKeyV1;
  visibility_class: "client-safe";
  allowed_scopes: Array<Exclude<SignalMentionScopeV1, "unattributed">>;
  scope_mode: "exact" | "governed-union";
  allowed_entity_types: Array<"brand" | "competitor" | "category" | "reference">;
  semantic_gate: {
    attribution_basis: "mention_semantic";
    is_current: true;
    review_status: "approved";
    eligibility_status: "eligible";
    unknown_behavior: "exclude";
  };
  required_usage_purposes: SignalDataUsagePurposeV1[];
  denominator: {
    key: "eligible-canonical-roots";
    unit: "canonical-root";
    deduplication_policy: "canonical-root";
  };
  coverage_dimensions: Array<keyof Omit<SignalCoverageDescriptorV1, "state">>;
};

export function signalDataUsagePurposesForModuleViewV1(
  moduleKey: SignalGovernedViewModuleKeyV1,
  viewKey: SignalGovernedViewKeyV1
): SignalDataUsagePurposeV1[] {
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  if (!isSignalClientGovernedViewModuleKeyV1(moduleKey)
    || !isSignalClientGovernedViewKeyV1(viewKey)) {
    throw new Error(`No data-use contract is published for ${moduleKey}/${viewKey}.`);
  }
  const purposes = SIGNAL_CLIENT_VIEW_USAGE_PURPOSES[moduleKey][viewKey];
  if (!purposes?.length) {
    throw new Error(`No data-use contract is published for ${moduleKey}/${viewKey}.`);
  }
  return [...purposes].sort();
}

/** Closed client contract. It contains product identity, never a population id. */
export function signalGovernedModuleViewContractV1(
  moduleKeyInput: unknown,
  viewKeyInput: unknown
): SignalGovernedModuleViewContractV1 {
  const moduleKey = normalizeSignalGovernedViewModuleKeyV1(moduleKeyInput);
  const viewKey = normalizeSignalClientGovernedViewKeyV1(viewKeyInput);
  if (!isSignalClientGovernedViewModuleKeyV1(moduleKey)) {
    throw new Error(`No client-safe governed view contract is published for ${moduleKey}/${viewKey}.`);
  }
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  const viewContract = CLIENT_VIEW_SCOPE_CONTRACTS[viewKey];
  return {
    contract_version: SIGNAL_GOVERNED_MODULE_VIEW_CONTRACT_VERSION,
    module_key: moduleKey,
    view_key: viewKey,
    visibility_class: "client-safe",
    allowed_scopes: [...viewContract.allowed_scopes],
    scope_mode: viewContract.scope_mode,
    allowed_entity_types: [...viewContract.allowed_entity_types],
    semantic_gate: {
      attribution_basis: "mention_semantic",
      is_current: true,
      review_status: "approved",
      eligibility_status: "eligible",
      unknown_behavior: "exclude"
    },
    required_usage_purposes: signalDataUsagePurposesForModuleViewV1(moduleKey, viewKey),
    denominator: {
      key: "eligible-canonical-roots",
      unit: "canonical-root",
      deduplication_policy: "canonical-root"
    },
    coverage_dimensions: [
      "captured",
      "quality_eligible",
      "unreviewed",
      "reviewed",
      "resolved_attributed",
      "abstained",
      "unattributed",
      "used_by_view"
    ]
  };
}

export function signalGovernedModuleViewContractHashV1(
  moduleKeyInput: unknown,
  viewKeyInput: unknown
) {
  return hash(stableJson(signalGovernedModuleViewContractV1(moduleKeyInput, viewKeyInput)));
}

/**
 * Compiles the module/view-specific part of a governed policy plan.
 *
 * `required_usage_purposes` on the bundle is a capability envelope: it records
 * every closed use that the bundle may support, but it never becomes a union
 * predicate for every module. A concrete compilation must select the exact
 * server-owned subset for its `(module_key, view_key)` identity.
 */
export function signalGovernedViewCompilationPlanHashV1(args: {
  base_plan_hash: string;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: SignalGovernedViewKeyV1;
  authorized_modules: SignalGovernedViewModuleKeyV1[];
  capability_usage_purposes: SignalDataUsagePurposeV1[];
}) {
  const basePlanHash = governedHash(args.base_plan_hash, "base_plan_hash");
  const moduleKey = normalizeSignalGovernedViewModuleKeyV1(args.module_key);
  const viewKey = normalizeSignalGovernedViewKeyV1(args.view_key);
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  const authorizedModules = uniqueSortedArray(
    args.authorized_modules,
    "authorized_modules",
    normalizeSignalGovernedViewModuleKeyV1
  );
  if (!authorizedModules.includes(moduleKey)) {
    throw new Error(`Module ${moduleKey} is outside the policy capability envelope.`);
  }
  const capabilities = uniqueSortedArray(
    args.capability_usage_purposes,
    "capability_usage_purposes",
    (value) => enumValue(value, "usage purpose", SIGNAL_DATA_USAGE_PURPOSES)
  );
  const requiredUsagePurposes = signalServingUsagePurposesForModuleViewV1(moduleKey, viewKey);
  if (requiredUsagePurposes.some((purpose) => !capabilities.includes(purpose))) {
    throw new Error(`Policy capability envelope does not authorize ${moduleKey}/${viewKey}.`);
  }
  const modulePlan: Record<string, unknown> = {
    contract_version: "signal-governed-view-module-plan-v1",
    base_plan_hash: basePlanHash,
    module_key: moduleKey,
    view_key: viewKey,
    required_usage_purposes: requiredUsagePurposes
  };
  // The already-promoted brand compilation identity predates Backend 06. Keep
  // it byte-compatible; new named views bind their closed contract directly.
  if (isSignalClientGovernedViewKeyV1(viewKey) && viewKey !== "brand") {
    modulePlan.module_view_contract_hash = signalGovernedModuleViewContractHashV1(moduleKey, viewKey);
  } else if (moduleKey === "triggers-barriers" && viewKey === "strategic") {
    modulePlan.module_view_contract_hash = hash(stableJson({
      contract_version: "signal-strategic-gate-d-module-view-v1",
      module_key: moduleKey,
      view_key: viewKey,
      visibility_class: "strategic-internal",
      allowed_scopes: ["category", "competitor", "primary_brand"],
      denominator_key: "eligible-canonical-roots",
      deduplication_policy: "canonical-root",
      required_usage_purposes: requiredUsagePurposes
    }));
  }
  return hash(stableJson(modulePlan));
}

export type SignalPolicyEntityReferenceV1 = {
  scope: Exclude<SignalMentionScopeV1, "unattributed">;
  entity_type: "brand" | "competitor" | "category" | "reference";
  entity_id: string;
};

export type SignalPopulationPolicyBundleDefinitionV1 = {
  contract_version: typeof SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION;
  workspace_id: string;
  policy_key: string;
  policy_version: number;
  authorized_modules: SignalGovernedViewModuleKeyV1[];
  allowed_scopes: SignalMentionScopeV1[];
  allowed_entities: SignalPolicyEntityReferenceV1[];
  acceptance_status: "included" | "any";
  quality_contract_status: "resolved" | "not_available";
  quality_policy_key: string | null;
  quality_policy_version: number | null;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  eligibility_policy: SignalPolicyEligibilityKeyV1;
  deduplication_policy: "canonical-root";
  visibility_class: SignalPolicyVisibilityClassV1;
  denominator_key: SignalPolicyDenominatorKeyV1;
  period_start: string | null;
  period_end: string | null;
  timezone: string | null;
  retention_policy_ref: string | null;
  licensing_policy_ref: string | null;
  data_governance_contract_status: "resolved" | "not_available";
  quality_policy_id: string | null;
  required_usage_purposes: SignalDataUsagePurposeV1[];
};

export type SignalPopulationPolicyBundleIdentityV1 = {
  workspace_id: string;
  policy_bundle_id: string | null;
  policy_key: string;
  policy_version: number;
  definition_hash: string;
};

export type SignalGovernedViewBindingIdentityV1 = {
  workspace_id: string;
  binding_id: string;
  binding_version: number;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: SignalGovernedViewKeyV1;
};

export type SignalGovernedPopulationReferenceV1 = {
  population_id: string;
  population_key: string;
  population_version: number;
  definition_hash: string;
  membership_digest: string | null;
  policy_compilation_id: string | null;
  compiled_plan_hash: string | null;
  compilation_status: "ready" | "stale" | "blocked" | null;
} | null;

export type SignalCoverageMeasurementV1 =
  | { availability: "available"; count: number }
  | { availability: "not_available"; count: null };

export type SignalCoverageDescriptorV1 = {
  state: "complete" | "partial" | "not_available";
  captured: SignalCoverageMeasurementV1;
  quality_eligible: SignalCoverageMeasurementV1;
  unreviewed: SignalCoverageMeasurementV1;
  reviewed: SignalCoverageMeasurementV1;
  resolved_attributed: SignalCoverageMeasurementV1;
  abstained: SignalCoverageMeasurementV1;
  unattributed: SignalCoverageMeasurementV1;
  used_by_view: SignalCoverageMeasurementV1;
};

export type SignalDenominatorDescriptorV1 = {
  key: SignalPolicyDenominatorKeyV1;
  unit: "canonical-root";
  count: number | null;
  deduplication_policy: "canonical-root";
};

export type SignalGovernedViewDescriptorV1 = {
  contract_version: typeof SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION;
  workspace_id: string;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: SignalGovernedViewKeyV1;
  resolution_source: "governed-binding" | "operational-brand-bridge";
  binding: SignalGovernedViewBindingIdentityV1 | null;
  policy: SignalPopulationPolicyBundleIdentityV1;
  population: SignalGovernedPopulationReferenceV1;
  /**
   * Exact authority used to construct the compatibility read scope. A bound
   * governed view carries the predicate compiled from its policy bundle; the
   * operational bridge carries only fields proven by the pointed population.
   */
  read_contract:
    | {
        authority_source: "compiled-policy";
        predicate: SignalCompiledPopulationPolicyV1["predicate"];
      }
    | {
        authority_source: "operational-population";
        acceptance_status: "included" | "any";
        allowed_scopes: SignalMentionScopeV1[];
        min_quality_score: number | null;
        period_start: string | null;
        period_end: string | null;
      };
  visibility_class: SignalPolicyVisibilityClassV1;
  denominator: Omit<SignalDenominatorDescriptorV1, "count">;
};

export type SignalServingWatermarkDescriptorV1 =
  | {
      availability: "available";
      data_watermark_hash: string;
      source_watermark_hash: string;
      governance_digest: string;
      captured_at: string;
      next_policy_transition_at: string | null;
    }
  | {
      availability: "not_available";
      data_watermark_hash: null;
      source_watermark_hash: null;
      governance_digest: null;
      captured_at: null;
      next_policy_transition_at: null;
    };

export type SignalServingFreshnessDescriptorV1 = {
  state: "fresh" | "stale" | "partial" | "not_available";
  invalidation_state: "valid" | "invalidated" | "not_available";
  invalidated_at: string | null;
};

export type SignalServingCompilationIdentityV1 = {
  policy_compilation_id: string;
  compiled_plan_hash: string;
  compilation_status: "ready";
};

/**
 * Compact authority descriptor for one module/view read.
 *
 * This object identifies the governed denominator; it never contains records,
 * memberships or snapshots. `visible_source` is separate from resolution so a
 * shadow request can prove which governed scope was compared while preserving
 * the legacy payload shown to the client.
 */
export type SignalServingScopeDescriptorV1 = {
  contract_version: typeof SIGNAL_SERVING_SCOPE_CONTRACT_VERSION;
  workspace_id: string;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: SignalGovernedViewKeyV1;
  rollout_mode: SignalServingRolloutModeV1;
  resolution_source: SignalServingResolutionSourceV1;
  visible_source: SignalServingVisibleSourceV1;
  binding: SignalGovernedViewBindingIdentityV1 | null;
  policy: SignalPopulationPolicyBundleIdentityV1;
  population: Exclude<SignalGovernedPopulationReferenceV1, null>;
  compilation: SignalServingCompilationIdentityV1 | null;
  visibility_class: SignalPolicyVisibilityClassV1;
  usage_purposes: SignalDataUsagePurposeV1[];
  watermark: SignalServingWatermarkDescriptorV1;
  freshness: SignalServingFreshnessDescriptorV1;
  coverage: SignalCoverageDescriptorV1;
  denominator: SignalDenominatorDescriptorV1;
  period: { start: string; end: string; timezone: string } | null;
};

export type SignalCompiledPopulationPolicyV1 = {
  contract_version: typeof SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION;
  policy: SignalPopulationPolicyBundleIdentityV1;
  predicate: {
    canonical_root_only: true;
    acceptance_status: "included" | "any";
    semantic_assertion: {
      attribution_basis: "mention_semantic";
      is_current: true;
      review_status: "approved";
      eligibility_status: "eligible";
      allowed_scopes: SignalMentionScopeV1[];
      allowed_entities: SignalPolicyEntityReferenceV1[];
    } | null;
    quality: {
      contract_status: "resolved" | "not_available";
      policy_key: string | null;
      policy_version: number | null;
      min_score: number | null;
      required_flags: string[];
      forbidden_flags: string[];
      policy_id: string | null;
    };
    data_governance: {
      contract_status: "resolved" | "not_available";
      required_usage_purposes: SignalDataUsagePurposeV1[];
      provenance_precedence: "import-over-source";
      authorization_rule: "any-authorized-provenance";
    };
    period: {
      start: string;
      end: string;
      timezone: string;
    } | null;
  };
  deduplication: { unit: "canonical-root"; strategy: "distinct-root-id" };
  denominator: Omit<SignalDenominatorDescriptorV1, "count">;
  readiness: {
    status: "ready" | "blocked";
    blocking_reasons: Array<
      | "quality_policy_not_available"
      | "retention_policy_not_available"
      | "licensing_policy_not_available"
      | "data_governance_policy_not_available"
    >;
  };
  plan_hash: string;
};

export type SignalPolicyMembershipCandidateV1 = {
  mention_id: string;
  canonical_mention_id: string;
  inclusion_status: "pending" | "included" | "excluded";
  quality_score: number | null;
  quality_flags: string[];
  published_at: string | null;
  /** Unknown or blocked data rights never enter a client-safe denominator. */
  governance_eligibility: "authorized" | "blocked" | "not_available";
  assertions: Array<{
    attribution_basis: "source_intent" | "mention_semantic";
    is_current: boolean;
    review_status: "pending" | "approved" | "rejected";
    eligibility_status: "not_eligible" | "candidate" | "eligible";
    scope: SignalMentionScopeV1;
    entity_type: "brand" | "competitor" | "category" | "reference" | "unattributed";
    entity_id: string | null;
  }>;
};

export type SignalQualityPolicyDefinitionV1 = {
  workspace_id: string;
  policy_key: string;
  policy_version: number;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  canonical_root_disposition: "evaluate" | "blocked" | "not_available";
};

export type SignalRetentionPolicyDefinitionV1 = {
  workspace_id: string;
  policy_key: string;
  policy_version: number;
  retention_state: "allowed" | "blocked" | "not_available";
  retention_mode: "indefinite" | "until" | "not_available";
  retain_until: string | null;
  expiry_action: "block_use" | "review_required" | "not_available";
  approval_evidence_hash: string | null;
};

export type SignalLicensingPolicyDefinitionV1 = {
  workspace_id: string;
  policy_key: string;
  policy_version: number;
  approval_evidence_hash: string | null;
  usages: Array<{ usage_purpose: SignalDataUsagePurposeV1; decision: "allowed" | "prohibited" | "not_available" }>;
};

export type SignalProvenancePolicyBindingDefinitionV1 = {
  workspace_id: string;
  data_source_id: string;
  import_batch_id: string | null;
  binding_version: number;
  quality_policy_id: string;
  retention_policy_id: string;
  licensing_policy_id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MODULE_SET = new Set<string>(SIGNAL_GOVERNED_VIEW_MODULE_KEYS);
const VIEW_SET = new Set<string>(SIGNAL_GOVERNED_VIEW_KEYS);
const CLIENT_VIEW_SET = new Set<string>(SIGNAL_CLIENT_GOVERNED_VIEW_KEYS);
const CLIENT_VIEW_MODULE_SET = new Set<string>(SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS);
const VISIBILITY_SET = new Set<string>(SIGNAL_POLICY_VISIBILITY_CLASSES);
const ELIGIBILITY_SET = new Set<string>(SIGNAL_POLICY_ELIGIBILITY_KEYS);
const DENOMINATOR_SET = new Set<string>(SIGNAL_POLICY_DENOMINATOR_KEYS);
const SCOPE_SET = new Set<string>(SIGNAL_MENTION_SCOPES);
const USAGE_PURPOSE_SET = new Set<string>(SIGNAL_DATA_USAGE_PURPOSES);

const CLIENT_VIEW_SCOPE_CONTRACTS = {
  brand: {
    allowed_scopes: ["primary_brand"],
    scope_mode: "exact",
    allowed_entity_types: ["brand"]
  },
  competition: {
    allowed_scopes: ["competitor"],
    scope_mode: "exact",
    allowed_entity_types: ["competitor"]
  },
  category: {
    allowed_scopes: ["category"],
    scope_mode: "exact",
    allowed_entity_types: ["category"]
  },
  "all-governed": {
    allowed_scopes: ["primary_brand", "competitor", "category", "reference"],
    scope_mode: "governed-union",
    allowed_entity_types: ["brand", "competitor", "category", "reference"]
  }
} as const satisfies Record<SignalClientGovernedViewKeyV1, {
  allowed_scopes: readonly Exclude<SignalMentionScopeV1, "unattributed">[];
  scope_mode: "exact" | "governed-union";
  allowed_entity_types: readonly ("brand" | "competitor" | "category" | "reference")[];
}>;

const VIEW_COMPATIBILITY: Readonly<Record<SignalGovernedViewModuleKeyV1, readonly SignalGovernedViewKeyV1[]>> = {
  "brand-monitoring": ["brand", "competition", "category", "all-governed"],
  mentions: ["brand", "competition", "category", "all-governed"],
  "topics-narratives": ["brand", "competition", "category", "all-governed"],
  "triggers-barriers": ["strategic"],
  "admin-mentions": ["admin-reservoir"]
};

function isSignalClientGovernedViewKeyV1(
  input: SignalGovernedViewKeyV1
): input is SignalClientGovernedViewKeyV1 {
  return CLIENT_VIEW_SET.has(input);
}

function isSignalClientGovernedViewModuleKeyV1(
  input: SignalGovernedViewModuleKeyV1
): input is SignalClientGovernedViewModuleKeyV1 {
  return CLIENT_VIEW_MODULE_SET.has(input);
}

export function normalizeSignalGovernedViewModuleKeyV1(
  input: unknown
): SignalGovernedViewModuleKeyV1 {
  const value = String(input ?? "").trim().toLowerCase();
  if (!MODULE_SET.has(value)) {
    throw new Error(`module_key must be one of: ${SIGNAL_GOVERNED_VIEW_MODULE_KEYS.join(", ")}`);
  }
  return value as SignalGovernedViewModuleKeyV1;
}

export function normalizeSignalGovernedViewKeyV1(
  input: unknown
): SignalGovernedViewKeyV1 {
  const value = String(input ?? "").trim().toLowerCase();
  if (!VIEW_SET.has(value)) {
    throw new Error(`view_key must be one of: ${SIGNAL_GOVERNED_VIEW_KEYS.join(", ")}`);
  }
  return value as SignalGovernedViewKeyV1;
}

export function normalizeSignalClientGovernedViewKeyV1(
  input: unknown
): SignalClientGovernedViewKeyV1 {
  const value = normalizeSignalGovernedViewKeyV1(input);
  if (!CLIENT_VIEW_SET.has(value)) {
    throw new Error(`view_key must be a client-safe view: ${SIGNAL_CLIENT_GOVERNED_VIEW_KEYS.join(", ")}`);
  }
  return value as SignalClientGovernedViewKeyV1;
}

export function assertSignalGovernedViewCompatibilityV1(
  moduleKey: SignalGovernedViewModuleKeyV1,
  viewKey: SignalGovernedViewKeyV1
) {
  if (!VIEW_COMPATIBILITY[moduleKey].includes(viewKey)) {
    throw new Error(`${viewKey} is not available for module ${moduleKey}.`);
  }
}

export function assertSignalGovernedPolicyViewContractV1(
  moduleKey: SignalGovernedViewModuleKeyV1,
  viewKey: SignalGovernedViewKeyV1,
  definition: SignalPopulationPolicyBundleDefinitionV1
) {
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  if (!definition.authorized_modules.includes(moduleKey)) {
    throw new Error(`Policy ${definition.policy_key} is not authorized for module ${moduleKey}.`);
  }
  const scopes = definition.allowed_scopes;
  if (isSignalClientGovernedViewKeyV1(viewKey)) {
    const contract = signalGovernedModuleViewContractV1(moduleKey, viewKey);
    if (definition.visibility_class !== contract.visibility_class
      || definition.eligibility_policy !== "semantic-approved-eligible"
      || definition.acceptance_status !== "included"
      || definition.denominator_key !== contract.denominator.key
      || definition.deduplication_policy !== contract.denominator.deduplication_policy) {
      throw new Error(`${viewKey} requires the client-safe approved canonical-root denominator contract.`);
    }
    const entityScopes = [...new Set(definition.allowed_entities.map((entity) => entity.scope))].sort();
    if (stableJson(entityScopes) !== stableJson([...scopes].sort())) {
      throw new Error(`${viewKey} scopes and governed entity allowlists must match exactly.`);
    }
    if (contract.scope_mode === "exact"
      && stableJson(scopes) !== stableJson(contract.allowed_scopes)) {
      throw new Error(`${viewKey} requires an exact ${contract.allowed_scopes.join(",")} policy.`);
    }
    const contractScopes = new Set<string>(contract.allowed_scopes);
    if (contract.scope_mode === "governed-union" && (
      scopes.length === 0
      || scopes.some((scope) => !contractScopes.has(scope))
    )) {
      throw new Error("all-governed only accepts an explicit union of attributable governed scopes.");
    }
    const contractEntityTypes = new Set<string>(contract.allowed_entity_types);
    if (definition.allowed_entities.some((entity) =>
      !contractEntityTypes.has(entity.entity_type))) {
      throw new Error(`${viewKey} contains an entity type outside its governed contract.`);
    }
    const entityTypeByScope = {
      primary_brand: "brand",
      competitor: "competitor",
      category: "category",
      reference: "reference"
    } as const;
    if (definition.allowed_entities.some((entity) =>
      entity.entity_type !== entityTypeByScope[entity.scope as keyof typeof entityTypeByScope])) {
      throw new Error(`${viewKey} contains a governed entity whose type does not match its scope.`);
    }
    if (viewKey === "brand" && definition.allowed_entities.length !== 1) {
      throw new Error("brand requires exactly one governed brand identity.");
    }
    if (contract.required_usage_purposes.some((purpose) =>
      !definition.required_usage_purposes.includes(purpose))) {
      throw new Error(`${viewKey} policy capability envelope does not authorize ${moduleKey}.`);
    }
  }
  if (viewKey === "strategic") {
    const exactScopes = ["category", "competitor", "primary_brand"];
    const entityScopes = [...new Set(definition.allowed_entities.map((entity) => entity.scope))].sort();
    const entityTypeByScope = {
      primary_brand: "brand",
      competitor: "competitor",
      category: "category"
    } as const;
    if (definition.visibility_class !== "strategic-internal"
      || definition.acceptance_status !== "included"
      || definition.eligibility_policy !== "semantic-approved-eligible"
      || definition.deduplication_policy !== "canonical-root"
      || definition.denominator_key !== "eligible-canonical-roots"
      || stableJson([...scopes].sort()) !== stableJson(exactScopes)
      || stableJson(entityScopes) !== stableJson(exactScopes)
      || definition.allowed_entities.some((entity) =>
        entity.entity_type !== entityTypeByScope[entity.scope as keyof typeof entityTypeByScope])
      || stableJson([...definition.required_usage_purposes].sort())
        !== stableJson(["llm-processing", "strategic-analysis"])) {
      throw new Error("strategic requires the exact attributable internal analysis contract.");
    }
  }
  if (viewKey === "admin-reservoir" && definition.eligibility_policy !== "workspace-reservoir") {
    throw new Error("admin-reservoir requires workspace-reservoir eligibility.");
  }
}

export function validateSignalPopulationPolicyBundleDefinitionV1(
  input: unknown
): SignalPopulationPolicyBundleDefinitionV1 {
  const row = record(input, "policy bundle");
  const workspaceId = uuid(row.workspace_id, "workspace_id");
  const policyKey = key(row.policy_key, "policy_key");
  const policyVersion = positiveInteger(row.policy_version, "policy_version");
  const authorizedModules = uniqueSortedArray(
    row.authorized_modules,
    "authorized_modules",
    normalizeSignalGovernedViewModuleKeyV1
  );
  if (authorizedModules.length === 0) {
    throw new Error("Policy bundles require at least one authorized module.");
  }
  const allowedScopes = uniqueSortedArray(row.allowed_scopes, "allowed_scopes", (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!SCOPE_SET.has(normalized)) throw new Error("allowed_scopes contains an unknown scope.");
    return normalized as SignalMentionScopeV1;
  });
  const allowedEntities = normalizeEntities(row.allowed_entities);
  const acceptanceStatus = enumValue(row.acceptance_status, "acceptance_status", ["included", "any"] as const);
  const qualityContractStatus = enumValue(
    row.quality_contract_status,
    "quality_contract_status",
    ["resolved", "not_available"] as const
  );
  const qualityPolicyKey = nullableKey(row.quality_policy_key, "quality_policy_key");
  const qualityPolicyVersion = nullablePositiveInteger(row.quality_policy_version, "quality_policy_version");
  const minQualityScore = nullableScore(row.min_quality_score, "min_quality_score");
  const requiredQualityFlags = uniqueSortedArray(row.required_quality_flags, "required_quality_flags", (value) => key(value, "quality flag"));
  const forbiddenQualityFlags = uniqueSortedArray(row.forbidden_quality_flags, "forbidden_quality_flags", (value) => key(value, "quality flag"));
  if (requiredQualityFlags.some((flag) => forbiddenQualityFlags.includes(flag))) {
    throw new Error("A quality flag cannot be both required and forbidden.");
  }
  const eligibilityPolicy = enumValue(
    row.eligibility_policy,
    "eligibility_policy",
    SIGNAL_POLICY_ELIGIBILITY_KEYS
  );
  const visibilityClass = enumValue(
    row.visibility_class,
    "visibility_class",
    SIGNAL_POLICY_VISIBILITY_CLASSES
  );
  const denominatorKey = enumValue(
    row.denominator_key,
    "denominator_key",
    SIGNAL_POLICY_DENOMINATOR_KEYS
  );
  const deduplicationPolicy = enumValue(
    row.deduplication_policy,
    "deduplication_policy",
    ["canonical-root"] as const
  );
  const periodStart = nullableDate(row.period_start, "period_start");
  const periodEnd = nullableDate(row.period_end, "period_end");
  const timezone = nullableText(row.timezone, "timezone", 80);
  const dataGovernanceContractStatus = enumValue(
    row.data_governance_contract_status,
    "data_governance_contract_status",
    ["resolved", "not_available"] as const
  );
  const qualityPolicyId = nullableUuid(row.quality_policy_id, "quality_policy_id");
  const requiredUsagePurposes = uniqueSortedArray(
    row.required_usage_purposes,
    "required_usage_purposes",
    (value) => {
      const purpose = String(value ?? "").trim().toLowerCase();
      if (!USAGE_PURPOSE_SET.has(purpose)) throw new Error("required_usage_purposes contains an unknown usage.");
      return purpose as SignalDataUsagePurposeV1;
    }
  );
  if ((periodStart == null) !== (periodEnd == null) || (periodStart != null && timezone == null)) {
    throw new Error("A bounded policy requires period_start, period_end and timezone together.");
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new Error("period_start must not be after period_end.");
  }
  const normalized: SignalPopulationPolicyBundleDefinitionV1 = {
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspaceId,
    policy_key: policyKey,
    policy_version: policyVersion,
    authorized_modules: authorizedModules,
    allowed_scopes: allowedScopes,
    allowed_entities: allowedEntities,
    acceptance_status: acceptanceStatus,
    quality_contract_status: qualityContractStatus,
    quality_policy_key: qualityPolicyKey,
    quality_policy_version: qualityPolicyVersion,
    min_quality_score: minQualityScore,
    required_quality_flags: requiredQualityFlags,
    forbidden_quality_flags: forbiddenQualityFlags,
    eligibility_policy: eligibilityPolicy,
    deduplication_policy: deduplicationPolicy,
    visibility_class: visibilityClass,
    denominator_key: denominatorKey,
    period_start: periodStart,
    period_end: periodEnd,
    timezone,
    retention_policy_ref: nullableKey(row.retention_policy_ref, "retention_policy_ref"),
    licensing_policy_ref: nullableKey(row.licensing_policy_ref, "licensing_policy_ref"),
    data_governance_contract_status: dataGovernanceContractStatus,
    quality_policy_id: qualityPolicyId,
    required_usage_purposes: requiredUsagePurposes
  };
  if (normalized.quality_contract_status === "resolved") {
    if (!normalized.quality_policy_key || !normalized.quality_policy_version) {
      throw new Error("A resolved quality contract requires a policy key and version.");
    }
  } else if (normalized.quality_policy_key != null
    || normalized.quality_policy_version != null
    || normalized.min_quality_score != null
    || normalized.required_quality_flags.length > 0
    || normalized.forbidden_quality_flags.length > 0) {
    throw new Error("An unavailable quality contract cannot imply ungoverned quality rules.");
  }
  if (normalized.data_governance_contract_status === "resolved") {
    if (!normalized.quality_policy_id || normalized.required_usage_purposes.length === 0) {
      throw new Error("Resolved data governance requires a relational quality authority and closed usages.");
    }
  } else if (normalized.quality_policy_id != null || normalized.required_usage_purposes.length > 0) {
    throw new Error("Unavailable data governance cannot imply relational authority.");
  }
  assertPolicyCombination(normalized);
  return normalized;
}

export function signalPopulationPolicyDefinitionHashV1(
  definition: SignalPopulationPolicyBundleDefinitionV1
) {
  const normalized = validateSignalPopulationPolicyBundleDefinitionV1(definition);
  return hash(signalPopulationPolicyCanonicalDefinitionV1(normalized));
}

export function signalQualityPolicyDefinitionHashV1(input: SignalQualityPolicyDefinitionV1) {
  const required = uniqueSortedArray(input.required_quality_flags, "required_quality_flags", (value) => key(value, "quality flag"));
  const forbidden = uniqueSortedArray(input.forbidden_quality_flags, "forbidden_quality_flags", (value) => key(value, "quality flag"));
  if (required.some((flag) => forbidden.includes(flag))) throw new Error("Quality flags cannot be both required and forbidden.");
  return hash([
    "quality-policy-v1", uuid(input.workspace_id, "workspace_id"), key(input.policy_key, "policy_key"),
    positiveInteger(input.policy_version, "policy_version"), nullableScore(input.min_quality_score, "min_quality_score") ?? "∅",
    required.join(","), forbidden.join(","),
    enumValue(input.canonical_root_disposition, "canonical_root_disposition", ["evaluate", "blocked", "not_available"] as const)
  ].join("\u001f"));
}

export function signalRetentionPolicyDefinitionHashV1(input: SignalRetentionPolicyDefinitionV1) {
  const state = enumValue(input.retention_state, "retention_state", ["allowed", "blocked", "not_available"] as const);
  const mode = enumValue(input.retention_mode, "retention_mode", ["indefinite", "until", "not_available"] as const);
  const until = nullableTimestamp(input.retain_until, "retain_until");
  if ((state === "not_available") !== (mode === "not_available")
    || (mode === "until") !== (until != null)) {
    throw new Error("Retention state, mode and expiration are incompatible.");
  }
  return hash([
    "retention-policy-v1", uuid(input.workspace_id, "workspace_id"), key(input.policy_key, "policy_key"),
    positiveInteger(input.policy_version, "policy_version"), state, mode, until ?? "∅",
    enumValue(input.expiry_action, "expiry_action", ["block_use", "review_required", "not_available"] as const),
    nullableGovernedHash(input.approval_evidence_hash, "approval_evidence_hash") ?? "∅"
  ].join("\u001f"));
}

export function signalLicensingPolicyDefinitionHashV1(input: SignalLicensingPolicyDefinitionV1) {
  const usages = uniqueSortedArray(input.usages, "usages", (entry) => {
    const row = record(entry, "usage");
    const purpose = String(row.usage_purpose ?? "").trim().toLowerCase();
    if (!USAGE_PURPOSE_SET.has(purpose)) throw new Error("usage_purpose is not supported.");
    return `${purpose}:${enumValue(row.decision, "decision", ["allowed", "prohibited", "not_available"] as const)}`;
  });
  if (usages.length === 0) throw new Error("Licensing policies require at least one usage decision.");
  return hash([
    "licensing-policy-v1", uuid(input.workspace_id, "workspace_id"), key(input.policy_key, "policy_key"),
    positiveInteger(input.policy_version, "policy_version"),
    nullableGovernedHash(input.approval_evidence_hash, "approval_evidence_hash") ?? "∅", usages.join(",")
  ].join("\u001f"));
}

export function signalProvenancePolicyBindingDefinitionHashV1(input: SignalProvenancePolicyBindingDefinitionV1) {
  return hash([
    "signal-provenance-policy-binding-v1",
    uuid(input.workspace_id, "workspace_id"),
    uuid(input.data_source_id, "data_source_id"),
    nullableUuid(input.import_batch_id, "import_batch_id") ?? "∅",
    positiveInteger(input.binding_version, "binding_version"),
    uuid(input.quality_policy_id, "quality_policy_id"),
    uuid(input.retention_policy_id, "retention_policy_id"),
    uuid(input.licensing_policy_id, "licensing_policy_id")
  ].join("\u001f"));
}

export function signalDerivedPopulationDefinitionHashV1(args: {
  workspace_id: string;
  policy_bundle_id: string;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  population_key: string;
  population_version: number;
  acceptance_status: "included" | "any";
  allowed_scopes: SignalMentionScopeV1[];
  quality_contract_status: "resolved" | "not_available";
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  period_start: string | null;
  period_end: string | null;
  timezone: string | null;
}) {
  const normalized = {
    contract_version: "signal-governed-population-compilation-v1",
    workspace_id: uuid(args.workspace_id, "workspace_id"),
    policy_bundle_id: uuid(args.policy_bundle_id, "policy_bundle_id"),
    policy_definition_hash: governedHash(args.policy_definition_hash, "policy_definition_hash"),
    compiled_plan_hash: governedHash(args.compiled_plan_hash, "compiled_plan_hash"),
    population_key: key(args.population_key, "population_key"),
    population_version: positiveInteger(args.population_version, "population_version"),
    acceptance_status: enumValue(args.acceptance_status, "acceptance_status", ["included", "any"] as const),
    allowed_scopes: uniqueSortedArray(args.allowed_scopes, "allowed_scopes", (value) => {
      const scope = String(value ?? "").trim().toLowerCase();
      if (!SCOPE_SET.has(scope)) throw new Error("allowed_scopes contains an unknown scope.");
      return scope as SignalMentionScopeV1;
    }),
    quality_contract_status: enumValue(
      args.quality_contract_status,
      "quality_contract_status",
      ["resolved", "not_available"] as const
    ),
    min_quality_score: nullableScore(args.min_quality_score, "min_quality_score"),
    required_quality_flags: uniqueSortedArray(args.required_quality_flags, "required_quality_flags", (value) => key(value, "quality flag")),
    forbidden_quality_flags: uniqueSortedArray(args.forbidden_quality_flags, "forbidden_quality_flags", (value) => key(value, "quality flag")),
    period_start: nullableDate(args.period_start, "period_start"),
    period_end: nullableDate(args.period_end, "period_end"),
    timezone: nullableText(args.timezone, "timezone", 80)
  };
  return hash(stableJson(normalized));
}

export function compileSignalPopulationPolicyBundleV1(args: {
  policy_bundle_id: string;
  definition_hash: string;
  definition: SignalPopulationPolicyBundleDefinitionV1;
}): SignalCompiledPopulationPolicyV1 {
  const definition = validateSignalPopulationPolicyBundleDefinitionV1(args.definition);
  const expectedHash = signalPopulationPolicyDefinitionHashV1(definition);
  const suppliedHash = String(args.definition_hash ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(suppliedHash) || suppliedHash !== expectedHash) {
    throw new Error("definition_hash does not match the normalized policy bundle.");
  }
  const policy: SignalPopulationPolicyBundleIdentityV1 = {
    workspace_id: definition.workspace_id,
    policy_bundle_id: uuid(args.policy_bundle_id, "policy_bundle_id"),
    policy_key: definition.policy_key,
    policy_version: definition.policy_version,
    definition_hash: suppliedHash
  };
  const predicate: SignalCompiledPopulationPolicyV1["predicate"] = {
    canonical_root_only: true,
    acceptance_status: definition.acceptance_status,
    semantic_assertion: definition.eligibility_policy === "semantic-approved-eligible"
      ? {
          attribution_basis: "mention_semantic",
          is_current: true,
          review_status: "approved",
          eligibility_status: "eligible",
          allowed_scopes: definition.allowed_scopes,
          allowed_entities: definition.allowed_entities
        }
      : null,
    quality: {
      contract_status: definition.quality_contract_status,
      policy_key: definition.quality_policy_key,
      policy_version: definition.quality_policy_version,
      min_score: definition.min_quality_score,
      required_flags: definition.required_quality_flags,
      forbidden_flags: definition.forbidden_quality_flags,
      policy_id: definition.quality_policy_id
    },
    data_governance: {
      contract_status: definition.data_governance_contract_status,
      required_usage_purposes: definition.required_usage_purposes,
      provenance_precedence: "import-over-source",
      authorization_rule: "any-authorized-provenance"
    },
    period: definition.period_start && definition.period_end && definition.timezone
      ? { start: definition.period_start, end: definition.period_end, timezone: definition.timezone }
      : null
  };
  const denominator = {
    key: definition.denominator_key,
    unit: "canonical-root" as const,
    deduplication_policy: "canonical-root" as const
  };
  const blockingReasons: SignalCompiledPopulationPolicyV1["readiness"]["blocking_reasons"] = [];
  if (definition.visibility_class === "client-safe") {
    if (definition.quality_contract_status === "not_available") blockingReasons.push("quality_policy_not_available");
    if (definition.data_governance_contract_status === "not_available") {
      blockingReasons.push("data_governance_policy_not_available");
      blockingReasons.push("retention_policy_not_available");
      blockingReasons.push("licensing_policy_not_available");
    }
  }
  const readiness = {
    status: blockingReasons.length === 0 ? "ready" as const : "blocked" as const,
    blocking_reasons: blockingReasons
  };
  const planCore = {
    policy,
    predicate,
    deduplication: { unit: "canonical-root", strategy: "distinct-root-id" },
    denominator,
    readiness
  };
  return {
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    ...planCore,
    deduplication: planCore.deduplication as SignalCompiledPopulationPolicyV1["deduplication"],
    plan_hash: hash(stableJson(planCore))
  };
}

export function resolveSignalPolicyMembershipCandidatesV1(
  plan: SignalCompiledPopulationPolicyV1,
  candidates: SignalPolicyMembershipCandidateV1[]
) {
  if (!plan.predicate.semantic_assertion) {
    throw new Error("Only semantic-approved-eligible policy plans can resolve operational membership candidates.");
  }
  const roots = new Set<string>();
  for (const candidate of candidates) {
    const rootId = uuid(candidate.canonical_mention_id, "canonical_mention_id");
    if (candidate.governance_eligibility !== "authorized") continue;
    if (plan.predicate.acceptance_status === "included" && candidate.inclusion_status !== "included") continue;
    if (plan.predicate.quality.min_score != null && (candidate.quality_score ?? -Infinity) < plan.predicate.quality.min_score) continue;
    const flags = new Set(candidate.quality_flags);
    if (plan.predicate.quality.required_flags.some((flag) => !flags.has(flag))) continue;
    if (plan.predicate.quality.forbidden_flags.some((flag) => flags.has(flag))) continue;
    if (plan.predicate.period) {
      if (!candidate.published_at) continue;
      const date = candidate.published_at.slice(0, 10);
      if (date < plan.predicate.period.start || date > plan.predicate.period.end) continue;
    }
    const eligible = candidate.assertions.some((assertion) => {
      if (assertion.attribution_basis !== "mention_semantic"
        || !assertion.is_current
        || assertion.review_status !== "approved"
        || assertion.eligibility_status !== "eligible"
        || !plan.predicate.semantic_assertion!.allowed_scopes.includes(assertion.scope)) {
        return false;
      }
      return plan.predicate.semantic_assertion!.allowed_entities.some((entity) =>
        entity.scope === assertion.scope
          && entity.entity_type === assertion.entity_type
          && entity.entity_id === assertion.entity_id
      );
    });
    if (eligible) roots.add(rootId);
  }
  return [...roots].sort();
}

export function validateSignalCoverageDescriptorV1(input: unknown): SignalCoverageDescriptorV1 {
  const row = record(input, "coverage");
  const descriptor: SignalCoverageDescriptorV1 = {
    state: enumValue(row.state, "coverage.state", ["complete", "partial", "not_available"] as const),
    captured: coverageMeasurement(row.captured, "coverage.captured"),
    quality_eligible: coverageMeasurement(row.quality_eligible, "coverage.quality_eligible"),
    unreviewed: coverageMeasurement(row.unreviewed, "coverage.unreviewed"),
    reviewed: coverageMeasurement(row.reviewed, "coverage.reviewed"),
    resolved_attributed: coverageMeasurement(row.resolved_attributed, "coverage.resolved_attributed"),
    abstained: coverageMeasurement(row.abstained, "coverage.abstained"),
    unattributed: coverageMeasurement(row.unattributed, "coverage.unattributed"),
    used_by_view: coverageMeasurement(row.used_by_view, "coverage.used_by_view")
  };
  const allMeasurements = [
    descriptor.captured,
    descriptor.quality_eligible,
    descriptor.unreviewed,
    descriptor.reviewed,
    descriptor.resolved_attributed,
    descriptor.abstained,
    descriptor.unattributed,
    descriptor.used_by_view
  ];
  const unavailableCount = allMeasurements.filter((measurement) => measurement.availability === "not_available").length;
  if ((descriptor.state === "complete" && unavailableCount !== 0)
    || (descriptor.state === "partial" && (
      unavailableCount === 0
      || descriptor.captured.availability !== "available"
      || descriptor.used_by_view.availability !== "available"
    ))
    || (descriptor.state === "not_available"
      && descriptor.captured.availability === "available"
      && descriptor.used_by_view.availability === "available")) {
    throw new Error("coverage.state does not match measurement availability.");
  }
  const count = (measurement: SignalCoverageMeasurementV1) =>
    measurement.availability === "available" ? measurement.count : null;
  const captured = count(descriptor.captured);
  const qualityEligible = count(descriptor.quality_eligible);
  const unreviewed = count(descriptor.unreviewed);
  const reviewed = count(descriptor.reviewed);
  const resolvedAttributed = count(descriptor.resolved_attributed);
  const abstained = count(descriptor.abstained);
  const unattributed = count(descriptor.unattributed);
  const usedByView = count(descriptor.used_by_view);
  if ((captured != null && qualityEligible != null && qualityEligible > captured)
    || (captured != null && reviewed != null && reviewed > captured)
    || (captured != null && unreviewed != null && unreviewed > captured)
    || (captured != null && reviewed != null && unreviewed != null && reviewed + unreviewed > captured)
    || (reviewed != null && resolvedAttributed != null && resolvedAttributed > reviewed)
    || (reviewed != null && abstained != null && abstained > reviewed)
    || (reviewed != null && unattributed != null && unattributed > reviewed)
    || (reviewed != null && resolvedAttributed != null && abstained != null && unattributed != null
      && resolvedAttributed + abstained + unattributed > reviewed)
    || (captured != null && usedByView != null && usedByView > captured)
    || (qualityEligible != null && usedByView != null && usedByView > qualityEligible)) {
    throw new Error("coverage counts violate the governed coverage ordering.");
  }
  return descriptor;
}

export function signalServingUsagePurposesForModuleViewV1(
  moduleKeyInput: unknown,
  viewKeyInput: unknown
): SignalDataUsagePurposeV1[] {
  const moduleKey = normalizeSignalGovernedViewModuleKeyV1(moduleKeyInput);
  const viewKey = normalizeSignalGovernedViewKeyV1(viewKeyInput);
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  if (isSignalClientGovernedViewModuleKeyV1(moduleKey)
    && isSignalClientGovernedViewKeyV1(viewKey)) {
    return signalDataUsagePurposesForModuleViewV1(moduleKey, viewKey);
  }
  if (moduleKey === "triggers-barriers" && viewKey === "strategic") {
    // Strategic consumption needs both authorities. Permission to derive an
    // analysis does not imply permission to send the governed evidence to an
    // LLM, and vice versa. Keep this exact (and sorted) contract fail-closed.
    return ["llm-processing", "strategic-analysis"];
  }
  if (moduleKey === "admin-mentions" && viewKey === "admin-reservoir") {
    return ["internal-qa"];
  }
  throw new Error(`No serving usage contract is published for ${moduleKey}/${viewKey}.`);
}

export function validateSignalServingScopeDescriptorV1(
  input: unknown
): SignalServingScopeDescriptorV1 {
  const row = record(input, "serving scope");
  if (row.contract_version !== SIGNAL_SERVING_SCOPE_CONTRACT_VERSION) {
    throw new Error(`serving scope contract_version must be ${SIGNAL_SERVING_SCOPE_CONTRACT_VERSION}.`);
  }
  const workspaceId = uuid(row.workspace_id, "workspace_id");
  const moduleKey = normalizeSignalGovernedViewModuleKeyV1(row.module_key);
  const viewKey = normalizeSignalGovernedViewKeyV1(row.view_key);
  assertSignalGovernedViewCompatibilityV1(moduleKey, viewKey);
  const rolloutMode = enumValue(row.rollout_mode, "rollout_mode", SIGNAL_SERVING_ROLLOUT_MODES);
  const resolutionSource = enumValue(
    row.resolution_source,
    "resolution_source",
    SIGNAL_SERVING_RESOLUTION_SOURCES
  );
  const visibleSource = enumValue(
    row.visible_source,
    "visible_source",
    SIGNAL_SERVING_VISIBLE_SOURCES
  );
  const expectedVisibleSource = rolloutMode === "governed" ? resolutionSource : "legacy";
  if (visibleSource !== expectedVisibleSource) {
    throw new Error(`${rolloutMode} serving must expose ${expectedVisibleSource} as visible_source.`);
  }

  const binding = normalizeServingBinding(row.binding, workspaceId, moduleKey, viewKey);
  const policy = normalizeServingPolicy(row.policy, workspaceId);
  const population = normalizeServingPopulation(row.population);
  const compilation = normalizeServingCompilation(row.compilation);
  if (resolutionSource === "operational-brand-bridge" && viewKey !== "brand") {
    throw new Error("The operational bridge is only valid for the brand view.");
  }
  if (resolutionSource === "governed-binding") {
    if (!binding || !policy.policy_bundle_id || !compilation) {
      throw new Error("Governed binding resolution requires binding, policy bundle and ready compilation identities.");
    }
    if (population.policy_compilation_id !== compilation.policy_compilation_id
      || population.compiled_plan_hash !== compilation.compiled_plan_hash
      || population.compilation_status !== "ready") {
      throw new Error("Population and compilation identities do not describe the same ready authority.");
    }
  } else if (binding != null || policy.policy_bundle_id != null || compilation != null) {
    throw new Error("Operational bridge resolution cannot imply a governed binding or compilation.");
  }

  const visibilityClass = enumValue(
    row.visibility_class,
    "visibility_class",
    SIGNAL_POLICY_VISIBILITY_CLASSES
  );
  if (isSignalClientGovernedViewKeyV1(viewKey)) {
    if (!isSignalClientGovernedViewModuleKeyV1(moduleKey)
      || visibilityClass !== "client-safe") {
      throw new Error(`${moduleKey}/${viewKey} must use a client-safe serving contract.`);
    }
  }
  const usagePurposes = uniqueSortedArray(
    row.usage_purposes,
    "usage_purposes",
    (value) => enumValue(value, "usage purpose", SIGNAL_DATA_USAGE_PURPOSES)
  );
  const expectedUsagePurposes = signalServingUsagePurposesForModuleViewV1(moduleKey, viewKey);
  if (stableJson(usagePurposes) !== stableJson(expectedUsagePurposes)) {
    throw new Error(`usage_purposes do not match the closed ${moduleKey}/${viewKey} serving contract.`);
  }

  const watermark = normalizeServingWatermark(row.watermark);
  const freshness = normalizeServingFreshness(row.freshness);
  if (watermark.availability === "not_available" && freshness.state !== "not_available") {
    throw new Error("Freshness cannot be asserted without an available governed watermark.");
  }
  if (resolutionSource === "governed-binding" && watermark.availability !== "available") {
    throw new Error("Governed binding serving requires a durable watermark.");
  }
  const coverage = validateSignalCoverageDescriptorV1(row.coverage);
  const denominator = normalizeServingDenominator(row.denominator);
  if (isSignalClientGovernedViewKeyV1(viewKey)
    && denominator.key !== "eligible-canonical-roots") {
    throw new Error(`${viewKey} must use the eligible canonical-root denominator.`);
  }
  if (coverage.used_by_view.availability !== "available"
    || coverage.used_by_view.count !== denominator.count) {
    throw new Error("denominator.count must equal the measured canonical roots used by the view.");
  }
  const period = normalizeServingPeriod(row.period);
  return {
    contract_version: SIGNAL_SERVING_SCOPE_CONTRACT_VERSION,
    workspace_id: workspaceId,
    module_key: moduleKey,
    view_key: viewKey,
    rollout_mode: rolloutMode,
    resolution_source: resolutionSource,
    visible_source: visibleSource,
    binding,
    policy,
    population,
    compilation,
    visibility_class: visibilityClass,
    usage_purposes: usagePurposes,
    watermark,
    freshness,
    coverage,
    denominator,
    period
  };
}

/** Stable identity for ETags, cursor isolation and module-serving comparisons. */
export function signalServingScopeIdentityHashV1(input: unknown) {
  return hash(stableJson(validateSignalServingScopeDescriptorV1(input)));
}

export function signalServingScopeEtagSeedV1(args: {
  scope: unknown;
  normalized_filters_hash: string;
  normalized_sort_hash: string;
}) {
  return servingScopeToken("etag", args);
}

export function signalServingScopeCursorIsolationHashV1(args: {
  scope: unknown;
  normalized_filters_hash: string;
  normalized_sort_hash: string;
}) {
  return servingScopeToken("cursor", args);
}

function normalizeServingBinding(
  input: unknown,
  workspaceId: string,
  moduleKey: SignalGovernedViewModuleKeyV1,
  viewKey: SignalGovernedViewKeyV1
): SignalGovernedViewBindingIdentityV1 | null {
  if (input == null) return null;
  const row = record(input, "binding");
  const normalized: SignalGovernedViewBindingIdentityV1 = {
    workspace_id: uuid(row.workspace_id, "binding.workspace_id"),
    binding_id: uuid(row.binding_id, "binding.binding_id"),
    binding_version: positiveInteger(row.binding_version, "binding.binding_version"),
    module_key: normalizeSignalGovernedViewModuleKeyV1(row.module_key),
    view_key: normalizeSignalGovernedViewKeyV1(row.view_key)
  };
  if (normalized.workspace_id !== workspaceId
    || normalized.module_key !== moduleKey
    || normalized.view_key !== viewKey) {
    throw new Error("Binding identity is outside the serving workspace/module/view.");
  }
  return normalized;
}

function normalizeServingPolicy(
  input: unknown,
  workspaceId: string
): SignalPopulationPolicyBundleIdentityV1 {
  const row = record(input, "policy");
  const normalized: SignalPopulationPolicyBundleIdentityV1 = {
    workspace_id: uuid(row.workspace_id, "policy.workspace_id"),
    policy_bundle_id: nullableUuid(row.policy_bundle_id, "policy.policy_bundle_id"),
    policy_key: key(row.policy_key, "policy.policy_key"),
    policy_version: positiveInteger(row.policy_version, "policy.policy_version"),
    definition_hash: governedHash(row.definition_hash, "policy.definition_hash")
  };
  if (normalized.workspace_id !== workspaceId) {
    throw new Error("Policy identity is outside the serving workspace.");
  }
  return normalized;
}

function normalizeServingPopulation(
  input: unknown
): Exclude<SignalGovernedPopulationReferenceV1, null> {
  const row = record(input, "population");
  const compilationStatus = row.compilation_status == null
    ? null
    : enumValue(row.compilation_status, "population.compilation_status", ["ready", "stale", "blocked"] as const);
  return {
    population_id: uuid(row.population_id, "population.population_id"),
    population_key: key(row.population_key, "population.population_key"),
    population_version: positiveInteger(row.population_version, "population.population_version"),
    definition_hash: governedHash(row.definition_hash, "population.definition_hash"),
    membership_digest: governedHash(row.membership_digest, "population.membership_digest"),
    policy_compilation_id: nullableUuid(row.policy_compilation_id, "population.policy_compilation_id"),
    compiled_plan_hash: nullableGovernedHash(row.compiled_plan_hash, "population.compiled_plan_hash"),
    compilation_status: compilationStatus
  };
}

function normalizeServingCompilation(
  input: unknown
): SignalServingCompilationIdentityV1 | null {
  if (input == null) return null;
  const row = record(input, "compilation");
  return {
    policy_compilation_id: uuid(row.policy_compilation_id, "compilation.policy_compilation_id"),
    compiled_plan_hash: governedHash(row.compiled_plan_hash, "compilation.compiled_plan_hash"),
    compilation_status: enumValue(row.compilation_status, "compilation.compilation_status", ["ready"] as const)
  };
}

function normalizeServingWatermark(input: unknown): SignalServingWatermarkDescriptorV1 {
  const row = record(input, "watermark");
  const availability = enumValue(
    row.availability,
    "watermark.availability",
    ["available", "not_available"] as const
  );
  if (availability === "not_available") {
    for (const field of [
      "data_watermark_hash",
      "source_watermark_hash",
      "governance_digest",
      "captured_at",
      "next_policy_transition_at"
    ]) {
      if (row[field] != null) throw new Error(`watermark.${field} must be null when not available.`);
    }
    return {
      availability,
      data_watermark_hash: null,
      source_watermark_hash: null,
      governance_digest: null,
      captured_at: null,
      next_policy_transition_at: null
    };
  }
  const capturedAt = requiredTimestamp(row.captured_at, "watermark.captured_at");
  const nextPolicyTransitionAt = nullableTimestamp(
    row.next_policy_transition_at,
    "watermark.next_policy_transition_at"
  );
  if (nextPolicyTransitionAt && nextPolicyTransitionAt <= capturedAt) {
    throw new Error("watermark.next_policy_transition_at must be after captured_at.");
  }
  return {
    availability,
    data_watermark_hash: governedHash(row.data_watermark_hash, "watermark.data_watermark_hash"),
    source_watermark_hash: governedHash(row.source_watermark_hash, "watermark.source_watermark_hash"),
    governance_digest: governedHash(row.governance_digest, "watermark.governance_digest"),
    captured_at: capturedAt,
    next_policy_transition_at: nextPolicyTransitionAt
  };
}

function normalizeServingFreshness(input: unknown): SignalServingFreshnessDescriptorV1 {
  const row = record(input, "freshness");
  const state = enumValue(row.state, "freshness.state", ["fresh", "stale", "partial", "not_available"] as const);
  const invalidationState = enumValue(
    row.invalidation_state,
    "freshness.invalidation_state",
    ["valid", "invalidated", "not_available"] as const
  );
  const invalidatedAt = nullableTimestamp(row.invalidated_at, "freshness.invalidated_at");
  if ((invalidationState === "invalidated") !== (invalidatedAt != null)) {
    throw new Error("freshness.invalidated_at must be present exactly when invalidated.");
  }
  if (invalidationState === "invalidated" && state !== "stale") {
    throw new Error("An invalidated scope must report stale freshness.");
  }
  if ((state === "not_available") !== (invalidationState === "not_available")) {
    throw new Error("Unavailable freshness and invalidation states must be reported together.");
  }
  return { state, invalidation_state: invalidationState, invalidated_at: invalidatedAt };
}

function normalizeServingDenominator(input: unknown): SignalDenominatorDescriptorV1 {
  const row = record(input, "denominator");
  return {
    key: enumValue(row.key, "denominator.key", SIGNAL_POLICY_DENOMINATOR_KEYS),
    unit: enumValue(row.unit, "denominator.unit", ["canonical-root"] as const),
    count: nonnegativeInteger(row.count, "denominator.count"),
    deduplication_policy: enumValue(
      row.deduplication_policy,
      "denominator.deduplication_policy",
      ["canonical-root"] as const
    )
  };
}

function normalizeServingPeriod(
  input: unknown
): SignalServingScopeDescriptorV1["period"] {
  if (input == null) return null;
  const row = record(input, "period");
  const start = nullableDate(row.start, "period.start");
  const end = nullableDate(row.end, "period.end");
  const timezone = nullableText(row.timezone, "period.timezone", 80);
  if (!start || !end || !timezone) throw new Error("A serving period requires start, end and timezone.");
  if (start > end) throw new Error("period.start must not be after period.end.");
  return { start, end, timezone };
}

function servingScopeToken(
  tokenKind: "etag" | "cursor",
  args: {
    scope: unknown;
    normalized_filters_hash: string;
    normalized_sort_hash: string;
  }
) {
  return hash(stableJson({
    contract_version: "signal-serving-scope-token-v1",
    token_kind: tokenKind,
    serving_scope_identity_hash: signalServingScopeIdentityHashV1(args.scope),
    normalized_filters_hash: governedHash(args.normalized_filters_hash, "normalized_filters_hash"),
    normalized_sort_hash: governedHash(args.normalized_sort_hash, "normalized_sort_hash")
  }));
}

function assertPolicyCombination(definition: SignalPopulationPolicyBundleDefinitionV1) {
  if (definition.eligibility_policy === "semantic-approved-eligible") {
    if (definition.allowed_scopes.length === 0 || definition.allowed_entities.length === 0) {
      throw new Error("Semantic policy bundles require explicit governed scopes and entities.");
    }
    if (definition.allowed_scopes.includes("unattributed")) {
      throw new Error("Unattributed semantics cannot be eligible for a governed denominator.");
    }
    for (const scope of definition.allowed_scopes) {
      if (!definition.allowed_entities.some((entity) => entity.scope === scope)) {
        throw new Error(`Scope ${scope} has no governed entity allowlist.`);
      }
    }
  }
  if (definition.visibility_class === "client-safe") {
    if (definition.eligibility_policy !== "semantic-approved-eligible"
      || definition.acceptance_status !== "included"
      || definition.denominator_key !== "eligible-canonical-roots") {
      throw new Error("Client-safe policies require included, approved semantic canonical roots.");
    }
  }
  if (definition.eligibility_policy === "workspace-reservoir"
    && (definition.visibility_class !== "operator-only"
      || definition.denominator_key !== "workspace-canonical-roots")) {
    throw new Error("Workspace reservoir policies must be operator-only workspace denominators.");
  }
  if (definition.eligibility_policy === "snapshot-membership"
    && (definition.visibility_class !== "strategic-internal"
      || definition.denominator_key !== "snapshot-canonical-roots")) {
    throw new Error("Snapshot policies must use the strategic snapshot denominator.");
  }
}

function signalPopulationPolicyCanonicalDefinitionV1(
  definition: SignalPopulationPolicyBundleDefinitionV1
) {
  const nullable = (value: string | number | null) => value == null ? "∅" : String(value);
  return [
    definition.contract_version,
    definition.workspace_id,
    definition.policy_key,
    definition.policy_version,
    definition.authorized_modules.join(","),
    definition.allowed_scopes.join(","),
    definition.allowed_entities
      .map((entity) => `${entity.scope}:${entity.entity_type}:${entity.entity_id}`)
      .join(","),
    definition.acceptance_status,
    definition.quality_contract_status,
    nullable(definition.quality_policy_key),
    nullable(definition.quality_policy_version),
    nullable(definition.min_quality_score),
    definition.required_quality_flags.join(","),
    definition.forbidden_quality_flags.join(","),
    definition.eligibility_policy,
    definition.deduplication_policy,
    definition.visibility_class,
    definition.denominator_key,
    nullable(definition.period_start),
    nullable(definition.period_end),
    nullable(definition.timezone),
    nullable(definition.retention_policy_ref),
    nullable(definition.licensing_policy_ref),
    definition.data_governance_contract_status,
    nullable(definition.quality_policy_id),
    definition.required_usage_purposes.join(",")
  ].join("\u001f");
}

function normalizeEntities(input: unknown) {
  if (!Array.isArray(input)) throw new Error("allowed_entities must be an array.");
  const values = input.map((item) => {
    const row = record(item, "allowed entity");
    const scope = String(row.scope ?? "").trim().toLowerCase();
    if (!SCOPE_SET.has(scope) || scope === "unattributed") {
      throw new Error("allowed entity scope must identify a governed entity.");
    }
    const entityType = enumValue(
      row.entity_type,
      "entity_type",
      ["brand", "competitor", "category", "reference"] as const
    );
    const expectedType = scope === "primary_brand" ? "brand" : scope;
    if (entityType !== expectedType) throw new Error("allowed entity type does not match its scope.");
    return { scope, entity_type: entityType, entity_id: uuid(row.entity_id, "entity_id") } as SignalPolicyEntityReferenceV1;
  });
  const identity = (value: SignalPolicyEntityReferenceV1) =>
    `${value.scope}\u001f${value.entity_type}\u001f${value.entity_id}`;
  const deduped = new Map(values.map((value) => [identity(value), value]));
  return [...deduped.values()].sort((left, right) =>
    compareCanonical(left.scope, right.scope)
    || compareCanonical(left.entity_type, right.entity_type)
    || compareCanonical(left.entity_id, right.entity_id));
}

function uniqueSortedArray<T>(
  input: unknown,
  field: string,
  normalize: (value: unknown) => T
) {
  if (!Array.isArray(input)) throw new Error(`${field} must be an array.`);
  return [...new Set(input.map(normalize))].sort((left, right) => compareCanonical(String(left), String(right)));
}

function record(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${field} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function enumValue<const T extends readonly string[]>(input: unknown, field: string, values: T): T[number] {
  const value = String(input ?? "").trim().toLowerCase();
  if (!new Set<string>(values).has(value)) throw new Error(`${field} is not supported.`);
  return value as T[number];
}

function uuid(input: unknown, field: string) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
  return value;
}

function key(input: unknown, field: string) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!KEY_PATTERN.test(value)) throw new Error(`${field} must be a canonical kebab-case key.`);
  return value;
}

function governedHash(input: unknown, field: string) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(value)) throw new Error(`${field} must be a SHA-256 identity.`);
  return value;
}

function nullableGovernedHash(input: unknown, field: string) {
  return input == null || input === "" ? null : governedHash(input, field);
}

function nullableKey(input: unknown, field: string) {
  return input == null || input === "" ? null : key(input, field);
}

function nullableUuid(input: unknown, field: string) {
  return input == null || input === "" ? null : uuid(input, field);
}

function positiveInteger(input: unknown, field: string) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer.`);
  return value;
}

function nonnegativeInteger(input: unknown, field: string) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
  return value;
}

function nullablePositiveInteger(input: unknown, field: string) {
  if (input == null || input === "") return null;
  return positiveInteger(input, field);
}

function coverageMeasurement(input: unknown, field: string): SignalCoverageMeasurementV1 {
  const row = record(input, field);
  const availability = enumValue(
    row.availability,
    `${field}.availability`,
    ["available", "not_available"] as const
  );
  if (availability === "not_available") {
    if (row.count != null) throw new Error(`${field}.count must be null when not available.`);
    return { availability, count: null };
  }
  return { availability, count: nonnegativeInteger(row.count, `${field}.count`) };
}

function nullableScore(input: unknown, field: string) {
  if (input == null || input === "") return null;
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error(`${field} must be between 0 and 10.`);
  return value;
}

function nullableDate(input: unknown, field: string) {
  if (input == null || input === "") return null;
  const value = String(input).trim();
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be an ISO date.`);
  }
  return value;
}

function nullableTimestamp(input: unknown, field: string) {
  if (input == null || input === "") return null;
  const value = String(input).trim();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function requiredTimestamp(input: unknown, field: string) {
  const value = nullableTimestamp(input, field);
  if (!value) throw new Error(`${field} is required.`);
  return value;
}

function nullableText(input: unknown, field: string, maxLength: number) {
  if (input == null || input === "") return null;
  const value = String(input).trim();
  if (!value || value.length > maxLength) throw new Error(`${field} is invalid.`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyName, nested]) => `${JSON.stringify(keyName)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function compareCanonical(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
