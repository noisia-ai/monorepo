import {
  SignalTopicEvaluationProviderBoundaryErrorV1,
  signalTopicEvaluationProviderTurnSchemaV2,
  type SignalTopicEvaluationModelInputV2
} from "@noisia/query-engine";

import { generateAnthropicBoundedTextV1, mapAnthropicTopicEvaluationBoundaryErrorV1 } from "./anthropic-bounded-text";

type BoundedTransport = typeof generateAnthropicBoundedTextV1;

export type SignalTopicEvaluationV2Pricing = {
  input_micro_usd_per_token: number;
  output_micro_usd_per_token: number;
};

/** A completed provider response whose structured turn is unusable is not an ambiguous network
 * edge. Preserve its metered usage so the durable caller can terminalize it without retrying. */
export class SignalTopicEvaluationProviderResponseInvalidErrorV2 extends Error {
  constructor(public readonly usage: { input_tokens: number; output_tokens: number; cost_micro_usd: number }) {
    super("topic_evaluation_v2_provider_response_invalid");
    this.name = "SignalTopicEvaluationProviderResponseInvalidErrorV2";
  }
}

// A UTF-8 byte is a conservative upper bound for a tokenizer's byte-level input units. Reserve
// additional room for the provider's structured-output envelope, which is not in the prompt body.
const PROVIDER_INPUT_PROTOCOL_OVERHEAD_TOKENS = 8_192;

/**
 * Product-provider adapter for the future full-evidence flight. It is not registered in any
 * queue and its caller must enforce the dedicated UAT enablement / durable reservation before
 * constructing it. Every turn receives only prior validated navigation responses.
 */
export function createAnthropicFullEvidenceTopicEvaluationModelV2(args: {
  model: string;
  snapshot_digest: string;
  max_output_tokens: number;
  pricing: SignalTopicEvaluationV2Pricing;
}, transport: BoundedTransport = generateAnthropicBoundedTextV1) {
  return {
    next: async (input: SignalTopicEvaluationModelInputV2) => {
      const prompt = buildPrompt(args.snapshot_digest, input);
      const maximumInputTokens = promptInputTokenCeiling(prompt);
      const maximumInputCost = costMicroUsd(maximumInputTokens, 0, args.pricing);
      if (maximumInputTokens > input.remaining_input_tokens
          || maximumInputCost > input.remaining_cost_micro_usd) {
        throw new SignalTopicEvaluationProviderBoundaryErrorV1(
          "definitely_not_sent", "topic_evaluation_v2_provider_input_budget_exhausted");
      }
      const remainingCostAfterInput = input.remaining_cost_micro_usd - maximumInputCost;
      const affordableOutputTokens = args.pricing.output_micro_usd_per_token === 0
        ? input.remaining_output_tokens
        : Math.floor(remainingCostAfterInput / args.pricing.output_micro_usd_per_token);
      const maxOutputTokens = Math.min(args.max_output_tokens, input.remaining_output_tokens,
        affordableOutputTokens);
      if (maxOutputTokens < 1) {
        throw new SignalTopicEvaluationProviderBoundaryErrorV1(
          "definitely_not_sent", "topic_evaluation_v2_provider_budget_exhausted");
      }
      try {
        const result = await transport({
          model: args.model,
          prompt,
          // Do not ask a later turn for more output than the sealed flight still permits.
          max_output_tokens: maxOutputTokens,
          structured_output: {
            schema: signalTopicEvaluationProviderTurnSchemaV2,
            name: "signal_topic_evaluation_full_evidence_turn",
            description: "One bounded evidence navigation request or the final editable Topic candidates."
          }
        });
        const usage = {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cost_micro_usd: costMicroUsd(result.usage.input_tokens, result.usage.output_tokens, args.pricing)
        };
        let parsed;
        try {
          parsed = signalTopicEvaluationProviderTurnSchemaV2.parse(JSON.parse(result.text));
        } catch {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        return parsed.kind === "tool"
          ? { kind: "tool" as const, request: parsed.request, usage }
          : { kind: "final" as const, json: JSON.stringify(parsed.output), usage };
      } catch (error) {
        throw mapAnthropicTopicEvaluationBoundaryErrorV1(error);
      }
    }
  };
}

function promptInputTokenCeiling(prompt: string) {
  const bytes = Buffer.byteLength(prompt, "utf8");
  const ceiling = bytes + PROVIDER_INPUT_PROTOCOL_OVERHEAD_TOKENS;
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) {
    throw new Error("topic_evaluation_v2_prompt_size_invalid");
  }
  return ceiling;
}

function buildPrompt(snapshotDigest: string, input: SignalTopicEvaluationModelInputV2) {
  return [
    "You are the bounded Full Evidence Topic Evaluation agent for Noisia.",
    "You are reviewing candidate topics only. You must never adopt, publish, serve, delete or mutate a Topic.",
    "The only evidence available to you is the prior server-owned navigation output below. Do not infer unseen mentions.",
    "When more evidence is needed, return exactly one allowed navigation request. Never request SQL, raw IDs, URLs, files, credentials or unbounded corpus content.",
    "When enough evidence is available, return only the final pending candidate output. Each candidate must cite evidence references already returned and cluster keys you actually navigated.",
    `Frozen snapshot digest: ${snapshotDigest}.`,
    `Turn index: ${input.turn_index}.`,
    `Remaining output-token ceiling: ${input.remaining_output_tokens}.`,
    "Prior bounded navigation results (possibly empty):",
    JSON.stringify(input.prior_results)
  ].join("\n\n");
}

function costMicroUsd(inputTokens: number, outputTokens: number, pricing: SignalTopicEvaluationV2Pricing) {
  const input = Math.ceil(inputTokens * pricing.input_micro_usd_per_token);
  const output = Math.ceil(outputTokens * pricing.output_micro_usd_per_token);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) {
    throw new Error("topic_evaluation_v2_usage_cost_invalid");
  }
  return input + output;
}
