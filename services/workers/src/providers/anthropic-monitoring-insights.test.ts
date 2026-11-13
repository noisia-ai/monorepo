import assert from "node:assert/strict";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1, workspaceMonitoringInsightConfigurationV1,
  type WorkspaceMonitoringInsightRequestV1 } from "@noisia/query-engine";
import { createAnthropicMonitoringInsightsProviderV1, MonitoringInsightsProviderErrorV1 } from "./anthropic-monitoring-insights";

function request(): WorkspaceMonitoringInsightRequestV1 {
  const configuration = workspaceMonitoringInsightConfigurationV1("workspace");
  const request_body = JSON.stringify({ model: configuration.model, max_tokens: configuration.max_output_tokens,
    messages: [{ role: "user", content: "Synthetic aggregate" }] });
  return { configuration, request_body, packet_digest: "sha256:packet", scope_digest: "sha256:scope",
    request_digest: signalWorkspaceEmbeddingDigestV1({ request_body, configuration }), input_token_upper_bound: 10,
    reserved_micro_usd: 1000, candidate_ids: ["synthetic-candidate"] };
}
test("the aggregate provider sends the exact sealed bytes once to the fixed endpoint", async () => {
  const source = request(); let calls = 0;
  const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "synthetic-private-key", fetch: async (url, options) => {
    calls++; assert.equal(url, "https://api.anthropic.com/v1/messages"); assert.equal(options?.body, source.request_body);
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error");
    assert.equal((options?.headers as Record<string, string>)["x-api-key"], "synthetic-private-key");
    return new Response(Buffer.from([123, 255, 125]), { status: 200, headers: { "request-id": "synthetic-request" } });
  } });
  const result = await provider.generate(source);
  assert.equal(calls, 1); assert.deepEqual(result.bytes, Buffer.from([123, 255, 125]));
  assert.equal(result.http_status, 200); assert.equal(result.complete, true); assert.equal(result.provider_request_id, "synthetic-request");
});
test("missing dedicated key and invalid sealed bytes fail before transport", async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error("must not send"); };
  for (const source of [request(), { ...request(), request_body: "altered" }]) {
    const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: source.request_body === "altered" ? "dedicated" : "", fetch: fetcher });
    await assert.rejects(provider.generate(source), error => error instanceof MonitoringInsightsProviderErrorV1 && error.outcome === "definitely_not_sent");
  }
  assert.equal(calls, 0);
});
test("an oversized optional request header cannot prevent durable custody of the raw response", async () => {
  const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "dedicated", fetch: async () => new Response("synthetic raw",
    { headers: { "request-id": "x".repeat(201) } }) });
  const receipt = await provider.generate(request());
  assert.equal(receipt.provider_request_id, null); assert.equal(receipt.bytes.toString(), "synthetic raw"); assert.equal(receipt.complete, true);
});
test("non-success and malformed HTTP bodies are raw receipts, never parse failures or hidden retries", async () => {
  let calls = 0; const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "dedicated", fetch: async () => {
    calls++; return new Response("private refusal bytes", { status: 429 });
  } });
  const receipt = await provider.generate(request());
  assert.equal(calls, 1); assert.equal(receipt.http_status, 429); assert.equal(receipt.bytes.toString(), "private refusal bytes");
  assert.equal(receipt.complete, true);
});
test("a truncated stream retains private partial bytes as an incomplete receipt", async () => {
  let pull = 0;
  const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "dedicated", fetch: async () => new Response(new ReadableStream({
    pull(controller) { if (!pull++) controller.enqueue(new TextEncoder().encode("private prefix")); else controller.error(new Error("private network diagnostic")); }
  })) });
  const receipt = await provider.generate(request());
  assert.equal(receipt.complete, false); assert.equal(receipt.bytes.toString(), "private prefix");
});
test("a stalled fetch times out even if the transport ignores AbortSignal and cannot leak errors", async () => {
  const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "dedicated", timeoutMs: 5,
    fetch: async () => new Promise(() => {}) });
  await assert.rejects(provider.generate(request()), error => error instanceof MonitoringInsightsProviderErrorV1
    && error.outcome === "outcome_unknown" && error.message === "monitoring_insights_provider_transport_unknown"
    && !JSON.stringify(error).includes("dedicated"));
});
test("a stalled response body and oversized body retain a bounded incomplete receipt", async () => {
  for (const stalled of [true, false]) {
    const provider = createAnthropicMonitoringInsightsProviderV1({ apiKey: "dedicated", timeoutMs: stalled ? 5 : 1000,
      fetch: async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(stalled ? Uint8Array.from([123]) : new Uint8Array(600_000)); if (!stalled) controller.close();
      } })) });
    const receipt = await provider.generate(request());
    assert.equal(receipt.complete, false); assert.ok(receipt.bytes.length <= 512 * 1024); assert.ok(receipt.bytes.length > 0);
  }
});
