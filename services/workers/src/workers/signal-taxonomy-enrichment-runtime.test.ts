import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalTaxonomyEnrichmentOptions,
  executeSignalTaxonomyBatchesV1,
  isSignalTaxonomyEnrichmentEnabled,
  isSignalTaxonomyLlmEnabled
} from "./signal-taxonomy-enrichment-runtime";

test("taxonomy enrichment and its paid providers are closed by default", () => {
  assert.equal(isSignalTaxonomyEnrichmentEnabled({}), false);
  assert.equal(isSignalTaxonomyLlmEnabled({}), false);
  assert.equal(isSignalTaxonomyLlmEnabled({
    NOISIA_DATA_OS_WORKER_ENABLED: "true",
    NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED: "true",
    NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED: "true",
    ANTHROPIC_API_KEY: "fake",
    VOYAGE_API_KEY: "fake"
  }), true);
});

test("taxonomy jobs use stable dedupe, bounded retries and dead-letter retention", () => {
  const options = buildSignalTaxonomyEnrichmentOptions("taxonomy-stable");
  assert.equal(options.jobId, "taxonomy-stable");
  assert.equal(options.attempts, 3);
  assert.deepEqual(options.backoff, { type: "exponential", delay: 10_000 });
});

test("incremental batches retry, heartbeat and persist exactly once", async () => {
  let calls = 0;
  const persisted: number[] = [];
  const heartbeats: number[] = [];
  const result = await executeSignalTaxonomyBatchesV1({
    batches: [1, 2],
    budget_cap_usd: 1,
    estimate: () => 0.1,
    classify: async (batch) => {
      calls += 1;
      if (batch === 1 && calls === 1) throw new Error("transient");
      return {
        classifications: [{ mention_id: String(batch) }],
        input_tokens: 10,
        output_tokens: 5,
        cost_usd: 0.1,
        context_refs: []
      };
    },
    persist: async (batch) => {
      persisted.push(batch);
    },
    heartbeat: async (progress) => {
      heartbeats.push(progress);
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(calls, 3);
  assert.deepEqual(persisted, [1, 2]);
  assert.deepEqual(heartbeats, [50, 100]);
});

test("budget exhaustion returns partial without classifying the unaffordable batch", async () => {
  const classified: number[] = [];
  const result = await executeSignalTaxonomyBatchesV1({
    batches: [1, 2],
    budget_cap_usd: 0.15,
    estimate: () => 0.1,
    classify: async (batch) => {
      classified.push(batch);
      return {
        classifications: [],
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 0.1,
        context_refs: []
      };
    },
    persist: async () => undefined,
    heartbeat: async () => undefined
  });
  assert.equal(result.state, "partial");
  assert.equal(result.reason, "budget_cap_reached");
  assert.deepEqual(classified, [1]);
});

test("provider spend beyond the approved cap fails closed", async () => {
  await assert.rejects(
    executeSignalTaxonomyBatchesV1({
      batches: [1],
      budget_cap_usd: 0.1,
      estimate: () => 0.05,
      classify: async () => ({
        classifications: [],
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 0.2,
        context_refs: []
      }),
      persist: async () => undefined,
      heartbeat: async () => undefined
    }),
    /exceeded_budget_cap/
  );
});
