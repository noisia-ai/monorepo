import assert from "node:assert/strict";
import test from "node:test";

import { alignPulsePerformancePeriods, buildOrganicPaidCandidates, summarizePulsePerformance } from "./performance-summary";

test("summarizePulsePerformance calculates totals and paid efficiency from structured rows", () => {
  const summary = summarizePulsePerformance({
    periods: [
      { label: "2026-01", coverage: { conversation: 120 } },
      { label: "2026-02", coverage: { conversation: 80 } }
    ],
    performancePeriods: [
      { label: "2026-01", spend: 100, impressions: 10000, clicks: 250, engagement: 600, conversions: 12, records: 4 },
      { label: "2026-02", spend: 50, impressions: 5000, clicks: 50, engagement: 150, conversions: 3, records: 2 }
    ]
  });

  assert.equal(summary.totals.conversation, 200);
  assert.equal(summary.totals.spend, 150);
  assert.equal(summary.totals.impressions, 15000);
  assert.equal(summary.efficiency.ctr, 0.02);
  assert.equal(summary.efficiency.cpm, 10);
  assert.equal(summary.efficiency.cpc, 0.5);
  assert.equal(summary.efficiency.costPerConversation, 0.75);
  assert.equal(summary.coverage.periodsWithPerformance, 2);
  assert.deepEqual(summary.alerts, []);
});

test("summarizePulsePerformance surfaces coverage gaps without inventing interpretation", () => {
  const summary = summarizePulsePerformance({
    periods: [
      { label: "2026-01", coverage: { conversation: 0 } },
      { label: "2026-02", coverage: { conversation: 72 } },
      { label: "2026-03", coverage: { conversation: 33 } }
    ],
    performancePeriods: [
      { label: "2026-01", spend: 80, impressions: 4000, clicks: 20, records: 2 },
      { label: "2026-03", spend: 0, impressions: 0, clicks: 0, records: 0 }
    ]
  });

  assert.equal(summary.coverage.spendWithoutConversation, 1);
  assert.equal(summary.coverage.conversationWithoutSpend, 2);
  assert.match(summary.read, /inversión pero sin conversación/);
  assert.match(summary.alerts.join(" "), /spend sin conversación/);
  assert.match(summary.alerts.join(" "), /conversación sin spend/);
});

test("summarizePulsePerformance matches performance rows by report period id", () => {
  const summary = summarizePulsePerformance({
    periods: [
      { id: "rp_1", label: "2026-01", coverage: { conversation: 20 } },
      { id: "rp_2", label: "2026-02", coverage: { conversation: 30 } }
    ],
    performancePeriods: [
      { period_id: "rp_2", spend: 90, impressions: 9000, clicks: 180, records: 3 }
    ]
  });

  assert.equal(summary.totals.spend, 90);
  assert.equal(summary.totals.impressions, 9000);
  assert.equal(summary.coverage.conversationWithoutSpend, 1);
  assert.equal(summary.coverage.periodsWithPerformance, 1);
});

test("alignPulsePerformancePeriods matches the visible rows by id or label", () => {
  const rows = alignPulsePerformancePeriods({
    periods: [
      { id: "rp_1", label: "2026-01", coverage: { conversation: 10 } },
      { id: "rp_2", label: "2026-02", coverage: { conversation: 20 } },
      { id: "rp_3", label: "2026-03", coverage: { conversation: 30 } }
    ],
    performancePeriods: [
      { label: "2026-01", spend: 10, impressions: 1000 },
      { period_id: "rp_2", label: "wrong-label", spend: 20, impressions: 2000 }
    ]
  });

  assert.equal(rows[0]?.performance.spend, 10);
  assert.equal(rows[1]?.performance.spend, 20);
  assert.deepEqual(rows[2]?.performance, {});
});

test("buildOrganicPaidCandidates ranks organic signals for bounded paid tests", () => {
  const candidates = buildOrganicPaidCandidates({
    signals: [
      { id: "s_low", title: "Cupón genérico", volume: 4, impact_v1: 3, confidence: "baja" },
      { id: "s_1", title: "Rutina de hidratación en clima seco", volume: 180, impact_v1: 72, confidence: "media", lifecycle_state: "accelerating" },
      { id: "s_2", title: "Entrega lenta", volume: 90, impact_v1: 50, confidence: "alta", polarity_bucket: "negative", signal_type: "risk" }
    ],
    campaigns: [],
    limit: 2
  });

  assert.equal(candidates[0]?.signalId, "s_1");
  assert.match(candidates[0]?.rationale ?? "", /tracción orgánica/);
  assert.match(candidates[0]?.suggestedTest ?? "", /claim corto/);
  assert.equal(candidates.length, 2);
});

test("buildOrganicPaidCandidates surfaces nearby campaign coverage without inventing metrics", () => {
  const candidates = buildOrganicPaidCandidates({
    signals: [
      { id: "s_1", title: "Protector solar mineral", description: "Textura ligera para piel sensible", volume: 220, impact_v1: 80, confidence: "alta" }
    ],
    campaigns: [
      { entity_name: "Campaña protector mineral", creative_text: "Protector solar ligero para piel sensible", platform: "Meta" }
    ]
  });

  assert.deepEqual(candidates[0]?.matchedCampaigns, ["Campaña protector mineral"]);
  assert.match(candidates[0]?.rationale ?? "", /variante antes de escalar/);
  assert.equal(Object.prototype.hasOwnProperty.call(candidates[0] ?? {}, "score"), false);
});
