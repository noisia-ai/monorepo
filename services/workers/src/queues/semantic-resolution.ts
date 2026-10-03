import { Job, Queue, Worker } from "bullmq";

import {
  SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME,
  type SignalSemanticResolutionChildJobDataV2
} from "@noisia/query-engine";
import { signalSemanticReviewProjectionJob } from "../workers/signal-semantic-review-projection";
import { signalSemanticResolutionChildJob } from "../workers/signal-semantic-resolution-child";
import { redisConnection } from "./query-engine";

export const semanticResolutionRedisConnection=redisConnection;
export const signalSemanticResolutionQueueName=resolveQueueName();
export type SemanticReviewProjectionQueueDataV1 = {
  outboxId: string;
  workspaceId: string;
  leaseToken: string;
};

type SemanticResolutionQueueDataV1 =
  | SignalSemanticResolutionChildJobDataV2
  | SemanticReviewProjectionQueueDataV1;

const producer=new Queue<SemanticResolutionQueueDataV1>(
  signalSemanticResolutionQueueName,{connection:semanticResolutionRedisConnection}
);

export async function enqueueSemanticReviewProjectionJobV1(
  data:SemanticReviewProjectionQueueDataV1,jobId:string
){
  const existing=await Job.fromId(producer,jobId);
  if(existing){
    const state=await existing.getState();
    const sameLease=(existing.data as SemanticReviewProjectionQueueDataV1).leaseToken
      ===data.leaseToken;
    if(state==="active"){
      if(sameLease)return{id:existing.id??jobId,reconciled:true};
      throw new Error("Semantic Review projection has a stale active queue lease.");
    }
    if(sameLease&&!["failed","completed"].includes(state)){
      return{id:existing.id??jobId,reconciled:true};
    }
    await existing.remove();
  }
  const job=await producer.add(SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME,data,{
    jobId,attempts:1,
    removeOnComplete:{age:60*60*24*7,count:2_000},
    removeOnFail:{age:60*60*24*30,count:2_000}
  });
  return{id:job.id??jobId,reconciled:false};
}

export async function enqueueSignalSemanticResolutionChild(
  data:SignalSemanticResolutionChildJobDataV2,jobId:string
){
  const existing=await Job.fromId(producer,jobId);
  if(existing){
    const state=await existing.getState();
    if(state!=="failed")return{id:existing.id??jobId,reconciled:true};
    await existing.remove();
  }
  const job=await producer.add(SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME,data,{
    jobId,attempts:5,backoff:{type:"fixed",delay:16*60_000},
    removeOnComplete:{age:60*60*24*14,count:2_000},
    removeOnFail:{age:60*60*24*30,count:2_000}
  });
  return{id:job.id??jobId,reconciled:false};
}

export function startSignalSemanticResolutionWorker(){
  return new Worker<SemanticResolutionQueueDataV1>(
    signalSemanticResolutionQueueName,
    async(job)=>{
      if(job.name===SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME){
        return signalSemanticReviewProjectionJob(
          job as Job<SemanticReviewProjectionQueueDataV1>
        );
      }
      if(job.name===SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME){
        return signalSemanticResolutionChildJob(
          job as Job<SignalSemanticResolutionChildJobDataV2>
        );
      }
      throw new Error(`Unsupported Semantic Resolution job: ${job.name}`);
    },
    {connection:semanticResolutionRedisConnection,concurrency:1}
  );
}

export function startSignalSemanticResolutionHeartbeat(){
  const key=`noisia:worker-alive:${signalSemanticResolutionQueueName}`;
  const write=()=>semanticResolutionRedisConnection.set(key,String(Date.now()),"EX",45)
    .catch(()=>undefined);
  void write();
  return setInterval(()=>void write(),15_000);
}

export async function closeSignalSemanticResolutionProducer(){await producer.close();}

function resolveQueueName(){
  if(process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME){
    return process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME;
  }
  const runtime=process.env.RAILWAY_ENVIRONMENT||process.env.VERCEL_ENV||process.env.NODE_ENV;
  return runtime&&runtime!=="development"
    ? SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
    : `${SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME}-local`;
}
