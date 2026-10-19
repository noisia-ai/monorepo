import {
  claimSignalWorkspaceEmbeddingsDispatchV1,
  acknowledgeSignalWorkspaceEmbeddingsDispatchV1,
  failSignalWorkspaceEmbeddingsDispatchV1,
  scheduleSignalWorkspaceEmbeddingsV1,
  type SignalWorkspaceEmbeddingsDatabaseV1
} from "@noisia/db";
import { SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME, safeWorkspaceEmbeddingErrorV1 } from "./signal-workspace-embeddings";

type QueueJob = { getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> };
type QueueLike = {
  getJob(id: string): Promise<QueueJob | null | undefined>;
  add(name: string, data: { run_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
const stores = {
  schedule: scheduleSignalWorkspaceEmbeddingsV1,
  claim: claimSignalWorkspaceEmbeddingsDispatchV1,
  acknowledge: acknowledgeSignalWorkspaceEmbeddingsDispatchV1,
  fail: failSignalWorkspaceEmbeddingsDispatchV1
};
type Options = {
  database?: SignalWorkspaceEmbeddingsDatabaseV1; queue?: QueueLike; stores?: typeof stores;
  interval_ms?: number; run_immediately?: boolean;
};

/** Reconciles durable jobs even when provider transport is disabled. A SQL claim
 * may resume a persisted response; it never authorizes resending an unknown call. */
export async function drainSignalWorkspaceEmbeddingsV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const store = options.stores ?? stores;
  const scheduled = await store.schedule({ database, limit: 10 });
  const claimed = await store.claim({ database, limit: 10 });
  const result = { scheduled, claimed: claimed.length, dispatched: 0, recovered: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        const state = await prior.getState();
        if (state === "completed" || state === "failed") await prior.retry(state);
        result.recovered++;
      } else {
        await queue.add(SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME, { run_id: row.run_id }, {
          jobId: row.worker_job_id, attempts: 1,
          removeOnComplete: { age: 1_209_600, count: 500 },
          removeOnFail: { age: 2_592_000, count: 500 }
        });
      }
      await store.acknowledge({ database, run_id: row.run_id, dispatch_token: row.dispatch_token });
      result.dispatched++;
    } catch {
      await store.fail({ database, run_id: row.run_id, dispatch_token: row.dispatch_token }).catch(() => undefined);
      result.failed++;
    }
  }
  return result;
}

export function startSignalWorkspaceEmbeddingsDrainerV1(options: Options = {}) {
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalWorkspaceEmbeddingsV1(options).catch(error => {
      console.warn(`[workspace-embeddings] ${safeWorkspaceEmbeddingErrorV1(error)}`);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}
