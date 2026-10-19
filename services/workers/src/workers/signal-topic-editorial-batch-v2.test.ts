import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildSignalTopicEditorialScreeningPlanV2, signalTopicEditorialDigestV1 as sha,
  type SignalTopicEditorialScreeningGroupV1 } from "@noisia/query-engine";
import { createAnthropicMessageBatchesClient, type AnthropicBatchState } from "../providers/anthropic-message-batches";
import { runSignalTopicEditorialBatchTickV2, type SignalTopicEditorialBatchLeaseV2,
  type SignalTopicEditorialBatchStoresV2 } from "./signal-topic-editorial-batch-v2";

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function sourceGroup(index: number): SignalTopicEditorialScreeningGroupV1 {
  const text = `Con Alexa+ programo luces de mi casa, experiencia ${index}.`, root_id = uuid(index + 1);
  const chunk_sha256 = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  const pointer = { root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256 };
  const evidence = [{ ...pointer, ref_id: sha(pointer), text, locale: "es-MX", platform: "reddit", occurred_at: "2026-09-12T00:00:00.000Z" }];
  const values = { scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 },
    locale_counts: [{ key: "es-MX", count: 1 }], platform_counts: [{ key: "reddit", count: 1 }],
    month_counts: [{ key: "2026-09", count: 1 }], brand_affinity: { positive: [], negative: [], abstention: [] },
    neighbors: [], metrics: { cohesion: null, outlier_ratio: null } };
  const dossier = { contract_version: "signal-topic-group-dossier-v1", ...values,
    evidence: evidence.map(({ text: _text, ...item }) => item) };
  return { ...values, group_key: `open:cluster-${index}`, lane: "open", group_digest: sha(["group", index]),
    source_dossier_digest: sha(dossier), dossier_digest: sha(dossier), community_key: "community-1",
    root_count: 1, chunk_count: 1, terms: ["Alexa+", "luces"], evidence };
}
function fixture(count = 3) {
  const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Asistente doméstico con IA.",
    audiences: ["hogares"], categories: ["asistentes de voz"], competitors: [], positive_anchors: ["automatización"],
    negative_anchors: ["Alexandra"], abstention_anchors: ["ambiguo"] };
  const plan = buildSignalTopicEditorialScreeningPlanV2({ workspace_id: uuid(100), run_id: uuid(101),
    expected_group_count: count, source_context_digest: sha("context"), editorial_context_digest: sha(context), context,
    groups: Array.from({ length: count }, (_, i) => sourceGroup(i)) });
  const lease: SignalTopicEditorialBatchLeaseV2 = { batch_id: uuid(200), lease_token: uuid(201), state: "prepared",
    provider_batch_id: null, items: plan.requests.map((request, i) => ({ call_id: uuid(300 + i), request })) };
  const state: AnthropicBatchState = { id: "msgbatch_real_fixture", processing_status: "ended", ended_at: "2026-09-26T00:00:00Z",
    results_url: null, request_counts: { processing: 0, succeeded: count, errored: 0, canceled: 0, expired: 0 } };
  const outputs = plan.requests.map(request => ({ custom_id: request.provider_request.custom_id, result: { type: "succeeded",
    message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 800 }, content: [{ type: "text", text: JSON.stringify({
        contract_version: "signal-topic-editorial-group-output-v2", group_id: request.receipt.group_id, disposition: "topic",
        candidate: { label: "Automatización doméstica", definition: "Luces y otras rutinas domésticas.", locale: "es-MX" },
        confidence: 0.9, rationale: "á".repeat(329) + "x", cited_evidence_ids: [request.receipt.evidence[0]!.evidence_id],
      }) }] } } }));
  const rawReceipts = new Map<string, string>();
  const releases: Array<{ next_poll_at: string | null; error_code: string | null }> = [];
  let finished = false, rejected = false, uncertain = false;
  let beforeSend: (() => void) | null = null, attachAckLost = false, validationAckLost = false;
  const stores: SignalTopicEditorialBatchStoresV2 = {
    claimDue: async () => finished || rejected || uncertain ? null : structuredClone(lease),
    markSubmitting: async () => { beforeSend?.(); lease.state = "submitting"; },
    attachProviderBatch: async (_lease, response) => {
      lease.provider_batch_id = response.id; lease.state = "in_progress";
      if (attachAckLost) { attachAckLost = false; throw new Error("lost db ack"); }
    },
    markSubmissionUncertain: async () => { lease.state = "submission_unknown"; uncertain = true; },
    markSubmissionRejected: async () => { rejected = true; },
    recordPoll: async (_lease, response) => { lease.state = response.processing_status; },
    persistItem: async (_lease, receipt) => {
      const existing = rawReceipts.get(receipt.custom_id);
      if (existing) assert.equal(existing, receipt.raw_text);
      rawReceipts.set(receipt.custom_id, receipt.raw_text);
      lease.items.find(item => item.call_id === receipt.call_id)!.raw_sha256 = receipt.raw_sha256;
    },
    recordValidation: async (_lease, result) => {
      lease.items.find(item => item.request.provider_request.custom_id === result.custom_id)!.validation = result.validation;
      if (validationAckLost) { validationAckLost = false; throw new Error("validation ack lost"); }
    },
    finishImport: async (_lease, receipt) => { assert.equal(new Set(receipt.received_custom_ids).size, count); finished = true; },
    release: async (_lease, value) => { releases.push(value); },
  };
  let creates = 0, gets = 0, results = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "fixture-not-a-key", fetch: async (url, init) => {
    if (init?.method === "POST") { creates++; return Response.json(state); }
    if (String(url).endsWith("/results")) { results++; return new Response(outputs.map(item => JSON.stringify(item)).reverse().join("\n")); }
    gets++; return Response.json(state);
  } });
  return { lease, state, outputs, stores, provider, rawReceipts, releases,
    counts: () => ({ creates, gets, results, finished }),
    beforeSend: (value: () => void) => { beforeSend = value; },
    loseAttachAck: () => { attachAckLost = true; }, loseValidationAck: () => { validationAckLost = true; } };
}

test("one submit and short poll/import; full long text is persisted with provenance", async () => {
  const f = fixture();
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "submitted");
  assert.deepEqual(f.counts(), { creates: 1, gets: 0, results: 0, finished: false });
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "imported");
  assert.equal(f.counts().finished, true);
  assert.equal(f.rawReceipts.size, 3);
  for (const item of f.lease.items) {
    assert.equal(item.validation?.status, "accepted");
    if (item.validation?.status === "accepted") {
      assert.equal(Buffer.byteLength(item.validation.decision.rationale), 659);
      assert.equal(item.validation.decision.evidence_scope, "cited_evidence_only");
    }
  }
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "idle");
  assert.equal(f.counts().creates, 1);
});

test("one malformed model output does not block other groups or become Noise", async () => {
  const f = fixture();
  f.outputs[1]!.result.message.content[0]!.text = "malformed JSON";
  await runSignalTopicEditorialBatchTickV2(f);
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "imported");
  assert.deepEqual(f.lease.items.map(item => item.validation?.status), ["accepted", "invalid_output", "accepted"]);
  assert.equal(f.rawReceipts.size, 3);
});

test("mixed provider outcomes and max_tokens remain distinct and independent", async () => {
  const f = fixture(4);
  const bodies: unknown[] = [f.outputs[0], { custom_id: f.outputs[1]!.custom_id, result: { type: "errored", error: { type: "overloaded" } } },
    { custom_id: f.outputs[2]!.custom_id, result: { type: "expired" } }, f.outputs[3]];
  f.outputs[3]!.result.message.stop_reason = "max_tokens";
  f.state.request_counts = { processing: 0, succeeded: 2, errored: 1, canceled: 0, expired: 1 };
  const provider = createAnthropicMessageBatchesClient({ apiKey: "fixture", fetch: async (url) => String(url).endsWith("/results")
    ? new Response(bodies.map(item => JSON.stringify(item)).join("\n")) : Response.json(f.state) });
  await runSignalTopicEditorialBatchTickV2({ ...f, provider });
  assert.equal(await runSignalTopicEditorialBatchTickV2({ ...f, provider }), "imported");
  assert.deepEqual(f.lease.items.map(item => item.validation?.status), ["accepted", "provider_error", "expired", "max_tokens"]);
});

test("bounded import resumes across ticks using receipts, without a second POST", async () => {
  const f = fixture();
  await runSignalTopicEditorialBatchTickV2(f);
  for (let i = 0; i < 2; i++) assert.equal(await runSignalTopicEditorialBatchTickV2({ ...f, import_items_per_tick: 1 }), "waiting");
  assert.equal(await runSignalTopicEditorialBatchTickV2({ ...f, import_items_per_tick: 1 }), "imported");
  assert.deepEqual(f.counts(), { creates: 1, gets: 3, results: 3, finished: true });
  assert.equal(f.rawReceipts.size, 3);
});

test("lost submission response cannot cause a second POST on retry", async () => {
  const f = fixture();
  let posts = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "fixture", fetch: async () => { posts++; throw new Error("lost response"); } });
  assert.equal(await runSignalTopicEditorialBatchTickV2({ ...f, provider }), "submission_unknown");
  assert.equal(await runSignalTopicEditorialBatchTickV2({ ...f, provider }), "idle");
  assert.equal(posts, 1);
});

test("reclaimed submitting owner is quarantined without sending", async () => {
  const f = fixture(); f.lease.state = "submitting";
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "submission_unknown");
  assert.equal(f.counts().creates, 0);
});

test("lost attach or validation ACK reuses the committed result", async () => {
  for (const step of ["attach", "validation"]) {
    const f = fixture();
    if (step === "attach") f.loseAttachAck(); else f.loseValidationAck();
    const submit = await runSignalTopicEditorialBatchTickV2(f);
    assert.equal(submit, step === "attach" ? "retry_read" : "submitted");
    if (step === "validation") assert.equal(await runSignalTopicEditorialBatchTickV2(f), "retry_read");
    assert.equal(await runSignalTopicEditorialBatchTickV2(f), "imported");
    assert.equal(f.counts().creates, 1);
    assert.equal(f.rawReceipts.size, 3);
  }
});

test("expired authority cannot send, but already accepted work can finish after expiry", async () => {
  const blocked = fixture(); blocked.beforeSend(() => { throw new Error("topic_editorial_v2_authority_expired"); });
  assert.equal(await runSignalTopicEditorialBatchTickV2(blocked), "retry_read");
  assert.equal(blocked.counts().creates, 0);
  const accepted = fixture(); await runSignalTopicEditorialBatchTickV2(accepted);
  accepted.beforeSend(() => { assert.fail("receipt collection must not ask to send again"); });
  assert.equal(await runSignalTopicEditorialBatchTickV2(accepted), "imported");
});

test("changed paid receipt is rejected while the original remains intact", async () => {
  const f = fixture(); await runSignalTopicEditorialBatchTickV2(f);
  await runSignalTopicEditorialBatchTickV2({ ...f, import_items_per_tick: 1 });
  const prior = [...f.rawReceipts.values()];
  f.outputs[2]!.result.message.content[0]!.text = "changed receipt";
  assert.equal(await runSignalTopicEditorialBatchTickV2(f), "retry_read");
  assert.deepEqual([...f.rawReceipts.values()], prior);
  assert.equal(f.releases.at(-1)?.error_code, "topic_editorial_batch_receipt_changed");
});
