import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import { createSignalSentioneCsvIngester } from "../sentione-csv-ingest";

const DATABASE_URL=process.env.NOISIA_SIGNAL_WORKSPACE_IMPORT_CLASSIFICATION_URL;
const APPROVED=process.env.NOISIA_SIGNAL_WORKSPACE_IMPORT_CLASSIFICATION_APPROVED==="true";
const directory=resolve(process.cwd(),"migrations");

test("0081 classifies chunks exactly once and recovers failed imports set-wise",{
  skip: !DATABASE_URL || !APPROVED
},async (context)=>{
  assert.ok(DATABASE_URL);requireLocal(DATABASE_URL);
  const client=new pg.Client({ connectionString: DATABASE_URL,ssl: false });
  const ingestionPool=new pg.Pool({ connectionString: DATABASE_URL,ssl: false,max: 8 });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const files=(await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for (const file of files) await client.query(await readFile(join(directory,file),"utf8"));
    const fixture=await seed(client);
    const ingester=createSignalSentioneCsvIngester(ingestionPool);

    const initial=csv([
      ["new-1",long("included one")],["new-2","too short"],["new-3",long("included three")]
    ]);
    const initialBatch=await processingBatch(client,fixture,initial,"initial.csv");
    const first=await ingest(ingester,fixture,initialBatch.id,initial,{ chunkSize: 3 });
    assert.deepEqual(first.stats,{ record_count: 3,included_count: 2,excluded_count: 1,duplicate_count: 0 });
    assert.deepEqual(first.metrics.classification,{
      inserted_this_attempt: 3,resumed_before_attempt: 0,
      existing_from_other_import: 0,duplicate_inside_file: 0
    });
    assert.equal(first.metrics.query_count,4,"one set-based chunk uses four client queries");

    const resumed=await ingest(ingester,fixture,initialBatch.id,initial,{ chunkSize: 1 });
    assert.deepEqual(resumed.stats,first.stats,"same-batch resume preserves dispositions");
    assert.deepEqual(resumed.metrics.classification,{
      inserted_this_attempt: 0,resumed_before_attempt: 3,
      existing_from_other_import: 0,duplicate_inside_file: 0
    });
    await complete(client,initialBatch,first,initial);

    const mixed=csv([
      ["new-1",long("included one")],
      ["mixed-1",long("mixed inserted")],
      ["mixed-2","short"],
      ["mixed-1",long("mixed inserted")]
    ]);
    const mixedBatch=await processingBatch(client,fixture,mixed,"mixed.csv");
    const mixedResult=await ingest(ingester,fixture,mixedBatch.id,mixed,{ chunkSize: 4 });
    assert.deepEqual(mixedResult.stats,{
      record_count: 4,included_count: 1,excluded_count: 1,duplicate_count: 2
    });
    assert.deepEqual(mixedResult.metrics.classification,{
      inserted_this_attempt: 2,resumed_before_attempt: 0,
      existing_from_other_import: 1,duplicate_inside_file: 1
    });
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_mention_import_memberships
      WHERE import_batch_id=$1::uuid
    `,[mixedBatch.id]),3,"intra-file duplicate does not duplicate provenance");

    const duplicateOnly=csv([
      ["new-1",long("included one")],["new-3",long("included three")]
    ]);
    const duplicateBatch=await processingBatch(client,fixture,duplicateOnly,"duplicates.csv");
    const duplicates=await ingest(ingester,fixture,duplicateBatch.id,duplicateOnly,{ chunkSize: 1 });
    assert.deepEqual(duplicates.stats,{
      record_count: 2,included_count: 0,excluded_count: 0,duplicate_count: 2
    });
    assert.equal(duplicates.metrics.classification.existing_from_other_import,2);

    const recoveryCsv=csv([
      ["recover-1",long("recovery included")],
      ["recover-2","tiny recovery unique"],
      ["recover-1",long("recovery included")]
    ]);
    const failed=await processingBatch(client,fixture,recoveryCsv,"recovery.csv");
    const partial=await ingest(ingester,fixture,failed.id,recoveryCsv,{ chunkSize: 2 });
    assert.deepEqual(partial.stats,{
      record_count: 3,included_count: 1,excluded_count: 1,duplicate_count: 1
    });
    await client.query(`SELECT fail_signal_workspace_import_v1(
      $1::uuid,$2,'fixture_abort','{"recoverable":true}'::jsonb,3,$3
    )`,[failed.id,failed.job,byteLength(recoveryCsv)]);

    const idem=sha("recovery-idempotency");
    const request=sha("recovery-request");
    const content=hashContent(recoveryCsv);
    const [left,right]=await Promise.all([
      recoveryWriter(DATABASE_URL!,failed.id,fixture.actor,idem,request,null),
      recoveryWriter(DATABASE_URL!,failed.id,fixture.actor,idem,request,null)
    ]);
    assert.equal(left.import_batch_id,right.import_batch_id,"concurrent retry coalesces");
    assert.equal([left.created,right.created].filter(Boolean).length,1);
    const recovery={ id: left.import_batch_id,job: left.worker_job_id };
    await dispatchAndBegin(client,recovery.id,recovery.job);
    await assert.rejects(client.query(`SELECT * FROM complete_signal_workspace_import_v1(
      $1::uuid,$2,$3,0,0,0,0,$4
    )`,[recovery.id,recovery.job,content,byteLength(recoveryCsv)]),
    (error: unknown)=>(error as { code?: string }).code==="23514");
    assert.equal(await scalar<boolean>(client,`
      SELECT seal_signal_workspace_import_storage_hash_v1($1::uuid,$2,$3,$4)
    `,[recovery.id,recovery.job,content,byteLength(recoveryCsv)]),true);
    const recovered=await ingest(
      ingester,fixture,recovery.id,recoveryCsv,{ chunkSize: 1 },failed.id
    );
    assert.deepEqual(recovered.stats,partial.stats,"recovery preserves predecessor dispositions");
    assert.deepEqual(recovered.metrics.classification,{
      inserted_this_attempt: 0,resumed_before_attempt: 2,
      existing_from_other_import: 0,duplicate_inside_file: 1
    });
    await complete(client,recovery,recovered,recoveryCsv);
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM import_batches
      WHERE supersedes_import_batch_id=$1::uuid AND status='completed'
    `,[failed.id]),1);
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1::uuid
    `,[recovery.id]),1);
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_data_watermarks
      WHERE workspace_id=$1::uuid AND last_import_batch_id=$2::uuid
    `,[fixture.workspace,recovery.id]),1);
    const invalidations=await client.query<{ membership: number;acceptance: number }>(`
      SELECT
        (SELECT count(*)::int FROM signal_data_invalidations invalidation
          WHERE invalidation.workspace_id=$1::uuid
            AND invalidation.reason='operational_population_membership_changed') AS membership,
        (SELECT count(*)::int FROM signal_data_invalidations invalidation
          JOIN import_batches batch ON batch.id=$2::uuid
          WHERE invalidation.workspace_id=$1::uuid
            AND invalidation.reason='workspace_data_accepted'
            AND invalidation.created_at>=batch.created_at) AS acceptance
    `,[fixture.workspace,recovery.id]);
    assert.deepEqual(invalidations.rows,[{ membership: 1,acceptance: 1 }],
      "completion emits each recovery invalidation class exactly once");
    await complete(client,recovery,recovered,recoveryCsv);
    const replayedInvalidations=await client.query<{ membership: number;acceptance: number }>(`
      SELECT
        (SELECT count(*)::int FROM signal_data_invalidations invalidation
          WHERE invalidation.workspace_id=$1::uuid
            AND invalidation.reason='operational_population_membership_changed') AS membership,
        (SELECT count(*)::int FROM signal_data_invalidations invalidation
          JOIN import_batches batch ON batch.id=$2::uuid
          WHERE invalidation.workspace_id=$1::uuid
            AND invalidation.reason='workspace_data_accepted'
            AND invalidation.created_at>=batch.created_at) AS acceptance
    `,[fixture.workspace,recovery.id]);
    assert.deepEqual(replayedInvalidations.rows,invalidations.rows,
      "completion replay does not duplicate invalidations");
    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_mention_import_memberships failed
      LEFT JOIN signal_mention_import_memberships accepted
        ON accepted.mention_id=failed.mention_id
       AND accepted.import_batch_id=$2::uuid
      WHERE failed.import_batch_id=$1::uuid AND accepted.id IS NULL
    `,[failed.id,recovery.id]),0,"every partial root gains accepted provenance");

    for (const chunkSize of [1,2,3,7]) {
      const propertyFixture=await seed(client);
      const propertyBatch=await processingBatch(
        client,propertyFixture,recoveryCsv,`property-${chunkSize}.csv`
      );
      const observed=await ingest(
        ingester,propertyFixture,propertyBatch.id,recoveryCsv,{ chunkSize,insertConcurrency: 3 }
      );
      assert.deepEqual(observed.stats,partial.stats,`chunk size ${chunkSize} is invariant`);
      assert.equal(observed.metrics.query_count<=Math.ceil(2/chunkSize)*4, true);
    }

    const benchmarkFixture=await seed(client);
    const baselineRows=Array.from({ length: 2_500 },(_,index)=>[
      `baseline-${index}`,long(`baseline content ${index}`)
    ]);
    const baselineCsv=csv(baselineRows);
    const baselineBatch=await processingBatch(client,benchmarkFixture,baselineCsv,"baseline.csv");
    await ingest(ingester,benchmarkFixture,baselineBatch.id,baselineCsv,{ chunkSize: 500,insertConcurrency: 6 });
    const newRows=Array.from({ length: 5_000 },(_,index)=>[
      `benchmark-${index}`,long(`benchmark content ${index}`)
    ]);
    const benchmarkCsv=csv([
      ...baselineRows,...newRows,...newRows.slice(0,2_500)
    ]);
    const benchmarkBatch=await processingBatch(
      client,benchmarkFixture,benchmarkCsv,"set-based-conflicts.csv"
    );
    const benchmarkStarted=performance.now();
    const benchmark=await ingest(
      ingester,benchmarkFixture,benchmarkBatch.id,benchmarkCsv,
      { chunkSize: 500,insertConcurrency: 6 }
    );
    const benchmarkMs=performance.now()-benchmarkStarted;
    assert.deepEqual(benchmark.stats,{
      record_count: 10_000,included_count: 5_000,excluded_count: 0,duplicate_count: 5_000
    });
    assert.equal(benchmark.metrics.classification.existing_from_other_import,2_500);
    assert.equal(benchmark.metrics.classification.duplicate_inside_file,2_500);
    assert.equal(benchmark.metrics.query_count,55,
      "conflict-only chunks skip the set insert without a row fallback");
    context.diagnostic(JSON.stringify({
      benchmark: "set-based-real-conflicts-v1",records: 10_000,
      elapsed_ms: Math.round(benchmarkMs),
      records_per_second: Math.round(10_000/(benchmarkMs/1000)),
      client_query_count: benchmark.metrics.query_count,row_fallback_count: 0,
      cross_import_duplicates: 2_500,intra_file_duplicates: 2_500
    }));
    const protectedBefore=await scalar<string>(client,`
      SELECT encode(sha256(convert_to(jsonb_build_object(
        'batches',(SELECT count(*) FROM import_batches),
        'mentions',(SELECT count(*) FROM mentions),
        'memberships',(SELECT count(*) FROM signal_mention_import_memberships),
        'syncs',(SELECT count(*) FROM source_sync_runs),
        'watermarks',(SELECT count(*) FROM signal_data_watermarks)
      )::text,'UTF8')),'hex')
    `,[]);
    await client.query(await readFile(
      join(directory,"0081_signal_workspace_import_recovery_integrity.sql"),"utf8"
    ));
    const protectedAfter=await scalar<string>(client,`
      SELECT encode(sha256(convert_to(jsonb_build_object(
        'batches',(SELECT count(*) FROM import_batches),
        'mentions',(SELECT count(*) FROM mentions),
        'memberships',(SELECT count(*) FROM signal_mention_import_memberships),
        'syncs',(SELECT count(*) FROM source_sync_runs),
        'watermarks',(SELECT count(*) FROM signal_data_watermarks)
      )::text,'UTF8')),'hex')
    `,[]);
    assert.equal(protectedAfter,protectedBefore,"0081 reapply is data-idempotent");
  } finally { await ingestionPool.end();await client.end(); }
});

async function seed(client: pg.Client) {
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
  client: pg.Client,fixture: Awaited<ReturnType<typeof seed>>,content: string,fileName: string
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

async function dispatchAndBegin(client: pg.Client,id: string,job: string) {
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

async function complete(
  client: pg.Client,batch: { id: string;job: string },
  result: Awaited<ReturnType<typeof ingest>>,content: string
) {
  const completed=await client.query<{ accepted: boolean }>(`
    SELECT accepted FROM complete_signal_workspace_import_v1(
      $1::uuid,$2,$3,$4,$5,$6,$7,$8
    )
  `,[batch.id,batch.job,result.fileHash,result.stats.record_count,result.stats.included_count,
    result.stats.excluded_count,result.stats.duplicate_count,byteLength(content)]);
  assert.equal(completed.rows[0]?.accepted,true);
}

async function recoveryWriter(
  url: string,failed: string,actor: string,idem: string,request: string,content: string | null
) {
  const client=new pg.Client({ connectionString: url,ssl: false });await client.connect();
  try {
    const result=await client.query<{
      import_batch_id: string;worker_job_id: string;created: boolean;
    }>(`SELECT import_batch_id::text,worker_job_id,created
      FROM create_signal_workspace_import_storage_recovery_v1(
        $1::uuid,$2::uuid,$3,$4,$5
      )`,[failed,actor,idem,request,content]);
    return result.rows[0]!;
  } finally { await client.end(); }
}

function csv(rows: string[][]) {
  return `id;text;date;platform\n${rows.map((row)=>[
    row[0],`"${row[1]!.replaceAll('"','""')}"`,"2026-08-01T12:00:00Z","web"
  ].join(";")).join("\n")}\n`;
}
function long(value: string) { return `${value} ${"content ".repeat(6)}`; }
function byteLength(value: string) { return Buffer.byteLength(value,"utf8"); }
function hashContent(value: string) { return createHash("sha256").update(value).digest("hex"); }
function sha(value: string) { return `sha256:${hashContent(value)}`; }
async function scalar<T>(client: pg.Client,sql: string,params: unknown[]) {
  const result=await client.query(sql,params);return Object.values(result.rows[0] ?? {})[0] as T;
}
function requireLocal(value: string) {
  const parsed=new URL(value);assert.ok(["127.0.0.1","localhost","::1"].includes(parsed.hostname));
  assert.match(parsed.pathname,/import[_-]0081/u);
}
