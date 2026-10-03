/** Shared provider transport. Persistence, authorization and retries belong to the caller. */
const API_ROOT = "https://api.anthropic.com/v1/messages/batches";
const MAX_REQUESTS = 100_000;
const MAX_REQUEST_BYTES = 256 * 1024 * 1024;
const MAX_CONTROL_BYTES = 1024 * 1024;
export const ANTHROPIC_BATCH_RESULT_MAX_BYTES = 8 * 1024 * 1024;

export type AnthropicBatchRequest = {
  custom_id: string;
  params: { model: string; max_tokens: number; [key: string]: unknown };
};

export type AnthropicBatchState = {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: {
    processing: number; succeeded: number; errored: number; canceled: number; expired: number;
  };
  ended_at: string | null;
  results_url: string | null;
};

export type AnthropicBatchItem = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: unknown }
    | { type: "errored"; error?: Record<string, unknown> }
    | { type: "canceled" }
    | { type: "expired" };
};

export type AnthropicBatchHttpReceipt = {
  http_status: number; raw_body: string; complete: boolean; provider_request_id: string | null;
};
const errorReceipts = new WeakMap<AnthropicBatchTransportError, AnthropicBatchHttpReceipt>();
/** Private response bodies never become Error.message or enumerable properties. */
export function anthropicBatchErrorReceipt(error: AnthropicBatchTransportError) {
  return errorReceipts.get(error) ?? null;
}

export class AnthropicBatchTransportError extends Error {
  constructor(
    readonly code: string,
    readonly submission: "not_submitted" | "submission_unknown" | "read_failed",
    readonly httpStatus?: number,
  ) {
    // Do not expose provider bodies, prompts, API keys or fetch error causes.
    super(code);
    this.name = "AnthropicBatchTransportError";
  }
}

export function createAnthropicMessageBatchesClient(options: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new AnthropicBatchTransportError("batch_api_key_missing", "not_submitted");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new AnthropicBatchTransportError("batch_timeout_invalid", "not_submitted");
  }
  const headers = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "x-api-key": apiKey,
  };

  async function control(path: string, method: "GET" | "POST", body?: string, creates = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const uncertain = creates ? "submission_unknown" : "read_failed";
    try {
      const response = await fetchImpl(`${API_ROOT}${path}`, {
        method, headers, body, redirect: "error", signal: controller.signal,
      });
      if (!response.ok) {
        const raw_body = await readBoundedText(response, MAX_CONTROL_BYTES);
        // A rejection can be retried by policy. A server/transport failure may have
        // accepted a POST: custom_id is NOT a provider idempotency key.
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
        const error = new AnthropicBatchTransportError(
          `batch_http_${response.status}`, creates && rejected ? "not_submitted" : uncertain,
          response.status,
        );
        errorReceipts.set(error, { http_status: response.status, raw_body, complete: true,
          provider_request_id: response.headers.get("request-id") });
        throw error;
      }
      return parseState(JSON.parse(await readBoundedText(response, MAX_CONTROL_BYTES)));
    } catch (error) {
      if (error instanceof AnthropicBatchTransportError) throw error;
      throw new AnthropicBatchTransportError("batch_transport_or_response_invalid", uncertain);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async create(requests: readonly AnthropicBatchRequest[]): Promise<AnthropicBatchState> {
      if (requests.length === 0 || requests.length > MAX_REQUESTS) {
        throw new AnthropicBatchTransportError("batch_request_count_invalid", "not_submitted");
      }
      const seen = new Set<string>();
      for (const request of requests) {
        if (!validCustomId(request.custom_id) || seen.has(request.custom_id)
          || !request.params || typeof request.params.model !== "string" || !request.params.model.trim()
          || !Number.isSafeInteger(request.params.max_tokens) || request.params.max_tokens <= 0
          || request.params.stream === true) {
          throw new AnthropicBatchTransportError("batch_request_invalid", "not_submitted");
        }
        seen.add(request.custom_id);
      }
      let body: string;
      try { body = JSON.stringify({ requests }); } catch {
        throw new AnthropicBatchTransportError("batch_request_not_serializable", "not_submitted");
      }
      if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
        throw new AnthropicBatchTransportError("batch_request_envelope_too_large", "not_submitted");
      }
      return control("", "POST", body, true);
    },
    async get(batchId: string): Promise<AnthropicBatchState> {
      return control(`/${providerId(batchId)}`, "GET");
    },
    async cancel(batchId: string): Promise<AnthropicBatchState> {
      return control(`/${providerId(batchId)}/cancel`, "POST");
    },
    async *results(batch: AnthropicBatchState): AsyncGenerator<{ item: AnthropicBatchItem; rawText: string }> {
      if (batch.processing_status !== "ended") {
        throw new AnthropicBatchTransportError("batch_results_not_ready", "read_failed");
      }
      const id = providerId(batch.id);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const network = async <T>(work: () => Promise<T>) => {
        timer = setTimeout(() => controller.abort(), timeoutMs);
        try { return await work(); } finally { clearTimeout(timer); }
      };
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        // Never forward credentials to results_url. The authenticated results
        // endpoint is derived from the validated provider ID on the fixed origin.
        const response = await network(() => fetchImpl(`${API_ROOT}/${id}/results`, {
          headers, redirect: "error", signal: controller.signal,
        }));
        if (!response.ok) {
          await response.body?.cancel();
          throw new AnthropicBatchTransportError(`batch_http_${response.status}`, "read_failed", response.status);
        }
        if (!response.body) throw new Error("missing_body");
        reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let pending = "";
        while (true) {
          const activeReader = reader;
          const chunk = await network(() => activeReader.read());
          pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, newline).replace(/\r$/u, "");
            pending = pending.slice(newline + 1);
            if (line.trim()) yield parseLine(line);
          }
          if (Buffer.byteLength(pending, "utf8") > ANTHROPIC_BATCH_RESULT_MAX_BYTES) {
            throw new AnthropicBatchTransportError("batch_result_envelope_too_large", "read_failed");
          }
          if (chunk.done) break;
        }
        if (pending.trim()) yield parseLine(pending);
      } catch (error) {
        if (error instanceof AnthropicBatchTransportError) throw error;
        throw new AnthropicBatchTransportError("batch_results_transport_or_envelope_invalid", "read_failed");
      } finally {
        clearTimeout(timer);
        // Returning early or a malformed later item must close the stream; callers
        // may safely retain earlier items and replay the GET from their receipts.
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    },
  };
}

function validCustomId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/u.test(value);
}

function providerId(value: string) {
  if (!/^msgbatch_[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new AnthropicBatchTransportError("batch_provider_id_invalid", "read_failed");
  }
  return value;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseState(value: unknown): AnthropicBatchState {
  if (!object(value) || typeof value.id !== "string"
    || !["in_progress", "canceling", "ended"].includes(String(value.processing_status))
    || !object(value.request_counts)
    || !(value.ended_at === null || typeof value.ended_at === "string")
    || !(value.results_url === null || typeof value.results_url === "string")) throw new Error("invalid_batch");
  // Do not allow providerId's read error to misclassify an ambiguous POST receipt.
  if (!/^msgbatch_[a-zA-Z0-9_-]+$/u.test(value.id)) throw new Error("invalid_batch_id");
  for (const key of ["processing", "succeeded", "errored", "canceled", "expired"]) {
    if (!Number.isSafeInteger(value.request_counts[key]) || Number(value.request_counts[key]) < 0) {
      throw new Error("invalid_batch_counts");
    }
  }
  return value as AnthropicBatchState;
}

function parseLine(rawText: string) {
  if (Buffer.byteLength(rawText, "utf8") > ANTHROPIC_BATCH_RESULT_MAX_BYTES) {
    throw new AnthropicBatchTransportError("batch_result_envelope_too_large", "read_failed");
  }
  const value: unknown = JSON.parse(rawText);
  if (!object(value) || !validCustomId(value.custom_id) || !object(value.result)) throw new Error("invalid_item");
  const result = value.result;
  if (!(["succeeded", "errored", "canceled", "expired"] as unknown[]).includes(result.type)
    || (result.type === "errored" && result.error !== undefined && !object(result.error))) throw new Error("invalid_result");
  return { item: value as AnthropicBatchItem, rawText };
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("control_envelope_too_large");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
