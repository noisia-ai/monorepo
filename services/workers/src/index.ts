import "./env/load";

import { pool } from "./db/client";
import { redisConnection, startQueryEngineWorker } from "./queues/query-engine";
import { startTbAnalysisWorker } from "./queues/tb-analysis";

const queryEngineWorker = startQueryEngineWorker();
const tbAnalysisWorker = startTbAnalysisWorker();
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

async function shutdown() {
  clearInterval(keepAlive);
  await queryEngineWorker.close();
  await tbAnalysisWorker.close();
  await redisConnection.quit();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Noisia workers running (query-engine + tb-analysis).");
