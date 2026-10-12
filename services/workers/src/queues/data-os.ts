import { SIGNAL_CONCEPT_MEMBERSHIP_JOB_V1, signalConceptMembershipJobV1, startConceptMembershipDrainerV1 } from "../workers/signal-concept-membership-batch";
import { startHybridMembershipDrainerV1 } from "../workers/signal-hybrid-membership";
import { SIGNAL_MENTION_FACETS_JOB_V1, signalMentionFacetsJobV1, startMentionFacetsDrainerV1 } from '../workers/signal-mention-facets-batch';
import { SIGNAL_MENTION_FACETS_JEV_JOB_V1, signalMentionFacetsJevJobV1, startMentionFacetsJevDrainerV1 } from '../workers/signal-mention-facets-jev';
import { SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1 } from '@noisia/db';
import { signalWorkspaceIncrementalEditorialEvidenceJobV1 } from '../workers/signal-workspace-incremental-editorial-evidence-job';
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
import { SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1 } from "@noisia/db";
import { signalWorkspaceEngineProgressJobV1 } from "../workers/signal-workspace-engine-progress";
import { SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_NAME, signalWorkspaceTopicProjectionJobV1 } from "../workers/signal-workspace-topic-projection";
import { SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME, signalWorkspaceIncrementalDerivationJobV1 } from "../workers/signal-workspace-incremental-derivation";
import { SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME, signalWorkspaceIncrementalProjectionJobV1 } from "../workers/signal-workspace-incremental-projection";
import { SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME, signalWorkspaceIncrementalEditorialJobV1 } from "../workers/signal-workspace-incremental-editorial-job";
import { SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1,
  signalTopicConsolidationNumericJobV1 } from "../workers/signal-topic-consolidation-queue";
import { SIGNAL_TOPIC_EDITORIAL_JOB_V1, signalTopicEditorialJobV1 } from "../workers/signal-topic-editorial-queue";
import { SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2, SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2,
  SIGNAL_TOPIC_EDITORIAL_BATCH_START_JOB_V2, signalTopicEditorialBatchJobV2,
  signalTopicEditorialBatchPreparationJobV2, signalTopicEditorialBatchStartJobV2 } from "../workers/signal-topic-editorial-batch-queue-v2";
import { SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2, SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2,
  signalTopicEditorialGlobalStageJobV2, signalTopicEditorialGlobalAdvanceJobV2
} from "../workers/signal-topic-editorial-global-stage-queue-v2";
import { signalWorkspaceInterestDecisionBatchJobV1,
  startSignalWorkspaceInterestDecisionBatchDrainerV1 } from "../workers/signal-workspace-interest-decision-runtime-v1";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1 } from "../workers/signal-workspace-interest-decision-queue-v1";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V1,
  signalWorkspaceInterestDecisionPreparationJobV1,
  startSignalWorkspaceInterestDecisionPreparationDrainerV1 } from "../workers/signal-workspace-interest-decision-preparation-runtime-v1";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1,
  signalWorkspaceInterestDecisionMaterializationJobV1,
  startSignalWorkspaceInterestDecisionMaterializationDrainerV1 } from "../workers/signal-workspace-interest-decision-materialization-runtime-v1";
import { signalWorkspaceInterestDecisionBatchJobV2,
  startSignalWorkspaceInterestDecisionBatchDrainerV2 } from "../workers/signal-workspace-interest-decision-provider-runtime-v2";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V2 } from "../workers/signal-workspace-interest-decision-queue-v2";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V2,
  signalWorkspaceInterestDecisionPreparationJobV2,
  startSignalWorkspaceInterestDecisionPreparationDrainerV2 } from "../workers/signal-workspace-interest-decision-preparation-runtime-v2";
import { SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V2,
  signalWorkspaceInterestDecisionMaterializationJobV2,
  startSignalWorkspaceInterestDecisionMaterializationDrainerV2 } from "../workers/signal-workspace-interest-decision-materialization-runtime-v2";
import { startSignalWorkspaceInterestDecisionRetryDrainerV2 } from "../workers/signal-workspace-interest-decision-retry-runtime-v2";

export { redisConnection };

export const DATA_OS_HEARTBEAT_TTL_SECONDS = 45;
export const dataOsQueueName = resolveQueueName(DATA_OS_QUEUE_NAME);
export const dataOsProducer = new Queue(dataOsQueueName, { connection: redisConnection });

export async function closeDataOsProducer() {
  await dataOsProducer.close();
}

export function startDataOsWorker() {
  const worker = new Worker(
    dataOsQueueName,
    async (job) => {
      assertSignalTaxonomyJobNotRetiredV1(job.name);
      if (job.name === SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME) return signalWorkspaceCorpusPreparationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME) return signalWorkspaceEmbeddingsJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME) return signalWorkspaceTopicComputationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_ENGINE_JOB_V1) return signalWorkspaceEngineJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1) return signalWorkspaceEngineProgressJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_NAME) return signalWorkspaceTopicProjectionJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME) return signalWorkspaceIncrementalDerivationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME) return signalWorkspaceIncrementalProjectionJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1) return signalWorkspaceIncrementalEditorialEvidenceJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME) return signalWorkspaceIncrementalEditorialJobV1(job);
      if (job.name === SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1) return signalTopicConsolidationNumericJobV1(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_JOB_V1) return signalTopicEditorialJobV1(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2) return signalTopicEditorialBatchJobV2(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2) return signalTopicEditorialBatchPreparationJobV2(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_BATCH_START_JOB_V2) return signalTopicEditorialBatchStartJobV2(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2) return signalTopicEditorialGlobalStageJobV2(job);
      if (job.name === SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2) return signalTopicEditorialGlobalAdvanceJobV2(job);
      if (job.name === SIGNAL_CONCEPT_MEMBERSHIP_JOB_V1) return signalConceptMembershipJobV1(job);
      if (job.name === SIGNAL_MENTION_FACETS_JOB_V1) return signalMentionFacetsJobV1(job);
      if (job.name === SIGNAL_MENTION_FACETS_JEV_JOB_V1) return signalMentionFacetsJevJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1) return signalWorkspaceInterestDecisionBatchJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V1) return signalWorkspaceInterestDecisionPreparationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1) return signalWorkspaceInterestDecisionMaterializationJobV1(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V2) return signalWorkspaceInterestDecisionBatchJobV2(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V2) return signalWorkspaceInterestDecisionPreparationJobV2(job);
      if (job.name === SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V2) return signalWorkspaceInterestDecisionMaterializationJobV2(job);
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
      concurrency: readDataOsWorkerConcurrency(),
      // Global editorial advancement reads the entire sealed corpus before it
      // materializes a revision. A 30 s lease expires during that read on UAT,
      // so BullMQ stalls and repeats the same work before it can commit.
      lockDuration: 300_000
    }
  );
  // Feature flag defaults off. The drainer only wakes batches after SQL0211
  // has been installed; PostgreSQL still owns each lease and paid reservation.
  const facetsDrainer = startMentionFacetsDrainerV1();
  const facetsJevDrainer = startMentionFacetsJevDrainerV1();
  const membershipDrainer = startConceptMembershipDrainerV1();
  const hybridMembershipDrainer = startHybridMembershipDrainerV1();
  const batchDrainer = startSignalWorkspaceInterestDecisionBatchDrainerV1();
  const preparationDrainer = startSignalWorkspaceInterestDecisionPreparationDrainerV1();
  const materializationDrainer = startSignalWorkspaceInterestDecisionMaterializationDrainerV1();
  const batchDrainerV2 = startSignalWorkspaceInterestDecisionBatchDrainerV2();
  const preparationDrainerV2 = startSignalWorkspaceInterestDecisionPreparationDrainerV2();
  const materializationDrainerV2 = startSignalWorkspaceInterestDecisionMaterializationDrainerV2();
  const retryDrainerV2 = startSignalWorkspaceInterestDecisionRetryDrainerV2();
  worker.on("closed", () => {
    void facetsDrainer.close();
    void facetsJevDrainer.close();
    void membershipDrainer.close();
    void hybridMembershipDrainer.close();
    void batchDrainer.close();
    void preparationDrainer.close();
    void materializationDrainer.close();
    void batchDrainerV2.close();
    void preparationDrainerV2.close();
    void materializationDrainerV2.close();
    void retryDrainerV2.close();
  });
  return worker;
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
