import { createHash } from "node:crypto";
import {
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1,
  SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1,
  SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,
  signalTopicEditorialDigestV1,
  signalTopicEditorialGlobalOutputSchemaV1,
  signalTopicEditorialScreeningOutputSchemaV1,
  validateSignalTopicEditorialRepairRequestV1,
  type SignalTopicEditorialRunnerProviderRequestV1,
  type SignalTopicEditorialRunnerProviderV1,
} from "@noisia/query-engine";

const RESPONSE_BYTES_LIMIT = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 600_000;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const requestIdPattern = /^[A-Za-z0-9_.:-]{1,200}$/u;
const sha = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export type SignalTopicEditorialAnthropicUsageV1 = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type SignalTopicEditorialAnthropicRawReceiptV1 = {
  request_digest: string;
  idempotency_key: string;
  bytes: Uint8Array;
  sha256: string;
  http_status: number;
  provider_request_id: string | null;
  complete: boolean;
};

export type SignalTopicEditorialAnthropicSettlementV1 = {
  contract_version: "signal-topic-editorial-anthropic-settlement-v1";
  phase: "screening" | "global";
  idempotency_key: string;
  request_digest: string;
  request_body_sha256: string;
  response_sha256: string;
  provider_request_id: string | null;
  model: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  pricing_version: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1.pricing_version;
  outcome: "validated" | "known_response_invalid";
  usage: SignalTopicEditorialAnthropicUsageV1 | null;
  cost_micro_usd: number | null;
  output_digest: string | null;
  error_code: string | null;
  settlement_digest: string;
};

export type SignalTopicEditorialAnthropicCompletionV1 = {
  settlement: SignalTopicEditorialAnthropicSettlementV1;
  output: unknown | null;
};

export type SignalTopicEditorialAnthropicSendAuthorizationV1 =
  | "authorized" | "definitely_not_sent" | "outcome_unknown";

/** SQL0176 can implement these hooks later; this transport does not own a database. */
export interface SignalTopicEditorialAnthropicLedgerV1 {
  load(request: SignalTopicEditorialRunnerProviderRequestV1): Promise<SignalTopicEditorialAnthropicCompletionV1 | null>;
  authorize_send(request: SignalTopicEditorialRunnerProviderRequestV1): Promise<SignalTopicEditorialAnthropicSendAuthorizationV1>;
  persist_receipt(receipt: SignalTopicEditorialAnthropicRawReceiptV1): Promise<void>;
  record_completion(completion: SignalTopicEditorialAnthropicCompletionV1): Promise<void>;
}

export class SignalTopicEditorialAnthropicErrorV1 extends Error {
  constructor(readonly code: string, readonly outcome: "definitely_not_sent" | "known_response_invalid" | "outcome_unknown",
    readonly settlement: SignalTopicEditorialAnthropicSettlementV1 | null = null) {
    super(code); this.name = "SignalTopicEditorialAnthropicErrorV1";
  }
}
const transportError = (code: string, outcome: "definitely_not_sent" | "known_response_invalid" | "outcome_unknown",
  settlement: SignalTopicEditorialAnthropicSettlementV1 | null = null) =>
  new SignalTopicEditorialAnthropicErrorV1(`signal_topic_editorial_anthropic_${code}`, outcome, settlement);

function configurationFor(request: SignalTopicEditorialRunnerProviderRequestV1) {
  return request.phase === "screening"
    ? SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1
    : SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1;
}

function validateRequest(request: SignalTopicEditorialRunnerProviderRequestV1) {
  if (!exactKeys(request as unknown as Record<string, unknown>,
    ["contract_version", "phase", "idempotency_key", "model", "request_digest", "request_body", ...(request.repair === undefined ? [] : ["repair"])])
    || request.contract_version !== "signal-topic-editorial-provider-request-v1"
    || (request.phase !== "screening" && request.phase !== "global")
    || request.model !== SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1
    || !/^[A-Za-z0-9_.:-]{1,240}$/u.test(request.idempotency_key)
    || !digestPattern.test(request.request_digest)) throw transportError("request_invalid", "definitely_not_sent");
  if (request.repair !== undefined) {
    try { validateSignalTopicEditorialRepairRequestV1(request); }
    catch { throw transportError("request_invalid", "definitely_not_sent"); }
  }
  let body: Record<string, unknown> | null;
  try { body = object(JSON.parse(request.request_body)); } catch { body = null; }
  const configuration = configurationFor(request), output = object(body?.output_config), format = object(output?.format),
    thinking = object(body?.thinking), messages = body?.messages, message = Array.isArray(messages) ? object(messages[0]) : null;
  if (!body || !exactKeys(body, ["model", "max_tokens", "stream", "thinking", "system", "output_config", "messages"])
    || body.model !== configuration.model || body.max_tokens !== configuration.max_output_tokens || body.stream !== false
    || !thinking || !exactKeys(thinking, ["type"]) || thinking.type !== "disabled"
    || !output || !exactKeys(output, ["effort", "format"]) || output.effort !== configuration.effort
    || !format || !exactKeys(format, ["type", "schema"]) || format.type !== "json_schema"
    || typeof body.system !== "string" || format.schema === undefined
    || signalTopicEditorialDigestV1(body.system) !== configuration.prompt_digest
    || signalTopicEditorialDigestV1(format.schema) !== configuration.schema_digest
    || !Array.isArray(messages) || messages.length !== 1 || !message || !exactKeys(message, ["role", "content"])
    || message.role !== "user" || typeof message.content !== "string") throw transportError("request_invalid", "definitely_not_sent");
  return configuration;
}

function usageOf(value: unknown): SignalTopicEditorialAnthropicUsageV1 | null {
  const usage = object(value); if (!usage) return null;
  const result = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0 };
  return Object.values(result).every(item => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)
    ? result as SignalTopicEditorialAnthropicUsageV1 : null;
}

export function signalTopicEditorialAnthropicCostV1(usage: SignalTopicEditorialAnthropicUsageV1,
  phase: "screening" | "global") {
  const row = object(usage), parsed = usageOf(usage);
  if (!row || !exactKeys(row, ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"])
    || !parsed || (phase !== "screening" && phase !== "global"))
    throw new Error("signal_topic_editorial_anthropic_cost_invalid");
  const configuration = phase === "screening"
    ? SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1 : SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1;
  if (parsed.cache_read_input_tokens !== 0 || parsed.cache_creation_input_tokens !== 0)
    throw new Error("signal_topic_editorial_anthropic_cache_pricing_unsupported");
  const input = (BigInt(parsed.input_tokens) * BigInt(configuration.input_micro_usd_per_million_tokens) + 999_999n) / 1_000_000n,
    output = (BigInt(parsed.output_tokens) * BigInt(configuration.output_micro_usd_per_million_tokens) + 999_999n) / 1_000_000n,
    total = input + output;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("signal_topic_editorial_anthropic_cost_invalid");
  return Number(total);
}

function sealSettlement(body: Omit<SignalTopicEditorialAnthropicSettlementV1, "settlement_digest">) {
  return { ...body, settlement_digest: signalTopicEditorialDigestV1(body) };
}

function decodeReceipt(request: SignalTopicEditorialRunnerProviderRequestV1,
  receipt: SignalTopicEditorialAnthropicRawReceiptV1): SignalTopicEditorialAnthropicCompletionV1 {
  const configuration = configurationFor(request), base = { contract_version: "signal-topic-editorial-anthropic-settlement-v1" as const,
    phase: request.phase, idempotency_key: request.idempotency_key, request_digest: request.request_digest,
    request_body_sha256: sha(request.request_body), response_sha256: receipt.sha256,
    provider_request_id: receipt.provider_request_id, model: SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,
    pricing_version: configuration.pricing_version };
  let body: Record<string, unknown> | null = null;
  try { body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receipt.bytes))); } catch { /* handled below */ }
  const rawUsage = usageOf(body?.usage), reportedModel = body?.model,
    usage = reportedModel === configuration.model ? rawUsage : null;
  let cost: number | null = null, pricingError = false;
  if (usage && reportedModel === configuration.model) {
    try { cost = signalTopicEditorialAnthropicCostV1(usage, request.phase); } catch { pricingError = true; }
  }
  const invalid = (error_code: string): SignalTopicEditorialAnthropicCompletionV1 => ({ output: null,
    settlement: sealSettlement({ ...base, outcome: "known_response_invalid", usage, cost_micro_usd: cost,
      output_digest: null, error_code }) });
  if (receipt.http_status !== 200 || !body) return invalid("response_invalid");
  if (reportedModel !== configuration.model) return invalid("response_model_invalid");
  if (!usage) return invalid("response_usage_invalid");
  if (pricingError) return invalid("cache_pricing_unsupported");
  if (body.type !== "message" || body.role !== "assistant" || body.stop_reason !== "end_turn" || !Array.isArray(body.content))
    return invalid("response_invalid");
  const blocks = body.content.map(object);
  if (blocks.some(item => item?.type !== "text") || blocks.length !== 1 || typeof blocks[0]?.text !== "string")
    return invalid("response_output_invalid");
  let output: unknown;
  try { output = JSON.parse(blocks[0].text as string); } catch { return invalid("response_output_invalid"); }
  const parsed = request.phase === "screening"
    ? signalTopicEditorialScreeningOutputSchemaV1.safeParse(output)
    : signalTopicEditorialGlobalOutputSchemaV1.safeParse(output);
  if (!parsed.success) return invalid("response_output_invalid");
  const normalized = parsed.data, output_digest = signalTopicEditorialDigestV1(normalized);
  return { output: normalized, settlement: sealSettlement({ ...base, outcome: "validated", usage,
    cost_micro_usd: cost, output_digest, error_code: null }) };
}

/** Decode durable bytes during recovery; this never reads credentials or sends. */
export function decodeSignalTopicEditorialAnthropicReceiptV1(request: SignalTopicEditorialRunnerProviderRequestV1,
  receipt: SignalTopicEditorialAnthropicRawReceiptV1): SignalTopicEditorialAnthropicCompletionV1 {
  validateRequest(request);
  if (receipt.request_digest !== request.request_digest || receipt.idempotency_key !== request.idempotency_key
    || sha(receipt.bytes) !== receipt.sha256 || receipt.bytes.byteLength > RESPONSE_BYTES_LIMIT
    || !Number.isSafeInteger(receipt.http_status) || receipt.http_status < 100 || receipt.http_status > 599
    || receipt.provider_request_id !== null && !requestIdPattern.test(receipt.provider_request_id))
    throw transportError("ledger_replay_invalid", "outcome_unknown");
  if (receipt.complete !== true) throw transportError("response_incomplete", "outcome_unknown");
  return decodeReceipt(request, receipt);
}

function validateReplay(request: SignalTopicEditorialRunnerProviderRequestV1,
  completion: SignalTopicEditorialAnthropicCompletionV1): SignalTopicEditorialAnthropicCompletionV1 {
  const completionRow = object(completion), settlementRow = object(completionRow?.settlement);
  if (!completionRow || !exactKeys(completionRow, ["settlement", "output"]) || !settlementRow
    || !exactKeys(settlementRow, ["contract_version", "phase", "idempotency_key", "request_digest", "request_body_sha256",
      "response_sha256", "provider_request_id", "model", "pricing_version", "outcome", "usage", "cost_micro_usd",
      "output_digest", "error_code", "settlement_digest"])) throw transportError("ledger_replay_invalid", "outcome_unknown");
  const settlement = settlementRow as SignalTopicEditorialAnthropicSettlementV1,
    replayUsage = settlement.usage === null ? null : usageOf(settlement.usage), { settlement_digest, ...body } = settlement;
  if (settlement.contract_version !== "signal-topic-editorial-anthropic-settlement-v1"
    || settlement.idempotency_key !== request.idempotency_key || settlement.request_digest !== request.request_digest
    || settlement.phase !== request.phase || settlement.model !== request.model
    || settlement.request_body_sha256 !== sha(request.request_body) || !digestPattern.test(settlement.response_sha256)
    || !digestPattern.test(settlement.settlement_digest)
    || signalTopicEditorialDigestV1(body) !== settlement_digest || settlement.pricing_version !== configurationFor(request).pricing_version
    || (settlement.provider_request_id !== null && !requestIdPattern.test(settlement.provider_request_id))
    || (settlement.usage !== null && (replayUsage === null
      || signalTopicEditorialDigestV1(replayUsage) !== signalTopicEditorialDigestV1(settlement.usage)))
    || (settlement.cost_micro_usd !== null && (!Number.isSafeInteger(settlement.cost_micro_usd) || settlement.cost_micro_usd < 0))
    || (settlement.output_digest !== null && !digestPattern.test(settlement.output_digest))
    || (settlement.error_code !== null && !/^[a-z0-9_]{1,100}$/u.test(settlement.error_code))
    || (settlement.outcome !== "validated" && settlement.outcome !== "known_response_invalid")
    || (settlement.outcome === "validated" && (settlement.error_code !== null || settlement.output_digest === null
      || settlement.usage === null || settlement.cost_micro_usd === null))
    || (settlement.outcome === "known_response_invalid" && (settlement.error_code === null
      || settlement.output_digest !== null || completion.output !== null)))
    throw transportError("ledger_replay_invalid", "outcome_unknown");
  if (settlement.usage) {
    let expected: number | null = null;
    try { expected = signalTopicEditorialAnthropicCostV1(settlement.usage, request.phase); } catch { /* unsupported cache price */ }
    if (expected !== settlement.cost_micro_usd) throw transportError("ledger_replay_invalid", "outcome_unknown");
  } else if (settlement.cost_micro_usd !== null) throw transportError("ledger_replay_invalid", "outcome_unknown");
  if (settlement.outcome === "validated") {
    const parsed = request.phase === "screening"
      ? signalTopicEditorialScreeningOutputSchemaV1.safeParse(completion.output)
      : signalTopicEditorialGlobalOutputSchemaV1.safeParse(completion.output);
    if (!parsed.success || signalTopicEditorialDigestV1(parsed.data) !== settlement.output_digest)
      throw transportError("ledger_replay_invalid", "outcome_unknown");
    return { settlement, output: parsed.data };
  }
  if (completion.output !== null || settlement.output_digest !== null || !settlement.error_code)
    throw transportError("ledger_replay_invalid", "outcome_unknown");
  return completion;
}

async function readReceipt(request: SignalTopicEditorialRunnerProviderRequestV1, response: Response) {
  const rawId = response.headers.get("request-id"), provider_request_id = rawId && requestIdPattern.test(rawId) ? rawId : null;
  const chunks: Uint8Array[] = []; let size = 0, complete = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) { complete = true; break; }
        const available = Math.max(0, RESPONSE_BYTES_LIMIT - size);
        if (next.value.byteLength) chunks.push(next.value.slice(0, available));
        size += Math.min(next.value.byteLength, available);
        if (next.value.byteLength > available) { await reader.cancel().catch(() => undefined); break; }
      }
    } catch { /* Keep bounded partial bytes; the provider outcome is unknown. */ }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || (!response.headers.has("content-encoding") && Number(length) !== size))) complete = false;
  return { request_digest: request.request_digest, idempotency_key: request.idempotency_key, bytes, sha256: sha(bytes),
    http_status: response.status, provider_request_id, complete } satisfies SignalTopicEditorialAnthropicRawReceiptV1;
}

/** One provider send at most. Fetch/timeout/receipt ambiguity is never retried here. */
export function createAnthropicSignalTopicEditorialRunnerProviderV1(args: {
  api_key: string;
  provider_enabled: boolean;
  ledger: SignalTopicEditorialAnthropicLedgerV1;
  fetch_impl?: typeof fetch;
  timeout_ms?: number;
  schedule_timeout?: (onTimeout: () => void, milliseconds: number) => (() => void);
}): SignalTopicEditorialRunnerProviderV1 {
  return { complete: async request => {
    validateRequest(request);
    let replay: SignalTopicEditorialAnthropicCompletionV1 | null;
    try { replay = await args.ledger.load(request); }
    catch { throw transportError("ledger_read_unknown", "outcome_unknown"); }
    if (replay) {
      const completion = validateReplay(request, replay);
      if (completion.settlement.outcome !== "validated")
        throw transportError(completion.settlement.error_code!, "known_response_invalid", completion.settlement);
      return completion.output;
    }
    if (!args.provider_enabled) throw transportError("provider_disabled", "definitely_not_sent");
    if (!args.api_key || !/^[A-Za-z0-9_-]{16,512}$/u.test(args.api_key))
      throw transportError("provider_configuration_invalid", "definitely_not_sent");
    const timeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > DEFAULT_TIMEOUT_MS)
      throw transportError("provider_configuration_invalid", "definitely_not_sent");
    let authorization: SignalTopicEditorialAnthropicSendAuthorizationV1;
    try { authorization = await args.ledger.authorize_send(request); }
    catch (error) {
      if (error instanceof SignalTopicEditorialAnthropicErrorV1) throw error;
      throw transportError("send_authority_unknown", "outcome_unknown");
    }
    if (authorization !== "authorized") {
      if (authorization !== "definitely_not_sent" && authorization !== "outcome_unknown")
        throw transportError("send_authority_unknown", "outcome_unknown");
      throw transportError("send_not_authorized", authorization);
    }
    const controller = new AbortController(), schedule = args.schedule_timeout ?? ((onTimeout, milliseconds) => {
      const timer = setTimeout(onTimeout, milliseconds); timer.unref?.(); return () => clearTimeout(timer);
    }), cancel = schedule(() => controller.abort(), timeout);
    try {
      let response: Response;
      try { response = await (args.fetch_impl ?? fetch)("https://api.anthropic.com/v1/messages", {
        method: "POST", redirect: "error", signal: controller.signal, body: request.request_body,
        headers: { "x-api-key": args.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      }); } catch { throw transportError(controller.signal.aborted ? "timeout_outcome_unknown" : "transport_outcome_unknown", "outcome_unknown"); }
      const receipt = await readReceipt(request, response);
      try { await args.ledger.persist_receipt(receipt); }
      catch { throw transportError("receipt_persistence_unknown", "outcome_unknown"); }
      if (!receipt.complete) throw transportError(controller.signal.aborted ? "timeout_outcome_unknown" : "response_incomplete", "outcome_unknown");
      const completion = decodeReceipt(request, receipt);
      try { await args.ledger.record_completion(completion); }
      catch { throw transportError("completion_persistence_unknown", "outcome_unknown"); }
      if (completion.settlement.outcome !== "validated")
        throw transportError(completion.settlement.error_code!, "known_response_invalid", completion.settlement);
      return completion.output;
    } finally { cancel(); }
  } };
}
