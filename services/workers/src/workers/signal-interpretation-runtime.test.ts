import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_INTERPRETATION_CONTRACT_VERSION,
  buildSignalMetricPacketV1
} from "@noisia/query-engine";
import { executeSignalInterpretationV1 } from "./signal-interpretation-runtime";

const packet = buildSignalMetricPacketV1({
  workspace_id: "22222222-2222-4222-8222-222222222222",
  study_corpus_id: "33333333-3333-4333-8333-333333333333",
  metric_group_key: "conversation_volume_velocity",
  filter: {
    contract_version: "signal-backend-v1",
    date_range: { start: "2026-07-01", end: "2026-07-31" },
    timezone: "UTC",
    granularity: "month",
    dimensions: {}
  },
  data_watermark_hash: `sha256:${"a".repeat(64)}`,
  rows: [{
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
  }]
});

test("disabled Claude and missing budget use a zero-cost deterministic fallback", async () => {
  let called = false;
  const result = await executeSignalInterpretationV1({
    packet,
    provider_enabled: false,
    budget_cap_usd: 0,
    estimated_cost_usd: 1,
    provider: async () => {
      called = true;
      throw new Error("must_not_run");
    }
  });
  assert.equal(called, false);
  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.cost_usd, 0);
  assert.equal(result.fallback_reason, "claude_disabled");
});

test("provider retries are bounded and end in a deterministic fallback", async () => {
  let calls = 0;
  const result = await executeSignalInterpretationV1({
    packet,
    provider_enabled: true,
    budget_cap_usd: 1,
    estimated_cost_usd: 0.1,
    max_attempts: 2,
    provider: async () => {
      calls += 1;
      throw new Error("temporary_provider_failure");
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.attempts, 2);
});

test("valid fake output persists exact packet refs and zero test cost", async () => {
  const result = await executeSignalInterpretationV1({
    packet,
    provider_enabled: true,
    budget_cap_usd: 1,
    estimated_cost_usd: 0,
    provider: async () => ({
      interpretation: {
        contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
        summary: "Descriptive fact",
        claims: [{
          kind: "fact",
          text: "El valor es 42.",
          numeric_refs: [{
            materialization_id: "11111111-1111-4111-8111-111111111111",
            field: "value",
            value: 42
          }],
          evidence_refs: ["11111111-1111-4111-8111-111111111111"],
          uncertainty: null
        }],
        limitations: [],
        review_status: "auto_published"
      },
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0
    })
  });
  assert.equal(result.source, "claude");
  assert.equal(result.cost_usd, 0);
});
