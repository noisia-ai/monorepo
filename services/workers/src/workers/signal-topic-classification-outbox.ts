import type { Pool } from "pg";
import { safeWorkspaceClassificationErrorV1 } from "./signal-workspace-classification";

import { SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME, SIGNAL_WORKSPACE_ENGINE_JOB_V1 } from "@noisia/query-engine";
import { scheduleSignalWorkspaceTopicComputationsV1, scheduleSignalWorkspaceTopicProjectionsV1,
  scheduleSignalWorkspaceNumericUpdatesV1,
  scheduleSignalWorkspaceEngineProgressV1, SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1,
  scheduleSignalWorkspaceIncrementalProjectionsV1,
  SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME } from "./signal-workspace-topic-computation";
import { SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME } from "./signal-workspace-incremental-derivation";
import { SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME } from "./signal-workspace-incremental-projection";

type QueueLike = {
  add(name: string, data: unknown, options: Record<string, unknown>): Promise<unknown>;
  getJob(id: string): Promise<{ name: string; getState(): Promise<string>;
    retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
};
type Options = { database?: Pick<Pool, "query" | "connect">; queue?: QueueLike; interval_ms?: number;
  run_immediately?: boolean; batch_size?: number; lease_seconds?: number; max_attempts?: number;
  numeric_cursor?: { after_workspace_id: string | null };
  schedule?: typeof scheduleSignalWorkspaceTopicComputationsV1 };

export async function drainSignalTopicClassificationOutboxV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const maxAttempts = options.max_attempts ?? 8;
  // Recovers only workspace execution ledgers, not legacy corpus tables.
  if(options.schedule) await options.schedule({database});
  else {
    // Operational rollout gate; this producer admits only zero-cost numeric work.
    if (process.env.NOISIA_WORKSPACE_NUMERIC_PRODUCER_ENABLED === 'true') {
      const numeric = await scheduleSignalWorkspaceNumericUpdatesV1({database,
        after_workspace_id: options.numeric_cursor?.after_workspace_id});
      if (options.numeric_cursor) options.numeric_cursor.after_workspace_id = numeric.next_cursor;
      if (numeric.failures.length) console.warn("Workspace numeric admissions deferred", { failures: numeric.failures });
    }
    await scheduleSignalWorkspaceTopicComputationsV1({database});
    // Enable once every replica understands dispatch_kind. Older drainers
    // route by execution contract and cannot safely consume derived jobs.
    if (process.env.NOISIA_WORKSPACE_TOPIC_PROGRESS_ENABLED === 'true')
      await scheduleSignalWorkspaceEngineProgressV1({database});
    await scheduleSignalWorkspaceTopicProjectionsV1({database});
    if (process.env.NOISIA_WORKSPACE_INCREMENTAL_PROJECTION_ENABLED === 'true')
      await scheduleSignalWorkspaceIncrementalProjectionsV1({database});
  }
  await database.query(`
    WITH dead AS(
      UPDATE signal_topic_classification_outbox
      SET status='dead_letter',error_code=COALESCE(error_code,'dispatch_attempts_exhausted'),
        lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE attempt_count >= $1 AND status IN('pending','failed','dispatching')
        AND (status<>'dispatching' OR lease_expires_at<=now())
      RETURNING execution_id,dispatch_kind,error_code
    ) UPDATE signal_topic_catalog_executions execution
      SET status='failed',error_code=CASE WHEN execution.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
       THEN dead.error_code ELSE 'topic_queue_unavailable' END,completed_at=now(),updated_at=now()
      FROM dead WHERE execution.id=dead.execution_id AND dead.dispatch_kind='execution' AND execution.status='queued'
  `, [maxAttempts]);
  const claimed = await database.query<{ outbox_id: string; execution_id: string; workspace_id: string;
    lease_token: string; worker_job_id: string; attempt_count: number; input_contract: string;
    source_projection: boolean; source_projection_contract: string | null; dispatch_kind: string; actor_user_id: string }>(`
    WITH candidates AS(
      SELECT id FROM signal_topic_classification_outbox
      WHERE attempt_count<$1
        AND (dispatch_kind<>'incremental_projection' OR status<>'failed' OR error_code IN('workspace_incremental_projection_transport_unavailable','workspace_classification_transport_unavailable'))
        AND ((status IN('pending','failed') AND available_at<=now())
        OR (status='dispatching' AND lease_expires_at<=now()))
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE signal_topic_classification_outbox outbox SET status='dispatching',
      attempt_count=outbox.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>$3),error_code=NULL,updated_at=now()
    FROM candidates,signal_topic_catalog_executions execution
    WHERE outbox.id=candidates.id AND execution.id=outbox.execution_id
    RETURNING outbox.id::text outbox_id,outbox.execution_id::text,
      outbox.workspace_id::text,outbox.lease_token::text,outbox.worker_job_id,outbox.attempt_count,
      execution.input_contract,execution.input_snapshot->'source_projection' IS NOT NULL source_projection,
      execution.input_snapshot->'source_projection'->>'contract_version' source_projection_contract,
      outbox.dispatch_kind,execution.actor_user_id::text
  `, [maxAttempts, options.batch_size ?? 20, options.lease_seconds ?? 60]);
  const result = { claimed: claimed.rows.length, dispatched: 0, failed: 0, dead_lettered: 0 };
  for (const row of claimed.rows) {
    try {
      const jobName = topicExecutionJobNameV1(row.input_contract,row.source_projection,row.dispatch_kind,row.source_projection_contract);
      const data = row.dispatch_kind === 'engine_progress' || row.dispatch_kind === 'incremental_projection'
        ? { execution_id: row.execution_id, workspace_id: row.workspace_id, actor_user_id: row.actor_user_id }
        : { execution_id: row.execution_id };
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        if (prior.name !== jobName) throw new Error("topic_dispatch_contract_mismatch");
        const state = await prior.getState();
        if (state === "completed" || state === "failed") await prior.retry(state);
      } else await queue.add(jobName, data, {
        jobId: row.worker_job_id,
        attempts: row.input_contract === "legacy-topic-catalog-v1" ? 2 : 1,
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
          RETURNING execution_id,dispatch_kind,error_code
        ) UPDATE signal_topic_catalog_executions execution
          SET status='failed',error_code=CASE WHEN execution.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
           THEN exhausted.error_code ELSE 'topic_queue_unavailable' END,completed_at=now(),updated_at=now()
          FROM exhausted WHERE execution.id=exhausted.execution_id AND exhausted.dispatch_kind='execution' AND execution.status='queued'
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

export function topicExecutionJobNameV1(inputContract: string, sourceProjection = false, dispatchKind = 'execution', projectionContract?: string | null) {
  if (dispatchKind === 'engine_progress' && inputContract === 'workspace-topic-engine-v1') return SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1;
  if (dispatchKind === 'incremental_projection' && inputContract === 'workspace-topic-engine-v1') return SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME;
  if (dispatchKind !== 'execution') throw new Error("topic_dispatch_contract_unknown");
  if (inputContract === "legacy-topic-catalog-v1") return SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME;
  if (inputContract === "workspace-topic-computation-v1") return SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME;
  if (inputContract === "workspace-topic-engine-v1") return SIGNAL_WORKSPACE_ENGINE_JOB_V1;
  if(inputContract === "workspace-topic-classification-v1" && sourceProjection) {
    if (projectionContract === 'workspace-topic-incremental-projection-v1') return SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME;
    if (!projectionContract || projectionContract === 'workspace-topic-projection-v1') return SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1;
  }
  throw new Error("topic_dispatch_contract_unknown");
}

export function startSignalTopicClassificationOutboxDrainerV1(options: Options = {}) {
  options = {...options, numeric_cursor: options.numeric_cursor ?? {after_workspace_id:null}};
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
  if (safeWorkspaceClassificationErrorV1(error) === "workspace_classification_transport_unavailable") return "workspace_classification_transport_unavailable";
  return (error instanceof Error ? error.name : "unknown_error").slice(0, 120);
}
