import type { Job } from "bullmq";

import { ENGINE_PIPELINE_VERSION } from "@noisia/query-engine";
import { pool } from "../db/client";
import { enqueueEngineStep } from "./engine-shared";

type EngineOrchestratorJobData = {
  engineAnalysisId: string;
};

export async function engineOrchestratorJob(job: Job<EngineOrchestratorJobData>) {
  await job.updateProgress(20);

  await pool.query(
    `UPDATE engine_analyses
     SET pipeline_version = $1,
         status = 'running',
         current_step = 'preflight',
         updated_at = NOW()
     WHERE id = $2`,
    [ENGINE_PIPELINE_VERSION, job.data.engineAnalysisId]
  );

  await job.updateProgress(60);
  const next = await enqueueEngineStep({
    engineAnalysisId: job.data.engineAnalysisId,
    step: "preflight"
  });

  await job.updateProgress(100);
  return {
    engine_analysis_id: job.data.engineAnalysisId,
    first_step_job_id: next.jobId,
    first_step_pipeline_id: next.pipelineStepId
  };
}
