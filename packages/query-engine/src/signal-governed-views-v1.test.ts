import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_CLIENT_VIEW_USAGE_PURPOSES,
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  assertSignalGovernedPolicyViewContractV1,
  assertSignalGovernedViewCompatibilityV1,
  compileSignalPopulationPolicyBundleV1,
  normalizeSignalClientGovernedViewKeyV1,
  normalizeSignalGovernedViewKeyV1,
  normalizeSignalGovernedViewModuleKeyV1,
  resolveSignalPolicyMembershipCandidatesV1,
  signalDataUsagePurposesForModuleViewV1,
  signalDerivedPopulationDefinitionHashV1,
  signalGovernedViewCompilationPlanHashV1,
  signalGovernedModuleViewContractHashV1,
  signalGovernedModuleViewContractV1,
  signalPopulationPolicyDefinitionHashV1,
  signalServingScopeCursorIsolationHashV1,
  signalServingScopeEtagSeedV1,
  signalServingScopeIdentityHashV1,
  signalServingUsagePurposesForModuleViewV1,
  validateSignalCoverageDescriptorV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  validateSignalServingScopeDescriptorV1
} from "./signal-governed-views-v1";

test("client data-use requirements are closed for every module/view instead of unioned", () => {
  for (const view of ["brand", "competition", "category", "all-governed"] as const) {
    assert.deepEqual(
      signalDataUsagePurposesForModuleViewV1("brand-monitoring", view),
      ["client-derived-metrics"]
    );
    assert.deepEqual(
      signalDataUsagePurposesForModuleViewV1("mentions", view),
      ["client-mention-list", "client-text-or-excerpt"]
    );
    assert.deepEqual(
      signalDataUsagePurposesForModuleViewV1("topics-narratives", view),
      ["client-derived-metrics"]
    );
  }
  assert.equal(
    Object.values(SIGNAL_CLIENT_VIEW_USAGE_PURPOSES)
      .flatMap((byView) => Object.keys(byView)).length,
    12
  );
  assert.throws(() => signalDataUsagePurposesForModuleViewV1("admin-mentions", "admin-reservoir"));
  assert.throws(() => signalDataUsagePurposesForModuleViewV1("mentions", "unknown" as never));
  assert.throws(() => signalDataUsagePurposesForModuleViewV1("unknown" as never, "brand"));
});

test("bundle usages are a capability envelope and module plan hashes stay isolated", () => {
  const basePlanHash = `sha256:${"1".repeat(64)}`;
  const capabilities = [
    "client-derived-metrics",
    "client-mention-list",
    "client-text-or-excerpt"
  ] as const;
  const common = {
    base_plan_hash: basePlanHash,
    view_key: "brand" as const,
    authorized_modules: ["brand-monitoring", "mentions", "topics-narratives"] as const,
    capability_usage_purposes: [...capabilities]
  };
  const monitoring = signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules],
    module_key: "brand-monitoring"
  });
  const mentions = signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules],
    module_key: "mentions"
  });
  const topics = signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules],
    module_key: "topics-narratives"
  });
  assert.notEqual(monitoring, mentions);
  assert.notEqual(topics, mentions);
  assert.notEqual(monitoring, topics);
  assert.equal(monitoring, signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules].reverse(),
    capability_usage_purposes: [...common.capability_usage_purposes].reverse(),
    module_key: "brand-monitoring"
  }));
  assert.throws(() => signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules],
    capability_usage_purposes: ["client-derived-metrics"],
    module_key: "mentions"
  }), /capability envelope/iu);
});

test("strategic compilation plan uses the exact internal usage contract", () => {
  const input = {
    base_plan_hash: `sha256:${"7".repeat(64)}`,
    module_key: "triggers-barriers" as const,
    view_key: "strategic" as const,
    authorized_modules: ["triggers-barriers" as const],
    capability_usage_purposes: ["strategic-analysis", "llm-processing"] as const
  };
  const plan = signalGovernedViewCompilationPlanHashV1({
    ...input,
    capability_usage_purposes: [...input.capability_usage_purposes]
  });
  assert.match(plan, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan, signalGovernedViewCompilationPlanHashV1({
    ...input,
    capability_usage_purposes: [...input.capability_usage_purposes].reverse()
  }));
  assert.throws(() => signalGovernedViewCompilationPlanHashV1({
    ...input,
    capability_usage_purposes: ["strategic-analysis"]
  }), /capability envelope/iu);

  const strategic = validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspaceId,
    policy_key: "triggers-barriers-strategic-governed",
    policy_version: 1,
    authorized_modules: ["triggers-barriers"],
    allowed_scopes: ["primary_brand", "competitor", "category"],
    allowed_entities: [
      { scope: "primary_brand", entity_type: "brand", entity_id: brandId },
      { scope: "competitor", entity_type: "competitor", entity_id: competitorId },
      { scope: "category", entity_type: "category", entity_id: categoryId }
    ],
    acceptance_status: "included",
    quality_contract_status: "resolved",
    quality_policy_key: "quality",
    quality_policy_version: 1,
    min_quality_score: null,
    required_quality_flags: [],
    forbidden_quality_flags: [],
    eligibility_policy: "semantic-approved-eligible",
    deduplication_policy: "canonical-root",
    visibility_class: "strategic-internal",
    denominator_key: "eligible-canonical-roots",
    period_start: null,
    period_end: null,
    timezone: "America/Mexico_City",
    retention_policy_ref: "provenance-bound-retention",
    licensing_policy_ref: "provenance-bound-licensing",
    data_governance_contract_status: "resolved",
    quality_policy_id: qualityPolicyId,
    required_usage_purposes: ["llm-processing", "strategic-analysis"]
  });
  assert.doesNotThrow(() => assertSignalGovernedPolicyViewContractV1(
    "triggers-barriers", "strategic", strategic
  ));
  assert.throws(() => assertSignalGovernedPolicyViewContractV1(
    "triggers-barriers", "strategic", { ...strategic, allowed_scopes: [...strategic.allowed_scopes, "reference"] }
  ), /exact attributable/iu);
});

const workspaceId = "68000000-0000-4000-8000-000000000001";
const brandId = "68000000-0000-4000-8000-000000000002";
const bundleId = "68000000-0000-4000-8000-000000000003";
const rootId = "68000000-0000-4000-8000-000000000004";
const aliasId = "68000000-0000-4000-8000-000000000005";
const qualityPolicyId = "68000000-0000-4000-8000-000000000006";
const competitorId = "68000000-0000-4000-8000-000000000007";
const categoryId = "68000000-0000-4000-8000-000000000008";
const referenceId = "68000000-0000-4000-8000-000000000009";

function brandDefinition() {
  return validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspaceId,
    policy_key: "operational-brand-governed",
    policy_version: 1,
    authorized_modules: ["topics-narratives", "mentions", "brand-monitoring"],
    allowed_scopes: ["primary_brand", "primary_brand"],
    allowed_entities: [
      { scope: "primary_brand", entity_type: "brand", entity_id: brandId },
      { scope: "primary_brand", entity_type: "brand", entity_id: brandId }
    ],
    acceptance_status: "included",
    quality_contract_status: "resolved",
    quality_policy_key: "signal-default-quality",
    quality_policy_version: 1,
    min_quality_score: 5,
    required_quality_flags: [],
    forbidden_quality_flags: ["spam"],
    eligibility_policy: "semantic-approved-eligible",
    deduplication_policy: "canonical-root",
    visibility_class: "client-safe",
    denominator_key: "eligible-canonical-roots",
    period_start: null,
    period_end: null,
    timezone: null,
    retention_policy_ref: "workspace-default-retention",
    licensing_policy_ref: "listening-default-license",
    data_governance_contract_status: "resolved",
    quality_policy_id: qualityPolicyId,
    required_usage_purposes: ["client-text-or-excerpt", "client-derived-metrics", "client-mention-list"]
  });
}

function clientViewDefinition(
  view: "competition" | "category" | "all-governed"
) {
  const entities = view === "competition"
    ? [{ scope: "competitor", entity_type: "competitor", entity_id: competitorId }]
    : view === "category"
      ? [{ scope: "category", entity_type: "category", entity_id: categoryId }]
      : [
          { scope: "primary_brand", entity_type: "brand", entity_id: brandId },
          { scope: "competitor", entity_type: "competitor", entity_id: competitorId },
          { scope: "category", entity_type: "category", entity_id: categoryId },
          { scope: "reference", entity_type: "reference", entity_id: referenceId }
        ];
  return validateSignalPopulationPolicyBundleDefinitionV1({
    ...brandDefinition(),
    policy_key: `operational-${view}-governed`,
    allowed_scopes: entities.map((entity) => entity.scope),
    allowed_entities: entities
  });
}

test("governed view enums are closed and module/view compatibility is explicit", () => {
  assert.equal(normalizeSignalGovernedViewModuleKeyV1("mentions"), "mentions");
  assert.equal(normalizeSignalGovernedViewKeyV1("brand"), "brand");
  assert.throws(() => normalizeSignalGovernedViewModuleKeyV1("custom-module"));
  assert.throws(() => normalizeSignalGovernedViewKeyV1("market-context"));
  assert.equal(normalizeSignalClientGovernedViewKeyV1("competition"), "competition");
  assert.throws(() => normalizeSignalClientGovernedViewKeyV1("strategic"));
  assert.throws(() => normalizeSignalClientGovernedViewKeyV1("admin-reservoir"));
  assert.doesNotThrow(() => assertSignalGovernedViewCompatibilityV1("mentions", "all-governed"));
  assert.throws(() => assertSignalGovernedViewCompatibilityV1("brand-monitoring", "admin-reservoir"));
  assert.doesNotThrow(() => assertSignalGovernedPolicyViewContractV1("mentions", "brand", brandDefinition()));
  assert.throws(() => assertSignalGovernedPolicyViewContractV1("mentions", "competition", brandDefinition()));
});

test("client module/view contracts publish exact scopes, capabilities, coverage and stable hashes", () => {
  const competition = signalGovernedModuleViewContractV1("mentions", "competition");
  assert.deepEqual(competition.allowed_scopes, ["competitor"]);
  assert.deepEqual(competition.allowed_entity_types, ["competitor"]);
  assert.deepEqual(competition.required_usage_purposes, ["client-mention-list", "client-text-or-excerpt"]);
  assert.deepEqual(competition.denominator, {
    key: "eligible-canonical-roots",
    unit: "canonical-root",
    deduplication_policy: "canonical-root"
  });
  assert.deepEqual(competition.coverage_dimensions, [
    "captured",
    "quality_eligible",
    "unreviewed",
    "reviewed",
    "resolved_attributed",
    "abstained",
    "unattributed",
    "used_by_view"
  ]);
  assert.equal(competition.semantic_gate.unknown_behavior, "exclude");

  const allGoverned = signalGovernedModuleViewContractV1("mentions", "all-governed");
  assert.equal(allGoverned.scope_mode, "governed-union");
  assert.deepEqual(allGoverned.allowed_scopes, ["primary_brand", "competitor", "category", "reference"]);
  const firstHash = signalGovernedModuleViewContractHashV1("mentions", "competition");
  assert.equal(firstHash, signalGovernedModuleViewContractHashV1("mentions", "competition"));
  assert.notEqual(firstHash, signalGovernedModuleViewContractHashV1("mentions", "category"));
  assert.notEqual(firstHash, signalGovernedModuleViewContractHashV1("brand-monitoring", "competition"));
  assert.throws(() => signalGovernedModuleViewContractV1("triggers-barriers", "competition"));
});

test("client view policies enforce exact governed scope/entity and capability contracts", () => {
  for (const view of ["competition", "category", "all-governed"] as const) {
    assert.doesNotThrow(() => assertSignalGovernedPolicyViewContractV1("mentions", view, clientViewDefinition(view)));
  }
  assert.throws(() => assertSignalGovernedPolicyViewContractV1(
    "mentions",
    "competition",
    clientViewDefinition("category")
  ), /exact competitor/iu);
  assert.throws(() => assertSignalGovernedPolicyViewContractV1(
    "mentions",
    "all-governed",
    validateSignalPopulationPolicyBundleDefinitionV1({
      ...clientViewDefinition("all-governed"),
      allowed_scopes: ["primary_brand"],
      allowed_entities: [
        { scope: "primary_brand", entity_type: "brand", entity_id: brandId },
        { scope: "competitor", entity_type: "competitor", entity_id: competitorId }
      ]
    })
  ), /must match exactly/iu);
  assert.throws(() => assertSignalGovernedPolicyViewContractV1(
    "mentions",
    "category",
    validateSignalPopulationPolicyBundleDefinitionV1({
      ...clientViewDefinition("category"),
      required_usage_purposes: ["client-derived-metrics"]
    })
  ), /capability envelope/iu);
  assert.throws(() => assertSignalGovernedPolicyViewContractV1(
    "mentions",
    "all-governed",
    validateSignalPopulationPolicyBundleDefinitionV1({
      ...clientViewDefinition("all-governed"),
      allowed_entities: clientViewDefinition("all-governed").allowed_entities.map((entity) =>
        entity.scope === "competitor"
          ? { ...entity, entity_type: "category" }
          : entity
      )
    })
  ), /type does not match its scope/iu);
  assert.throws(() => validateSignalPopulationPolicyBundleDefinitionV1({
    ...clientViewDefinition("competition"),
    allowed_entities: []
  }), /explicit governed scopes and entities|no governed entity allowlist/iu);
  const attributableSubset = validateSignalPopulationPolicyBundleDefinitionV1({
    ...clientViewDefinition("all-governed"),
    allowed_scopes: ["primary_brand", "competitor", "category"],
    allowed_entities: clientViewDefinition("all-governed").allowed_entities
      .filter((entity) => entity.scope !== "reference")
  });
  assert.doesNotThrow(() => assertSignalGovernedPolicyViewContractV1(
    "mentions",
    "all-governed",
    attributableSubset
  ));
});

test("Backend 06 plan hashes isolate named views while preserving the promoted brand hash", () => {
  const common = {
    base_plan_hash: `sha256:${"1".repeat(64)}`,
    module_key: "brand-monitoring" as const,
    authorized_modules: ["brand-monitoring", "mentions", "topics-narratives"] as const,
    capability_usage_purposes: [
      "client-derived-metrics",
      "client-mention-list",
      "client-text-or-excerpt"
    ] as const
  };
  const brandHash = signalGovernedViewCompilationPlanHashV1({
    ...common,
    authorized_modules: [...common.authorized_modules],
    capability_usage_purposes: [...common.capability_usage_purposes],
    view_key: "brand"
  });
  assert.equal(brandHash, "sha256:3b0f7ce4375199d3b7355e478af4180979e3635a95e1254477c6c8694a76c27b");
  const namedViewHashes = ["competition", "category", "all-governed"].map((view_key) =>
    signalGovernedViewCompilationPlanHashV1({
      ...common,
      authorized_modules: [...common.authorized_modules],
      capability_usage_purposes: [...common.capability_usage_purposes],
      view_key: view_key as "competition" | "category" | "all-governed"
    })
  );
  assert.equal(new Set(namedViewHashes).size, namedViewHashes.length);
  assert.ok(namedViewHashes.every((value) => value !== brandHash));
});

test("policy normalization and hashes are deterministic", () => {
  const first = brandDefinition();
  const second = validateSignalPopulationPolicyBundleDefinitionV1({
    ...first,
    allowed_entities: [...first.allowed_entities].reverse(),
    allowed_scopes: [...first.allowed_scopes].reverse(),
    forbidden_quality_flags: [...first.forbidden_quality_flags].reverse()
  });
  assert.deepEqual(first, second);
  assert.equal(signalPopulationPolicyDefinitionHashV1(first), signalPopulationPolicyDefinitionHashV1(second));
  assert.match(signalPopulationPolicyDefinitionHashV1(first), /^sha256:[0-9a-f]{64}$/u);
});

test("derived population hashes bind policy, plan, population contract, and normalized order", () => {
  const definition = brandDefinition();
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const plan = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: bundleId,
    definition_hash: definitionHash,
    definition
  });
  const input = {
    workspace_id: workspaceId,
    policy_bundle_id: bundleId,
    policy_definition_hash: definitionHash,
    compiled_plan_hash: plan.plan_hash,
    population_key: "primary-brand-operational",
    population_version: 2,
    acceptance_status: "included" as const,
    allowed_scopes: ["primary_brand"] as ("primary_brand")[],
    quality_contract_status: "resolved" as const,
    min_quality_score: 5,
    required_quality_flags: [] as string[],
    forbidden_quality_flags: ["spam", "duplicate", "spam"],
    period_start: null,
    period_end: null,
    timezone: "America/Mexico_City"
  };
  const first = signalDerivedPopulationDefinitionHashV1(input);
  const second = signalDerivedPopulationDefinitionHashV1({
    ...input,
    forbidden_quality_flags: [...input.forbidden_quality_flags].reverse()
  });
  assert.equal(first, second);
  assert.notEqual(first, signalDerivedPopulationDefinitionHashV1({
    ...input,
    compiled_plan_hash: `sha256:${"a".repeat(64)}`
  }));
});

test("compiled plans require current approved eligible semantics and deduplicate aliases and multi-entity roots", () => {
  const definition = brandDefinition();
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const plan = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: bundleId,
    definition_hash: definitionHash,
    definition
  });
  assert.deepEqual(plan.predicate.semantic_assertion && {
    basis: plan.predicate.semantic_assertion.attribution_basis,
    current: plan.predicate.semantic_assertion.is_current,
    review: plan.predicate.semantic_assertion.review_status,
    eligibility: plan.predicate.semantic_assertion.eligibility_status
  }, {
    basis: "mention_semantic",
    current: true,
    review: "approved",
    eligibility: "eligible"
  });

  const approvedPrimary = {
    attribution_basis: "mention_semantic" as const,
    is_current: true,
    review_status: "approved" as const,
    eligibility_status: "eligible" as const,
    scope: "primary_brand" as const,
    entity_type: "brand" as const,
    entity_id: brandId
  };
  const roots = resolveSignalPolicyMembershipCandidatesV1(plan, [
    {
      mention_id: rootId,
      canonical_mention_id: rootId,
      inclusion_status: "included",
      quality_score: 9,
      quality_flags: [],
      published_at: "2026-08-01T00:00:00Z",
      governance_eligibility: "authorized",
      assertions: [approvedPrimary, {
        ...approvedPrimary,
        scope: "competitor",
        entity_type: "competitor",
        entity_id: "68000000-0000-4000-8000-000000000006"
      }]
    },
    {
      mention_id: aliasId,
      canonical_mention_id: rootId,
      inclusion_status: "included",
      quality_score: 9,
      quality_flags: [],
      published_at: "2026-08-01T00:00:00Z",
      governance_eligibility: "authorized",
      assertions: [approvedPrimary]
    },
    {
      mention_id: "68000000-0000-4000-8000-000000000007",
      canonical_mention_id: "68000000-0000-4000-8000-000000000007",
      inclusion_status: "included",
      quality_score: 9,
      quality_flags: [],
      published_at: "2026-08-01T00:00:00Z",
      governance_eligibility: "authorized",
      assertions: [{ ...approvedPrimary, review_status: "pending", eligibility_status: "candidate" }]
    }
  ]);
  assert.deepEqual(roots, [rootId]);
  assert.match(plan.plan_hash, /^sha256:[0-9a-f]{64}$/u);
});

test("all-governed deduplicates attributable roots and excludes pending, rejected, unattributed and unknown", () => {
  const definition = clientViewDefinition("all-governed");
  assertSignalGovernedPolicyViewContractV1("mentions", "all-governed", definition);
  const plan = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: bundleId,
    definition_hash: signalPopulationPolicyDefinitionHashV1(definition),
    definition
  });
  const semantic = (
    scope: "primary_brand" | "competitor" | "category" | "reference" | "unattributed",
    entity_type: "brand" | "competitor" | "category" | "reference" | "unattributed",
    entity_id: string | null,
    review_status: "pending" | "approved" | "rejected" = "approved",
    eligibility_status: "not_eligible" | "candidate" | "eligible" = "eligible"
  ) => ({
    attribution_basis: "mention_semantic" as const,
    is_current: true,
    review_status,
    eligibility_status,
    scope,
    entity_type,
    entity_id
  });
  const candidate = (
    mention_id: string,
    canonical_mention_id: string,
    governance_eligibility: "authorized" | "blocked" | "not_available",
    assertions: ReturnType<typeof semantic>[]
  ) => ({
    mention_id,
    canonical_mention_id,
    inclusion_status: "included" as const,
    quality_score: 9,
    quality_flags: [] as string[],
    published_at: "2026-08-01T00:00:00Z",
    governance_eligibility,
    assertions
  });
  const secondRoot = "68000000-0000-4000-8000-000000000020";
  const roots = resolveSignalPolicyMembershipCandidatesV1(plan, [
    candidate(rootId, rootId, "authorized", [
      semantic("primary_brand", "brand", brandId),
      semantic("competitor", "competitor", competitorId)
    ]),
    candidate(aliasId, rootId, "authorized", [semantic("category", "category", categoryId)]),
    candidate(secondRoot, secondRoot, "authorized", [semantic("reference", "reference", referenceId)]),
    candidate("68000000-0000-4000-8000-000000000021", "68000000-0000-4000-8000-000000000021", "authorized", [
      semantic("primary_brand", "brand", brandId, "pending", "candidate")
    ]),
    candidate("68000000-0000-4000-8000-000000000022", "68000000-0000-4000-8000-000000000022", "authorized", [
      semantic("competitor", "competitor", competitorId, "rejected", "not_eligible")
    ]),
    candidate("68000000-0000-4000-8000-000000000023", "68000000-0000-4000-8000-000000000023", "authorized", [
      semantic("unattributed", "unattributed", null, "approved", "not_eligible")
    ]),
    candidate("68000000-0000-4000-8000-000000000024", "68000000-0000-4000-8000-000000000024", "not_available", [
      semantic("primary_brand", "brand", brandId)
    ]),
    candidate("68000000-0000-4000-8000-000000000025", "68000000-0000-4000-8000-000000000025", "blocked", [
      semantic("category", "category", categoryId)
    ]),
    {
      ...candidate("68000000-0000-4000-8000-000000000026", "68000000-0000-4000-8000-000000000026", "authorized", []),
      assertions: [{
        ...semantic("primary_brand", "brand", brandId),
        attribution_basis: "source_intent" as const
      }]
    },
    {
      ...candidate("68000000-0000-4000-8000-000000000027", "68000000-0000-4000-8000-000000000027", "authorized", [
        semantic("competitor", "competitor", "68000000-0000-4000-8000-000000000099")
      ])
    },
    {
      ...candidate("68000000-0000-4000-8000-000000000028", "68000000-0000-4000-8000-000000000028", "authorized", [
        semantic("category", "category", categoryId)
      ]),
      inclusion_status: "excluded" as const
    },
    {
      ...candidate("68000000-0000-4000-8000-000000000029", "68000000-0000-4000-8000-000000000029", "authorized", []),
      assertions: [{
        ...semantic("reference", "reference", referenceId),
        is_current: false
      }]
    }
  ]);
  assert.deepEqual(roots, [rootId, secondRoot].sort());
});

test("client-safe policies and coverage fail closed", () => {
  assert.throws(() => validateSignalPopulationPolicyBundleDefinitionV1({
    ...brandDefinition(),
    allowed_scopes: ["primary_brand", "unattributed"]
  }));
  assert.throws(() => compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: bundleId,
    definition_hash: `sha256:${"0".repeat(64)}`,
    definition: brandDefinition()
  }));
  assert.deepEqual(validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: { availability: "available", count: 10 },
    quality_eligible: { availability: "available", count: 9 },
    unreviewed: { availability: "available", count: 2 },
    reviewed: { availability: "available", count: 8 },
    resolved_attributed: { availability: "available", count: 7 },
    abstained: { availability: "not_available", count: null },
    unattributed: { availability: "available", count: 1 },
    used_by_view: { availability: "available", count: 6 }
  }).used_by_view, { availability: "available", count: 6 });
  assert.deepEqual(validateSignalCoverageDescriptorV1({
    state: "not_available",
    captured: { availability: "available", count: 10 },
    quality_eligible: { availability: "not_available", count: null },
    unreviewed: { availability: "not_available", count: null },
    reviewed: { availability: "not_available", count: null },
    resolved_attributed: { availability: "not_available", count: null },
    abstained: { availability: "not_available", count: null },
    unattributed: { availability: "not_available", count: null },
    used_by_view: { availability: "not_available", count: null }
  }).abstained, { availability: "not_available", count: null });
  assert.throws(() => validateSignalCoverageDescriptorV1({
    state: "complete",
    captured: { availability: "available", count: 10 },
    quality_eligible: { availability: "available", count: 10 },
    unreviewed: { availability: "available", count: 2 },
    reviewed: { availability: "available", count: 8 },
    resolved_attributed: { availability: "available", count: 7 },
    abstained: { availability: "available", count: 0 },
    unattributed: { availability: "available", count: 0 },
    used_by_view: { availability: "available", count: 11 }
  }));
  assert.throws(() => validateSignalCoverageDescriptorV1({
    state: "complete",
    captured: { availability: "available", count: 0 },
    quality_eligible: { availability: "available", count: 0 },
    unreviewed: { availability: "available", count: 0 },
    reviewed: { availability: "available", count: 0 },
    resolved_attributed: { availability: "available", count: 0 },
    abstained: { availability: "not_available", count: null },
    unattributed: { availability: "available", count: 0 },
    used_by_view: { availability: "available", count: 0 }
  }));
  assert.throws(() => validateSignalPopulationPolicyBundleDefinitionV1({
    ...brandDefinition(),
    quality_contract_status: "not_available",
    quality_policy_key: "signal-default-quality",
    quality_policy_version: 1,
    data_governance_contract_status: "not_available",
    quality_policy_id: null,
    required_usage_purposes: []
  }));
});

const servingIds = {
  binding: "68000000-0000-4000-8000-000000000010",
  population: "68000000-0000-4000-8000-000000000011",
  compilation: "68000000-0000-4000-8000-000000000012"
};
const servingHashes = {
  policy: `sha256:${"1".repeat(64)}`,
  population: `sha256:${"2".repeat(64)}`,
  membership: `sha256:${"3".repeat(64)}`,
  plan: `sha256:${"4".repeat(64)}`,
  data: `sha256:${"5".repeat(64)}`,
  source: `sha256:${"6".repeat(64)}`,
  governance: `sha256:${"7".repeat(64)}`,
  filters: `sha256:${"8".repeat(64)}`,
  sort: `sha256:${"9".repeat(64)}`
};

function governedServingScope(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "signal-serving-scope-v1",
    workspace_id: workspaceId,
    module_key: "mentions",
    view_key: "brand",
    rollout_mode: "governed",
    resolution_source: "governed-binding",
    visible_source: "governed-binding",
    binding: {
      workspace_id: workspaceId,
      binding_id: servingIds.binding,
      binding_version: 2,
      module_key: "mentions",
      view_key: "brand"
    },
    policy: {
      workspace_id: workspaceId,
      policy_bundle_id: bundleId,
      policy_key: "operational-brand-governed",
      policy_version: 1,
      definition_hash: servingHashes.policy
    },
    population: {
      population_id: servingIds.population,
      population_key: "mentions-brand-governed",
      population_version: 1,
      definition_hash: servingHashes.population,
      membership_digest: servingHashes.membership,
      policy_compilation_id: servingIds.compilation,
      compiled_plan_hash: servingHashes.plan,
      compilation_status: "ready"
    },
    compilation: {
      policy_compilation_id: servingIds.compilation,
      compiled_plan_hash: servingHashes.plan,
      compilation_status: "ready"
    },
    visibility_class: "client-safe",
    usage_purposes: ["client-text-or-excerpt", "client-mention-list"],
    watermark: {
      availability: "available",
      data_watermark_hash: servingHashes.data,
      source_watermark_hash: servingHashes.source,
      governance_digest: servingHashes.governance,
      captured_at: "2026-08-12T12:00:00Z",
      next_policy_transition_at: "2026-09-01T00:00:00Z"
    },
    freshness: {
      state: "fresh",
      invalidation_state: "valid",
      invalidated_at: null
    },
    coverage: {
      state: "partial",
      captured: { availability: "available", count: 12 },
      quality_eligible: { availability: "available", count: 10 },
      unreviewed: { availability: "available", count: 2 },
      reviewed: { availability: "available", count: 10 },
      resolved_attributed: { availability: "available", count: 9 },
      abstained: { availability: "not_available", count: null },
      unattributed: { availability: "available", count: 1 },
      used_by_view: { availability: "available", count: 8 }
    },
    denominator: {
      key: "eligible-canonical-roots",
      unit: "canonical-root",
      count: 8,
      deduplication_policy: "canonical-root"
    },
    period: {
      start: "2026-07-01",
      end: "2026-07-31",
      timezone: "America/Mexico_City"
    },
    ...overrides
  };
}

function governedServingScopeForView(
  viewKey: "brand" | "competition" | "category" | "all-governed"
) {
  const base = governedServingScope();
  return {
    ...base,
    view_key: viewKey,
    binding: { ...(base.binding as object), view_key: viewKey },
    policy: {
      ...(base.policy as object),
      policy_key: `operational-${viewKey}-governed`
    },
    population: {
      ...(base.population as object),
      population_key: `mentions-${viewKey}-governed`
    }
  };
}

test("serving scope contract validates governed authority, literal coverage and exact capabilities", () => {
  const normalized = validateSignalServingScopeDescriptorV1(governedServingScope());
  assert.equal(normalized.denominator.count, 8);
  assert.deepEqual(normalized.coverage.abstained, { availability: "not_available", count: null });
  assert.deepEqual(normalized.usage_purposes, ["client-mention-list", "client-text-or-excerpt"]);
  assert.deepEqual(signalServingUsagePurposesForModuleViewV1("brand-monitoring", "brand"), ["client-derived-metrics"]);
  assert.deepEqual(signalServingUsagePurposesForModuleViewV1("mentions", "competition"), ["client-mention-list", "client-text-or-excerpt"]);
  assert.deepEqual(signalServingUsagePurposesForModuleViewV1("triggers-barriers", "strategic"), [
    "llm-processing",
    "strategic-analysis"
  ]);
  assert.deepEqual(signalServingUsagePurposesForModuleViewV1("admin-mentions", "admin-reservoir"), ["internal-qa"]);

  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    usage_purposes: ["client-derived-metrics"]
  })), /closed mentions\/brand/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    coverage: {
      ...governedServingScope().coverage as object,
      abstained: { availability: "available", count: 0 }
    }
  })), /coverage\.state/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    denominator: {
      ...governedServingScope().denominator as object,
      count: 7
    }
  })), /denominator\.count/iu);
});

test("rollout visible source is fail-closed and shadow retains governed resolution identity", () => {
  const shadow = validateSignalServingScopeDescriptorV1(governedServingScope({
    rollout_mode: "shadow",
    visible_source: "legacy"
  }));
  assert.equal(shadow.resolution_source, "governed-binding");
  assert.equal(shadow.visible_source, "legacy");
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    rollout_mode: "shadow",
    visible_source: "governed-binding"
  })), /must expose legacy/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    rollout_mode: "governed",
    visible_source: "legacy"
  })), /must expose governed-binding/iu);
});

test("operational bridge is explicit and cannot imply governed binding authority", () => {
  const bridge = validateSignalServingScopeDescriptorV1(governedServingScope({
    resolution_source: "operational-brand-bridge",
    visible_source: "operational-brand-bridge",
    binding: null,
    policy: {
      workspace_id: workspaceId,
      policy_bundle_id: null,
      policy_key: "primary-brand-semantic",
      policy_version: 1,
      definition_hash: servingHashes.policy
    },
    population: {
      population_id: servingIds.population,
      population_key: "primary-brand-operational",
      population_version: 1,
      definition_hash: servingHashes.population,
      membership_digest: servingHashes.membership,
      policy_compilation_id: null,
      compiled_plan_hash: null,
      compilation_status: null
    },
    compilation: null
  }));
  assert.equal(bridge.resolution_source, "operational-brand-bridge");
  assert.equal(bridge.binding, null);
  assert.throws(() => validateSignalServingScopeDescriptorV1({
    ...bridge,
    binding: governedServingScope().binding
  }), /cannot imply/iu);
});

test("serving identity and ETag/cursor isolation bind scope, filters and sort deterministically", () => {
  const first = governedServingScope();
  const reordered = governedServingScope({
    usage_purposes: ["client-mention-list", "client-text-or-excerpt"]
  });
  assert.equal(signalServingScopeIdentityHashV1(first), signalServingScopeIdentityHashV1(reordered));
  const etag = signalServingScopeEtagSeedV1({
    scope: first,
    normalized_filters_hash: servingHashes.filters,
    normalized_sort_hash: servingHashes.sort
  });
  const cursor = signalServingScopeCursorIsolationHashV1({
    scope: first,
    normalized_filters_hash: servingHashes.filters,
    normalized_sort_hash: servingHashes.sort
  });
  assert.match(etag, /^sha256:[0-9a-f]{64}$/u);
  assert.match(cursor, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(etag, cursor);
  assert.notEqual(etag, signalServingScopeEtagSeedV1({
    scope: first,
    normalized_filters_hash: `sha256:${"a".repeat(64)}`,
    normalized_sort_hash: servingHashes.sort
  }));
  assert.notEqual(cursor, signalServingScopeCursorIsolationHashV1({
    scope: first,
    normalized_filters_hash: servingHashes.filters,
    normalized_sort_hash: `sha256:${"b".repeat(64)}`
  }));
  assert.notEqual(etag, signalServingScopeEtagSeedV1({
    scope: governedServingScope({
      population: {
        ...(governedServingScope().population as object),
        membership_digest: `sha256:${"c".repeat(64)}`
      }
    }),
    normalized_filters_hash: servingHashes.filters,
    normalized_sort_hash: servingHashes.sort
  }));
});

test("serving identities, ETags and cursors are isolated across every client view", () => {
  const tokens = ["brand", "competition", "category", "all-governed"].map((view) => {
    const scope = governedServingScopeForView(view as "brand" | "competition" | "category" | "all-governed");
    const normalized = validateSignalServingScopeDescriptorV1(scope);
    return {
      view,
      identity: signalServingScopeIdentityHashV1(normalized),
      etag: signalServingScopeEtagSeedV1({
        scope: normalized,
        normalized_filters_hash: servingHashes.filters,
        normalized_sort_hash: servingHashes.sort
      }),
      cursor: signalServingScopeCursorIsolationHashV1({
        scope: normalized,
        normalized_filters_hash: servingHashes.filters,
        normalized_sort_hash: servingHashes.sort
      })
    };
  });
  assert.equal(new Set(tokens.map((entry) => entry.identity)).size, tokens.length);
  assert.equal(new Set(tokens.map((entry) => entry.etag)).size, tokens.length);
  assert.equal(new Set(tokens.map((entry) => entry.cursor)).size, tokens.length);
  for (const token of tokens) assert.notEqual(token.etag, token.cursor);
});

test("client serving rejects bridge leakage, non-client visibility and incompatible denominators", () => {
  const competition = governedServingScopeForView("competition");
  assert.throws(() => validateSignalServingScopeDescriptorV1({
    ...competition,
    resolution_source: "operational-brand-bridge",
    visible_source: "operational-brand-bridge",
    binding: null,
    policy: {
      ...(competition.policy as object),
      policy_bundle_id: null
    },
    compilation: null,
    population: {
      ...(competition.population as object),
      policy_compilation_id: null,
      compiled_plan_hash: null,
      compilation_status: null
    }
  }), /only valid for the brand view/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1({
    ...competition,
    visibility_class: "operator-only"
  }), /client-safe serving contract/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1({
    ...competition,
    denominator: {
      ...(competition.denominator as object),
      key: "workspace-canonical-roots"
    }
  }), /eligible canonical-root denominator/iu);
});

test("watermark, invalidation and cross-workspace identities fail closed", () => {
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    watermark: {
      availability: "not_available",
      data_watermark_hash: null,
      source_watermark_hash: null,
      governance_digest: null,
      captured_at: null,
      next_policy_transition_at: null
    },
    freshness: { state: "not_available", invalidation_state: "not_available", invalidated_at: null }
  })), /durable watermark/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    freshness: { state: "fresh", invalidation_state: "invalidated", invalidated_at: "2026-08-12T12:00:00Z" }
  })), /must report stale/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    binding: {
      ...(governedServingScope().binding as object),
      workspace_id: "68000000-0000-4000-8000-000000000099"
    }
  })), /outside the serving workspace/iu);
  assert.throws(() => validateSignalServingScopeDescriptorV1(governedServingScope({
    watermark: {
      ...(governedServingScope().watermark as object),
      next_policy_transition_at: "2026-08-01T00:00:00Z"
    }
  })), /must be after/iu);
});
