import type { LlmUsageV1 } from "./llm-pricing-v1";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const count = (v: unknown, optional = false) => {
  if (v === undefined && optional) return 0;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new Error("anthropic_usage_invalid");
  return v;
};
export function anthropicUsageV1(message: unknown): LlmUsageV1 {
  const u = obj(obj(message).usage),
    c = obj(u.cache_creation);
  const creation = count(u.cache_creation_input_tokens, true),
    one = count(c.ephemeral_1h_input_tokens, true);
  const five =
    c.ephemeral_5m_input_tokens === undefined
      ? creation - one
      : count(c.ephemeral_5m_input_tokens);
  if (five < 0 || five + one !== creation)
    throw new Error("anthropic_usage_invalid");
  return {
    input_tokens: count(u.input_tokens),
    output_tokens: count(u.output_tokens),
    cache_read_input_tokens: count(u.cache_read_input_tokens, true),
    cache_creation_input_tokens: creation,
    cache_creation: {
      ephemeral_5m_input_tokens: five,
      ephemeral_1h_input_tokens: one,
    },
  };
}
export function parseAnthropicResponseV1(message: unknown): {
  status: "ok" | "refused" | "split" | "error";
  text?: string;
  refusal_category?: string;
  error_code?: string;
  stop_reason: string | null;
} {
  const m = obj(message),
    reason = typeof m.stop_reason === "string" ? m.stop_reason : null;
  if (reason === "refusal")
    return {
      status: "refused",
      stop_reason: reason,
      refusal_category: String(obj(m.stop_details).category ?? "unknown"),
    };
  if (reason === "max_tokens") return { status: "split", stop_reason: reason };
  if (reason !== "end_turn")
    return {
      status: "error",
      stop_reason: reason,
      error_code: "unexpected_stop_reason",
    };
  const texts = Array.isArray(m.content)
    ? m.content
        .map(obj)
        .filter((b) => b.type === "text" && typeof b.text === "string")
    : [];
  const text = texts.at(-1)?.text as string | undefined;
  return text
    ? { status: "ok", stop_reason: reason, text }
    : {
        status: "error",
        stop_reason: reason,
        error_code: "missing_text_block",
      };
}
