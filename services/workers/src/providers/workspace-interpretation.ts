import { createHash } from "node:crypto";
import {
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
  SIGNAL_WORKSPACE_INTERPRETATION_LIMITS_V1,
  buildSignalWorkspaceInterpretationBatchV1,
  buildSignalWorkspaceInterpretationRepairBatchV1,
  signalWorkspaceEmbeddingDigestV1,
  validateSignalWorkspaceInterpretationResultV1,
  type SignalWorkspaceInterpretationBatchV1,
  type SignalWorkspaceInterpretationUsageV1,
  type SignalWorkspaceInterpretationV1,
} from "@noisia/query-engine";

export type WorkspaceInterpretationRawReceiptV1 = {
  bytes: Uint8Array; sha256: string; http_status: number; provider_request_id: string | null;
  complete: boolean;
};
export type WorkspaceInterpretationResponseV1 = {
  receipt_sha256: string; provider_request_id: string | null;
  usage: SignalWorkspaceInterpretationUsageV1 | null;
  interpretations: SignalWorkspaceInterpretationV1[] | null;
  outcome: "validated" | "known_response_invalid" | "outcome_unknown";
  error_code: string | null;
};
/** Fixed codes only: no payload, credentials, remote error strings or headers. */
export class WorkspaceInterpretationTransportErrorV1 extends Error {
  constructor(readonly code: string, readonly outcome: "definitely_not_sent" | "outcome_unknown") {
    super(code); this.name = "WorkspaceInterpretationTransportErrorV1";
  }
}
const transportError = (suffix: string, outcome: "definitely_not_sent" | "outcome_unknown") =>
  new WorkspaceInterpretationTransportErrorV1(`workspace_engine_interpretation_${suffix}`, outcome);
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function usageOf(value: unknown): SignalWorkspaceInterpretationUsageV1 | null {
  const usage = object(value); if (!usage) return null;
  const result = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0 };
  if (!Object.values(result).every(token => typeof token === "number" && Number.isSafeInteger(token) && token >= 0)) return null;
  // This request never enables caching. Preserve normal metering but do not settle
  // unexpected one-hour cache writes under the five-minute pinned price.
  const cache = object(usage.cache_creation);
  if (cache?.ephemeral_1h_input_tokens !== undefined && cache.ephemeral_1h_input_tokens !== 0) return null;
  return result as SignalWorkspaceInterpretationUsageV1;
}
/** Can be called on a previously persisted receipt without another provider send. */
export function validateWorkspaceInterpretationReceiptV1(
  batch: SignalWorkspaceInterpretationBatchV1, receipt: WorkspaceInterpretationRawReceiptV1,
): WorkspaceInterpretationResponseV1 {
  const result: WorkspaceInterpretationResponseV1 = { receipt_sha256: receipt.sha256, provider_request_id: receipt.provider_request_id,
    usage: null, interpretations: null, outcome: "outcome_unknown", error_code: null };
  if (receipt.sha256 !== sha(receipt.bytes) || !receipt.complete) return { ...result, error_code: "workspace_engine_interpretation_response_incomplete" };
  let body: Record<string, unknown> | null;
  try { body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receipt.bytes))); }
  catch { return { ...result, error_code: "workspace_engine_interpretation_response_json_invalid" }; }
  if (!body) return { ...result, error_code: "workspace_engine_interpretation_response_invalid" };
  // A different/absent reported model cannot be settled at this sealed model's
  // rates. Its raw usage remains durable for explicit cost reconciliation.
  if (body.model !== SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1.model) {
    return { ...result, error_code: "workspace_engine_interpretation_response_model_invalid" };
  }
  result.usage = usageOf(body.usage);
  if (result.usage) result.outcome = "known_response_invalid";
  if (receipt.http_status !== 200 || body.type !== "message" || body.role !== "assistant" || body.stop_reason !== "end_turn"
    || !Array.isArray(body.content) || !result.usage) {
    return { ...result, error_code: "workspace_engine_interpretation_response_invalid" };
  }
  // Only text is a structured result; selecting by type also avoids assuming
  // content[0] when the provider changes its default thinking behavior.
  const texts = body.content.map(object).filter(block => block?.type === "text");
  if (texts.length !== 1 || typeof texts[0]?.text !== "string"
    || body.content.some(item => !["text", "thinking", "redacted_thinking"].includes(String(object(item)?.type)))) {
    return { ...result, error_code: "workspace_engine_interpretation_output_invalid" };
  }
  try {
    result.interpretations = validateSignalWorkspaceInterpretationResultV1(batch, JSON.parse(texts[0].text));
    return { ...result, outcome: "validated" };
  } catch { return { ...result, error_code: "workspace_engine_interpretation_output_invalid" }; }
}
async function readReceipt(response: Response): Promise<WorkspaceInterpretationRawReceiptV1> {
  const rawId = response.headers.get("request-id");
  const provider_request_id = rawId && /^[A-Za-z0-9_.:-]{1,200}$/u.test(rawId) ? rawId : null;
  const max = SIGNAL_WORKSPACE_INTERPRETATION_LIMITS_V1.response_bytes;
  const chunks: Uint8Array[] = []; let size = 0, complete = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) { complete = true; break; }
        const available = Math.max(0, max - size);
        if (next.value.byteLength) chunks.push(next.value.slice(0, available));
        size += Math.min(next.value.byteLength, available);
        if (next.value.byteLength > available) { await reader.cancel().catch(() => undefined); break; }
      }
    } catch { /* Preserve the bounded partial receipt; its outcome remains unknown. */ }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || (!response.headers.has("content-encoding") && Number(length) !== size))) complete = false;
  return { bytes, sha256: sha(bytes), http_status: response.status, provider_request_id, complete };
}
/** Single fetch, no SDK retries. Root composes the durable reservation/CAS and
 * private storage callback. No environment lookup, alternate endpoint or logs. */
export async function sendWorkspaceInterpretationV1(args: {
  batch: SignalWorkspaceInterpretationBatchV1; api_key: string; provider_enabled: boolean;
  authorize_send: () => Promise<boolean>;
  persist_receipt: (receipt: WorkspaceInterpretationRawReceiptV1) => Promise<void>;
  fetch_impl?: typeof fetch; timeout_ms?: number;
}): Promise<WorkspaceInterpretationResponseV1> {
  let requestBody: string;
  try {
    const original = buildSignalWorkspaceInterpretationBatchV1(args.batch.context, args.batch.clusters);
    const expected = args.batch.editorial_repair
      ? buildSignalWorkspaceInterpretationRepairBatchV1(original, {
        source_call_id: args.batch.editorial_repair.source_call_id,
        source_response_sha256: args.batch.editorial_repair.source_response_sha256,
        diagnostic: args.batch.editorial_repair.diagnostic,
      }) : original;
    if (signalWorkspaceEmbeddingDigestV1(expected) !== signalWorkspaceEmbeddingDigestV1(args.batch)) throw new Error();
    requestBody = expected.request_body;
  } catch { throw transportError("request_invalid", "definitely_not_sent"); }
  if (!args.provider_enabled) throw transportError("provider_disabled", "definitely_not_sent");
  if (!args.api_key || !/^[A-Za-z0-9_-]{16,512}$/u.test(args.api_key)) throw transportError("provider_configuration_invalid", "definitely_not_sent");
  const timeout = args.timeout_ms ?? 120_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) throw transportError("provider_configuration_invalid", "definitely_not_sent");
  let authorized: boolean;
  try { authorized = await args.authorize_send(); }
  catch { throw transportError("send_authority_unknown", "outcome_unknown"); }
  // A failed CAS can mean another process already sent this same attempt.
  // Never let that result release its reservation as definitely-not-sent.
  if (!authorized) throw transportError("send_not_authorized", "outcome_unknown");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  try {
    let response: Response;
    try {
      response = await (args.fetch_impl ?? fetch)("https://api.anthropic.com/v1/messages", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "x-api-key": args.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: requestBody,
      });
    } catch { throw transportError("transport_outcome_unknown", "outcome_unknown"); }
    const receipt = await readReceipt(response);
    // Even non-2xx, malformed JSON, usage-only and partial responses are saved
    // before decoding, so an invalid editorial answer does not erase real cost.
    try { await args.persist_receipt(receipt); }
    catch { throw transportError("receipt_persistence_unknown", "outcome_unknown"); }
    return validateWorkspaceInterpretationReceiptV1(args.batch, receipt);
  } finally { clearTimeout(timer); }
}
