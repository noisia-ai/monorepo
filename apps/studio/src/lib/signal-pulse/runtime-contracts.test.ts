import assert from "node:assert/strict";
import test from "node:test";

import type { EngineMethodologyOption } from "@/lib/engine/methodology-options";
import {
  SIGNAL_PULSE_RUNTIME_OPTION,
  buildSignalPulseStoredVisibilityConfig,
  buildSignalPulseLaunchChecklist,
  buildSignalPulseLaunchPlan,
  buildSignalPulseRunParams,
  buildRuntimeMethodologyOptions,
  enginePublishedOutputTypeForMethodology,
  resolveSignalPulseVisibility,
  shouldLoadSelectedLensState
} from "./runtime-contracts";

const pausedEngineOptions: EngineMethodologyOption[] = [
  {
    slug: "narrative-ownership",
    label: "#12 Narrative Ownership",
    shortLabel: "Narrative Ownership",
    priority: "#12",
    runtimeKind: "engine",
    seeded: true,
    status: "beta",
    version: "0.1",
    runnable: true
  },
  {
    slug: "competitive-wave",
    label: "#02 Competitive Wave",
    shortLabel: "Competitive Wave",
    priority: "#02",
    runtimeKind: "engine",
    seeded: true,
    status: "beta",
    version: "0.1",
    runnable: true
  }
];

test("Signal Pulse runtime exposes only the Signal Pulse action", () => {
  const options = buildRuntimeMethodologyOptions({
    primaryMethodologySlug: "signal-pulse",
    baseOptions: pausedEngineOptions
  });

  assert.deepEqual(options.map((option) => option.slug), ["signal-pulse"]);
  assert.deepEqual(options[0], SIGNAL_PULSE_RUNTIME_OPTION);
});

test("non Signal Pulse runtime keeps the existing engine options", () => {
  const options = buildRuntimeMethodologyOptions({
    primaryMethodologySlug: "narrative-ownership",
    baseOptions: pausedEngineOptions
  });

  assert.equal(options, pausedEngineOptions);
});

test("Signal Pulse skips selected-lens runtime state", () => {
  assert.equal(shouldLoadSelectedLensState("signal-pulse"), false);
  assert.equal(shouldLoadSelectedLensState("competitive-wave"), true);
  assert.equal(shouldLoadSelectedLensState(null), true);
});

test("Signal Pulse reads and writes its dedicated published output type", () => {
  assert.equal(enginePublishedOutputTypeForMethodology("signal-pulse"), "signal_pulse_dashboard");
  assert.equal(enginePublishedOutputTypeForMethodology("narrative-ownership"), "narrative_dashboard");
});

test("Signal Pulse visibility closes paid data by default for clients", () => {
  const stored = buildSignalPulseStoredVisibilityConfig();

  assert.deepEqual(stored, {
    client_default: true,
    paid_data: false,
    competitive: true,
    evidence: true,
    corpus_view: "limited",
    sources: false,
    composer: false,
    quality: false,
    raw_metadata: false
  });

  const client = resolveSignalPulseVisibility({ config: stored, isInternalUser: false });
  assert.equal(client.showPaidOrganic, false);
  assert.equal(client.showCompetitive, true);
  assert.equal(client.showEvidence, true);
  assert.equal(client.showSources, false);
  assert.equal(client.showQuality, false);

  const internal = resolveSignalPulseVisibility({ config: stored, isInternalUser: true });
  assert.equal(internal.showPaidOrganic, true);
  assert.equal(internal.showSources, true);
  assert.equal(internal.showQuality, true);
});

test("Signal Pulse visibility allows explicit paid client permission", () => {
  const client = resolveSignalPulseVisibility({
    config: { paid_data: true, corpus_view: "full", sources: true },
    isInternalUser: false
  });

  assert.equal(client.showPaidOrganic, true);
  assert.equal(client.showCorpus, true);
  assert.equal(client.showSources, true);
  assert.equal(client.showComposer, false);
});

test("Signal Pulse launch plan exposes pre-run cost, budget cap and structured coverage", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: { budget_cap_usd: 7.5 },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1300,
      signalPulseMentions: 820,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 1300,
      semanticKnowledgeEmbeddings: 24,
      knowledgeSources: 4
    }
  });

  assert.equal(plan.budgetCapUsd, 7.5);
  assert.equal(plan.estimatedCostUsd, 0.335);
  assert.equal(plan.clusterFirst, true);
  assert.equal(plan.windowMonths, 12);
  assert.equal(plan.status, "ready");
  assert.equal(plan.coverage.performanceRecords, 144);
  assert.equal(plan.coverage.semanticMentionEmbeddings, 1300);
  assert.equal(plan.coverage.semanticKnowledgeEmbeddings, 24);
  assert.equal(plan.coverage.marketingBriefSignals, 0);
  assert.deepEqual(plan.warnings, []);

  const checklist = buildSignalPulseLaunchChecklist(plan);
  assert.deepEqual(checklist.map((item) => item.passed), [true, true, true, true, true]);
  assert.equal(checklist.find((item) => item.id === "knowledge")?.value, "4 fuentes · 0 señales de brief");
  assert.equal(checklist.find((item) => item.id === "performance")?.value, "144 registros");
  assert.match(checklist.find((item) => item.id === "budget")?.detail ?? "", /Cluster-first/);
});

test("Signal Pulse launch plan warns before running when required coverage is missing", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: {},
    targetWindowMonths: null,
    coverage: {
      conversationMentions: 0,
      signalPulseMentions: 0,
      performanceRecords: 0,
      queryPacks: 0
    }
  });

  assert.equal(plan.budgetCapUsd, 5);
  assert.equal(plan.windowMonths, 12);
  assert.equal(plan.status, "blocked");
  assert.match(plan.warnings.join(" "), /menciones incluidas/);
  assert.match(plan.warnings.join(" "), /knowledge base procesada/);
  assert.match(plan.warnings.join(" "), /performance estructurada/);
  assert.match(plan.warnings.join(" "), /query pack Signal Pulse/);

  const checklist = buildSignalPulseLaunchChecklist(plan);
  assert.deepEqual(checklist.map((item) => item.passed), [false, false, false, false, true]);
  assert.match(checklist.find((item) => item.id === "conversation")?.detail ?? "", /Carga o aprueba menciones/);
  assert.match(checklist.find((item) => item.id === "knowledge")?.detail ?? "", /knowledge base/);
  assert.match(checklist.find((item) => item.id === "performance")?.detail ?? "", /performance_records/);
});

test("Signal Pulse launch plan allows a rich marketing brief when no knowledge source has been processed", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: {
      budget_cap_usd: 5,
      business_question: "Entender si la campaña de renovación está abriendo dudas o fricciones de contratación.",
      marketing_brief: {
        objective: "Encontrar aprendizajes accionables para el siguiente corte de pauta.",
        active_campaigns: ["Renovación seguros auto febrero 2026"],
        allowed_claims: "Cercanía, servicio claro y atención personalizada."
      }
    },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1200,
      signalPulseMentions: 900,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 1200,
      semanticKnowledgeEmbeddings: 0,
      knowledgeSources: 0
    }
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.coverage.marketingBriefSignals, 4);
  assert.deepEqual(plan.warnings, []);
  assert.equal(buildSignalPulseLaunchChecklist(plan).find((item) => item.id === "knowledge")?.passed, true);
});

test("Signal Pulse launch plan blocks sparse briefs when no knowledge source has been processed", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: {
      budget_cap_usd: 5,
      marketing_brief: { objective: "Defender presupuesto de pauta" }
    },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1200,
      signalPulseMentions: 900,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 1200,
      semanticKnowledgeEmbeddings: 0,
      knowledgeSources: 0
    }
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.coverage.marketingBriefSignals, 1);
  assert.match(plan.warnings.join(" "), /brief de marketing suficiente/);
  assert.equal(buildSignalPulseLaunchChecklist(plan).find((item) => item.id === "knowledge")?.passed, false);
});

test("Signal Pulse launch plan blocks incomplete paid organic coverage", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: { budget_cap_usd: 5 },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1200,
      signalPulseMentions: 900,
      performanceRecords: 0,
      queryPacks: 3,
      semanticMentionEmbeddings: 1200,
      semanticKnowledgeEmbeddings: 12,
      knowledgeSources: 2
    }
  });

  assert.equal(plan.status, "blocked");
  assert.match(plan.warnings.join(" "), /performance estructurada/);
});

test("Signal Pulse launch plan blocks runs before semantic RAG is ready", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: { budget_cap_usd: 5 },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1200,
      signalPulseMentions: 900,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 0,
      semanticKnowledgeEmbeddings: 0,
      knowledgeSources: 2
    }
  });

  assert.equal(plan.status, "blocked");
  assert.match(plan.warnings.join(" "), /embeddings semánticos de menciones/);
  assert.match(plan.warnings.join(" "), /knowledge base/);
});

test("Signal Pulse launch plan blocks runs that exceed the visible budget cap", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: { budget_cap_usd: 0.1 },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1300,
      signalPulseMentions: 820,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 1300,
      semanticKnowledgeEmbeddings: 24,
      knowledgeSources: 4
    }
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.estimatedCostUsd, 0.335);
  assert.match(plan.warnings.join(" "), /rebasa el tope/);

  const checklist = buildSignalPulseLaunchChecklist(plan);
  assert.equal(checklist.find((item) => item.id === "budget")?.passed, false);
});

test("Signal Pulse launch plan honors request run params before queueing", () => {
  const plan = buildSignalPulseLaunchPlan({
    analysisPlan: { budget_cap_usd: 5 },
    requestParams: { budget_cap_usd: 0.1, window_months: 6 },
    targetWindowMonths: 12,
    coverage: {
      conversationMentions: 1300,
      signalPulseMentions: 820,
      performanceRecords: 144,
      queryPacks: 3,
      semanticMentionEmbeddings: 1300,
      semanticKnowledgeEmbeddings: 24,
      knowledgeSources: 4
    }
  });

  assert.equal(plan.budgetCapUsd, 0.1);
  assert.equal(plan.windowMonths, 6);
  assert.equal(plan.status, "blocked");
  assert.match(plan.warnings.join(" "), /rebasa el tope/);
});

test("Signal Pulse run params are sanitized and match launch-plan precedence", () => {
  assert.deepEqual(
    buildSignalPulseRunParams({
      analysisPlan: { budget_cap_usd: 5 },
      requestParams: { budget_cap_usd: 7, window_months: 3 },
      targetWindowMonths: 12
    }),
    { budget_cap_usd: 7, window_months: 3, review_mode: "cluster_first" }
  );

  assert.deepEqual(
    buildSignalPulseRunParams({
      analysisPlan: { budget_cap_usd: 4 },
      requestParams: { budget_cap_usd: -1, window_months: "bad" },
      targetWindowMonths: 9
    }),
    { budget_cap_usd: 4, window_months: 9, review_mode: "cluster_first" }
  );

  assert.deepEqual(
    buildSignalPulseRunParams({
      analysisPlan: { budget_cap_usd: 4 },
      requestParams: { review_mode: "deep_read" },
      targetWindowMonths: 9
    }),
    { budget_cap_usd: 4, window_months: 9, review_mode: "cluster_first" }
  );
});
