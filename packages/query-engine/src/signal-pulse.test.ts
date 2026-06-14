import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSignalPulseKnowledgeContext,
  buildMonthlyReportPeriods,
  buildWeeklyReportPeriods,
  calculateImpactV1,
  classifySignalPulseLifecycle,
  countSignalPulseMarketingBriefSignals
} from "./signal-pulse";

test("Signal Pulse periodization creates comparable monthly buckets", () => {
  assert.deepEqual(buildMonthlyReportPeriods({ windowEnd: "2026-06-12", months: 3 }), [
    { periodStart: "2026-04-01", periodEnd: "2026-04-30", label: "2026-04" },
    { periodStart: "2026-05-01", periodEnd: "2026-05-31", label: "2026-05" },
    { periodStart: "2026-06-01", periodEnd: "2026-06-30", label: "2026-06" }
  ]);
});

test("Signal Pulse periodization creates ISO weekly buckets around the data window", () => {
  assert.deepEqual(buildWeeklyReportPeriods({ windowEnd: "2026-06-12", weeks: 3 }), [
    { periodStart: "2026-05-25", periodEnd: "2026-05-31", label: "2026-W22" },
    { periodStart: "2026-06-01", periodEnd: "2026-06-07", label: "2026-W23" },
    { periodStart: "2026-06-08", periodEnd: "2026-06-14", label: "2026-W24" }
  ]);
});

test("impact_v1 uses the closed weighted formula and clamps inputs", () => {
  assert.equal(calculateImpactV1({
    volumeNorm: 1,
    engagementNorm: 0.5,
    recency: 0.25,
    sourceDiversity: 2,
    temporalConsistency: -1
  }), 66.25);
});

test("Signal Pulse lifecycle classifies basic monthly movement", () => {
  assert.equal(classifySignalPulseLifecycle({ currentVolume: 20, previousVolume: 0, periodsSeen: 1 }), "new");
  assert.equal(classifySignalPulseLifecycle({ currentVolume: 18, previousVolume: 0, periodsSeen: 3 }), "reappeared");
  assert.equal(classifySignalPulseLifecycle({ currentVolume: 30, previousVolume: 10, periodsSeen: 4 }), "accelerating");
  assert.equal(classifySignalPulseLifecycle({ currentVolume: 4, previousVolume: 12, periodsSeen: 5 }), "declining");
  assert.equal(classifySignalPulseLifecycle({ currentVolume: 10, previousVolume: 11, periodsSeen: 5, volatility: 0.9 }), "volatile");
});

test("Signal Pulse knowledge context is ready when processed knowledge base exists", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: { marketing_brief: { objective: "Defender presupuesto de pauta" } },
    knowledgeSources: 3
  });

  assert.equal(assessment.knowledgeContextReady, true);
  assert.equal(assessment.knowledgeSources, 3);
  assert.equal(assessment.marketingBriefSignals, 1);
  assert.deepEqual(assessment.reasons, []);
});

test("Signal Pulse knowledge context accepts a complete marketing brief without knowledge sources", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: {
      business_question: "Entender qué señales activó la campaña de renovación en seguros de auto.",
      marketing_brief: {
        objective: "Defender la inversión mensual de pauta con aprendizajes accionables.",
        active_campaigns: ["Renovación 2026 en Facebook y TikTok"],
        allowed_claims: "Cercanía, servicio personalizado y claridad al contratar."
      }
    },
    knowledgeSources: 0
  });

  assert.equal(assessment.knowledgeContextReady, true);
  assert.equal(assessment.marketingBriefSignals, 4);
});

test("Signal Pulse knowledge context blocks objective-only briefs", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: { marketing_brief: { objective: "Defender presupuesto de pauta" } },
    knowledgeSources: 0
  });

  assert.equal(assessment.knowledgeContextReady, false);
  assert.equal(assessment.marketingBriefSignals, 1);
  assert.deepEqual(assessment.reasons, ["missing_knowledge_context"]);
});

test("Signal Pulse brief signal count ignores placeholders and budget-only fields", () => {
  assert.equal(
    countSignalPulseMarketingBriefSignals({
      analysisPlan: {
        budget_cap_usd: 20,
        marketing_brief: {
          objective: "Prueba",
          target_window_months: 12,
          active_campaigns: [],
          prohibited_claims: "No prometer ahorro garantizado."
        }
      },
      requestParams: {
        marketing_brief: {
          key_dates: "Caída de engagement en marzo 2026 después de campaña de renovación."
        }
      }
    }),
    2
  );
});
