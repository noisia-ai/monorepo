import { Queue, Worker } from "bullmq";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_INVALIDATION_JOB_NAME,
  SIGNAL_INTERPRETATION_JOB_NAME,
  SIGNAL_MATERIALIZE_JOB_NAME,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME,
  SIGNAL_MONTHLY_INSIGHT_JOB_NAME,
  SIGNAL_REFRESH_RUN_JOB_NAME,
  SIGNAL_REFRESH_TICK_JOB_NAME,
  SIGNAL_TAXONOMY_INSIGHT_JOB_NAME,
  SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME
} from "@noisia/query-engine";
import { dataOsShadowRunJob } from "../workers/data-os-shadow";
import {
  signalInvalidationJob,
  signalRefreshRunJob,
  signalRefreshTickJob
} from "../workers/signal-refresh";
import { signalMaterializationJob } from "../workers/signal-materialization";
import { signalInterpretationJob } from "../workers/signal-interpretation";
import { signalMonthlyInsightJob } from "../workers/signal-monthly-insights";
import { signalTaxonomyInsightJob } from "../workers/signal-taxonomy-insights";
import { assertSignalTaxonomyJobNotRetiredV1 } from "../workers/signal-taxonomy-enrichment-runtime";
import { signalSemanticContextProposalJob } from "../workers/signal-semantic-context-proposal";
import { redisConnection } from "./query-engine";

export { redisConnection };

export const DATA_OS_HEARTBEAT_TTL_SECONDS = 45;
export const dataOsQueueName = resolveQueueName(DATA_OS_QUEUE_NAME);
export const dataOsProducer = new Queue(dataOsQueueName, { connection: redisConnection });

export async function closeDataOsProducer() {
  await dataOsProducer.close();
}

export function startDataOsWorker() {
  return new Worker(
    dataOsQueueName,
    async (job) => {
      assertSignalTaxonomyJobNotRetiredV1(job.name);
      if (job.name === DATA_OS_SHADOW_RUN_JOB_NAME) {
        return dataOsShadowRunJob(job);
      }
      if (job.name === SIGNAL_REFRESH_TICK_JOB_NAME) return signalRefreshTickJob(job);
      if (job.name === SIGNAL_REFRESH_RUN_JOB_NAME) return signalRefreshRunJob(job);
      if (job.name === SIGNAL_INVALIDATION_JOB_NAME) return signalInvalidationJob(job);
      if (job.name === SIGNAL_MATERIALIZE_JOB_NAME) return signalMaterializationJob(job);
      if (job.name === SIGNAL_INTERPRETATION_JOB_NAME) return signalInterpretationJob(job);
      if (job.name === SIGNAL_MONTHLY_INSIGHT_JOB_NAME) return signalMonthlyInsightJob(job);
      if (job.name === SIGNAL_TAXONOMY_INSIGHT_JOB_NAME) return signalTaxonomyInsightJob(job);
      if (job.name === SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME) {
        return signalSemanticContextProposalJob(job);
      }
      throw new Error(`Unsupported Data OS job: ${job.name}`);
    },
    {
      connection: redisConnection,
      concurrency: readDataOsWorkerConcurrency()
    }
  );
}

export function startDataOsHeartbeat() {
  const key = `noisia:worker-alive:${resolveQueueName(DATA_OS_QUEUE_NAME)}`;
  const write = () => {
    redisConnection.set(key, String(Date.now()), "EX", DATA_OS_HEARTBEAT_TTL_SECONDS)
      .catch((error) => console.warn(
        `[data-os-heartbeat] write failed: ${error instanceof Error ? error.name : "unknown_error"}`
      ));
  };
  write();
  return setInterval(write, 15_000);
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
