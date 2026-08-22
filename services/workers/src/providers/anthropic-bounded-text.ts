import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import type { SignalSemanticContextProposalProviderV1 } from "@noisia/query-engine";

/** Canonical Worker transport. Domain adapters own prompts, schemas and authority. */
export async function generateAnthropicBoundedTextV1(request: {
  model: string;
  prompt: string;
  max_output_tokens?: number;
  temperature: number;
}) {
  const result = await generateText({ model: anthropic(request.model), prompt: request.prompt,
    temperature: request.temperature, maxOutputTokens: request.max_output_tokens, maxRetries: 0 });
  return { text: result.text, provider_request_id: null,
    usage: { input_tokens: Math.max(0, Math.floor(result.usage.inputTokens ?? 0)),
      output_tokens: Math.max(0, Math.floor(result.usage.outputTokens ?? 0)) } };
}

export function createAnthropicSemanticContextProposalProviderV1(): SignalSemanticContextProposalProviderV1 {
  return { generate: (request) => generateAnthropicBoundedTextV1({ model: request.model,
    prompt: request.prompt, max_output_tokens: request.max_output_tokens,
    temperature: request.temperature }) };
}
