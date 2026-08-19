import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  SignalBackendContractError,
  signalServingScopeCursorIsolationHashV1,
  type SignalGovernedViewDescriptorV1
} from "@noisia/query-engine";

import {
  finalizeSignalModuleServingScopeV1,
  loadSignalModuleShadowAuthorityV1,
  resolveSignalClientEvidenceServingScopeV1,
  resolveSignalModuleServingScopeV1,
  signalClientServingViewFromRequestV1,
  signalModuleServingEtagSeedV1,
  type SignalBrandServingModuleKeyV1
} from "./signal-module-serving-scope";
import type { SignalOperationalReadScopeV1 } from "./signal-operational-read-scope";
import type { ResolvedSignalWorkspace } from "./signal-workspace";

const workspace: ResolvedSignalWorkspace = {
  contractVersion: "signal-backend-v1",
  id: "74000000-0000-4000-8000-000000000001",
  organizationId: "74000000-0000-4000-8000-000000000002",
  slug: "module-scope-fixture",
  name: "Module scope fixture",
  subject: { type: "brand", id: "74000000-0000-4000-8000-000000000003" },
  timezone: "UTC",
  status: "active",
  corpora: [{
    id: "74000000-0000-4000-8000-000000000004",
    name: "Operational fixture",
    role: "operational",
    status: "active",
    validFrom: "2026-08-01T00:00:00Z",
    methodologySlug: "signal-v2",
    outputId: null
  }]
};

function legacyScope(): SignalOperationalReadScopeV1 {
  const legacyCorpus = workspace.corpora[0]!;
  return {
    descriptor: {
      contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: workspace.id,
      mode: "legacy",
      visible_source: "legacy_corpus",
      policy_key: "operational-primary-brand",
      population: null,
      legacy_corpus_id: legacyCorpus.id
    },
    workspace,
    mode: "legacy",
    visibleSource: "legacy_corpus",
    legacyCorpus,
    population: null
  };
}

function governedDescriptor(
  moduleKey: SignalBrandServingModuleKeyV1,
  source: "governed-binding" | "operational-brand-bridge" = "governed-binding",
  viewKey: "brand" | "competition" | "category" | "all-governed" = "brand"
): SignalGovernedViewDescriptorV1 {
  const moduleSuffix = moduleKey === "brand-monitoring" ? 10 : moduleKey === "mentions" ? 20 : 30;
  const viewOffset = viewKey === "brand" ? 0 : viewKey === "competition" ? 100 : viewKey === "category" ? 200 : 300;
  const suffix = String(moduleSuffix + viewOffset).padStart(3, "0");
  const population = {
    population_id: `74000000-0000-4000-8000-000000000${suffix}`,
    population_key: `${moduleKey}-${viewKey}`,
    population_version: 1,
    definition_hash: `sha256:${"a".repeat(64)}`,
    membership_digest: `sha256:${"b".repeat(64)}`,
    policy_compilation_id: source === "governed-binding"
      ? `74000000-0000-4000-8000-000000000${String(Number(suffix) + 1).padStart(3, "0")}`
      : null,
    compiled_plan_hash: source === "governed-binding" ? `sha256:${"c".repeat(64)}` : null,
    compilation_status: source === "governed-binding" ? "ready" as const : null
  };
  return {
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: workspace.id,
    module_key: moduleKey,
    view_key: viewKey,
    resolution_source: source,
    binding: source === "governed-binding" ? {
      workspace_id: workspace.id,
      binding_id: `74000000-0000-4000-8000-000000000${String(Number(suffix) + 2).padStart(3, "0")}`,
      binding_version: 1,
      module_key: moduleKey,
      view_key: viewKey
    } : null,
    policy: {
      workspace_id: workspace.id,
      policy_bundle_id: source === "governed-binding"
        ? `74000000-0000-4000-8000-000000000${String(40 + viewOffset).padStart(3, "0")}`
        : null,
      policy_key: source === "governed-binding"
        ? `operational-${viewKey}-governed`
        : "operational-pointer-brand-bridge",
      policy_version: 1,
      definition_hash: `sha256:${"d".repeat(64)}`
    },
    population,
    read_contract: source === "governed-binding" ? {
      authority_source: "compiled-policy" as const,
      predicate: {
        canonical_root_only: true as const,
        acceptance_status: "included" as const,
        semantic_assertion: {
          attribution_basis: "mention_semantic" as const,
          is_current: true as const,
          review_status: "approved" as const,
          eligibility_status: "eligible" as const,
          allowed_scopes: viewScopes(viewKey),
          allowed_entities: viewEntities(viewKey)
        },
        quality: {
          contract_status: "resolved" as const,
          policy_key: "fixture-quality",
          policy_version: 3,
          min_score: 7,
          required_flags: ["verified-source"],
          forbidden_flags: ["spam"],
          policy_id: "74000000-0000-4000-8000-000000000041"
        },
        data_governance: {
          contract_status: "resolved" as const,
          required_usage_purposes: moduleKey === "mentions"
            ? ["client-mention-list", "client-text-or-excerpt"]
            : ["client-derived-metrics"],
          provenance_precedence: "import-over-source" as const,
          authorization_rule: "any-authorized-provenance" as const
        },
        period: {
          start: "2026-08-01",
          end: "2026-08-31",
          timezone: "America/Mexico_City"
        }
      }
    } : {
      authority_source: "operational-population" as const,
      acceptance_status: "included" as const,
      allowed_scopes: ["primary_brand"] as ["primary_brand"],
      min_quality_score: 5,
      period_start: "2026-07-01",
      period_end: "2026-07-31"
    },
    visibility_class: "client-safe",
    denominator: {
      key: "eligible-canonical-roots",
      unit: "canonical-root",
      deduplication_policy: "canonical-root"
    }
  };
}

function dependencies(args: {
  governed?: (
    moduleKey: SignalBrandServingModuleKeyV1,
    viewKey: "brand" | "competition" | "category" | "all-governed"
  ) => SignalGovernedViewDescriptorV1;
  error?: Error;
  calls?: string[];
} = {}) {
  return {
    resolveLegacyScope: async () => {
      args.calls?.push("legacy");
      return legacyScope();
    },
    resolveGovernedView: async (
      _workspace: ResolvedSignalWorkspace,
      input: { module_key: unknown; view_key: unknown }
    ) => {
      args.calls?.push(`governed:${String(input.module_key)}`);
      if (args.error) throw args.error;
      return (args.governed ?? ((moduleKey, viewKey) => governedDescriptor(
        moduleKey,
        "governed-binding",
        viewKey
      )))(
        input.module_key as SignalBrandServingModuleKeyV1,
        input.view_key as "brand" | "competition" | "category" | "all-governed"
      );
    }
  };
}

function viewScopes(viewKey: "brand" | "competition" | "category" | "all-governed") {
  if (viewKey === "brand") return ["primary_brand"] as ["primary_brand"];
  if (viewKey === "competition") return ["competitor"] as ["competitor"];
  if (viewKey === "category") return ["category"] as ["category"];
  return ["primary_brand", "competitor", "category", "reference"] as Array<
    "primary_brand" | "competitor" | "category" | "reference"
  >;
}

function viewEntities(viewKey: "brand" | "competition" | "category" | "all-governed") {
  const brand = {
    scope: "primary_brand" as const,
    entity_type: "brand" as const,
    entity_id: workspace.subject.id
  };
  const competitor = {
    scope: "competitor" as const,
    entity_type: "competitor" as const,
    entity_id: "74000000-0000-4000-8000-000000000051"
  };
  const category = {
    scope: "category" as const,
    entity_type: "category" as const,
    entity_id: "74000000-0000-4000-8000-000000000052"
  };
  const reference = {
    scope: "reference" as const,
    entity_type: "reference" as const,
    entity_id: "74000000-0000-4000-8000-000000000053"
  };
  if (viewKey === "brand") return [brand];
  if (viewKey === "competition") return [competitor];
  if (viewKey === "category") return [category];
  return [brand, competitor, category, reference];
}

test("legacy resolves no governed binding and shadow preserves the legacy visible scope", async () => {
  const legacyCalls: string[] = [];
  const legacy = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "legacy",
    dependencies: dependencies({ calls: legacyCalls })
  });
  assert.deepEqual(legacyCalls, ["legacy"]);
  assert.equal(legacy.visible_source, "legacy");
  assert.equal(legacy.governed.state, "not_available");

  const shadowCalls: string[] = [];
  const shadow = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "shadow",
    dependencies: dependencies({ calls: shadowCalls })
  });
  assert.deepEqual(shadowCalls, ["governed:mentions", "legacy"]);
  assert.equal(shadow.visible_source, "legacy");
  assert.equal(shadow.readScope.visibleSource, "legacy_corpus");
  assert.equal(shadow.readScope.mode, "shadow");
  assert.equal(shadow.readScope.population?.id, governedDescriptor("mentions").population?.population_id);
  assert.equal(shadow.governed.state, "available");
});

test("the three modules resolve independent server-owned populations", async () => {
  const modules = ["brand-monitoring", "mentions", "topics-narratives"] as const;
  const scopes = await Promise.all(modules.map((moduleKey) => (
    resolveSignalModuleServingScopeV1(workspace, moduleKey, {
      mode: "governed",
      dependencies: dependencies()
    })
  )));
  assert.deepEqual(scopes.map((scope) => scope.module_key), modules);
  assert.equal(new Set(scopes.map((scope) => scope.readScope.population?.id)).size, 3);
  assert.ok(scopes.every((scope) => scope.visible_source === "governed-binding"));
  assert.ok(scopes.every((scope) => (
    scope.readScope.descriptor.policy_key === "operational-brand-governed"
    && scope.readScope.population?.quality_contract_status === "resolved"
    && scope.readScope.population.min_quality_score === 7
    && scope.readScope.population.required_quality_flags[0] === "verified-source"
    && scope.readScope.population.forbidden_quality_flags[0] === "spam"
    && scope.readScope.population.period_start === "2026-08-01"
    && scope.readScope.population.period_end === "2026-08-31"
    && scope.readScope.population.timezone === "America/Mexico_City"
  )));
});

test("an absent binding may resolve the explicit bridge", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "brand-monitoring", {
    mode: "governed",
    dependencies: dependencies({
      governed: (moduleKey) => governedDescriptor(moduleKey, "operational-brand-bridge")
    })
  });
  assert.equal(scope.visible_source, "operational-brand-bridge");
  assert.equal(scope.governed.state, "available");
  assert.equal(scope.governed.descriptor.binding, null);
  assert.equal(scope.readScope.descriptor.policy_key, "operational-pointer-brand-bridge");
  assert.equal(scope.readScope.population?.quality_contract_status, "not_available");
  assert.equal(scope.readScope.population?.min_quality_score, 5);
  assert.equal(scope.readScope.population?.period_start, "2026-07-01");
  assert.equal(scope.readScope.population?.period_end, "2026-07-31");
});

test("a descriptor cannot widen the brand read scope beyond its compiled policy", async () => {
  const incompatible = governedDescriptor("mentions");
  if (incompatible.read_contract.authority_source !== "compiled-policy") {
    throw new Error("Fixture must carry compiled policy authority.");
  }
  incompatible.read_contract.predicate.semantic_assertion = {
    ...incompatible.read_contract.predicate.semantic_assertion!,
    allowed_scopes: ["competitor"]
  };
  await assert.rejects(
    resolveSignalModuleServingScopeV1(workspace, "mentions", {
      mode: "governed",
      dependencies: dependencies({ governed: () => incompatible })
    }),
    /policy is incompatible/iu
  );
});

test("invalid governed authority is recorded off-path in shadow and fails governed closed", async () => {
  const error = new SignalBackendContractError(
    "not_available",
    "Governed view is unavailable.",
    { reason: "governed_view_binding_contract_invalid" }
  );
  const shadow = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "shadow",
    dependencies: dependencies({ error })
  });
  assert.equal(shadow.visible_source, "legacy");
  assert.equal(shadow.governed.state, "not_available");
  assert.equal(shadow.governed.reason, "governed_view_binding_contract_invalid");
  assert.equal(shadow.readScope.population, null);

  await assert.rejects(
    resolveSignalModuleServingScopeV1(workspace, "mentions", {
      mode: "governed",
      dependencies: dependencies({ error })
    }),
    /unavailable/iu
  );
});

test("an unavailable or bridged Mentions authority withholds evidence without widening metrics", async () => {
  const unavailable = await resolveSignalClientEvidenceServingScopeV1({
    workspace,
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-08-01", end: "2026-08-12" },
      timezone: "UTC",
      granularity: "day",
      dimensions: {}
    },
    dependencies: dependencies({
      error: new SignalBackendContractError(
        "not_available",
        "Mentions binding is stale.",
        { reason: "governed_view_binding_stale" }
      )
    })
  });
  assert.deepEqual(unavailable, {
    state: "not_available",
    reason: "governed_view_binding_stale",
    readScope: null,
    servingScope: null
  });

  const bridgedScope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "governed",
    dependencies: dependencies({
      governed: (moduleKey) => governedDescriptor(moduleKey, "operational-brand-bridge")
    })
  });
  const bridged = await resolveSignalClientEvidenceServingScopeV1({
    workspace,
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-08-01", end: "2026-08-12" },
      timezone: "UTC",
      granularity: "day",
      dimensions: {}
    },
    resolvedScope: bridgedScope
  });
  assert.equal(bridged.state, "not_available");
  assert.equal(bridged.reason, "mentions_capability_not_available");
});

test("evidence resolution does not hide infrastructure failures as capability decisions", async () => {
  await assert.rejects(
    resolveSignalClientEvidenceServingScopeV1({
      workspace,
      filter: {
        contract_version: "signal-backend-v1",
        date_range: { start: "2026-08-01", end: "2026-08-12" },
        timezone: "UTC",
        granularity: "day",
        dimensions: {}
      },
      dependencies: dependencies({ error: new Error("database connection failed") })
    }),
    /database connection failed/iu
  );
});

test("arbitrary module, view and population inputs are rejected before resolution", async () => {
  const calls: string[] = [];
  await assert.rejects(
    resolveSignalModuleServingScopeV1(
      workspace,
      { module_key: "mentions", view_key: "brand", population_id: "untrusted" } as never,
      { mode: "governed", dependencies: dependencies({ calls }) }
    ),
    /module is not available/iu
  );
  assert.deepEqual(calls, []);
});

test("filter-time finalization composes validated watermark, coverage and denominator authority", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "shadow",
    dependencies: dependencies()
  });
  const descriptor = governedDescriptor("mentions");
  let queryIndex = 0;
  const serving = await finalizeSignalModuleServingScopeV1({
    scope,
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-08-01", end: "2026-08-12" },
      timezone: "UTC",
      granularity: "day",
      dimensions: {}
    },
    queryable: {
      async query<Row>() {
        queryIndex += 1;
        if (queryIndex === 1) {
          return { rows: [{
            workspace_id: workspace.id,
            module_key: "mentions",
            view_key: "brand",
            binding_id: descriptor.binding!.binding_id,
            policy_bundle_id: descriptor.policy.policy_bundle_id,
            population_id: descriptor.population!.population_id,
            policy_compilation_id: descriptor.population!.policy_compilation_id,
            source_watermark_hash: `sha256:${"e".repeat(64)}`,
            governance_digest: `sha256:${"f".repeat(64)}`,
            governance_data_watermark_id: "74000000-0000-4000-8000-000000000099",
            data_watermark_hash: `sha256:${"1".repeat(64)}`,
            data_freshness_state: "fresh",
            captured_at: "2026-08-12T12:00:00Z",
            next_policy_transition_at: null,
            quality_contract_status: "resolved",
            min_quality_score: null,
            required_quality_flags: [],
            forbidden_quality_flags: [],
            invalidation_count: 0,
            invalidated_at: null
          } as Row], rowCount: 1 };
        }
        if (queryIndex === 2) {
          return { rows: [{
            captured: 12,
            quality_eligible: 12,
            reviewed: 10,
            resolved_attributed: 9,
            unattributed: 1
          } as Row], rowCount: 1 };
        }
        return { rows: [{ used_by_view: 8 } as Row], rowCount: 1 };
      }
    }
  });
  assert.equal(queryIndex, 3);
  assert.equal(serving.rollout_mode, "shadow");
  assert.equal(serving.visible_source, "legacy");
  assert.equal(serving.resolution_source, "governed-binding");
  assert.equal(serving.denominator.count, 8);
  assert.equal(serving.coverage.used_by_view.count, 8);
  assert.deepEqual(serving.coverage.abstained, {
    availability: "not_available",
    count: null
  });
  assert.equal(serving.watermark.availability, "available");
  assert.deepEqual(serving.usage_purposes, [
    "client-mention-list",
    "client-text-or-excerpt"
  ]);
  const legacySeed = "unchanged-legacy-seed";
  assert.equal(signalModuleServingEtagSeedV1(legacySeed, null), legacySeed);
  assert.match(
    signalModuleServingEtagSeedV1(legacySeed, serving),
    /^sha256:[0-9a-f]{64}:unchanged-legacy-seed$/u
  );
});

test("all-time governed metadata reports a null period without inventing dates", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "brand-monitoring", {
    mode: "governed",
    dependencies: dependencies({
      governed: (moduleKey) => governedDescriptor(moduleKey, "operational-brand-bridge")
    })
  });
  let queryIndex = 0;
  const serving = await finalizeSignalModuleServingScopeV1({
    scope,
    filter: null,
    queryable: {
      async query<Row>(sql: string) {
        queryIndex += 1;
        assert.doesNotMatch(sql, /published_at AT TIME ZONE/u);
        return queryIndex === 1
          ? {
              rows: [{
                captured: 0,
                quality_eligible: 0,
                reviewed: 0,
                resolved_attributed: 0,
                unattributed: 0
              } as Row],
              rowCount: 1
            }
          : { rows: [{ used_by_view: 0 } as Row], rowCount: 1 };
      }
    }
  });
  assert.equal(queryIndex, 2);
  assert.equal(serving.period, null);
  assert.equal(serving.denominator.count, 0);
  assert.equal(serving.watermark.availability, "not_available");
  assert.equal(serving.freshness.state, "not_available");
});

test("shadow authority captures the exact current binding through watermark", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "shadow",
    dependencies: dependencies()
  });
  const descriptor = governedDescriptor("mentions");
  const proof = {
    workspace_id: workspace.id,
    module_key: "mentions",
    view_key: "brand",
    binding_id: descriptor.binding!.binding_id,
    policy_bundle_id: descriptor.policy.policy_bundle_id,
    population_id: descriptor.population!.population_id,
    policy_compilation_id: descriptor.population!.policy_compilation_id,
    source_watermark_hash: `sha256:${"e".repeat(64)}`,
    governance_digest: `sha256:${"f".repeat(64)}`,
    governance_data_watermark_id: "74000000-0000-4000-8000-000000000099",
    data_watermark_hash: `sha256:${"1".repeat(64)}`,
    data_freshness_state: "fresh",
    captured_at: "2026-08-12T12:00:00Z",
    next_policy_transition_at: null,
    quality_contract_status: "resolved",
    min_quality_score: null,
    required_quality_flags: [],
    forbidden_quality_flags: [],
    invalidation_count: 0,
    invalidated_at: null
  };
  const authority = await loadSignalModuleShadowAuthorityV1({
    scope,
    queryable: {
      async query<Row>() {
        return { rows: [proof as Row], rowCount: 1 };
      }
    }
  });
  assert.equal(authority.binding.id, descriptor.binding!.binding_id);
  assert.equal(authority.policy.bundle_id, descriptor.policy.policy_bundle_id);
  assert.equal(authority.population.id, descriptor.population!.population_id);
  assert.equal(authority.compilation.id, descriptor.population!.policy_compilation_id);
  assert.equal(authority.watermark.id, proof.governance_data_watermark_id);

  await assert.rejects(
    loadSignalModuleShadowAuthorityV1({
      scope,
      queryable: {
        async query<Row>() {
          return { rows: [{ ...proof, invalidation_count: 1 } as Row], rowCount: 1 };
        }
      }
    }),
    /stale or lacks a durable watermark/iu
  );
});

test("missing coverage aggregates fail closed instead of becoming observed zero", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "governed",
    dependencies: dependencies()
  });
  const descriptor = governedDescriptor("mentions");
  let queryIndex = 0;
  await assert.rejects(
    finalizeSignalModuleServingScopeV1({
      scope,
      filter: null,
      queryable: {
        async query<Row>() {
          queryIndex += 1;
          if (queryIndex === 1) {
            return { rows: [{
              workspace_id: workspace.id,
              module_key: "mentions",
              view_key: "brand",
              binding_id: descriptor.binding!.binding_id,
              policy_bundle_id: descriptor.policy.policy_bundle_id,
              population_id: descriptor.population!.population_id,
              policy_compilation_id: descriptor.population!.policy_compilation_id,
              source_watermark_hash: `sha256:${"e".repeat(64)}`,
              governance_digest: `sha256:${"f".repeat(64)}`,
              governance_data_watermark_id: "74000000-0000-4000-8000-000000000099",
              data_watermark_hash: `sha256:${"1".repeat(64)}`,
              data_freshness_state: "fresh",
              captured_at: "2026-08-12T12:00:00Z",
              next_policy_transition_at: null,
              quality_contract_status: "resolved",
              min_quality_score: 7,
              required_quality_flags: ["verified-source"],
              forbidden_quality_flags: ["spam"],
              invalidation_count: 0,
              invalidated_at: null
            } as Row], rowCount: 1 };
          }
          if (queryIndex === 2) {
            return { rows: [{
              captured: 12,
              quality_eligible: 12,
              reviewed: 10,
              resolved_attributed: 9,
              unattributed: 1
            } as Row], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
      }
    }),
    /coverage could not be measured/iu
  );
  assert.equal(queryIndex, 3);
});

test("the HTTP boundary accepts only the closed client view selector and no authority ids", () => {
  assert.equal(
    signalClientServingViewFromRequestV1(new Request("https://studio.test/signal")),
    "brand"
  );
  for (const view of ["brand", "competition", "category", "all-governed"] as const) {
    assert.equal(
      signalClientServingViewFromRequestV1(
        new Request(`https://studio.test/signal?view=${view}`)
      ),
      view
    );
  }
  assert.throws(
    () => signalClientServingViewFromRequestV1(
      new Request("https://studio.test/signal?view=admin-reservoir")
    ),
    /client-safe view/iu
  );
  for (const authority of [
    "population_id=untrusted",
    "policy_bundle_id=untrusted",
    "binding_id=untrusted",
    "read_mode=governed",
    "view_key=competition"
  ]) {
    assert.throws(
      () => signalClientServingViewFromRequestV1(
        new Request(`https://studio.test/signal?${authority}`)
      ),
      /resolved by the authenticated server boundary/iu
    );
  }
});

test("non-brand views require a governed binding and can never fall through to the bridge", async () => {
  const calls: string[] = [];
  const missing = new SignalBackendContractError(
    "not_available",
    "Governed view is unavailable.",
    { reason: "governed_view_binding_not_available" }
  );
  await assert.rejects(
    resolveSignalModuleServingScopeV1(workspace, "mentions", {
      mode: "governed",
      viewKey: "competition",
      dependencies: dependencies({ calls, error: missing })
    }),
    (error: unknown) => error instanceof SignalBackendContractError
      && error.code === "not_available"
      && error.details.reason === "governed_view_binding_not_available"
  );
  assert.deepEqual(calls, ["governed:mentions"]);

  await assert.rejects(
    resolveSignalModuleServingScopeV1(workspace, "mentions", {
      mode: "legacy",
      viewKey: "category",
      dependencies: dependencies({ calls: [] })
    }),
    (error: unknown) => error instanceof SignalBackendContractError
      && error.code === "not_available"
      && error.details.reason === "governed_view_binding_not_available"
  );
});

test("a non-brand governed binding resolves the exact view-specific population", async () => {
  const scope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "governed",
    viewKey: "competition",
    dependencies: dependencies()
  });
  assert.equal(scope.view_key, "competition");
  assert.equal(scope.visible_source, "governed-binding");
  assert.deepEqual(scope.readScope.population?.allowed_scopes, ["competitor"]);
  assert.equal(
    scope.readScope.population?.id,
    governedDescriptor("mentions", "governed-binding", "competition").population?.population_id
  );
});

test("evidence authority is resolved for the same view and rejects cross-view reuse", async () => {
  const competition = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
    mode: "governed",
    viewKey: "competition",
    dependencies: dependencies()
  });
  const filter = {
    contract_version: "signal-backend-v1" as const,
    date_range: { start: "2026-08-01", end: "2026-08-12" },
    timezone: "UTC",
    granularity: "day" as const,
    dimensions: {}
  };
  const crossView = await resolveSignalClientEvidenceServingScopeV1({
    workspace,
    filter,
    viewKey: "category",
    resolvedScope: competition
  });
  assert.deepEqual(crossView, {
    state: "not_available",
    reason: "mentions_capability_not_available",
    readScope: null,
    servingScope: null
  });

  const sameView = await resolveSignalClientEvidenceServingScopeV1({
    workspace,
    filter,
    viewKey: "competition",
    resolvedScope: competition,
    queryable: servingProofQueryable(
      governedDescriptor("mentions", "governed-binding", "competition"),
      "competition"
    )
  });
  assert.equal(sameView.state, "available");
  assert.equal(sameView.servingScope?.view_key, "competition");
  assert.deepEqual(sameView.servingScope?.usage_purposes, [
    "client-mention-list",
    "client-text-or-excerpt"
  ]);
});

test("ETag and cursor identities cannot be reused across governed views", async () => {
  const filter = {
    contract_version: "signal-backend-v1" as const,
    date_range: { start: "2026-08-01", end: "2026-08-12" },
    timezone: "UTC",
    granularity: "day" as const,
    dimensions: {}
  };
  const serving = await Promise.all((["brand", "competition"] as const).map(async (viewKey) => {
    const scope = await resolveSignalModuleServingScopeV1(workspace, "mentions", {
      mode: "governed",
      viewKey,
      dependencies: dependencies()
    });
    return finalizeSignalModuleServingScopeV1({
      scope,
      filter,
      queryable: servingProofQueryable(
        governedDescriptor("mentions", "governed-binding", viewKey),
        viewKey
      )
    });
  }));
  const brand = serving[0]!;
  const competition = serving[1]!;
  assert.notEqual(
    signalModuleServingEtagSeedV1("same-payload", brand),
    signalModuleServingEtagSeedV1("same-payload", competition)
  );
  assert.notEqual(
    signalServingScopeCursorIsolationHashV1({
      scope: brand,
      normalized_filters_hash: `sha256:${"4".repeat(64)}`,
      normalized_sort_hash: `sha256:${"5".repeat(64)}`
    }),
    signalServingScopeCursorIsolationHashV1({
      scope: competition,
      normalized_filters_hash: `sha256:${"4".repeat(64)}`,
      normalized_sort_hash: `sha256:${"5".repeat(64)}`
    })
  );
});

function servingProofQueryable(
  descriptor: SignalGovernedViewDescriptorV1,
  viewKey: "brand" | "competition" | "category" | "all-governed"
) {
  let queryIndex = 0;
  return {
    async query<Row>() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return { rows: [{
          workspace_id: workspace.id,
          module_key: "mentions",
          view_key: viewKey,
          binding_id: descriptor.binding!.binding_id,
          policy_bundle_id: descriptor.policy.policy_bundle_id,
          population_id: descriptor.population!.population_id,
          policy_compilation_id: descriptor.population!.policy_compilation_id,
          source_watermark_hash: `sha256:${"e".repeat(64)}`,
          governance_digest: `sha256:${"f".repeat(64)}`,
          governance_data_watermark_id: "74000000-0000-4000-8000-000000000099",
          data_watermark_hash: `sha256:${"1".repeat(64)}`,
          data_freshness_state: "fresh",
          captured_at: "2026-08-12T12:00:00Z",
          next_policy_transition_at: null,
          quality_contract_status: "resolved",
          min_quality_score: 0,
          required_quality_flags: [],
          forbidden_quality_flags: [],
          invalidation_count: 0,
          invalidated_at: null
        } as Row], rowCount: 1 };
      }
      if (queryIndex === 2) {
        return { rows: [{
          captured: 12,
          quality_eligible: 12,
          reviewed: 10,
          resolved_attributed: 9,
          unattributed: 1
        } as Row], rowCount: 1 };
      }
      return { rows: [{ used_by_view: 8 } as Row], rowCount: 1 };
    }
  };
}
