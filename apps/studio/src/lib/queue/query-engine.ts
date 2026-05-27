import { Queue } from "bullmq";
import Redis from "ioredis";

import { QUERY_ENGINE_QUEUE_NAME } from "@noisia/query-engine";

declare global {
  var noisiaQueryEngineQueue: Queue | undefined;
  var noisiaQueryEngineRedis: Redis | undefined;
}

function getRedisConnection() {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required.");
  }

  return (
    globalThis.noisiaQueryEngineRedis ??
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
    })
  );
}

// TODO mejora-futura: separar cola por ambiente y tenant cuando existan staging
// y produccion activos al mismo tiempo en Railway.
export function getQueryEngineQueue() {
  if (!globalThis.noisiaQueryEngineRedis) {
    globalThis.noisiaQueryEngineRedis = getRedisConnection();
  }

  if (!globalThis.noisiaQueryEngineQueue) {
    globalThis.noisiaQueryEngineQueue = new Queue(QUERY_ENGINE_QUEUE_NAME, {
      connection: globalThis.noisiaQueryEngineRedis
    });
  }

  return globalThis.noisiaQueryEngineQueue;
}
