import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPulseApiContext,
  buildPulseChartResponse,
  buildPulseMovesResponse,
  buildPulseOverviewResponse,
  buildPulseSignalsResponse,
  isSignalPulseOutput,
  type PulseOutputLike
} from "./pulse-api";

const output: PulseOutputLike = {
  id: "out_sp",
  title: "Aurora Signal Pulse",
  headline: "Headline",
  summary: "Summary",
  methodologySlug: "signal-pulse",
  kind: "signal_pulse",
  brandName: "Aurora",
  brandFallbackName: "Aurora",
  themeName: null,
  visibilityConfig: {},
  payload: {
    report: {
      title: "Aurora",
      business_question: "Qué activar este mes",
      generated_from_engine_analysis_id: "ea_1"
    },
    executive_read: {
      headline: "La rutina crujiente acelera.",
      body: "La señal tiene evidencia suficiente.",
      action: "Probar un hook de rutina."
    },
    periods: [
      { id: "rp_1", label: "2026-05", comparable: true, confidence: "media", coverage: { conversation: 100 } },
      { id: "rp_2", label: "2026-06", comparable: true, confidence: "alta", coverage: { conversation: 140 } }
    ],
    signals: [
      {
        id: "s_1",
        title: "Rutina crujiente",
        signal_type: "opportunity",
        lifecycle_state: "new",
        impact_v1: "82",
        volume: 140,
        delta_prev: "12",
        polarity_bucket: "positiva",
        dominant_emotion: "afinidad",
        confidence: "alta",
        evidence_count: 2
      },
      {
        id: "s_2",
        title: "Precio se siente alto",
        signal_type: "risk",
        lifecycle_state: "accelerating",
        impact_v1: "61",
        volume: 70,
        confidence: "media",
        evidence_count: 1
      }
    ],
    marketing_moves: [
      {
        id: "m_1",
        move_type: "test_claim",
        action_text: "Probar claim de rutina crujiente.",
        signal_refs: ["s_1"],
        owner_suggestion: "Brand",
        timing: "this_month",
        measurement_suggestion: "CTR",
        confidence: "alta",
        status: "candidate"
      }
    ],
    evidence: [
      { evidence_id: "e_1", signal_id: "s_1", quote: "Lo compro para la tarde.", evidence_role: "protagonist" },
      { evidence_id: "e_2", signal_id: "s_1", quote: "Me gusta lo crujiente.", evidence_role: "support" }
    ],
    chart_refs: {
      impact_polarity_map: { rows: [{ signal_id: "s_1", impact: 82 }] },
      signal_momentum_stream: { rows: [{ signal_id: "s_1", label: "2026-06", volume: 140 }] }
    },
    quality_gates: [
      { id: "period_coverage", passed: true, detail: "2 periodos." },
      { id: "humanizer_passed", passed: false, detail: "Revisar copy." }
    ],
    cost: { estimated_cost_usd: 0.22, budget_cap_usd: 5 },
    limitations: ["Performance parcial."]
  }
};

test("Pulse API recognizes only published Signal Pulse outputs", () => {
  assert.equal(isSignalPulseOutput(output), true);
  assert.equal(isSignalPulseOutput({ ...output, kind: "signal" }), false);
  assert.equal(isSignalPulseOutput({ ...output, methodologySlug: "triggers-barriers" }), false);
});

test("Pulse overview returns tactical KPIs, chart refs and visible warnings", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const overview = buildPulseOverviewResponse({ output, ...context });

  assert.equal(overview.brand_name, "Aurora");
  assert.equal(overview.active_period, "rp_2");
  assert.equal(overview.kpis.signals_active, 2);
  assert.equal(overview.kpis.new_this_period, 1);
  assert.equal(overview.kpis.risks, 1);
  assert.deepEqual(overview.charts, {
    impact_polarity_map: "impact_polarity_map",
    signal_momentum_stream: "signal_momentum_stream"
  });
  assert.equal(overview.top_signals[0]?.impact_v1, 82);
  assert.match(overview.warnings.join(" "), /Performance parcial/);
});

test("Pulse signals respect evidence visibility for clients", () => {
  const context = buildPulseApiContext({
    output: { ...output, visibilityConfig: { evidence: false } },
    isInternalUser: false
  });
  const signals = buildPulseSignalsResponse({ ...context });
  const detail = buildPulseSignalsResponse({ ...context, signalId: "s_1" });

  assert.ok(signals && "signals" in signals);
  assert.ok(detail && "signal" in detail);
  const signalList = signals as { count: number; signals: Array<Record<string, unknown>> };
  const firstSignal = signalList.signals[0] as Record<string, unknown>;
  const detailSignal = detail.signal as Record<string, unknown>;
  assert.equal(signalList.count, 2);
  assert.equal((firstSignal.evidence as unknown[]).length, 0);
  assert.equal((detailSignal.evidence as unknown[]).length, 0);
  assert.equal(buildPulseSignalsResponse({ ...context, signalId: "missing" }), null);
});

test("Pulse signals expose evidence internally and moves group by status", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const detail = buildPulseSignalsResponse({ ...context, signalId: "s_1" });
  const moves = buildPulseMovesResponse(context);

  assert.ok(detail && "signal" in detail);
  const detailSignal = detail.signal as Record<string, unknown>;
  assert.equal((detailSignal.evidence as unknown[]).length, 2);
  assert.equal((detailSignal.moves as unknown[]).length, 1);
  assert.equal(moves.count, 1);
  assert.equal(moves.board.candidate?.length, 1);
  assert.equal(((moves.moves[0] as Record<string, unknown>).evidence as unknown[]).length, 2);
});

test("Pulse chart endpoint resolves aliases without exposing raw performance", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const chart = buildPulseChartResponse({ payload: context.payload, dataRef: "impact_polarity" });

  assert.equal(chart?.chart_key, "impact_polarity_map");
  assert.deepEqual(chart?.payload, { rows: [{ signal_id: "s_1", impact: 82 }] });
  assert.equal(buildPulseChartResponse({ payload: context.payload, dataRef: "nope" }), null);
});
