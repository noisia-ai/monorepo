import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  compileSignalPopulationPolicyBundleV1,
  signalGovernedViewCompilationPlanHashV1,
  signalPopulationPolicyDefinitionHashV1,
  validateSignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

import {
  resolveSignalGovernedViewV1,
  type SignalGovernedViewBindingStoreRow,
  type SignalGovernedViewResolverStore
} from "./signal-governed-view-resolver";
import { runSignalGovernedViewBindingShadowV1 } from "./signal-governed-view-shadow";
import type { ResolvedSignalWorkspace } from "./signal-workspace";

const workspaceId = "68000000-0000-4000-8000-000000000001";
const brandId = "68000000-0000-4000-8000-000000000002";
const policyBundleId = "68000000-0000-4000-8000-000000000003";
const bindingId = "68000000-0000-4000-8000-000000000004";
const populationId = "68000000-0000-4000-8000-000000000005";

const workspace: ResolvedSignalWorkspace = {
  contractVersion: "signal-backend-v1",
  id: workspaceId,
  organizationId: "68000000-0000-4000-8000-000000000006",
  slug: "governed-fixture",
  name: "Governed fixture",
  subject: { type: "brand", id: brandId },
  timezone: "UTC",
  status: "active",
  corpora: []
};

function definition() {
  return validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspaceId,
    policy_key: "operational-brand-governed",
    policy_version: 1,
    authorized_modules: ["mentions"],
    allowed_scopes: ["primary_brand"],
    allowed_entities: [{ scope: "primary_brand", entity_type: "brand", entity_id: brandId }],
    acceptance_status: "included",
    quality_contract_status: "resolved",
    quality_policy_key: "signal-default-quality",
    quality_policy_version: 1,
    min_quality_score: 4,
    required_quality_flags: ["brand-safe"],
    forbidden_quality_flags: ["spam"],
    eligibility_policy: "semantic-approved-eligible",
    deduplication_policy: "canonical-root",
    visibility_class: "client-safe",
    denominator_key: "eligible-canonical-roots",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    timezone: "America/Mexico_City",
    retention_policy_ref: "workspace-default-retention",
    licensing_policy_ref: "listening-default-license",
    data_governance_contract_status: "resolved",
    quality_policy_id: "68000000-0000-4000-8000-000000000008",
    required_usage_purposes: [
      "client-derived-metrics",
      "client-mention-list",
      "client-text-or-excerpt"
    ]
  });
}

function bindingRow(overrides: Partial<SignalGovernedViewBindingStoreRow> = {}): SignalGovernedViewBindingStoreRow {
  const policy = definition();
  const policyDefinitionHash = signalPopulationPolicyDefinitionHashV1(policy);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: policyBundleId,
    definition_hash: policyDefinitionHash,
    definition: policy
  });
  const compiledPlanHash = signalGovernedViewCompilationPlanHashV1({
    base_plan_hash: compiled.plan_hash,
    module_key: "mentions",
    view_key: "brand",
    authorized_modules: policy.authorized_modules,
    capability_usage_purposes: policy.required_usage_purposes
  });
  return {
    workspace_id: workspaceId,
    evaluation_now: "2026-08-12T12:00:00.000Z",
    binding_id: bindingId,
    binding_version: 1,
    module_key: "mentions",
    view_key: "brand",
    binding_status: "current",
    binding_effective_from: "2026-08-01T00:00:00.000Z",
    binding_effective_to: null,
    policy_bundle_id: policyBundleId,
    policy_workspace_id: workspaceId,
    policy_key: policy.policy_key,
    policy_version: policy.policy_version,
    policy_status: "active",
    policy_effective_from: "2026-08-01T00:00:00.000Z",
    policy_effective_to: null,
    policy_definition_hash: policyDefinitionHash,
    bundle_definition_hash: policyDefinitionHash,
    authorized_modules: policy.authorized_modules,
    allowed_scopes: policy.allowed_scopes,
    allowed_entities: policy.allowed_entities,
    acceptance_status: policy.acceptance_status,
    quality_contract_status: policy.quality_contract_status,
    quality_policy_key: policy.quality_policy_key,
    quality_policy_version: policy.quality_policy_version,
    min_quality_score: policy.min_quality_score,
    required_quality_flags: policy.required_quality_flags,
    forbidden_quality_flags: policy.forbidden_quality_flags,
    eligibility_policy: policy.eligibility_policy,
    deduplication_policy: policy.deduplication_policy,
    visibility_class: policy.visibility_class,
    denominator_key: policy.denominator_key,
    period_start: policy.period_start,
    period_end: policy.period_end,
    timezone: policy.timezone,
    retention_policy_ref: policy.retention_policy_ref,
    licensing_policy_ref: policy.licensing_policy_ref,
    data_governance_contract_status: policy.data_governance_contract_status,
    quality_policy_id: policy.quality_policy_id,
    required_usage_purposes: policy.required_usage_purposes,
    population_id: populationId,
    population_workspace_id: workspaceId,
    population_status: "draft",
    population_key: "primary-brand-operational",
    population_version: 2,
    population_definition_hash: `sha256:${"b".repeat(64)}`,
    membership_digest: `sha256:${"c".repeat(64)}`,
    policy_compilation_id: "68000000-0000-4000-8000-000000000007",
    compilation_workspace_id: workspaceId,
    compilation_policy_bundle_id: policyBundleId,
    compilation_population_id: populationId,
    compilation_population_version: 2,
    compiled_plan_hash: compiledPlanHash,
    compilation_status: "ready",
    compilation_is_current: true,
    compilation_policy_definition_hash: policyDefinitionHash,
    compilation_population_definition_hash: `sha256:${"b".repeat(64)}`,
    compilation_membership_digest: `sha256:${"c".repeat(64)}`,
    compilation_invalidated: false,
    compilation_module_key: "mentions",
    compilation_view_key: "brand",
    compilation_next_policy_transition_at: null,
    compilation_temporally_valid: true,
    governance_data_watermark_id: "68000000-0000-4000-8000-000000000009",
    governance_data_watermark_workspace_id: workspaceId,
    governance_data_watermark_population_id: populationId,
    population_derivation_valid: true,
    live_entity_authority_valid: true,
    ...overrides
  };
}

function store(args: {
  binding?: SignalGovernedViewBindingStoreRow | null;
  bridge?: boolean;
} = {}): SignalGovernedViewResolverStore {
  return {
    async loadCurrentBinding() {
      return args.binding === undefined ? bindingRow() : args.binding;
    },
    async loadOperationalBrandBridge() {
      return args.bridge ? {
        workspace_id: workspaceId,
        population_id: populationId,
        population_key: "primary-brand-operational",
        population_version: 1,
        population_definition_hash: `sha256:${"d".repeat(64)}`,
        membership_digest: `sha256:${"e".repeat(64)}`,
        acceptance_status: "included",
        allowed_scopes: ["primary_brand"],
        min_quality_score: null,
        period_start: null,
        period_end: null
      } : null;
    }
  };
}

test("resolver returns a compact authorized binding and never accepts a population id", async () => {
  const untrustedInput = {
    module_key: "mentions",
    view_key: "brand",
    population_id: "ignored"
  };
  const descriptor = await resolveSignalGovernedViewV1(
    workspace,
    untrustedInput,
    store()
  );
  assert.equal(descriptor.resolution_source, "governed-binding");
  assert.equal(descriptor.population?.population_id, populationId);
  assert.equal(descriptor.binding?.binding_id, bindingId);
  assert.equal("mentions" in descriptor, false);
  assert.equal(descriptor.read_contract.authority_source, "compiled-policy");
  if (descriptor.read_contract.authority_source === "compiled-policy") {
    assert.equal(descriptor.read_contract.predicate.acceptance_status, "included");
    assert.deepEqual(
      descriptor.read_contract.predicate.semantic_assertion?.allowed_scopes,
      ["primary_brand"]
    );
    assert.deepEqual(descriptor.read_contract.predicate.quality, {
      contract_status: "resolved",
      policy_key: "signal-default-quality",
      policy_version: 1,
      min_score: 4,
      required_flags: ["brand-safe"],
      forbidden_flags: ["spam"],
      policy_id: "68000000-0000-4000-8000-000000000008"
    });
    assert.deepEqual(descriptor.read_contract.predicate.period, {
      start: "2026-08-01",
      end: "2026-08-31",
      timezone: "America/Mexico_City"
    });
    assert.deepEqual(
      descriptor.read_contract.predicate.data_governance.required_usage_purposes,
      ["client-mention-list", "client-text-or-excerpt"]
    );
  }
});

test("brand bridge is explicit and does not manufacture a policy bundle", async () => {
  const descriptor = await resolveSignalGovernedViewV1(
    workspace,
    { module_key: "mentions", view_key: "brand" },
    store({ binding: null, bridge: true })
  );
  assert.equal(descriptor.resolution_source, "operational-brand-bridge");
  assert.equal(descriptor.binding, null);
  assert.equal(descriptor.policy.policy_bundle_id, null);
  assert.deepEqual(descriptor.read_contract, {
    authority_source: "operational-population",
    acceptance_status: "included",
    allowed_scopes: ["primary_brand"],
    min_quality_score: null,
    period_start: null,
    period_end: null
  });
});

test("missing bindings may bridge while every invalid current binding fails closed", async () => {
  await assert.rejects(
    resolveSignalGovernedViewV1(
      workspace,
      { module_key: "triggers-barriers", view_key: "strategic" },
      store({ binding: null })
    ),
    /unavailable/iu
  );
  await assert.rejects(
    resolveSignalGovernedViewV1(
      workspace,
      { module_key: "mentions", view_key: "brand" },
      store({ binding: bindingRow({ policy_status: "retired" }) })
    ),
    /unavailable/iu
  );
  const invalidRows: Array<[string, Partial<SignalGovernedViewBindingStoreRow>]> = [
    ["future binding", { binding_effective_from: "2026-08-13T00:00:00.000Z" }],
    ["expired binding", { binding_effective_to: "2026-08-11T00:00:00.000Z" }],
    ["cross-workspace policy", { policy_workspace_id: "68000000-0000-4000-8000-000000000099" }],
    ["inactive policy", { policy_status: "draft" }],
    ["future policy", { policy_effective_from: "2026-08-13T00:00:00.000Z" }],
    ["expired policy", { policy_effective_to: "2026-08-11T00:00:00.000Z" }],
    ["policy hash mismatch", { bundle_definition_hash: `sha256:${"f".repeat(64)}` }],
    ["missing population", { population_id: null }],
    ["retired population", { population_status: "retired" }],
    ["cross-workspace compilation", { compilation_workspace_id: "68000000-0000-4000-8000-000000000099" }],
    ["wrong compilation policy", { compilation_policy_bundle_id: "68000000-0000-4000-8000-000000000099" }],
    ["wrong compilation population", { compilation_population_id: "68000000-0000-4000-8000-000000000099" }],
    ["wrong compilation population version", { compilation_population_version: 99 }],
    ["stale compilation", { compilation_status: "stale" }],
    ["blocked compilation", { compilation_status: "blocked" }],
    ["retired compilation", { compilation_is_current: false }],
    ["invalidated compilation", { compilation_invalidated: true }],
    ["expired compilation", { compilation_temporally_valid: false }],
    ["wrong compilation digest", { compilation_membership_digest: `sha256:${"f".repeat(64)}` }],
    ["invalid derivation", { population_derivation_valid: false }],
    ["retired or cross-workspace governed entity", { live_entity_authority_valid: false }],
    ["missing watermark", { governance_data_watermark_id: null }],
    ["cross-workspace watermark", { governance_data_watermark_workspace_id: "68000000-0000-4000-8000-000000000099" }],
    ["wrong-population watermark", { governance_data_watermark_population_id: "68000000-0000-4000-8000-000000000099" }]
  ];
  for (const [label, override] of invalidRows) {
    await assert.rejects(
      resolveSignalGovernedViewV1(
        workspace,
        { module_key: "mentions", view_key: "brand" },
        store({ binding: bindingRow(override), bridge: true })
      ),
      /unavailable/iu,
      `${label} must never disappear into the operational bridge`
    );
  }
  await assert.rejects(
    resolveSignalGovernedViewV1(
      workspace,
      { module_key: "mentions", view_key: "brand" },
      store({ binding: bindingRow({ population_workspace_id: "68000000-0000-4000-8000-000000000099" }) })
    ),
    /unavailable/iu
  );
  await assert.rejects(
    resolveSignalGovernedViewV1(
      workspace,
      { module_key: "mentions", view_key: "brand" },
      store({ binding: bindingRow({ compilation_temporally_valid: false }) })
    ),
    /unavailable/iu
  );
  await assert.rejects(
    resolveSignalGovernedViewV1(
      workspace,
      { module_key: "mentions", view_key: "brand" },
      store({ binding: bindingRow({ governance_data_watermark_id: null }) })
    ),
    /unavailable/iu
  );
});

test("unknown and incompatible module/view identities fail before store resolution", async () => {
  let calls = 0;
  const guardedStore: SignalGovernedViewResolverStore = {
    async loadCurrentBinding() { calls += 1; return null; },
    async loadOperationalBrandBridge() { calls += 1; return null; }
  };
  await assert.rejects(
    resolveSignalGovernedViewV1(workspace, { module_key: "custom", view_key: "brand" }, guardedStore),
    /module_key/iu
  );
  await assert.rejects(
    resolveSignalGovernedViewV1(workspace, { module_key: "brand-monitoring", view_key: "admin-reservoir" }, guardedStore),
    /not available/iu
  );
  assert.equal(calls, 0);
});

const shadowFilter = {
  contract_version: "signal-backend-v1" as const,
  date_range: { start: "2026-01-01", end: "2026-12-31" },
  timezone: "UTC",
  granularity: "month" as const,
  dimensions: {}
};
const shadowActor = {
  id: "68000000-0000-4000-8000-000000000010",
  userType: "noisia_internal" as const,
  organizationId: workspace.organizationId
};

test("multi-view shadow rejects unknown views before touching PostgreSQL", async () => {
  let queries = 0;
  await assert.rejects(runSignalGovernedViewBindingShadowV1({
    workspace, actor: shadowActor, viewKey: "custom-view", filter: shadowFilter,
    queryable: { async query() { queries += 1; return { rows: [], rowCount: 0 }; } }
  }), /view_key must be one of|client-safe view/iu);
  assert.equal(queries, 0);
});

test("multi-view shadow requires repeatable-read read-only and persisted actor authority", async () => {
  let queries = 0;
  await assert.rejects(runSignalGovernedViewBindingShadowV1({
    workspace, actor: shadowActor, viewKey: "competition", filter: shadowFilter,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queries += 1;
        return {
          rows: [{ isolation: "read committed", read_only: "off" }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  }), /REPEATABLE READ READ ONLY/u);
  assert.equal(queries, 1);

  queries = 0;
  await assert.rejects(runSignalGovernedViewBindingShadowV1({
    workspace, actor: shadowActor, viewKey: "category", filter: shadowFilter,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queries += 1;
        return queries === 1
          ? { rows: [{ isolation: "repeatable read", read_only: "on" }] as unknown as Row[], rowCount: 1 }
          : { rows: [{ authorized: false }] as unknown as Row[], rowCount: 1 };
      }
    }
  }), /actor or workspace ownership is invalid/iu);
  assert.equal(queries, 2);
});

test("multi-view shadow accepts only a complete three-module execution permutation", async () => {
  await assert.rejects(runSignalGovernedViewBindingShadowV1({
    workspace, actor: shadowActor, viewKey: "all-governed", filter: shadowFilter,
    executionOrder: ["mentions", "mentions", "topics-narratives"],
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        return {
          rows: [{ isolation: "repeatable read", read_only: "on" }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  }), /each client module once/iu);
});
