import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTbTemporalSemanticKeyV1,
  compareTbTemporalFindingV1,
  evaluateTbComparisonCompatibilityV1,
  matchTbTemporalFindingsV1,
  type TbRunScopeV1,
  type TbTemporalFindingV1
} from "./tb-temporal-v1";

function scope(overrides: Partial<TbRunScopeV1> = {}): TbRunScopeV1 {
  return {
    contract_version: "tb-temporal-v1",
    workspace_subject_key: "brand:1",
    corpus_id: "corpus-1",
    corpus_revision: 2,
    snapshot_id: "snapshot-current",
    snapshot_digest: "sha256:current",
    snapshot_mention_count: 100,
    period_start: "2026-02-01",
    period_end: "2026-02-28",
    methodology_slug: "triggers-barriers",
    methodology_version: "1.0",
    pipeline_version: "pipeline-1",
    prompt_version: "prompt-1",
    model_version: "model-1",
    ...overrides
  };
}

function finding(overrides: Partial<TbTemporalFindingV1> = {}): TbTemporalFindingV1 {
  return {
    id: "finding-1",
    semantic_key: "barrier-personal-costo-oculto",
    title: "Costo oculto",
    polarity: "barrier",
    layer: "personal",
    frequency: 20,
    denominator: 100,
    intensity: 3,
    predictive_capacity: 0.6,
    evidence_count: 10,
    ...overrides
  };
}

test("comparison requires identical analytical versions and ordered distinct periods", () => {
  const previous = scope({
    snapshot_id: "snapshot-previous",
    snapshot_digest: "sha256:previous",
    period_start: "2026-01-01",
    period_end: "2026-01-31"
  });
  assert.equal(evaluateTbComparisonCompatibilityV1(scope(), previous).compatible, true);
  const incompatible = evaluateTbComparisonCompatibilityV1(scope(), {
    ...previous,
    model_version: "model-2",
    period_end: "2026-02-15"
  });
  assert.equal(incompatible.compatible, false);
  assert.deepEqual(incompatible.reasons, ["incompatible_model", "incompatible_non_overlapping_periods"]);
});

test("semantic identity is stable for accents, tag order and punctuation", () => {
  const a = buildTbTemporalSemanticKeyV1({
    polarity: "barrier",
    layer: "personal",
    title: "Costo oculto",
    member_tags: ["Comisión", "Letra chica"]
  });
  const b = buildTbTemporalSemanticKeyV1({
    polarity: "barrier",
    layer: "personal",
    title: "Costo oculto!",
    member_tags: ["letra chica", "COMISION"]
  });
  assert.equal(a, b);
});

test("movement uses normalized share and never raw frequency alone", () => {
  const growing = compareTbTemporalFindingV1({
    current: finding({ frequency: 30, denominator: 120 }),
    previous: finding({ id: "previous", frequency: 10, denominator: 100 })
  });
  assert.equal(growing.movement, "growing");
  const persistent = compareTbTemporalFindingV1({
    current: finding({ frequency: 24, denominator: 120 }),
    previous: finding({ id: "previous", frequency: 20, denominator: 100 })
  });
  assert.equal(persistent.movement, "persistent");
});

test("matching emits emerging, mutated and disappeared deterministically", () => {
  const matches = matchTbTemporalFindingsV1(
    [
      finding({
        id: "current-mutated",
        semantic_key: "barrier-personal-costo-oculto-comision",
        title: "Costo oculto por comisión"
      }),
      finding({
        id: "current-new",
        semantic_key: "trigger-social-recomendacion",
        title: "Recomendación",
        polarity: "trigger",
        layer: "social"
      })
    ],
    [
      finding({
        id: "previous-mutated",
        semantic_key: "barrier-personal-costo-oculto",
        title: "Costo oculto"
      }),
      finding({
        id: "previous-gone",
        semantic_key: "barrier-cultural-desconfianza",
        title: "Desconfianza",
        layer: "cultural"
      })
    ]
  );
  const movements = matches.map((match) =>
    compareTbTemporalFindingV1(match).movement
  ).sort();
  assert.deepEqual(movements, ["disappeared", "emerging", "mutated"]);
});
