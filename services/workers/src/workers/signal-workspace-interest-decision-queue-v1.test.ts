import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceInterestDecisionRequestBodyV1 } from "@noisia/query-engine";
import {
  createAnthropicMessageBatchesClient,
  type AnthropicBatchItem,
  type AnthropicBatchState,
} from "../providers/anthropic-message-batches";
import { buildSignalWorkspaceInterestDecisionPageManifestV1 } from "./signal-workspace-interest-decision-batch-v1";
import {
  runSignalWorkspaceInterestDecisionBatchTickV1,
  type SignalWorkspaceInterestDecisionBatchLeaseV1,
  type SignalWorkspaceInterestDecisionBatchStoresV1,
} from "./signal-workspace-interest-decision-queue-v1";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const roots = ["Alexa+ se activó sin permiso.", "Pedí Alexa+ y acepté."].map((text, index) => ({
  root_id: randomUUID(), fingerprint: sha(`root-${index}`), correction_digest: sha(`correction-${index}`),
  asset_sha256: sha(text), chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }],
}));
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "alexa_consent", definition_revision: 1,
    definition_digest: sha("definition"), definition: "Activación sin consentimiento de Alexa+",
    inclusion: ["Sin permiso"], exclusion: ["Activación solicitada"] }, roots,
};
const one = buildSignalWorkspaceInterestDecisionPageManifestV1({ page: { ...page, roots: roots.slice(0, 1) },
  expected_root_ids: [roots[0]!.root_id] });
const two = buildSignalWorkspaceInterestDecisionPageManifestV1({ page, expected_root_ids: roots.map(root => root.root_id),
  max_request_bytes: one.requests[0]!.provider_request_bytes });
assert.equal(two.requests.length, 2);
const thirdRoot = { ...roots[0]!, root_id: randomUUID(), fingerprint: sha("third-root") };
const threeRoots = [...roots, thirdRoot];
const three = buildSignalWorkspaceInterestDecisionPageManifestV1({ page: { ...page, roots: threeRoots },
  expected_root_ids: threeRoots.map(root => root.root_id), max_request_bytes: one.requests[0]!.provider_request_bytes });
assert.equal(three.requests.length, 3);
const state = (count: number, ended: boolean): AnthropicBatchState => ({ id: "msgbatch_test",
  processing_status: ended ? "ended" : "in_progress",
  request_counts: { processing: ended ? 0 : count, succeeded: ended ? count : 0,
    errored: 0, canceled: 0, expired: 0 }, ended_at: ended ? new Date(0).toISOString() : null,
  results_url: ended ? "https://example.invalid/results" : null });
function itemFor(request: typeof one.requests[number]): { item: AnthropicBatchItem; rawText: string } {
  const source = request.request.roots[0]!;
  const output = { contract_version: request.request.contract_version, request_digest: request.request.request_digest,
    interest_identity_digest: signalWorkspaceEmbeddingDigestV1(request.request.interest),
    decisions: [{ root_id: source.root_id, root_fingerprint: source.fingerprint,
      asset_sha256: source.asset_sha256, verdict: "belongs", rationale: "Reporta falta de permiso.",
      citations: [{ chunk_index: 0, chunk_sha256: source.chunks[0]!.chunk_sha256,
        quote_start: 0, quote_end: 6, quote: source.chunks[0]!.text.slice(0, 6), role: "supports" }] }] };
  const item: AnthropicBatchItem = { custom_id: request.provider_request.custom_id,
    result: { type: "succeeded", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-6",
      stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }],
      usage: { input_tokens: 100, output_tokens: 50 } } } };
  return { item, rawText: JSON.stringify(item) };
}
function harness(manifest = one) {
  const events: string[] = [];
  const lease: SignalWorkspaceInterestDecisionBatchLeaseV1 = { batch_id: randomUUID(), lease_token: randomUUID(),
    state: "prepared", provider_batch_id: null, manifest };
  const persisted = new Map<string, string>();
  const stores: SignalWorkspaceInterestDecisionBatchStoresV1 = {
    async claimDue() { events.push("claim"); return lease; },
    async reserveAndMarkSubmitting() { events.push("reserve"); lease.state = "submitting"; },
    async attachProviderBatch(_lease, providerState) { events.push("attach"); lease.provider_batch_id = providerState.id;
      lease.state = providerState.processing_status; },
    async markSubmissionUnknown(_lease, _code, acknowledged, receipt) {
      events.push(acknowledged ? "unknown_ack" : receipt ? `unknown_${receipt.http_status}` : "unknown");
      lease.state = "submission_unknown"; },
    async markKnownRejection(_lease, _code, receipt) { events.push(`reject_${receipt?.http_status ?? "missing"}`);
      lease.state = "submission_unknown"; },
    async recordPoll(_lease, providerState) { events.push("poll"); lease.state = providerState.processing_status; },
    async persistRawAndSettle(_lease, result) {
      events.push(`raw_${result.custom_id}`);
      const previous = persisted.get(result.custom_id);
      if (previous && previous !== result.raw_sha256) throw new Error("receipt_conflict");
      persisted.set(result.custom_id, result.raw_sha256);
      return { raw_sha256: result.raw_sha256, settlement: "settled" as const, replayed: !!previous };
    },
    async recordOutcome(_lease, result) { assert.ok(persisted.has(result.custom_id)); events.push(`outcome_${result.status}`); },
    async finishImport(_lease, result) { events.push(`finish_${result.status}`); },
    async releaseLease() { events.push("release"); },
  };
  return { stores, lease, events, persisted };
}
type Provider = ReturnType<typeof createAnthropicMessageBatchesClient>;
function fakeProvider(manifest = one, options: { entries?: ReturnType<typeof itemFor>[];
  create?: () => Promise<AnthropicBatchState>; poll_state?: AnthropicBatchState } = {}) {
  const events: string[] = [];
  const entries = options.entries ?? manifest.requests.map(itemFor);
  const provider: Provider = {
    async create(requests) { events.push("create"); assert.deepEqual(requests,
      manifest.requests.map(request => request.provider_request)); return options.create?.() ?? state(manifest.requests.length, false); },
    async get() { events.push("get"); return options.poll_state ?? state(manifest.requests.length, true); },
    async cancel() { throw new Error("unexpected_cancel"); },
    async *results() { events.push("results"); for (const entry of entries) yield entry; },
  };
  return { provider, events };
}

test("reserve precedes the only CREATE; raw bytes and settlement precede outcome/checkpoint", async () => {
  const { stores, events } = harness();
  const mock = fakeProvider();
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores, provider: mock.provider }), "submitted");
  assert.ok(events.indexOf("reserve") < events.indexOf("attach"));
  assert.deepEqual(mock.events, ["create"]);
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores, provider: mock.provider }), "imported");
  assert.deepEqual(mock.events, ["create", "get", "results"]);
  assert.ok(events.findIndex(event => event.startsWith("raw_")) < events.indexOf("outcome_accepted"));
  assert.ok(events.indexOf("outcome_accepted") < events.indexOf("finish_ready_for_review"));
});

test("reservation or lease failure blocks HTTP before POST", async () => {
  const h = harness(), mock = fakeProvider();
  h.stores.reserveAndMarkSubmitting = async () => { throw new Error("lease_lost"); };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }), "retry_read");
  assert.deepEqual(mock.events, []);
  assert.equal(h.events.at(-1), "release");
});

test("an authority change at the SQL send fence remains visible without a POST", async () => {
  const h = harness(), mock = fakeProvider();
  let recordedCode: string | null = null;
  h.stores.reserveAndMarkSubmitting = async () => { throw new Error("interest_decision_batch_authority_invalid"); };
  h.stores.releaseLease = async (_lease, result) => { recordedCode = result.error_code; };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }),
    "retry_read");
  assert.equal(recordedCode, "workspace_interest_batch_authority_changed");
  assert.deepEqual(mock.events, []);
});

test("lost HTTP response and stale submitting lease quarantine the same batch", async () => {
  const h = harness();
  let posts = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => {
    posts++; throw new Error("connection_lost_after_post");
  } });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider }), "submission_unknown");
  assert.equal(posts, 1);
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider }), "submission_unknown");
  assert.equal(posts, 1);
  assert.ok(h.events.includes("reserve"));
  assert.ok(h.events.includes("unknown"));
});

test("known HTTP rejection stores its private receipt and does not import", async () => {
  const h = harness();
  let posts = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => {
    posts++; return new Response('{"type":"error","error":{"type":"invalid_request_error"}}', { status: 400 });
  } });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider }), "known_rejection");
  assert.equal(posts, 1);
  assert.ok(h.events.includes("reject_400"));
  assert.ok(h.events.every(event => !event.startsWith("raw_") && !event.startsWith("outcome_")));
});

test("409 and 429 quarantine their HTTP receipts without re-posting", async () => {
  for (const status of [409, 429]) {
    const h = harness(); let posts = 0;
    const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => {
      posts++; return new Response('{"type":"error"}', { status });
    } });
    assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider }), "submission_unknown");
    assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider }), "submission_unknown");
    assert.equal(posts, 1);
    assert.ok(h.events.includes(`unknown_${status}`));
    assert.ok(h.events.every(event => !event.startsWith("reject_")));
  }
});

test("ACK storage failure retains known provider identity for reconciliation without a second POST", async () => {
  const h = harness(), mock = fakeProvider();
  h.stores.attachProviderBatch = async () => { throw new Error("db_unavailable"); };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }), "submission_unknown");
  assert.ok(h.events.includes("unknown_ack"));
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }), "submission_unknown");
  assert.deepEqual(mock.events, ["create"]);
});

test("provider item error is a recovery state, never a negative membership", async () => {
  const h = harness(), errored: AnthropicBatchItem = {
    custom_id: one.requests[0]!.provider_request.custom_id, result: { type: "errored", error: { type: "api_error" } } };
  const entry = { item: errored, rawText: JSON.stringify(errored) };
  const poll_state = { ...state(1, true), request_counts: { processing: 0, succeeded: 0,
    errored: 1, canceled: 0, expired: 0 } };
  const mock = fakeProvider(one, { entries: [entry], poll_state });
  await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }), "needs_recovery");
  assert.ok(h.events.includes("outcome_provider_error"));
  assert.ok(h.events.includes("finish_needs_recovery"));
  assert.ok(!h.events.includes("finish_ready_for_review"));
});

test("missing result coverage retries GET; bounded import advances through replayed raw receipts", async () => {
  const h = harness(three);
  const entries = three.requests.map(itemFor);
  let returned = entries.slice(0, 1);
  const mock = fakeProvider(three, { entries: returned });
  await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider }), "retry_read");
  assert.equal(h.persisted.size, 1);
  assert.ok(!h.events.includes("finish_ready_for_review"));
  returned = entries;
  mock.provider.results = async function* () { for (const entry of returned) yield entry; };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider,
    import_items_per_tick: 1 }), "waiting");
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores, provider: mock.provider,
    import_items_per_tick: 1 }), "imported");
  assert.equal(h.persisted.size, 3);
  assert.ok(h.events.includes("finish_ready_for_review"));
  assert.deepEqual(mock.events.filter(event => event === "create"), ["create"]);
});
