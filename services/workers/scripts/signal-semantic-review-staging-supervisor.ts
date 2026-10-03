import "../src/env/load";

import { createHash } from "node:crypto";

import { Queue } from "bullmq";

import { pool } from "../src/db/client";
import {
  redisConnection
} from "../src/queues/query-engine";
import {
  SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME
} from "@noisia/query-engine";

import {
  closeSignalSemanticResolutionProducer,
  signalSemanticResolutionQueueName,
  startSignalSemanticResolutionHeartbeat,
  startSignalSemanticResolutionWorker
} from "../src/queues/semantic-resolution";
import { startSignalSemanticResolutionChildOutboxDrainer } from "../src/workers/signal-semantic-resolution-child-outbox";
import { startSignalSemanticReviewProjectionOutboxDrainer } from "../src/workers/signal-semantic-review-projection-outbox";

const expectedPooler="sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const expectedDirect="sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const target=process.env.NOISIA_REMOTE_DATABASE_TARGET;
if(target!=="noisia-staging"
    ||process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_SUPERVISOR_APPROVED!=="true"){
  throw new Error("The Semantic Review supervisor is staging-only and requires explicit approval.");
}
const databaseUrl=process.env.DATABASE_URL?.trim();
const databaseFingerprint=databaseUrl?fingerprint(databaseUrl):null;
if(!databaseUrl||!databaseFingerprint
    ||![expectedPooler,expectedDirect].includes(databaseFingerprint)){
  throw new Error("The Semantic Review supervisor target does not match noisia-staging.");
}
const schema=await pool.query<{ready:boolean}>(`
  SELECT to_regclass('signal_semantic_review_projection_outbox') IS NOT NULL
    AND to_regclass('signal_semantic_resolution_child_outbox') IS NOT NULL AS ready
`);
if(schema.rows[0]?.ready!==true)throw new Error("0082 is not available.");

const semanticQueue=new Queue(signalSemanticResolutionQueueName,{connection:redisConnection});
await removeExpiredProjectionJobs();
const semanticCounts=await semanticQueue.getJobCounts("wait","active","delayed","paused");
const remainingJobs=await semanticQueue.getJobs(["wait","active","delayed","paused"],0,1_000,true);
if(await semanticQueue.isPaused()
    ||remainingJobs.some((job)=>job.name!==SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME)){
  throw new Error("Semantic Resolution queue contains incompatible work.");
}
const activeResolution=await pool.query<{count:number}>(`
  SELECT count(*)::int AS count FROM signal_semantic_resolution_child_outbox
  WHERE status IN ('pending','dispatching','dispatched','failed')
`);
if(Number(activeResolution.rows[0]?.count??0)!==0){
  throw new Error("Semantic Resolution outbox is not empty.");
}

const projectionDrainer=startSignalSemanticReviewProjectionOutboxDrainer();
const semanticWorker=startSignalSemanticResolutionWorker();
const childDrainer=startSignalSemanticResolutionChildOutboxDrainer();
const semanticHeartbeat=startSignalSemanticResolutionHeartbeat();
const keepAlive=setInterval(()=>undefined,60_000);
let shuttingDown=false;

semanticWorker.on("failed",(_job,error)=>console.error(`[semantic-review-supervisor] child failed: ${safe(error)}`));
process.stdout.write(`${JSON.stringify({
  contract_version:"signal-semantic-review-staging-supervisor-v1",
  target:"noisia-staging",database_fingerprint:databaseFingerprint,
  projection_worker:true,projection_recovery:true,isolated_semantic_queue:true,
  resolution_worker:true,resolution_recovery:true,
  semantic_queue:signalSemanticResolutionQueueName,
  provider_calls:0,resolution_jobs_at_start:0,
  projection_jobs_recovered_at_start:Object.values(semanticCounts).reduce((sum,count)=>sum+count,0)
})}\n`);

async function shutdown(){
  if(shuttingDown)return;
  shuttingDown=true;
  clearInterval(keepAlive);clearInterval(semanticHeartbeat);
  await projectionDrainer.close();await childDrainer.close();
  await semanticWorker.close();await semanticQueue.close();
  await closeSignalSemanticResolutionProducer();
  await redisConnection.quit();await pool.end();
  process.exit(0);
}
process.on("SIGINT",()=>void shutdown());
process.on("SIGTERM",()=>void shutdown());

function fingerprint(value:string){
  const parsed=new URL(value);
  return `sha256:${createHash("sha256").update([
    parsed.protocol,parsed.hostname.toLowerCase(),parsed.port||"5432",
    parsed.pathname.replace(/^\//u,""),parsed.username
  ].join("|")).digest("hex")}`;
}
function safe(error:unknown){return error instanceof Error?error.name:"unknown_error";}

async function removeExpiredProjectionJobs(){
  const jobs=await semanticQueue.getJobs(["wait","delayed","paused"],0,1_000,true);
  if(jobs.some((job)=>job.name===SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME)){
    throw new Error("Semantic Resolution child work exists; the supervisor will not consume it.");
  }
  const projections=jobs.filter((job)=>job.name===SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME);
  for(const job of projections){
    const data=job.data as {outboxId?:unknown;workspaceId?:unknown;leaseToken?:unknown};
    if(typeof data.outboxId!=="string"||typeof data.workspaceId!=="string"
        ||typeof data.leaseToken!=="string"){
      throw new Error("Semantic Review projection queue data is invalid.");
    }
    const stale=await pool.query<{stale:boolean}>(`
      SELECT EXISTS(
        SELECT 1 FROM signal_semantic_review_projection_outbox item
        WHERE item.id=$1::uuid AND item.workspace_id=$2::uuid
          AND item.lease_token=$3::uuid
          AND item.status IN ('dispatching','processing')
          AND item.lease_expires_at<=now()
      ) AS stale
    `,[data.outboxId,data.workspaceId,data.leaseToken]);
    if(stale.rows[0]?.stale!==true){
      throw new Error("Semantic Review projection queue contains non-expired work.");
    }
    await job.remove();
  }
}
