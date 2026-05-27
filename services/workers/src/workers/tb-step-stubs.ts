import type { Job } from "bullmq";

import type { TbStepName } from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  enqueueStep,
  markStepCompleted,
  markStepFailed,
  markStepRunning,
  releaseCorpusLock
} from "./tb-shared";

type StubJobData = {
  tbAnalysisId: string;
  pipelineStepId: string;
};

/**
 * Stub runner shared by all not-yet-implemented steps. Marks running →
 * completed with a "TODO" result summary and advances the pipeline. This
 * lets us validate end-to-end orchestration before each step's prompt is
 * implemented. Each TODO sketches what the real implementation will do.
 */
async function runStub(
  job: Job<StubJobData>,
  step: TbStepName,
  todo: string,
  nextStep: TbStepName | null
) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    console.log(`[tb-${step}] STUB — ${todo}`);
    // Simulate some work so the UI's polling shows progress motion
    for (let p = 25; p <= 90; p += 25) {
      await new Promise((r) => setTimeout(r, 400));
      await job.updateProgress(p);
    }

    await markStepCompleted({
      pipelineStepId,
      resultSummary: { stub: true, todo }
    });

    if (nextStep) {
      const next = await enqueueStep({ tbAnalysisId, step: nextStep });
      await job.updateProgress(100);
      return { stub: true, next_step_job_id: next.jobId };
    }

    // No next step → pipeline reached the end. Mark needs_review and unlock.
    await pool.query(
      `UPDATE tb_analyses
       SET status = 'needs_review', current_step = 'review', updated_at = NOW()
       WHERE id = $1`,
      [tbAnalysisId]
    );
    await releaseCorpusLock(tbAnalysisId);
    await job.updateProgress(100);
    return { stub: true, pipeline_complete: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

/**
 * Step 5 — Comparativo (si aplica).
 * TODO: implement spec §5.6. If competitor corpora exist with approved T&B
 * analyses, run cross-comparison. Otherwise skip and append a note to
 * tb_analyses.limitations.
 */
export function tbStep5ComparativeJob(job: Job<StubJobData>) {
  return runStub(
    job,
    "step5_comparative",
    "Si hay competidores con T&B aprobado, comparar; sino, agregar a limitations y skip",
    "step6_synthesis"
  );
}

/**
 * Step 6 — Síntesis final + humanizer.
 * TODO: implement spec §5.7. Build activation_playbook + friction_removal_plan
 * by combining the top findings + movilidad + competitor diff (if any). For
 * each block, run Claude's "humanizer" prompt over the copy. Persist into
 * tb_analyses.activation_playbook, .friction_removal_plan and split into
 * tb_recommendations rows.
 */
export function tbStep6SynthesisJob(job: Job<StubJobData>) {
  return runStub(
    job,
    "step6_synthesis",
    "Construir playbooks + humanizer; persistir tb_recommendations + jsonb blocks en tb_analyses",
    "quality_gates"
  );
}

/**
 * Quality gates — final 7 automated checks before status='needs_review'.
 * TODO: implement spec §8. Check coverage by layer, citation integrity,
 * humanizer voice, ambiguous coding rate, etc. Each gate writes to
 * tb_quality_gates.
 */
export function tbQualityGatesJob(job: Job<StubJobData>) {
  return runStub(
    job,
    "quality_gates",
    "Correr los 7 quality gates de §8; persistir tb_quality_gates rows; promover a needs_review",
    null
  );
}
