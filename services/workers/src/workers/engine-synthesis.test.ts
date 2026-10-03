import assert from "node:assert/strict";
import test from "node:test";

import type { EngineSignalFindingInput } from "@noisia/query-engine";
import {
  applyEngineEditorialSynthesis,
  buildEngineSynthesisPayload,
  engineEditorialSynthesisRequiredError,
  isDeterministicEngineSynthesisAllowed,
  parseEngineEditorialSynthesisResponse
} from "./engine-synthesis";

test("engine synthesis persists method-specific blocks for every active lens", () => {
  const cases = [
    {
      slug: "narrative-ownership",
      kind: "narrative_ownership",
      chart: "stacked_share",
      dimensions: { narrative: "red sin letra chica", valence: "positiva", entity_share_pct: 64 }
    },
    {
      slug: "value-perception-matrix",
      kind: "value_perception_matrix",
      chart: "heatmap",
      dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "high", value_score: 82 }
    },
    {
      slug: "journey-friction-mapping",
      kind: "journey_friction_mapping",
      chart: "waterfall",
      dimensions: { journey_phase: "portabilidad", friction_type: "effort", polarity: "blocker", choke_score: 120, quick_win_candidate: true }
    },
    {
      slug: "sentiment-advocacy-proxy",
      kind: "sentiment_advocacy_proxy",
      chart: "diverging_bar",
      dimensions: { theme: "soporte", advocacy_class: "detractor", advocacy_proxy: -35, pct_promoter: 15, pct_passive: 35, pct_detractor: 50, is_survey_nps: false }
    },
    {
      slug: "trust-risk-benchmark",
      kind: "trust_risk_benchmark",
      chart: "gauge",
      dimensions: { trust_driver: "transparencia", risk_theme: "cargos ocultos", severity: "high", escalating: "yes", trust_score: 62, risk_score: 88, sensitive_risk_requires_evidence: true }
    }
  ] as const;

  for (const item of cases) {
    const result = buildEngineSynthesisPayload({
      analysis: {
        methodology_slug: item.slug,
        methodology_version: "1.0",
        limitations: ["fixture QA"]
      },
      summary: {
        findings: 1,
        high_confidence: 0,
        medium_confidence: 1,
        directional_confidence: 0
      },
      findings: [findingFor(item.slug, item.dimensions)]
    });

    assert.equal(result.synthesis.methodology_slug, item.slug);
    assert.equal(result.synthesis.engine_block_ready, true);
    assert.equal(result.engine_block.kind, item.kind);
    assert.equal(result.engine_block.methodology_slug, item.slug);
    assert.equal(result.engine_block.charts.some((chart) => chart.type === item.chart), true, `${item.slug} should include ${item.chart}`);
    assert.equal(result.engine_block.charts.some((chart) => chart.type === "confidence_badge"), true, `${item.slug} should include confidence badge`);
    assert.equal(result.engine_block.findings[0]?.finding_id, `${item.slug}-signal`);
    assert.equal(result.engine_block.evidence_index[0]?.mention_ids.length, 3);
    assert.equal(result.result_summary.charts, result.engine_block.charts.length);
    assert.equal(result.result_summary.conclusions, result.engine_block.methodology_view.conclusions.length);
    assert.equal(typeof result.result_summary.readiness, "string");
  }
});

test("engine synthesis keeps empty runs explicit and non-publishable", () => {
  const result = buildEngineSynthesisPayload({
    analysis: {
      methodology_slug: "narrative-ownership",
      methodology_version: "1.0",
      limitations: []
    },
    summary: {
      findings: 0,
      high_confidence: 0,
      medium_confidence: 0,
      directional_confidence: 0
    },
    findings: []
  });

  assert.equal(result.synthesis.engine_block_ready, false);
  assert.match(result.synthesis.headline, /Sin findings metodologicos suficientes/);
  assert.equal(result.engine_block.findings.length, 0);
  assert.equal(result.result_summary.readiness, "insufficient_evidence");
});

test("engine editorial synthesis can improve language without losing evidence IDs", () => {
  const result = buildEngineSynthesisPayload({
    analysis: {
      methodology_slug: "value-perception-matrix",
      methodology_version: "1.0",
      limitations: []
    },
    summary: {
      findings: 1,
      high_confidence: 0,
      medium_confidence: 1,
      directional_confidence: 0
    },
    findings: [findingFor("value-perception-matrix", {
      value_benefit: "funcional",
      value_cost: "monetario",
      perceived_value: "low",
      value_score: 52
    })]
  });

  const editorial = parseEngineEditorialSynthesisResponse(JSON.stringify({
    summary: "La conversacion no habla de valor abstracto: compara rendimiento contra precio y explicita el miedo a pagar mas por poco cambio.",
    finding_titles: [
      {
        finding_id: "value-perception-matrix-signal",
        title: "Pagar mas solo se justifica si el rendimiento se nota",
        reader_takeaway: "El costo monetario bloquea cuando el beneficio funcional no se puede comprobar.",
        confidence_note: "Direccional por volumen bajo, pero con cita clara."
      }
    ],
    conclusions: [
      {
        kind: "watch",
        title: "Vigilar la prueba de rendimiento",
        detail: "El modulo debe pedir evidencia de rendimiento antes de prometer valor.",
        finding_ids: ["value-perception-matrix-signal"]
      }
    ],
    limitations: ["Solo usar como lectura direccional hasta ampliar competidores."]
  }));

  const block = applyEngineEditorialSynthesis(result.engine_block, editorial);
  assert.equal(block.summary, editorial.summary);
  assert.equal(block.findings[0]?.finding_id, "value-perception-matrix-signal");
  assert.equal(block.findings[0]?.title, "Pagar mas solo se justifica si el rendimiento se nota");
  assert.deepEqual(block.evidence_index[0]?.mention_ids, ["mention-1", "mention-2", "mention-3"]);
  assert.equal(block.methodology_view.conclusions[0]?.kind, "watch");
  assert.equal(block.limitations.includes("Solo usar como lectura direccional hasta ampliar competidores."), true);
});

test("engine synthesis deterministic fallback is opt-in for QA only", () => {
  assert.equal(isDeterministicEngineSynthesisAllowed({}), false);
  assert.equal(isDeterministicEngineSynthesisAllowed({ ENGINE_ALLOW_DETERMINISTIC_SYNTHESIS: "false" }), false);
  assert.equal(isDeterministicEngineSynthesisAllowed({ ENGINE_ALLOW_DETERMINISTIC_SYNTHESIS: "true" }), true);
  assert.match(
    engineEditorialSynthesisRequiredError("engine_llm_disabled"),
    /requires Claude/
  );
});

function findingFor(slug: string, dimensions: Record<string, unknown>): EngineSignalFindingInput {
  return {
    id: `${slug}-1`,
    findingKey: `${slug}-signal`,
    name: "Senal prioritaria",
    dimensions,
    frequency: 24,
    intensity: 4,
    sentiment: 0.4,
    sharePct: 64,
    compositeScore: 0.82,
    ownership: "brand_owned",
    confidence: "media",
    evidenceCount: 3,
    mentionIds: ["mention-1", "mention-2", "mention-3"],
    quote: "La evidencia conecta la senal con lenguaje real."
  };
}
