import type { Pool } from "pg";

import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION } from "@noisia/query-engine";

type QueueLike = { add(name: string, data: unknown, options: Record<string, unknown>): Promise<unknown> };
type Options = { database?: Pick<Pool, "query">; queue?: QueueLike; interval_ms?: number;
  run_immediately?: boolean; batch_size?: number; lease_seconds?: number; max_attempts?: number };

export async function drainSignalSemanticContextProposalOutboxV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const claimed = await database.query<{ outbox_id: string; run_id: string; workspace_id: string;
    lease_token: string; worker_job_id: string; dispatch_attempt: number }>(`
    SELECT outbox_id::text,run_id::text,workspace_id::text,lease_token::text,worker_job_id,dispatch_attempt
    FROM claim_signal_semantic_context_proposal_dispatch_v1($1,$2,$3)`, [
    options.batch_size ?? 20, options.lease_seconds ?? 60, options.max_attempts ?? 5
  ]);
  const result = { claimed: claimed.rows.length, dispatched: 0, failed: 0, dead_lettered: 0 };
  for (const row of claimed.rows) {
    try {
      await queue.add(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME, {
        contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION, run_id: row.run_id
      }, { jobId: row.worker_job_id, attempts: 1,
        removeOnComplete: { age: 1_209_600, count: 2_000 },
        removeOnFail: { age: 2_592_000, count: 2_000 } });
      const completed = await database.query<{ completed: boolean }>(`
        SELECT complete_signal_semantic_context_proposal_dispatch_v1($1::uuid,$2::uuid) completed`,
      [row.outbox_id, row.lease_token]);
      if (completed.rows[0]?.completed) result.dispatched += 1;
    } catch (error) {
      const failed = await database.query<{ status: string }>(`
        SELECT fail_signal_semantic_context_proposal_dispatch_v1($1::uuid,$2::uuid,
          now()+make_interval(secs=>$3),$4,$5) status`, [row.outbox_id, row.lease_token,
        Math.min(900, 5 * (2 ** Math.max(0, row.dispatch_attempt - 1))), safeError(error),
        options.max_attempts ?? 5]);
      if (failed.rows[0]?.status === "dead_letter") result.dead_lettered += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export function startSignalSemanticContextProposalOutboxDrainerV1(options: Options = {}) {
  let closed = false; let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalSemanticContextProposalOutboxV1(options).finally(() => { inFlight = null; });
    return inFlight;
  };
  const heartbeat = async () => { const runtime = await import("../queues/data-os");
    const key = `noisia:drainer-alive:${runtime.dataOsQueueName}:semantic-context-proposal-outbox`;
    await runtime.redisConnection.set(key, String(Date.now()), "EX", 45).catch(() => undefined); };
  const timer = setInterval(() => { void heartbeat(); void drainNow(); }, options.interval_ms ?? 5_000);
  timer.unref?.(); void heartbeat(); if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}

function safeError(error: unknown) { return (error instanceof Error ? error.name : "unknown_error").slice(0, 300); }
