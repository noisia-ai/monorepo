import { Worker } from "bullmq";
import Redis from "ioredis";

import { QUERY_ENGINE_QUEUE_NAME } from "@noisia/query-engine";
import { applyQueryAdjustmentsJob } from "../workers/apply-query-adjustments";
import { assessCorpusJob } from "../workers/assess-corpus";
import { cleanupApplyJob } from "../workers/cleanup-apply";
import { cleanupPreviewJob } from "../workers/cleanup-preview";
import { composeInitialQueryJob } from "../workers/compose-initial-query";
import { evaluateSampleJob } from "../workers/evaluate-sample";
import { processKnowledgeSourcesJob } from "../workers/process-knowledge-sources";
import { semanticEmbeddingsJob } from "../workers/semantic-embeddings";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required.");
}

export const redisConnection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
});

export function startQueryEngineWorker() {
  // TODO mejora-futura: mover concurrency a env por ambiente y agregar
  // BullMQ dashboard cuando Railway quede conectado.
  return new Worker(
    resolveQueueName(QUERY_ENGINE_QUEUE_NAME),
    async (job) => {
      if (job.name === "compose_initial_query") {
        return composeInitialQueryJob(job);
      }

      if (job.name === "evaluate_sample") {
        return evaluateSampleJob(job);
      }

      if (job.name === "apply_query_adjustments") {
        return applyQueryAdjustmentsJob(job);
      }

      if (job.name === "assess_corpus") {
        return assessCorpusJob(job);
      }

      if (job.name === "cleanup_preview") {
        return cleanupPreviewJob(job);
      }

      if (job.name === "cleanup_apply") {
        return cleanupApplyJob(job);
      }

      if (job.name === "process_knowledge_sources") {
        return processKnowledgeSourcesJob(job);
      }

      if (job.name === "embed_corpus_semantics") {
        return semanticEmbeddingsJob(job);
      }

      throw new Error(`Unsupported query-engine job: ${job.name}`);
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_QUERY_ENGINE_QUEUE_NAME) return process.env.NOISIA_QUERY_ENGINE_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
