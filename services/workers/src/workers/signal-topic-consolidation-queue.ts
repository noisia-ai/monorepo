import type { Job } from "bullmq";
import {
  acknowledgeSignalTopicConsolidationDispatchV1,
  claimSignalTopicConsolidationDispatchV1,
  claimSignalTopicConsolidationExecutionV1,
  completeSignalTopicConsolidationExecutionV1,
  failSignalTopicConsolidationDispatchV1,
  failSignalTopicConsolidationExecutionV1,
  heartbeatSignalTopicConsolidationExecutionV1,
  recoverSignalTopicConsolidationExecutionsV1,
  type SignalTopicConsolidationControlDatabaseV1,
  type SignalTopicConsolidationDispatchV1,
  type SignalTopicConsolidationExecutionLeaseV1,
} from "@noisia/db";

import { signalTopicConsolidationJobV1 } from "./signal-topic-consolidation";

export const SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1 = "signal-topic-consolidation-numeric-v1";

type Database = SignalTopicConsolidationControlDatabaseV1;
type Dispatch = SignalTopicConsolidationDispatchV1;
type ExecutionLease = SignalTopicConsolidationExecutionLeaseV1;
type CompletedExecution = {
  completed: true;
  execution_id: string;
};

type QueueJob = {
  getState(): Promise<string>;
  retry(state: "completed" | "failed"): Promise<void>;
};
type QueueLike = {
  getJob(id: string): Promise<QueueJob | null | undefined>;
  add(name: string, data: { execution_id: string }, options: Record<string, unknown>): Promise<unknown>;
};

export type SignalTopicConsolidationQueueStoresV1 = {
  recoverExecutions(args: { database: Database; limit?: number }): Promise<number>;
  claimDispatch(args: { database: Database; worker_id: string; limit: number; lease_seconds: number }): Promise<Dispatch[]>;
  acknowledgeDispatch(args: { database: Database; dispatch_id: string; lease_token: string }): Promise<boolean>;
  failDispatch(args: { database: Database; dispatch_id: string; lease_token: string;
    error_code: string }): Promise<boolean>;
  claimExecution(args: { database: Database; execution_id: string; worker_job_id: string;
    lease_seconds?: number }): Promise<ExecutionLease | CompletedExecution | null>;
  heartbeatExecution(args: { database: Database; lease: ExecutionLease }): Promise<boolean>;
  completeExecution(args: { database: Database; lease: ExecutionLease; consolidation_run_id: string }): Promise<boolean>;
  failExecution(args: { database: Database; lease: ExecutionLease; error_code: string }): Promise<boolean>;
};

type DrainerOptions = {
  database?: Database;
  queue?: QueueLike;
  stores?: SignalTopicConsolidationQueueStoresV1;
  worker_id?: string;
  batch_size?: number;
  lease_seconds?: number;
  interval_ms?: number;
  run_immediately?: boolean;
};

type JobOptions = {
  database?: Database;
  stores?: SignalTopicConsolidationQueueStoresV1;
  lease_seconds?: number;
  heartbeat_ms?: number;
  run?: typeof signalTopicConsolidationJobV1;
};

const defaultStores: SignalTopicConsolidationQueueStoresV1 = {
  recoverExecutions: recoverSignalTopicConsolidationExecutionsV1,
  claimDispatch: claimSignalTopicConsolidationDispatchV1,
  acknowledgeDispatch: acknowledgeSignalTopicConsolidationDispatchV1,
  failDispatch: failSignalTopicConsolidationDispatchV1,
  claimExecution: claimSignalTopicConsolidationExecutionV1,
  heartbeatExecution: heartbeatSignalTopicConsolidationExecutionV1,
  completeExecution: completeSignalTopicConsolidationExecutionV1,
  failExecution: failSignalTopicConsolidationExecutionV1,
};

export async function drainSignalTopicConsolidationOutboxV1(options: DrainerOptions = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const stores = options.stores ?? defaultStores;
  const leaseSeconds = boundedInteger(options.lease_seconds, 15, 900, 60);
  await stores.recoverExecutions({ database, limit: 20 });
  const rows = await stores.claimDispatch({ database, worker_id: workerId(options.worker_id),
    limit: boundedInteger(options.batch_size, 1, 50, 10), lease_seconds: leaseSeconds });
  const result = { claimed: rows.length, dispatched: 0, recovered: 0, failed: 0 };
  for (const row of rows) {
    try {
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        const state = await prior.getState();
        // A terminal Redis record plus an unacknowledged PostgreSQL dispatch is
        // redelivered with the same durable ID. The execution claim below is
        // what prevents completed numeric work from running twice.
        if (state === "completed" || state === "failed") await prior.retry(state);
        result.recovered += 1;
      } else {
        await queue.add(SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1, { execution_id: row.execution_id }, {
          jobId: row.worker_job_id,
          attempts: 1,
          removeOnComplete: { age: 1_209_600, count: 500 },
          removeOnFail: { age: 2_592_000, count: 500 },
        });
      }
      if (!await stores.acknowledgeDispatch({ database, dispatch_id: row.dispatch_id, lease_token: row.lease_token }))
        throw new Error("signal_topic_consolidation_dispatch_ack_stale");
      result.dispatched += 1;
    } catch (error) {
      await stores.failDispatch({ database, dispatch_id: row.dispatch_id, lease_token: row.lease_token,
        error_code: safeErrorCode(error) }).catch(() => undefined);
      result.failed += 1;
    }
  }
  return result;
}

export function startSignalTopicConsolidationOutboxDrainerV1(options: DrainerOptions = {}) {
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalTopicConsolidationOutboxV1(options).catch(error => {
      console.warn(`[topic-consolidation-outbox] ${safeErrorCode(error)}`);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}

export async function signalTopicConsolidationNumericJobV1(
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options: JobOptions = {},
) {
  const executionId = job.data?.execution_id;
  if (!job.id || !isUuid(executionId)) throw new Error("signal_topic_consolidation_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const stores = options.stores ?? defaultStores;
  const leaseSeconds = boundedInteger(options.lease_seconds, 60, 3_600, 300);
  const lease = await stores.claimExecution({ database, execution_id: executionId, worker_job_id: String(job.id),
    lease_seconds: leaseSeconds });
  if (!lease) throw new Error("signal_topic_consolidation_execution_unavailable");
  if ("completed" in lease) return { ...lease, replayed: true };
  let heartbeatFailed = false;
  const heartbeat = async () => {
    if (!await stores.heartbeatExecution({ database, lease })) heartbeatFailed = true;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => { heartbeatFailed = true; }); },
    boundedInteger(options.heartbeat_ms, 5, 60_000, Math.min(30_000, Math.floor(leaseSeconds * 500))));
  timer.unref?.();
  try {
    const result = await (options.run ?? signalTopicConsolidationJobV1)({ id: String(job.id),
      data: { source_execution_id: lease.source_execution_id }, updateProgress: job.updateProgress.bind(job) },
    { database: database as never, control_execution: { execution_id: lease.execution_id,
      execution_token: lease.execution_token, workspace_id: lease.workspace_id, actor_user_id: lease.actor_user_id } });
    if (heartbeatFailed) throw new Error("signal_topic_consolidation_lease_lost");
    if (!await stores.completeExecution({ database, lease, consolidation_run_id: result.consolidation_run_id }))
      throw new Error("signal_topic_consolidation_completion_rejected");
    return { ...result, execution_id: lease.execution_id, replayed_execution: false };
  } catch (error) {
    await stores.failExecution({ database, lease, error_code: safeErrorCode(error) }).catch(() => undefined);
    throw new Error(safeErrorCode(error));
  } finally {
    clearInterval(timer);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
function boundedInteger(value: number | undefined, min: number, max: number, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
}
function workerId(explicit: string | undefined) {
  const candidate = explicit ?? process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local-worker";
  return /^[A-Za-z0-9_.:-]{8,200}$/u.test(candidate) ? candidate : "local-worker";
}
function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "signal_topic_consolidation_worker_failed";
  const match = message.match(/(?:^|\b)(?:signal_topic_consolidation|topic_consolidation)_[a-z_]{1,100}(?:\b|$)/u);
  return match?.[0] ?? "signal_topic_consolidation_worker_failed";
}
