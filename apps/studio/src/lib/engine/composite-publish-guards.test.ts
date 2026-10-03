import assert from "node:assert/strict";
import test from "node:test";

import {
  explicitCompositeEngineLensesFromPlan,
  validateCompositeEnginePublishReadiness
} from "./composite-publish-guards";

const readyMeta = {
  synthesis: { engine_block_ready: true },
  engine_block: {
    methodology_view: {
      readiness: {
        status: "beta_ready",
        reason: "ok"
      }
    }
  },
  engine_coding: { provider: "anthropic", fixture: false },
  quality_gates: [{ id: "traceability", passed: true, detail: "ok" }]
};

test("composite publish guard only enforces explicitly selected engine lenses", () => {
  assert.deepEqual(explicitCompositeEngineLensesFromPlan(null), []);
  assert.deepEqual(explicitCompositeEngineLensesFromPlan({
    selected_lenses: ["triggers-barriers", "narrative-ownership", "unknown"]
  }), ["narrative-ownership"]);
});

test("composite publish guard blocks an enabled selected lens with no engine analysis", () => {
  const result = validateCompositeEnginePublishReadiness({
    analysisPlan: { selected_lenses: ["triggers-barriers", "narrative-ownership"] },
    manifest: { narrative_ownership: true },
    latestAnalyses: []
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "selected_engine_lenses_not_ready");
    assert.equal(result.failed_lenses[0]?.methodology_slug, "narrative-ownership");
    assert.equal(result.failed_lenses[0]?.error, "engine_lens_missing");
  }
});

test("composite publish guard ignores selected lenses whose modules are disabled", () => {
  const result = validateCompositeEnginePublishReadiness({
    analysisPlan: { selected_lenses: ["triggers-barriers", "narrative-ownership"] },
    manifest: { narrative_ownership: false, engine_methodology: false },
    latestAnalyses: []
  });

  assert.equal(result.ok, true);
});

test("composite publish guard blocks fixture-coded selected lenses", () => {
  const result = validateCompositeEnginePublishReadiness({
    analysisPlan: { selected_lenses: ["triggers-barriers", "value-perception-matrix"] },
    manifest: { value_perception: true },
    latestAnalyses: [{
      methodologySlug: "value-perception-matrix",
      engineAnalysisId: "engine-1",
      status: "needs_review",
      currentStep: "review",
      metaJson: readyMeta,
      usedFixtureCoding: true
    }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failed_lenses[0]?.error, "fixture_coding_used");
  }
});

test("composite publish guard blocks selected lenses without Claude coding", () => {
  const result = validateCompositeEnginePublishReadiness({
    analysisPlan: { selected_lenses: ["triggers-barriers", "narrative-ownership"] },
    manifest: { narrative_ownership: true },
    latestAnalyses: [{
      methodologySlug: "narrative-ownership",
      engineAnalysisId: "engine-1",
      status: "needs_review",
      currentStep: "review",
      metaJson: {
        ...readyMeta,
        engine_coding: undefined
      },
      usedFixtureCoding: false
    }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failed_lenses[0]?.error, "engine_coding_missing");
    assert.deepEqual(result.failed_lenses[0]?.failed_checks, [{
      id: "engine_coding_provider",
      detail: "provider=missing"
    }]);
  }
});

test("composite publish guard allows ready Claude-backed selected lenses", () => {
  const result = validateCompositeEnginePublishReadiness({
    analysisPlan: {
      selected_lenses: [
        "triggers-barriers",
        "narrative-ownership",
        "value-perception-matrix"
      ]
    },
    manifest: {
      narrative_ownership: true,
      value_perception: true
    },
    latestAnalyses: [
      {
        methodologySlug: "narrative-ownership",
        engineAnalysisId: "engine-1",
        status: "needs_review",
        currentStep: "review",
        metaJson: readyMeta,
        usedFixtureCoding: false
      },
      {
        methodologySlug: "value-perception-matrix",
        engineAnalysisId: "engine-2",
        status: "approved",
        currentStep: "review",
        metaJson: readyMeta,
        usedFixtureCoding: false
      }
    ]
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.required_lenses, ["narrative-ownership", "value-perception-matrix"]);
});
