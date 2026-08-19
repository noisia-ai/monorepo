import { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";

import { resolveTbAnalysisQueueName, type TbStepName } from "@noisia/query-engine";
import { pool } from "../db/client";
import { redisConnection } from "../queues/query-engine";
import { buildSignalStrategicStepJobId } from "./signal-strategic-step-outbox";
import {
  conservativeInputTokenCount,
  executeGovernedProviderBoundaryV1,
  exactProviderTokenCount,
  signalTbMaxInputTokensPerCall,
  signalTbPlannedOperationMaxOutputTokens
} from "./tb-strategic-runtime-contract";

export { executeGovernedProviderBoundaryV1 } from "./tb-strategic-runtime-contract";

const EXECUTION_LEASE_SECONDS = 180;
const EXECUTION_HEARTBEAT_MS = 60_000;
const executionLeases = new Map<string, { token: string; timer: NodeJS.Timeout }>();

/** Shared queue instance for enqueuing the next step from inside a worker. */
let tbQueue: Queue | null = null;
export function getTbQueue(): Queue {
  if (!tbQueue) {
    tbQueue = new Queue(resolveTbAnalysisQueueName(), { connection: redisConnection });
  }
  return tbQueue;
}

/** Explicit map from step name to BullMQ job name (no clever regex). */
const STEP_JOB_NAME: Record<TbStepName, string> = {
  preflight: "tb_step_preflight",
  step1_open_pass: "tb_step_1_open_pass",
  step2_coding: "tb_step_2_coding",
  step3_hierarchy: "tb_step_3_hierarchy",
  step4_mobility: "tb_step_4_mobility",
  step5_comparative: "tb_step_5_comparative",
  step6_synthesis: "tb_step_6_synthesis",
  quality_gates: "tb_quality_gates"
};

/** Create a pipeline step row in 'queued' status and enqueue the BullMQ job. */
export async function enqueueStep(args: {
  tbAnalysisId: string;
  step: TbStepName;
  attempt?: number;
}): Promise<{ jobId: string; pipelineStepId: string }> {
  const governed = await loadGovernedRunControl(args.tbAnalysisId);
  if (governed) return enqueueGovernedStep({ ...args, runControl: governed });
  const [stepRow] = (
    await pool.query<{ id: string }>(
      `INSERT INTO tb_pipeline_steps (tb_analysis_id, step, status, attempt)
       VALUES ($1, $2, 'queued', $3)
       RETURNING id`,
      [args.tbAnalysisId, args.step, args.attempt ?? 1]
    )
  ).rows;
  if (!stepRow) throw new Error("Could not create pipeline step row");

  const queue = getTbQueue();
  const job = await queue.add(
    STEP_JOB_NAME[args.step],
    { tbAnalysisId: args.tbAnalysisId, pipelineStepId: stepRow.id },
    { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
  );

  await pool.query(
    `UPDATE tb_pipeline_steps SET bullmq_job_id = $1 WHERE id = $2`,
    [job.id ?? null, stepRow.id]
  );

  return { jobId: String(job.id), pipelineStepId: stepRow.id };
}

async function enqueueGovernedStep(args: {
  tbAnalysisId: string;
  step: TbStepName;
  attempt?: number;
  runControl: { id: string; workspace_id: string; status: string };
}): Promise<{ jobId: string; pipelineStepId: string }> {
  const attempt = args.attempt ?? 1;
  const idempotencyKey = `sha256:${createHash("sha256").update([
    "signal-strategic-step-outbox-v1", args.runControl.id, args.step, String(attempt)
  ].join("\u001f"), "utf8").digest("hex")}`;
  const client = await pool.connect();
  let pipelineStepId: string;
  let persistedIdempotencyKey = idempotencyKey;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`strategic-step:${args.runControl.id}:${args.step}:${attempt}`]
    );
    const existing = await client.query<{
      pipeline_step_id: string;
      idempotency_key: string;
    }>(
      `SELECT pipeline_step_id::text,idempotency_key
       FROM signal_strategic_step_outbox
       WHERE run_control_id=$1::uuid
         AND (idempotency_key=$2 OR (pipeline_step=$3 AND attempt=$4))
       ORDER BY (idempotency_key=$2) DESC
       LIMIT 1`,
      [args.runControl.id, idempotencyKey, args.step, attempt]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].idempotency_key !== idempotencyKey) {
        throw new Error("governed_strategic_step_identity_conflict");
      }
      pipelineStepId = existing.rows[0].pipeline_step_id;
      persistedIdempotencyKey = existing.rows[0].idempotency_key;
    } else {
      const control = await client.query<{ status: string; cancel_requested_at: string | null }>(
        `SELECT status,cancel_requested_at::text FROM signal_strategic_run_controls
         WHERE id=$1::uuid FOR UPDATE`,
        [args.runControl.id]
      );
      if (!control.rows[0] || !["queued", "running"].includes(control.rows[0].status)
          || control.rows[0].cancel_requested_at) {
        throw new Error("governed_strategic_run_not_dispatchable");
      }
      const step = await client.query<{ id: string }>(
        `INSERT INTO tb_pipeline_steps (tb_analysis_id,step,status,attempt)
         VALUES ($1::uuid,$2,'queued',$3) RETURNING id::text`,
        [args.tbAnalysisId, args.step, attempt]
      );
      pipelineStepId = step.rows[0]?.id ?? "";
      if (!pipelineStepId) throw new Error("Could not create governed pipeline step row");
      const outbox = await client.query<{ id: string }>(
        `INSERT INTO signal_strategic_step_outbox (
           run_control_id,workspace_id,tb_analysis_id,pipeline_step_id,
           pipeline_step,attempt,idempotency_key
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7)
         RETURNING id::text`,
        [args.runControl.id, args.runControl.workspace_id, args.tbAnalysisId,
          pipelineStepId, args.step, attempt, idempotencyKey]
      );
      if (!outbox.rows[0]?.id) throw new Error("Could not create governed step outbox row");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // PostgreSQL commit is the enqueue authority. The independently running
  // drainer claims this row and reconciles BullMQ using the deterministic id;
  // there is no request/process crash window after this return.
  return {
    jobId: buildSignalStrategicStepJobId(persistedIdempotencyKey),
    pipelineStepId
  };
}

/** Mark a step as running and stamp started_at. */
export async function markStepRunning(pipelineStepId: string): Promise<void> {
  const runtime = await loadGovernedStepRuntime(pipelineStepId);
  await assertPipelineStepSnapshotContainment(pipelineStepId, "before");
  if (runtime) {
    await assertGovernedRuntimeAuthority(runtime.run_control_id);
    // Make the non-authoritative UI mirror before taking the durable lease. No
    // fallible database work may remain after the heartbeat starts, otherwise
    // a failed BullMQ handler could keep an orphaned lease alive.
    await mirrorAnalysisCurrentStep(pipelineStepId);
    const token = randomUUID();
    const claimed = await pool.query<{ claimed: boolean }>(
      `SELECT claim_signal_strategic_step_v1($1::uuid,$2::uuid,$3::integer) AS claimed`,
      [pipelineStepId, token, EXECUTION_LEASE_SECONDS]
    );
    if (claimed.rows[0]?.claimed !== true) {
      throw new Error("governed_strategic_step_execution_lease_unavailable");
    }
    startExecutionHeartbeat({ pipelineStepId, token });
    return;
  }
  await pool.query(
    `UPDATE tb_pipeline_steps
     SET status = 'running', started_at = COALESCE(started_at,NOW())
     WHERE id = $1`,
    [pipelineStepId]
  );
  await mirrorAnalysisCurrentStep(pipelineStepId);
}

async function mirrorAnalysisCurrentStep(pipelineStepId: string) {
  await pool.query(
    `UPDATE tb_analyses
     SET current_step = (SELECT step FROM tb_pipeline_steps WHERE id = $1),
         updated_at = NOW()
     WHERE id = (SELECT tb_analysis_id FROM tb_pipeline_steps WHERE id = $1)`,
    [pipelineStepId]
  );
}

/** Mark a step as completed with optional result summary. */
export async function markStepCompleted(args: {
  pipelineStepId: string;
  resultSummary?: unknown;
}): Promise<void> {
  await assertPipelineStepSnapshotContainment(args.pipelineStepId, "after");
  const lease = takeExecutionLease(args.pipelineStepId);
  if (lease) {
    const completed = await pool.query<{ completed: boolean }>(
      `SELECT complete_signal_strategic_step_v1(
         $1::uuid,$2::uuid,$3::jsonb
       ) AS completed`,
      [
        args.pipelineStepId,
        lease.token,
        args.resultSummary ? JSON.stringify(args.resultSummary) : null
      ]
    );
    if (completed.rows[0]?.completed !== true) {
      throw new Error("governed_strategic_step_execution_lease_lost");
    }
    return;
  }
  if (await loadGovernedStepRuntime(args.pipelineStepId)) {
    throw new Error("governed_strategic_step_execution_lease_missing");
  }
  await pool.query(
    `UPDATE tb_pipeline_steps
     SET status = 'completed',
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
         result_summary = $1::jsonb,
         error_message = NULL
     WHERE id = $2`,
    [args.resultSummary ? JSON.stringify(args.resultSummary) : null, args.pipelineStepId]
  );
}

async function assertPipelineStepSnapshotContainment(
  pipelineStepId: string,
  boundary: "before" | "after"
) {
  await pool.query(
    `SELECT assert_signal_tb_snapshot_containment(
       step.tb_analysis_id,
       step.step || ':' || $2::text
     )
     FROM tb_pipeline_steps step
     WHERE step.id = $1::uuid`,
    [pipelineStepId, boundary]
  );
}

/** Mark a step as failed and the parent analysis as failed too. */
export async function markStepFailed(args: {
  pipelineStepId: string;
  errorMessage: string;
}): Promise<void> {
  const lease = takeExecutionLease(args.pipelineStepId);
  if (lease) {
    const failed = await pool.query<{ status: string }>(
      `SELECT fail_signal_strategic_step_v1(
         $1::uuid,$2::uuid,now(),$3::jsonb,true
       ) AS status`,
      [
        args.pipelineStepId,
        lease.token,
        JSON.stringify({ code: strategicErrorCode(args.errorMessage) })
      ]
    );
    const status = failed.rows[0]?.status;
    if (!["dead_letter", "failed", "cancelled"].includes(status ?? "")) {
      throw new Error("governed_strategic_step_execution_lease_lost");
    }
    return;
  }
  if (await loadGovernedStepRuntime(args.pipelineStepId)) {
    // A governed execution without the process-owned lease cannot safely
    // overwrite durable state. The lease owner (or recovery worker) remains
    // authoritative.
    throw new Error("governed_strategic_step_execution_lease_missing");
  }
  await pool.query(
    `UPDATE tb_pipeline_steps
     SET status = 'failed',
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
         error_message = $1
     WHERE id = $2`,
    [args.errorMessage.slice(0, 2000), args.pipelineStepId]
  );

  await pool.query(
    `UPDATE tb_analyses
     SET status = 'failed', failed_at = NOW(), failure_reason = $1
     WHERE id = (SELECT tb_analysis_id FROM tb_pipeline_steps WHERE id = $2)`,
    [args.errorMessage.slice(0, 500), args.pipelineStepId]
  );
}

export async function loadTbPinnedModel(tbAnalysisId: string): Promise<string> {
  const authority = await pool.query<{
    strategic_contract_version: string | null;
    run_control_id: string | null;
    model_version: string | null;
  }>(
    `SELECT analysis.strategic_contract_version,control.id::text AS run_control_id,
       control.model_version
     FROM tb_analyses analysis
     LEFT JOIN signal_strategic_run_controls control ON control.tb_analysis_id=analysis.id
     WHERE analysis.id=$1::uuid`,
    [tbAnalysisId]
  ).catch((error) => fallbackStrategicAuthorityQuery(error, tbAnalysisId, {
    run_control_id: null,
    model_version: null
  }));
  const row = authority.rows[0];
  if (row?.strategic_contract_version === "signal-tb-strategic-v2") {
    if (!row.run_control_id) throw new Error("governed_strategic_run_control_missing");
    if (!row.model_version?.trim()) throw new Error("governed_strategic_model_not_pinned");
    return row.model_version;
  }
  return process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
}

export async function reserveTbProviderBudget(args: {
  tbAnalysisId: string;
  operationKey: string;
  prompt: string;
  maxOutputTokens: number;
}) {
  const authority = await pool.query<{
    strategic_contract_version: string | null;
    run_control_id: string | null;
    sample_count: number | null;
  }>(
    `SELECT analysis.strategic_contract_version,control.id::text AS run_control_id,
       control.sample_count
     FROM tb_analyses analysis
     LEFT JOIN signal_strategic_run_controls control ON control.tb_analysis_id=analysis.id
     WHERE analysis.id=$1::uuid`,
    [args.tbAnalysisId]
  ).catch((error) => fallbackStrategicAuthorityQuery(error, args.tbAnalysisId, {
    run_control_id: null,
    sample_count: null
  }));
  const row = authority.rows[0];
  if (row?.strategic_contract_version !== "signal-tb-strategic-v2") return null;
  if (!row.run_control_id) throw new Error("governed_strategic_run_control_missing");
  const plannedMaxOutputTokens = signalTbPlannedOperationMaxOutputTokens(
    args.operationKey,
    Number(row.sample_count)
  );
  if (args.maxOutputTokens !== plannedMaxOutputTokens) {
    throw new Error("governed_strategic_provider_output_bound_mismatch");
  }
  await assertGovernedRuntimeAuthority(row.run_control_id);
  // Conservative UTF-8 estimate used only for the pre-call reservation. The
  // provider-reported AI SDK usage is authoritative for settlement below.
  const estimatedInputTokens = conservativeInputTokenCount(args.prompt);
  const maxInputTokensPerCall = signalTbMaxInputTokensPerCall();
  if (estimatedInputTokens > maxInputTokensPerCall) {
    throw new Error("governed_strategic_input_token_bound_exceeded");
  }
  const idempotencyKey = `sha256:${createHash("sha256").update([
    "signal-strategic-provider-reservation-v1", row.run_control_id,
    args.operationKey, String(args.maxOutputTokens),
    createHash("sha256").update(args.prompt, "utf8").digest("hex")
  ].join("\u001f"), "utf8").digest("hex")}`;
  const reserved = await pool.query<{
    reservation_id: string;
    created: boolean;
    status: string;
  }>(
    `SELECT reservation_id::text,created,status
     FROM reserve_signal_strategic_budget_tokens_v1(
       $1::uuid,$2,$3::bigint,$4::bigint,$5
     )`,
    [
      row.run_control_id,
      args.operationKey,
      estimatedInputTokens,
      args.maxOutputTokens,
      idempotencyKey
    ]
  );
  const persisted = reserved.rows[0];
  if (!persisted?.reservation_id) {
    throw new Error("governed_strategic_budget_reservation_missing");
  }
  // A retry seeing a prior reservation cannot prove whether the provider was
  // already invoked before the process crashed. Never bill the operation a
  // second time; operator recovery must reconcile the provider outcome.
  if (persisted.created !== true || persisted.status !== "reserved") {
    throw new Error(`governed_strategic_provider_operation_requires_recovery:${persisted.status}`);
  }
  return {
    reservationId: persisted.reservation_id,
    runControlId: row.run_control_id,
    idempotencyKey,
    estimatedInputTokens,
    maxOutputTokens: args.maxOutputTokens
  };
}

type AiSdkUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export async function settleTbProviderBudget(
  reservation: Awaited<ReturnType<typeof reserveTbProviderBudget>>,
  usage: AiSdkUsage | null | undefined
) {
  if (!reservation) return null;
  const inputTokens = exactProviderTokenCount(usage?.inputTokens, "input");
  const outputTokens = exactProviderTokenCount(usage?.outputTokens, "output");
  const settled = await pool.query<{ actual_usd: string }>(
    `SELECT settle_signal_strategic_budget_v1(
       $1::uuid,$2,$3::bigint,$4::bigint
     )::text AS actual_usd`,
    [reservation.runControlId, reservation.idempotencyKey, inputTokens, outputTokens]
  );
  return {
    inputTokens,
    outputTokens,
    actualUsd: Number(settled.rows[0]?.actual_usd)
  };
}

/**
 * Provider boundary used by every governed T&B inference. It checks the live
 * sealed authority after reservation and immediately before invoking the
 * provider, then settles from exact provider-reported usage. A thrown provider
 * call deliberately leaves the reservation reserved: the worker cannot prove
 * that an interrupted request was unbilled.
 */
export async function runTbGovernedProviderCall<T extends { usage?: AiSdkUsage }>(args: {
  tbAnalysisId: string;
  operationKey: string;
  prompt: string;
  maxOutputTokens: number;
  invoke: (maxOutputTokens: number) => Promise<T>;
}) {
  const reservation = await reserveTbProviderBudget(args);
  return executeGovernedProviderBoundaryV1({
    reservation,
    maxOutputTokens: args.maxOutputTokens,
    assertAuthority: (value) => assertGovernedRuntimeAuthority(value.runControlId),
    releaseBeforeDispatch: async (value) => {
      await pool.query(
        `SELECT release_signal_strategic_budget_v1($1::uuid,$2,$3)`,
        [
          value.runControlId,
          value.idempotencyKey,
          "runtime_authority_failed_before_provider_dispatch"
        ]
      );
    },
    invoke: args.invoke,
    settle: (value, result) => settleTbProviderBudget(value, result.usage)
  });
}

type GovernedProviderReservation = NonNullable<
  Awaited<ReturnType<typeof reserveTbProviderBudget>>
>;

export async function assertTbGovernedRuntimeBoundary(args: {
  tbAnalysisId: string;
  pipelineStepId?: string;
}) {
  const control = await loadGovernedRunControl(args.tbAnalysisId);
  if (!control) return null;
  await assertGovernedRuntimeAuthority(control.id);
  if (args.pipelineStepId) await heartbeatExecutionLease(args.pipelineStepId);
  return control;
}

export async function transitionTbGovernedRun(args: {
  tbAnalysisId: string;
  expectedStatuses: string[];
  nextStatus: "running" | "needs_review" | "completed" | "failed" | "cancelled";
  workerKey: string;
}) {
  const control = await loadGovernedRunControl(args.tbAnalysisId);
  if (!control) return null;
  // Terminal-step SQL transitions the governed run atomically with the step.
  // Treat an exact retry as a no-op instead of appending redundant lifecycle work.
  if (control.status === args.nextStatus) return control.status;
  const transitioned = await pool.query<{ status: string }>(
    `SELECT transition_signal_strategic_run_v1(
       $1::uuid,$2::text[],$3::text,$4::text
     ) AS status`,
    [control.id, args.expectedStatuses, args.nextStatus, args.workerKey]
  );
  return transitioned.rows[0]?.status ?? null;
}

export async function isGovernedStrategicRun(tbAnalysisId: string) {
  const result = await pool.query<{ governed: boolean }>(
    `SELECT strategic_contract_version='signal-tb-strategic-v2' AS governed
     FROM tb_analyses WHERE id=$1::uuid`,
    [tbAnalysisId]
  );
  return result.rows[0]?.governed === true;
}

async function loadGovernedRunControl(tbAnalysisId: string) {
  const result = await pool.query<{
    strategic_contract_version: string | null;
    id: string | null;
    workspace_id: string | null;
    status: string | null;
    cancel_requested_at: string | null;
  }>(
    `SELECT analysis.strategic_contract_version,control.id::text,
       control.workspace_id::text,control.status,control.cancel_requested_at::text
     FROM tb_analyses analysis
     LEFT JOIN signal_strategic_run_controls control ON control.tb_analysis_id=analysis.id
     WHERE analysis.id=$1::uuid`,
    [tbAnalysisId]
  ).catch((error) => fallbackStrategicAuthorityQuery(error, tbAnalysisId, {
    id: null,
    workspace_id: null,
    status: null,
    cancel_requested_at: null
  }));
  const row = result.rows[0];
  if (row?.strategic_contract_version !== "signal-tb-strategic-v2") return null;
  if (!row.id || !row.workspace_id || !row.status) {
    throw new Error("governed_strategic_run_control_missing");
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    status: row.status,
    cancel_requested_at: row.cancel_requested_at
  };
}

async function assertGovernedRuntimeAuthority(runControlId: string) {
  const result = await pool.query<{ authority: unknown }>(
    `SELECT assert_signal_strategic_runtime_authority_v1($1::uuid) AS authority`,
    [runControlId]
  );
  if (!result.rows[0]?.authority) {
    throw new Error("governed_strategic_runtime_authority_unavailable");
  }
}

async function loadGovernedStepRuntime(pipelineStepId: string) {
  const result = await pool.query<{
    strategic_contract_version: string | null;
    run_control_id: string | null;
  }>(
    `SELECT analysis.strategic_contract_version,outbox.run_control_id::text
     FROM tb_pipeline_steps step
     JOIN tb_analyses analysis ON analysis.id=step.tb_analysis_id
     LEFT JOIN signal_strategic_step_outbox outbox ON outbox.pipeline_step_id=step.id
     WHERE step.id=$1::uuid`,
    [pipelineStepId]
  ).catch(async (error) => {
    if ((error as { code?: string }).code !== "42P01") throw error;
    const fallback = await pool.query<{ strategic_contract_version: string | null }>(
      `SELECT analysis.strategic_contract_version
       FROM tb_pipeline_steps step
       JOIN tb_analyses analysis ON analysis.id=step.tb_analysis_id
       WHERE step.id=$1::uuid`,
      [pipelineStepId]
    );
    return {
      rows: fallback.rows.map((row) => ({ ...row, run_control_id: null }))
    };
  });
  const row = result.rows[0];
  if (row?.strategic_contract_version !== "signal-tb-strategic-v2") return null;
  if (!row.run_control_id) throw new Error("governed_strategic_step_control_missing");
  return { run_control_id: row.run_control_id };
}

function startExecutionHeartbeat(args: { pipelineStepId: string; token: string }) {
  takeExecutionLease(args.pipelineStepId);
  const timer = setInterval(() => {
    void heartbeatExecutionLease(args.pipelineStepId).catch((error) => {
      console.error("[tb-runtime] strategic execution heartbeat failed", {
        code: error instanceof Error ? error.name : "unknown_error"
      });
    });
  }, EXECUTION_HEARTBEAT_MS);
  timer.unref?.();
  executionLeases.set(args.pipelineStepId, { token: args.token, timer });
}

async function heartbeatExecutionLease(pipelineStepId: string) {
  const lease = executionLeases.get(pipelineStepId);
  if (!lease) throw new Error("governed_strategic_execution_lease_missing");
  const result = await pool.query<{ heartbeat: boolean }>(
    `SELECT heartbeat_signal_strategic_step_v1(
       $1::uuid,$2::uuid,$3::integer
     ) AS heartbeat`,
    [pipelineStepId, lease.token, EXECUTION_LEASE_SECONDS]
  );
  if (result.rows[0]?.heartbeat !== true) {
    throw new Error("governed_strategic_execution_lease_lost");
  }
}

function takeExecutionLease(pipelineStepId: string) {
  const lease = executionLeases.get(pipelineStepId);
  if (!lease) return null;
  clearInterval(lease.timer);
  executionLeases.delete(pipelineStepId);
  return lease;
}

/**
 * Queue-level safety net for failures that happen outside a step's own try/catch
 * (for example a Redis progress update immediately after claiming execution).
 * The PostgreSQL lease is deliberately not mutated; it expires and is recovered
 * by the durable execution CAS.
 */
export function stopTbStrategicExecutionHeartbeat(pipelineStepId: string | undefined) {
  if (!pipelineStepId) return;
  takeExecutionLease(pipelineStepId);
}

function strategicErrorCode(message: string) {
  return message.toLowerCase().replace(/[^a-z0-9_-]/gu, "_").slice(0, 80)
    || "step_failed";
}

async function fallbackStrategicAuthorityQuery<T extends Record<string, unknown>>(
  error: unknown,
  tbAnalysisId: string,
  emptyControl: T
) {
  if ((error as { code?: string }).code !== "42P01") throw error;
  const fallback = await pool.query<{ strategic_contract_version: string | null }>(
    `SELECT strategic_contract_version FROM tb_analyses WHERE id=$1::uuid`,
    [tbAnalysisId]
  );
  return {
    rows: fallback.rows.map((row) => ({ ...row, ...emptyControl }))
  };
}

/** Release the corpus lock once the analysis terminates (success or failure). */
export async function releaseCorpusLock(tbAnalysisId: string): Promise<void> {
  await pool.query(
    `UPDATE study_corpora
     SET locked_by_analysis_id = NULL
     WHERE locked_by_analysis_id = $1`,
    [tbAnalysisId]
  );
}
