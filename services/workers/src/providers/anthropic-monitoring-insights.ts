import { signalWorkspaceEmbeddingDigestV1, workspaceMonitoringInsightConfigurationV1,
  type WorkspaceMonitoringInsightRequestV1 } from "@noisia/query-engine";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_RESPONSE_BYTES = 512 * 1024;
export type MonitoringInsightsRawReceiptV1 = {
  bytes: Buffer; http_status: number; provider_request_id: string | null; complete: boolean;
};
export type MonitoringInsightsProviderV1 = { generate(request: WorkspaceMonitoringInsightRequestV1): Promise<MonitoringInsightsRawReceiptV1> };
export class MonitoringInsightsProviderErrorV1 extends Error {
  constructor(readonly code: string, readonly outcome: "definitely_not_sent" | "outcome_unknown") {
    super(code); this.name = "MonitoringInsightsProviderError";
  }
}

/** Exact, single-request aggregate transport. It does not parse model output,
 * retry, choose credentials, reserve money or publish an interpretation. */
export function createAnthropicMonitoringInsightsProviderV1(options: {
  apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number
}): MonitoringInsightsProviderV1 {
  return { async generate(request) {
    const apiKey = options.apiKey.trim();
    const timeoutMs = options.timeoutMs ?? 120_000;
    const invalid = () => new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_request_invalid", "definitely_not_sent");
    if (!apiKey || /[\r\n]/u.test(apiKey)) throw new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_key_missing", "definitely_not_sent");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000 || !request
      || typeof request.request_body !== "string" || !request.request_body.length
      || !request.configuration || typeof request.configuration.workspace_id !== "string"
      || signalWorkspaceEmbeddingDigestV1(request.configuration) !== signalWorkspaceEmbeddingDigestV1(workspaceMonitoringInsightConfigurationV1(request.configuration.workspace_id))
      || Buffer.byteLength(request.request_body) > request.configuration.max_request_bytes
      || request.request_digest !== signalWorkspaceEmbeddingDigestV1({ request_body: request.request_body, configuration: request.configuration })) throw invalid();

    const controller = new AbortController();
    const chunks: Buffer[] = []; let length = 0;
    let http_status: number | null = null; let provider_request_id: string | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, timeoutMs);
    });
    const receipt = (complete: boolean): MonitoringInsightsRawReceiptV1 => ({
      bytes: Buffer.concat(chunks, length), http_status: http_status!, provider_request_id, complete
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await (options.fetch ?? globalThis.fetch)(ENDPOINT, {
          method: "POST", body: request.request_body, redirect: "error", signal: controller.signal,
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }
        });
        if (controller.signal.aborted) throw new Error("deadline");
        http_status = response.status;
        const requestId = response.headers.get("request-id");
        provider_request_id = requestId && requestId.length <= 200 ? requestId : null;
        if (!response.body) return receipt(true);
        reader = response.body.getReader();
        for (;;) {
          const part = await reader.read();
          if (controller.signal.aborted) throw new Error("deadline");
          if (part.done) return receipt(true);
          const remaining = MAX_RESPONSE_BYTES - length;
          const bytes = Buffer.from(part.value);
          if (bytes.length) { chunks.push(bytes.subarray(0, remaining)); length += Math.min(bytes.length, remaining); }
          if (bytes.length > remaining) { controller.abort(); return receipt(false); }
        }
      })()]);
    } catch {
      if (http_status !== null) return receipt(false);
      throw new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_transport_unknown", "outcome_unknown");
    } finally {
      clearTimeout(timer!);
      // A stuck reader must not extend the request deadline or shutdown. The
      // bounded private prefix remains a receipt even if cancellation fails.
      void reader?.cancel().catch(() => undefined);
    }
  } };
}
