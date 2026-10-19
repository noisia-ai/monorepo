import type {
  SignalSemanticResolutionGovernedContextV1,
  SignalSemanticResolutionMentionContextV1
} from "@noisia/db";

import {
  buildSignalSemanticResolutionJsonSchemaV1,
  buildSignalSemanticResolutionMentionPromptV1,
  buildSignalSemanticResolutionSystemPromptV1,
  signalSemanticResolutionCustomIdV1
} from "./signal-semantic-resolution-contract";

import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";

export type AnthropicBatchCountsV1 = {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
};

export type AnthropicMessageBatchV1 = {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: AnthropicBatchCountsV1;
  ended_at: string | null;
  results_url: string | null;
};

type AnthropicUsageV1 = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type AnthropicBatchResultV1 = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: { content: Array<{ type: string; text?: string }>; usage?: AnthropicUsageV1 } }
    | {
      type: "errored";
      error?: {
        type?: string;
        message?: string;
        error?: { type?: string; message?: string };
        request_id?: string | null;
      };
    }
    | { type: "canceled" }
    | { type: "expired" };
};

export async function createSignalSemanticResolutionMessageBatchV1(args: {
  model: string;
  governedContext: SignalSemanticResolutionGovernedContextV1;
  mentions: SignalSemanticResolutionMentionContextV1[];
}) {
  if (args.mentions.length === 0) throw new Error("semantic_resolution_empty_provider_batch");
  const system = buildSignalSemanticResolutionSystemPromptV1(args.governedContext);
  const schema = buildSignalSemanticResolutionJsonSchemaV1(args.governedContext);
  return batchClient().create(args.mentions.map((mention) => ({
        custom_id: signalSemanticResolutionCustomIdV1(mention.mention_id),
        params: {
          model: args.model,
          max_tokens: 1_000,
          temperature: 0,
          system: [{
            type: "text",
            text: system,
            cache_control: { type: "ephemeral", ttl: "1h" }
          }],
          messages: [{
            role: "user",
            content: buildSignalSemanticResolutionMentionPromptV1(mention)
          }],
          output_config: {
            format: {
              type: "json_schema",
              schema
            }
          }
        }
      })));
}

export function getSignalSemanticResolutionMessageBatchV1(batchId: string) {
  return batchClient().get(batchId);
}

export function cancelSignalSemanticResolutionMessageBatchV1(batchId:string){
  return batchClient().cancel(batchId);
}

export async function loadSignalSemanticResolutionMessageBatchResultsV1(
  batch: AnthropicMessageBatchV1
) {
  if (batch.processing_status !== "ended") throw new Error("semantic_resolution_provider_batch_not_ended");
  const results: AnthropicBatchResultV1[] = [];
  for await (const { item } of batchClient().results(batch)) {
    results.push(item as AnthropicBatchResultV1);
  }
  return results;
}

export function parseSignalSemanticResolutionBatchMessageTextV1(
  result: Extract<AnthropicBatchResultV1["result"], { type: "succeeded" }>
) {
  const text = result.message.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("semantic_resolution_provider_result_missing_text");
  return JSON.parse(text) as unknown;
}

export function signalSemanticResolutionBatchUsageV1(
  result: Extract<AnthropicBatchResultV1["result"], { type: "succeeded" }>
) {
  const usage = result.message.usage ?? {};
  const input = nonnegativeInteger(usage.input_tokens);
  const output = nonnegativeInteger(usage.output_tokens);
  const cacheCreation = nonnegativeInteger(usage.cache_creation_input_tokens);
  const cacheRead = nonnegativeInteger(usage.cache_read_input_tokens);
  // Batch pricing for Sonnet: input $1.50/MTok, output $7.50/MTok.
  // One-hour cache writes and reads use the corresponding batch-discounted rates.
  const cost = (
    input * 1.5
    + output * 7.5
    + cacheCreation * 3
    + cacheRead * 0.15
  ) / 1_000_000;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000
  };
}

export function signalSemanticResolutionBatchUsageV2(
  result: Extract<AnthropicBatchResultV1["result"], { type: "succeeded" }>
) {
  const usage = result.message.usage ?? {};
  const input = nonnegativeInteger(usage.input_tokens);
  const output = nonnegativeInteger(usage.output_tokens);
  const cacheCreation = nonnegativeInteger(usage.cache_creation_input_tokens);
  const cacheRead = nonnegativeInteger(usage.cache_read_input_tokens);
  // Exact micro-USD arithmetic: batch input 3/2, output 15/2,
  // one-hour cache writes 3, and reads 3/20 micro-USD per token.
  const numerator = BigInt(input) * 30n
    + BigInt(output) * 150n
    + BigInt(cacheCreation) * 60n
    + BigInt(cacheRead) * 3n;
  const costMicroUsd = numerator === 0n ? 0n : (numerator + 19n) / 20n;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    cost_micro_usd: costMicroUsd.toString(),
    cost_usd: `${costMicroUsd / 1_000_000n}.${(costMicroUsd % 1_000_000n)
      .toString().padStart(6, "0")}`
  };
}

export function signalSemanticResolutionBatchErrorCodeV1(
  result: Exclude<AnthropicBatchResultV1["result"], { type: "succeeded" }>
) {
  if (result.type !== "errored") return `semantic_resolution_provider_${result.type}`;
  const providerType = result.error?.error?.type ?? result.error?.type ?? "errored";
  const normalized = providerType.replace(/[^a-z0-9_]+/giu, "_").toLowerCase();
  return `semantic_resolution_provider_${normalized}`.slice(0, 120);
}

function batchClient() {
  return createAnthropicMessageBatchesClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}
