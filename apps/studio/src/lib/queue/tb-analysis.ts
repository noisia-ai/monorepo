import { Queue } from "bullmq";
import Redis from "ioredis";

import { resolveTbAnalysisQueueName } from "@noisia/query-engine";

declare global {
  var noisiaTbQueue: Queue | undefined;
  var noisiaTbRedis: Redis | undefined;
}

export type TbAnalysisRuntimeReadiness = {
  queue_configured: boolean;
  worker_alive: boolean;
  provider_key_configured: boolean;
  recovery_ready: boolean;
};

const TB_ANALYSIS_WORKER_HEARTBEAT_KEY =
  `noisia:worker-alive:${resolveTbAnalysisQueueName()}`;

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
    globalThis.noisiaTbQueue = new Queue(resolveTbAnalysisQueueName(), {
      connection: globalThis.noisiaTbRedis
    });
  }
  return globalThis.noisiaTbQueue;
}

/**
 * Read-only runtime probe for the strategic preflight. The workers process owns
 * the heartbeat and only keeps it alive while both the queue consumer and the
 * durable step-outbox recovery loop are running. Any Redis error therefore
 * fails closed instead of making an unavailable paid pipeline look ready.
 */
export async function loadTbAnalysisRuntimeReadiness(
  env: NodeJS.ProcessEnv = process.env
): Promise<TbAnalysisRuntimeReadiness> {
  const queueConfigured = Boolean(env.REDIS_URL?.trim());
  const providerKeyConfigured = Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (!queueConfigured) {
    return {
      queue_configured: false,
      worker_alive: false,
      provider_key_configured: providerKeyConfigured,
      recovery_ready: false
    };
  }

  let redis: Redis | null = null;
  let ownsConnection = false;
  try {
    if (globalThis.noisiaTbRedis) {
      redis = globalThis.noisiaTbRedis;
    } else {
      redis = new Redis(env.REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        enableOfflineQueue: false,
        tls: env.REDIS_URL!.startsWith("rediss://") ? {} : undefined
      });
      ownsConnection = true;
      await redis.connect();
    }
    const heartbeat = await redis.get(TB_ANALYSIS_WORKER_HEARTBEAT_KEY);
    const heartbeatEpochMs = Number(heartbeat);
    // Worker contract: a positive epoch-millisecond value with Redis TTL. A
    // missing/expired key is the authoritative not-alive state.
    const workerAndRecoveryAlive = Number.isFinite(heartbeatEpochMs)
      && heartbeatEpochMs > 0;
    return {
      queue_configured: true,
      worker_alive: workerAndRecoveryAlive,
      provider_key_configured: providerKeyConfigured,
      recovery_ready: workerAndRecoveryAlive
    };
  } catch {
    return {
      queue_configured: true,
      worker_alive: false,
      provider_key_configured: providerKeyConfigured,
      recovery_ready: false
    };
  } finally {
    if (ownsConnection && redis) {
      redis.disconnect();
    }
  }
}
