import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, zodSchema } from "ai";

import { runSignalTopicCandidateRefinementLabV1,
  signalTopicCandidateRefinementLabTestOnly } from "./signal-topic-candidate-refinement-lab";
import { SignalTopicEvaluationProviderBoundaryErrorV1 } from "@noisia/query-engine";
import { SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME,
  SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE,
  SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE } from
  "../../scripts/signal-topic-candidate-refinement-lab-credential-v1";
import { generateAnthropicBoundedTextV1 } from "../providers/anthropic-bounded-text";

const flight = {
  contract_version: "signal-topic-candidate-refinement-flight-v1" as const,
  flight_key: "topic-refinement-flight-0123456789abcdef",
  session_key: "topic-refine-0123456789abcdef",
  candidate_key: "topic.local-proof",
  reserved_micro_usd: 1_000_000,
  max_model_turns: 12,
  max_navigation_calls: 12,
  topic_adoption: false as const,
  publication: false as const,
  serving: false as const
} as const;

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actor = { id: "00000000-0000-4000-8000-000000000002", user_type: "noisia_internal" as const };

/** SQL fixture deliberately exercises the real claim/navigation/terminal core. The production
 * runner has no injectable navigation or context hook that could skip runtime authority. */
function runnerPool(options: { missing_brand_os?: boolean; stale_candidate?: boolean } = {}) {
  const digest = `sha256:${"a".repeat(64)}`;
  const id = "00000000-0000-4000-8000-000000000003";
  const candidate = { workspace_id: workspaceId, run_id: id, snapshot_id: id, candidate_id: id,
    candidate_key: flight.candidate_key, candidate_revision: 1, candidate_version_digest: digest,
    candidate_state_token: digest, brand_os_authority_digest: digest,
    source_cluster_keys: ["cluster.echo"], title: "Echo everyday use", description: "Echo routines",
    inclusion: ["Echo"], exclusion: [] };
  const session = { ...candidate, id, session_key: flight.session_key, actor_user_id: actor.id,
    expires_at: "2099-01-01T00:00:00.000Z", session_digest: digest };
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const operations: string[] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      let rows: Array<Record<string, unknown>>;
      if (/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql) || sql.includes("pg_advisory_xact_lock")) rows = [];
      else if (sql.includes("INSERT INTO signal_topic_evaluation_v2_candidate_refinement_navigation_traces")) {
        operations.push(String(values?.[7]));
        assert.equal(values?.[6], operations.length - 1);
        rows = [];
      } else if (sql.includes("flight_terminal_receipts")) rows = [{ terminal_digest: digest }];
      else if (sql.includes("INSERT INTO") && sql.includes("flight_dispatch_claims")) rows = [{ id }];
      else if (sql.includes("SELECT flight.id FROM")) rows = [{ id }];
      else if (sql.includes("flight.flight_key,session.session_key,candidate.candidate_key")) rows = [{
        flight_key: flight.flight_key, session_key: flight.session_key, candidate_key: flight.candidate_key }];
      else if (sql.includes("FROM signal_topic_evaluation_v2_candidate_refinement_sessions session")) rows = [session];
      else if (sql.includes("candidate.status='pending'")) rows = options.stale_candidate ? [] : [candidate];
      else if (sql.includes("FROM signal_topic_evaluation_v2_candidate_evidence")) rows = [{ evidence_ref: digest }];
      else if (sql.includes("position(lower(element.display_text)")) rows = options.missing_brand_os
        ? [] : [{ element_key: "brand.echo" }];
      else if (sql.includes("SELECT snapshot.id::text,snapshot.workspace_id::text")) rows = [{ id,
        workspace_id: workspaceId, snapshot_digest: digest, cluster_count: 1 }];
      else if (sql.includes("element.element_kind,element.display_text")) rows = [{ element_key: "brand.echo",
        element_kind: "entity", display_text: "Echo", scope: "primary_brand", locale: null,
        source_refs_digest: digest, evidence_count: 1 }];
      else if (sql.includes("SELECT cluster_key,proposal_key,member_count,profile,profile_digest")) rows = [{
        cluster_key: "cluster.echo", proposal_key: "proposal.echo", member_count: 20,
        profile: { label: "Echo routines", terms: ["Echo"], phrases: [], limitations: [],
          distributions: { language: { en: 20 }, market: {}, scope: {}, month: {} },
          centrality_available: false }, profile_digest: digest }];
      else if (sql.includes("COALESCE(sum(result_bytes)")) rows = [{ total_bytes: operations.length * 500 }];
      else if (sql.includes("SELECT trace_index")) rows = operations.length ? [{ trace_index: operations.length - 1 }] : [];
      else throw new Error(`Unexpected fixture SQL: ${sql.slice(0, 120)}`);
      return { rows, rowCount: rows.length };
    },
    release() { /* fixture only */ }
  };
  return { pool: { connect: async () => client }, queries, operations };
}

test("transport diagnostics are closed categories and never leak provider content or authorize retries", () => {
  for (const [status, expected] of [[400, "bad_request"], [403, "auth"], [429, "rate_limit"],
    [503, "server"], [404, "other"]] as const) {
    const error = new APICallError({ message: "private payload", url: "https://private.invalid",
      requestBodyValues: { secret: "private" }, responseBody: "private response", statusCode: status });
    assert.equal(signalTopicCandidateRefinementLabTestOnly.safeTransportDiagnostic(error),
      `topic_refinement_provider_http_${expected}`);
    assert.equal(signalTopicCandidateRefinementLabTestOnly.classifyTransportFailureTerminal({
      definitely_not_sent: false, provider_call_count: 3, input_tokens: 321, output_tokens: 42
    }).terminal_status, "outcome_unknown");
  }
  assert.equal(signalTopicCandidateRefinementLabTestOnly.safeTransportDiagnostic(new Error("private network")),
    "topic_refinement_provider_ambiguous");
});

test("candidate context never advertises inherited refs as inspected session evidence", () => {
  const inherited = `sha256:${"a".repeat(64)}`;
  const history = [{ operation: "candidate_context", result: {
    data: { candidate_key: flight.candidate_key, evidence_refs: [inherited] },
    evidence_refs: [inherited], next_cursor: null
  } }];
  const compact = signalTopicCandidateRefinementLabTestOnly.compactTraceContext(history as never);
  assert.deepEqual(compact[0]?.evidence_refs, []);
  assert.equal(JSON.stringify(compact).includes(inherited), false);
  assert.match(signalTopicCandidateRefinementLabTestOnly.buildPrompt(flight as never, 0, []),
    /retrieve representative_mentions or search_cluster/u);
});

test("navigation preserves signed cursors, all page items, and meaningful mention excerpts", () => {
  const evidence = `sha256:${"b".repeat(64)}`;
  const cursor = "c".repeat(947);
  const history = [{ operation: "search_cluster", result: {
    data: { mentions: Array.from({ length: 20 }, (_, index) => ({
      evidence_ref: evidence, text: `mention ${index} ${"detail ".repeat(35)}`
    })) }, evidence_refs: [evidence], next_cursor: cursor
  } }];
  const compact = signalTopicCandidateRefinementLabTestOnly.compactTraceContext(history as never);
  assert.equal(compact[0]?.next_cursor, cursor);
  assert.deepEqual(compact[0]?.evidence_refs, [evidence]);
  const mentions = (compact[0]?.result as { mentions: Array<{ text: string }> }).mentions;
  assert.equal(mentions.length, 20);
  assert.equal(mentions[19]?.text, history[0]!.result.data.mentions[19]!.text);
});

test("large prose compaction stays bounded without changing navigation tokens", () => {
  const cursor = "c".repeat(947);
  const history = [{ operation: "search_cluster", result: {
    data: { mentions: Array.from({ length: 20 }, () => ({ text: "x".repeat(2000) })) },
    evidence_refs: [], next_cursor: cursor
  } }];
  const compact = signalTopicCandidateRefinementLabTestOnly.compactTraceContext(history as never);
  assert.equal(compact[0]?.next_cursor, cursor);
  assert.ok(Buffer.byteLength(JSON.stringify(compact), "utf8") <= 18_000);
});

test("candidate refinement serializes its discriminated decision inside a strict root object", async () => {
  const json = await zodSchema(signalTopicCandidateRefinementLabTestOnly.decisionEnvelopeSchema).jsonSchema;
  assert.equal((json as { type?: unknown }).type, "object");
  assert.equal((json as { additionalProperties?: unknown }).additionalProperties, false);
  assert.ok("decision" in ((json as { properties?: Record<string, unknown> }).properties ?? {}));
});

test("candidate refinement sends Anthropic a concrete root object schema", async () => {
  let serialized: Record<string, unknown> | null = null;
  const fixture = createAnthropic({ apiKey: "fixture-not-secret", fetch: async (_input, init) => {
    serialized = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ type: "error", error: {
      type: "invalid_request_error", message: "synthetic configuration rejection" } }), {
      status: 400, headers: { "content-type": "application/json" }
    });
  } });
  await assert.rejects(generateAnthropicBoundedTextV1({ model: "claude-sonnet-5", prompt: "fixture",
    max_output_tokens: 64, structured_output: {
      schema: signalTopicCandidateRefinementLabTestOnly.decisionEnvelopeSchema,
      name: "topic_candidate_refinement_decision", description: "fixture"
    } }, fixture), (error) => APICallError.isInstance(error) && error.statusCode === 400);
  // TypeScript cannot observe the fixture fetch closure, so assert its runtime postcondition
  // through an explicit test-only projection rather than narrowing the initialized null value.
  const body = serialized as unknown as Record<string, unknown>;
  const tools = body.tools;
  assert.ok(Array.isArray(tools));
  const inputSchema = (tools[0] as { input_schema?: Record<string, unknown> }).input_schema;
  assert.ok(inputSchema);
  assert.equal(inputSchema?.type, "object");
  assert.ok("decision" in (inputSchema.properties as Record<string, unknown>));
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
  assert.equal("top_k" in body, false);
});

test("a local post-response rejection settles the already-known usage instead of stranding a claim", () => {
  const terminal = signalTopicCandidateRefinementLabTestOnly.classifyTransportFailureTerminal({
    definitely_not_sent: true, provider_call_count: 1, input_tokens: 321, output_tokens: 45
  });
  assert.deepEqual(terminal, { terminal_status: "provider_response_invalid", provider_call_count: 1,
    input_tokens: 321, output_tokens: 45, settled_micro_usd: 1_638,
    error_code: "topic_refinement_provider_turn_rejected_after_response" });
});

async function withLocalLabCredential<T>(callback: () => Promise<T>) {
  const saved = { runtime: process.env.NOISIA_RUNTIME_PROFILE,
    source: process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE],
    credential: process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME],
    anthropic: process.env.ANTHROPIC_API_KEY };
  process.env.NOISIA_RUNTIME_PROFILE = SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE;
  process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE] = "keychain-child";
  process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME] = "local-test-only";
  delete process.env.ANTHROPIC_API_KEY;
  try { return await callback(); }
  finally {
    for (const [key, value] of Object.entries({ NOISIA_RUNTIME_PROFILE: saved.runtime,
      [SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE]: saved.source,
      [SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME]: saved.credential,
      ANTHROPIC_API_KEY: saved.anthropic })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("candidate refinement cannot reach a provider transport without an injected local credential", async () => {
  let transportCalls = 0;
  await assert.rejects(runSignalTopicCandidateRefinementLabV1({
    pool: {} as never,
    workspace_id: workspaceId,
    actor,
    flight_key: flight.flight_key,
    transport: async () => {
      transportCalls += 1;
      throw new Error("provider_transport_must_not_run");
    }
  }), /topic_refinement_local_credential_(?:missing|custody_invalid|inherited)/u);
  assert.equal(transportCalls, 0);
});

test("a rejected custody check clears the dedicated child credential before any database or transport edge", async () => {
  const saved = process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME];
  process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME] = "must-not-survive-invalid-custody";
  try {
    await assert.rejects(runSignalTopicCandidateRefinementLabV1({
      pool: {} as never, workspace_id: workspaceId, actor, flight_key: flight.flight_key,
      transport: async () => { throw new Error("must-not-transport"); }
    }), /topic_refinement_local_credential_custody_invalid/u);
    assert.equal(process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME], undefined);
  } finally {
    if (saved === undefined) delete process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME];
    else process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME] = saved;
  }
});

test("a forged or unavailable flight cannot reach transport before its persisted claim", async () => {
  let transportCalls = 0;
  const client = {
    async query() { return { rows: [], rowCount: 0 }; },
    release() { /* test double */ }
  };
  await withLocalLabCredential(async () => {
    await assert.rejects(runSignalTopicCandidateRefinementLabV1({
    pool: { connect: async () => client } as never,
    workspace_id: workspaceId,
    actor,
    flight_key: flight.flight_key,
    transport: async () => { transportCalls += 1; throw new Error("must_not_transport"); }
    }), /topic_refinement_flight_not_found/u);
    assert.equal(process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME], undefined);
  });
  assert.equal(transportCalls, 0);
});

test("an uncertain first transport edge records one attempted call before terminal reconciliation", async () => {
  const fixture = runnerPool();
  const result = await withLocalLabCredential(async () => runSignalTopicCandidateRefinementLabV1({
    pool: fixture.pool as never,
    workspace_id: workspaceId,
    actor,
    flight_key: flight.flight_key,
    transport: async () => { throw new Error("socket reset after dispatch"); }
  }));
  assert.equal(result.terminal_status, "outcome_unknown");
  assert.equal(result.provider_call_count, 1);
  const terminalInsert = fixture.queries.find(({ sql }) => /flight_terminal_receipts/u.test(sql));
  assert.ok(terminalInsert);
  assert.equal(terminalInsert!.values?.[3], 1);
  assert.equal(terminalInsert!.values?.[4], null);
  assert.equal(terminalInsert!.values?.[5], null);
  assert.equal(terminalInsert!.values?.[6], null);
});

test("an explicit local pre-transport boundary settles as definitely-not-sent with zero calls", async () => {
  const fixture = runnerPool();
  const result = await withLocalLabCredential(async () => runSignalTopicCandidateRefinementLabV1({
    pool: fixture.pool as never, workspace_id: workspaceId, actor,
    flight_key: flight.flight_key,
    transport: async () => { throw new SignalTopicEvaluationProviderBoundaryErrorV1(
      "definitely_not_sent", "synthetic_local_preflight_rejected"); }
  }));
  assert.equal(result.terminal_status, "definitely_not_sent");
  assert.equal(result.provider_call_count, 0);
  const terminalInsert = fixture.queries.find(({ sql }) => /flight_terminal_receipts/u.test(sql));
  assert.ok(terminalInsert);
  assert.equal(terminalInsert!.values?.[3], 0);
  assert.equal(terminalInsert!.values?.[4], 0);
  assert.equal(terminalInsert!.values?.[5], 0);
  assert.equal(terminalInsert!.values?.[6], 0);
});

test("server candidate and Brand OS reads are traced in order before the first transport", async () => {
  const fixture = runnerPool();
  let transportCalls = 0;
  const result = await withLocalLabCredential(async () => runSignalTopicCandidateRefinementLabV1({
    pool: fixture.pool as never, workspace_id: workspaceId, actor, flight_key: flight.flight_key,
    transport: async ({ prompt }) => {
      transportCalls += 1;
      assert.deepEqual(fixture.operations, ["candidate_context", "brand_os_context"]);
      assert.match(prompt, /server has already supplied and traced candidate_context and brand_os_context/u);
      assert.match(prompt, /do not request duplicate candidate_context/u);
      assert.match(prompt, /Navigation calls remaining: 10\/12/u);
      assert.match(prompt, /"element_key":"brand.echo"/u);
      assert.match(prompt, /"title":"Echo everyday use"/u);
      throw new SignalTopicEvaluationProviderBoundaryErrorV1("definitely_not_sent", "fixture");
    }
  }));
  assert.equal(transportCalls, 1);
  assert.equal(result.provider_call_count, 0);
  assert.equal(result.terminal_status, "definitely_not_sent");
});

test("missing or stale bootstrap authority settles zero cost without any transport", async () => {
  for (const options of [{ missing_brand_os: true }, { stale_candidate: true }]) {
    const fixture = runnerPool(options);
    let transportCalls = 0;
    const result = await withLocalLabCredential(async () => runSignalTopicCandidateRefinementLabV1({
      pool: fixture.pool as never, workspace_id: workspaceId, actor, flight_key: flight.flight_key,
      transport: async () => { transportCalls += 1; throw new Error("must_not_transport"); }
    }));
    assert.equal(transportCalls, 0);
    assert.equal(result.terminal_status, "definitely_not_sent");
    assert.equal(result.provider_call_count, 0);
    assert.equal(result.settled_micro_usd, 0);
    assert.equal(result.proposal_appended, false);
    assert.deepEqual(fixture.operations, options.missing_brand_os ? ["candidate_context"] : []);
    const receipt = fixture.queries.find(({ sql }) => /flight_terminal_receipts/u.test(sql));
    assert.deepEqual(receipt?.values?.slice(2, 9), ["definitely_not_sent", 0, 0, 0, 0, null,
      "topic_refinement_context_bootstrap_rejected"]);
    assert.equal(process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME], undefined);
  }
});

test("bootstrap consumes two of twelve navigation calls without increasing model or money limits", async () => {
  const fixture = runnerPool();
  let transportCalls = 0;
  const result = await withLocalLabCredential(async () => runSignalTopicCandidateRefinementLabV1({
    pool: fixture.pool as never, workspace_id: workspaceId, actor, flight_key: flight.flight_key,
    transport: async () => {
      transportCalls += 1;
      return { text: JSON.stringify({ decision: { kind: "tool",
        request: { operation: "cluster_profile", cluster_key: "cluster.echo" } } }),
      usage: { input_tokens: 10, output_tokens: 10 }, provider_request_id: null } as never;
    }
  }));
  assert.equal(fixture.operations.length, 12);
  assert.deepEqual(fixture.operations.slice(0, 2), ["candidate_context", "brand_os_context"]);
  assert.equal(fixture.operations.filter((operation) => operation === "cluster_profile").length, 10);
  assert.equal(transportCalls, 11);
  assert.equal(result.provider_call_count, 11);
  assert.equal(result.terminal_status, "provider_response_invalid");
  assert.equal(result.settled_micro_usd, 1_980);
  assert.equal(result.proposal_appended, false);
});
