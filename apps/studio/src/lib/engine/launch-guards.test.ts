import assert from "node:assert/strict";
import test from "node:test";

import { shouldReuseEngineAnalysis, validateEngineLaunchRequest } from "./launch-guards";
import { validateEngineQueryPackCoverage } from "./query-pack-validation";

test("engine launch rejects non-engine methodologies", () => {
  const result = validateEngineLaunchRequest("triggers-barriers", {
    slug: "triggers-barriers",
    version: "1.0",
    status: "active"
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "unsupported_methodology",
    message: "Esta ruta sólo corre metodologías engine_* beta. Para T&B usa /tb-analysis.",
    methodologySlug: "triggers-barriers"
  });
});

test("engine launch rejects read-only cheap outputs", () => {
  const result = validateEngineLaunchRequest("competitive-tb-matrix", {
    slug: "competitive-tb-matrix",
    version: "0.1",
    status: "beta"
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "read_only_output_methodology",
    message: "Competitive T/B Matrix no corre como engine; se publica como output barato leyendo el análisis T&B existente.",
    methodologySlug: "competitive-tb-matrix"
  });
});

test("engine launch rejects unseeded and non-beta methodology manifests", () => {
  assert.deepEqual(validateEngineLaunchRequest("narrative-ownership", null), {
    ok: false,
    status: 400,
    error: "methodology_not_seeded",
    message: "Methodology manifest not found in DB. Run methodology seeds first.",
    methodologySlug: "narrative-ownership"
  });

  assert.deepEqual(validateEngineLaunchRequest("narrative-ownership", {
    slug: "narrative-ownership",
    version: "0.1",
    status: "active"
  }), {
    ok: false,
    status: 409,
    error: "methodology_not_beta",
    message: "Las metodologias engine nuevas solo corren como beta controlada en esta fase.",
    methodologySlug: "narrative-ownership",
    methodologyStatus: "active"
  });
});

test("engine launch allows formerly shadow methodologies when seeded beta", () => {
  assert.deepEqual(validateEngineLaunchRequest("category-opportunity-map", {
    slug: "category-opportunity-map",
    version: "0.1",
    status: "beta"
  }), {
    ok: true,
    methodologySlug: "category-opportunity-map",
    methodologyVersion: "0.1",
    methodologyStatus: "beta"
  });
});

test("engine launch allows seeded beta runtime methodologies only", () => {
  const result = validateEngineLaunchRequest("narrative-ownership", {
    slug: "narrative-ownership",
    version: "0.1",
    status: "beta"
  });

  assert.deepEqual(result, {
    ok: true,
    methodologySlug: "narrative-ownership",
    methodologyVersion: "0.1",
    methodologyStatus: "beta"
  });
});

test("engine launch allows Signal Pulse beta through its own pipeline", () => {
  const result = validateEngineLaunchRequest("signal-pulse", {
    slug: "signal-pulse",
    version: "0.1",
    status: "beta"
  });

  assert.deepEqual(result, {
    ok: true,
    methodologySlug: "signal-pulse",
    methodologyVersion: "0.1",
    methodologyStatus: "beta"
  });
});

test("engine analysis reuse requires real retrieval and Claude coding for completed runs", () => {
  assert.equal(shouldReuseEngineAnalysis({ status: "queued" }), true);
  assert.equal(shouldReuseEngineAnalysis({ status: "running" }), true);
  assert.equal(shouldReuseEngineAnalysis({
    status: "needs_review",
    retrievedUnits: 42,
    codingProvider: "anthropic",
    codingFixture: false
  }), true);
  assert.equal(shouldReuseEngineAnalysis({
    status: "needs_review",
    retrievedUnits: 0,
    codingProvider: "anthropic",
    codingFixture: false
  }), false);
  assert.equal(shouldReuseEngineAnalysis({
    status: "approved",
    retrievedUnits: 42,
    codingProvider: "fixture",
    codingFixture: true
  }), false);
  assert.equal(shouldReuseEngineAnalysis({
    status: "failed",
    retrievedUnits: 42,
    codingProvider: "anthropic",
    codingFixture: false
  }), false);
});

test("query pack validation blocks comparison lenses without a peer set", () => {
  const result = validateEngineQueryPackCoverage("narrative-ownership", {
    brandId: "brand-1",
    entities: [
      {
        id: "entity-brand",
        name: "Operador QA",
        entityKind: "primary_brand",
        includedCount: 320
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.summary.comparableEntities, 1);
  assert.equal(result.summary.competitors, 0);
  assert.match(result.hardFailures.join("\n"), /al menos 2 entidades/);
  assert.match(result.hardFailures.join("\n"), /competidor\/peer/);
});

test("query pack validation allows industry studies with two peers but degrades low coverage", () => {
  const result = validateEngineQueryPackCoverage("narrative-ownership", {
    themeId: "theme-1",
    entities: [
      {
        id: "entity-a",
        name: "Telcel",
        entityKind: "competitor",
        includedCount: 42
      },
      {
        id: "entity-b",
        name: "AT&T",
        entityKind: "competitor",
        includedCount: 38
      }
    ],
    queryPacks: [
      {
        id: "narrative-competitors",
        lensSlug: "narrative-ownership",
        signalIntent: "narrative_signal",
        scope: "competitors",
        mentionsReturned: 80
      },
      {
        id: "narrative-category",
        lensSlug: "narrative-ownership",
        signalIntent: "narrative_signal",
        scope: "category",
        mentionsReturned: 22
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "directional");
  assert.equal(result.summary.comparableEntities, 2);
  assert.equal(result.summary.competitors, 2);
  assert.equal(result.summary.minComparableMentions, 38);
  assert.deepEqual(result.summary.requiredScopes, ["competitors", "category"]);
  assert.deepEqual(result.summary.importedScopes, ["competitors", "category"]);
  assert.deepEqual(result.summary.missingScopes, []);
  assert.deepEqual(result.summary.scopeCoverage.map((scope) => ({
    scope: scope.scope,
    mentionCount: scope.mentionCount,
    status: scope.status
  })), [
    { scope: "competitors", mentionCount: 80, status: "low_coverage" },
    { scope: "category", mentionCount: 22, status: "low_coverage" }
  ]);
  assert.match(result.warnings.join("\n"), /menos de 150 menciones/);
  assert.match(result.warnings.join("\n"), /Scopes con menos de 150 menciones/);
});

test("query pack validation marks VPM ready with brand, competitor and category coverage", () => {
  const result = validateEngineQueryPackCoverage("value-perception-matrix", {
    brandId: "brand-1",
    entities: [
      {
        id: "entity-brand",
        name: "Operador QA",
        entityKind: "primary_brand",
        includedCount: 180
      },
      {
        id: "entity-peer",
        name: "Telcel",
        entityKind: "competitor",
        includedCount: 190
      },
      {
        id: "entity-category",
        name: "Telefonia movil Mexico",
        entityKind: "category",
        isCategoryBaseline: true,
        includedCount: 250
      }
    ],
    queryPacks: [
      {
        id: "vpm-brand",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "brand",
        mentionsReturned: 180
      },
      {
        id: "vpm-competitors",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "competitors",
        mentionsReturned: 190
      },
      {
        id: "vpm-category",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "category",
        mentionsReturned: 250
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.summary.totalIncluded, 620);
  assert.equal(result.summary.comparableEntities, 2);
  assert.equal(result.summary.competitors, 1);
  assert.equal(result.summary.categorySignals, 1);
  assert.deepEqual(result.hardFailures, []);
  assert.deepEqual(result.warnings, []);
});

test("query pack validation accepts linked mention provenance as imported lens coverage", () => {
  const result = validateEngineQueryPackCoverage("trust-risk-benchmark", {
    brandId: "brand-1",
    entities: [
      {
        id: "entity-brand",
        name: "Operador QA",
        entityKind: "primary_brand",
        includedCount: 160
      },
      {
        id: "entity-peer",
        name: "Telcel",
        entityKind: "competitor",
        includedCount: 170
      },
      {
        id: "entity-category",
        name: "Telefonia movil Mexico",
        entityKind: "category",
        isCategoryBaseline: true,
        includedCount: 180
      }
    ],
    queryPacks: [
      {
        id: "trust-brand",
        lensSlug: "trust-risk-benchmark",
        signalIntent: "trust_risk",
        scope: "brand",
        linkedMentionCount: 160
      },
      {
        id: "trust-competitors",
        lensSlug: "trust-risk-benchmark",
        signalIntent: "trust_risk",
        scope: "competitors",
        linkedMentionCount: 170
      },
      {
        id: "trust-category",
        lensSlug: "trust-risk-benchmark",
        signalIntent: "trust_risk",
        scope: "category",
        linkedMentionCount: 180
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.summary.importedScopes, ["brand", "competitors", "category"]);
  assert.deepEqual(result.summary.scopeCoverage.map((scope) => ({
    scope: scope.scope,
    mentionCount: scope.mentionCount,
    status: scope.status
  })), [
    { scope: "brand", mentionCount: 160, status: "ready" },
    { scope: "competitors", mentionCount: 170, status: "ready" },
    { scope: "category", mentionCount: 180, status: "ready" }
  ]);
  assert.deepEqual(result.hardFailures, []);
});

test("query pack validation keeps T&B on its existing pipeline contract", () => {
  const result = validateEngineQueryPackCoverage("triggers-barriers", {
    entities: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.requirement?.validation_level, "active_pipeline");
});
