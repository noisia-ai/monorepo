import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSignalWorkspaceInterpretationBatchV1, signalWorkspaceInterpretationReferenceIdV1,
  buildSignalWorkspaceInterpretationRepairBatchV1,
  SIGNAL_WORKSPACE_INTERPRETATION_LEGACY_OPUS_CONFIGURATION_V1 as legacyConfig,
  signalWorkspaceInterpretationCostV1,
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
  definition: "Discussion of delivery experiences", inclusion: [], exclusion: [], citations: ["r1"] }] };
function response(overrides: Record<string, unknown> = {}) {
  return { id: "msg_fixture", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 20,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...overrides };
}
const base = { batch, api_key: "test_only_not_a_real_api_key", provider_enabled: true };
function fakeFetch(handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => handler(input, init)) as typeof fetch;
}
function manualTimeout() {
  const durations: number[] = []; let callback: (() => void) | undefined, cancellations = 0;
  return {
    durations, get cancellations() { return cancellations; },
    schedule_timeout: (onTimeout: () => void, milliseconds: number) => {
      durations.push(milliseconds); callback = onTimeout;
      return () => { cancellations++; callback = undefined; };
    },
    fire: () => { assert.ok(callback); callback(); },
  };
}
test("new Sonnet requests seal the model and its rates into the body and reservation", async () => {
  assert.equal(batch.configuration.model, "claude-sonnet-4-6");
  assert.equal(JSON.parse(batch.request_body).model, "claude-sonnet-4-6");
  assert.equal(batch.reserved_micro_usd, signalWorkspaceInterpretationCostV1({ input_tokens: batch.input_token_upper_bound,
    output_tokens: batch.configuration.max_output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, batch.configuration));
  const result = await sendWorkspaceInterpretationV1({ ...base, authorize_send: async () => true,
    persist_receipt: async () => undefined, fetch_impl: fakeFetch((_url, init) => {
      assert.equal(init?.body, batch.request_body); return Response.json(response());
    }) });
  assert.equal(result.outcome, "validated"); assert.ok(result.usage);
  assert.equal(signalWorkspaceInterpretationCostV1(result.usage, batch.configuration), 600);
  assert.equal(signalWorkspaceInterpretationCostV1(result.usage, legacyConfig), 1_000);
});
test("historical Opus original and repair receipts replay, but neither may claim or send", async () => {
  const original = buildSignalWorkspaceInterpretationBatchV1(context, [group], legacyConfig);
  const repair = buildSignalWorkspaceInterpretationRepairBatchV1(original, {
    source_call_id: "00000000-0000-4000-8000-000000000004", source_response_sha256: sha("historical raw"), diagnostic: "output_invalid" });
  let claims = 0, sends = 0, receipts = 0; const timer = manualTimeout();
  for (const historical of [original, repair]) {
    const raw = JSON.stringify(response({ model: "claude-opus-5", content: [{ type: "text", text: JSON.stringify({
      interpretations: [{ ...output.interpretations[0], citations: [group.representatives[0]!.ref_id] }] }) }] }));
    const replay = validateWorkspaceInterpretationReceiptV1(historical, { bytes: new TextEncoder().encode(raw), sha256: sha(raw),
      http_status: 200, provider_request_id: "req_historical", complete: true });
    assert.equal(replay.outcome, "validated"); assert.equal(JSON.parse(historical.request_body).model, "claude-opus-5");
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, batch: historical, schedule_timeout: timer.schedule_timeout,
      authorize_send: async () => { claims++; return true; }, persist_receipt: async () => { receipts++; },
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }) }),
    error => error instanceof WorkspaceInterpretationTransportErrorV1
      && error.code === "workspace_engine_interpretation_provider_model_disabled" && error.outcome === "definitely_not_sent");
  }
  assert.equal(claims, 0); assert.equal(sends, 0); assert.equal(receipts, 0); assert.deepEqual(timer.durations, []);
});
test("a receipt from another supported model is never settled against the requested profile", async () => {
  const legacy = buildSignalWorkspaceInterpretationBatchV1(context, [group], legacyConfig);
  for (const [requested, reported] of [[batch, legacyConfig.model], [legacy, batch.configuration.model]] as const) {
    const raw = JSON.stringify(response({ model: reported }));
    const result = validateWorkspaceInterpretationReceiptV1(requested, { bytes: new TextEncoder().encode(raw), sha256: sha(raw),
      http_status: 200, provider_request_id: "req_wrong_model", complete: true });
    assert.equal(result.error_code, "workspace_engine_interpretation_response_model_invalid");
    assert.equal(result.outcome, "outcome_unknown"); assert.equal(result.usage, null);
  }
});
test("default ten-minute deadline and supported overrides preserve the sealed request without waiting", async () => {
  for (const timeout_ms of [undefined, 1, 600_000]) {
    const timer = manualTimeout(); let claims = 0, sends = 0, receipts = 0;
    const result = await sendWorkspaceInterpretationV1({ ...base, timeout_ms, schedule_timeout: timer.schedule_timeout,
      authorize_send: async () => { claims++; return true; },
      persist_receipt: async () => { receipts++; },
      fetch_impl: fakeFetch((_url, init) => {
        sends++; assert.equal(init?.body, batch.request_body); assert.equal(init?.signal?.aborted, false);
        return Response.json(response());
      }),
    });
    assert.deepEqual(timer.durations, [timeout_ms ?? 600_000]); assert.equal(timer.cancellations, 1);
    assert.equal(claims, 1); assert.equal(sends, 1); assert.equal(receipts, 1); assert.equal(result.outcome, "validated");
  }
});
test("timeout before response is a distinct unknown after one send and never invents a receipt", async () => {
  const timer = manualTimeout(); let claims = 0, sends = 0, receipts = 0;
  await assert.rejects(sendWorkspaceInterpretationV1({ ...base, timeout_ms: 7, schedule_timeout: timer.schedule_timeout,
    authorize_send: async () => { claims++; return true; }, persist_receipt: async () => { receipts++; },
    fetch_impl: fakeFetch((_url, init) => {
      sends++; assert.equal(init?.body, batch.request_body);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException(base.api_key, "AbortError")), { once: true });
        queueMicrotask(timer.fire);
      });
    }),
  }), error => error instanceof WorkspaceInterpretationTransportErrorV1
    && error.code === "workspace_engine_interpretation_timeout_outcome_unknown" && error.outcome === "outcome_unknown"
    && !error.message.includes(base.api_key));
  assert.deepEqual(timer.durations, [7]); assert.equal(timer.cancellations, 1);
  assert.equal(claims, 1); assert.equal(sends, 1); assert.equal(receipts, 0);
});
test("timeout while reading preserves the partial HTTP receipt and never claims known usage", async () => {
  const timer = manualTimeout(); let sends = 0, receipt: WorkspaceInterpretationRawReceiptV1 | undefined;
  const prefix = new TextEncoder().encode('{"type":"message",');
  const result = await sendWorkspaceInterpretationV1({ ...base, timeout_ms: 5, schedule_timeout: timer.schedule_timeout,
    authorize_send: async () => true, persist_receipt: async value => { receipt = value; },
    fetch_impl: fakeFetch((_url, init) => {
      sends++; let reads = 0;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException(base.api_key, "AbortError")), { once: true }); },
        pull(controller) { if (reads++ === 0) controller.enqueue(prefix); else queueMicrotask(timer.fire); },
      }), { headers: { "request-id": "req_partial_timeout" } });
    }),
  });
  assert.equal(sends, 1); assert.ok(receipt); assert.deepEqual(receipt.bytes, prefix); assert.equal(receipt.complete, false);
  assert.equal(receipt.provider_request_id, "req_partial_timeout"); assert.equal(result.usage, null);
  assert.equal(result.outcome, "outcome_unknown"); assert.equal(result.error_code, "workspace_engine_interpretation_timeout_outcome_unknown");
  assert.equal(timer.cancellations, 1);
});
test("malformed timeouts are rejected before CAS, scheduling, receipt or send", async () => {
  let claims = 0, sends = 0, receipts = 0; const timer = manualTimeout();
  for (const timeout_ms of [0, -1, 600_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, "600000", {}]) {
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, timeout_ms: timeout_ms as number, schedule_timeout: timer.schedule_timeout,
      authorize_send: async () => { claims++; return true; }, persist_receipt: async () => { receipts++; },
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }),
    }), error => error instanceof WorkspaceInterpretationTransportErrorV1
      && error.code === "workspace_engine_interpretation_provider_configuration_invalid" && error.outcome === "definitely_not_sent");
  }
  assert.equal(claims, 0); assert.equal(sends, 0); assert.equal(receipts, 0); assert.deepEqual(timer.durations, []);
});
test("a dated spending grant blocks sends at expiry, including time spent awaiting CAS", async () => {
  const expires = "2026-01-02T06:00:00.000Z", deadline = Date.parse(expires);
  for (const expiresDuringCas of [false, true]) {
    let now = deadline - (expiresDuringCas ? 1 : 0), claims = 0, sends = 0, receipts = 0;
    const timer = manualTimeout();
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, authorization_expires_at: expires,
      now_milliseconds: () => now, schedule_timeout: timer.schedule_timeout,
      authorize_send: async () => { claims++; now = deadline; return true; },
      persist_receipt: async () => { receipts++; },
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }),
    }), error => error instanceof WorkspaceInterpretationTransportErrorV1
      && error.code === "workspace_engine_interpretation_daily_authority_expired" && error.outcome === "definitely_not_sent");
    assert.equal(claims, expiresDuringCas ? 1 : 0); assert.equal(sends, 0); assert.equal(receipts, 0);
    assert.deepEqual(timer.durations, []);
  }
});
test("an admitted send may finish after grant expiry without losing its response or changing the request", async () => {
  const expires = "2026-01-02T06:00:00.000Z", deadline = Date.parse(expires);
  let now = deadline - 1, sends = 0, receipts = 0;
  const result = await sendWorkspaceInterpretationV1({ ...base, authorization_expires_at: expires,
    now_milliseconds: () => now, authorize_send: async () => true,
    persist_receipt: async () => { receipts++; },
    fetch_impl: fakeFetch((_url, init) => {
      sends++; assert.equal(init?.body, batch.request_body); now = deadline + 1;
      assert.equal(init?.signal?.aborted, false); return Response.json(response());
    }),
  });
  assert.equal(sends, 1); assert.equal(receipts, 1); assert.equal(result.outcome, "validated");
});
test("malformed dated grants fail before CAS and an ambiguous CAS stays unknown when the date expires", async () => {
  let claims = 0, sends = 0;
  for (const value of [null, 123, "", "tomorrow", "2026-02-30T06:00:00.000Z", "2026-01-02", "2026-01-02T06:00:00Z"]) {
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, authorization_expires_at: value as string,
      authorize_send: async () => { claims++; return true; }, persist_receipt: async () => undefined,
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }),
    }), error => error instanceof WorkspaceInterpretationTransportErrorV1
      && error.code === "workspace_engine_interpretation_provider_configuration_invalid" && error.outcome === "definitely_not_sent");
  }
  assert.equal(claims, 0); assert.equal(sends, 0);
  const expires = "2026-01-02T06:00:00.000Z", deadline = Date.parse(expires); let now = deadline - 1;
  await assert.rejects(sendWorkspaceInterpretationV1({ ...base, authorization_expires_at: expires, now_milliseconds: () => now,
    authorize_send: async () => { now = deadline; throw new Error("private CAS failure"); },
    persist_receipt: async () => undefined, fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }),
  }), error => error instanceof WorkspaceInterpretationTransportErrorV1
    && error.code === "workspace_engine_interpretation_send_authority_unknown" && error.outcome === "outcome_unknown");
  assert.equal(sends, 0);
});
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
  assert.deepEqual(result.interpretations?.[0]?.citations, [group.representatives[0]!.ref_id]);
  assert.deepEqual(JSON.parse(JSON.parse(new TextDecoder().decode((receipt as WorkspaceInterpretationRawReceiptV1).bytes)).content[0].text).interpretations[0].citations, ["r1"]);
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
test("editorial repair sends only its canonical sealed request and preserves the same citation checks", async () => {
  const repair = buildSignalWorkspaceInterpretationRepairBatchV1(batch, {
    source_call_id: "00000000-0000-4000-8000-000000000091", source_response_sha256: sha("retained invalid response"), diagnostic: "output_invalid",
  });
  let sends = 0, cas = 0, receipts = 0;
  const result = await sendWorkspaceInterpretationV1({ ...base, batch: repair,
    authorize_send: async () => { cas++; return true; }, persist_receipt: async () => { receipts++; },
    fetch_impl: fakeFetch((_url, init) => { sends++; assert.equal(init?.body, repair.request_body); return Response.json(response()); }),
  });
  assert.equal(result.outcome, "validated"); assert.equal(sends, 1); assert.equal(receipts, 1);
  for (const changed of [
    { ...repair, request_body: repair.request_body + " " },
    { ...repair, editorial_repair: { ...repair.editorial_repair!, source_request_digest: sha("foreign source") } },
    { ...repair, editorial_repair: { ...repair.editorial_repair!, protocol_digest: sha("changed instruction") } },
  ]) {
    await assert.rejects(sendWorkspaceInterpretationV1({ ...base, batch: changed,
      authorize_send: async () => { cas++; return true; }, persist_receipt: async () => { receipts++; },
      fetch_impl: fakeFetch(() => { sends++; return Response.json(response()); }),
    }), /request_invalid/u);
  }
  assert.equal(cas, 1); assert.equal(sends, 1); assert.equal(receipts, 1);
  const bad = response({ content: [{ type: "text", text: JSON.stringify({ interpretations: [{ ...output.interpretations[0], citations: ["x"] }] }) }] });
  const bytes = new TextEncoder().encode(JSON.stringify(bad));
  assert.equal(validateWorkspaceInterpretationReceiptV1(repair, { bytes, sha256: sha(JSON.stringify(bad)), http_status: 200, provider_request_id: "req_retained", complete: true }).outcome, "known_response_invalid");
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
    error => error instanceof WorkspaceInterpretationTransportErrorV1 && error.outcome === "outcome_unknown" && !error.message.includes(base.api_key)
      && error.code === `workspace_engine_interpretation_${phase === "fetch" ? "transport_outcome_unknown" : "receipt_persistence_unknown"}`);
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
