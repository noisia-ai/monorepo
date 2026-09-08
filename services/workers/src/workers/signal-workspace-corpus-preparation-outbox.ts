import {
  claimSignalWorkspaceCorpusPreparationDispatchV1,
  acknowledgeSignalWorkspaceCorpusPreparationDispatchV1,
  failSignalWorkspaceCorpusPreparationDispatchV1,
  scheduleSignalWorkspaceCorpusPreparationV1,
  type SignalWorkspaceCorpusPreparationDatabaseV1
} from "@noisia/db";

import { SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME, safePreparationErrorV1 } from "./signal-workspace-corpus-preparation";

type QueueJob = { getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> };
type QueueLike = {
  getJob(id: string): Promise<QueueJob | null | undefined>;
  add(name: string, data: { run_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
const stores = {
  schedule: scheduleSignalWorkspaceCorpusPreparationV1,
  claim: claimSignalWorkspaceCorpusPreparationDispatchV1,
  acknowledge: acknowledgeSignalWorkspaceCorpusPreparationDispatchV1,
  fail: failSignalWorkspaceCorpusPreparationDispatchV1
};
type Options = {
  database?: SignalWorkspaceCorpusPreparationDatabaseV1;
  queue?: QueueLike;
  stores?: typeof stores;
  interval_ms?: number;
  run_immediately?: boolean;
};

export async function drainSignalWorkspaceCorpusPreparationV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const store = options.stores ?? stores;
  // This scans only opted-in input revisions/deadlines, never the whole corpus.
  const scheduled = await store.schedule({ database, limit: 10 });
  const claimed = await store.claim({ database, limit: 10 });
  const result = { scheduled, claimed: claimed.length, dispatched: 0, recovered: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        const state = await prior.getState();
        // A retained terminal Redis job is not proof of a completed PG run.
        // The DB dispatch claim authorizes redelivery with its current job ID.
        if (state === "completed" || state === "failed") await prior.retry(state);
        result.recovered += 1;
      } else {
        await queue.add(SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME, { run_id: row.run_id }, {
          jobId: row.worker_job_id,
          attempts: 1,
          removeOnComplete: { age: 86_400, count: 500 },
          removeOnFail: { age: 604_800, count: 500 }
        });
      }
      await store.acknowledge({ database, run_id: row.run_id, dispatch_token: row.dispatch_token });
      result.dispatched += 1;
    } catch {
      // If Redis accepted before the ACK was lost, the next claim finds its job.
      // If execution died, the store advances dispatch generation after lease expiry.
      await store.fail({ database, run_id: row.run_id, dispatch_token: row.dispatch_token }).catch(() => undefined);
      result.failed += 1;
    }
  }
  return result;
}

export function startSignalWorkspaceCorpusPreparationDrainerV1(options: Options = {}) {
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalWorkspaceCorpusPreparationV1(options).catch((error) => {
      console.warn(`[workspace-corpus-preparation] ${safePreparationErrorV1(error)}`);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}
