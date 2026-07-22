import { Queue } from "bullmq";

import {
  DATA_OS_QUEUE_NAME,
  SIGNAL_REFRESH_CONTRACT_VERSION,
  SIGNAL_REFRESH_TICK_JOB_NAME,
  type SignalRefreshTickJobDataV1
} from "@noisia/query-engine";
import { buildSignalRefreshTickOptions } from "../workers/signal-refresh-runtime";
import { redisConnection } from "./query-engine";

export type SignalDataOsJobData =
  | SignalRefreshTickJobDataV1
  | import("@noisia/query-engine").SignalRefreshRunJobDataV1
  | import("@noisia/query-engine").SignalInvalidationJobDataV1
  | import("@noisia/query-engine").SignalMaterializeJobDataV1;

let signalRefreshQueue: Queue<SignalDataOsJobData> | null = null;

export function getSignalRefreshQueue() {
  signalRefreshQueue ??= new Queue<SignalDataOsJobData>(resolveQueueName(DATA_OS_QUEUE_NAME), {
    connection: redisConnection
  });
  return signalRefreshQueue;
}

export async function startSignalRefreshScheduler() {
  const queue = getSignalRefreshQueue();
  await queue.add(
    SIGNAL_REFRESH_TICK_JOB_NAME,
    { contract_version: SIGNAL_REFRESH_CONTRACT_VERSION },
    buildSignalRefreshTickOptions()
  );
  return queue;
}

export async function closeSignalRefreshScheduler() {
  await signalRefreshQueue?.close();
  signalRefreshQueue = null;
}

function resolveQueueName(baseName: string) {
  if (process.env.NOISIA_DATA_OS_QUEUE_NAME) return process.env.NOISIA_DATA_OS_QUEUE_NAME;
  const runtimeEnv = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? baseName : `${baseName}-local`;
}
