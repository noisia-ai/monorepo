import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS,
  SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS,
  SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS,
  selectSignalTaxonomyInsightMentionSampleV1,
  signalTaxonomyInsightPacketHashV1,
  validateSignalTaxonomyInsightJobDataV1,
  type SignalTaxonomyInsightMentionV1,
  type SignalTaxonomyInsightPacketV1
} from "./signal-taxonomy-insights-v1";

function mention(index: number, overrides: Partial<SignalTaxonomyInsightMentionV1> = {}) {
  return {
    mention_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    occurred_at: `2026-07-${String(index % 28 + 1).padStart(2, "0")}T12:00:00.000Z`,
    text: `Mention ${index}`,
    platform: index % 2 === 0 ? "facebook" : "tiktok",
    sentiment: index % 3 === 0 ? "negative" as const : "neutral" as const,
    engagement: index,
    conversation_root: `root-${index}`,
    topic_keys: [index % 2 === 0 ? "delivery" : "promotions"],
    narrative_keys: [index % 2 === 0 ? "late_orders" : "discount_distrust"],
    ...overrides
  };
}

test("insight sampler is bounded, deterministic and deduplicates conversation roots", () => {
  const candidates = Array.from({ length: 240 }, (_, index) => mention(index));
  candidates.push(mention(999, {
    mention_id: "00000000-0000-4000-8000-000000009999",
    conversation_root: candidates[0]!.conversation_root,
    engagement: -1
  }));
  const first = selectSignalTaxonomyInsightMentionSampleV1(candidates);
  const second = selectSignalTaxonomyInsightMentionSampleV1([...candidates].reverse());

  assert.equal(first.mentions.length, SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS);
  assert.ok(first.analyzedChars <= SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS);
  assert.equal(new Set(first.mentions.map((item) => item.conversation_root)).size, first.mentions.length);
  assert.deepEqual(
    first.mentions.map((item) => item.mention_id),
    second.mentions.map((item) => item.mention_id)
  );
  assert.equal(first.truncated, true);
});

test("insight sampler honors the total character budget without slicing mention text", () => {
  const sample = selectSignalTaxonomyInsightMentionSampleV1([
    mention(1, { text: "a".repeat(60) }),
    mention(2, { text: "b".repeat(60) }),
    mention(3, { text: "c".repeat(30) })
  ], { maxChars: 100 });

  assert.ok(sample.analyzedChars <= 100);
  assert.equal(
    sample.analyzedChars,
    sample.mentions.reduce((total, item) => total + item.text.length, 0)
  );
});

test("job validation binds the exact sampled packet and approved budget", () => {
  assert.equal(SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS, 120_000);
  const sampled = selectSignalTaxonomyInsightMentionSampleV1([mention(1), mention(2)]);
  const packet: SignalTaxonomyInsightPacketV1 = {
    contract_version: "signal-taxonomy-insight-packet-v1",
    workspace_id: "00000000-0000-4000-8000-000000000100",
    study_corpus_id: "00000000-0000-4000-8000-000000000200",
    organization_id: "00000000-0000-4000-8000-000000000300",
    brand_id: "00000000-0000-4000-8000-000000000400",
    timezone: "America/Mexico_City",
    window: { start: "2026-07-01", end: "2026-07-30", days: 30 },
    comparison_window: { start: "2026-06-01", end: "2026-06-30", days: 30 },
    population: { current_mentions: 20, previous_mentions: 14 },
    context: {
      state: "ready",
      ref_count: 3,
      context_hash: "sha256:context"
    },
    sampling: {
      policy_version: "signal-taxonomy-insight-stratified-v1",
      max_mentions: 200,
      max_chars: 120_000,
      analyzed_mentions: sampled.mentions.length,
      analyzed_chars: sampled.analyzedChars,
      deduplicated_conversation_roots: sampled.deduplicatedConversationRoots,
      truncated: sampled.truncated
    },
    terms: [],
    term_metrics: [],
    mentions: sampled.mentions
  };
  const packetHash = signalTaxonomyInsightPacketHashV1(packet);
  const validated = validateSignalTaxonomyInsightJobDataV1({
    contract_version: "signal-taxonomy-insight-job-v1",
    requested_by_user_id: "00000000-0000-4000-8000-000000000500",
    packet,
    packet_hash: packetHash,
    filters_hash: packetHash,
    data_watermark_hash: packetHash,
    idempotency_key: packetHash,
    budget_cap_usd: 4,
    prompt_version: "signal-topics-narratives-insights-research-v1",
    model_version: "claude-sonnet-4-5"
  });
  assert.equal(validated.packet_hash, packetHash);
  assert.throws(() => validateSignalTaxonomyInsightJobDataV1({
    ...validated,
    packet_hash: "sha256:stale"
  }), /packet hash is invalid/u);
});
