import { Queue, Worker } from "bullmq";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_INVALIDATION_JOB_NAME,
  SIGNAL_INTERPRETATION_JOB_NAME,
  SIGNAL_MATERIALIZE_JOB_NAME,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME,
  SIGNAL_TOPIC_EVALUATION_JOB_NAME,
  SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME,
  SIGNAL_WORKSPACE_ENGINE_JOB_V1,
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
import { signalTopicEvaluationJob } from "../workers/signal-topic-evaluation";
import { signalTopicClassificationJob } from "../workers/signal-topic-classification";
import { SIGNAL_TOPIC_RULE_SUGGESTION_JOB_NAME, signalTopicRuleSuggestionJob } from "../workers/signal-topic-rule-suggestion";
import { redisConnection } from "./query-engine";
import { SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME, signalWorkspaceCorpusPreparationJobV1 } from "../workers/signal-workspace-corpus-preparation";
import { SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME, signalWorkspaceEmbeddingsJobV1 } from "../workers/signal-workspace-embeddings";
import { SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME, signalWorkspaceTopicComputationJobV1 } from "../workers/signal-workspace-topic-computation";
import { signalWorkspaceEngineJobV1 } from "../workers/signal-workspace-engine";

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
      if (job.name === SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME) return signalWorkspaceCorpusPreparationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME) return signalWorkspaceEmbeddingsJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME) return signalWorkspaceTopicComputationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_ENGINE_JOB_V1) return signalWorkspaceEngineJobV1(job);
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
      if (job.name === SIGNAL_TOPIC_RULE_SUGGESTION_JOB_NAME) return signalTopicRuleSuggestionJob(job);
      if (job.name === SIGNAL_TOPIC_EVALUATION_JOB_NAME) return signalTopicEvaluationJob(job);
      if (job.name === SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME) return signalTopicClassificationJob(job);
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
