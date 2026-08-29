import { anthropic } from "@ai-sdk/anthropic";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { ZodTypeAny } from "zod";

import { buildSignalSemanticContextProviderOutputSchemaV3,
  signalTopicEvaluationProviderOutputSchemaV1,
  stableSignalTopicEvaluationJsonV1,
  stableSignalSemanticContextJsonV1,
  type SignalTopicEvaluationProviderV1,
  type SignalSemanticContextProposalProviderV1 } from "@noisia/query-engine";

/** Canonical Worker transport. Domain adapters own prompts, schemas and authority. */
export async function generateAnthropicBoundedTextV1(request: {
  model: string;
  prompt: string;
  max_output_tokens?: number;
  temperature: number;
  structured_output?: { schema: ZodTypeAny; name: string; description: string };
}) {
  try {
    const result = await generateText({ model: anthropic(request.model), prompt: request.prompt,
      temperature: request.temperature, maxOutputTokens: request.max_output_tokens, maxRetries: 0,
      ...(request.structured_output ? { output: Output.object({
        schema: request.structured_output.schema,
        name: request.structured_output.name,
        description: request.structured_output.description
      }) } : {}) });
    return { text: request.structured_output
      ? stableSignalSemanticContextJsonV1(result.output) : result.text,
    provider_request_id: null,
    usage: { input_tokens: Math.max(0, Math.floor(result.usage.inputTokens ?? 0)),
      output_tokens: Math.max(0, Math.floor(result.usage.outputTokens ?? 0)) } };
  } catch (error) {
    // The provider did answer. Preserve its text and usage so the durable run can fail
    // validation without turning a known paid response into an ambiguous retry state.
    if (request.structured_output && NoObjectGeneratedError.isInstance(error)
        && error.text !== undefined) {
      return { text: error.text, provider_request_id: null,
        usage: { input_tokens: Math.max(0, Math.floor(error.usage?.inputTokens ?? 0)),
          output_tokens: Math.max(0, Math.floor(error.usage?.outputTokens ?? 0)) } };
    }
    throw error;
  }
}

export function createAnthropicTopicEvaluationProviderV1(
  transport: typeof generateAnthropicBoundedTextV1 = generateAnthropicBoundedTextV1
): SignalTopicEvaluationProviderV1 {
  return { generate: async (request) => {
    const result = await transport({ model: request.model, prompt: request.prompt,
      max_output_tokens: request.max_output_tokens, temperature: 0,
      structured_output: { schema: signalTopicEvaluationProviderOutputSchemaV1,
        name: "signal_topic_evaluation_candidates",
        description: "Editable evidence-linked topic evaluation candidates; never Topic adoption." } });
    return { ...result, text: stableSignalTopicEvaluationJsonV1(JSON.parse(result.text)) };
  } };
}

export function createAnthropicSemanticContextProposalProviderV1(
  transport: typeof generateAnthropicBoundedTextV1 = generateAnthropicBoundedTextV1
): SignalSemanticContextProposalProviderV1 {
  return { generate: (request) => transport({ model: request.model,
    prompt: request.prompt, max_output_tokens: request.max_output_tokens,
    temperature: request.temperature, structured_output: {
      schema: buildSignalSemanticContextProviderOutputSchemaV3(request.maximum_proposals),
      name: "signal_semantic_context_proposals",
      description: "Evidence-bound pending Semantic Context Pack proposals for human review."
    } }) };
}
