import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createWorkspaceVoyageEmbeddingProviderV1,
  validateWorkspaceVoyageResponseV1,
  WorkspaceEmbeddingProviderErrorV1
} from "./signal-workspace-embeddings-provider";

const input = (text: string) => ({ text, chunk_sha256: `sha256:${createHash("sha256").update(text).digest("hex")}` });
const inputs = [input("Texto completo e\u0301 🌎\n"), input("Second unchanged document.")];
const vector = () => [1, ...Array.from({ length: 1023 }, () => 0)];
const payload = () => ({ model: "voyage-4-large", usage: { total_tokens: 20 },
  data: [{ index: 1, embedding: vector() }, { index: 0, embedding: vector() }] });
const raw = (body: unknown) => ({ body: JSON.stringify(body), http_status: 200, provider_request_id: "fixture-request" });

test("workspace Voyage sends one complete sealed request and validates reordered indices", async () => {
  let calls = 0;
  const provider = createWorkspaceVoyageEmbeddingProviderV1({ enabled: true, api_key: "fixture-disabled-key",
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.voyageai.com/v1/embeddings");
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      assert.deepEqual(JSON.parse(options?.body as string), { model: "voyage-4-large",
        input: inputs.map(item => item.text), input_type: "document", output_dimension: 1024,
        output_dtype: "float", truncation: false });
      return new Response(JSON.stringify(payload()), { headers: { "x-request-id": "fixture-request" } });
    } });
  const response = await provider.embedBatch(inputs);
  const validated = validateWorkspaceVoyageResponseV1(inputs, response);
  assert.equal(calls, 1);
  assert.deepEqual(validated.embeddings.map(entry => entry.index), [1, 0]);
  assert.equal(validated.provider_request_id, "fixture-request");
  assert.equal(validated.total_tokens, 20);
});

test("workspace Voyage is disabled by default and invalid input never reaches transport", async () => {
  const saved = process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
  delete process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error("must not send"); };
  try {
    const provider = createWorkspaceVoyageEmbeddingProviderV1({ api_key: "fixture-disabled-key", fetch });
    await assert.rejects(provider.embedBatch(inputs), (error: unknown) =>
      error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "definitely_not_sent"
      && error.code === "workspace_embedding_provider_disabled");
    const enabled = createWorkspaceVoyageEmbeddingProviderV1({ enabled: true, api_key: "fixture-disabled-key", fetch });
    await assert.rejects(enabled.embedBatch([input("too long".repeat(200))]), (error: unknown) =>
      error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "definitely_not_sent");
    await assert.rejects(enabled.embedBatch([inputs[0]!, inputs[0]!]), /request_invalid/u);
    assert.equal(calls, 0);
  } finally {
    if (saved === undefined) delete process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
    else process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED = saved;
  }
});

test("workspace Voyage never retries transport failures and preserves HTTP error receipts", async () => {
  for (const scenario of ["socket", "http"] as const) {
    let calls = 0;
    const provider = createWorkspaceVoyageEmbeddingProviderV1({ enabled: true, api_key: "fixture-disabled-key",
      fetch: async () => {
        calls++;
        if (scenario === "socket") throw new Error("arbitrary upstream body and credentials must not survive");
        return new Response("private error payload", { status: 503, headers: { "x-request-id": "http-error-receipt" } });
      } });
    if (scenario === "socket") await assert.rejects(provider.embedBatch(inputs), (error: unknown) =>
      error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "outcome_unknown"
      && !error.message.includes("private") && !error.message.includes("credentials"));
    else {
      const receipt = await provider.embedBatch(inputs);
      assert.deepEqual(receipt, { body: "private error payload", http_status: 503, provider_request_id: "http-error-receipt" });
      assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, receipt), (error: unknown) =>
        error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "known_response_invalid"
        && !error.message.includes("private"));
    }
    assert.equal(calls, 1);
  }
});

test("workspace Voyage retains raw invalid JSON for durable recovery before validation", async () => {
  let calls = 0;
  const provider = createWorkspaceVoyageEmbeddingProviderV1({ enabled: true, api_key: "fixture-disabled-key",
    fetch: async () => { calls++; return new Response("{invalid json"); } });
  const response = await provider.embedBatch(inputs);
  assert.equal(response.body, "{invalid json");
  assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, response), (error: unknown) =>
    error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "known_response_invalid"
    && error.evidence.total_tokens === undefined && !!error.evidence.response_digest);
  assert.equal(calls, 1);
});

test("workspace Voyage bounds streaming response bytes even without content-length", async () => {
  let canceled = false;
  const provider = createWorkspaceVoyageEmbeddingProviderV1({ enabled: true, api_key: "fixture-disabled-key",
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
      cancel() { canceled = true; }
    })) });
  await assert.rejects(provider.embedBatch(inputs), /response_too_large/u);
  assert.equal(canceled, true);
});

test("workspace Voyage rejects malformed vectors and mappings without losing known usage", async () => {
  const cases: Array<(body: ReturnType<typeof payload>) => void> = [
    body => { body.data.pop(); },
    body => { body.data[1]!.index = 1; },
    body => { body.data[1]!.index = -1; },
    body => { body.data[1]!.index = 0.5; },
    body => { body.data[1]!.embedding.pop(); },
    body => { body.data[1]!.embedding[0] = Infinity; },
    body => { body.data[1]!.embedding[0] = 0; },
    body => { body.model = "different-model"; }
  ];
  for (const mutate of cases) {
    const body = payload(); mutate(body);
    assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, raw(body)), (error: unknown) =>
      error instanceof WorkspaceEmbeddingProviderErrorV1 && error.outcome === "known_response_invalid"
      && error.evidence.total_tokens === 20);
  }
  const body = payload(); body.usage.total_tokens = -1;
  assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, raw(body)), (error: unknown) =>
    error instanceof WorkspaceEmbeddingProviderErrorV1 && error.evidence.total_tokens === undefined);
});

test("Voyage response may omit its optional model, while explicit conflicting model is rejected", () => {
  const body = payload();
  const { model: _model, ...withoutModel } = body;
  assert.equal(validateWorkspaceVoyageResponseV1(inputs, raw(withoutModel)).model, "voyage-4-large");
  assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, raw({ ...body, model: "different-model" })), /response_invalid/u);
  assert.throws(() => validateWorkspaceVoyageResponseV1(inputs, { ...raw(body), http_status: 206 }),
    /response_invalid/u, "an unexpected partial HTTP response cannot be finalized as a complete batch");
});
