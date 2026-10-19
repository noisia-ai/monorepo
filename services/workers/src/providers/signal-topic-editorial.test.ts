import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildSignalTopicEditorialScreeningPlanV1,
  runSignalTopicEditorialConsolidationV1,
  signalTopicEditorialDigestV1,
  type SignalTopicEditorialRunnerProviderRequestV1,
  type SignalTopicEditorialRunnerStateV1,
  type SignalTopicEditorialRunnerStoreV1,
  type SignalTopicEditorialScreeningGroupV1,
} from "@noisia/query-engine";
import {
  SignalTopicEditorialAnthropicErrorV1,
  createAnthropicSignalTopicEditorialRunnerProviderV1,
  signalTopicEditorialAnthropicCostV1,
  type SignalTopicEditorialAnthropicCompletionV1,
  type SignalTopicEditorialAnthropicLedgerV1,
  type SignalTopicEditorialAnthropicRawReceiptV1,
  type SignalTopicEditorialAnthropicSendAuthorizationV1,
} from "./signal-topic-editorial";

const digest = (value: unknown) => signalTopicEditorialDigestV1(value);
const textDigest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Asistente de voz con IA generativa.",
  audiences: ["hogares"], categories: ["asistentes"], competitors: ["Google Assistant"], positive_anchors: ["rutinas"],
  negative_anchors: ["Alexandra"], abstention_anchors: ["ruido"] };

function group(): SignalTopicEditorialScreeningGroupV1 {
  const text = "La nueva rutina de Alexa funciona bien.", root_id = "00000000-0000-4000-8000-000000000001",
    chunk_sha256 = textDigest(text), evidence = [{ ref_id: digest({ root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256 }),
      root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256, text, locale: "es-MX", platform: "reddit",
      occurred_at: "2026-09-12T00:00:00.000Z" }], scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 },
    locale_counts = [{ key: "es-MX", count: 1 }], platform_counts = [{ key: "reddit", count: 1 }],
    month_counts = [{ key: "2026-09", count: 1 }], brand_affinity = { positive: [], negative: [], abstention: [] },
    neighbors: never[] = [], metrics = { cohesion: null, outlier_ratio: null }, dossier = { contract_version: "signal-topic-group-dossier-v1",
      scope_counts, locale_counts, platform_counts, month_counts, brand_affinity, neighbors, metrics,
      evidence: evidence.map(({ text: _text, ...item }) => item) };
  return { group_key: "open:cluster-0001", lane: "open", group_digest: digest("group"), source_dossier_digest: digest(dossier), dossier_digest: digest(dossier),
    community_key: "community-1", root_count: 1, chunk_count: 1, terms: ["rutina"], scope_counts, locale_counts,
    platform_counts, month_counts, brand_affinity, neighbors, metrics, evidence };
}

const planAndGroup = () => { const item = group(); return { item, plan: buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: 1,
  source_context_digest: digest("source"), editorial_context_digest: digest(context), context, groups: [item], batch_size: 10 }) }; };

class Ledger implements SignalTopicEditorialAnthropicLedgerV1 {
  completions = new Map<string, SignalTopicEditorialAnthropicCompletionV1>();
  receipts: SignalTopicEditorialAnthropicRawReceiptV1[] = [];
  events: string[] = [];
  authorizations: SignalTopicEditorialAnthropicSendAuthorizationV1[] = [];
  async load(request: SignalTopicEditorialRunnerProviderRequestV1) {
    this.events.push(`load:${request.idempotency_key}`); return this.completions.get(request.idempotency_key) ?? null;
  }
  async authorize_send(request: SignalTopicEditorialRunnerProviderRequestV1) {
    assert.equal("api_key" in request, false); this.events.push(`authorize:${request.idempotency_key}`);
    return this.authorizations.shift() ?? "authorized";
  }
  async persist_receipt(receipt: SignalTopicEditorialAnthropicRawReceiptV1) {
    this.events.push(`receipt:${receipt.idempotency_key}`); this.receipts.push(structuredClone(receipt));
  }
  async record_completion(completion: SignalTopicEditorialAnthropicCompletionV1) {
    this.events.push(`completion:${completion.settlement.idempotency_key}`);
    this.completions.set(completion.settlement.idempotency_key, structuredClone(completion));
  }
}

class RunnerStore implements SignalTopicEditorialRunnerStoreV1 {
  state: SignalTopicEditorialRunnerStateV1 | null = null;
  async load() { return this.state; }
  async save(input: { expected_state_digest: string | null; state: SignalTopicEditorialRunnerStateV1 }) {
    assert.equal(input.expected_state_digest, this.state?.state_digest ?? null); this.state = structuredClone(input.state);
  }
}

const response = (output: unknown, usage: Record<string, number> = { input_tokens: 100, output_tokens: 20 }) => Response.json({
  id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(output) }], usage,
}, { headers: { "request-id": "req_01" } });

const requestFor = () => { const { item, plan } = planAndGroup(), batch = plan.batches[0]!; return { item, plan, request: {
  contract_version: "signal-topic-editorial-provider-request-v1" as const, phase: "screening" as const,
  idempotency_key: batch.batch_key, model: batch.model, request_digest: batch.request_digest, request_body: batch.request_body,
} }; };

test("simulated Anthropic transport settles screening and global JSON schema responses through the runner", async () => {
  const { item, plan } = planAndGroup(), ledger = new Ledger(), store = new RunnerStore(); let sends = 0;
  const provider = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true, ledger,
    fetch_impl: async (url, init) => {
      sends++; assert.equal(url, "https://api.anthropic.com/v1/messages"); assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("anthropic-version"), "2023-06-01");
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }, input = JSON.parse(body.messages[0]!.content) as Record<string, unknown>;
      if (input.contract_version === "signal-topic-editorial-screening-request-v1") return response({
        contract_version: "signal-topic-editorial-screening-output-v1", batch_index: 0, decisions: [{ group_key: item.group_key,
          disposition: "topic", candidate: { candidate_key: "b0000-routines", label: "Rutinas de Alexa+",
            definition: "Conversaciones sobre rutinas configuradas con Alexa+.", locale: "es-MX" }, confidence: 0.9,
          rationale: null, cited_ref_ids: [item.evidence[0]!.ref_id] }] });
      return response({ contract_version: "signal-topic-editorial-global-result-v1", concepts: [{ concept_key: "topic-alexa-routines",
        kind: "topic", label: "Rutinas de Alexa+", definition: "Conversaciones consolidadas sobre rutinas con Alexa+.", locale: "es-MX",
        priority_rank: 1, priority_rationale: "Rutinas observadas en la evidencia.",
        member_group_keys: [item.group_key] }], noise_group_keys: [], unresolved_group_keys: [] });
    } });
  const result = await runSignalTopicEditorialConsolidationV1({ execution_key: "transport-e2e", plan, groups: [item], store, provider });
  assert.equal(result.status, "completed"); assert.equal(sends, 2); assert.equal(ledger.receipts.length, 2);
  assert.equal(ledger.completions.size, 2);
  for (const completion of ledger.completions.values()) {
    assert.equal(completion.settlement.outcome, "validated"); assert.equal(completion.settlement.cost_micro_usd, 600);
    assert.match(completion.settlement.settlement_digest, /^sha256:[0-9a-f]{64}$/u);
  }
  const firstRequest = { contract_version: "signal-topic-editorial-provider-request-v1" as const, phase: "screening" as const,
    idempotency_key: plan.batches[0]!.batch_key, model: plan.model, request_digest: plan.batches[0]!.request_digest,
    request_body: plan.batches[0]!.request_body };
  await provider.complete(firstRequest); assert.equal(sends, 2, "settled ledger replay must not send again");
});

test("known invalid structured output keeps exact usage and cost and is never retried", async () => {
  const { request } = requestFor(), ledger = new Ledger(); let sends = 0;
  const provider = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true, ledger,
    fetch_impl: async () => { sends++; return response({ contract_version: "signal-topic-editorial-screening-output-v1", batch_index: 0,
      decisions: [{ invented: true }] }); } });
  await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "known_response_invalid" && error.settlement?.cost_micro_usd === 600
    && error.settlement.usage?.input_tokens === 100);
  await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "known_response_invalid");
  assert.equal(sends, 1); assert.equal(ledger.receipts.length, 1); assert.equal(ledger.completions.size, 1);
});

test("complete Anthropic request rejection is durably settled at zero and never retried", async () => {
  const { request } = requestFor(), ledger = new Ledger(); let sends = 0;
  const provider = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true, ledger,
    fetch_impl: async () => { sends++; return Response.json({ type: "error", error: { type: "invalid_request_error",
      message: "output_config.format.schema contains an unsupported keyword" } }, { status: 400, headers: { "request-id": "req_rejected" } }); } });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
      && error.outcome === "known_response_invalid" && error.settlement?.error_code === "response_invalid"
      && error.settlement.usage === null && error.settlement.cost_micro_usd === null);
  }
  assert.equal(sends, 1); assert.equal(ledger.receipts.length, 1); assert.equal(ledger.receipts[0]?.http_status, 400);
  assert.equal(ledger.receipts[0]?.complete, true); assert.equal(ledger.completions.size, 1);
});

test("network ambiguity is not retried and a later ledger refusal prevents another send", async () => {
  const { request } = requestFor(), ledger = new Ledger(); ledger.authorizations.push("authorized", "outcome_unknown"); let sends = 0;
  const provider = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true, ledger,
    fetch_impl: async () => { sends++; throw new Error("socket reset"); } });
  await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "outcome_unknown" && !error.message.includes("socket reset"));
  await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "outcome_unknown");
  assert.equal(sends, 1); assert.equal(ledger.receipts.length, 0); assert.equal(ledger.completions.size, 0);
});

test("unpriced cache tokens and preflight request mutations fail closed", async () => {
  const { request } = requestFor(), ledger = new Ledger(); let sends = 0;
  const validOutput = { contract_version: "signal-topic-editorial-screening-output-v1", batch_index: 0, decisions: [] };
  const provider = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true, ledger,
    fetch_impl: async () => { sends++; return response(validOutput,
      { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }); } });
  await assert.rejects(provider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "known_response_invalid" && error.settlement?.cost_micro_usd === null
    && error.settlement.error_code === "cache_pricing_unsupported");
  assert.equal(sends, 1);

  const modelLedger = new Ledger(), modelProvider = createAnthropicSignalTopicEditorialRunnerProviderV1({
    api_key: "unit_test_key_123456789", provider_enabled: true, ledger: modelLedger, fetch_impl: async () => Response.json({
      type: "message", role: "assistant", model: "claude-sonnet-4-6-20260912", stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(validOutput) }], usage: { input_tokens: 100, output_tokens: 20 },
    }) });
  await assert.rejects(modelProvider.complete(request), error => error instanceof SignalTopicEditorialAnthropicErrorV1
    && error.outcome === "known_response_invalid" && error.settlement?.cost_micro_usd === null
    && error.settlement.error_code === "response_model_invalid");

  const untouched = new Ledger(), noSend = createAnthropicSignalTopicEditorialRunnerProviderV1({
    api_key: "unit_test_key_123456789", provider_enabled: true, ledger: untouched,
    fetch_impl: async () => { assert.fail("invalid request must not send"); } });
  await assert.rejects(noSend.complete({ ...request, request_body: "{}" }), error =>
    error instanceof SignalTopicEditorialAnthropicErrorV1 && error.outcome === "definitely_not_sent");
  assert.equal(untouched.events.length, 0);
  assert.equal(signalTopicEditorialAnthropicCostV1({ input_tokens: 100, output_tokens: 20,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, "screening"), 600);
});

test("provider-disabled permits only an already settled replay and never authorizes a new send", async () => {
  const { request } = requestFor(), ledger = new Ledger(); let sends = 0;
  const output = { contract_version: "signal-topic-editorial-screening-output-v1", batch_index: 0, decisions: [] };
  const first = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "unit_test_key_123456789", provider_enabled: true,
    ledger, fetch_impl: async () => { sends++; return response(output); } });
  await first.complete(request);
  const before = [...ledger.events];
  const disabled = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "", provider_enabled: false, ledger,
    fetch_impl: async () => { assert.fail("disabled transport"); } });
  assert.deepEqual(await disabled.complete(request), output); assert.equal(sends, 1);
  assert.equal(ledger.events.filter(event => event.startsWith("authorize:")).length, before.filter(event => event.startsWith("authorize:")).length);
  const empty = new Ledger();
  await assert.rejects(createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: "", provider_enabled: false, ledger: empty })
    .complete(request), /provider_disabled/u);
  assert.equal(empty.events.some(event => event.startsWith("authorize:")), false);
});
