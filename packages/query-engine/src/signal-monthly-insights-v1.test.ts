import test from "node:test";
import assert from "node:assert/strict";

import {
  SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
  SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION,
  SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
  signalMonthlyInsightCandidateHashV1,
  signalMonthlyInsightIdempotencyKeyV1,
  validateSignalMonthlyInsightJobDataV1,
  validateSignalMonthlyInsightEditorialV1
} from "./signal-monthly-insights-v1";

test("candidate hash is deterministic across object key order", () => {
  assert.equal(
    signalMonthlyInsightCandidateHashV1([{ id: "volume", metric: { current: 7, unit: "count" } }]),
    signalMonthlyInsightCandidateHashV1([{ metric: { unit: "count", current: 7 }, id: "volume" }])
  );
});

test("editorial validation preserves only known ranked candidates", () => {
  const candidateHash = signalMonthlyInsightCandidateHashV1([{ id: "volume" }, { id: "sentiment" }]);
  const result = validateSignalMonthlyInsightEditorialV1({
    contract_version: SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
    candidate_hash: candidateHash,
    summary: "La conversación requiere atención editorial.",
    items: [
      {
        candidate_id: "sentiment",
        priority: 2,
        short_title: "El tono divide la conversación",
        explanation: "Las señales favorables y críticas conviven sin una lectura dominante.",
        why_it_matters: "El equipo debe revisar qué temas empujan cada dirección.",
        confidence: "medium",
        limitations: ["La lectura depende de la cobertura clasificada."]
      },
      {
        candidate_id: "volume",
        priority: 1,
        short_title: "La conversación perdió impulso",
        explanation: "El movimiento reciente es más débil que la referencia disponible.",
        why_it_matters: "La caída puede alterar la visibilidad de los demás hallazgos.",
        confidence: "high",
        limitations: []
      }
    ]
  }, {
    candidate_hash: candidateHash,
    candidate_ids: ["volume", "sentiment"]
  });
  assert.deepEqual(result.items.map((item) => item.candidate_id), ["volume", "sentiment"]);
});

test("editorial validation rejects invented numbers in Claude copy", () => {
  const candidateHash = signalMonthlyInsightCandidateHashV1([{ id: "volume" }]);
  assert.throws(() => validateSignalMonthlyInsightEditorialV1({
    contract_version: SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
    candidate_hash: candidateHash,
    summary: "La conversación cambió.",
    items: [{
      candidate_id: "volume",
      priority: 1,
      short_title: "El volumen subió 20 por ciento",
      explanation: "Hay un cambio.",
      why_it_matters: "Requiere atención.",
      confidence: "high",
      limitations: []
    }]
  }, {
    candidate_hash: candidateHash,
    candidate_ids: ["volume"]
  }), /must stay qualitative/u);
});

test("monthly insight job validates a canonical packet within budget", () => {
  const candidate = {
    id: "volume",
    kind: "volume_momentum",
    tone: "attention" as const,
    rank: 1,
    metric: {
      current: 10,
      previous: 8,
      delta: 2,
      delta_ratio: 0.25,
      unit: "count" as const
    },
    chart: { type: "line", current: [], previous: [] },
    evidence: { mention_ids: [], evidence_count: 10 }
  };
  const context = {
    state: "ready" as const,
    objectives: 1,
    briefs: 1,
    audiences: 1,
    approved_assertions: 1
  };
  const packet = {
    contract_version: "signal-monthly-insight-packet-v1" as const,
    workspace_id: "00000000-0000-4000-8000-000000000001",
    study_corpus_id: "00000000-0000-4000-8000-000000000002",
    organization_id: null,
    brand_id: null,
    timezone: "America/Mexico_City",
    window: { start: "2026-06-27", end: "2026-07-26", days: 30 },
    comparison_window: { start: "2026-05-28", end: "2026-06-26", days: 30 },
    context,
    candidates: [candidate],
    candidate_hash: signalMonthlyInsightCandidateHashV1({
      window: { start: "2026-06-27", end: "2026-07-26" },
      comparison_window: { start: "2026-05-28", end: "2026-06-26" },
      context,
      items: [candidate]
    })
  };
  const data = {
    contract_version: "signal-monthly-insight-job-v1" as const,
    output_id: "00000000-0000-4000-8000-000000000003",
    requested_by_user_id: "00000000-0000-4000-8000-000000000004",
    packet,
    filters_hash: "sha256:filters",
    data_watermark_hash: "sha256:watermark",
    idempotency_key: "sha256:idempotent",
    budget_cap_usd: 2,
    prompt_version: SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
    model_version: SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION
  };
  assert.equal(validateSignalMonthlyInsightJobDataV1(data), data);
  assert.throws(
    () => validateSignalMonthlyInsightJobDataV1({ ...data, budget_cap_usd: 16.01 }),
    /budget is outside/u
  );
});

test("monthly insight idempotency key changes with the data watermark", () => {
  const base = {
    workspace_id: "workspace",
    study_corpus_id: "corpus",
    filters_hash: "filters",
    candidate_hash: "candidates",
    prompt_version: SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
    model_version: SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION
  };
  assert.notEqual(
    signalMonthlyInsightIdempotencyKeyV1({ ...base, data_watermark_hash: "first" }),
    signalMonthlyInsightIdempotencyKeyV1({ ...base, data_watermark_hash: "second" })
  );
});
