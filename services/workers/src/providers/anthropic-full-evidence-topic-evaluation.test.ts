import assert from "node:assert/strict";
import test from "node:test";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createAnthropicFullEvidenceTopicEvaluationModelV2,
  SignalTopicEvaluationProviderResponseInvalidErrorV2 } from "./anthropic-full-evidence-topic-evaluation";

test("full-evidence adapter supplies only bounded prior results and leaves temperature unset", async () => {
  const snapshot = signalTopicEvaluationDigestV2("snapshot");
  const observed: Array<Record<string, unknown>> = [];
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: snapshot, max_output_tokens: 1000,
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async (request) => {
    observed.push(request as Record<string, unknown>);
    return { text: JSON.stringify({ kind: "tool", request: { operation: "cluster_catalog", limit: 1,
      cursor: null } }), provider_request_id: null, usage: { input_tokens: 12, output_tokens: 8 } };
  });
  const result = await model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 32, remaining_cost_micro_usd: 1_000_000 });
  assert.deepEqual(result, { kind: "tool", request: { operation: "cluster_catalog", limit: 1, cursor: null },
    usage: { input_tokens: 12, output_tokens: 8, cost_micro_usd: 156 } });
  assert.equal(observed.length, 1);
  assert.equal("temperature" in observed[0]!, false);
  assert.equal(observed[0]!.max_output_tokens, 32);
  assert.match(String(observed[0]!.prompt), /Prior bounded navigation results/u);
  assert.equal(String(observed[0]!.prompt).includes("ANTHROPIC_API_KEY"), false);
});

test("full-evidence adapter preserves ambiguous transport failures for the durable caller", async () => {
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1000,
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => {
    throw Object.assign(new Error("network reset"), { code: "ECONNRESET" });
  });
  await assert.rejects(model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 1_000, remaining_cost_micro_usd: 1_000_000 }), /network reset/u);
});

test("full-evidence adapter retains metered usage when a received response violates the turn schema", async () => {
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1_000,
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => ({
    text: "{\"kind\":\"not-a-turn\"}", provider_request_id: "received-response",
    usage: { input_tokens: 12, output_tokens: 8 }
  }));
  await assert.rejects(model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 1_000, remaining_cost_micro_usd: 1_000_000 }),
  (error) => error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2
    && error.usage.cost_micro_usd === 156);
});

test("full-evidence adapter fails locally before transport when input or output budget is exhausted", async () => {
  let transportCalls = 0;
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1000,
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => {
    transportCalls += 1;
    throw new Error("transport should not run");
  });
  await assert.rejects(model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 1,
    remaining_output_tokens: 1, remaining_cost_micro_usd: 1_000_000 }),
  /topic_evaluation_v2_provider_input_budget_exhausted/u);
  const outputOnly = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1000,
    pricing: { input_micro_usd_per_token: 0, output_micro_usd_per_token: 15 } }, async () => {
    transportCalls += 1;
    throw new Error("transport should not run");
  });
  await assert.rejects(outputOnly.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 1, remaining_cost_micro_usd: 0 }),
  /topic_evaluation_v2_provider_budget_exhausted/u);
  assert.equal(transportCalls, 0);
});
