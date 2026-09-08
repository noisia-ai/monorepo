import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSignalWorkspaceInterpretationBatchV1, signalWorkspaceInterpretationReferenceIdV1,
  type SignalWorkspaceInterpretationClusterV1 } from "@noisia/query-engine";
import { sendWorkspaceInterpretationV1, validateWorkspaceInterpretationReceiptV1, WorkspaceInterpretationTransportErrorV1,
  type WorkspaceInterpretationRawReceiptV1 } from "./workspace-interpretation.js";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const context = { workspace_id: "00000000-0000-4000-8000-000000000001", execution_id: "00000000-0000-4000-8000-000000000002",
  context_digest: sha("governedcontext"), data: { interests: [] } };
const text = "Delivery experience 🌞", identity = { root_id: "00000000-0000-4000-8000-000000000003", chunk_index: 0,
  start: 0, end: text.length, chunk_sha256: sha(text) };
const group: SignalWorkspaceInterpretationClusterV1 = { cluster_id: "open:fixture", lane: "open", cluster_digest: sha("whole membership"),
  root_count: 100, chunk_count: 105, terms: ["delivery"], representatives: [{ ...identity, ref_id: signalWorkspaceInterpretationReferenceIdV1(identity),
    text, strength: 0.8, selection_reason: "high_affiliation" }] };
const batch = buildSignalWorkspaceInterpretationBatchV1(context, [group]);
const output = { interpretations: [{ cluster_id: group.cluster_id, cluster_digest: group.cluster_digest, status: "coherent", name: "Delivery experience",
  definition: "Discussion of delivery experiences", inclusion: [], exclusion: [], citations: [group.representatives[0]!.ref_id] }] };
function response(overrides: Record<string, unknown> = {}) {
  return { id: "msg_fixture", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 20,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...overrides };
}
const base = { batch, api_key: "test_only_not_a_real_api_key", provider_enabled: true };
function fakeFetch(handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => handler(input, init)) as typeof fetch;
}
test("exactly one authorized send persists raw receipt before validation; replay needs zero sends", async () => {
  const events: string[] = []; let receipt: WorkspaceInterpretationRawReceiptV1 | null = null;
  const result = await sendWorkspaceInterpretationV1({ ...base,
    authorize_send: async () => { events.push("durableCAS"); return true; },
    persist_receipt: async value => { events.push("durableReceipt"); receipt = value; },
    fetch_impl: fakeFetch((url, init) => {
      events.push("send"); assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init?.redirect, "error"); assert.equal(init?.method, "POST"); assert.equal(init?.body, batch.request_body);
      assert.equal(new Headers(init?.headers).get("anthropic-version"), "2023-06-01");
      return Response.json(response(), { headers: { "request-id": "req_fixture" } });
    }),
  });
  assert.deepEqual(events, ["durableCAS", "send", "durableReceipt"]);
  assert.equal(result.outcome, "validated"); assert.equal(result.usage?.input_tokens, 100);
  assert.equal(result.interpretations?.length, 1); assert.ok(receipt);
  assert.deepEqual(validateWorkspaceInterpretationReceiptV1(batch, receipt), result);
  assert.equal(events.filter(event => event === "send").length, 1);
});
test("known usage survives invalid schema, foreign citations and max_tokens without retry", async () => {
  for (const overrides of [
    { content: [{ type: "text", text: "not JSON" }] },
    { content: [{ type: "text", text: JSON.stringify({ interpretations: [{ ...output.interpretations[0], citations: [sha("foreign")] }] }) }] },
    { stop_reason: "max_tokens" },
  ]) {
    let sends = 0, saved = false;
    const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
      persist_receipt: async () => { saved = true; }, fetch_impl: fakeFetch(() => { sends++; return Response.json(response(overrides)); }) });
    assert.equal(saved, true); assert.equal(sends, 1); assert.equal(result.outcome, "known_response_invalid");
    assert.equal(result.usage?.output_tokens, 20); assert.equal(result.interpretations, null);
  }
});
test("a different reported model retains raw usage without settling at the requested model's rates", async () => {
  let receipt: WorkspaceInterpretationRawReceiptV1 | undefined;
  const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
    persist_receipt: async value => { receipt = value; }, fetch_impl: fakeFetch(() => Response.json(response({ model: "claude-fable-5-1" }))) });
  assert.ok(receipt); assert.equal(JSON.parse(new TextDecoder().decode(receipt.bytes)).usage.output_tokens, 20);
  assert.equal(result.outcome, "outcome_unknown"); assert.equal(result.usage, null);
  assert.match(result.error_code!, /model_invalid/u);
});
test("raw non2xx and invalid provider JSON are retained even without trustworthy usage", async () => {
  for (const value of [new Response("private provider failure", { status: 503 }), new Response("{broken", { status: 200 }),
    Response.json(response({ usage: { input_tokens: 100, output_tokens: -1 } }))]) {
    let saved = false, sends = 0;
    const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
      persist_receipt: async receipt => { saved = true; assert.ok(receipt.bytes.length); },
      fetch_impl: fakeFetch(() => { sends++; return value; }) });
    assert.equal(saved, true); assert.equal(sends, 1); assert.equal(result.outcome, "outcome_unknown"); assert.equal(result.usage, null);
  }
});
test("partial and oversized HTTP receipts retain bytes but never establish metering completeness", async () => {
  const prefix = new TextEncoder().encode(JSON.stringify(response()));
  for (const kind of ["disconnect", "length", "oversized"] as const) {
    let reads = 0, receipt: WorkspaceInterpretationRawReceiptV1 | undefined;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(kind === "oversized" ? new Uint8Array(2_097_153) : prefix);
      else if (kind === "disconnect") controller.error(new Error("private socket error"));
      else controller.close();
    } });
    const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
      persist_receipt: async value => { receipt = value; },
      fetch_impl: fakeFetch(() => new Response(stream, { headers: kind === "length" ? { "content-length": String(prefix.length + 1) } : {} })) });
    assert.ok(receipt); assert.equal(receipt.complete, false); assert.ok(receipt.bytes.length <= 2_097_152);
    assert.equal(result.outcome, "outcome_unknown"); assert.equal(result.usage, null);
  }
});
test("disabled, missing key and tampered seal fail before CAS or transport", async () => {
  let sends = 0, claims = 0;
  for (const extra of [{ provider_enabled: false }, { api_key: "" }, { batch: { ...batch, reserved_micro_usd: 1 } },
    { batch: { ...batch, request_body: batch.request_body + " " } }]) {
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, ...extra, authorize_send: async () => { claims++; return true; },
      persist_receipt: async () => undefined, fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }) }),
    error => error instanceof WorkspaceInterpretationTransportErrorV1 && error.outcome === "definitely_not_sent");
  }
  assert.equal(sends, 0); assert.equal(claims, 0);
});
test("CAS conflict and ambiguous CAS never release another process's reservation", async () => {
  let sends = 0;
  for (const authorize_send of [async () => false, async () => { throw new Error("private database detail"); }]) {
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, authorize_send, persist_receipt: async () => undefined,
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }) }),
    error => error instanceof WorkspaceInterpretationTransportErrorV1 && error.outcome === "outcome_unknown" && !error.message.includes("private"));
  }
  assert.equal(sends, 0);
});
test("receipt persistence failure and transport exceptions are unknown and never retry or leak key", async () => {
  for (const phase of ["fetch", "persist"] as const) {
    let sends = 0;
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
      persist_receipt: async () => { throw new Error(base.api_key); },
      fetch_impl: fakeFetch(() => { sends++; if (phase === "fetch") throw new Error(base.api_key); return Response.json(response()); }) }),
    error => error instanceof WorkspaceInterpretationTransportErrorV1 && error.outcome === "outcome_unknown" && !error.message.includes(base.api_key));
    assert.equal(sends, 1);
  }
});
test("fixed endpoint never follows a third-party redirect", async () => {
  let sends = 0, saved = false;
  const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true, persist_receipt: async () => { saved = true; },
    fetch_impl: fakeFetch((_url, init) => { sends++; assert.equal(init?.redirect, "error");
      return new Response("redirect", { status: 302, headers: { location: "https://invalid.example/private" } }); }) });
  assert.equal(saved, true); assert.equal(sends, 1); assert.equal(result.outcome, "outcome_unknown");
});
