import type { Pool } from "pg";

import { pool } from "../db/client";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BACKOFF_SECONDS = 15 * 60;
const STRATEGIC_JOB_RETENTION = {
  removeOnComplete: { age: 60 * 60 * 24 * 14, count: 2_000 },
  removeOnFail: { age: 60 * 60 * 24 * 30, count: 2_000 }
} as const;

type StrategicRunOutboxRow = {
  id: string;
  tb_analysis_id: string;
  attempt: number;
  lease_token: string;
  bullmq_job_id: string;
  previous_status: "pending" | "failed" | "dispatching";
  previous_attempt: number;
};

export type StrategicRunOutboxQueue = {
  add: (
    name: string,
    data: { tbAnalysisId: string },
    options: {
      jobId: string;
      attempts: number;
      removeOnComplete: { age: number; count: number };
      removeOnFail: { age: number; count: number };
    }
  ) => Promise<{ id?: string | number | null }>;
  getJob: (jobId: string) => Promise<{ id?: string | number | null } | null | undefined>;
};

export type StrategicRunOutboxDrainResult = {
  claimed: number;
  dispatched: number;
  reconciled: number;
  failed: number;
  dead_lettered: number;
  lease_lost: number;
};

export type StrategicRunOutboxDrainer = {
  drainNow: () => Promise<StrategicRunOutboxDrainResult>;
  close: () => Promise<void>;
};

type DrainerOptions = {
  database?: Pick<Pool, "connect" | "query">;
  queue?: StrategicRunOutboxQueue;
  intervalMs?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  batchSize?: number;
  runImmediately?: boolean;
};

export function buildSignalStrategicRunJobId(tbAnalysisId: string) {
  return `signal-tb-${tbAnalysisId}`;
}

export function signalStrategicRunBackoffSeconds(attempt: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(MAX_BACKOFF_SECONDS, 5 * (2 ** (normalizedAttempt - 1)));
}

export async function drainSignalStrategicRunOutbox(
  options: DrainerOptions = {}
): Promise<StrategicRunOutboxDrainResult> {
  const database = options.database ?? pool;
  const queue = options.queue ?? await defaultStrategicQueue();
  const maxAttempts = clampInteger(
    options.maxAttempts ?? readNumber("NOISIA_SIGNAL_STRATEGIC_OUTBOX_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    1,
    10
  );
  const leaseSeconds = clampInteger(
    options.leaseSeconds ?? readNumber("NOISIA_SIGNAL_STRATEGIC_OUTBOX_LEASE_SECONDS", DEFAULT_LEASE_SECONDS),
    15,
    600
  );
  const batchSize = clampInteger(
    options.batchSize ?? readNumber("NOISIA_SIGNAL_STRATEGIC_OUTBOX_BATCH_SIZE", DEFAULT_BATCH_SIZE),
    1,
    100
  );
  const result: StrategicRunOutboxDrainResult = {
    claimed: 0,
    dispatched: 0,
    reconciled: 0,
    failed: 0,
    dead_lettered: 0,
    lease_lost: 0
  };

  const claim = await database.connect();
  let rows: StrategicRunOutboxRow[] = [];
  try {
    await claim.query("BEGIN");
    const exhausted = await claim.query(`
      UPDATE signal_strategic_run_outbox
      SET status = 'dead_letter',
          completed_at = COALESCE(completed_at, now()),
          dead_lettered_at = COALESCE(dead_lettered_at, now()),
          locked_at = NULL,
          lease_expires_at = NULL,
          lease_token = NULL,
          last_error = CASE
            WHEN last_error = '{}'::jsonb THEN jsonb_build_object('code', 'dispatch_attempts_exhausted')
            ELSE last_error
          END,
          updated_at = now()
      WHERE attempt >= $1::integer
        AND status IN ('pending', 'failed')
        AND available_at <= now()
    `, [maxAttempts]);
    result.dead_lettered += exhausted.rowCount ?? 0;

    const claimed = await claim.query<StrategicRunOutboxRow>(`
      WITH candidates AS (
        SELECT outbox.id,
          outbox.status AS previous_status,
          outbox.attempt AS previous_attempt
        FROM signal_strategic_run_outbox outbox
        WHERE (
          (
            outbox.status IN ('pending', 'failed')
            AND outbox.attempt < $1::integer
            AND outbox.available_at <= now()
          )
          OR (
            outbox.status = 'dispatching'
            AND COALESCE(outbox.lease_expires_at, outbox.updated_at) <= now()
          )
        )
        ORDER BY
          CASE WHEN outbox.status = 'dispatching' THEN 0 ELSE 1 END,
          COALESCE(outbox.lease_expires_at, outbox.available_at),
          outbox.created_at,
          outbox.id
        FOR UPDATE SKIP LOCKED
        LIMIT $2::integer
      )
      UPDATE signal_strategic_run_outbox outbox
      SET status = 'dispatching',
          attempt = CASE
            WHEN candidates.previous_status = 'dispatching'
              AND candidates.previous_attempt >= $1::integer
              THEN outbox.attempt
            ELSE outbox.attempt + 1
          END,
          bullmq_job_id = 'signal-tb-' || outbox.tb_analysis_id::text,
          locked_at = now(),
          lease_expires_at = now() + make_interval(secs => $3::integer),
          lease_token = gen_random_uuid(),
          last_error = '{}'::jsonb,
          updated_at = now()
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id::text, outbox.tb_analysis_id::text,
        outbox.attempt, outbox.lease_token::text, outbox.bullmq_job_id,
        candidates.previous_status, candidates.previous_attempt
    `, [maxAttempts, batchSize, leaseSeconds]);
    rows = claimed.rows;
    result.claimed = rows.length;
    await claim.query("COMMIT");
  } catch (error) {
    await claim.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    claim.release();
  }

  for (const row of rows) {
    const outcome = await dispatchClaimedStrategicRun({
      database,
      queue,
      row,
      maxAttempts
    });
    result[outcome] += 1;
  }
  return result;
}

export function startSignalStrategicRunOutboxDrainer(
  options: DrainerOptions = {}
): StrategicRunOutboxDrainer {
  const intervalMs = clampInteger(
    options.intervalMs ?? readNumber("NOISIA_SIGNAL_STRATEGIC_OUTBOX_INTERVAL_MS", DEFAULT_INTERVAL_MS),
    options.intervalMs === undefined ? 1_000 : 10,
    60_000
  );
  let closed = false;
  let inFlight: Promise<StrategicRunOutboxDrainResult> | null = null;

  const drainNow = () => {
    if (closed) return Promise.resolve(emptyDrainResult());
    if (inFlight) return inFlight;
    inFlight = drainSignalStrategicRunOutbox(options)
      .catch((error) => {
        console.error("Signal strategic run outbox drain failed.", {
          code: safeErrorCode(error)
        });
        return { ...emptyDrainResult(), failed: 1 };
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const timer = setInterval(() => {
    void drainNow();
  }, intervalMs);
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

async function dispatchClaimedStrategicRun(args: {
  database: Pick<Pool, "connect" | "query">;
  queue: StrategicRunOutboxQueue;
  row: StrategicRunOutboxRow;
  maxAttempts: number;
}): Promise<"dispatched" | "reconciled" | "failed" | "dead_lettered" | "lease_lost"> {
  const jobId = buildSignalStrategicRunJobId(args.row.tb_analysis_id);
  try {
    const existing = await args.queue.getJob(jobId);
    if (existing) {
      return await markStrategicRunDispatched(args.database, args.row, jobId)
        ? "reconciled"
        : "lease_lost";
    }
    if (
      args.row.previous_status === "dispatching"
      && args.row.previous_attempt >= args.maxAttempts
    ) {
      return markStrategicRunDispatchFailed(
        args.database,
        args.row,
        new StrategicRunDispatchAttemptsExhaustedError(),
        args.maxAttempts
      );
    }
    const job = await args.queue.add(
      "tb_run_analysis",
      { tbAnalysisId: args.row.tb_analysis_id },
      {
        jobId,
        attempts: 1,
        ...STRATEGIC_JOB_RETENTION
      }
    );
    return await markStrategicRunDispatched(
      args.database,
      args.row,
      String(job.id ?? jobId)
    ) ? "dispatched" : "lease_lost";
  } catch (error) {
    // Queue.add can be accepted by Redis while its response or the following DB
    // update is interrupted. The deterministic job is authoritative evidence.
    try {
      const accepted = await args.queue.getJob(jobId);
      if (accepted) {
        return await markStrategicRunDispatched(args.database, args.row, jobId)
          ? "reconciled"
          : "lease_lost";
      }
    } catch {
      // Persist the original bounded failure below; the lease remains recoverable.
    }
    return markStrategicRunDispatchFailed(args.database, args.row, error, args.maxAttempts);
  }
}

async function markStrategicRunDispatched(
  database: Pick<Pool, "connect" | "query">,
  row: StrategicRunOutboxRow,
  jobId: string
) {
  const updated = await database.query(`
    UPDATE signal_strategic_run_outbox
    SET status = 'dispatched',
        bullmq_job_id = $3,
        dispatched_at = COALESCE(dispatched_at, now()),
        locked_at = NULL,
        lease_expires_at = NULL,
        lease_token = NULL,
        last_error = '{}'::jsonb,
        updated_at = now()
    WHERE id = $1::uuid
      AND status = 'dispatching'
      AND lease_token = $2::uuid
  `, [row.id, row.lease_token, jobId]);
  return (updated.rowCount ?? 0) === 1;
}

async function markStrategicRunDispatchFailed(
  database: Pick<Pool, "connect" | "query">,
  row: StrategicRunOutboxRow,
  error: unknown,
  maxAttempts: number
): Promise<"failed" | "dead_lettered" | "lease_lost"> {
  const terminal = row.attempt >= maxAttempts;
  const updated = await database.query(`
    UPDATE signal_strategic_run_outbox
    SET status = $3,
        available_at = CASE
          WHEN $3 = 'failed' THEN now() + make_interval(secs => $4::integer)
          ELSE available_at
        END,
        completed_at = CASE WHEN $3 = 'dead_letter' THEN now() ELSE completed_at END,
        dead_lettered_at = CASE WHEN $3 = 'dead_letter' THEN now() ELSE dead_lettered_at END,
        locked_at = NULL,
        lease_expires_at = NULL,
        lease_token = NULL,
        last_error = jsonb_build_object(
          'code', $5::text,
          'message', $6::text
        ),
        updated_at = now()
    WHERE id = $1::uuid
      AND status = 'dispatching'
      AND lease_token = $2::uuid
  `, [
    row.id,
    row.lease_token,
    terminal ? "dead_letter" : "failed",
    signalStrategicRunBackoffSeconds(row.attempt),
    safeErrorCode(error),
    safeErrorMessage(error)
  ]);
  if ((updated.rowCount ?? 0) !== 1) return "lease_lost";
  return terminal ? "dead_lettered" : "failed";
}

async function defaultStrategicQueue() {
  const { getTbAnalysisProducer } = await import("../queues/tb-analysis");
  return getTbAnalysisProducer() as unknown as StrategicRunOutboxQueue;
}

function readNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "queue_dispatch_failed";
  const candidate = error as { code?: unknown; name?: unknown };
  const value = String(candidate.code ?? candidate.name ?? "queue_dispatch_failed")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "_")
    .slice(0, 80);
  return value || "queue_dispatch_failed";
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:postgres(?:ql)?|redis(?:s)?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(password|token|secret|key)=\S+/giu, "$1=[redacted]")
    .slice(0, 300);
}

function emptyDrainResult(): StrategicRunOutboxDrainResult {
  return {
    claimed: 0,
    dispatched: 0,
    reconciled: 0,
    failed: 0,
    dead_lettered: 0,
    lease_lost: 0
  };
}

class StrategicRunDispatchAttemptsExhaustedError extends Error {
  readonly code = "dispatch_attempts_exhausted";

  constructor() {
    super("Strategic run dispatch attempts were exhausted before a BullMQ job was accepted.");
    this.name = "StrategicRunDispatchAttemptsExhaustedError";
  }
}
