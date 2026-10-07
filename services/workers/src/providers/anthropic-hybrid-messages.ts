/** Experimental H1 transport. One attempt only; the caller journals before sending. */
export type HybridAnthropicRawV1 = { body: string; http_status: number; latency_ms: number };
export class HybridAnthropicTransportError extends Error {
  constructor(readonly code: string, readonly outcome: "definitely_not_sent" | "outcome_unknown") {
    super(code); this.name = "HybridAnthropicTransportError";
  }
}
export function createHybridAnthropicMessagesClientV1(options: {
  api_key?: string; enabled?: boolean; fetch?: typeof fetch; timeout_ms?: number;
} = {}) {
  return { async evaluate(request: Record<string, unknown>): Promise<HybridAnthropicRawV1> {
    const key = options.api_key ?? process.env.ANTHROPIC_API_KEY;
    const timeout = options.timeout_ms ?? 120_000;
    if (!(options.enabled ?? process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED === "true"))
      throw new HybridAnthropicTransportError("hybrid_claude_disabled", "definitely_not_sent");
    if (!key?.trim() || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
      throw new HybridAnthropicTransportError("hybrid_claude_config_invalid", "definitely_not_sent");
    let body: string;
    try { body = JSON.stringify(request); } catch { throw new HybridAnthropicTransportError("hybrid_claude_request_invalid", "definitely_not_sent"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout); timer.unref?.();
    const started = performance.now();
    try {
      const response = await (options.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body,
      });
      const limit = 2 * 1024 * 1024;
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))
        throw new HybridAnthropicTransportError("hybrid_claude_response_too_large", "outcome_unknown");
      const text = await response.text();
      if (Buffer.byteLength(text) > limit) throw new HybridAnthropicTransportError("hybrid_claude_response_too_large", "outcome_unknown");
      return { body: text, http_status: response.status, latency_ms: performance.now() - started };
    } catch (error) {
      if (error instanceof HybridAnthropicTransportError) throw error;
      throw new HybridAnthropicTransportError("hybrid_claude_transport_unknown", "outcome_unknown");
    } finally { clearTimeout(timer); }
  } };
}
