import { Queue } from "bullmq";

import { TB_ANALYSIS_QUEUE_NAME, type TbStepName } from "@noisia/query-engine";
import { pool } from "../db/client";
import { redisConnection } from "../queues/query-engine";

/** Shared queue instance for enqueuing the next step from inside a worker. */
let tbQueue: Queue | null = null;
export function getTbQueue(): Queue {
  if (!tbQueue) {
    tbQueue = new Queue(TB_ANALYSIS_QUEUE_NAME, { connection: redisConnection });
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

/** Mark a step as running and stamp started_at. */
export async function markStepRunning(pipelineStepId: string): Promise<void> {
  await pool.query(
    `UPDATE tb_pipeline_steps
     SET status = 'running', started_at = NOW()
     WHERE id = $1`,
    [pipelineStepId]
  );
  // Mirror current_step on the analysis row so the UI can show progress
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

/** Mark a step as failed and the parent analysis as failed too. */
export async function markStepFailed(args: {
  pipelineStepId: string;
  errorMessage: string;
}): Promise<void> {
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

/** Release the corpus lock once the analysis terminates (success or failure). */
export async function releaseCorpusLock(tbAnalysisId: string): Promise<void> {
  await pool.query(
    `UPDATE study_corpora
     SET locked_by_analysis_id = NULL
     WHERE locked_by_analysis_id = $1`,
    [tbAnalysisId]
  );
}
