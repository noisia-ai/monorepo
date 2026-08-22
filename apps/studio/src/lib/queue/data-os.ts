import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_MONTHLY_INSIGHT_JOB_NAME,
  SIGNAL_MATERIALIZE_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME,
  SIGNAL_TAXONOMY_INSIGHT_JOB_NAME,
  type DataOsShadowRunJobData,
  type SignalMonthlyInsightJobDataV1,
  type SignalMaterializeJobDataV1,
  type SignalTaxonomyInsightJobDataV1
} from "@noisia/query-engine";

type DataOsStudioJobData =
  | DataOsShadowRunJobData
  | SignalMaterializeJobDataV1
  | SignalMonthlyInsightJobDataV1
  | SignalTaxonomyInsightJobDataV1;

declare global {
  var noisiaDataOsQueue: Queue<DataOsStudioJobData> | undefined;
  var noisiaSemanticResolutionQueue: Queue | undefined;
  var noisiaDataOsRedis: Redis | undefined;
}

function getRedisConnection() {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required.");
  }

  return (
    globalThis.noisiaDataOsRedis ??
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined
    })
  );
}

export function isDataOsQueueConfigured(
  env: Record<string, string | undefined> = process.env
) {
  return Boolean(env.REDIS_URL?.trim());
}

export function resolveDataOsQueueName(env: Record<string, string | undefined> = process.env) {
  if (env.NOISIA_DATA_OS_QUEUE_NAME) return env.NOISIA_DATA_OS_QUEUE_NAME;
  const runtimeEnv = env.RAILWAY_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV;
  return runtimeEnv && runtimeEnv !== "development" ? DATA_OS_QUEUE_NAME : `${DATA_OS_QUEUE_NAME}-local`;
}

export function getDataOsQueue() {
  if (!globalThis.noisiaDataOsRedis) {
    globalThis.noisiaDataOsRedis = getRedisConnection();
  }

  if (!globalThis.noisiaDataOsQueue) {
    globalThis.noisiaDataOsQueue = new Queue<DataOsStudioJobData>(resolveDataOsQueueName(), {
      connection: globalThis.noisiaDataOsRedis
    });
  }

  return globalThis.noisiaDataOsQueue;
}

export function buildDataOsShadowRunJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: 25,
    removeOnFail: 100
  };
}

export async function enqueueDataOsShadowRun(data: DataOsShadowRunJobData) {
  return getDataOsQueue().add(DATA_OS_SHADOW_RUN_JOB_NAME, data, buildDataOsShadowRunJobOptions());
}

export async function enqueueSignalAdHocMaterialization(data: SignalMaterializeJobDataV1, jobId: string) {
  return getDataOsQueue().add(SIGNAL_MATERIALIZE_JOB_NAME, data, buildSignalAdHocMaterializationJobOptions(jobId));
}

export async function enqueueSignalMonthlyInsights(
  data: SignalMonthlyInsightJobDataV1,
  jobId: string
) {
  return getDataOsQueue().add(
    SIGNAL_MONTHLY_INSIGHT_JOB_NAME,
    data,
    {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 604_800, count: 200 }
    }
  );
}

export async function enqueueSignalTaxonomyInsights(
  data: SignalTaxonomyInsightJobDataV1,
  jobId: string
) {
  return getDataOsQueue().add(
    SIGNAL_TAXONOMY_INSIGHT_JOB_NAME,
    data,
    {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 604_800, count: 200 }
    }
  );
}

export async function loadDataOsRuntimeReadiness() {
  if (!isDataOsQueueConfigured()) {
    return {
      queue_configured: false,
      worker_alive: false,
      heartbeat_at: null as string | null
    };
  }
  try {
    if (!globalThis.noisiaDataOsRedis) globalThis.noisiaDataOsRedis = getRedisConnection();
    const value = await globalThis.noisiaDataOsRedis.get(
      `noisia:worker-alive:${resolveDataOsQueueName()}`
    );
    const epochMs = value ? Number(value) : Number.NaN;
    const alive = Number.isFinite(epochMs) && epochMs > Date.now() - 60_000;
    return {
      queue_configured: true,
      worker_alive: alive,
      heartbeat_at: alive ? new Date(epochMs).toISOString() : null
    };
  } catch {
    return {
      queue_configured: true,
      worker_alive: false,
      heartbeat_at: null as string | null
    };
  }
}

export async function loadSemanticContextProposalRuntimeReadiness(){
  if(!isDataOsQueueConfigured())return{queue_configured:false,worker_alive:false,recovery_alive:false};
  try{
    if(!globalThis.noisiaDataOsRedis)globalThis.noisiaDataOsRedis=getRedisConnection();
    const queueName=resolveDataOsQueueName();
    const[workerValue,recoveryValue]=await Promise.all([
      globalThis.noisiaDataOsRedis.get(`noisia:worker-alive:${queueName}`),
      globalThis.noisiaDataOsRedis.get(`noisia:drainer-alive:${queueName}:semantic-context-proposal-outbox`)
    ]);
    const alive=(value:string|null)=>{const epoch=value?Number(value):Number.NaN;
      return Number.isFinite(epoch)&&epoch>Date.now()-60_000;};
    return{queue_configured:true,worker_alive:alive(workerValue),recovery_alive:alive(recoveryValue)};
  }catch{return{queue_configured:true,worker_alive:false,recovery_alive:false};}
}

export function resolveSemanticResolutionQueueName(
  env:Record<string,string|undefined>=process.env
){
  if(env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME){
    return env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME;
  }
  const runtimeEnv=env.RAILWAY_ENVIRONMENT||env.VERCEL_ENV||env.NODE_ENV;
  return runtimeEnv&&runtimeEnv!=="development"
    ? SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
    : `${SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME}-local`;
}

export async function loadSemanticResolutionRuntimeReadiness(){
  if(!isDataOsQueueConfigured())return{
    queue_configured:false,queue_paused:true,worker_alive:false,recovery_alive:false,
    heartbeat_at:null as string|null,recovery_heartbeat_at:null as string|null
  };
  try{
    if(!globalThis.noisiaDataOsRedis)globalThis.noisiaDataOsRedis=getRedisConnection();
    const queueName=resolveSemanticResolutionQueueName();
    globalThis.noisiaSemanticResolutionQueue??=new Queue(queueName,{
      connection:globalThis.noisiaDataOsRedis
    });
    const [workerValue,recoveryValue,queuePaused]=await Promise.all([
      globalThis.noisiaDataOsRedis.get(`noisia:worker-alive:${queueName}`),
      globalThis.noisiaDataOsRedis.get(`noisia:drainer-alive:${queueName}:child-outbox`),
      globalThis.noisiaSemanticResolutionQueue.isPaused()
    ]);
    const alive=(value:string|null)=>{
      const epoch=value?Number(value):Number.NaN;
      return Number.isFinite(epoch)&&epoch>Date.now()-60_000?epoch:null;
    };
    const workerEpoch=alive(workerValue);
    const recoveryEpoch=alive(recoveryValue);
    return{
      queue_configured:true,queue_paused:queuePaused,worker_alive:workerEpoch!==null,
      recovery_alive:recoveryEpoch!==null,
      heartbeat_at:workerEpoch===null?null:new Date(workerEpoch).toISOString(),
      recovery_heartbeat_at:recoveryEpoch===null?null:new Date(recoveryEpoch).toISOString()
    };
  }catch{
    return{
      queue_configured:true,queue_paused:true,worker_alive:false,recovery_alive:false,
      heartbeat_at:null as string|null,recovery_heartbeat_at:null as string|null
    };
  }
}

export function buildSignalAdHocMaterializationJobOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 604_800, count: 500 }
  };
}
