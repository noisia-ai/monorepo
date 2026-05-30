import { Worker } from "bullmq";

import { TB_ANALYSIS_QUEUE_NAME } from "@noisia/query-engine";
import { tbOrchestratorJob } from "../workers/tb-orchestrator";
import { tbStep1OpenPassJob } from "../workers/tb-step-1-open-pass";
import { tbStep2CodingJob } from "../workers/tb-step-2-coding";
import { tbStep3HierarchyJob } from "../workers/tb-step-3-hierarchy";
import { tbStep4MobilityJob } from "../workers/tb-step-4-mobility";
import { tbStep5ComparativeJob } from "../workers/tb-step-5-comparative";
import { tbStep6SynthesisJob } from "../workers/tb-step-6-synthesis";
import { tbPreflightJob } from "../workers/tb-step-preflight";
import { tbQualityGatesJob } from "../workers/tb-quality-gates";
import { redisConnection } from "./query-engine";

/**
 * Separate queue from the query-engine because T&B steps are long (10-30 min
 * end-to-end) and we don't want them to starve query refinement / cleanup
 * jobs. Concurrency=1 keeps Claude rate-limit safe and serializes per worker.
 */
export function startTbAnalysisWorker() {
  return new Worker(
    TB_ANALYSIS_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "tb_run_analysis":
          return tbOrchestratorJob(job);
        case "tb_step_preflight":
          return tbPreflightJob(job);
        case "tb_step_1_open_pass":
          return tbStep1OpenPassJob(job);
        case "tb_step_2_coding":
          return tbStep2CodingJob(job);
        case "tb_step_3_hierarchy":
          return tbStep3HierarchyJob(job);
        case "tb_step_4_mobility":
          return tbStep4MobilityJob(job);
        case "tb_step_5_comparative":
          return tbStep5ComparativeJob(job);
        case "tb_step_6_synthesis":
          return tbStep6SynthesisJob(job);
        case "tb_quality_gates":
          return tbQualityGatesJob(job);
        default:
          throw new Error(`Unsupported tb-analysis job: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: 1
    }
  );
}
