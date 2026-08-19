import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateSignalSemanticResolutionCostV1,
  estimateSignalSemanticResolutionCostV2,
  formatMicroUsd,
  parseUsdToMicroUsd,
  signalSemanticResolutionSelectionDigestV2,
  SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD
} from "./signal-semantic-resolution-v1";

test("semantic resolution estimate starts ordinary queues without confirmation", () => {
  const estimate = estimateSignalSemanticResolutionCostV1({
    mention_count: 729,
    mention_character_count: 180_000,
    context_character_count: 12_000
  });

  assert.equal(estimate.mention_count, 729);
  assert.equal(estimate.confirmation_required, false);
  assert.ok(estimate.estimated_cost_usd > 0);
  assert.ok(estimate.estimated_cost_usd < SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD);
});

test("semantic resolution estimate requires confirmation above USD 40", () => {
  const estimate = estimateSignalSemanticResolutionCostV1({
    mention_count: 50_000,
    mention_character_count: 20_000_000,
    context_character_count: 80_000
  });

  assert.equal(estimate.confirmation_required, true);
  assert.ok(estimate.estimated_cost_usd > SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD);
});

test("empty semantic resolution work costs zero", () => {
  assert.deepEqual(
    estimateSignalSemanticResolutionCostV1({
      mention_count: 0,
      mention_character_count: 0,
      context_character_count: 0
    }),
    {
      mention_count: 0,
      estimated_input_tokens: 0,
      estimated_output_tokens: 0,
      estimated_cost_usd: 0,
      confirmation_required: false,
      threshold_usd: 40
    }
  );
});

test("v2 partitions the complete population and treats USD 40 only as confirmation threshold", () => {
  const estimate = estimateSignalSemanticResolutionCostV2({
    mention_count: 120_001,
    mention_character_count: 48_000_400,
    context_character_count: 84_000,
    provider_batch_item_limit: 50_000,
    hard_cap_usd: "250.000000"
  });

  assert.equal(estimate.mention_count, 120_001);
  assert.equal(estimate.provider_batch_count, 3);
  assert.equal(estimate.provider_batch_item_limit, 50_000);
  assert.equal(estimate.confirmation_required, true);
  assert.equal(estimate.within_hard_cap, true);
  assert.ok(BigInt(estimate.estimated_cost_micro_usd) > 40_000_000n);
});

test("v2 uses exact micro-USD boundaries without IEEE-754", () => {
  const baseline = estimateSignalSemanticResolutionCostV2({
    mention_count: 7_777,
    mention_character_count: 3_333_333,
    context_character_count: 12_345,
    hard_cap_usd: "999.000000"
  });
  const exactCap = formatMicroUsd(BigInt(baseline.estimated_cost_micro_usd));
  const exact = estimateSignalSemanticResolutionCostV2({
    mention_count: 7_777,
    mention_character_count: 3_333_333,
    context_character_count: 12_345,
    hard_cap_usd: exactCap
  });
  const below = estimateSignalSemanticResolutionCostV2({
    mention_count: 7_777,
    mention_character_count: 3_333_333,
    context_character_count: 12_345,
    hard_cap_usd: formatMicroUsd(BigInt(baseline.estimated_cost_micro_usd) - 1n)
  });

  assert.equal(exact.within_hard_cap, true);
  assert.equal(below.within_hard_cap, false);
  assert.equal(parseUsdToMicroUsd(exactCap), BigInt(baseline.estimated_cost_micro_usd));
  assert.throws(() => parseUsdToMicroUsd("1.0000001"), /at most six places/);
});

test("v2 integer estimate matches an independent rational oracle across deterministic fuzz cases", () => {
  let seed = 0x1a2b3c4d;
  const next = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed;
  };
  for (let index = 0; index < 2_000; index += 1) {
    const mentions = next() % 250_001;
    const characters = next() % 150_000_001;
    const context = next() % 1_000_001;
    const limit = 1 + next() % 100_000;
    const estimate = estimateSignalSemanticResolutionCostV2({
      mention_count: mentions,
      mention_character_count: characters,
      context_character_count: context,
      provider_batch_item_limit: limit,
      hard_cap_usd: "999999.999999"
    });
    const batches = mentions === 0 ? 0n : ceilDiv(BigInt(mentions), BigInt(limit));
    const inputTokens = ceilDiv(BigInt(characters) * 2n, 7n)
      + BigInt(mentions) * 90n
      + batches * (ceilDiv(BigInt(context) * 2n, 7n) + 1_200n);
    const outputTokens = BigInt(mentions) * 120n;
    const expected = mentions === 0
      ? 0n
      : ceilDiv((inputTokens * 3n + outputTokens * 15n) * 135n, 200n);
    assert.equal(estimate.provider_batch_count, Number(batches));
    assert.equal(estimate.estimated_input_tokens, Number(inputTokens));
    assert.equal(estimate.estimated_output_tokens, Number(outputTokens));
    assert.equal(BigInt(estimate.estimated_cost_micro_usd), expected);
  }
});

test("selection digest is order-independent and preserves every selected root", () => {
  const items = Array.from({ length: 120_003 }, (_, index) => ({
    mention_id: `mention-${index.toString().padStart(6, "0")}`,
    context_hash: `sha256:${index.toString(16).padStart(64, "0")}`
  }));
  assert.equal(
    signalSemanticResolutionSelectionDigestV2(items),
    signalSemanticResolutionSelectionDigestV2([...items].reverse())
  );
  assert.notEqual(
    signalSemanticResolutionSelectionDigestV2(items),
    signalSemanticResolutionSelectionDigestV2(items.slice(0, -1))
  );
});

function ceilDiv(numerator: bigint, denominator: bigint) {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}
