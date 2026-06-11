import { Worker } from "bullmq";

import { ENGINE_QUEUE_NAME } from "@noisia/query-engine";
import { engineOrchestratorJob } from "../workers/engine-orchestrator";
import { engineCodeJob } from "../workers/engine-step-code";
import { enginePreflightJob } from "../workers/engine-step-preflight";
import { engineQualityGatesJob } from "../workers/engine-step-quality-gates";
import { engineRetrieveJob } from "../workers/engine-step-retrieve";
import { engineScoreJob } from "../workers/engine-step-score";
import { engineSynthesizeJob } from "../workers/engine-step-synthesize";
import { redisConnection } from "./query-engine";

export function startEngineAnalysisWorker() {
  return new Worker(
    resolveQueueName(ENGINE_QUEUE_NAME),
    async (job) => {
      switch (job.name) {
        case "engine_run_analysis":
          return engineOrchestratorJob(job);
        case "engine_step_preflight":
          return enginePreflightJob(job);
        case "engine_step_retrieve":
          return engineRetrieveJob(job);
        case "engine_step_code":
          return engineCodeJob(job);
        case "engine_step_score":
          return engineScoreJob(job);
        case "engine_step_synthesize":
          return engineSynthesizeJob(job);
        case "engine_quality_gates":
          return engineQualityGatesJob(job);
        default:
          throw new Error(`Unsupported engine-analysis job: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: readEngineWorkerConcurrency(),
      ...readEngineWorkerRateLimiter()
    }
  );
}

function readEngineWorkerConcurrency() {
  const value = Number(process.env.NOISIA_ENGINE_WORKER_CONCURRENCY ?? 2);
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(6, Math.floor(value)));
}

function readEngineWorkerRateLimiter() {
  const max = Number(process.env.NOISIA_ENGINE_RATE_LIMIT_MAX);
  const duration = Number(process.env.NOISIA_ENGINE_RATE_LIMIT_DURATION_MS);
  if (!Number.isFinite(max) || !Number.isFinite(duration) || max <= 0 || duration <= 0) {
    return {};
  }
  return {
    limiter: {
      max: Math.floor(max),
      duration: Math.floor(duration)
    }
  };
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_ENGINE_QUEUE_NAME) return process.env.NOISIA_ENGINE_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
