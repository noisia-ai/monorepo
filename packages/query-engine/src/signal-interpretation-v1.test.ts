import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_INTERPRETATION_CONTRACT_VERSION,
  buildDeterministicSignalInterpretationFallbackV1,
  buildSignalMetricPacketV1,
  signalInterpretationIdempotencyKeyV1,
  signalMetricPacketHashV1,
  validateSignalMetricInterpretationV1,
  type SignalMetricPacketRowV1
} from "./signal-interpretation-v1";

const row: SignalMetricPacketRowV1 = {
  materialization_id: "11111111-1111-4111-8111-111111111111",
  materialization_key: "volume:2026-07",
  metric_key: "conversation.volume",
  metric_version: 1,
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  value: 42,
  denominator: null,
  sample_size: 42,
  materialization_state: "fresh",
  quality_state: "pass",
  data_watermark_hash: `sha256:${"a".repeat(64)}`
};

function packet(rows = [row]) {
  return buildSignalMetricPacketV1({
    workspace_id: "22222222-2222-4222-8222-222222222222",
    study_corpus_id: "33333333-3333-4333-8333-333333333333",
    metric_group_key: "conversation_volume_velocity",
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-07-01", end: "2026-07-31" },
      timezone: "America/Mexico_City",
      granularity: "month",
      dimensions: {}
    },
    data_watermark_hash: row.data_watermark_hash,
    rows
  });
}

test("metric packets are deterministic and retain canonical materialization scope", () => {
  const first = packet();
  const second = packet();
  assert.equal(signalMetricPacketHashV1(first), signalMetricPacketHashV1(second));
  assert.deepEqual(first.data_scope.materialization_ids, [row.materialization_id]);
  assert.equal(first.filters_hash, second.filters_hash);
});

test("interpretations reject invented numbers and evidence outside the packet", () => {
  assert.throws(() => validateSignalMetricInterpretationV1({
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    summary: "Invented",
    claims: [{
      kind: "fact",
      text: "El valor es 43.",
      numeric_refs: [{ materialization_id: row.materialization_id, field: "value", value: 43 }],
      evidence_refs: [row.materialization_id],
      uncertainty: null
    }],
    limitations: [],
    review_status: "auto_published"
  }, packet()), (error: unknown) =>
    error instanceof Error && error.message.includes("does not exist exactly"));
});

test("causal, strategic and hypothesis language stays in human review", () => {
  const result = validateSignalMetricInterpretationV1({
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    summary: "Hypothesis",
    claims: [{
      kind: "hypothesis",
      text: "La hipótesis observa 42 menciones.",
      numeric_refs: [{ materialization_id: row.materialization_id, field: "value", value: 42 }],
      evidence_refs: [row.materialization_id],
      uncertainty: "No prueba causalidad."
    }],
    limitations: [],
    review_status: "needs_review"
  }, packet());
  assert.equal(result.review_status, "needs_review");
});

test("deterministic fallback copies canonical values without calculating metrics", () => {
  const result = buildDeterministicSignalInterpretationFallbackV1(packet(), "llm_disabled");
  assert.equal(result.review_status, "auto_published");
  assert.equal(result.claims[0]?.numeric_refs[0]?.value, 42);
  assert.match(result.limitations.join(" "), /llm_disabled/);
});

test("interpretation idempotency includes filter, watermark, prompt and model versions", () => {
  const first = signalInterpretationIdempotencyKeyV1({
    workspace_id: "workspace",
    metric_group_key: "conversation_volume_velocity",
    metric_group_version: 1,
    filters_hash: "filters-a",
    data_watermark_hash: "watermark-a",
    prompt_version: "prompt-1",
    model_version: "model-1"
  });
  const second = signalInterpretationIdempotencyKeyV1({
    workspace_id: "workspace",
    metric_group_key: "conversation_volume_velocity",
    metric_group_version: 1,
    filters_hash: "filters-a",
    data_watermark_hash: "watermark-b",
    prompt_version: "prompt-1",
    model_version: "model-1"
  });
  assert.notEqual(first, second);
});
