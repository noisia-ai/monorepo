import assert from "node:assert/strict";
import test from "node:test";
import { LoadAPIKeyError } from "ai";
import { prepareSignalTopicRuleSuggestionContextV1, type SignalTopicRuleSuggestionContextV1 } from "@noisia/query-engine";
import { runSignalTopicRuleSuggestionV1, topicRuleSuggestionWorkerEnabled,
  type TopicRuleSuggestionRuntime } from "./signal-topic-rule-suggestion";
const id = "00000000-0000-4000-8000-000000000001";
const digest = (s: string) => `sha256:${s.repeat(64)}`;
const rule = () => ({ contract_version: "signal-topic-rule-suggestion-v1", status: "suggested",
  lexical: { any: ["Alexa"], all: ["fútbol"], not: [] }, filters: { languages: ["es"], markets: ["MX"], scopes: ["primary_brand"] },
  evidence_refs: [digest("1")], explanation: "Menciones sintéticas de Alexa y fútbol." });
function fixture() {
  const source = { workspace_id: id, run_key: "fixture-run-1", candidate_key: "football",
    snapshot_digest: digest("a"), session_key: "fixture-session-1", candidate_revision: 1,
    candidate_state_token: digest("b"), candidate_version_digest: digest("c") };
  let context: SignalTopicRuleSuggestionContextV1 = { source,
    candidate: { label: "Alexa y fútbol", definition: "Conversación de Alexa y fútbol.", inclusion: [], exclusion: [],
      source_cluster_keys: ["football"], historical_evidence_refs: [digest("f")] },
    draft: { revision: 0, digest: null }, brand_os: { source, status: "available", authority_digest: digest("d"), elements: [
      { element_key: "benefit.voice", element_kind: "benefit", display_text: "Conveniencia por voz", scope: "workspace",
        locale: null, source_refs_digest: digest("e"), evidence_count: 1 }] }, traces: [] };
  let claimed = false, ended: unknown, costs = 0;
  const events: string[] = [], calls: Array<Parameters<TopicRuleSuggestionRuntime["complete"]>[0]> = [];
  const runtime: TopicRuleSuggestionRuntime = {
    claim: async () => { events.push("claim"); if (claimed) return null; claimed = true;
      return { execution_id: id, claim_token: id, context, prepared: prepareSignalTopicRuleSuggestionContextV1(context),
        model: "claude-haiku-4-5-20251001", budget_micro_usd: 1_000_000 }; },
    navigate: async args => { events.push(`navigate:${args.request.operation}`);
      if (args.request.operation !== "continue" && args.request.cluster_key !== "football") throw new Error("scope");
      if (context.traces.length >= 10) throw new Error("navigation limit");
      const index = context.traces.length + 3;
      context = { ...context, traces: [...context.traces, { source, trace_index: index,
        operation: args.request.operation === "representative_mentions" ? "representative_mentions" : "search_cluster",
        cluster_key: "football", result_digest: digest("0"), mentions: [{ evidence_ref: digest("1"), status: "available",
          source_digest: digest("2"), excerpt: "Alexa dime resultados del fútbol.", language: "es", market: "MX",
          scope: "primary_brand", month: "2026-08", stratum: "central" }] }] };
      return { context, prepared: prepareSignalTopicRuleSuggestionContextV1(context), navigation_count: index, continuation_trace_indexes: args.request.operation === "search_cluster" ? [index] : [] }; },
    begin: async args => { events.push("begin"); assert.ok(args.prompt.includes("Conveniencia por voz"));
      assert.ok(args.prompt.includes("Alexa y fútbol")); assert.ok(args.prompt.includes(digest("1")));
      assert.ok(Buffer.byteLength(args.prompt) <= 22 * 1024);
      return { call_index: calls.length + 1, max_output_tokens: args.max_output_tokens }; },
    complete: async args => { events.push("complete"); calls.push(args);
      costs += (args.input_tokens ?? 0) + 5 * (args.output_tokens ?? 0); },
    finish: async args => { events.push(`finish:${args.outcome}`); ended = args; return args; }
  };
  return { runtime, events, calls, getContext: () => context, getEnded: () => ended, getCosts: () => costs };
}
const response = (value: unknown) => ({ text: JSON.stringify(value), provider_request_id: "fixture-request",
  usage: { input_tokens: 100, output_tokens: 25 } });

test("actual runtime pins Brand OS/candidate and reads mentions before first transport; one receipt, no replay", async () => {
  const f = fixture(); let sent = 0;
  const transport = async (request: { prompt: string }) => { sent++; f.events.push("transport");
    assert.ok(request.prompt.includes(digest("1"))); return response(rule()); };
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, transport);
  assert.equal((result as { outcome: string }).outcome, "completed");
  assert.deepEqual(f.events, ["claim", "navigate:representative_mentions", "begin", "transport", "complete", "finish:completed"]);
  assert.equal(f.getCosts(), 225); assert.equal(f.calls[0]?.response_text, JSON.stringify(rule()));
  assert.deepEqual(await runSignalTopicRuleSuggestionV1(id, f.runtime, transport), { status: "already_claimed" });
  assert.equal(sent, 1);
});

test("search and continuation use bounded server navigation before a final rule", async () => {
  const f = fixture(); let turn = 0;
  const results = [{ kind: "navigate", request: { operation: "search_cluster", cluster_key: "football", query: "Alexa fútbol", limit: 5 } },
    { kind: "navigate", request: { operation: "continue", trace_index: 4 } }, rule()];
  await runSignalTopicRuleSuggestionV1(id, f.runtime, async (request) => { if (turn === 1) assert.ok(request.prompt.includes("Available continuation trace indexes: [4]")); return response(results[turn++]); });
  assert.equal(turn, 3); assert.equal(f.getContext().traces.length, 3);
  assert.ok(f.events.includes("navigate:continue")); assert.equal(f.getCosts(), 675);
});

for (const [name, value] of [
  ["historical/unread citation", { ...rule(), evidence_refs: [digest("f")] }],
  ["foreign cluster navigation", { kind: "navigate", request: { operation: "search_cluster", cluster_key: "other", query: "Alexa" } }],
  ["raw cursor injection", { kind: "navigate", request: { operation: "continue", trace_index: 3, cursor: "forged" } }],
  ["malformed output", { kind: "not-valid" }]
] as const) test(`${name} fails after preserving known cost and cannot rerun provider`, async () => {
  const f = fixture(); let sent = 0; const transport = async () => { sent++; return response(value); };
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, transport);
  assert.equal((result as { outcome: string }).outcome, "failed"); assert.equal(f.getCosts(), 225);
  await runSignalTopicRuleSuggestionV1(id, f.runtime, transport); assert.equal(sent, 1);
});

test("navigation exhaustion ends at twelve total navigations, bootstrap included", async () => {
  const f = fixture(); let sent = 0;
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => { sent++;
    return response({ kind: "navigate", request: { operation: "representative_mentions", cluster_key: "football", limit: 3 } }); });
  assert.equal((result as { outcome: string }).outcome, "failed");
  assert.equal(f.getContext().traces.length + 2, 12); assert.equal(sent, 10);
});

test("ambiguous response keeps unknown outcome and a second delivery never resends", async () => {
  const f = fixture(); let sent = 0;
  const transport = async () => { sent++; throw new Error("private unknown provider response"); };
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, transport);
  assert.equal((result as { outcome: string }).outcome, "outcome_unknown");
  assert.equal(f.calls[0]?.outcome, "outcome_unknown");
  await runSignalTopicRuleSuggestionV1(id, f.runtime, transport); assert.equal(sent, 1);
});

test("local SDK rejection is definitely not sent with no token cost", async () => {
  const f = fixture();
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => { throw new LoadAPIKeyError({ message: "fixture" }); });
  assert.equal((result as { outcome: string }).outcome, "definitely_not_sent"); assert.equal(f.getCosts(), 0);
});

test("lost persistence acknowledgement after metered response leaves claim unresolved, no second transport", async () => {
  const f = fixture(); let sent = 0;
  f.runtime.complete = async () => { throw new Error("synthetic commit acknowledgement lost"); };
  const transport = async () => { sent++; return response(rule()); };
  await assert.rejects(runSignalTopicRuleSuggestionV1(id, f.runtime, transport), /acknowledgement lost/u);
  assert.equal(f.getEnded(), undefined);
  await runSignalTopicRuleSuggestionV1(id, f.runtime, transport); assert.equal(sent, 1);
});

test("known empty SDK output settles real usage and fails without creating a rule", async () => {
  const f = fixture();
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => ({ text: "", provider_request_id: "metered",
    usage: { input_tokens: 80, output_tokens: 2000 }, structured_output_failure: "output_limit" }));
  assert.equal((result as { outcome: string }).outcome, "failed"); assert.equal(f.getCosts(), 10080);
});

test("insufficient evidence is a valid metered terminal without invented matcher", async () => {
  const f = fixture(); const value = { contract_version: "signal-topic-rule-suggestion-v1", status: "insufficient_evidence", explanation: "Insuficiente." };
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => response(value));
  assert.equal((result as { outcome: string }).outcome, "completed");
  assert.equal((result as { output_text: string }).output_text, JSON.stringify(value));
});

test("worker gates reject production, remote local targets and missing approval", () => {
  const env = { NOISIA_TOPIC_RULE_SUGGESTION_ENABLED: "true", NOISIA_DATA_OS_WORKER_ENABLED: "true",
    NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "true", NOISIA_RUNTIME_PROFILE: "uat",
    NOISIA_REMOTE_DATABASE_TARGET: "preview", NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true" };
  assert.equal(topicRuleSuggestionWorkerEnabled(env), true);
  assert.equal(topicRuleSuggestionWorkerEnabled({ ...env, NOISIA_RUNTIME_PROFILE: "production" }), false);
  assert.equal(topicRuleSuggestionWorkerEnabled({ ...env, NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "false" }), false);
  assert.equal(topicRuleSuggestionWorkerEnabled({ ...env, NOISIA_RUNTIME_PROFILE: "local", DATABASE_URL: "postgresql://localhost/local" }), true);
  assert.equal(topicRuleSuggestionWorkerEnabled({ ...env, NOISIA_RUNTIME_PROFILE: "local", DATABASE_URL: "postgresql://remote.invalid/local" }), false);
});

test("reserve rejection and stale bootstrap finish before transport", async () => {
  for (const stage of ["navigate", "begin"] as const) {
    const f = fixture(); let sent = 0;
    f.runtime[stage] = async () => { throw new Error("synthetic budget or rights rejection"); };
    const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => { sent++; return response(rule()); });
    assert.equal((result as { outcome: string }).outcome, "definitely_not_sent");
    assert.equal(sent, 0); assert.equal(f.getCosts(), 0);
  }
});

test("real SDK structured-turn serialization and durable runtime complete with an injected no-network provider", async () => {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { generateAnthropicBoundedTextV1 } = await import("../providers/anthropic-bounded-text");
  const f = fixture(); let sends = 0;
  const provider = createAnthropic({ apiKey: "fixture-not-secret", fetch: async (_input, init) => {
    sends++; const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "claude-haiku-4-5-20251001");
    assert.equal(request.max_tokens, 2000); assert.equal("temperature" in request, false);
    return new Response(JSON.stringify({ id: "fixture-full-runtime", type: "message", role: "assistant",
      model: request.model, content: [{ type: "text", text: JSON.stringify(rule()) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 120, output_tokens: 50 } }),
    { status: 200, headers: { "content-type": "application/json" } });
  } });
  const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, request => generateAnthropicBoundedTextV1(request, provider));
  assert.equal((result as { outcome: string }).outcome, "completed"); assert.equal(sends, 1);
  assert.equal(f.getCosts(), 370); assert.equal(f.calls[0]?.request_id, "fixture-full-runtime");
});

test("stored claim outside server-authorized flight settles definitely-not-sent before navigation/provider", async () => {
  for (const scope of [{ workspace_id: "00000000-0000-4000-8000-000000000099", run_key: "fixture-run-1", candidate_key: "football" },
    { workspace_id: id, run_key: "other-run-1", candidate_key: "football" },
    { workspace_id: id, run_key: "fixture-run-1", candidate_key: "other" }]) {
    const f = fixture(); let sent = 0;
    const result = await runSignalTopicRuleSuggestionV1(id, f.runtime, async () => { sent++; return response(rule()); }, scope);
    assert.equal((result as { outcome: string }).outcome, "definitely_not_sent");
    assert.equal(sent, 0); assert.deepEqual(f.events, ["claim", "finish:definitely_not_sent"]);
  }
});
