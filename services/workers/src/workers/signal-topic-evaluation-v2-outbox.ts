import type { Pool } from "pg";

import { claimNextSignalTopicEvaluationV2ExecutionOutbox } from "@noisia/db";
import { processSignalTopicEvaluationV2ProviderRun } from "./signal-topic-evaluation-v2";
import { createAnthropicFullEvidenceTopicEvaluationModelV2 } from "../providers/anthropic-full-evidence-topic-evaluation";

type Options = {
  database?: Pick<Pool, "connect" | "query">;
  enabled?: boolean;
  interval_ms?: number;
  run_immediately?: boolean;
  on_error?: (error: unknown) => void;
};

/**
 * The V2 outbox is intentionally independent of the historical V1 evaluator. It remains inert
 * until an explicit UAT-only runtime flag is present on the Worker. A dispatched row is never
 * returned to pending, so a restart cannot turn an ambiguous provider boundary into a retry.
 */
export async function drainSignalTopicEvaluationV2ExecutionOutbox(options: Options = {}) {
  if (!executionEnabled(options)) return { claimed: 0, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  const claimed = await claimNextSignalTopicEvaluationV2ExecutionOutbox({ pool: database });
  if (!claimed) return { claimed: 0, dispatched: 0 };
  await processSignalTopicEvaluationV2ProviderRun({
    pool: database,
    run_id: claimed.run_id,
    claimed_execution: claimed,
    create_model: (input) => createAnthropicFullEvidenceTopicEvaluationModelV2({
      model: input.model,
      snapshot_digest: input.snapshot_digest,
      max_output_tokens: input.max_output_tokens,
      pricing: {
        input_micro_usd_per_token: input.input_micro_usd_per_token,
        output_micro_usd_per_token: input.output_micro_usd_per_token
      }
    })
  });
  return { claimed: 1, dispatched: 1 };
}

export function startSignalTopicEvaluationV2ExecutionOutboxDrainer(options: Options = {}) {
  if (!executionEnabled(options)) {
    return { drainNow: () => Promise.resolve({ claimed: 0, dispatched: 0 }), close: async () => undefined };
  }
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve({ claimed: 0, dispatched: 0 });
    if (inFlight) return inFlight;
    inFlight = drainSignalTopicEvaluationV2ExecutionOutbox(options).finally(() => { inFlight = null; });
    return inFlight;
  };
  const reportFailure = (error: unknown) => {
    if (options.on_error) options.on_error(error);
    else console.error("Topic Evaluation V2 outbox drainer failed.", safeErrorName(error));
  };
  const drainInBackground = () => { void drainNow().catch(reportFailure); };
  const timer = setInterval(drainInBackground, options.interval_ms ?? 5_000);
  timer.unref?.();
  if (options.run_immediately !== false) drainInBackground();
  return { drainNow, close: async () => {
    closed = true; clearInterval(timer); await inFlight?.catch(reportFailure);
  } };
}

function executionEnabled(options: Options) {
  return options.enabled ?? (process.env.NOISIA_RUNTIME_PROFILE === "uat"
    && process.env.NOISIA_TOPIC_EVALUATION_V2_EXECUTION_ENABLED === "true");
}

function safeErrorName(error: unknown) {
  return (error instanceof Error ? error.name : "unknown_error").slice(0, 120);
}
