import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSignalPulseKnowledgeContext,
  buildMonthlyReportPeriods,
  buildWeeklyReportPeriods,
  calculateImpactV1,
  classifySignalPulseLifecycle,
  collectSignalPulseMarketingBriefCategories,
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
  assert.deepEqual(assessment.marketingBriefCategories, ["business_objective"]);
  assert.deepEqual(assessment.reasons, []);
});

test("Signal Pulse knowledge context accepts a complete marketing brief without knowledge sources", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: {
      business_question: "Entender qué señales activó la campaña de renovación en seguros de auto.",
      marketing_brief: {
        objective: "Defender la inversión mensual de pauta con aprendizajes accionables.",
        brand_context: "Aseguradora regional que compite por cercanía, claridad y confianza frente a jugadores nacionales.",
        active_campaigns: ["Renovación 2026 en Facebook y TikTok"],
        allowed_claims: "Cercanía, servicio personalizado y claridad al contratar.",
        target_audience: "Conductores que comparan cobertura, precio y velocidad de respuesta antes de renovar."
      }
    },
    knowledgeSources: 0
  });

  assert.equal(assessment.knowledgeContextReady, true);
  assert.equal(assessment.marketingBriefSignals, 6);
  assert.deepEqual(assessment.marketingBriefCategories, [
    "audience_calendar_results",
    "brand_market_context",
    "business_objective",
    "marketing_activity"
  ]);
  assert.deepEqual(assessment.reasons, []);
});

test("Signal Pulse knowledge context blocks objective-only briefs", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: { marketing_brief: { objective: "Defender presupuesto de pauta" } },
    knowledgeSources: 0
  });

  assert.equal(assessment.knowledgeContextReady, false);
  assert.equal(assessment.marketingBriefSignals, 1);
  assert.deepEqual(assessment.marketingBriefCategories, ["business_objective"]);
  assert.deepEqual(assessment.reasons, [
    "missing_knowledge_context",
    "missing_marketing_brief_depth",
    "missing_marketing_brief_categories"
  ]);
});

test("Signal Pulse knowledge context requires diverse brief categories without knowledge sources", () => {
  const assessment = assessSignalPulseKnowledgeContext({
    analysisPlan: {
      marketing_brief: {
        active_campaigns: ["Always-on seguros auto"],
        allowed_claims: "Cercanía y rapidez",
        prohibited_claims: "No prometer ahorro garantizado",
        paid_activity: "Pauta activa en Meta y TikTok con objetivo de tráfico."
      }
    },
    knowledgeSources: 0
  });

  assert.equal(assessment.knowledgeContextReady, false);
  assert.equal(assessment.marketingBriefSignals, 4);
  assert.deepEqual(assessment.marketingBriefCategories, ["marketing_activity"]);
  assert.deepEqual(assessment.reasons, [
    "missing_knowledge_context",
    "missing_marketing_brief_categories"
  ]);
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
  assert.deepEqual(
    collectSignalPulseMarketingBriefCategories({
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
    ["audience_calendar_results", "marketing_activity"]
  );
});
