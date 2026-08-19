import type { Queue } from "bullmq";
import type { Pool } from "pg";

import { pool } from "../db/client";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BACKOFF_SECONDS = 15 * 60;
const JOB_RETENTION = {
  removeOnComplete: { age: 60 * 60 * 24 * 14, count: 5_000 },
  removeOnFail: { age: 60 * 60 * 24 * 30, count: 5_000 }
} as const;

type StepDispatchClaim = {
  outbox_id: string;
  pipeline_step_id: string;
  tb_analysis_id: string;
  pipeline_step: string;
  lease_token: string;
  bullmq_job_id: string;
  dispatch_attempt: number;
};

export type StrategicStepQueue = Pick<Queue, "add" | "getJob">;

export type StrategicStepDrainResult = {
  claimed: number;
  dispatched: number;
  reconciled: number;
  failed: number;
  dead_lettered: number;
  lease_lost: number;
};

export type StrategicStepOutboxDrainer = {
  drainNow: () => Promise<StrategicStepDrainResult>;
  close: () => Promise<void>;
};

type DrainerOptions = {
  database?: Pick<Pool, "query">;
  queue?: StrategicStepQueue;
  intervalMs?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  batchSize?: number;
  runImmediately?: boolean;
};

const STEP_JOB_NAME: Record<string, string> = {
  preflight: "tb_step_preflight",
  step1_open_pass: "tb_step_1_open_pass",
  step2_coding: "tb_step_2_coding",
  step3_hierarchy: "tb_step_3_hierarchy",
  step4_mobility: "tb_step_4_mobility",
  step5_comparative: "tb_step_5_comparative",
  step6_synthesis: "tb_step_6_synthesis",
  quality_gates: "tb_quality_gates"
};

export function buildSignalStrategicStepJobId(idempotencyKey: string) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(idempotencyKey)) {
    throw new Error("invalid_strategic_step_idempotency_key");
  }
  return `strategic-step-${idempotencyKey.slice(7)}`;
}

export function signalStrategicStepBackoffSeconds(attempt: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(MAX_BACKOFF_SECONDS, 5 * (2 ** (normalizedAttempt - 1)));
}

/**
 * Claims durable dispatch rows in PostgreSQL and reconciles them with BullMQ.
 *
 * The database function owns SKIP LOCKED, attempt counting and lease CAS. The
 * deterministic BullMQ id closes the crash window where Redis accepted a job
 * but PostgreSQL did not observe the acknowledgement.
 */
export async function drainSignalStrategicStepOutbox(
  options: DrainerOptions = {}
): Promise<StrategicStepDrainResult> {
  const database = options.database ?? pool;
  const queue = options.queue ?? await defaultStepQueue();
  const leaseSeconds = boundedInteger(
    options.leaseSeconds ?? envNumber("NOISIA_SIGNAL_STRATEGIC_STEP_LEASE_SECONDS", DEFAULT_LEASE_SECONDS),
    15,
    600
  );
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? envNumber("NOISIA_SIGNAL_STRATEGIC_STEP_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    1,
    10
  );
  const batchSize = boundedInteger(
    options.batchSize ?? envNumber("NOISIA_SIGNAL_STRATEGIC_STEP_BATCH_SIZE", DEFAULT_BATCH_SIZE),
    1,
    100
  );
  const result = emptyResult();
  const claimed = await database.query<StepDispatchClaim>(
    `SELECT outbox_id::text,pipeline_step_id::text,tb_analysis_id::text,
       pipeline_step,lease_token::text,bullmq_job_id,dispatch_attempt
     FROM claim_signal_strategic_step_dispatch_v1($1::integer,$2::integer,$3::integer)`,
    [batchSize, leaseSeconds, maxAttempts]
  );
  result.claimed = claimed.rows.length;
  for (const row of claimed.rows) {
    const outcome = await dispatchClaimedStep({ database, queue, row, maxAttempts });
    result[outcome] += 1;
  }
  return result;
}

export function startSignalStrategicStepOutboxDrainer(
  options: DrainerOptions = {}
): StrategicStepOutboxDrainer {
  const intervalMs = boundedInteger(
    options.intervalMs ?? envNumber("NOISIA_SIGNAL_STRATEGIC_STEP_INTERVAL_MS", DEFAULT_INTERVAL_MS),
    options.intervalMs === undefined ? 1_000 : 10,
    60_000
  );
  let closed = false;
  let inFlight: Promise<StrategicStepDrainResult> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve(emptyResult());
    if (inFlight) return inFlight;
    inFlight = drainSignalStrategicStepOutbox(options)
      .catch((error) => {
        console.error("Signal strategic step outbox drain failed.", {
          code: safeErrorCode(error)
        });
        return { ...emptyResult(), failed: 1 };
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  const timer = setInterval(() => void drainNow(), intervalMs);
  timer.unref?.();
  if (options.runImmediately !== false) void drainNow();
  return {
    drainNow,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await inFlight;
    }
  };
}

async function dispatchClaimedStep(args: {
  database: Pick<Pool, "query">;
  queue: StrategicStepQueue;
  row: StepDispatchClaim;
  maxAttempts: number;
}): Promise<"dispatched" | "reconciled" | "failed" | "dead_lettered" | "lease_lost"> {
  const jobId = args.row.bullmq_job_id;
  const jobName = STEP_JOB_NAME[args.row.pipeline_step];
  if (!jobName) {
    return failDispatch(args, new Error("unsupported_strategic_pipeline_step"));
  }
  try {
    const existing = await args.queue.getJob(jobId);
    if (existing) {
      return await completeDispatch(args.database, args.row, jobId)
        ? "reconciled"
        : "lease_lost";
    }
    const job = await args.queue.add(
      jobName,
      {
        tbAnalysisId: args.row.tb_analysis_id,
        pipelineStepId: args.row.pipeline_step_id
      },
      {
        jobId,
        attempts: 1,
        ...JOB_RETENTION
      }
    );
    return await completeDispatch(args.database, args.row, String(job.id ?? jobId))
      ? "dispatched"
      : "lease_lost";
  } catch (error) {
    // If Redis accepted Queue.add but the response or DB acknowledgement was
    // interrupted, the deterministic job itself is durable evidence.
    try {
      if (await args.queue.getJob(jobId)) {
        return await completeDispatch(args.database, args.row, jobId)
          ? "reconciled"
          : "lease_lost";
      }
    } catch {
      // Persist the original bounded failure; the lease remains recoverable.
    }
    return failDispatch(args, error);
  }
}

async function completeDispatch(
  database: Pick<Pool, "query">,
  row: StepDispatchClaim,
  jobId: string
) {
  const result = await database.query<{ completed: boolean }>(
    `SELECT complete_signal_strategic_step_dispatch_v1(
       $1::uuid,$2::uuid,$3::text
     ) AS completed`,
    [row.outbox_id, row.lease_token, jobId]
  );
  return result.rows[0]?.completed === true;
}

async function failDispatch(args: {
  database: Pick<Pool, "query">;
  row: StepDispatchClaim;
  maxAttempts: number;
}, error: unknown) {
  const retryAt = new Date(
    Date.now() + signalStrategicStepBackoffSeconds(args.row.dispatch_attempt) * 1_000
  ).toISOString();
  const failed = await args.database.query<{ status: string }>(
    `SELECT fail_signal_strategic_step_dispatch_v1(
       $1::uuid,$2::uuid,$3::timestamptz,$4::jsonb,$5::integer
     ) AS status`,
    [
      args.row.outbox_id,
      args.row.lease_token,
      retryAt,
      JSON.stringify({ code: safeErrorCode(error), message: safeErrorMessage(error) }),
      args.maxAttempts
    ]
  );
  const status = failed.rows[0]?.status;
  if (status === "dead_letter") return "dead_lettered" as const;
  if (status === "failed") return "failed" as const;
  return "lease_lost" as const;
}

async function defaultStepQueue() {
  const { getTbAnalysisProducer } = await import("../queues/tb-analysis");
  return getTbAnalysisProducer();
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function safeErrorCode(error: unknown) {
  const value = error && typeof error === "object"
    ? String((error as { code?: unknown; name?: unknown }).code
      ?? (error as { name?: unknown }).name
      ?? "queue_dispatch_failed")
    : "queue_dispatch_failed";
  return value.toLowerCase().replace(/[^a-z0-9_-]/gu, "_").slice(0, 80)
    || "queue_dispatch_failed";
}

function safeErrorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/\b(?:postgres(?:ql)?|redis(?:s)?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(password|token|secret|key)=\S+/giu, "$1=[redacted]")
    .slice(0, 300);
}

function emptyResult(): StrategicStepDrainResult {
  return {
    claimed: 0,
    dispatched: 0,
    reconciled: 0,
    failed: 0,
    dead_lettered: 0,
    lease_lost: 0
  };
}
