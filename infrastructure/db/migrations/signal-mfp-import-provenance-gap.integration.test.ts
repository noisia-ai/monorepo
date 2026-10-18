import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import type pg from "pg";
import {createSignalSentioneCsvIngester} from "../sentione-csv-ingest";

test("MFP recovers insert-before-provenance interruption without relabeling new roots as duplicates",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:120_000
},async()=>{
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool=await openDatabase(),client=await pool.connect();
 const censusSql=`SELECT jsonb_build_object('organizations',(SELECT count(*) FROM organizations),
 'mentions',(SELECT count(*) FROM mentions),'memberships',(SELECT count(*) FROM signal_mention_import_memberships),
 'batches',(SELECT count(*) FROM import_batches),'sources',(SELECT count(*) FROM data_sources)) census`;
 const before=(await client.query(censusSql)).rows[0].census;
 try{
  await client.query("BEGIN");
  const fixture=await seed(client);
  const source=csv([["included-one",long("included one")],["excluded-two","short"]]);
  const batch=await processingBatch(client,fixture,source,"synthetic-provenance-gap.csv");
  let failedOnce=false;
  const interrupted=createSignalSentioneCsvIngester({query:async(sql:string,params?:unknown[])=>{
   if(sql.includes("record_signal_workspace_import_provenance_set_v1")&&!failedOnce){
    failedOnce=true;throw new Error("synthetic_connection_timeout_before_provenance");
   }
   return client.query(sql,params);
  }} as unknown as Pick<pg.Pool,"query">);
  await assert.rejects(ingest(interrupted,fixture,batch.id,source,{chunkSize:2}),/synthetic_connection_timeout/);
  assert.equal(failedOnce,true);
  assert.equal(await scalar<number>(client,"SELECT count(*)::int FROM mentions WHERE source_file_id=$1",[batch.id]),2);
  assert.equal(await scalar<number>(client,"SELECT count(*)::int FROM signal_mention_import_memberships WHERE import_batch_id=$1",[batch.id]),0);
  const recovered=await ingest(createSignalSentioneCsvIngester(client),fixture,batch.id,source,{chunkSize:2});
  assert.deepEqual(recovered.stats,{record_count:2,included_count:1,excluded_count:1,duplicate_count:0},
   "an interruption must retain original included/excluded dispositions");
  assert.equal(await scalar<number>(client,"SELECT count(*)::int FROM mentions WHERE source_file_id=$1",[batch.id]),2,
   "recovery must not duplicate roots");
  const replay=await ingest(createSignalSentioneCsvIngester(client),fixture,batch.id,source,{chunkSize:1});
  assert.deepEqual(replay.stats,recovered.stats,"replay preserves dispositions");
  const other=await processingBatch(client,fixture,source,"synthetic-separate-import.csv");
  const duplicates=await ingest(createSignalSentioneCsvIngester(client),fixture,other.id,source,{chunkSize:2});
  assert.deepEqual(duplicates.stats,{record_count:2,included_count:0,excluded_count:0,duplicate_count:2},
   "another import must still count existing roots as duplicates");
  const successorSource=csv([["successor-included",long("successor included")],["successor-excluded","unique tiny successor"],
   ["included-one",long("included one")]]);
  const failed=await processingBatch(client,fixture,successorSource,"synthetic-successor-gap.csv");
  failedOnce=false;
  await assert.rejects(ingest(interrupted,fixture,failed.id,successorSource,{chunkSize:3}),/synthetic_connection_timeout/);
  await client.query(`SELECT fail_signal_workspace_import_v1($1::uuid,$2,'fixture_abort',
   '{"recoverable":true}'::jsonb,3,$3)`,[failed.id,failed.job,byteLength(successorSource)]);
  const successor=(await client.query<{import_batch_id:string;worker_job_id:string}>(`SELECT
   import_batch_id::text,worker_job_id FROM create_signal_workspace_import_storage_recovery_v1(
    $1::uuid,$2::uuid,$3,$4,NULL)`,[failed.id,fixture.actor,sha(randomUUID()),sha(randomUUID())])).rows[0]!;
  await dispatchAndBegin(client,successor.import_batch_id,successor.worker_job_id);
  await client.query("SELECT seal_signal_workspace_import_storage_hash_v1($1::uuid,$2,$3,$4)",
   [successor.import_batch_id,successor.worker_job_id,createHash("sha256").update(successorSource).digest("hex"),byteLength(successorSource)]);
  const successorResult=await ingest(createSignalSentioneCsvIngester(client),fixture,successor.import_batch_id,
   successorSource,{chunkSize:3},failed.id);
  assert.deepEqual(successorResult.stats,{record_count:3,included_count:1,excluded_count:1,duplicate_count:1},
   "append-only successor recovers orphan origins and keeps unrelated prior roots duplicated");
  const beforeReplay=(await client.query(`SELECT mention_id::text,ingestion_disposition FROM signal_mention_import_memberships
   WHERE import_batch_id=$1 ORDER BY mention_id`,[successor.import_batch_id])).rows;
  assert.equal(beforeReplay.length,3);
  const successorReplay=await ingest(createSignalSentioneCsvIngester(client),fixture,successor.import_batch_id,
   successorSource,{chunkSize:1},failed.id);
  assert.deepEqual(successorReplay.stats,successorResult.stats);
  assert.deepEqual((await client.query(`SELECT mention_id::text,ingestion_disposition FROM signal_mention_import_memberships
   WHERE import_batch_id=$1 ORDER BY mention_id`,[successor.import_batch_id])).rows,beforeReplay);
  await client.query("ROLLBACK");
  assert.deepEqual((await client.query(censusSql)).rows[0].census,before,"fixture restores exact census");
 }finally{await client.query("ROLLBACK");client.release();await pool.end();}
});

async function seed(client: pg.PoolClient) {
  const organization=randomUUID(),actor=randomUUID(),brand=randomUUID(),source=randomUUID();
  await client.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
    VALUES($1::uuid,$2,'Import fixture','Import fixture','active')`,
  [organization,`import-${organization.slice(0,8)}`]);
  await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1::uuid,$2,'Import operator','noisia_internal','noisia_admin',$3::uuid,'active')`,
  [actor,`${actor.slice(0,8)}@example.test`,organization]);
  await client.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status)
    VALUES($1::uuid,$2::uuid,$3,'Import brand','Import brand',ARRAY['MX']::char(2)[],'active')`,
  [brand,organization,`brand-${brand.slice(0,8)}`]);
  const workspace=await scalar<string>(client,
    "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid",[brand]);
  await client.query(`INSERT INTO data_sources(
    id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,
    governed_scope,governed_entity_type,governed_entity_id,scope_policy_version,
    scope_review_status,scope_approved_by_user_id,scope_approval_source,scope_approved_at,
    status,visibility
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture','csv',
    'Import source','primary_brand','brand',$4::uuid,'workspace-source-scope-v1',
    'approved',$5::uuid,'fixture',now(),'active','internal')`,
  [source,workspace,organization,brand,actor]);
  return { organization,actor,brand,workspace,source };
}

async function processingBatch(
  client: pg.PoolClient,fixture: Awaited<ReturnType<typeof seed>>,content: string,fileName: string
) {
  const id=randomUUID(),job=`signal-import-${id}`,size=byteLength(content);
  await client.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,mention_type,entity_kind,entity_label,source_system,
    source_file_name,product_idempotency_key,product_request_digest,imported_by_user_id,
    status,ingestion_phase,storage_bucket,storage_object_key,upload_protocol,
    expected_file_size_bytes,storage_part_count,storage_part_size_bytes
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'brand','primary_brand','Import brand','fixture',
    $4,$5,$6,$7::uuid,'queued','uploading','private-imports',$8,
    'supabase-multipart-tus',$9,1,50331648)`,[
    id,fixture.workspace,fixture.source,fileName,sha(`key:${id}`),sha(`request:${id}`),
    fixture.actor,`workspace-imports/${fixture.workspace}/${id}/${fileName}`,size
  ]);
  const enqueued=await client.query<{ worker_job_id: string }>(`
    SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)
  `,[id,fixture.actor]);
  assert.equal(enqueued.rows[0]?.worker_job_id,job);
  await dispatchAndBegin(client,id,job);
  return { id,job };
}

async function dispatchAndBegin(client: pg.PoolClient,id: string,job: string) {
  const claim=await client.query<{ outbox_id: string;lease_token: string }>(`
    SELECT outbox_id::text,lease_token::text
    FROM claim_signal_workspace_import_dispatch_v1(100,60,8)
    WHERE import_batch_id=$1::uuid
  `,[id]);
  if (claim.rows[0]) await client.query(
    "SELECT complete_signal_workspace_import_dispatch_v1($1::uuid,$2::uuid)",
    [claim.rows[0].outbox_id,claim.rows[0].lease_token]
  );
  assert.equal(await scalar<boolean>(client,
    "SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)",[id,job]),true);
}

async function ingest(
  ingester: ReturnType<typeof createSignalSentioneCsvIngester>,
  fixture: Awaited<ReturnType<typeof seed>>,batchId: string,content: string,
  tuning: { chunkSize: number;insertConcurrency?: number },supersedes?: string
) {
  return ingester.ingestSentioneCsvStream({
    workspaceId: fixture.workspace,dataSourceId: fixture.source,importBatchId: batchId,
    supersedesImportBatchId: supersedes ?? null,sourceFileName: "fixture.csv",
    stream: new Blob([content]).stream(),tuning
  });
}

function csv(rows:string[][]){return `id;text;date;platform\n${rows.map(row=>[row[0],`"${row[1]!.replaceAll('"','""')}"`,"2026-08-01T12:00:00Z","web"].join(";")).join("\n")}\n`;}
function long(value:string){return `${value} ${"content ".repeat(6)}`;}
function byteLength(value:string){return Buffer.byteLength(value,"utf8");}
function sha(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
async function scalar<T>(client:pg.PoolClient,sql:string,params:unknown[]){const r=await client.query(sql,params);return Object.values(r.rows[0]??{})[0] as T;}
