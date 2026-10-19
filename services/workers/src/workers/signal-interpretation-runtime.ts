import {
  SIGNAL_INTERPRETATION_MAX_ATTEMPTS,
  SIGNAL_INTERPRETATION_TIMEOUT_MS,
  buildDeterministicSignalInterpretationFallbackV1,
  validateSignalMetricInterpretationV1,
  type SignalMetricInterpretationV1,
  type SignalMetricPacketV1
} from "@noisia/query-engine";

export type SignalInterpretationProviderResult = {
  interpretation: SignalMetricInterpretationV1;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type SignalInterpretationExecutionResult =
  | {
      source: "claude";
      interpretation: SignalMetricInterpretationV1;
      attempts: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      fallback_reason: null;
    }
  | {
      source: "deterministic_fallback";
      interpretation: SignalMetricInterpretationV1;
      attempts: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      fallback_reason: string;
    };

export async function executeSignalInterpretationV1(args: {
  packet: SignalMetricPacketV1;
  provider_enabled: boolean;
  budget_cap_usd: number;
  estimated_cost_usd: number;
  provider: (packet: SignalMetricPacketV1) => Promise<SignalInterpretationProviderResult>;
  timeout_ms?: number;
  max_attempts?: number;
}): Promise<SignalInterpretationExecutionResult> {
  if (!args.provider_enabled) return fallback(args.packet, "claude_disabled", 0);
  if (!Number.isFinite(args.budget_cap_usd) || args.budget_cap_usd <= 0) {
    return fallback(args.packet, "budget_cap_not_authorized", 0);
  }
  if (args.estimated_cost_usd > args.budget_cap_usd) {
    return fallback(args.packet, "estimated_cost_exceeds_budget_cap", 0);
  }
  const attempts = Math.max(1, Math.min(
    SIGNAL_INTERPRETATION_MAX_ATTEMPTS,
    Math.floor(args.max_attempts ?? SIGNAL_INTERPRETATION_MAX_ATTEMPTS)
  ));
  let lastError = "interpretation_provider_failed";
  let spentCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (spentCostUsd + args.estimated_cost_usd > args.budget_cap_usd) {
      return fallback(
        args.packet,
        "remaining_budget_below_estimated_attempt_cost",
        attempt - 1,
        spentCostUsd,
        inputTokens,
        outputTokens
      );
    }
    try {
      const result = await withTimeout(
        args.provider(args.packet),
        args.timeout_ms ?? SIGNAL_INTERPRETATION_TIMEOUT_MS
      );
      if (!Number.isFinite(result.cost_usd) || result.cost_usd < 0) {
        return fallback(
          args.packet,
          "provider_returned_invalid_cost",
          attempt,
          spentCostUsd,
          inputTokens,
          outputTokens
        );
      }
      spentCostUsd += result.cost_usd;
      inputTokens += result.input_tokens;
      outputTokens += result.output_tokens;
      if (spentCostUsd > args.budget_cap_usd) {
        return fallback(
          args.packet,
          "actual_cost_exceeds_budget_cap",
          attempt,
          args.budget_cap_usd,
          inputTokens,
          outputTokens
        );
      }
      return {
        source: "claude",
        interpretation: validateSignalMetricInterpretationV1(result.interpretation, args.packet),
        attempts: attempt,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: spentCostUsd,
        fallback_reason: null
      };
    } catch (error) {
      lastError = safeReason(error);
    }
  }
  return fallback(args.packet, lastError, attempts, spentCostUsd, inputTokens, outputTokens);
}

function fallback(
  packet: SignalMetricPacketV1,
  reason: string,
  attempts: number,
  costUsd = 0,
  inputTokens = 0,
  outputTokens = 0
): SignalInterpretationExecutionResult {
  return {
    source: "deterministic_fallback",
    interpretation: buildDeterministicSignalInterpretationFallbackV1(packet, reason),
    attempts,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    fallback_reason: reason
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("interpretation_timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:sk-ant-|postgres(?:ql)?:\/\/)\S+/giu, "[redacted]").slice(0, 200);
}
