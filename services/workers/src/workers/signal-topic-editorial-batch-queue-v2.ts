import type { Job } from "bullmq";
import { prepareAllSignalTopicEditorialBatchV2, reuseCompatibleSignalTopicEditorialPaidResultsV2,
  markSignalTopicEditorialBatchPreparationFailedV2, type SignalTopicEditorialBatchDatabaseV2 } from "@noisia/db";
import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";
import { runSignalTopicEditorialBatchTickV2 } from "./signal-topic-editorial-batch-v2";
import { createSignalTopicEditorialBatchRuntimeStoresV2 } from "./signal-topic-editorial-batch-runtime-v2";

export const SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2 = "signal-topic-editorial-message-batch-v2";
export const SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2 = "signal-topic-editorial-batch-prepare-v2";
type Environment = Readonly<Record<string, string | undefined>>;
type Queue = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { batch_id: string } | { execution_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
type Options = { env?: Environment; database?: SignalTopicEditorialBatchDatabaseV2; queue?: Queue };
const dispatchPhases = new Set(["database_read", "preparation_lookup", "queue_lookup", "queue_state", "queue_retry", "queue_enqueue"]);
const safeErrorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError"]);
function safeErrorCauseTag(error: unknown, depth = 0, seen = new Set<object>()): string {
  if (!error || typeof error !== "object" || depth > 2 || seen.has(error)) return "unknown";
  seen.add(error);
  const value = error as { name?: unknown; code?: unknown; errno?: unknown; cause?: unknown };
  const name = typeof value.name === "string" && safeErrorNames.has(value.name) ? value.name.toLowerCase() : "error";
  const codeValue = typeof value.code === "string" ? value.code : typeof value.errno === "string" ? value.errno : "";
  const code = /^[0-9A-Z]{5}$/iu.test(codeValue) || /^(?:E[A-Z0-9]{2,30}|ERR_[A-Z0-9_]{2,60})$/u.test(codeValue)
    ? codeValue.toLowerCase() : "";
  const cause = value.cause;
  const nested = cause && typeof cause === "object" ? safeErrorCauseTag(cause, depth + 1, seen) : "";
  return [name, code, nested ? `cause_${nested}` : ""].filter(Boolean).join("_").slice(0, 180);
}
export function safeSignalTopicEditorialBatchDispatchErrorV2(error: unknown, phase: string) {
  const stage = dispatchPhases.has(phase) ? phase : "unknown";
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof value?.message === "string" ? value.message : "";
  const knownCode = /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|08000|08003|08006|57P01|57P02|57P03)$/u.test(code)
    ? `transport_${code.toLowerCase()}`
    : /^[0-9A-Z]{5}$/iu.test(code) ? `postgres_${code.toLowerCase()}` : null;
  const safeMessage = /^topic_editorial_batch_[a-z0-9_]{1,100}$/u.test(message) ? message : null;
  const causeTag = safeErrorCauseTag(error);
  // Prefer a typed nested cause over the generic safe wrapper message. The
  // wrapper remains useful only when no allowlisted cause/code was available.
  const typedCause = causeTag !== "error" && causeTag !== "unknown" ? causeTag : null;
  return `topic_editorial_batch_dispatch_${stage}_${knownCode ?? typedCause ?? safeMessage ?? causeTag}`;
}
export function signalTopicEditorialBatchConfigurationV2(env: Environment = process.env) {
  const enabled = env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED === "true";
  return { enabled, provider_enabled: enabled && env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED === "true" };
}

/** Reuses the Data OS queue. Durable next_poll_at replaces a sleeping paid job. */
export async function drainSignalTopicEditorialBatchesV2(options: Options = {}) {
  const flags = signalTopicEditorialBatchConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  let phase = "database_read";
  try {
    const client = await database.connect();
    let ids: string[];
    try {
      const result = await client.query<{ id: string }>(`SELECT id FROM signal_topic_editorial_provider_batches_v2
        WHERE state IN('prepared','submitting','in_progress','canceling','ended')
          AND next_poll_at <= clock_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
          AND (state <> 'prepared' OR $1::boolean)
        ORDER BY next_poll_at,id LIMIT 10`, [flags.provider_enabled]);
      ids = result.rows.map(row => row.id);
    } finally { client.release(); }
    // Admission already persisted the immutable all-group plan and request rows.
    // Recover local reuse/manifest preparation from that database authority; the
    // queue carries only an execution ID and may deliver the job at least once.
    phase = "preparation_lookup";
    const preparationClient = await database.connect();
    let executionIds: string[];
    try {
      const result = await preparationClient.query<{ id: string }>(`SELECT e.id::text id
        FROM signal_topic_editorial_executions e
        JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
        WHERE e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2'
          AND o.stage<>'preparation_failed'
          AND e.status IN('queued','running')
          AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_provider_batches_v2 b WHERE b.execution_id=e.id)
          AND EXISTS(SELECT 1 FROM signal_topic_editorial_requests r
            WHERE r.execution_id=e.id AND r.phase='screening'
              AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 reused WHERE reused.request_id=r.id))
        ORDER BY e.created_at,e.id LIMIT 10`);
      executionIds = result.rows.map(row => row.id);
    } finally { preparationClient.release(); }
    let dispatched = 0;
    for (const execution_id of executionIds) {
      const jobId = `topic-editorial-batch-v2-prepare-${execution_id}`;
      phase = "queue_lookup";
      const existing = await queue.getJob(jobId);
      if (existing) {
        phase = "queue_state";
        const state = await existing.getState();
        if (state === "completed" || state === "failed") {
          phase = "queue_retry";
          await existing.retry(state);
        }
      } else {
        phase = "queue_enqueue";
        await queue.add(SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2, { execution_id }, { jobId,
          attempts: 3, backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
      }
      dispatched++;
    }
    for (const batch_id of ids) {
      const jobId = `topic-editorial-batch-v2-${batch_id}`;
      phase = "queue_lookup";
      const existing = await queue.getJob(jobId);
      if (existing) {
        phase = "queue_state";
        const state = await existing.getState();
        if (state === "completed" || state === "failed") {
          phase = "queue_retry";
          await existing.retry(state);
        }
      } else {
        phase = "queue_enqueue";
        await queue.add(SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2, { batch_id }, { jobId,
          attempts: 3, backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
      }
      dispatched++;
    }
    return { disabled: false, dispatched };
  } catch (error) {
    throw new Error(safeSignalTopicEditorialBatchDispatchErrorV2(error, phase));
  }
}

export function startSignalTopicEditorialBatchDrainerV2(options: Options & { interval_ms?: number; run_immediately?: boolean } = {}) {
  const enabled = signalTopicEditorialBatchConfigurationV2(options.env).enabled;
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalTopicEditorialBatchesV2(options).catch(error => {
      const message = error instanceof Error && /^topic_editorial_batch_dispatch_[a-z_0-9]{1,200}$/u.test(error.message)
        ? error.message : safeSignalTopicEditorialBatchDispatchErrorV2(error, "unknown");
      console.warn(message);
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 5000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}

export async function signalTopicEditorialBatchJobV2(job: Pick<Job<{ batch_id: string }>, "id" | "data">, options: {
  env?: Environment; database?: SignalTopicEditorialBatchDatabaseV2; fetch?: typeof globalThis.fetch;
} = {}) {
  const flags = signalTopicEditorialBatchConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true };
  const batchId = job.data?.batch_id;
  if (typeof batchId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(batchId)
    || job.id !== `topic-editorial-batch-v2-${batchId}`) throw new Error("topic_editorial_batch_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const stores = createSignalTopicEditorialBatchRuntimeStoresV2({ database, batch_id: batchId });
  const provider = createAnthropicMessageBatchesClient({ apiKey: (options.env ?? process.env).ANTHROPIC_API_KEY ?? "", fetch: options.fetch });
  const result = await runSignalTopicEditorialBatchTickV2({ provider, stores: {
    ...stores,
    async markSubmitting(lease) {
      if (!flags.provider_enabled) throw new Error("topic_editorial_batch_sends_disabled");
      await stores.markSubmitting(lease);
    },
  } });
  return { disabled: false, result };
}

/** Completes the local, replay-safe reuse/manifest phase after durable V2
 * admission. It intentionally has no provider client or API-key access: only
 * the separate batch job may submit once its provider flag is enabled. */
export async function signalTopicEditorialBatchPreparationJobV2(
  job: Pick<Job<{ execution_id: string }>, "id" | "data"> & Partial<Pick<Job<{ execution_id: string }>, "attemptsMade" | "opts">>,
  options: {
    env?: Environment;
    database?: SignalTopicEditorialBatchDatabaseV2;
    reuse?: typeof reuseCompatibleSignalTopicEditorialPaidResultsV2;
    prepare?: typeof prepareAllSignalTopicEditorialBatchV2;
    markFailed?: typeof markSignalTopicEditorialBatchPreparationFailedV2;
  } = {},
) {
  const flags = signalTopicEditorialBatchConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true };
  const executionId = job.data?.execution_id;
  if (typeof executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(executionId)
    || job.id !== `topic-editorial-batch-v2-prepare-${executionId}`) {
    throw new Error("topic_editorial_batch_preparation_job_invalid");
  }
  const database = options.database ?? (await import("../db/client")).pool;
  const reuse = options.reuse ?? reuseCompatibleSignalTopicEditorialPaidResultsV2;
  const prepare = options.prepare ?? prepareAllSignalTopicEditorialBatchV2;
  try {
    const reused = await reuse({ database, execution_id: executionId });
    const manifest = await prepare({ database, execution_id: executionId });
    return { disabled: false, execution_id: executionId,
      reused_items: reused.reused_items, needs_review_items: reused.needs_review_items,
      provider_items: manifest.provider_items, batch_id: manifest.batch_id };
  } catch (error) {
    const attempts = Number(job.opts?.attempts ?? 1), attemptsMade = Number(job.attemptsMade ?? 0);
    if (Number.isSafeInteger(attempts) && attempts > 0 && Number.isSafeInteger(attemptsMade) && attemptsMade + 1 >= attempts) {
      const markFailed = options.markFailed ?? markSignalTopicEditorialBatchPreparationFailedV2;
      await markFailed({ database, execution_id: executionId });
    }
    throw error;
  }
}
