import { createHash } from "node:crypto";

export const SIGNAL_SEMANTIC_RESOLUTION_JOB_NAME = "signal-semantic-resolution-v1" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME = "signal-semantic-resolution-child-v2" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME = "noisia-semantic-resolution" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_CONTRACT_VERSION = "signal-semantic-resolution-v1" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY = "signal-semantic-claude-resolution" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION = "3" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL = "claude-sonnet-4-6" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD = 40;
export const SIGNAL_SEMANTIC_RESOLUTION_BATCH_SIZE = 24;
export const SIGNAL_SEMANTIC_RESOLUTION_PREFLIGHT_CONTRACT_VERSION = "signal-semantic-resolution-preflight-v2" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_PRICING_VERSION = "anthropic-message-batches-2026-08-13" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_BATCH_INPUT_USD_PER_MILLION_TOKENS = "1.500000" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_BATCH_OUTPUT_USD_PER_MILLION_TOKENS = "7.500000" as const;
export const SIGNAL_SEMANTIC_RESOLUTION_PROVIDER_ITEM_LIMIT = 50_000;

export type SignalSemanticResolutionRunStatusV1 =
  | "queued"
  | "running"
  | "applying"
  | "completed"
  | "partial"
  | "failed"
  | "canceling"
  | "canceled";

export type SignalSemanticResolutionItemStatusV1 =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type SignalSemanticResolutionJobDataV1 = {
  run_id: string;
  workspace_id: string;
  requested_by_user_id: string;
  model_version: string;
  policy_version: typeof SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION;
  budget_cap_usd: number;
};

export type SignalSemanticResolutionChildJobDataV2 = {
  outbox_id: string;
  run_id: string;
  child_batch_id: string;
  workspace_id: string;
};

export type SignalSemanticResolutionEstimateInputV1 = {
  mention_count: number;
  mention_character_count: number;
  context_character_count: number;
  batch_size?: number;
};

export type SignalSemanticResolutionEstimateV1 = {
  mention_count: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  confirmation_required: boolean;
  threshold_usd: number;
};

export type SignalSemanticResolutionEstimateV2 = {
  mention_count: number;
  provider_batch_count: number;
  provider_batch_item_limit: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_micro_usd: string;
  estimated_cost_usd: string;
  hard_cap_micro_usd: string;
  hard_cap_usd: string;
  confirmation_required: boolean;
  confirmation_threshold_usd: number;
  within_hard_cap: boolean;
};

export type SignalSemanticResolutionRunV1 = {
  contract_version: typeof SIGNAL_SEMANTIC_RESOLUTION_CONTRACT_VERSION;
  run_id: string;
  workspace_id: string;
  status: SignalSemanticResolutionRunStatusV1;
  model_version: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  budget_threshold_usd: number;
  budget_cap_usd: number;
  over_budget_confirmed: boolean;
  provider_batch_id: string | null;
  provider_batch_status:
    | "not_submitted"
    | "submitting"
    | "in_progress"
    | "canceling"
    | "ended";
  provider_processing_items: number;
  provider_succeeded_items: number;
  provider_errored_items: number;
  provider_canceled_items: number;
  provider_expired_items: number;
  provider_submitted_at: string | null;
  provider_ended_at: string | null;
  provider_results_imported_at: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type SignalSemanticResolutionClassificationV1 = {
  scope: "primary_brand" | "competitor" | "category" | "reference" | "unattributed";
  entity_id: string | null;
  confidence: number;
  rationale: string;
};

export type SignalSemanticResolutionDecisionV1 = {
  mention_id: string;
  classifications: SignalSemanticResolutionClassificationV1[];
};

// Anthropic Message Batches are billed at 50% of the standard token price.
// Cache savings are deliberately excluded so the preflight remains conservative.
const SONNET_BATCH_INPUT_USD_PER_MILLION_TOKENS = 1.5;
const SONNET_BATCH_OUTPUT_USD_PER_MILLION_TOKENS = 7.5;
const COST_SAFETY_MULTIPLIER = 1.35;

export function estimateSignalSemanticResolutionCostV1(
  input: SignalSemanticResolutionEstimateInputV1
): SignalSemanticResolutionEstimateV1 {
  const mentionCount = boundedInteger(input.mention_count, 0);
  const mentionCharacters = boundedInteger(input.mention_character_count, 0);
  const contextCharacters = boundedInteger(input.context_character_count, 0);
  const batchSize = Math.max(1, boundedInteger(input.batch_size ?? 1, 1));
  const requestCount = mentionCount === 0 ? 0 : Math.ceil(mentionCount / batchSize);

  // The estimate intentionally errs high: each mention carries structural prompt overhead,
  // the governed workspace context is repeated per batch, and output reserves room for rationale.
  const estimatedInputTokens = Math.ceil(
    mentionCharacters / 3.5
    + mentionCount * 90
    + requestCount * (contextCharacters / 3.5 + 1_200)
  );
  const estimatedOutputTokens = Math.ceil(mentionCount * 120);
  const rawCost = (
    estimatedInputTokens * SONNET_BATCH_INPUT_USD_PER_MILLION_TOKENS
    + estimatedOutputTokens * SONNET_BATCH_OUTPUT_USD_PER_MILLION_TOKENS
  ) / 1_000_000;
  const estimatedCost = mentionCount === 0 ? 0 : roundCurrency(rawCost * COST_SAFETY_MULTIPLIER);

  return {
    mention_count: mentionCount,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_cost_usd: estimatedCost,
    confirmation_required: estimatedCost > SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD,
    threshold_usd: SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD
  };
}

export function estimateSignalSemanticResolutionCostV2(input: {
  mention_count: number;
  mention_character_count: number;
  context_character_count: number;
  hard_cap_usd: string;
  provider_batch_item_limit?: number;
}): SignalSemanticResolutionEstimateV2 {
  const mentionCount = boundedInteger(input.mention_count, 0);
  const mentionCharacters = boundedInteger(input.mention_character_count, 0);
  const contextCharacters = boundedInteger(input.context_character_count, 0);
  const providerBatchItemLimit = Math.max(1, Math.min(
    100_000,
    boundedInteger(input.provider_batch_item_limit ?? SIGNAL_SEMANTIC_RESOLUTION_PROVIDER_ITEM_LIMIT, 1)
  ));
  const providerBatchCount = mentionCount === 0 ? 0 : Math.ceil(mentionCount / providerBatchItemLimit);
  const mentionCountInteger = BigInt(mentionCount);
  const inputTokens = ceilDivide(BigInt(mentionCharacters) * 2n, 7n)
    + mentionCountInteger * 90n
    + BigInt(providerBatchCount) * (ceilDivide(BigInt(contextCharacters) * 2n, 7n) + 1_200n);
  const outputTokens = mentionCountInteger * 120n;
  // Message Batches cost 1.5 and 7.5 USD per million tokens. In micro-USD,
  // those rates are exactly 3/2 and 15/2 per token. Apply the existing 1.35
  // conservative safety factor using integer rational arithmetic only.
  const estimatedMicroUsd = mentionCount === 0
    ? 0n
    : ceilDivide((inputTokens * 3n + outputTokens * 15n) * 135n, 200n);
  const hardCapMicroUsd = parseUsdToMicroUsd(input.hard_cap_usd);
  return {
    mention_count: mentionCount,
    provider_batch_count: providerBatchCount,
    provider_batch_item_limit: providerBatchItemLimit,
    estimated_input_tokens: safeBigIntNumber(inputTokens, "estimated_input_tokens"),
    estimated_output_tokens: safeBigIntNumber(outputTokens, "estimated_output_tokens"),
    estimated_cost_micro_usd: estimatedMicroUsd.toString(),
    estimated_cost_usd: formatMicroUsd(estimatedMicroUsd),
    hard_cap_micro_usd: hardCapMicroUsd.toString(),
    hard_cap_usd: formatMicroUsd(hardCapMicroUsd),
    confirmation_required: estimatedMicroUsd > 40_000_000n,
    confirmation_threshold_usd: SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD,
    within_hard_cap: estimatedMicroUsd <= hardCapMicroUsd
  };
}

export function parseUsdToMicroUsd(value: string) {
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(normalized);
  if (!match) throw new Error("hard_cap_usd must be a non-negative decimal with at most six places.");
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

export function formatMicroUsd(value: bigint) {
  if (value < 0n) throw new Error("micro-USD cannot be negative.");
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function signalSemanticResolutionSelectionDigestV2(
  items: Array<{ mention_id: string; context_hash: string }>
) {
  const payload = [...items]
    .sort((left, right) => left.mention_id.localeCompare(right.mention_id))
    .map((item) => `${item.mention_id}|${item.context_hash}`)
    .join("\n");
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

function boundedInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  if (numerator < 0n || denominator <= 0n) throw new Error("ceilDivide requires non-negative values.");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function safeBigIntNumber(value: bigint, name: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds the safe integer range.`);
  return Number(value);
}

function roundCurrency(value: number) {
  return Math.ceil(value * 100) / 100;
}
