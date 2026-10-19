import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoryTimeline, classifyHistoryTrend, groupHistorySignals, type HistoryRow } from "./history";

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    canonical_signal_id: "signal-trigger",
    canonical_title: "Datos que sí alcanzan",
    signal_type: "trigger",
    signal_status: "active",
    first_seen_at: "2026-05-01",
    last_seen_at: "2026-06-30",
    observation_id: "observation-1",
    window_start: "2026-05-01",
    window_end: "2026-05-31",
    frequency: 12,
    intensity: "0.7",
    sentiment: "0.2",
    composite_score: "0.8",
    confidence: "media",
    rank: 1,
    delta_vs_previous: "3",
    evidence_count: 4,
    evidence_quote: "La promesa de datos sí alcanza para todo el mes.",
    ...overrides
  };
}

test("history groups signal observations and normalizes numeric values", () => {
  const signals = groupHistorySignals([
    row({ observation_id: "may", frequency: 12 }),
    row({ observation_id: "jun", window_start: "2026-06-01", window_end: "2026-06-30", frequency: 18, delta_vs_previous: "6" }),
    row({
      canonical_signal_id: "signal-barrier",
      canonical_title: "Contrato que amarra",
      signal_type: "barrier",
      observation_id: "barrier-jun",
      window_start: "2026-06-01",
      window_end: "2026-06-30",
      frequency: 21,
      delta_vs_previous: "-2"
    })
  ]);

  assert.deepEqual(signals.map((signal) => signal.id), ["signal-barrier", "signal-trigger"]);
  assert.equal(signals.find((signal) => signal.id === "signal-trigger")?.observations.length, 2);
  assert.equal(signals.find((signal) => signal.id === "signal-trigger")?.trend_status, "rising");
  assert.equal(signals.find((signal) => signal.id === "signal-barrier")?.trend_status, "emerging");
  assert.equal(signals.find((signal) => signal.id === "signal-trigger")?.observations[0]?.intensity, 0.7);
  assert.equal(signals.find((signal) => signal.id === "signal-trigger")?.observations[1]?.delta_vs_previous, 6);
  assert.equal(signals.find((signal) => signal.id === "signal-trigger")?.observations[0]?.evidence_quote, "La promesa de datos sí alcanza para todo el mes.");
});

test("history classifies monthly signal trends deterministically", () => {
  assert.equal(classifyHistoryTrend([]), "dormant");
  assert.equal(classifyHistoryTrend([{ frequency: 4, delta_vs_previous: null }]), "emerging");
  assert.equal(classifyHistoryTrend([{ frequency: 4, delta_vs_previous: null }, { frequency: 0, delta_vs_previous: -4 }]), "dormant");
  assert.equal(classifyHistoryTrend([{ frequency: 8, delta_vs_previous: null }, { frequency: 3, delta_vs_previous: -5 }]), "fading");
  assert.equal(classifyHistoryTrend([{ frequency: 3, delta_vs_previous: null }, { frequency: 8, delta_vs_previous: 5 }]), "rising");
  assert.equal(classifyHistoryTrend([
    { frequency: 3, delta_vs_previous: null },
    { frequency: 3, delta_vs_previous: 0 },
    { frequency: 3, delta_vs_previous: 0 }
  ]), "recurring");
});

test("history timeline aggregates triggers, barriers and evidence by month", () => {
  const timeline = buildHistoryTimeline(groupHistorySignals([
    row({ observation_id: "may", frequency: 12, evidence_count: 4 }),
    row({ observation_id: "jun-trigger", window_start: "2026-06-01", window_end: "2026-06-30", frequency: 18, evidence_count: 5 }),
    row({
      canonical_signal_id: "signal-barrier",
      canonical_title: "Contrato que amarra",
      signal_type: "barrier",
      observation_id: "jun-barrier",
      window_start: "2026-06-01",
      window_end: "2026-06-30",
      frequency: 21,
      evidence_count: 8
    })
  ]));

  assert.deepEqual(timeline, [
    { period: "2026-05", triggers: 12, barriers: 0, signals: 1, evidence: 4 },
    { period: "2026-06", triggers: 18, barriers: 21, signals: 2, evidence: 13 }
  ]);
});
