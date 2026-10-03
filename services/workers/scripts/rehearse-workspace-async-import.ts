import { createHash,randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod,mkdir,stat,writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const filePath = process.argv[2];
const evidencePath = process.argv[3];
if (!databaseUrl || !filePath || !evidencePath) {
  throw new Error("Usage: rehearse-workspace-async-import <csv> <evidence-json>");
}
const parsed = new URL(databaseUrl);
if (!["127.0.0.1","localhost","::1"].includes(parsed.hostname)) {
  throw new Error("The async import rehearsal is local-only.");
}
const partBytes=48*1024*1024;

const file = await stat(filePath);
const fileHash = await hashFile(filePath);
const server = createServer((request,response) => {
  const partNumber=Number(/\.part-(\d{5})$/u.exec(request.url ?? "")?.[1] ?? "1");
  const start=(partNumber-1)*partBytes;
  const end=Math.min(file.size,start+partBytes)-1;
  if (start>=file.size || end<start) { response.writeHead(404);response.end();return; }
  response.writeHead(200,{
    "content-type": "text/csv","content-length": String(end-start+1)
  });
  createReadStream(filePath,{ start,end }).pipe(response);
});
await new Promise<void>((resolveReady) => server.listen(0,"127.0.0.1",resolveReady));
const address = server.address();
if (!address || typeof address==="string") throw new Error("Local object server failed.");
process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "local-rehearsal-only";

const { ingestMentionsCsvJob } = await import("../src/workers/mentions-csv-ingest");
const client = new pg.Client({ connectionString: databaseUrl,ssl: false });
await client.connect();
const startedAt = Date.now();
try {
  const ids = await seed(client,file.size);
  const failedProgress: number[] = [];
  await ingestMentionsCsvJob(fakeJob(ids.failedBatch,ids.failedJob,filePath,failedProgress,7_500));
  throw new Error("Intentional abort did not fail.");
} catch (error) {
  if (!(error instanceof Error) || !/Intentional workspace import rehearsal abort/u.test(error.message)) {
    throw error;
  }
}

try {
  const fixture = await loadFixture(client);
  const recoveryProgress: number[] = [];
  const recoveryStartedAt = Date.now();
  try {
    await ingestMentionsCsvJob(
      fakeJob(fixture.recovery_batch_id,fixture.recovery_job,filePath,recoveryProgress,
        undefined,5_000)
    );
    throw new Error("Intentional worker crash did not interrupt processing.");
  } catch (error) {
    if (!(error instanceof Error)
        || !/Intentional workspace import worker crash rehearsal/u.test(error.message)) {
      throw error;
    }
  }
  const result = await ingestMentionsCsvJob(
    fakeJob(fixture.recovery_batch_id,fixture.recovery_job,filePath,recoveryProgress)
  ) as { stats?: Record<string,number>;accepted?: boolean };
  const processingMs = Date.now()-recoveryStartedAt;
  await ingestMentionsCsvJob(
    fakeJob(fixture.recovery_batch_id,fixture.recovery_job,filePath,[])
  );
  const observed = await client.query<{
    failed_batches: number;completed_batches: number;records: number;included: number;
    excluded: number;duplicates: number;partial_roots: number;recovered_roots: number;
    watermarks: number;sync_runs: number;invalidations: number;orphan_outbox: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM import_batches batch
        WHERE batch.workspace_id=$1::uuid AND batch.status='failed') AS failed_batches,
      (SELECT count(*)::int FROM import_batches batch
        WHERE batch.workspace_id=$1::uuid AND batch.status='completed') AS completed_batches,
      (SELECT batch.record_count::int FROM import_batches batch
        WHERE batch.id=$3::uuid AND batch.status='completed') AS records,
      (SELECT batch.included_count::int FROM import_batches batch
        WHERE batch.id=$3::uuid AND batch.status='completed') AS included,
      (SELECT batch.excluded_count::int FROM import_batches batch
        WHERE batch.id=$3::uuid AND batch.status='completed') AS excluded,
      (SELECT batch.duplicate_count::int FROM import_batches batch
        WHERE batch.id=$3::uuid AND batch.status='completed') AS duplicates,
      (SELECT count(DISTINCT membership.mention_id)::int
        FROM signal_mention_import_memberships membership
        WHERE membership.import_batch_id=$2::uuid) AS partial_roots,
      (SELECT count(DISTINCT failed.mention_id)::int
        FROM signal_mention_import_memberships failed
        JOIN signal_mention_import_memberships recovered ON recovered.mention_id=failed.mention_id
          AND recovered.workspace_id=failed.workspace_id
        WHERE failed.import_batch_id=$2::uuid
          AND recovered.import_batch_id=$3::uuid) AS recovered_roots,
      (SELECT count(*)::int FROM signal_data_watermarks watermark
        WHERE watermark.workspace_id=$1::uuid
          AND watermark.last_import_batch_id=$3::uuid) AS watermarks,
      (SELECT count(*)::int FROM source_sync_runs run
        WHERE run.import_batch_id=$3::uuid) AS sync_runs,
      (SELECT count(*)::int FROM signal_data_invalidations invalidation
        WHERE invalidation.workspace_id=$1::uuid) AS invalidations,
      (SELECT count(*)::int FROM signal_workspace_import_outbox outbox
        WHERE outbox.workspace_id=$1::uuid
          AND outbox.status NOT IN ('completed','failed','dead_letter')) AS orphan_outbox
  `,[fixture.workspace_id,fixture.failed_batch_id,fixture.recovery_batch_id]);
  const row = observed.rows[0]!;
  if (row.records!==row.included+row.excluded+row.duplicates
      || row.completed_batches!==1 || row.failed_batches!==1
      || row.partial_roots!==row.recovered_roots || row.watermarks!==1
      || row.sync_runs!==1 || row.orphan_outbox!==0 || result.accepted!==true) {
    throw new Error("Async import rehearsal reconciliation failed.");
  }
  const artifact = {
    contract_version: "signal-workspace-async-import-rehearsal-v1",
    ok: true,
    input: { size_bytes: file.size,sha256: fileHash },
    abort: { after_records: 7_500,partial_roots: row.partial_roots },
    recovery: {
      worker_restart_after_records: 5_000,
      records: row.records,included: row.included,excluded: row.excluded,
      duplicates: row.duplicates,recovered_roots: row.recovered_roots,
      processing_ms: processingMs,
      records_per_second: Number((row.records/(processingMs/1000)).toFixed(2)),
      megabytes_per_second: Number(((file.size/1_000_000)/(processingMs/1000)).toFixed(2)),
      estimated_717mb_minutes: Number(((717/(file.size/1_000_000))*(processingMs/60_000)).toFixed(2))
    },
    durable_state: {
      failed_batches: row.failed_batches,completed_batches: row.completed_batches,
      watermarks: row.watermarks,sync_runs: row.sync_runs,
      invalidations: row.invalidations,orphan_outbox: row.orphan_outbox
    },
    total_elapsed_ms: Date.now()-startedAt,
    provider_calls: 0,jobs_remote: 0
  };
  await mkdir(resolve(evidencePath,".."),{ recursive: true });
  await writeFile(evidencePath,`${JSON.stringify(artifact,null,2)}\n`,{ mode: 0o600 });
  await chmod(evidencePath,0o600);
  process.stdout.write(`${JSON.stringify(artifact)}\n`);
} finally {
  await client.end();
  await new Promise<void>((resolveClose,reject)=>server.close((error)=>error ? reject(error) : resolveClose()));
}

async function seed(client: pg.Client,fileSize: number) {
  const organization=randomUUID(),actor=randomUUID(),brand=randomUUID(),source=randomUUID();
  const failedBatch=randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
      VALUES($1::uuid,$2,'Async rehearsal','Async rehearsal','active')`,
    [organization,`async-${organization.slice(0,8)}`]);
    await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES($1::uuid,$2,'Async operator','noisia_internal','noisia_admin',$3::uuid,'active')`,
    [actor,`async-${actor.slice(0,8)}@example.test`,organization]);
    await client.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status)
      VALUES($1::uuid,$2::uuid,$3,'Async brand','Async brand',ARRAY['MX']::char(2)[],'active')`,
    [brand,organization,`async-${brand.slice(0,8)}`]);
    const workspace=(await client.query<{ id: string }>(
      "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid",[brand])).rows[0]!.id;
    await client.query(`INSERT INTO data_sources(
      id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,
      governed_scope,governed_entity_type,governed_entity_id,scope_policy_version,
      scope_review_status,scope_approved_by_user_id,scope_approval_source,scope_approved_at,status,visibility
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','sentione','csv',
      'Async source','primary_brand','brand',$4::uuid,'workspace-source-scope-v1','approved',
      $5::uuid,'local_rehearsal',now(),'active','internal')`,[source,workspace,organization,brand,actor]);
    const failedJob=`signal-import-${failedBatch}`;
    await insertBatch(client,{ id: failedBatch,job: failedJob,supersedes: null,
      workspace,source,actor,fileSize });
    await enqueueDispatch(client,failedBatch,actor);
    await client.query("COMMIT");
    return { failedBatch,failedJob,workspace,source,actor,fileSize };
  } catch (error) { await client.query("ROLLBACK");throw error; }
}

async function loadFixture(client: pg.Client) {
  const failed=(await client.query<{
    id: string;workspace_id: string;data_source_id: string;imported_by_user_id: string;
    expected_file_size_bytes: string;
  }>(`SELECT id::text,workspace_id::text,data_source_id::text,imported_by_user_id::text,
    expected_file_size_bytes::text FROM import_batches WHERE failure_code='intentional_rehearsal_abort'`)).rows[0]!;
  const recovery=(await client.query<{ import_batch_id: string;worker_job_id: string }>(`
    SELECT import_batch_id::text,worker_job_id
    FROM create_signal_workspace_import_storage_recovery_v1(
      $1::uuid,$2::uuid,$3,$4,NULL
    )
  `,[failed.id,failed.imported_by_user_id,hashText(`recovery-key:${failed.id}`),
    hashText(`recovery-request:${failed.id}`)])).rows[0]!;
  await enqueueDispatch(client,recovery.import_batch_id,failed.imported_by_user_id);
  return { workspace_id: failed.workspace_id,failed_batch_id: failed.id,
    recovery_batch_id: recovery.import_batch_id,recovery_job: recovery.worker_job_id };
}

async function insertBatch(client: pg.Client,args: {
  id: string;job: string;supersedes: string | null;workspace: string;source: string;
  actor: string;fileSize: number;
}) {
  await client.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,mention_type,entity_kind,entity_label,source_system,
    source_file_name,product_idempotency_key,product_request_digest,imported_by_user_id,
    status,ingestion_phase,storage_bucket,storage_object_key,upload_protocol,
    expected_file_size_bytes,storage_part_count,storage_part_size_bytes,
    supersedes_import_batch_id
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'brand','primary_brand','Async brand','sentione',
    'workspace-import.csv',$4,$5,$6::uuid,'queued','uploading','local','object.csv',
    'supabase-multipart-tus',$7,$8,$9,$10::uuid)`,[args.id,args.workspace,args.source,
    hashText(`key:${args.id}`),hashText(`request:${args.id}`),args.actor,
    args.fileSize,Math.ceil(args.fileSize/partBytes),partBytes,args.supersedes]);
}

async function enqueueDispatch(client: pg.Client,batchId: string,actorId: string) {
  const enqueued=(await client.query<{ outbox_id: string }>(`
    SELECT outbox_id::text FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)
  `,[batchId,actorId])).rows[0]!;
  const claimed=(await client.query<{ outbox_id: string;lease_token: string }>(`
    SELECT outbox_id::text,lease_token::text FROM claim_signal_workspace_import_dispatch_v1(1,60,8)
  `)).rows[0]!;
  if (claimed.outbox_id!==enqueued.outbox_id) throw new Error("Unexpected import outbox claim.");
  await client.query("SELECT complete_signal_workspace_import_dispatch_v1($1::uuid,$2::uuid)",
    [claimed.outbox_id,claimed.lease_token]);
}

function fakeJob(
  batchId: string,jobId: string,fileName: string,progress: number[],
  abort?: number,crash?: number
) {
  return {
    id: jobId,
    data: { importBatchId: batchId,sourceFileName: fileName,
      storageBucket: "local",storageObjectKey: "object.csv",
      storagePartCount: Math.ceil(file.size/partBytes),storagePartSizeBytes: partBytes,
      testFailAfterRecords: abort,testCrashAfterRecords: crash },
    updateProgress: async (value: number | object) => {
      if (typeof value==="number") progress.push(value);
    }
  } as never;
}

async function hashFile(path: string) {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function hashText(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
