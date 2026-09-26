import type { Job } from "bullmq";
import type { SignalTopicEditorialBatchDatabaseV2 } from "@noisia/db";
import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";
import { runSignalTopicEditorialBatchTickV2 } from "./signal-topic-editorial-batch-v2";
import { createSignalTopicEditorialBatchRuntimeStoresV2 } from "./signal-topic-editorial-batch-runtime-v2";

export const SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2 = "signal-topic-editorial-message-batch-v2";
type Environment = Readonly<Record<string, string | undefined>>;
type Queue = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { batch_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
type Options = { env?: Environment; database?: SignalTopicEditorialBatchDatabaseV2; queue?: Queue };
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
  let dispatched = 0;
  for (const batch_id of ids) {
    const jobId = `topic-editorial-batch-v2-${batch_id}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.retry(state);
    } else {
      await queue.add(SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2, { batch_id }, { jobId,
        attempts: 3, backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
    }
    dispatched++;
  }
  return { disabled: false, dispatched };
}

export function startSignalTopicEditorialBatchDrainerV2(options: Options & { interval_ms?: number; run_immediately?: boolean } = {}) {
  const enabled = signalTopicEditorialBatchConfigurationV2(options.env).enabled;
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalTopicEditorialBatchesV2(options).catch(() => {
      console.warn("topic_editorial_batch_dispatch_failed");
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
