import Anthropic from "@anthropic-ai/sdk";

export const SONNET_JSON_AGENT_MODEL_V1 = "claude-sonnet-4-6" as const;
/** USD per million tokens of the agent model. */
export const SONNET_JSON_AGENT_PRICE_V1 = { input_usd_per_mtok: 3, output_usd_per_mtok: 15 } as const;
export type SonnetJsonUsageV1 = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
export type SonnetJsonAnswerV1 = { output: unknown; usage: SonnetJsonUsageV1; model: string };
/** One judgment by the agent: rules, one JSON document, one JSON answer constrained to a schema. */
export type SonnetJsonAgentV1 = (request: { system: string; payload: string; schema: unknown }) => Promise<SonnetJsonAnswerV1>;

/** An answer that was billed but cannot be used. Its usage is kept so the caller can still charge it. */
export class SonnetJsonAgentErrorV1 extends Error {
  constructor(readonly code: string, readonly usage?: SonnetJsonUsageV1) { super(code); this.name = "SonnetJsonAgentErrorV1"; }
}
export function sonnetJsonCostMicroUsdV1(usage: SonnetJsonUsageV1): number {
  const price = SONNET_JSON_AGENT_PRICE_V1;
  return Math.ceil((usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1) * price.input_usd_per_mtok
    + usage.output_tokens * price.output_usd_per_mtok);
}

/**
 * Product judgments run on Claude Sonnet 4.6, never a larger model. The request
 * is streamed because answers can be long. It answers without a scratchpad:
 * thinking shares the output limit with the answer and, over a whole map, left
 * no room for it. Each schema asks for its reasons before its verdict instead.
 * A refusal, a truncated answer or broken JSON is an error, never a partial result.
 */
export function createSonnetJsonAgentV1(options: { apiKey: string; client?: Pick<Anthropic, "messages"> }): SonnetJsonAgentV1 {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });
  return async request => {
    const message = await client.messages.stream({
      model: SONNET_JSON_AGENT_MODEL_V1, max_tokens: 64_000, thinking: { type: "disabled" },
      system: request.system,
      output_config: { format: { type: "json_schema", schema: request.schema as Record<string, unknown> } },
      messages: [{ role: "user", content: request.payload }],
    }).finalMessage();
    if (message.stop_reason === "refusal") throw new SonnetJsonAgentErrorV1("agent_refused", message.usage);
    if (message.stop_reason === "max_tokens") throw new SonnetJsonAgentErrorV1("agent_answer_truncated", message.usage);
    const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    try { return { output: JSON.parse(text), usage: message.usage, model: message.model }; }
    catch { throw new SonnetJsonAgentErrorV1("agent_answer_invalid", message.usage); }
  };
}
