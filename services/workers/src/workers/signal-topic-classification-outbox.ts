import type { Pool } from "pg";

import { SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME } from "@noisia/query-engine";
import { scheduleSignalWorkspaceTopicComputationsV1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME } from "./signal-workspace-topic-computation";

type QueueLike = {
  add(name: string, data: unknown, options: Record<string, unknown>): Promise<unknown>;
  getJob(id: string): Promise<{ name: string; getState(): Promise<string>;
    retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
};
type Options = { database?: Pick<Pool, "query" | "connect">; queue?: QueueLike; interval_ms?: number;
  run_immediately?: boolean; batch_size?: number; lease_seconds?: number; max_attempts?: number;
  schedule?: typeof scheduleSignalWorkspaceTopicComputationsV1 };

export async function drainSignalTopicClassificationOutboxV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const maxAttempts = options.max_attempts ?? 8;
  // Recovers only workspace execution ledgers, not legacy corpus tables.
  await (options.schedule ?? scheduleSignalWorkspaceTopicComputationsV1)({ database });
  await database.query(`
    WITH dead AS(
      UPDATE signal_topic_classification_outbox
      SET status='dead_letter',error_code='dispatch_attempts_exhausted',
        lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE attempt_count >= $1 AND status IN('pending','failed','dispatching')
        AND (status<>'dispatching' OR lease_expires_at<=now())
      RETURNING execution_id
    ) UPDATE signal_topic_catalog_executions execution
      SET status='failed',error_code='topic_queue_unavailable',completed_at=now(),updated_at=now()
      WHERE execution.id IN(SELECT execution_id FROM dead) AND execution.status='queued'
  `, [maxAttempts]);
  const claimed = await database.query<{ outbox_id: string; execution_id: string; workspace_id: string;
    lease_token: string; worker_job_id: string; attempt_count: number; input_contract: string }>(`
    WITH candidates AS(
      SELECT id FROM signal_topic_classification_outbox
      WHERE attempt_count<$1 AND ((status IN('pending','failed') AND available_at<=now())
        OR (status='dispatching' AND lease_expires_at<=now()))
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE signal_topic_classification_outbox outbox SET status='dispatching',
      attempt_count=outbox.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>$3),error_code=NULL,updated_at=now()
    FROM candidates,signal_topic_catalog_executions execution
    WHERE outbox.id=candidates.id AND execution.id=outbox.execution_id
    RETURNING outbox.id::text outbox_id,outbox.execution_id::text,
      outbox.workspace_id::text,outbox.lease_token::text,outbox.worker_job_id,outbox.attempt_count,
      execution.input_contract
  `, [maxAttempts, options.batch_size ?? 20, options.lease_seconds ?? 60]);
  const result = { claimed: claimed.rows.length, dispatched: 0, failed: 0, dead_lettered: 0 };
  for (const row of claimed.rows) {
    try {
      const jobName = topicExecutionJobNameV1(row.input_contract);
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        if (prior.name !== jobName) throw new Error("topic_dispatch_contract_mismatch");
        const state = await prior.getState();
        if (state === "completed" || state === "failed") await prior.retry(state);
      } else await queue.add(jobName, { execution_id: row.execution_id }, {
        jobId: row.worker_job_id,
        attempts: row.input_contract === "workspace-topic-computation-v1" ? 1 : 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 200 },
        removeOnFail: { age: 604_800, count: 500 }
      });
      const completed = await database.query(`
        UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=now(),
          lease_token=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
      `, [row.outbox_id, row.lease_token]);
      if ((completed.rowCount ?? 0) === 1) result.dispatched += 1;
    } catch (error) {
      const dead = row.attempt_count >= maxAttempts;
      if (dead) await database.query(`
        WITH exhausted AS(
          UPDATE signal_topic_classification_outbox SET status='dead_letter',
            lease_token=NULL,lease_expires_at=NULL,error_code=$3,updated_at=now()
          WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
          RETURNING execution_id
        ) UPDATE signal_topic_catalog_executions execution
          SET status='failed',error_code='topic_queue_unavailable',completed_at=now(),updated_at=now()
          WHERE execution.id IN(SELECT execution_id FROM exhausted) AND execution.status='queued'
      `, [row.outbox_id, row.lease_token, safeError(error)]);
      else await database.query(`
        UPDATE signal_topic_classification_outbox SET status='failed',
          available_at=now()+make_interval(secs=>$3),lease_token=NULL,lease_expires_at=NULL,
          error_code=$4,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
      `, [row.outbox_id, row.lease_token,
        Math.min(900, 5 * (2 ** Math.max(0, row.attempt_count - 1))), safeError(error)]);
      if (dead) result.dead_lettered += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export function topicExecutionJobNameV1(inputContract: string) {
  if (inputContract === "legacy-topic-catalog-v1") return SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME;
  if (inputContract === "workspace-topic-computation-v1") return SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME;
  throw new Error("topic_dispatch_contract_unknown");
}

export function startSignalTopicClassificationOutboxDrainerV1(options: Options = {}) {
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalTopicClassificationOutboxV1(options).catch((error) => {
      console.warn(`[topic-classification-outbox] ${safeError(error)}`);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.name : "unknown_error").slice(0, 120);
}
