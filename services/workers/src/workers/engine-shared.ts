import { Queue } from "bullmq";

import { ENGINE_QUEUE_NAME, ENGINE_STEP_JOB_NAME, type EngineStepName } from "@noisia/query-engine";
import { pool } from "../db/client";
import { redisConnection } from "../queues/query-engine";
import { estimateModelCostUsd, positiveTokenInteger, type EngineCostUsage } from "./engine-cost";

let engineQueue: Queue | null = null;

export function getEngineQueue(): Queue {
  if (!engineQueue) {
    engineQueue = new Queue(resolveQueueName(ENGINE_QUEUE_NAME), { connection: redisConnection });
  }
  return engineQueue;
}

export async function enqueueEngineStep(args: {
  engineAnalysisId: string;
  step: EngineStepName;
  attempt?: number;
}): Promise<{ jobId: string; pipelineStepId: string }> {
  const [stepRow] = (
    await pool.query<{ id: string }>(
      `INSERT INTO engine_pipeline_steps (engine_analysis_id, step, status, attempt)
       VALUES ($1, $2, 'queued', $3)
       RETURNING id`,
      [args.engineAnalysisId, args.step, args.attempt ?? 1]
    )
  ).rows;
  if (!stepRow) throw new Error("Could not create engine pipeline step row");

  const job = await getEngineQueue().add(
    ENGINE_STEP_JOB_NAME[args.step],
    { engineAnalysisId: args.engineAnalysisId, pipelineStepId: stepRow.id },
    { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
  );

  await pool.query(
    `UPDATE engine_pipeline_steps SET bullmq_job_id = $1 WHERE id = $2`,
    [job.id ?? null, stepRow.id]
  );

  return { jobId: String(job.id), pipelineStepId: stepRow.id };
}

export async function markEngineStepRunning(pipelineStepId: string): Promise<void> {
  await pool.query(
    `UPDATE engine_pipeline_steps
     SET status = 'running', started_at = NOW()
     WHERE id = $1`,
    [pipelineStepId]
  );
  await pool.query(
    `UPDATE engine_analyses
     SET status = 'running',
         current_step = (SELECT step FROM engine_pipeline_steps WHERE id = $1),
         updated_at = NOW()
     WHERE id = (SELECT engine_analysis_id FROM engine_pipeline_steps WHERE id = $1)`,
    [pipelineStepId]
  );
}

export async function markEngineStepCompleted(args: {
  pipelineStepId: string;
  resultSummary?: unknown;
}): Promise<void> {
  await pool.query(
    `UPDATE engine_pipeline_steps
     SET status = 'completed',
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
         result_summary = $1::jsonb,
         error_message = NULL
     WHERE id = $2`,
    [args.resultSummary ? JSON.stringify(args.resultSummary) : null, args.pipelineStepId]
  );
}

export async function markEngineStepFailed(args: {
  pipelineStepId: string;
  errorMessage: string;
}): Promise<void> {
  await pool.query(
    `UPDATE engine_pipeline_steps
     SET status = 'failed',
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
         error_message = $1
     WHERE id = $2`,
    [args.errorMessage.slice(0, 2000), args.pipelineStepId]
  );

  await pool.query(
    `UPDATE engine_analyses
     SET status = 'failed', failed_at = NOW(), failure_reason = $1, updated_at = NOW()
     WHERE id = (SELECT engine_analysis_id FROM engine_pipeline_steps WHERE id = $2)`,
    [args.errorMessage.slice(0, 500), args.pipelineStepId]
  );
}

export async function recordEngineCostEvent(args: {
  engineAnalysisId: string;
  pipelineStepId?: string | null;
  provider: string;
  model?: string | null;
  operation: string;
  usage?: EngineCostUsage | null;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const inputTokens = positiveTokenInteger(args.usage?.inputTokens);
  const outputTokens = positiveTokenInteger(args.usage?.outputTokens);
  const totalTokens = positiveTokenInteger(args.usage?.totalTokens) || inputTokens + outputTokens;
  const estimatedCostUsd = typeof args.estimatedCostUsd === "number" && Number.isFinite(args.estimatedCostUsd)
    ? args.estimatedCostUsd
    : estimateModelCostUsd({ provider: args.provider, model: args.model, inputTokens, outputTokens });

  try {
    await pool.query(
      `INSERT INTO engine_cost_events (
         engine_analysis_id, pipeline_step_id, provider, model, operation,
         input_tokens, output_tokens, total_tokens, estimated_cost_usd, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        args.engineAnalysisId,
        args.pipelineStepId ?? null,
        args.provider,
        args.model ?? null,
        args.operation,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        JSON.stringify(args.metadata ?? {})
      ]
    );
  } catch (error) {
    if (isMissingCostLedgerError(error)) {
      console.warn("[engine-cost] cost ledger table missing; skipping cost event");
      return;
    }
    throw error;
  }
}

export async function releaseEngineCorpusLock(engineAnalysisId: string): Promise<void> {
  await pool.query(
    `UPDATE study_corpora
     SET locked_by_analysis_id = NULL
     WHERE locked_by_analysis_id = $1`,
    [engineAnalysisId]
  );
}

function isMissingCostLedgerError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01");
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_ENGINE_QUEUE_NAME) return process.env.NOISIA_ENGINE_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
