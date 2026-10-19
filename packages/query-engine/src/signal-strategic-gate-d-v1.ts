import { createHash } from "node:crypto";

import { TB_OPEN_PASS_BATCH_SIZE } from "./tb";
import {
  validateSignalCoverageDescriptorV1,
  type SignalCoverageDescriptorV1
} from "./signal-governed-views-v1";

export const SIGNAL_STRATEGIC_GATE_D_CONTRACT_VERSION =
  "signal-strategic-gate-d-v1" as const;
export const SIGNAL_STRATEGIC_GATE_D_MODULE_KEY = "triggers-barriers" as const;
export const SIGNAL_STRATEGIC_GATE_D_VIEW_KEY = "strategic" as const;
export const SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES = [
  "llm-processing",
  "strategic-analysis"
] as const;
export const SIGNAL_STRATEGIC_SAMPLE_ALGORITHM =
  "canonical-root-sha256-rank-v1" as const;

export type SignalStrategicPinnedProviderV1 = {
  provider: "anthropic";
  model: string;
  prompt_version: string;
  pricing_version: string;
  input_usd_per_million_tokens: number;
  output_usd_per_million_tokens: number;
  config_digest: string;
};

export type SignalStrategicBudgetV1 = {
  currency: "USD";
  estimated_cost_usd: number;
  hard_cap_usd: number;
  planned_provider_calls: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
};

export type SignalStrategicAuthorityV1 = {
  binding_id: string;
  policy_bundle_id: string;
  policy_compilation_id: string;
  governance_evaluation_id: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  membership_digest: string;
  governance_digest: string;
  provenance_digest: string;
  watermark_hash: string;
  governance_unknown_count: 0;
  next_policy_transition_at: string | null;
};

export type SignalStrategicCoverageV1 = SignalCoverageDescriptorV1;

export type SignalStrategicRuntimeReadinessV1 = {
  queue_configured: true;
  worker_alive: true;
  provider_key_configured: true;
  recovery_ready: true;
};

export type SignalStrategicPreflightIdentityV1 = {
  workspace_id: string;
  period_start: string;
  period_end: string;
  timezone: string;
  study_size: "small" | "medium" | "large" | "full_power";
  execution: {
    study_corpus_id: string;
    corpus_revision: number;
    pipeline_version: string;
    methodology_version: string;
  };
  denominator: {
    key: "snapshot-canonical-roots";
    count: number;
    canonical_ids_digest: string;
    alias_membership_count: 0;
  };
  coverage: SignalStrategicCoverageV1;
  sample_count: number;
  sample_digest: string;
  sample_seed: string;
  authority: SignalStrategicAuthorityV1;
  provider: SignalStrategicPinnedProviderV1;
  budget: SignalStrategicBudgetV1;
  readiness: SignalStrategicRuntimeReadinessV1;
  destinations: {
    status: string;
    cancel: string;
    review: string;
    release: string;
    report: string;
    retry_policy: "durable-step-outbox-bounded-v1";
  };
};

export function signalStrategicDeterministicSampleV1(
  canonicalMentionIds: readonly string[],
  seed: string,
  limit: number
) {
  if (!seed.trim()) throw new Error("A deterministic sample seed is required.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("A positive sample limit is required.");
  const roots = [...new Set(canonicalMentionIds.map((value) => value.toLowerCase()))];
  roots.sort((left, right) => {
    const leftRank = sha256(`${SIGNAL_STRATEGIC_SAMPLE_ALGORITHM}\u001f${seed}\u001f${left}`);
    const rightRank = sha256(`${SIGNAL_STRATEGIC_SAMPLE_ALGORITHM}\u001f${seed}\u001f${right}`);
    return leftRank.localeCompare(rightRank) || left.localeCompare(right);
  });
  const mentionIds = roots.slice(0, limit);
  return {
    algorithm: SIGNAL_STRATEGIC_SAMPLE_ALGORITHM,
    mention_ids: mentionIds,
    digest: `sha256:${sha256(mentionIds.join(","))}`
  } as const;
}

export function signalStrategicPreflightDigestV1(
  input: SignalStrategicPreflightIdentityV1
) {
  const coverage = validateSignalCoverageDescriptorV1(input.coverage);
  assertHash(input.sample_digest, "sample_digest");
  assertHash(input.sample_seed, "sample_seed");
  assertHash(input.denominator.canonical_ids_digest, "canonical_ids_digest");
  assertHash(input.provider.config_digest, "provider.config_digest");
  for (const [key, value] of Object.entries(input.authority)) {
    if (key.endsWith("_hash") || key.endsWith("_digest")) assertHash(value, key);
  }
  if (input.authority.governance_unknown_count !== 0) {
    throw new Error("Strategic preflight fails closed when governance is unknown.");
  }
  if (input.denominator.count < 1
    || input.denominator.alias_membership_count !== 0
    || coverage.used_by_view.availability !== "available"
    || input.denominator.count !== coverage.used_by_view.count
    || coverage.abstained.availability !== "not_available"
    || coverage.abstained.count !== null) {
    throw new Error("Strategic denominator and coverage must be exact canonical roots.");
  }
  if (input.execution.corpus_revision < 1
    || !input.execution.study_corpus_id.trim()
    || !input.execution.pipeline_version.trim()
    || !input.execution.methodology_version.trim()) {
    throw new Error("Strategic execution authority must be server-owned and versioned.");
  }
  if (!Object.values(input.readiness).every((value) => value === true)) {
    throw new Error("Strategic runtime readiness must pass fail-closed before launch.");
  }
  if (!Number.isFinite(input.budget.hard_cap_usd)
    || input.budget.hard_cap_usd <= 0
    || input.budget.estimated_cost_usd < 0
    || input.budget.estimated_cost_usd > input.budget.hard_cap_usd
    || !Number.isInteger(input.budget.planned_provider_calls)
    || input.budget.planned_provider_calls < 1
    || !Number.isInteger(input.budget.reserved_input_tokens)
    || input.budget.reserved_input_tokens < 1
    || !Number.isInteger(input.budget.reserved_output_tokens)
    || input.budget.reserved_output_tokens < 1) {
    throw new Error("Strategic budget must be positive and cover the estimate.");
  }
  const provider = input.provider;
  if (!provider.model.trim() || !provider.prompt_version.trim() || !provider.pricing_version.trim()
    || provider.input_usd_per_million_tokens <= 0
    || provider.output_usd_per_million_tokens <= 0) {
    throw new Error("Pinned provider, prompt and pricing authority are required.");
  }
  return `sha256:${sha256(stableJson({
    contract_version: SIGNAL_STRATEGIC_GATE_D_CONTRACT_VERSION,
    module_key: SIGNAL_STRATEGIC_GATE_D_MODULE_KEY,
    view_key: SIGNAL_STRATEGIC_GATE_D_VIEW_KEY,
    usage_purposes: SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES,
    ...input,
    coverage
  }))}`;
}

/**
 * Worst-case reservation plan for the current T&B provider boundaries. Step 6
 * may perform one compact JSON regeneration; every other retry is recovery,
 * never a second provider invocation under the same operation key.
 */
export function signalStrategicProviderBudgetPlanV1(args: {
  sample_count: number;
  max_input_tokens_per_call: number;
  input_usd_per_million_tokens: number | string;
  output_usd_per_million_tokens: number | string;
}) {
  if (!Number.isInteger(args.sample_count) || args.sample_count < 1
    || !Number.isInteger(args.max_input_tokens_per_call)
    || args.max_input_tokens_per_call < 1) {
    throw new Error("Strategic provider budget inputs must be positive integers/rates.");
  }
  const openPassCalls = Math.ceil(args.sample_count / TB_OPEN_PASS_BATCH_SIZE);
  const calls = [
    { operation: "preflight", count: 1, max_output_tokens: 8_000 },
    { operation: "step1-open-pass", count: openPassCalls, max_output_tokens: 4_000 },
    { operation: "step2-coding", count: 1, max_output_tokens: 8_000 },
    { operation: "step3-hierarchy", count: 1, max_output_tokens: 8_000 },
    { operation: "step4-mobility", count: 1, max_output_tokens: 8_000 },
    { operation: "step6-synthesis", count: 2, max_output_tokens: 20_000 },
    { operation: "step6-humanizer", count: 1, max_output_tokens: 26_000 }
  ] as const;
  const plannedProviderCalls = calls.reduce((sum, call) => sum + call.count, 0);
  const reservedInputTokens = plannedProviderCalls * args.max_input_tokens_per_call;
  const reservedOutputTokens = calls.reduce(
    (sum, call) => sum + call.count * call.max_output_tokens,
    0
  );
  const reservationUpperBoundMicroUsd = signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens: reservedInputTokens,
    output_tokens: reservedOutputTokens,
    input_usd_per_million_tokens: args.input_usd_per_million_tokens,
    output_usd_per_million_tokens: args.output_usd_per_million_tokens
  });
  if (reservationUpperBoundMicroUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Strategic provider reservation exceeds the exact USD contract range.");
  }
  const reservationUpperBoundUsd = Number(reservationUpperBoundMicroUsd) / 1_000_000;
  return {
    contract_version: "signal-strategic-provider-budget-plan-v1" as const,
    calls,
    planned_provider_calls: plannedProviderCalls,
    max_input_tokens_per_call: args.max_input_tokens_per_call,
    reserved_input_tokens: reservedInputTokens,
    reserved_output_tokens: reservedOutputTokens,
    reservation_upper_bound_micro_usd: reservationUpperBoundMicroUsd.toString(),
    reservation_upper_bound_usd: reservationUpperBoundUsd
  };
}

/**
 * Exact conservative provider cost in integer micro-USD. Because provider
 * pricing is expressed in USD per million tokens, `tokens * rate` is already
 * measured in micro-USD. Decimal rates are parsed as integers and powers of
 * ten; no IEEE-754 multiplication or rounding participates in the authority.
 */
export function signalStrategicCostUpperBoundMicroUsdV1(args: {
  input_tokens: number;
  output_tokens: number;
  input_usd_per_million_tokens: number | string;
  output_usd_per_million_tokens: number | string;
}) {
  if (!Number.isSafeInteger(args.input_tokens) || args.input_tokens < 0
      || !Number.isSafeInteger(args.output_tokens) || args.output_tokens < 0) {
    throw new Error("Strategic provider token reservations must be safe non-negative integers.");
  }
  const inputRate = parseExactPositiveRate(args.input_usd_per_million_tokens);
  const outputRate = parseExactPositiveRate(args.output_usd_per_million_tokens);
  const scale = Math.max(inputRate.scale, outputRate.scale);
  const denominator = 10n ** BigInt(scale);
  const inputNumerator = BigInt(args.input_tokens) * inputRate.coefficient
    * (10n ** BigInt(scale - inputRate.scale));
  const outputNumerator = BigInt(args.output_tokens) * outputRate.coefficient
    * (10n ** BigInt(scale - outputRate.scale));
  return ceilDivide(inputNumerator + outputNumerator, denominator);
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseExactPositiveRate(value: number | string) {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
    throw new Error("Strategic provider rates must be finite and positive.");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(raw);
  if (!match) throw new Error("Strategic provider rates must be positive decimals.");
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent)) {
    throw new Error("Strategic provider rate exponent is outside the exact range.");
  }
  let coefficient = BigInt(`${whole}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (coefficient <= 0n || scale > 6) {
    throw new Error("Strategic provider rates must be positive with at most 6 decimals.");
  }
  return { coefficient, scale };
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) {
    throw new Error("Exact strategic provider cost division is invalid.");
  }
  return (numerator + denominator - 1n) / denominator;
}
