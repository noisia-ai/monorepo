import assert from "node:assert/strict";
import test from "node:test";

import { zodSchema } from "ai";
import { runOfflineSignalTopicEvaluationV2, signalTopicEvaluationDigestV2 } from "@noisia/query-engine";
import type { ZodTypeAny } from "zod";

import { createAnthropicFullEvidenceTopicEvaluationModelV2,
  SignalTopicEvaluationProviderResponseInvalidErrorV2,
  signalTopicEvaluationFullEvidenceTestOnly } from "./anthropic-full-evidence-topic-evaluation";

const snapshot = signalTopicEvaluationDigestV2("snapshot");
const labBriefRaw = { operation: "evaluation_brief", snapshot_digest: snapshot,
  result_digest: signalTopicEvaluationDigestV2("brief"), evidence_refs: [], next_cursor: null,
  data: { brand_os: { elements: [], total_elements: 1 }, shortlist: { clusters: [{
    cluster_key: "cluster.1", proposal_key: "proposal.1", member_count: 12,
    brand_os_matches: ["identity.example"], brand_os_match_count: 1, terms: ["term"],
    phrases: ["example phrase"], scope_distribution: [{ scope: "primary_brand", count: 12 }]
  }], policy: "brand_os_anchor_alignment_v1" } } };
const labBrief = labBriefRaw as never;

test("default full-evidence adapter preserves the UAT catalog-first protocol", async () => {
  const observed: Array<Record<string, unknown>> = [];
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: snapshot, max_output_tokens: 1000,
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async (request) => {
    observed.push(request as Record<string, unknown>);
    return { text: JSON.stringify({ turn: { kind: "tool", request: { operation: "cluster_catalog", limit: 1,
      cursor: null } } }), provider_request_id: null, usage: { input_tokens: 12, output_tokens: 8 } };
  });
  const result = await model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 32, remaining_cost_micro_usd: 1_000_000 });
  assert.deepEqual(result, { kind: "tool", request: { operation: "cluster_catalog", limit: 1, cursor: null },
    usage: { input_tokens: 12, output_tokens: 8, cost_micro_usd: 156 } });
  assert.equal(observed.length, 1);
  assert.equal("temperature" in observed[0]!, false);
  assert.equal(observed[0]!.max_output_tokens, 32);
  const providerSchema = observed[0]!.structured_output as { schema: ZodTypeAny };
  assert.equal(providerSchema.schema.safeParse({ turn: { kind: "tool", request: { operation: "cluster_catalog",
    limit: 1, cursor: null } } }).success, true);
  assert.equal(providerSchema.schema.safeParse({ kind: "tool", request: { operation: "cluster_catalog",
    limit: 1, cursor: null } }).success, false);
  assert.equal((zodSchema(providerSchema.schema).jsonSchema as { type?: unknown }).type, "object");
  assert.match(String(observed[0]!.prompt), /Prior bounded navigation results/u);
  assert.doesNotMatch(String(observed[0]!.prompt), /evaluation_brief/u);
  assert.match(String(observed[0]!.prompt), /cluster keys you actually navigated/u);
  assert.equal(String(observed[0]!.prompt).includes("ANTHROPIC_API_KEY"), false);
});

test("Lab context-first adapter requires evaluation_brief on turn zero", async () => {
  const observed: Array<Record<string, unknown>> = [];
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: snapshot, max_output_tokens: 1_000,
    bootstrap_mode: "context_first_lab_v2",
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async (request) => {
    observed.push(request as Record<string, unknown>);
    return { text: JSON.stringify({ turn: { kind: "tool", request: { operation: "evaluation_brief" } } }),
      provider_request_id: null, usage: { input_tokens: 12, output_tokens: 8 } };
  });
  const result = await model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 50_000, remaining_cost_micro_usd: 2_100_000 });
  assert.equal(result.kind, "tool");
  assert.equal(result.kind === "tool" && result.request.operation, "evaluation_brief");
  assert.match(String(observed[0]!.prompt), /On turn zero, request evaluation_brief/u);
  assert.match(String(observed[0]!.prompt), /representative_mentions for every source cluster/u);
  assert.match(String(observed[0]!.prompt), /at least ten distinct, coherent, evidence-backed editable candidates/u);
  assert.match(String(observed[0]!.prompt), /non-empty brand_os_matches/u);
  assert.match(String(observed[0]!.prompt), /limit exactly 3/u);
  assert.match(String(observed[0]!.prompt), /turn 11 must return the final candidate output/u);
});

test("Lab context-first adapter caps initial representative samples without changing UAT", async () => {
  const response = { text: JSON.stringify({ turn: { kind: "tool", request: {
    operation: "representative_mentions", cluster_key: "cluster.1", limit: 24, filters: {} } } }),
  provider_request_id: "received-response", usage: { input_tokens: 12, output_tokens: 8 } };
  const args = { model: "claude-sonnet-5", snapshot_digest: snapshot,
    max_output_tokens: 1_000, pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } };
  const input = { turn_index: 1, prior_results: [labBrief], remaining_input_tokens: 450_000,
    remaining_output_tokens: 50_000, remaining_cost_micro_usd: 2_100_000 };
  const lab = createAnthropicFullEvidenceTopicEvaluationModelV2({ ...args,
    bootstrap_mode: "context_first_lab_v2" }, async () => response);
  const uat = createAnthropicFullEvidenceTopicEvaluationModelV2({ ...args,
    bootstrap_mode: "catalog_first_v1" }, async () => response);
  assert.deepEqual(await lab.next(input), { kind: "tool", request: {
    operation: "representative_mentions", cluster_key: "cluster.1", limit: 3, filters: {} },
  usage: { input_tokens: 12, output_tokens: 8, cost_micro_usd: 156 } });
  assert.deepEqual(await uat.next(input), { kind: "tool", request: {
    operation: "representative_mentions", cluster_key: "cluster.1", limit: 24, filters: {} },
  usage: { input_tokens: 12, output_tokens: 8, cost_micro_usd: 156 } });
});

test("Lab v2 reserves turn eleven for a final response", async () => {
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: snapshot, max_output_tokens: 1_000, bootstrap_mode: "context_first_lab_v2",
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => ({
    text: JSON.stringify({ turn: { kind: "tool", request: { operation: "representative_mentions",
      cluster_key: "cluster.1", limit: 3, filters: {} } } }), provider_request_id: "received-response",
    usage: { input_tokens: 12, output_tokens: 8 }
  }));
  await assert.rejects(model.next({ turn_index: 11, prior_results: [labBrief],
    remaining_input_tokens: 450_000, remaining_output_tokens: 50_000,
    remaining_cost_micro_usd: 2_100_000 }), (error) =>
    error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2
      && error.usage.cost_micro_usd === 156);
});

test("Lab v2 final projection stays bounded for ten maximum-size three-mention samples", () => {
  const maximumExcerpt = "🧪".repeat(600);
  const digest = signalTopicEvaluationDigestV2("evidence");
  const brief = { ...labBriefRaw, data: { ...labBriefRaw.data, shortlist: { ...labBriefRaw.data.shortlist,
    clusters: Array.from({ length: 10 }, (_, index) => ({ ...labBriefRaw.data.shortlist.clusters[0],
      cluster_key: `cluster.${index + 1}`, proposal_key: `proposal.${index + 1}`,
      brand_os_matches: [`identity.example-${index + 1}`] })) } } };
  const representatives = Array.from({ length: 10 }, (_, index) => ({
    operation: "representative_mentions", snapshot_digest: snapshot,
    result_digest: signalTopicEvaluationDigestV2(`result-${index}`), evidence_refs: [digest,digest,digest],
    next_cursor: null, data: { cluster_key: `cluster.${index + 1}`,
      mentions: Array.from({ length: 3 }, () => ({ evidence_ref: digest, excerpt: maximumExcerpt,
        language: "en", market: "US", scope: "primary_brand", month: "2026-01", stratum: "central",
        source_digest: digest })), sampling_guarantee: "deterministic_round_robin_across_observed_strata",
      sampling_limit: "bounded" }
  }));
  const compact = signalTopicEvaluationFullEvidenceTestOnly.compactLabFinalContext(
    [brief,...representatives] as never);
  assert.ok(Buffer.byteLength(JSON.stringify(compact), "utf8")
    <= signalTopicEvaluationFullEvidenceTestOnly.LAB_FINAL_CONTEXT_MAX_BYTES);
  assert.equal(compact.representative_evidence.length, 10);
  assert.equal(compact.representative_evidence.every((item) => item.mentions.length === 3), true);
  assert.equal(compact.representative_evidence[0]!.mentions[0]!.excerpt.length, 180);
  const finalPrompt = signalTopicEvaluationFullEvidenceTestOnly.buildPrompt(snapshot, {
    turn_index: 11, prior_results: [brief,...representatives] as never,
    remaining_input_tokens: 72 * 1024, remaining_output_tokens: 12 * 1024,
    remaining_cost_micro_usd: 396_000
  }, "context_first_lab_v2");
  assert.ok(signalTopicEvaluationFullEvidenceTestOnly.promptInputTokenCeiling(finalPrompt)
    <= signalTopicEvaluationFullEvidenceTestOnly.LAB_FINAL_INPUT_RESERVE_TOKENS);
});

test("Lab v2 navigation projection fits the smallest scheduled pre-final input allotment", () => {
  const maximumKey = `identity.${"a".repeat(160)}`;
  const brief = { ...labBriefRaw, data: { ...labBriefRaw.data, shortlist: { ...labBriefRaw.data.shortlist,
    clusters: Array.from({ length: 24 }, (_, index) => ({ ...labBriefRaw.data.shortlist.clusters[0],
      cluster_key: `cluster.${index + 1}`, proposal_key: `proposal.${index + 1}`,
      brand_os_matches: Array(12).fill(maximumKey), brand_os_match_count: 12,
      terms: Array(8).fill("term".repeat(16)), phrases: Array(4).fill("phrase".repeat(16)) })) } } };
  const navigation = signalTopicEvaluationFullEvidenceTestOnly.compactLabNavigationContext([brief] as never);
  assert.ok(Buffer.byteLength(JSON.stringify(navigation), "utf8")
    <= signalTopicEvaluationFullEvidenceTestOnly.LAB_NAVIGATION_CONTEXT_MAX_BYTES);
  const prompt = signalTopicEvaluationFullEvidenceTestOnly.buildPrompt(snapshot, { turn_index: 1,
    prior_results: [brief] as never, remaining_input_tokens: 450_000, remaining_output_tokens: 50_000,
    remaining_cost_micro_usd: 2_100_000 }, "context_first_lab_v2");
  assert.ok(signalTopicEvaluationFullEvidenceTestOnly.promptInputTokenCeiling(prompt)
    <= Math.floor((450_000 - signalTopicEvaluationFullEvidenceTestOnly.LAB_FINAL_INPUT_RESERVE_TOKENS) / 11));
});

test("Lab v2 schedules every one of twelve turns inside the sealed $2.10 flight", async () => {
  const evidence = Array.from({ length: 10 }, (_, index) => signalTopicEvaluationDigestV2(`evidence-${index}`));
  const clusters = Array.from({ length: 10 }, (_, index) => ({ ...labBriefRaw.data.shortlist.clusters[0],
    cluster_key: `cluster.${index + 1}`, proposal_key: `proposal.${index + 1}`,
    brand_os_matches: [`identity.example-${index + 1}`] }));
  const executionBrief = { contract_version: "signal-topic-evaluation-full-evidence-v2", operation: "evaluation_brief",
    snapshot_digest: snapshot, result_digest: signalTopicEvaluationDigestV2("execution-brief"), evidence_refs: [],
    next_cursor: null, data: { brand_os: { elements: [{ element_key: "identity.example", element_kind: "identity",
      display_text: "Identity example", scope: "primary_brand", locale: null,
      source_refs_digest: signalTopicEvaluationDigestV2("brand-os"), evidence_count: 1 }], total_elements: 1 },
    shortlist: { clusters, policy: "brand_os_anchor_alignment_v1" } } };
  const representative = (index: number) => ({ contract_version: "signal-topic-evaluation-full-evidence-v2",
    operation: "representative_mentions", snapshot_digest: snapshot,
    result_digest: signalTopicEvaluationDigestV2(`representative-${index}`), evidence_refs: [evidence[index]!],
    next_cursor: null, data: { cluster_key: `cluster.${index + 1}`, mentions: [{ evidence_ref: evidence[index]!,
      excerpt: `Sanitized evidence excerpt ${index + 1}`, language: "en", market: "US",
      scope: "primary_brand", month: "2026-01", stratum: "central",
      source_digest: signalTopicEvaluationDigestV2(`source-${index}`) }],
    sampling_guarantee: "deterministic_round_robin_across_observed_strata", sampling_limit: "bounded" } });
  const finalOutput = { contract_version: "signal-topic-evaluation-full-evidence-output-v2",
    candidates: [{ candidate_key: "candidate.1", title: "Candidate", description: "Bounded candidate",
      inclusion: ["Included"], exclusion: [], explanation: "Evidence-backed candidate",
      source_cluster_keys: ["cluster.1"], evidence_refs: [evidence[0]!], status: "pending" }],
    ranking: [{ rank: 1, candidate_key: "candidate.1", ranking_reason: "Bounded relevance" }] };
  const observed: Array<Record<string, unknown>> = [];
  let call = 0;
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: snapshot, max_output_tokens: 50_000, bootstrap_mode: "context_first_lab_v2",
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async (request) => {
    observed.push(request as Record<string, unknown>);
    const index = call++;
    const turn = index === 0 ? { kind: "tool", request: { operation: "evaluation_brief" } }
      : index <= 10 ? { kind: "tool", request: { operation: "representative_mentions",
        cluster_key: `cluster.${index}`, limit: 3, filters: {} } }
      : { kind: "final", output: finalOutput };
    return { text: JSON.stringify({ turn }), provider_request_id: "local-test",
      usage: { input_tokens: signalTopicEvaluationFullEvidenceTestOnly.promptInputTokenCeiling(
        String(request.prompt)), output_tokens: Number(request.max_output_tokens) } };
  });
  const trace = await runOfflineSignalTopicEvaluationV2({ snapshot_digest: snapshot, model,
    provider_calls_on_completion: "model_turns", limits: { provider_calls_allowed: 12, max_model_turns: 12,
      max_tool_calls: 24, max_tool_result_bytes: 32_768, max_total_tool_result_bytes: 262_144,
      max_total_input_tokens: 450_000, max_total_output_tokens: 50_000, hard_cap_micro_usd: 2_100_000 },
    navigate: async (request) => {
      if (request.operation === "evaluation_brief") return executionBrief as never;
      if (request.operation !== "representative_mentions") throw new Error("unexpected navigation");
      return representative(Number(request.cluster_key.split(".")[1]) - 1) as never;
    } });
  assert.equal(trace.provider_calls, 12);
  assert.equal(trace.retrievals.length, 11);
  assert.equal(trace.total_output_tokens, 50_000);
  assert.ok(trace.total_input_tokens <= 450_000);
  assert.ok(trace.total_cost_micro_usd <= 2_100_000);
  assert.equal(observed.length, 12);
  assert.equal(observed.slice(0, 11).every((request) => Number(request.max_output_tokens) <= 3_432), true);
  assert.equal(observed[11]!.max_output_tokens, 12_288);
  assert.match(String(observed[1]!.prompt), /context_first_lab_v2_navigation_projection/u);
  assert.doesNotMatch(String(observed[10]!.prompt), /Sanitized evidence excerpt/u);
  assert.match(String(observed[11]!.prompt), /context_first_lab_v2_final_projection/u);
});

test("Lab context-first adapter terminalizes a received non-brief turn without retry", async () => {
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1_000,
    bootstrap_mode: "context_first_lab_v2",
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => ({
    text: JSON.stringify({ turn: { kind: "tool", request: { operation: "cluster_catalog", limit: 1, cursor: null } } }),
    provider_request_id: "received-response", usage: { input_tokens: 12, output_tokens: 8 }
  }));
  await assert.rejects(model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 50_000, remaining_cost_micro_usd: 2_100_000 }),
  (error) => error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2
    && error.usage.cost_micro_usd === 156);
});

test("UAT catalog-first adapter rejects the Lab-only brief before shared navigation", async () => {
  const model = createAnthropicFullEvidenceTopicEvaluationModelV2({ model: "claude-sonnet-5",
    snapshot_digest: signalTopicEvaluationDigestV2("snapshot"), max_output_tokens: 1_000,
    bootstrap_mode: "catalog_first_v1",
    pricing: { input_micro_usd_per_token: 3, output_micro_usd_per_token: 15 } }, async () => ({
    text: JSON.stringify({ turn: { kind: "tool", request: { operation: "evaluation_brief" } } }),
    provider_request_id: "received-response", usage: { input_tokens: 12, output_tokens: 8 }
  }));
  await assert.rejects(model.next({ turn_index: 0, prior_results: [], remaining_input_tokens: 450_000,
    remaining_output_tokens: 1_000, remaining_cost_micro_usd: 1_000_000 }),
  (error) => error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2
    && error.usage.cost_micro_usd === 156);
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
    text: "{\"turn\":{\"kind\":\"not-a-turn\"}}", provider_request_id: "received-response",
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
