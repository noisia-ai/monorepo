import assert from "node:assert/strict";
import test from "node:test";

import { validateEngineQueryPackCoverage } from "./lens-coverage";

test("lens coverage blocks comparison lenses without imported peer data", () => {
  const result = validateEngineQueryPackCoverage("narrative-ownership", {
    brandId: "brand-1",
    queryPacks: [
      {
        id: "narrative-brand",
        lensSlug: "narrative-ownership",
        scope: "brand",
        linkedMentionCount: 220
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.summary.importedScopes, ["brand"]);
  assert.deepEqual(result.summary.missingScopes, ["competitors", "category"]);
  assert.match(result.hardFailures.join("\n"), /Faltan query packs importados/);
});

test("lens coverage marks VPM ready with brand, competitor and category provenance", () => {
  const result = validateEngineQueryPackCoverage("value-perception-matrix", {
    brandId: "brand-1",
    queryPacks: [
      {
        id: "vpm-brand",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "brand",
        linkedMentionCount: 180
      },
      {
        id: "vpm-competitors",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "competitors",
        linkedMentionCount: 190
      },
      {
        id: "vpm-category",
        lensSlug: "value-perception-matrix",
        signalIntent: "value_perception",
        scope: "category",
        linkedMentionCount: 250
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.hardFailures, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.summary.importedScopes, ["brand", "competitors", "category"]);
});

test("lens coverage warns when required scopes only have shared fanout data", () => {
  const result = validateEngineQueryPackCoverage("narrative-ownership", {
    brandId: "brand-1",
    queryPacks: [
      {
        id: "narrative-brand",
        lensSlug: "narrative-ownership",
        signalIntent: "narrative_signal",
        scope: "brand",
        linkedMentionCount: 180,
        directMentionCount: 0,
        sharedMentionCount: 180
      },
      {
        id: "narrative-competitors",
        lensSlug: "narrative-ownership",
        signalIntent: "narrative_signal",
        scope: "competitors",
        linkedMentionCount: 180,
        directMentionCount: 180,
        sharedMentionCount: 0
      },
      {
        id: "narrative-category",
        lensSlug: "narrative-ownership",
        signalIntent: "narrative_signal",
        scope: "category",
        linkedMentionCount: 180,
        directMentionCount: 180,
        sharedMentionCount: 0
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "directional");
  assert.equal(result.summary.scopeCoverage.find((scope) => scope.scope === "brand")?.directMentionCount, 0);
  assert.match(result.warnings.join("\n"), /no CSV directo del pack: brand/);
});

test("lens coverage degrades low-volume lenses instead of blocking them", () => {
  const result = validateEngineQueryPackCoverage("journey-friction-mapping", {
    brandId: "brand-1",
    queryPacks: [
      {
        id: "jfm-brand",
        lensSlug: "journey-friction-mapping",
        scope: "brand",
        linkedMentionCount: 12
      },
      {
        id: "jfm-category",
        lensSlug: "journey-friction-mapping",
        scope: "category",
        linkedMentionCount: 9
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "directional");
  assert.deepEqual(result.summary.missingScopes, []);
  assert.match(result.warnings.join("\n"), /Scopes con menos de 80 menciones/);
});

test("evidence confidence coverage audits brand evidence without requiring peers", () => {
  const result = validateEngineQueryPackCoverage("evidence-confidence-layer", {
    brandId: "brand-1",
    queryPacks: [
      {
        id: "confidence-brand",
        lensSlug: "evidence-confidence-layer",
        signalIntent: "evidence_confidence",
        scope: "brand",
        linkedMentionCount: 12
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.summary.requiredScopes, ["brand"]);
  assert.deepEqual(result.summary.missingScopes, []);
  assert.deepEqual(result.hardFailures, []);
});

test("lens coverage keeps T&B on its active pipeline contract", () => {
  const result = validateEngineQueryPackCoverage("triggers-barriers", {});

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.requirement?.validation_level, "active_pipeline");
});
