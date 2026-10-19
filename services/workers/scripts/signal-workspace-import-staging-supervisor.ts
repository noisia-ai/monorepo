import { createHash } from "node:crypto";
import { chmod,mkdir,readFile,writeFile } from "node:fs/promises";
import { dirname,resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const root=resolve(import.meta.dirname,"../../..");
const target=process.env.NOISIA_REMOTE_DATABASE_TARGET;
const evidencePath=process.argv[2] ? resolve(process.argv[2]) : null;
if (target!=="noisia-staging" || !evidencePath) {
  throw new Error("The workspace import supervisor is restricted to noisia-staging with evidence output.");
}
const studioEnv=parse(await readFile(resolve(root,"apps/studio/.env.local"),"utf8"));
const workerEnv=parse(await readFile(resolve(root,"services/workers/.env"),"utf8"));
for (const [key,value] of Object.entries({ ...workerEnv,...studioEnv })) {
  if (process.env[key]===undefined) process.env[key]=value;
}
process.env.NOISIA_REMOTE_DATABASE_TARGET="noisia-staging";

const databaseUrl=process.env.DATABASE_URL;
const redisUrl=process.env.REDIS_URL;
if (!databaseUrl || !redisUrl || process.env.DATABASE_SSL!=="true") {
  throw new Error("Staging database/queue configuration is unavailable.");
}
const database=new pg.Client({
  connectionString:databaseUrl,ssl:{ rejectUnauthorized:false },
  application_name:"noisia-workspace-import-supervisor"
});
await database.connect();
const databaseState=await database.query<{
  ledger_count:number;pending_outbox:number;active_imports:number;
}>(`
  SELECT
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=79 AND checksum_sha256=$1 AND disposition='applied') AS ledger_count,
    (SELECT count(*)::int FROM signal_workspace_import_outbox
      WHERE status IN ('pending','dispatching','dispatched')) AS pending_outbox,
    (SELECT count(*)::int FROM import_batches
      WHERE ingestion_phase<>'legacy' AND status IN ('queued','processing')) AS active_imports
`,["sha256:dbd1c0d32760666f7d81ea510e271cda2aaf31d29ec38c44250f7337cc242246"]);
await database.end();
const importState=databaseState.rows[0];
if (importState?.ledger_count!==1
    || importState.pending_outbox!==importState.active_imports) {
  throw new Error("Workspace import database precondition failed.");
}

const [{ Queue },{ default: Redis }]=await Promise.all([import("bullmq"),import("ioredis")]);
const queueName=process.env.NOISIA_QUERY_ENGINE_QUEUE_NAME || "query-engine";
const auditConnection=new Redis(redisUrl,{
  maxRetriesPerRequest:null,tls:redisUrl.startsWith("rediss://") ? {} : undefined
});
const auditQueue=new Queue(queueName,{ connection:auditConnection });
const beforeCounts=await auditQueue.getJobCounts(
  "wait","active","delayed","paused","prioritized","failed","completed"
);
const recoverableJobs=await auditQueue.getJobs(
  ["wait","active","delayed","prioritized"],0,Math.max(0,importState.active_imports+1),true
);
if (beforeCounts.paused
    || recoverableJobs.length!==importState.active_imports
    || recoverableJobs.some((job) => job.name!=="ingest_mentions_csv")) {
  throw new Error("The Query Engine queue contains work and will not be consumed.");
}
await auditQueue.close();
await auditConnection.quit();

const queue=await import("../src/queues/query-engine");
const { startSignalWorkspaceImportOutboxDrainer }=await import(
  "../src/workers/signal-workspace-import-outbox"
);
const worker=queue.startQueryEngineWorker();
const heartbeat=queue.startQueryEngineHeartbeat();
const drainer=startSignalWorkspaceImportOutboxDrainer();
let stopping=false;
const startedAt=new Date().toISOString();
await writeEvidence({
  contract_version:"signal-workspace-import-supervisor-v1",state:"ready",
  started_at:startedAt,target:"noisia-staging",
  queue_hash:hash(queueName),before_counts:beforeCounts,
  import_outbox_pending:importState.pending_outbox,active_imports:importState.active_imports,
  recovery_mode:importState.active_imports>0,
  tb_worker_started:false,provider_calls:0
});
process.stdout.write(JSON.stringify({ state:"ready",queue_hash:hash(queueName),provider_calls:0 })+"\n");

const shutdown=async(signal:string)=>{
  if(stopping)return;stopping=true;
  clearInterval(heartbeat);
  await drainer.close();
  await worker.close();
  const finalConnection=new Redis(redisUrl,{
    maxRetriesPerRequest:null,tls:redisUrl.startsWith("rediss://") ? {} : undefined
  });
  const finalQueue=new Queue(queueName,{ connection:finalConnection });
  const finalCounts=await finalQueue.getJobCounts("wait","active","delayed","paused","prioritized");
  await finalQueue.close();await finalConnection.quit();
  await writeEvidence({
    contract_version:"signal-workspace-import-supervisor-v1",state:"stopped",
    started_at:startedAt,stopped_at:new Date().toISOString(),signal,target:"noisia-staging",
    queue_hash:hash(queueName),before_counts:beforeCounts,final_counts:finalCounts,
    orphan_jobs:Object.values(finalCounts).reduce((sum,value)=>sum+value,0),
    tb_worker_started:false,provider_calls:0
  });
  await queue.closeQueryEngineProducer();
  await queue.redisConnection.quit();
  process.exit(Object.values(finalCounts).some(Boolean) ? 1 : 0);
};
process.once("SIGINT",()=>void shutdown("SIGINT"));
process.once("SIGTERM",()=>void shutdown("SIGTERM"));
await new Promise(()=>undefined);

async function writeEvidence(value:unknown){
  await mkdir(dirname(evidencePath!),{recursive:true,mode:0o700});
  await writeFile(evidencePath!,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
  await chmod(evidencePath!,0o600);
}
function hash(value:string){return`sha256:${createHash("sha256").update(value).digest("hex")}`;}
