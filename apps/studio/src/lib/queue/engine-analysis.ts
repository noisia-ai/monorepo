import { Queue } from "bullmq";
import Redis from "ioredis";

import { ENGINE_QUEUE_NAME } from "@noisia/query-engine";

declare global {
  var noisiaEngineAnalysisQueue: Queue | undefined;
  var noisiaEngineAnalysisRedis: Redis | undefined;
}

function getRedisConnection() {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required.");
  }

  return (
    globalThis.noisiaEngineAnalysisRedis ??
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
    })
  );
}

export function getEngineAnalysisQueue() {
  if (!globalThis.noisiaEngineAnalysisRedis) {
    globalThis.noisiaEngineAnalysisRedis = getRedisConnection();
  }

  if (!globalThis.noisiaEngineAnalysisQueue) {
    globalThis.noisiaEngineAnalysisQueue = new Queue(resolveQueueName(ENGINE_QUEUE_NAME), {
      connection: globalThis.noisiaEngineAnalysisRedis
    });
  }

  return globalThis.noisiaEngineAnalysisQueue;
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_ENGINE_QUEUE_NAME) return process.env.NOISIA_ENGINE_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
