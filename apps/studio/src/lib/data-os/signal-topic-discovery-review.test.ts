import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  signalTopicDiscoveryFinalizeSchema,
  signalTopicDiscoveryReviewDraftSchema,
  validateSignalTopicDiscoveryPacketV1
} from "@/lib/data-os/signal-topic-discovery-review";
import { handleTopicDiscoveryDraft } from
  "@/lib/data-os/signal-topic-discovery-review-api";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};

function fixturePacket() {
  const representative = {
    evidence_ref: digest("evidence"), role: "medoid", selection_reason: "fixture-medoid",
    excerpt: "Private fixture excerpt.", language: "es", scope: "primary_brand",
    source_slice: "social", time_slice: "2026-08", rights_digest: digest("rights")
  };
  const packetBody = {
    contract_version: "signal-semantic-benchmark-packet-v1", run_key: "fixture-run",
    cluster_key: "fixture-cluster", cluster_content_digest: digest("cluster"),
    packet_policy_version: "fixture-policy-v1", packet_policy_digest: digest("policy"),
    cluster_member_count: 10, population_denominator: 20,
    coverage: { breadth_state: "bounded", cluster_share_of_reviewed_scope: 0.5,
      distinct_slice_count: 1, maximum_representatives: 8, observed_slice_count: 1,
      representative_count: 1, reviewed_scope: "full_population", reviewed_scope_denominator: 20 },
    count_scope: "full_population", representatives: [representative], local_terms: ["audio"],
    local_phrases: ["smart audio"], distributions: { scope: { primary_brand: 10 } },
    distribution_contracts: {}, neighboring_clusters: [], stability: { matched_assignment_consistency: 0.7 },
    outlier_information: {}, limitations: [], estimated_tokens: 100, excerpt_character_count: 24
  };
  const sealedPacket = { ...packetBody, packet_digest: digest(stableJson(packetBody)) };
  return {
    contract_version: "signal-topic-discovery-diagnostic-review-v1", review_status: "operator_diagnostic_review_required",
    modeling_scope: "full_population", modeling_record_count: 20, review_scope: "complete_cluster_census",
    population_denominator: 20, modeling_decision_allowed: false, adoption_allowed: false,
    holdout_opened: false, count_scope: "full_population_diagnostic",
    decision_sheet_contract: "signal-topic-discovery-blind-decision-sheet-v2",
    packet_policy_version: "fixture-policy-v1", packet_policy_digest: digest("policy"),
    packet_token_count: 100, packet_token_limit: 1000, technical_limitations: [], seed: 17,
    quality_floor: {}, instructions: [], none_acceptable: null,
    candidates: [{ candidate_label: "Candidate A", topic_count: 1, reviewed_topic_count: 1,
      unreviewed_topic_count: 0, cluster_selection_state: "complete",
      cluster_selection_contract: "complete_cluster_census", reviewed_cluster_population_count: 10,
      reviewed_cluster_population_share: 0.5, outlier_count: 10,
      outlier_examples: [{ evidence_ref: digest("evidence"), excerpt: "Private outlier fixture.",
        language: "es", platform: "social", rights_digest: digest("rights"), scope: "primary_brand",
        selection_reason: "seeded_bounded_outlier_diagnostic_sample", time_slice: "2026-08" }],
      packet_token_count: 100, packet_token_limit: 1000, multiscope_summary: {},
      topics: [{ topic_label: "Topic A", scores: {}, sealed_packet: sealedPacket }] }],
    candidate_role: "discovery_proposal_only", reference_seed: 17,
    reference_seed_selection_basis: "first_preregistered_final_seed", stability_context: {},
    operator_decision_fields: { internal_coherence: null, neighbor_distinction: null,
      human_nameability: null, strategic_utility: null, merge_needed: null, split_needed: null,
      convert_to_topic_contract_candidate: null, none_acceptable: null },
    packet_digest: digest("opaque-augmented-packet-lineage")
  };
}

test("diagnostic packet validates sealed cluster lineage without opening holdout", () => {
  const packet = validateSignalTopicDiscoveryPacketV1(fixturePacket());
  assert.equal(packet.candidates[0]?.topics.length, 1);
  assert.equal(packet.holdout_opened, false);
  assert.equal(packet.modeling_decision_allowed, false);
  assert.equal(packet.adoption_allowed, false);
});

test("cluster packet tampering fails closed", () => {
  const packet = fixturePacket();
  packet.candidates[0]!.topics[0]!.sealed_packet.cluster_member_count = 11;
  assert.throws(() => validateSignalTopicDiscoveryPacketV1(packet), /cluster_packet_digest_mismatch/u);
});

test("human decision contract keeps proposal separate from authority", () => {
  assert.equal(signalTopicDiscoveryReviewDraftSchema.safeParse({
    proposal_key: "proposal-001", internal_coherence: 5, neighbor_distinction: 4,
    human_nameability: 4, strategic_utility: 5, merge_needed: false, split_needed: false,
    convert_to_topic_contract_candidate: true, none_acceptable: true, notes: null
  }).success, false);
  const pending = signalTopicDiscoveryReviewDraftSchema.parse({
    proposal_key: "proposal-001", internal_coherence: null, neighbor_distinction: null,
    human_nameability: null, strategic_utility: null, merge_needed: null, split_needed: null,
    convert_to_topic_contract_candidate: null, none_acceptable: null, notes: "QA-only draft"
  });
  assert.equal(pending.convert_to_topic_contract_candidate, null);
  assert.deepEqual(signalTopicDiscoveryFinalizeSchema.parse({ outcome: "candidate_preferred", confirmed: true }),
    { outcome: "candidate_preferred", confirmed: true });
});

test("browser input cannot provide workspace, reviewer, authority, or digest fields", async () => {
  const response = await handleTopicDiscoveryDraft(new Request("http://localhost/review/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "hostile-fixture-key" },
    body: JSON.stringify({
      proposal_key: "proposal-001", internal_coherence: null, neighbor_distinction: null,
      human_nameability: null, strategic_utility: null, merge_needed: null, split_needed: null,
      convert_to_topic_contract_candidate: null, none_acceptable: null, notes: null,
      workspace_id: "browser-owned", reviewer_ref: "browser-owned",
      candidate_artifact_digest: digest("browser-owned"), authority: "approved"
    })
  }), {} as never);
  assert.equal(response.status, 422);
  const payload = await response.text();
  assert.match(payload, /topic_discovery_review_draft_invalid/u);
  assert.doesNotMatch(payload, /Private fixture excerpt/u);
});
