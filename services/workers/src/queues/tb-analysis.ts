import { Queue, Worker } from "bullmq";

import { resolveTbAnalysisQueueName } from "@noisia/query-engine";
import { tbOrchestratorJob } from "../workers/tb-orchestrator";
import { tbStep1OpenPassJob } from "../workers/tb-step-1-open-pass";
import { tbStep2CodingJob } from "../workers/tb-step-2-coding";
import { tbStep3HierarchyJob } from "../workers/tb-step-3-hierarchy";
import { tbStep4MobilityJob } from "../workers/tb-step-4-mobility";
import { tbStep5ComparativeJob } from "../workers/tb-step-5-comparative";
import { tbStep6SynthesisJob } from "../workers/tb-step-6-synthesis";
import { tbPreflightJob } from "../workers/tb-step-preflight";
import { tbQualityGatesJob } from "../workers/tb-quality-gates";
import { stopTbStrategicExecutionHeartbeat } from "../workers/tb-shared";
import { redisConnection } from "./query-engine";

export const tbAnalysisQueueName = resolveTbAnalysisQueueName();
export const TB_ANALYSIS_HEARTBEAT_KEY = `noisia:worker-alive:${tbAnalysisQueueName}`;
export const TB_ANALYSIS_HEARTBEAT_TTL_SECONDS = 45;

let tbAnalysisProducer: Queue | null = null;

export function getTbAnalysisProducer() {
  tbAnalysisProducer ??= new Queue(tbAnalysisQueueName, {
    connection: redisConnection
  });
  return tbAnalysisProducer;
}

export async function closeTbAnalysisProducer() {
  const producer = tbAnalysisProducer;
  tbAnalysisProducer = null;
  await producer?.close();
}

/**
 * Live readiness contract shared with Studio's free strategic preflight.
 *
 * Managed Redis does not expose a reliable worker list.  The key only exists
 * while this process owns both the T&B Worker and its durable outbox drainer;
 * callers must treat a missing key or a Redis error as not ready.
 */
export function startTbAnalysisHeartbeat() {
  let closed = false;
  const write = async () => {
    if (closed) return;
    await redisConnection.set(
      TB_ANALYSIS_HEARTBEAT_KEY,
      String(Date.now()),
      "EX",
      TB_ANALYSIS_HEARTBEAT_TTL_SECONDS
    );
  };
  const guardedWrite = () => {
    void write().catch((error) => {
      console.warn("[tb-heartbeat] write failed", {
        code: error instanceof Error ? error.name : "unknown_error"
      });
    });
  };
  guardedWrite();
  const timer = setInterval(guardedWrite, 15_000);
  timer.unref?.();
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await redisConnection.del(TB_ANALYSIS_HEARTBEAT_KEY).catch(() => undefined);
    }
  };
}

/**
 * Separate queue from the query-engine because T&B steps are long (10-30 min
 * end-to-end) and we don't want them to starve query refinement / cleanup
 * jobs. Concurrency=1 keeps Claude rate-limit safe and serializes per worker.
 */
export function startTbAnalysisWorker() {
  return new Worker(
    tbAnalysisQueueName,
    async (job) => {
      try {
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
      } finally {
        const pipelineStepId = (job.data as { pipelineStepId?: unknown })?.pipelineStepId;
        stopTbStrategicExecutionHeartbeat(
          typeof pipelineStepId === "string" ? pipelineStepId : undefined
        );
      }
    },
    {
      connection: redisConnection,
      concurrency: 1
    }
  );
}
