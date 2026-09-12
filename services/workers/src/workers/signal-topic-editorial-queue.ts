import type { Job } from "bullmq";
import {
  acknowledgeSignalTopicEditorialDispatchV1, claimSignalTopicEditorialDispatchV1, claimSignalTopicEditorialExecutionV1,
  failSignalTopicEditorialDispatchV1, failSignalTopicEditorialExecutionV1, finishSignalTopicEditorialExecutionV1,
  heartbeatSignalTopicEditorialExecutionV1, recoverSignalTopicEditorialExecutionsV1, materializeSignalTopicEditorialWorkerExecutionV1,
  bindSignalTopicEditorialGlobalRequestV1, createSignalTopicEditorialRunnerStoreV1,
  type SignalTopicEditorialDatabaseV1, type SignalTopicEditorialLeaseV1, type SignalTopicEditorialMaterializationResultV1,
} from "@noisia/db";
import { runSignalTopicEditorialConsolidationV1, type SignalTopicEditorialScreeningPlanV1,
  type SignalTopicEditorialScreeningGroupV1, type SignalTopicEditorialRunnerStoreV1,
  type SignalTopicEditorialRunnerProviderRequestV1, validateSignalTopicEditorialRepairRequestV1 } from "@noisia/query-engine";
import { createAnthropicSignalTopicEditorialRunnerProviderV1, type SignalTopicEditorialAnthropicRawReceiptV1 } from "../providers/signal-topic-editorial";
import { createSignalTopicEditorialLedgerV1, type SignalTopicEditorialLedgerStoresV1 } from "./signal-topic-editorial-ledger";
import { signalTopicEditorialRuntimeConfigurationV1, type SignalTopicEditorialEnvironmentV1 } from "./signal-topic-editorial-runtime";

export const SIGNAL_TOPIC_EDITORIAL_JOB_V1 = "signal-topic-consolidation-editorial-v1";
type EditorialJobResult = (SignalTopicEditorialMaterializationResultV1 & { disabled?: never; provider_execution_enabled?: never })
  | ({ disabled: true; provider_execution_enabled: false } & Partial<Record<keyof SignalTopicEditorialMaterializationResultV1, never>>);
type Database = SignalTopicEditorialDatabaseV1;
type Lease = SignalTopicEditorialLeaseV1;
type Dispatch = Awaited<ReturnType<typeof claimSignalTopicEditorialDispatchV1>>[number];
type QueueLike = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { execution_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
export type SignalTopicEditorialControlStoresV1 = {
  recover: typeof recoverSignalTopicEditorialExecutionsV1; claimDispatch: typeof claimSignalTopicEditorialDispatchV1;
  acknowledgeDispatch: typeof acknowledgeSignalTopicEditorialDispatchV1; failDispatch: typeof failSignalTopicEditorialDispatchV1;
  claimExecution: typeof claimSignalTopicEditorialExecutionV1; heartbeat: typeof heartbeatSignalTopicEditorialExecutionV1;
  materialize: typeof materializeSignalTopicEditorialWorkerExecutionV1;
  finish: typeof finishSignalTopicEditorialExecutionV1; failExecution: typeof failSignalTopicEditorialExecutionV1;
};
export type SignalTopicEditorialRuntimeStoresV1 = {
  loadInput(args: { database: Database; lease: Lease }): Promise<{ plan: SignalTopicEditorialScreeningPlanV1; groups: SignalTopicEditorialScreeningGroupV1[] }>;
  runnerStore(args: { database: Database; lease: Lease }): SignalTopicEditorialRunnerStoreV1;
  bindGlobal: typeof bindSignalTopicEditorialGlobalRequestV1;
  bindRepair(args: { database: Database; lease: Lease; request: SignalTopicEditorialRunnerProviderRequestV1 }): Promise<SignalTopicEditorialRunnerProviderRequestV1>;
  ledger: SignalTopicEditorialLedgerStoresV1;
  storeRawReceipt(args: { lease: Lease; call_id: string; receipt: SignalTopicEditorialAnthropicRawReceiptV1 }): Promise<string>;
};
const controlStores: SignalTopicEditorialControlStoresV1 = {
  recover: recoverSignalTopicEditorialExecutionsV1, claimDispatch: claimSignalTopicEditorialDispatchV1,
  acknowledgeDispatch: acknowledgeSignalTopicEditorialDispatchV1, failDispatch: failSignalTopicEditorialDispatchV1,
  claimExecution: claimSignalTopicEditorialExecutionV1, heartbeat: heartbeatSignalTopicEditorialExecutionV1,
  materialize: materializeSignalTopicEditorialWorkerExecutionV1,
  finish: finishSignalTopicEditorialExecutionV1, failExecution: failSignalTopicEditorialExecutionV1,
};
/** Existing runner/global stores are reused; missing recovery readers are not
 * replaced with ad hoc SQL or invented provider receipts in this package. */
export function composeSignalTopicEditorialRuntimeStoresV1(args: Omit<SignalTopicEditorialRuntimeStoresV1, "runnerStore" | "bindGlobal">): SignalTopicEditorialRuntimeStoresV1 {
  return { ...args, runnerStore: createSignalTopicEditorialRunnerStoreV1, bindGlobal: bindSignalTopicEditorialGlobalRequestV1 };
}
type DrainerOptions = { enabled?: boolean; database?: Database; queue?: QueueLike;
  stores?: SignalTopicEditorialControlStoresV1; limit?: number; interval_ms?: number; run_immediately?: boolean; env?: SignalTopicEditorialEnvironmentV1 };
export async function drainSignalTopicEditorialOutboxV1(options: DrainerOptions = {}) {
  const enabled = options.enabled ?? (options.env ?? process.env).NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED === "true";
  const result = { claimed: 0, dispatched: 0, recovered: 0, failed: 0, disabled: !enabled };
  if (!enabled) return result;
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const stores = options.stores ?? controlStores;
  await stores.recover({ database, limit: 20 });
  const rows = await stores.claimDispatch({ database, limit: bounded(options.limit, 1, 50, 10) }); result.claimed = rows.length;
  for (const row of rows) {
    try {
      const existing = await queue.getJob(row.worker_job_id);
      if (existing) {
        const state = await existing.getState(); if (state === "completed" || state === "failed") await existing.retry(state);
        result.recovered++;
      } else await queue.add(SIGNAL_TOPIC_EDITORIAL_JOB_V1, { execution_id: row.execution_id }, {
        jobId: row.worker_job_id, attempts: 5, backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 1_209_600, count: 500 }, removeOnFail: { age: 2_592_000, count: 500 },
      });
      if (!await stores.acknowledgeDispatch({ database, dispatch_id: row.dispatch_id, lease_token: row.lease_token }))
        throw new Error("topic_editorial_dispatch_ack_stale");
      result.dispatched++;
    } catch {
      await stores.failDispatch({ database, dispatch_id: row.dispatch_id, lease_token: row.lease_token }).catch(() => undefined); result.failed++;
    }
  }
  return result;
}
export function startSignalTopicEditorialOutboxDrainerV1(options: DrainerOptions = {}) {
  const enabled = options.enabled ?? (options.env ?? process.env).NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED === "true";
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    if (pending) return pending;
    pending = drainSignalTopicEditorialOutboxV1(options).catch(error => {
      console.warn(`[topic-editorial-outbox] ${safeCode(error)}`);
    }).finally(() => { pending = null; });return pending;
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 2500) : null;
  timer?.unref?.(); if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}
export async function signalTopicEditorialJobV1(job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options: { enabled?: boolean; database?: Database; controls?: SignalTopicEditorialControlStoresV1; runtime?: SignalTopicEditorialRuntimeStoresV1;
    runtime_factory?: () => SignalTopicEditorialRuntimeStoresV1; env?: SignalTopicEditorialEnvironmentV1;
    provider_enabled?: boolean; api_key?: string; fetch_impl?: typeof fetch; heartbeat_ms?: number } = {}): Promise<EditorialJobResult> {
  const lane = signalTopicEditorialRuntimeConfigurationV1(options.env, { enabled: options.enabled, provider_enabled: false });
  if (!lane.enabled) return { disabled: true, provider_execution_enabled: false };
  if (!job.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(job.data?.execution_id ?? ""))
    throw new Error("topic_editorial_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const stores = options.controls ?? controlStores;
  const lease = await stores.claimExecution({ database, execution_id: job.data.execution_id, worker_job_id: String(job.id), lease_seconds: 180 });
  if (!lease) throw new Error("topic_editorial_execution_unavailable");
  if (lease.execution_id !== job.data.execution_id) throw new Error("topic_editorial_lease_scope_invalid");
  const materialize = async () => {
    try { return await stores.materialize({ database, execution_id: lease.execution_id, worker_job_id: String(job.id) }); }
    catch (error) { throw new Error(safeCode(error)); }
  };
  // review_ready/completed claims never construct a provider, load its key or
  // rerun editorial work. Failed finalization retains the paid state for replay.
  if ("completed" in lease) return materialize();
  if (lease.worker_job_id !== job.id) throw new Error("topic_editorial_lease_scope_invalid");
  const configuration = signalTopicEditorialRuntimeConfigurationV1(options.env, options);
  const runtime = options.runtime ?? (options.runtime_factory ?? (await import("./signal-topic-editorial-runtime")).createSignalTopicEditorialRuntimeStoresV1)();
  let leaseLost = false, pendingHeartbeat: Promise<void> | null = null;
  const assertLease = () => { if (leaseLost) throw new Error("topic_editorial_lease_lost"); };
  const timer = setInterval(() => {
    if (pendingHeartbeat || leaseLost) return;
    pendingHeartbeat = Promise.resolve().then(async () => { if (!await stores.heartbeat({ database, lease })) leaseLost = true; })
      .catch(() => { leaseLost = true; }).finally(() => { pendingHeartbeat = null; });
  }, bounded(options.heartbeat_ms, 5, 60_000, 30_000)); timer.unref?.();
  const bridge = createSignalTopicEditorialLedgerV1({ database, lease, stores: runtime.ledger, assertLease,
    provider_enabled: configuration.provider_enabled,
    storeRawReceipt: input => runtime.storeRawReceipt({ lease, ...input }) });
  try {
    const input = await runtime.loadInput({ database, lease });
    const durableStore = runtime.runnerStore({ database, lease });
    const transport = createAnthropicSignalTopicEditorialRunnerProviderV1({ api_key: configuration.api_key, provider_enabled: configuration.provider_enabled,
      ledger: bridge.ledger, fetch_impl: options.fetch_impl });
    const result = await runSignalTopicEditorialConsolidationV1({ execution_key: lease.execution_id, plan: input.plan, groups: input.groups,
      store: { load: key => durableStore.load(key), save: async value => {
        assertLease(); await durableStore.save(value);
        await job.updateProgress({ phase: value.state.phase, screening_complete: value.state.screening_outputs.length,
          screening_expected: input.plan.batches.length }).catch(() => undefined);
      } }, provider: { complete: async request => {
        assertLease();
        if (request.repair !== undefined) {
          validateSignalTopicEditorialRepairRequestV1(request);
          const bound = await runtime.bindRepair({ database, lease, request });
          if (bound.request_digest !== request.request_digest || bound.request_body !== request.request_body
            || bound.idempotency_key !== request.idempotency_key)
            throw new Error("topic_editorial_repair_binding_invalid");
        } else if (request.phase === "global") {
          const review = await runtime.bindGlobal({ database, lease });
          if (review.request_digest !== request.request_digest || review.request_body !== request.request_body)
            throw new Error("topic_editorial_global_binding_invalid");
        }
        return transport.complete(request);
      } } });
    clearInterval(timer); await pendingHeartbeat; assertLease();
    if (result.status !== "completed") throw new Error("topic_editorial_screening_incomplete");
    if (!await stores.finish({ database, lease })) throw new Error("topic_editorial_completion_rejected");

  } catch (error) {
    await bridge.failActive(error).catch(() => undefined);
    await stores.failExecution({ database, lease, error_code: safeCode(error) }).catch(() => undefined);
    throw new Error(safeCode(error));
  } finally { clearInterval(timer); await pendingHeartbeat; }
  // Finalization errors must not fail/reopen the now-terminal editorial owner.
  return materialize();
}
function bounded(value: number | undefined, min: number, max: number, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
}
function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/\b(?:signal_topic_editorial|topic_editorial|processing|brand_context)_[a-z_]{1,100}\b/u)?.[0];
  return code?.startsWith("signal_topic_editorial_") ? `topic_editorial_${code.slice("signal_topic_editorial_".length)}`
    : code ?? "topic_editorial_worker_failed";
}
export type SignalTopicEditorialDispatchV1 = Dispatch;
