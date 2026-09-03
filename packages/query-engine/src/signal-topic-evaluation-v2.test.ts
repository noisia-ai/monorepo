import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSignalTopicEvidenceNavigationRequestV2,
  runOfflineSignalTopicEvaluationV2,
  sanitizeSignalTopicEvidenceExcerptV2,
  SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
  signalTopicEvidenceNavigationResultV2,
  signalTopicEvaluationDigestV2,
  signalTopicEvaluationFlightCardV2,
  buildSignalTopicEvaluationExecutionFlightCardV2
} from "./signal-topic-evaluation-v2";

const digest = (value: unknown) => signalTopicEvaluationDigestV2(value);

const clusterSummary = { cluster_key: "cluster.1", proposal_key: "proposal.1", member_count: 12,
  profile_digest: digest("profile") };
const clusterProfile = { ...clusterSummary, profile: { label: "Cluster", terms: ["term"],
  phrases: [], limitations: [], distributions: { language: { en: 12 }, market: { US: 12 },
    scope: { category: 12 }, month: { "2026-01": 12 } }, centrality_available: true } };
const mention = (ref: string) => ({ evidence_ref: ref, excerpt: "Sanitized fixture excerpt",
  language: "en", market: "US", scope: "category", month: "2026-01", stratum: "central",
  source_digest: digest("source") });
const responseData = {
  cluster_catalog: { clusters: [clusterSummary], total_clusters: 116 },
  cluster_profile: clusterProfile,
  compare_clusters: { clusters: [clusterProfile, { ...clusterProfile, cluster_key: "cluster.2" }] },
  representative_mentions: { cluster_key: "cluster.1", mentions: [mention(digest("evidence"))],
    sampling_guarantee: "deterministic_round_robin_across_observed_strata", sampling_limit: "Bounded by metadata." },
  search_cluster: { cluster_key: "cluster.1", mentions: [mention(digest("evidence"))],
    sampling_guarantee: "stable_cluster_rank", sampling_limit: "Bounded by metadata." },
  brand_os_context: { elements: [{ element_key: "identity.example", element_kind: "brand_identity",
    display_text: "Example", scope: "workspace", locale: null, source_refs_digest: digest("source"), evidence_count: 1 }] }
};
function response(operation: keyof typeof responseData, data: unknown = responseData[operation]) {
  return { contract_version: SIGNAL_TOPIC_EVALUATION_V2_CONTRACT, operation,
    snapshot_digest: digest("snapshot"), result_digest: digest(data), evidence_refs: [], next_cursor: null, data };
}

test("each navigation result has one closed operation-specific shape; catalog stays compact", () => {
  for (const operation of Object.keys(responseData) as Array<keyof typeof responseData>) {
    assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response(operation)).success, true, operation);
    assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response(operation, {})).success, false, operation);
    for (const other of Object.keys(responseData) as Array<keyof typeof responseData>) {
      if (other !== operation) assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(
        response(operation, responseData[other])).success, false, `${operation} cannot contain ${other}`);
    }
  }
  assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response("cluster_catalog", {
    clusters: [clusterProfile], total_clusters: 116 })).success, false, "catalog cannot expose profile");
  assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response("cluster_profile", clusterSummary)).success,
    false, "single profile requires profile");
  assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response("cluster_catalog", {
    clusters: Array(117).fill(clusterSummary), total_clusters: 116 })).success, false);
  assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(response("search_cluster", {
    ...responseData.search_cluster, mentions: Array(21).fill(mention(digest("evidence"))) })).success, false);
});

test("a sealed execution card stops before another model edge once its own budget is exhausted", async () => {
  const snapshot = digest("snapshot"); let calls = 0;
  const limits = buildSignalTopicEvaluationExecutionFlightCardV2({ provider_calls_allowed: 2,
    max_model_turns: 2, max_tool_calls: 2, max_tool_result_bytes: 32_768,
    max_total_tool_result_bytes: 65_536, max_total_input_tokens: 10_000,
    max_total_output_tokens: 1_000, hard_cap_micro_usd: 5 });
  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    provider_calls_on_completion: "model_turns", limits,
    model: { next: async () => { calls += 1; return { kind: "tool", request: {
      operation: "cluster_catalog", limit: 1, cursor: null }, usage: {
      input_tokens: 1, output_tokens: 1, cost_micro_usd: 5 } }; } },
    navigate: async (request) => signalTopicEvidenceNavigationResultV2.parse({
      ...response(request.operation), snapshot_digest: snapshot }) }),
  /topic_evaluation_v2_cost_limit_exceeded/u);
  assert.equal(calls, 1, "a second provider turn is not requested after the sealed cap is consumed");
});

test("v2 flight card is provider-disabled and absolutely bounded", () => {
  const card = signalTopicEvaluationFlightCardV2();
  assert.equal(card.execution_enabled, false);
  assert.equal(card.provider_calls_allowed, 0);
  assert.equal(card.no_retry, true);
  assert.equal(card.hard_cap_micro_usd, 20_000_000);
  assert.equal(card.preserve_complete_candidate_pool, true);
  assert.equal(card.top_view_limit, 10);
});

test("execution flight card is explicit, bounded, and cannot exceed the static maximums", () => {
  const card = buildSignalTopicEvaluationExecutionFlightCardV2({ provider_calls_allowed: 12,
    max_model_turns: 12, max_tool_calls: 24, max_tool_result_bytes: 32_768,
    max_total_tool_result_bytes: 262_144, max_total_input_tokens: 450_000,
    max_total_output_tokens: 50_000, hard_cap_micro_usd: 18_147_816 });
  assert.equal(card.execution_enabled, true);
  assert.equal(card.provider_calls_allowed, 12);
  assert.equal(card.hard_cap_micro_usd, 18_147_816);
  assert.equal(card.no_retry, true);
  assert.throws(() => buildSignalTopicEvaluationExecutionFlightCardV2({ provider_calls_allowed: 13,
    max_model_turns: 12, max_tool_calls: 24, max_tool_result_bytes: 32_768,
    max_total_tool_result_bytes: 262_144, max_total_input_tokens: 450_000,
    max_total_output_tokens: 50_000, hard_cap_micro_usd: 20_000_000 }),
  /topic_evaluation_v2_execution_flight_card_invalid/u);
});

test("navigation schema rejects injection, oversize and duplicate cluster sets", () => {
  assert.throws(() => parseSignalTopicEvidenceNavigationRequestV2({ operation: "search_cluster",
    cluster_key: "cluster.1", limit: 20, cursor: null, filters: { query: "x'; drop table mentions;--" } }));
  assert.throws(() => parseSignalTopicEvidenceNavigationRequestV2({ operation: "search_cluster",
    cluster_key: "cluster.1", limit: 21, cursor: null, filters: {} }));
  assert.throws(() => parseSignalTopicEvidenceNavigationRequestV2({ operation: "compare_clusters",
    cluster_keys: ["cluster.1", "cluster.1"] }));
});

test("sanitizer is deterministic and removes direct identifiers", () => {
  const value = "Contact foo@example.com at https://example.test/x @private token-secret12345678";
  const sanitized = sanitizeSignalTopicEvidenceExcerptV2(value);
  assert.equal(sanitized, sanitizeSignalTopicEvidenceExcerptV2(value));
  assert.equal(sanitized.includes("foo@example.com"), false);
  assert.equal(sanitized.includes("https://"), false);
  assert.equal(sanitized.includes("@private"), false);
  assert.equal(sanitized.includes("secret12345678"), false);
});

test("offline fake loop progressively retrieves evidence and preserves pool beyond Top 10", async () => {
  const snapshot = digest("snapshot");
  const evidence = Array.from({ length: 12 }, (_, index) => digest(`evidence-${index}`));
  const decisions: Array<{ kind: "tool"; request: unknown } | { kind: "final"; json: string }> = [
    { kind: "tool", request: { operation: "cluster_catalog", limit: 5, cursor: null } },
    { kind: "tool", request: { operation: "cluster_profile", cluster_key: "cluster.1" } },
    { kind: "tool", request: { operation: "representative_mentions", cluster_key: "cluster.1",
      limit: 12, filters: {} } },
    { kind: "final", json: JSON.stringify({ contract_version: "signal-topic-evaluation-full-evidence-output-v2",
      candidates: Array.from({ length: 12 }, (_, index) => ({ candidate_key: `candidate.${index}`,
        title: `Candidate ${index}`, description: "Bounded diagnostic candidate", inclusion: ["in"],
        exclusion: [], explanation: "Evidence-backed pending candidate",
        source_cluster_keys: ["cluster.1"], evidence_refs: [evidence[index]!], status: "pending" })),
      ranking: Array.from({ length: 10 }, (_, index) => ({ rank: index + 1,
        candidate_key: `candidate.${index}`, ranking_reason: "Bounded comparative relevance" })) }) }
  ];
  let index = 0;
  const trace = await runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async () => decisions[index++]! },
    navigate: async (request) => {
      const refs = request.operation === "representative_mentions" ? evidence : [];
      return signalTopicEvidenceNavigationResultV2.parse({ ...response(request.operation,
        request.operation === "representative_mentions" ? { ...responseData.representative_mentions,
          mentions: refs.map(mention) } : responseData[request.operation]), evidence_refs: refs });
    } });
  assert.equal(trace.provider_calls, 0);
  assert.equal(trace.retrievals.length, 3);
  assert.equal(trace.output.candidates.length, 12);
  assert.equal(trace.output.ranking.length, 10);
  assert.deepEqual(trace.output.candidates.map((item) => item.status), Array(12).fill("pending"));
});

test("the next model turn receives only prior validated, sanitized evidence results", async () => {
  const snapshot = digest("snapshot");
  const evidence = digest("evidence");
  const observed: unknown[] = [];
  const final = JSON.stringify({ contract_version: "signal-topic-evaluation-full-evidence-output-v2",
    candidates: [{ candidate_key: "candidate.1", title: "Candidate", description: "Description",
      inclusion: ["in"], exclusion: [], explanation: "Bounded explanation", source_cluster_keys: ["cluster.1"],
      evidence_refs: [evidence], status: "pending" }], ranking: [{ rank: 1, candidate_key: "candidate.1",
      ranking_reason: "Reason" }] });
  const trace = await runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async ({ turn_index, prior_results }) => {
      observed.push(prior_results);
      return turn_index === 0
        ? { kind: "tool", request: { operation: "representative_mentions", cluster_key: "cluster.1",
          limit: 3, filters: {} } }
        : { kind: "final", json: final };
    } },
    navigate: async (request) => signalTopicEvidenceNavigationResultV2.parse({ ...response(request.operation,
      { ...responseData.representative_mentions, mentions: [mention(evidence)] }), snapshot_digest: snapshot,
      evidence_refs: [evidence], result_digest: digest("bounded-result") }) });
  assert.equal(trace.retrievals.length, 1);
  assert.deepEqual(observed[0], []);
  assert.equal(Array.isArray(observed[1]), true);
  assert.equal((observed[1] as Array<{ data: { mentions: Array<{ excerpt: string }> } }>)[0]!
    .data.mentions[0]!.excerpt, "Sanitized fixture excerpt");
  assert.equal(JSON.stringify(observed[1]).includes("mention_id"), false);
  assert.equal(JSON.stringify(observed[1]).includes("source-record"), false);
});

test("offline loop rejects foreign evidence and oversized tool output without provider calls", async () => {
  const snapshot = digest("snapshot");
  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async ({ turn_index }) => turn_index === 0
      ? { kind: "tool", request: { operation: "cluster_profile", cluster_key: "cluster.1" } }
      : { kind: "final", json: JSON.stringify({ contract_version:
        "signal-topic-evaluation-full-evidence-output-v2", candidates: [{ candidate_key: "candidate.1",
          title: "Candidate", description: "Description", inclusion: ["in"], exclusion: [],
          explanation: "Explain", source_cluster_keys: ["cluster.1"], evidence_refs: [digest("foreign")],
          status: "pending" }], ranking: [{ rank: 1, candidate_key: "candidate.1",
            ranking_reason: "Reason" }] }) } },
    navigate: async (request) => signalTopicEvidenceNavigationResultV2.parse(response(request.operation)) }),
  /topic_evaluation_v2_candidate_evidence_invalid/u);

  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async () => ({ kind: "tool", request: { operation: "compare_clusters",
      cluster_keys: ["cluster.1", "cluster.2", "cluster.3", "cluster.4", "cluster.5"] } }) },
    navigate: async (request) => signalTopicEvidenceNavigationResultV2.parse(response(request.operation, {
      clusters: Array.from({ length: 5 }, (_, index) => ({ ...clusterProfile, cluster_key: `cluster.${index+1}`,
        profile: { ...clusterProfile.profile, terms: Array(24).fill("x".repeat(120)),
          phrases: Array(16).fill("x".repeat(240)), limitations: Array(12).fill("x".repeat(400)) } })) })) }),
  /topic_evaluation_v2_tool_result_too_large/u);
});

test("offline loop enforces token, cost and model-turn caps before any provider edge", async () => {
  const snapshot = digest("snapshot");
  const navigate = async (request: ReturnType<typeof parseSignalTopicEvidenceNavigationRequestV2>) => {
    return signalTopicEvidenceNavigationResultV2.parse(response(request.operation));
  };
  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async () => ({ kind: "tool", request: { operation: "cluster_catalog",
      limit: 1, cursor: null }, usage: { input_tokens: 450_001, output_tokens: 0,
      cost_micro_usd: 0 } }) }, navigate }), /topic_evaluation_v2_token_limit_exceeded/u);
  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async () => ({ kind: "tool", request: { operation: "cluster_catalog",
      limit: 1, cursor: null }, usage: { input_tokens: 1, output_tokens: 1,
      cost_micro_usd: 20_000_001 } }) }, navigate }), /topic_evaluation_v2_cost_limit_exceeded/u);
  await assert.rejects(runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot,
    model: { next: async () => ({ kind: "tool", request: { operation: "cluster_catalog",
      limit: 1, cursor: null } }) }, navigate }), /topic_evaluation_v2_model_turn_limit_exceeded/u);
});
