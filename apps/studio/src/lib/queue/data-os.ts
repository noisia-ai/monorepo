import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_MATERIALIZE_JOB_NAME,
  type DataOsShadowRunJobData,
  type SignalMaterializeJobDataV1
} from "@noisia/query-engine";

type DataOsStudioJobData = DataOsShadowRunJobData | SignalMaterializeJobDataV1;

declare global {
  var noisiaDataOsQueue: Queue<DataOsStudioJobData> | undefined;
  var noisiaDataOsRedis: Redis | undefined;
}

function getRedisConnection() {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required.");
  }

  return (
    globalThis.noisiaDataOsRedis ??
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
    })
  );
}

export function resolveDataOsQueueName(env: Record<string, string | undefined> = process.env) {
  if (env.NOISIA_DATA_OS_QUEUE_NAME) return env.NOISIA_DATA_OS_QUEUE_NAME;
  const runtimeEnv = env.RAILWAY_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? DATA_OS_QUEUE_NAME : `${DATA_OS_QUEUE_NAME}-local`;
}

export function getDataOsQueue() {
  if (!globalThis.noisiaDataOsRedis) {
    globalThis.noisiaDataOsRedis = getRedisConnection();
  }

  if (!globalThis.noisiaDataOsQueue) {
    globalThis.noisiaDataOsQueue = new Queue<DataOsStudioJobData>(resolveDataOsQueueName(), {
      connection: globalThis.noisiaDataOsRedis
    });
  }

  return globalThis.noisiaDataOsQueue;
}

export function buildDataOsShadowRunJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: 25,
    removeOnFail: 100
  };
}

export async function enqueueDataOsShadowRun(data: DataOsShadowRunJobData) {
  return getDataOsQueue().add(DATA_OS_SHADOW_RUN_JOB_NAME, data, buildDataOsShadowRunJobOptions());
}

export async function enqueueSignalAdHocMaterialization(data: SignalMaterializeJobDataV1, jobId: string) {
  return getDataOsQueue().add(SIGNAL_MATERIALIZE_JOB_NAME, data, buildSignalAdHocMaterializationJobOptions(jobId));
}

export function buildSignalAdHocMaterializationJobOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 604_800, count: 500 }
  };
}
