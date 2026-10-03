import { TB_OPEN_PASS_BATCH_SIZE } from "@noisia/query-engine";

/** Injectable provider state machine; contains no database, queue or network IO. */
export async function executeGovernedProviderBoundaryV1<
  R extends { maxOutputTokens: number },
  T
>(args: {
  reservation: R | null;
  maxOutputTokens: number;
  assertAuthority: (reservation: R) => Promise<void>;
  releaseBeforeDispatch: (reservation: R) => Promise<void>;
  invoke: (maxOutputTokens: number) => Promise<T>;
  settle: (reservation: R, result: T) => Promise<unknown>;
}) {
  if (args.reservation) {
    try {
      await args.assertAuthority(args.reservation);
    } catch (error) {
      // The callback has not started; this is the only provably unbilled path.
      await args.releaseBeforeDispatch(args.reservation);
      throw error;
    }
  }
  // If invoke throws, do not release: the provider may already have billed it.
  const result = await args.invoke(
    args.reservation?.maxOutputTokens ?? args.maxOutputTokens
  );
  if (args.reservation) await args.settle(args.reservation, result);
  return result;
}

/**
 * Pessimistic, provider-independent upper bound used before a paid call.
 * Exact billed usage is persisted from the AI SDK response after the call.
 */
export function conservativeInputTokenCount(prompt: string) {
  // One token per UTF-8 byte is deliberately pessimistic. Do not use chars/4
  // (or bytes/3): adversarial ASCII/control-heavy input can otherwise reserve
  // less than the provider reports.
  return Math.max(1, Buffer.byteLength(prompt, "utf8"));
}

export function signalTbMaxInputTokensPerCall(
  env: NodeJS.ProcessEnv = process.env
) {
  const value = Number(env.NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("governed_strategic_input_token_bound_missing");
  }
  return value;
}

export function signalTbPlannedOperationMaxOutputTokens(
  operationKey: string,
  sampleCount: number
) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error("governed_strategic_sample_count_invalid");
  }
  const fixed: Record<string, number> = {
    preflight: 8_000,
    "step2-coding": 8_000,
    "step3-hierarchy": 8_000,
    "step4-mobility": 8_000,
    "step6-synthesis-first": 20_000,
    "step6-synthesis-retry": 20_000,
    "step6-humanizer": 26_000
  };
  if (fixed[operationKey]) return fixed[operationKey];
  const openPass = /^step1-open-pass-([1-9][0-9]*)$/u.exec(operationKey);
  if (openPass) {
    const batch = Number(openPass[1]);
    if (batch <= Math.ceil(sampleCount / TB_OPEN_PASS_BATCH_SIZE)) return 4_000;
  }
  throw new Error("governed_strategic_provider_operation_not_planned");
}

export function exactProviderTokenCount(
  value: number | null | undefined,
  kind: "input" | "output"
) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`governed_strategic_${kind}_token_usage_missing`);
  }
  return Number(value);
}
