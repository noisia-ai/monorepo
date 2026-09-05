import {
  SignalTopicEvaluationProviderBoundaryErrorV1,
  signalTopicEvaluationProviderTurnSchemaV2,
  type SignalTopicEvaluationModelInputV2
} from "@noisia/query-engine";
import { z } from "zod";

import { generateAnthropicBoundedTextV1, mapAnthropicTopicEvaluationBoundaryErrorV1 } from "./anthropic-bounded-text";

type BoundedTransport = typeof generateAnthropicBoundedTextV1;

export type SignalTopicEvaluationV2Pricing = {
  input_micro_usd_per_token: number;
  output_micro_usd_per_token: number;
};

/**
 * The UAT execution contract and the disposable Lab deliberately share the bounded transport,
 * but not the same first-turn protocol. Keep the historical UAT path catalog-first until a
 * separately migrated UAT contract explicitly opts into the Lab's context bootstrap.
 */
export type SignalTopicEvaluationBootstrapModeV2 = "catalog_first_v1" | "context_first_lab_v1" |
  "context_first_lab_v2";

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
// The context-first Lab needs breadth across ten potential candidates, then one final synthesis.
// Keep its first-pass evidence working set compact: the full bounded search surface remains
// available through the normal server-owned operations in later, separately governed work.
const LAB_INITIAL_REPRESENTATIVE_MENTION_LIMIT = 3;
const LAB_FINAL_TURN_INDEX = 11;
const LAB_NAVIGATION_CONTEXT_MAX_BYTES = 20 * 1024;
const LAB_FINAL_CONTEXT_MAX_BYTES = 64 * 1024;
const LAB_FINAL_INPUT_RESERVE_TOKENS = 72 * 1024;
const LAB_FINAL_OUTPUT_RESERVE_TOKENS = 12 * 1024;

// Anthropic custom-tool schemas require a root JSON object. The turn protocol itself is a
// discriminated union, which serializes as a root union without `input_schema.type`; carry it in
// an explicit envelope at the provider boundary and unwrap it before the server-owned protocol.
const signalTopicEvaluationProviderTurnEnvelopeSchemaV2 = z.object({
  turn: signalTopicEvaluationProviderTurnSchemaV2
}).strict();

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
  bootstrap_mode?: SignalTopicEvaluationBootstrapModeV2;
}, transport: BoundedTransport = generateAnthropicBoundedTextV1) {
  return {
    next: async (input: SignalTopicEvaluationModelInputV2) => {
      const bootstrapMode = args.bootstrap_mode ?? "catalog_first_v1";
      const prompt = buildPrompt(args.snapshot_digest, input, bootstrapMode);
      const maximumInputTokens = promptInputTokenCeiling(prompt);
      const maximumInputCost = costMicroUsd(maximumInputTokens, 0, args.pricing);
      const allocation = labV2TurnAllocation(input, bootstrapMode, maximumInputTokens,
        maximumInputCost, args.pricing);
      if (maximumInputTokens > allocation.max_input_tokens
          || maximumInputCost > allocation.max_cost_micro_usd) {
        throw new SignalTopicEvaluationProviderBoundaryErrorV1(
          "definitely_not_sent", "topic_evaluation_v2_provider_input_budget_exhausted");
      }
      const remainingCostAfterInput = allocation.max_cost_micro_usd - maximumInputCost;
      const affordableOutputTokens = args.pricing.output_micro_usd_per_token === 0
        ? allocation.max_output_tokens
        : Math.floor(remainingCostAfterInput / args.pricing.output_micro_usd_per_token);
      const maxOutputTokens = Math.min(args.max_output_tokens, allocation.max_output_tokens,
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
            schema: signalTopicEvaluationProviderTurnEnvelopeSchemaV2,
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
          parsed = signalTopicEvaluationProviderTurnEnvelopeSchemaV2.parse(JSON.parse(result.text)).turn;
        } catch {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        if (isContextFirstLab(bootstrapMode) && input.turn_index === 0
            && (parsed.kind !== "tool" || parsed.request.operation !== "evaluation_brief")) {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        // 0112's UAT retrieval ledger predates the Lab-only operation. Reject it before the
        // shared runner can navigate or persist an unsupported request, while preserving metered
        // usage as a terminal received-response outcome.
        if (bootstrapMode === "catalog_first_v1" && parsed.kind === "tool"
            && parsed.request.operation === "evaluation_brief") {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        if (bootstrapMode === "context_first_lab_v2" && input.turn_index > 0
            && input.turn_index < LAB_FINAL_TURN_INDEX && parsed.kind !== "tool") {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        if (bootstrapMode === "context_first_lab_v2" && input.turn_index === LAB_FINAL_TURN_INDEX
            && parsed.kind !== "final") {
          throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
        }
        const request = parsed.kind === "tool" ? normalizeLabNavigationRequest(
          bootstrapMode, input, parsed.request, usage) : null;
        return parsed.kind === "tool"
          ? { kind: "tool" as const, request: request!, usage }
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

function buildPrompt(snapshotDigest: string, input: SignalTopicEvaluationModelInputV2,
  bootstrapMode: SignalTopicEvaluationBootstrapModeV2) {
  const common = [
    "You are the bounded Full Evidence Topic Evaluation agent for Noisia.",
    "You are reviewing candidate topics only. You must never adopt, publish, serve, delete or mutate a Topic.",
    "The only evidence available to you is the prior server-owned navigation output below. Do not infer unseen mentions.",
    "When more evidence is needed, return exactly one allowed navigation request. Never request SQL, raw IDs, URLs, files, credentials or unbounded corpus content.",
  ];
  const protocol = isContextFirstLab(bootstrapMode)
    ? [
      "On turn zero, request evaluation_brief. It returns the compact approved Brand OS map and a deterministic Brand-OS-anchored shortlist; it is orientation, not mention evidence.",
      "Use the brief to select coherent clusters, then retrieve representative_mentions for every source cluster you use in a candidate. Judge relevance against the Brand OS map and the returned mentions, not generic term overlap.",
      "Practical Lab success is at least ten distinct, coherent, evidence-backed editable candidates when the brief contains that many plausible Brand-OS-anchored clusters. Before finalising, use one representative_mentions navigation with limit exactly 3 for up to ten distinct shortlist clusters with non-empty brand_os_matches. The server caps this first-pass sample at three per cluster to preserve a final synthesis turn; it does not remove the later bounded search surface. Do not finalise early merely because the first few candidates are strong; omit only unsupported, duplicate, or clearly out-of-scope clusters.",
      "There are at most 12 total model turns: turn zero is evaluation_brief; use turns 1 through 10 for ten compact representative samples; turn 11 must return the final candidate output, never another navigation request.",
      "When enough evidence is available, return only the final pending candidate output. Each candidate must cite evidence references already returned and source cluster keys you actually navigated. Preserve a complete useful pool; ranking is only the Top-10 projection."
    ]
    : ["When enough evidence is available, return only the final pending candidate output. Each candidate must cite evidence references already returned and cluster keys you actually navigated."];
  return [...common, ...protocol,
    `Frozen snapshot digest: ${snapshotDigest}.`,
    `Turn index: ${input.turn_index}.`,
    `Remaining output-token ceiling: ${input.remaining_output_tokens}.`,
    "Prior bounded navigation results (possibly empty):",
    JSON.stringify(bootstrapMode === "context_first_lab_v2"
      ? input.turn_index === LAB_FINAL_TURN_INDEX
        ? compactLabFinalContext(input.prior_results)
        : input.turn_index > 0
          ? compactLabNavigationContext(input.prior_results)
          : input.prior_results
      : input.prior_results)
  ].join("\n\n");
}

/** Give every required Lab turn an equal, hard maximum. Reserving only the final turn still
 * permits an early verbose tool response to consume the remaining flight before synthesis. */
function labV2TurnAllocation(input: SignalTopicEvaluationModelInputV2,
  mode: SignalTopicEvaluationBootstrapModeV2, maximumInputTokens: number,
  maximumInputCost: number, pricing: SignalTopicEvaluationV2Pricing) {
  if (mode !== "context_first_lab_v2" || input.turn_index >= LAB_FINAL_TURN_INDEX) {
    return { max_input_tokens: input.remaining_input_tokens,
      max_output_tokens: input.remaining_output_tokens,
      max_cost_micro_usd: input.remaining_cost_micro_usd };
  }
  const remainingPreFinalTurns = LAB_FINAL_TURN_INDEX - input.turn_index;
  const finalReserveCost = costMicroUsd(LAB_FINAL_INPUT_RESERVE_TOKENS,
    LAB_FINAL_OUTPUT_RESERVE_TOKENS, pricing);
  const inputAvailable = input.remaining_input_tokens - LAB_FINAL_INPUT_RESERVE_TOKENS;
  const outputAvailable = input.remaining_output_tokens - LAB_FINAL_OUTPUT_RESERVE_TOKENS;
  const costAvailable = input.remaining_cost_micro_usd - finalReserveCost;
  const allocation = { max_input_tokens: Math.floor(inputAvailable / remainingPreFinalTurns),
    max_output_tokens: Math.floor(outputAvailable / remainingPreFinalTurns),
    max_cost_micro_usd: Math.floor(costAvailable / remainingPreFinalTurns) };
  if (allocation.max_input_tokens < 1 || allocation.max_output_tokens < 1
      || allocation.max_cost_micro_usd < maximumInputCost || maximumInputTokens > allocation.max_input_tokens) {
    throw new SignalTopicEvaluationProviderBoundaryErrorV1(
      "definitely_not_sent", "topic_evaluation_v2_lab_turn_budget_exhausted");
  }
  return allocation;
}

function isContextFirstLab(mode: SignalTopicEvaluationBootstrapModeV2) {
  return mode === "context_first_lab_v1" || mode === "context_first_lab_v2";
}

function normalizeLabNavigationRequest(mode: SignalTopicEvaluationBootstrapModeV2,
  input: SignalTopicEvaluationModelInputV2, request: Extract<
    import("@noisia/query-engine").SignalTopicEvaluationProviderTurnV2,{kind:"tool"}>["request"],
  usage: { input_tokens: number; output_tokens: number; cost_micro_usd: number }) {
  if (mode !== "context_first_lab_v2") return request;
  if (input.turn_index === 0 && request.operation === "evaluation_brief") return request;
  if (input.turn_index >= LAB_FINAL_TURN_INDEX || request.operation !== "representative_mentions") {
    throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
  }
  const brief = input.prior_results.find((result) => result.operation === "evaluation_brief");
  const allowed = brief?.data.shortlist.clusters.filter((cluster) => cluster.brand_os_match_count > 0)
    .map((cluster) => cluster.cluster_key) ?? [];
  const alreadyNavigated = input.prior_results.some((result) => result.operation === "representative_mentions"
    && result.data.cluster_key === request.cluster_key);
  if (!allowed.includes(request.cluster_key) || alreadyNavigated) {
    throw new SignalTopicEvaluationProviderResponseInvalidErrorV2(usage);
  }
  return { ...request, limit: LAB_INITIAL_REPRESENTATIVE_MENTION_LIMIT };
}

function compactText(value: string, maximum: number) {
  return value.slice(0, maximum);
}

/** The working set for turns 1–10 deliberately excludes previous mention excerpts. The model
 * needs the deterministic Brand OS anchor map plus the already selected cluster keys to choose
 * its next bounded sample; it receives the actual excerpts together only for final synthesis. */
function compactLabNavigationContext(priorResults: SignalTopicEvaluationModelInputV2["prior_results"]) {
  const brief = priorResults.find((result) => result.operation === "evaluation_brief");
  const alreadyNavigated = priorResults.filter((result) => result.operation === "representative_mentions")
    .map((result) => result.data.cluster_key).sort((left, right) => left.localeCompare(right));
  let clusters = brief?.data.shortlist.clusters.filter((cluster) => cluster.brand_os_match_count > 0)
    .slice(0, 24).map((cluster) => ({ cluster_key: compactText(cluster.cluster_key, 160),
      proposal_key: compactText(cluster.proposal_key, 160), member_count: cluster.member_count,
      brand_os_matches: cluster.brand_os_matches.slice(0, 3).map((key) => compactText(key, 160)),
      terms: cluster.terms.slice(0, 3).map((term) => compactText(term, 80)),
      phrases: cluster.phrases.slice(0, 3).map((phrase) => compactText(phrase, 80)) })) ?? [];
  let compact = { contract: "context_first_lab_v2_navigation_projection", shortlist: clusters,
    already_navigated_cluster_keys: alreadyNavigated };
  while (Buffer.byteLength(JSON.stringify(compact), "utf8") > LAB_NAVIGATION_CONTEXT_MAX_BYTES
      && clusters.length > 1) {
    clusters = clusters.slice(0, -1);
    compact = { ...compact, shortlist: clusters };
  }
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") > LAB_NAVIGATION_CONTEXT_MAX_BYTES) {
    throw new SignalTopicEvaluationProviderBoundaryErrorV1("definitely_not_sent",
      "topic_evaluation_v2_lab_navigation_context_too_large");
  }
  return compact;
}

/** Deterministic final-turn projection: enough identifiers and evidence to cite ten compact
 * samples, without replaying the unused 80-element/24-cluster orientation document. */
function compactLabFinalContext(priorResults: SignalTopicEvaluationModelInputV2["prior_results"]) {
  const brief = priorResults.find((result) => result.operation === "evaluation_brief");
  const representatives = priorResults.filter((result) => result.operation === "representative_mentions");
  const selectedKeys = new Set(representatives.map((result) => result.data.cluster_key));
  const clusters = brief?.data.shortlist.clusters.filter((cluster) => selectedKeys.has(cluster.cluster_key))
    .map((cluster) => ({ cluster_key: cluster.cluster_key, proposal_key: cluster.proposal_key,
      member_count: cluster.member_count,
      brand_os_matches: cluster.brand_os_matches.slice(0, 12).map((key) => compactText(key, 160)) })) ?? [];
  const selectedBrandOsKeys = [...new Set(clusters.flatMap((cluster) => cluster.brand_os_matches))]
    .sort((left, right) => left.localeCompare(right)).slice(0, 16);
  const compact = { contract: "context_first_lab_v2_final_projection",
    brand_os_keys: selectedBrandOsKeys,
    selected_clusters: clusters,
    representative_evidence: representatives.map((result) => ({ cluster_key: result.data.cluster_key,
      evidence_refs: result.evidence_refs, mentions: result.data.mentions.slice(0,
        LAB_INITIAL_REPRESENTATIVE_MENTION_LIMIT).map((mention) => ({ evidence_ref: mention.evidence_ref,
        excerpt: compactText(mention.excerpt, 180), language: mention.language === null ? null
          : compactText(mention.language, 32), market: mention.market === null ? null
          : compactText(mention.market, 32), scope: mention.scope === null ? null
          : compactText(mention.scope, 80),
        month: compactText(mention.month, 32), stratum: compactText(mention.stratum, 80) })) })) };
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") > LAB_FINAL_CONTEXT_MAX_BYTES) {
    throw new SignalTopicEvaluationProviderBoundaryErrorV1("definitely_not_sent",
      "topic_evaluation_v2_lab_final_context_too_large");
  }
  return compact;
}

export const signalTopicEvaluationFullEvidenceTestOnly = { compactLabFinalContext,
  compactLabNavigationContext,labV2TurnAllocation,LAB_FINAL_TURN_INDEX,
  LAB_NAVIGATION_CONTEXT_MAX_BYTES,LAB_FINAL_CONTEXT_MAX_BYTES,LAB_FINAL_INPUT_RESERVE_TOKENS,
  LAB_FINAL_OUTPUT_RESERVE_TOKENS,promptInputTokenCeiling,buildPrompt };

function costMicroUsd(inputTokens: number, outputTokens: number, pricing: SignalTopicEvaluationV2Pricing) {
  const input = Math.ceil(inputTokens * pricing.input_micro_usd_per_token);
  const output = Math.ceil(outputTokens * pricing.output_micro_usd_per_token);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) {
    throw new Error("topic_evaluation_v2_usage_cost_invalid");
  }
  return input + output;
}
