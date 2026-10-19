/** Allowlisted diagnostics for the long-running V2 admission path. Never log
 * request bodies, evidence, provider payloads, idempotency keys, or DB errors. */
const SAFE_STORE_CODES = new Set([
  "processing_forbidden",
  "processing_idempotency_conflict",
  "topic_editorial_source_stale",
  "topic_editorial_quote_expired",
  "topic_editorial_policy_limit_unavailable",
  "topic_editorial_runtime_unavailable",
  "topic_editorial_v2_replay_unavailable",
]);

export function safeTopicEditorialStartErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_STORE_CODES.has(code)) return code;
  }
  return "internal_error";
}

export async function withTopicEditorialStartPhase<T>(
  phase: string,
  work: () => Promise<T>,
  details: Record<string, number | boolean | string> = {},
): Promise<T> {
  const started = performance.now();
  console.info("[signal-topic-editorial-start-v2]", { phase, outcome: "started", ...details });
  try {
    const value = await work();
    console.info("[signal-topic-editorial-start-v2]", {
      phase,
      outcome: "ok",
      duration_ms: Math.round(performance.now() - started),
      ...details,
    });
    return value;
  } catch (error) {
    console.warn("[signal-topic-editorial-start-v2]", {
      phase,
      outcome: "error",
      duration_ms: Math.round(performance.now() - started),
      error_code: safeTopicEditorialStartErrorCode(error),
      ...details,
    });
    throw error;
  }
}
