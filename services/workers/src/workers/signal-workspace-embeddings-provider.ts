import { createHash } from "node:crypto";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  validateSignalWorkspaceEmbeddingInputsV1,
  validateSignalWorkspaceEmbeddingResponseV1,
  type SignalWorkspaceEmbeddingInputV1,
  type SignalWorkspaceEmbeddingResponseV1
} from "@noisia/query-engine";

export type WorkspaceEmbeddingProviderOutcomeV1 =
  "definitely_not_sent" | "outcome_unknown" | "known_response_invalid";

/** Transport errors contain fixed codes and accounting evidence, never source text,
 * provider error messages, credentials or response headers. */
export class WorkspaceEmbeddingProviderErrorV1 extends Error {
  constructor(
    readonly code: string,
    readonly outcome: WorkspaceEmbeddingProviderOutcomeV1,
    readonly evidence: {
      total_tokens?: number;
      provider_request_id?: string | null;
      response_digest?: string;
    } = {}
  ) { super(code); this.name = "WorkspaceEmbeddingProviderErrorV1"; }
}

export function workspaceEmbeddingProviderErrorV1(error: unknown) {
  return error instanceof WorkspaceEmbeddingProviderErrorV1
    ? error : new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_provider_outcome_unknown", "outcome_unknown");
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

async function readResponseV1(response: Response) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_response_too_large", "outcome_unknown");
  }
  if (!response.body) throw new WorkspaceEmbeddingProviderErrorV1(
    "workspace_embedding_response_missing", "outcome_unknown");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WorkspaceEmbeddingProviderErrorV1(
          "workspace_embedding_response_too_large", "outcome_unknown");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_response_encoding_invalid", "outcome_unknown",
      { response_digest: `sha256:${createHash("sha256").update(body).digest("hex")}` });
  }
}

export type WorkspaceEmbeddingRawResponseV1 = {
  body: string; http_status: number; provider_request_id: string | null;
};
export type WorkspaceEmbeddingProviderV1 = {
  embedBatch(inputs: SignalWorkspaceEmbeddingInputV1[]): Promise<WorkspaceEmbeddingRawResponseV1>;
};

/** Exactly one HTTP request. The caller must durably mark this attempt before send.
 * Provider JSON validation and the sealed request builder are wired separately. */
export function createWorkspaceVoyageEmbeddingProviderV1(options: {
  api_key?: string;
  fetch?: typeof fetch;
  timeout_ms?: number;
  enabled?: boolean;
} = {}): WorkspaceEmbeddingProviderV1 {
  return { async embedBatch(inputs) {
    try { validateSignalWorkspaceEmbeddingInputsV1(inputs); }
    catch { throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_request_invalid", "definitely_not_sent"); }
    if (!(options.enabled ?? process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED === "true")) {
      throw new WorkspaceEmbeddingProviderErrorV1(
        "workspace_embedding_provider_disabled", "definitely_not_sent");
    }
    const apiKey = options.api_key ?? process.env.VOYAGE_API_KEY;
    if (!apiKey || !apiKey.trim()) throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_provider_configuration_missing", "definitely_not_sent");
    const timeout = options.timeout_ms ?? 60_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
      throw new WorkspaceEmbeddingProviderErrorV1(
        "workspace_embedding_provider_configuration_invalid", "definitely_not_sent");
    }
    const profile = SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1;
    const requestBody = JSON.stringify({ model: profile.model, input: inputs.map(input => input.text),
      input_type: profile.input_type, output_dimension: profile.dimensions,
      output_dtype: profile.output_dtype, truncation: profile.truncation });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();
    try {
      const response = await (options.fetch ?? fetch)("https://api.voyageai.com/v1/embeddings", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: requestBody
      });
      const body = await readResponseV1(response);
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      const provider_request_id = requestId && /^[A-Za-z0-9_.:-]{1,200}$/u.test(requestId) ? requestId : null;
      return { body, http_status: response.status, provider_request_id };
    } catch (error) { throw workspaceEmbeddingProviderErrorV1(error); }
    finally { clearTimeout(timer); }
  } };
}

/** Validate only after the raw response has been persisted. Invalid output never
 * causes a hidden retry or partial cache write; its known usage remains available. */
export function validateWorkspaceVoyageResponseV1(
  inputs: SignalWorkspaceEmbeddingInputV1[], raw: WorkspaceEmbeddingRawResponseV1
): SignalWorkspaceEmbeddingResponseV1 {
  const response_digest = `sha256:${createHash("sha256").update(raw.body).digest("hex")}`;
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    json = parsed as Record<string, unknown>;
  } catch {
    throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_response_json_invalid", "known_response_invalid", { response_digest });
  }
  const usage = json.usage && typeof json.usage === "object" ? json.usage as Record<string, unknown> : {};
  const total_tokens = typeof usage.total_tokens === "number" && Number.isSafeInteger(usage.total_tokens)
    && usage.total_tokens > 0 ? usage.total_tokens : undefined;
  try {
    if (raw.http_status !== 200 || !Array.isArray(json.data)) throw new Error();
    const response: SignalWorkspaceEmbeddingResponseV1 = {
      // Voyage's official response type makes model optional. The request is sealed;
      // an explicit returned model must match, while absence is not invented evidence.
      model: json.model === undefined ? SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model : json.model as string,
      embeddings: json.data.map((item: unknown) => {
        if (!item || typeof item !== "object") throw new Error();
        const row = item as Record<string, unknown>;
        return { index: row.index as number, vector: row.embedding as number[] };
      }),
      total_tokens: total_tokens as number, provider_request_id: raw.provider_request_id, response_digest
    };
    validateSignalWorkspaceEmbeddingResponseV1(inputs, response);
    return response;
  } catch {
    throw new WorkspaceEmbeddingProviderErrorV1(
      "workspace_embedding_response_invalid", "known_response_invalid",
      { response_digest, total_tokens, provider_request_id: raw.provider_request_id });
  }
}
