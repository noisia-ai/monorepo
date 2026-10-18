import test from "node:test";
import assert from "node:assert/strict";
import { llmCostMicroUsdV1, llmPriceV1, type LlmUsageV1 } from "./llm-pricing-v1";

// Official pricing verified 2026-10-12: Sonnet 5.5 cache hits cost $0.10/MTok,
// with the same 50% Batch discount as input, output and cache writes.
const oneMillionCacheHits: LlmUsageV1 = {
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000,
  cache_creation_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
};
test("Sonnet 5.5 bills cache hits at the published rate and stacks Batch discount", () => {
  assert.equal(llmCostMicroUsdV1(oneMillionCacheHits,
    llmPriceV1("anthropic", "claude-sonnet-5-5", "sync")), 100_000);
  assert.equal(llmCostMicroUsdV1(oneMillionCacheHits,
    llmPriceV1("anthropic", "claude-sonnet-5-5", "batch")), 50_000);
  const mixed: LlmUsageV1 = {
    input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 2_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
  };
  assert.equal(llmCostMicroUsdV1(mixed,
    llmPriceV1("anthropic", "claude-sonnet-5-5", "sync")), 18_600_000);
  assert.equal(llmCostMicroUsdV1(mixed,
    llmPriceV1("anthropic", "claude-sonnet-5-5", "batch")), 9_300_000);
});
test("Haiku 4.5 retains its published cache-hit rate", () => {
  assert.equal(llmCostMicroUsdV1(oneMillionCacheHits,
    llmPriceV1("anthropic", "claude-haiku-4-5", "sync")), 100_000);
  assert.equal(llmCostMicroUsdV1(oneMillionCacheHits,
    llmPriceV1("anthropic", "claude-haiku-4-5", "batch")), 50_000);
});
