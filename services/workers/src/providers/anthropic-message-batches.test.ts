import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANTHROPIC_BATCH_RESULT_MAX_BYTES,
  AnthropicBatchTransportError,
  createAnthropicMessageBatchesClient,
  type AnthropicBatchState,
} from "./anthropic-message-batches";

const state: AnthropicBatchState = {
  id: "msgbatch_test", processing_status: "ended", ended_at: "2026-09-26T00:00:00Z",
  results_url: "https://untrusted.invalid/collect-key",
  request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 1, expired: 1 },
};
const request = { custom_id: "g_1", params: { model: "claude-sonnet-4-6", max_tokens: 128_000 } };
const ok = (custom_id: string, text = "válido 🔎") => ({
  custom_id, result: { type: "succeeded", message: {
    id: "msg_test", model: request.params.model, stop_reason: "end_turn",
    content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 20 },
  } },
});
const matches = (code: string, submission: string) => (error: unknown) => {
  assert.ok(error instanceof AnthropicBatchTransportError);
  assert.equal(error.code, code);
  assert.equal(error.submission, submission);
  assert.ok(!String(error).includes("test-secret"));
  return true;
};

test("create sends full output allowance once, with no provider retry", async () => {
  let calls = 0;
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.anthropic.com/v1/messages/batches");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-secret");
    assert.deepEqual(JSON.parse(String(init?.body)), { requests: [request] });
    return Response.json(state);
  } });
  assert.equal((await client.create([request])).id, state.id);
  assert.equal(calls, 1);
});

test("input rejection is known not submitted; it does not call fetch", async () => {
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () => {
    assert.fail("invalid input must not send");
  } });
  await assert.rejects(client.create([]), matches("batch_request_count_invalid", "not_submitted"));
  for (const requests of [
    [request, request], [{ ...request, custom_id: "mention/foreign" }],
    [{ ...request, params: { ...request.params, stream: true } }],
    [{ ...request, params: { ...request.params, max_tokens: 0 } }],
  ]) await assert.rejects(client.create(requests), matches("batch_request_invalid", "not_submitted"));
});

test("POST response loss, malformed success and HTTP500 are ambiguous, never retried", async () => {
  for (const response of [
    () => { throw new Error("network including test-secret"); },
    () => new Response("bad JSON"),
    () => Response.json({ ...state, id: "unexpected" }),
    () => new Response("provider body containing test-secret", { status: 500 }),
  ]) {
    let calls = 0;
    const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () => { calls++; return response(); } });
    await assert.rejects(client.create([request]), (error: unknown) => {
      assert.ok(error instanceof AnthropicBatchTransportError);
      assert.equal(error.submission, "submission_unknown");
      assert.ok(!String(error).includes("test-secret"));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("HTTP rejection can be distinguished from submission uncertainty without logging its body", async () => {
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () =>
    new Response("test-secret and private prompt", { status: 429 }) });
  await assert.rejects(client.create([request]), matches("batch_http_429", "not_submitted"));
});

test("GET uses provider identity, not returned result URL; streams unordered outcomes and Unicode", async () => {
  const items = [
    { custom_id: "g_4", result: { type: "expired" } }, ok("g_2"),
    { custom_id: "g_1", result: { type: "errored", error: { error: { type: "invalid_request_error" } } } },
    { custom_id: "g_3", result: { type: "canceled" } },
  ];
  const bytes = Buffer.from(items.map((item) => JSON.stringify(item)).join("\r\n"));
  let position = 0;
  let calls = 0;
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.anthropic.com/v1/messages/batches/msgbatch_test/results");
    assert.equal(init?.redirect, "error");
    return new Response(new ReadableStream({ pull(controller) {
      if (position === bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.subarray(position, ++position));
    } }));
  } });
  const received = [];
  for await (const { item, rawText } of client.results(state)) {
    assert.deepEqual(JSON.parse(rawText), item);
    received.push(item);
  }
  assert.deepEqual(received, items);
  assert.equal(calls, 1);
});

test("malformed later row leaves earlier rows available for durable replay", async () => {
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () =>
    new Response(`${JSON.stringify(ok("g_1"))}\n{malformed}\n`) });
  const received: string[] = [];
  await assert.rejects(async () => {
    for await (const { item } of client.results(state)) received.push(item.custom_id);
  }, matches("batch_results_transport_or_envelope_invalid", "read_failed"));
  assert.deepEqual(received, ["g_1"]);
});

test("early iterator return closes the HTTP stream", async () => {
  let canceled = false;
  let pushed = false;
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () =>
    new Response(new ReadableStream({ pull(controller) {
      if (!pushed) { pushed = true; controller.enqueue(Buffer.from(`${JSON.stringify(ok("g_1"))}\n`)); }
    }, cancel() { canceled = true; } })) });
  for await (const { item } of client.results(state)) { assert.equal(item.custom_id, "g_1"); break; }
  assert.equal(canceled, true);
});

test("time spent persisting an item does not consume the network inactivity timeout", async () => {
  let signal: AbortSignal | undefined;
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", timeoutMs: 10, fetch: async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Response(`${JSON.stringify(ok("g_1"))}\n${JSON.stringify(ok("g_2"))}\n`);
  } });
  let count = 0;
  for await (const _ of client.results(state)) {
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(signal?.aborted, false);
    count++;
  }
  assert.equal(count, 2);
});

test("malformed model message stays an identifiable item; later outcomes still arrive", async () => {
  const items = [ok("g_1"), { custom_id: "g_2", result: {
    type: "succeeded", message: { content: "invalid", usage: { input_tokens: 10, output_tokens: 2 } },
  } }, ok("g_3")];
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () =>
    new Response(items.map(item => JSON.stringify(item)).join("\n")) });
  const received = [];
  for await (const { item } of client.results(state)) received.push(item);
  assert.deepEqual(received, items);
});

test("refuses invalid UTF8 and oversized technical envelope, never truncates into valid output", async () => {
  for (const [body, code] of [
    [new Uint8Array([0xff]), "batch_results_transport_or_envelope_invalid"],
    ["x".repeat(ANTHROPIC_BATCH_RESULT_MAX_BYTES + 1), "batch_result_envelope_too_large"],
  ] as const) {
    const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () => new Response(body) });
    await assert.rejects(async () => { for await (const _ of client.results(state)) assert.fail("invalid envelope"); },
      matches(code, "read_failed"));
  }
});

test("not-ready state and invalid provider IDs cannot trigger requests", async () => {
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", fetch: async () => { assert.fail("must not fetch"); } });
  await assert.rejects(client.get("../private"), matches("batch_provider_id_invalid", "read_failed"));
  await assert.rejects(async () => {
    for await (const _ of client.results({ ...state, processing_status: "in_progress" })) assert.fail("not ready");
  }, matches("batch_results_not_ready", "read_failed"));
});

test("stalled POST times out with submission unknown instead of making a second payment", async () => {
  let calls = 0;
  const client = createAnthropicMessageBatchesClient({ apiKey: "test-secret", timeoutMs: 10, fetch: async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  } });
  await assert.rejects(client.create([request]), matches("batch_transport_or_response_invalid", "submission_unknown"));
  assert.equal(calls, 1);
});
