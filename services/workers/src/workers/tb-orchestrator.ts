import type { Job } from "bullmq";

import { TB_PIPELINE_VERSION, TB_METHODOLOGY_VERSION } from "@noisia/query-engine";
import { pool } from "../db/client";
import { enqueueStep } from "./tb-shared";

type TbOrchestratorJobData = {
  tbAnalysisId: string;
};

/**
 * Lightweight orchestrator. The actual pipeline runs as a CHAIN of per-step
 * jobs (each step enqueues the next on success). This job just kicks the
 * first step — preflight. Kept as a separate worker so the API only has to
 * queue ONE job and BullMQ owns the rest of the pipeline.
 */
export async function tbOrchestratorJob(job: Job<TbOrchestratorJobData>) {
  await job.updateProgress(20);

  // Stamp pipeline + methodology versions if not set yet
  await pool.query(
    `UPDATE tb_analyses
     SET pipeline_version = COALESCE(NULLIF(pipeline_version,''), $1),
         methodology_version = COALESCE(NULLIF(methodology_version,''), $2),
         updated_at = NOW()
     WHERE id = $3`,
    [TB_PIPELINE_VERSION, TB_METHODOLOGY_VERSION, job.data.tbAnalysisId]
  );

  await job.updateProgress(60);

  // Kick the first step. Each step worker enqueues the next on success.
  const { jobId, pipelineStepId } = await enqueueStep({
    tbAnalysisId: job.data.tbAnalysisId,
    step: "preflight"
  });

  await job.updateProgress(100);

  return {
    tb_analysis_id: job.data.tbAnalysisId,
    first_step_job_id: jobId,
    first_step_pipeline_id: pipelineStepId
  };
}
