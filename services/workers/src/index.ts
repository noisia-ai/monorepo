import "./env/load";

import { isDataOsWorkerEnabled, isEngineRuntimeEnabled } from "@noisia/query-engine";
import { pool } from "./db/client";
import {
  closeQueryEngineProducer,
  redisConnection,
  startQueryEngineHeartbeat,
  startQueryEngineWorker
} from "./queues/query-engine";
import { closeDataOsProducer, startDataOsHeartbeat, startDataOsWorker } from "./queues/data-os";
import {
  closeSignalSemanticResolutionProducer,
  startSignalSemanticResolutionHeartbeat,
  startSignalSemanticResolutionWorker
} from "./queues/semantic-resolution";
import { closeSignalRefreshScheduler, startSignalRefreshScheduler } from "./queues/signal-refresh";
import { isSignalRefreshSchedulerEnabled } from "./workers/signal-refresh-runtime";
import { startEngineAnalysisWorker } from "./queues/engine-analysis";
import {
  closeTbAnalysisProducer,
  startTbAnalysisHeartbeat,
  startTbAnalysisWorker
} from "./queues/tb-analysis";
import { startSignalStrategicRunOutboxDrainer } from "./workers/signal-strategic-run-outbox";
import { startSignalStrategicStepOutboxDrainer } from "./workers/signal-strategic-step-outbox";
import { startSignalWorkspaceImportOutboxDrainer } from "./workers/signal-workspace-import-outbox";
import { startSignalSemanticReviewProjectionOutboxDrainer } from "./workers/signal-semantic-review-projection-outbox";
import { startSignalSemanticResolutionChildOutboxDrainer } from "./workers/signal-semantic-resolution-child-outbox";
import { assertUatWorkerStartup } from "./workers/uat-runtime-preflight";
import { startSignalSemanticContextProposalOutboxDrainerV1 } from "./workers/signal-semantic-context-proposal-outbox";
import { startSignalTopicEvaluationOutboxDrainerV1 } from "./workers/signal-topic-evaluation-outbox";

const startupEvidence = await assertUatWorkerStartup({
  database: pool,
  redis: redisConnection
});
console.log("Worker runtime preflight passed.", startupEvidence);

const queryEngineWorker = startQueryEngineWorker();
const tbAnalysisWorker = startTbAnalysisWorker();
const strategicRunOutboxDrainer = startSignalStrategicRunOutboxDrainer();
const strategicStepOutboxDrainer = startSignalStrategicStepOutboxDrainer();
const semanticContextProposalOutboxDrainer = startSignalSemanticContextProposalOutboxDrainerV1();
const topicEvaluationOutboxDrainer = startSignalTopicEvaluationOutboxDrainerV1();
const workspaceImportOutboxDrainer = startSignalWorkspaceImportOutboxDrainer();
const tbHeartbeat = startTbAnalysisHeartbeat();
const engineAnalysisWorker = isEngineRuntimeEnabled() ? startEngineAnalysisWorker() : null;
const dataOsWorker = isDataOsWorkerEnabled() ? startDataOsWorker() : null;
const semanticResolutionWorker = isDataOsWorkerEnabled()
  ? startSignalSemanticResolutionWorker()
  : null;
const semanticReviewProjectionOutboxDrainer = semanticResolutionWorker
  ? startSignalSemanticReviewProjectionOutboxDrainer()
  : null;
const semanticResolutionChildOutboxDrainer = semanticResolutionWorker
  ? startSignalSemanticResolutionChildOutboxDrainer()
  : null;
const semanticResolutionHeartbeat = semanticResolutionWorker
  ? startSignalSemanticResolutionHeartbeat()
  : null;
const dataOsHeartbeat = dataOsWorker ? startDataOsHeartbeat() : null;
const signalRefreshScheduler = dataOsWorker && isSignalRefreshSchedulerEnabled()
  ? startSignalRefreshScheduler().catch((error) => {
      console.error("Signal refresh scheduler failed to start:", error);
      return null;
    })
  : null;
const heartbeat = startQueryEngineHeartbeat();
const keepAlive = setInterval(() => undefined, 60_000);

queryEngineWorker.on("completed", (job) => {
  console.log(`Query Engine job completed: ${job.id}`);
});
queryEngineWorker.on("failed", (job, error) => {
  console.error(`Query Engine job failed: ${job?.id}`, error);
});

tbAnalysisWorker.on("completed", (job) => {
  console.log(`T&B job completed: ${job.name} ${job.id}`);
});
tbAnalysisWorker.on("failed", (job, error) => {
  console.error(`T&B job failed: ${job?.name} ${job?.id}`, error);
});

if (engineAnalysisWorker) {
  engineAnalysisWorker.on("completed", (job) => {
    console.log(`Engine methodology job completed: ${job.name} ${job.id}`);
  });
  engineAnalysisWorker.on("failed", (job, error) => {
    console.error(`Engine methodology job failed: ${job?.name} ${job?.id}`, error);
  });
} else {
  console.log("Engine methodology worker disabled. Set NOISIA_ENGINE_RUNTIME_ENABLED=true to consume beta jobs.");
}

if (dataOsWorker) {
  dataOsWorker.on("completed", (job) => {
    console.log(`Data OS job completed: ${job.name} ${job.id}`);
  });
  dataOsWorker.on("failed", (job, error) => {
    console.error(`Data OS job failed: ${job?.name} ${job?.id}`, error);
  });
} else {
  console.log("Data OS worker disabled. Set NOISIA_DATA_OS_WORKER_ENABLED=true only for approved shadow runs.");
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(keepAlive);
  clearInterval(heartbeat);
  if (dataOsHeartbeat) clearInterval(dataOsHeartbeat);
  if (semanticResolutionHeartbeat) clearInterval(semanticResolutionHeartbeat);
  await tbHeartbeat.close();
  await strategicStepOutboxDrainer.close();
  await semanticContextProposalOutboxDrainer.close();
  await topicEvaluationOutboxDrainer.close();
  await workspaceImportOutboxDrainer.close();
  await semanticReviewProjectionOutboxDrainer?.close();
  await semanticResolutionChildOutboxDrainer?.close();
  await strategicRunOutboxDrainer.close();
  await closeTbAnalysisProducer();
  await queryEngineWorker.close();
  await tbAnalysisWorker.close();
  await engineAnalysisWorker?.close();
  await dataOsWorker?.close();
  await semanticResolutionWorker?.close();
  await closeDataOsProducer();
  await closeSignalSemanticResolutionProducer();
  if (signalRefreshScheduler) await signalRefreshScheduler;
  await closeSignalRefreshScheduler();
  await closeQueryEngineProducer();
  await redisConnection.quit();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(
  `Noisia workers running (query-engine + tb-analysis${engineAnalysisWorker ? " + engine-analysis" : ""}${dataOsWorker ? " + data-os" : ""}).`
);
