import "./env/load";

import { isDataOsWorkerEnabled, isEngineRuntimeEnabled } from "@noisia/query-engine";
import { pool } from "./db/client";
import {
  closeQueryEngineProducer,
  redisConnection,
  startQueryEngineHeartbeat,
  startQueryEngineWorker
} from "./queues/query-engine";
import { startDataOsWorker } from "./queues/data-os";
import { closeSignalRefreshScheduler, startSignalRefreshScheduler } from "./queues/signal-refresh";
import { isSignalRefreshSchedulerEnabled } from "./workers/signal-refresh-runtime";
import { startEngineAnalysisWorker } from "./queues/engine-analysis";
import { startTbAnalysisWorker } from "./queues/tb-analysis";

const queryEngineWorker = startQueryEngineWorker();
const tbAnalysisWorker = startTbAnalysisWorker();
const engineAnalysisWorker = isEngineRuntimeEnabled() ? startEngineAnalysisWorker() : null;
const dataOsWorker = isDataOsWorkerEnabled() ? startDataOsWorker() : null;
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

async function shutdown() {
  clearInterval(keepAlive);
  clearInterval(heartbeat);
  await queryEngineWorker.close();
  await tbAnalysisWorker.close();
  await engineAnalysisWorker?.close();
  await dataOsWorker?.close();
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
