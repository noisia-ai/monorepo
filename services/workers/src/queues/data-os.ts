import { Worker } from "bullmq";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_INVALIDATION_JOB_NAME,
  SIGNAL_REFRESH_RUN_JOB_NAME,
  SIGNAL_REFRESH_TICK_JOB_NAME
} from "@noisia/query-engine";
import { dataOsShadowRunJob } from "../workers/data-os-shadow";
import {
  signalInvalidationJob,
  signalRefreshRunJob,
  signalRefreshTickJob
} from "../workers/signal-refresh";
import { redisConnection } from "./query-engine";

export function startDataOsWorker() {
  return new Worker(
    resolveQueueName(DATA_OS_QUEUE_NAME),
    async (job) => {
      if (job.name === DATA_OS_SHADOW_RUN_JOB_NAME) {
        return dataOsShadowRunJob(job);
      }
      if (job.name === SIGNAL_REFRESH_TICK_JOB_NAME) return signalRefreshTickJob(job);
      if (job.name === SIGNAL_REFRESH_RUN_JOB_NAME) return signalRefreshRunJob(job);
      if (job.name === SIGNAL_INVALIDATION_JOB_NAME) return signalInvalidationJob(job);

      throw new Error(`Unsupported Data OS job: ${job.name}`);
    },
    {
      connection: redisConnection,
      concurrency: readDataOsWorkerConcurrency()
    }
  );
}

function readDataOsWorkerConcurrency() {
  const value = Number(process.env.NOISIA_DATA_OS_WORKER_CONCURRENCY ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(2, Math.floor(value)));
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_DATA_OS_QUEUE_NAME) return process.env.NOISIA_DATA_OS_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
