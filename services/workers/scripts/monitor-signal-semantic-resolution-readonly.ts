import {createHash} from "node:crypto";
import {chmod,mkdir,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";

import {Queue} from "bullmq";
import {
  SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
} from "@noisia/query-engine";
import {config as loadEnv} from "dotenv";
import Redis from "ioredis";
import pg from "pg";

const repositoryRoot=resolve(import.meta.dirname,"../../..");
loadEnv({path:resolve(repositoryRoot,"apps/studio/.env.local"),override:false});

async function main(){
  const workspaceSlug=process.env.NOISIA_SIGNAL_WORKSPACE_SLUG?.trim();
  if(!workspaceSlug || !process.env.DATABASE_URL || !process.env.REDIS_URL){
    throw new Error("workspace_slug_database_and_redis_are_required");
  }
  const client=new pg.Client({connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},
    application_name:"signal-semantic-resolution-readonly-monitor"});
  const redis=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null,
    tls:process.env.REDIS_URL.startsWith("rediss://")?{}:undefined});
  const queueName=resolveQueueName();
  const queue=new Queue(queueName,{connection:redis});
  try{
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot=await client.query(`
      WITH target AS (
        SELECT workspace.id FROM signal_workspaces workspace
        WHERE workspace.slug=$1 AND workspace.status='active'
      ), latest AS (
        SELECT run.* FROM signal_semantic_resolution_runs run JOIN target ON target.id=run.workspace_id
        ORDER BY run.created_at DESC,run.id DESC LIMIT 1
      )
      SELECT latest.id::text AS run_id,latest.status,latest.total_items,
        latest.completed_items,latest.failed_items,latest.estimated_cost_usd::text,
        latest.actual_cost_usd::text,latest.budget_cap_usd::text,
        latest.input_tokens,latest.output_tokens,
        greatest(COALESCE(latest.hard_cap_micro_usd,0)-COALESCE(sum(child.reserved_cost_micro_usd),0),0)::text
          AS hard_cap_headroom_micro_usd,
        latest.updated_at::text AS last_transition_at,latest.error_code,
        COALESCE(jsonb_agg(jsonb_build_object('ordinal',child.ordinal,'status',child.status,
          'items',child.item_count,'completed',child.completed_items,'failed',child.failed_items,
          'provider_status',child.provider_batch_status,'estimated_usd',child.estimated_cost_usd::text,
          'reserved_usd',child.reserved_cost_usd::text,'actual_usd',child.actual_cost_usd::text,
          'input_tokens',child.input_tokens,'output_tokens',child.output_tokens,
          'lease_live',child.lease_expires_at>clock_timestamp(),'error_code',child.error_code)
          ORDER BY child.ordinal) FILTER(WHERE child.id IS NOT NULL),'[]'::jsonb) AS children,
        (SELECT jsonb_object_agg(item.status,item.count) FROM (
          SELECT outbox.status,count(*)::int FROM signal_semantic_resolution_child_outbox outbox
          JOIN latest run ON run.id=outbox.run_id GROUP BY outbox.status
        ) item) AS outbox_counts,
        (SELECT jsonb_object_agg(item.status,item.count) FROM (
          SELECT run_item.status,count(*)::int FROM signal_semantic_resolution_run_items run_item
          JOIN latest run ON run.id=run_item.run_id GROUP BY run_item.status
        ) item) AS item_counts
      FROM latest LEFT JOIN signal_semantic_resolution_child_batches child ON child.run_id=latest.id
      GROUP BY latest.id,latest.status,latest.total_items,latest.completed_items,latest.failed_items,
        latest.estimated_cost_usd,latest.actual_cost_usd,latest.budget_cap_usd,
        latest.input_tokens,latest.output_tokens,
        latest.hard_cap_micro_usd,latest.updated_at,latest.error_code
    `,[workspaceSlug]);
    await client.query("COMMIT");
    const [queueCounts,queueJobs,heartbeat]=await Promise.all([
      queue.getJobCounts("waiting","active","delayed","failed","completed","paused"),
      queue.getJobs(["waiting","active","delayed","failed","completed","paused"],0,5_000,true),
      redis.get(`noisia:worker-alive:${queueName}`)
    ]);
    const row=snapshot.rows[0]??null;
    const sanitized={
      contract_version:"signal-semantic-resolution-monitor-v1",read_only:true,writes_performed:false,
      jobs_enqueued:0,provider_calls:0,workspace_ref:sha256(workspaceSlug),
      run:row?{...row,run_id:sha256(String(row.run_id))}:null,
      bullmq:{
        totals:queueCounts,
        resolution_children:countJobs(queueJobs,SIGNAL_SEMANTIC_RESOLUTION_CHILD_JOB_NAME),
        projection_refreshes:countJobs(queueJobs,SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME)
      },
      worker_heartbeat_alive:isFreshHeartbeat(heartbeat),captured_at:new Date().toISOString()
    };
    const outputPath=resolve(repositoryRoot,process.env.NOISIA_SIGNAL_SEMANTIC_MONITOR_OUTPUT
      ?? ".data/signal-semantic-resolution/monitor.sanitized.json");
    await mkdir(dirname(outputPath),{recursive:true,mode:0o700});
    await writeFile(outputPath,`${JSON.stringify(sanitized,null,2)}\n`,{mode:0o600});
    await chmod(outputPath,0o600);
    process.stdout.write(`${JSON.stringify({ok:true,read_only:true,writes_performed:false,
      provider_calls:0,evidence_sha256:sha256(JSON.stringify(sanitized))})}\n`);
  }finally{
    await queue.close().catch(()=>undefined);redis.disconnect();await client.end().catch(()=>undefined);
  }
}

function resolveQueueName(){
  if(process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME){
    return process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME;
  }
  const runtime=process.env.RAILWAY_ENVIRONMENT||process.env.VERCEL_ENV||process.env.NODE_ENV;
  return runtime&&runtime!=="development"
    ?SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
    :`${SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME}-local`;
}
function isFreshHeartbeat(value:string|null){
  if(!value)return false;const timestamp=Number(value);return Number.isFinite(timestamp)&&Date.now()-timestamp<=45_000;
}
function countJobs(jobs:Array<{name:string;finishedOn?:number;failedReason?:string}>,name:string){
  return jobs.reduce((counts,job)=>{
    if(job.name!==name)return counts;
    const state=job.failedReason?"failed":job.finishedOn?"completed":"non_terminal";
    counts[state]+=1;return counts;
  },{non_terminal:0,completed:0,failed:0});
}
function sha256(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}

void main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:"monitor_failed"}\n`);process.exitCode=1;});
