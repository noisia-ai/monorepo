import type { JobsOptions } from "bullmq";

export const SIGNAL_TAXONOMY_ENRICHMENT_TIMEOUT_MS = 90_000;

export type SignalTaxonomyBatchExecution = {
  classifications: unknown[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  context_refs: unknown[];
};

export function isSignalTaxonomyEnrichmentEnabled(
  env: Record<string, string | undefined> = process.env
) {
  return env.NOISIA_DATA_OS_WORKER_ENABLED === "true"
    && env.NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED === "true";
}

export function isSignalTaxonomyLlmEnabled(
  env: Record<string, string | undefined> = process.env
) {
  return isSignalTaxonomyEnrichmentEnabled(env)
    && env.NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED === "true"
    && Boolean(env.ANTHROPIC_API_KEY)
    && Boolean(env.VOYAGE_API_KEY);
}

export function buildSignalTaxonomyEnrichmentOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 2_000 },
    removeOnFail: { age: 60 * 60 * 24 * 30, count: 2_000 }
  };
}

export async function executeSignalTaxonomyBatchesV1<TBatch>(args: {
  batches: TBatch[];
  budget_cap_usd: number;
  estimate: (batch: TBatch) => number;
  classify: (batch: TBatch) => Promise<SignalTaxonomyBatchExecution>;
  persist: (batch: TBatch, execution: SignalTaxonomyBatchExecution) => Promise<void>;
  heartbeat: (progress: number) => Promise<void>;
  timeout_ms?: number;
  batch_attempts?: number;
}) {
  if (!Number.isFinite(args.budget_cap_usd) || args.budget_cap_usd <= 0) {
    throw new Error("signal_taxonomy_budget_cap_required");
  }
  const timeoutMs = Math.max(1_000, args.timeout_ms ?? SIGNAL_TAXONOMY_ENRICHMENT_TIMEOUT_MS);
  const batchAttempts = Math.max(1, Math.min(3, args.batch_attempts ?? 2));
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let completedBatches = 0;

  for (const batch of args.batches) {
    const estimated = args.estimate(batch);
    if (!Number.isFinite(estimated) || estimated < 0) {
      throw new Error("signal_taxonomy_cost_estimate_invalid");
    }
    if (costUsd + estimated > args.budget_cap_usd) {
      return {
        state: "partial" as const,
        reason: "budget_cap_reached" as const,
        completed_batches: completedBatches,
        pending_batches: args.batches.length - completedBatches,
        cost_usd: costUsd,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      };
    }

    let execution: SignalTaxonomyBatchExecution | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= batchAttempts; attempt += 1) {
      try {
        execution = await withTimeout(args.classify(batch), timeoutMs);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === batchAttempts) throw error;
      }
    }
    if (!execution) throw lastError ?? new Error("signal_taxonomy_classification_failed");
    if (costUsd + execution.cost_usd > args.budget_cap_usd) {
      throw new Error("signal_taxonomy_provider_exceeded_budget_cap");
    }
    await args.persist(batch, execution);
    costUsd += execution.cost_usd;
    inputTokens += execution.input_tokens;
    outputTokens += execution.output_tokens;
    completedBatches += 1;
    await args.heartbeat(Math.round((completedBatches / args.batches.length) * 100));
  }

  return {
    state: "completed" as const,
    reason: null,
    completed_batches: completedBatches,
    pending_batches: 0,
    cost_usd: costUsd,
    input_tokens: inputTokens,
    output_tokens: outputTokens
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("signal_taxonomy_batch_timeout")),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
