import { Queue } from "bullmq";
import Redis from "ioredis";

import { TB_ANALYSIS_QUEUE_NAME } from "@noisia/query-engine";

declare global {
  var noisiaTbQueue: Queue | undefined;
  var noisiaTbRedis: Redis | undefined;
}

function getRedisConnection(): Redis {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required.");
  }

  return (
    globalThis.noisiaTbRedis ??
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
    })
  );
}

export function getTbAnalysisQueue(): Queue {
  if (!globalThis.noisiaTbRedis) {
    globalThis.noisiaTbRedis = getRedisConnection();
  }
  if (!globalThis.noisiaTbQueue) {
    globalThis.noisiaTbQueue = new Queue(TB_ANALYSIS_QUEUE_NAME, {
      connection: globalThis.noisiaTbRedis
    });
  }
  return globalThis.noisiaTbQueue;
}
