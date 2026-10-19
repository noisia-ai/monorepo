import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import test from "node:test";

import pg from "pg";

const URL = process.env.NOISIA_SIGNAL_WORKSPACE_ASYNC_IMPORT_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_WORKSPACE_ASYNC_IMPORT_INTEGRATION_APPROVED==="true";
const directory = resolve(process.cwd(),"migrations");
const id = {
  organization: "79000000-0000-4000-8000-000000000001",
  actor: "79000000-0000-4000-8000-000000000002",
  brand: "79000000-0000-4000-8000-000000000003",
  source: "79000000-0000-4000-8000-000000000004",
  failedBatch: "79000000-0000-4000-8000-000000000005",
  recoveryBatch: "79000000-0000-4000-8000-000000000006",
  partialRoot: "79000000-0000-4000-8000-000000000007",
  newRoot: "79000000-0000-4000-8000-000000000008"
};

test("0079/0080 quarantine partial imports and recover one chunked replacement",{
  skip: !URL || !APPROVED
},async () => {
  assert.ok(URL);requireLocal(URL);
  const client = new pg.Client({ connectionString: URL,ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const files = (await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for (const file of files.filter((file)=>file<"0080_")) {
      await client.query(await readFile(join(directory,file),"utf8"));
    }
    await client.query(await readFile(join(directory,"0079_signal_workspace_async_imports.sql"),"utf8"));
    const chunked = await readFile(
      join(directory,"0080_signal_workspace_chunked_import_storage.sql"),"utf8"
    );
    await client.query(chunked);
    await client.query(chunked);
    await seedAuthority(client);
    const workspaceId = await scalar<string>(client,
      "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid",[id.brand]);

    await client.query(`
      INSERT INTO data_sources(
        id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,
        governed_scope,governed_entity_type,governed_entity_id,scope_policy_version,
        scope_review_status,scope_approved_by_user_id,scope_approval_source,scope_approved_at,
        status,visibility
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture','csv',
        'Async source','primary_brand','brand',$4::uuid,'workspace-source-scope-v1',
        'approved',$5::uuid,'fixture',now(),'active','internal')
    `,[id.source,workspaceId,id.organization,id.brand,id.actor]);
    await client.query(`
      INSERT INTO import_batches(
        id,workspace_id,data_source_id,mention_type,entity_kind,entity_label,
        source_system,source_file_name,imported_by_user_id,status,ingestion_phase,
        storage_bucket,storage_object_key,upload_protocol,expected_file_size_bytes,
        storage_part_count,storage_part_size_bytes,worker_job_id
      ) VALUES($1::uuid,$2::uuid,$3::uuid,'brand','primary_brand','Async brand',
        'fixture','partial.csv',$4::uuid,'processing','processing','private-imports',
        'workspace/partial.csv','supabase-multipart-tus',1000,1,50331648,'signal-import-old')
    `,[id.failedBatch,workspaceId,id.source,id.actor]);
    await insertRoot(client,workspaceId,id.partialRoot,id.failedBatch,"partial-record","1");

    assert.equal(await scalar<number>(client,`
      SELECT count(*)::int FROM signal_population_memberships membership
      WHERE membership.workspace_id=$1::uuid AND membership.mention_id=$2::uuid
        AND membership.membership_status='included' AND membership.removed_at IS NULL
    `,[workspaceId,id.partialRoot]),0,"partial root must not enter any population");
    assert.equal(await scalar<boolean>(client,
      "SELECT signal_mention_has_only_incomplete_imports_v1($1::uuid,$2::uuid)",
      [workspaceId,id.partialRoot]),true);
    await assert.rejects(client.query(`
      INSERT INTO signal_mention_attributions(
        workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,entity_id,
        confidence,review_status,attribution_source,policy_version,attribution_basis,
        eligibility_status,is_current
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'primary_brand','brand',$5::uuid,
        1,'approved','fixture','1','mention_semantic','eligible',true)
    `,[workspaceId,id.partialRoot,id.source,id.failedBatch,id.brand]),
    (error: unknown)=>(error as { code?: string }).code==="23514");

    await client.query(`
      SELECT fail_signal_workspace_import_v1(
        $1::uuid,'signal-import-old','intentional_rehearsal_abort',
        '{"kind":"intentional_rehearsal_abort","recoverable":true}'::jsonb,1,500
      )
    `,[id.failedBatch]);
    // A dispatch failure is retryable only while its batch is still queued. A
    // processing failure remains audit history and must never starve the
    // replacement outbox at the head of the claim order.
    await client.query(`
      INSERT INTO signal_workspace_import_outbox(
        workspace_id,import_batch_id,worker_job_id,status,available_at,attempt_count
      ) VALUES($1::uuid,$2::uuid,'signal-import-old','failed',now()-interval '1 minute',1)
    `,[workspaceId,id.failedBatch]);
    await client.query(`
      INSERT INTO import_batches(
        id,workspace_id,data_source_id,mention_type,entity_kind,entity_label,
        source_system,source_file_name,product_idempotency_key,product_request_digest,
        imported_by_user_id,status,ingestion_phase,storage_bucket,storage_object_key,
        upload_protocol,expected_file_size_bytes,storage_part_count,
        storage_part_size_bytes,supersedes_import_batch_id
      ) VALUES($1::uuid,$2::uuid,$3::uuid,'brand','primary_brand','Async brand','fixture',
        'recovery.csv',$4,$5,$6::uuid,'queued','uploading','private-imports',
        'workspace/recovery.csv','supabase-multipart-tus',1000,1,50331648,$7::uuid)
    `,[id.recoveryBatch,workspaceId,id.source,hash("recovery-key"),hash("recovery-request"),
      id.actor,id.failedBatch]);
    const enqueue = await client.query<{ outbox_id: string;worker_job_id: string }>(`
      SELECT outbox_id::text,worker_job_id
      FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)
    `,[id.recoveryBatch,id.actor]);
    const claim = await client.query<{ outbox_id: string;lease_token: string }>(`
      SELECT outbox_id::text,lease_token::text
      FROM claim_signal_workspace_import_dispatch_v1(1,60,8)
    `);
    assert.equal(claim.rows[0]?.outbox_id,enqueue.rows[0]?.outbox_id);
    await client.query("SELECT complete_signal_workspace_import_dispatch_v1($1::uuid,$2::uuid)",[
      claim.rows[0]!.outbox_id,claim.rows[0]!.lease_token
    ]);
    assert.equal(await scalar<boolean>(client,
      "SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)",
      [id.recoveryBatch,enqueue.rows[0]!.worker_job_id]),true);
    await client.query("SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,'duplicate')",[
      id.partialRoot,id.recoveryBatch
    ]);
    await insertRoot(client,workspaceId,id.newRoot,id.recoveryBatch,"new-record","2");
    await client.query("SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,'included')",[
      id.newRoot,id.recoveryBatch
    ]);
    const complete = await client.query<{ accepted: boolean }>(`
      SELECT accepted FROM complete_signal_workspace_import_v1(
        $1::uuid,$2,$3,3,1,0,2,1000
      )
    `,[id.recoveryBatch,enqueue.rows[0]!.worker_job_id,"a".repeat(64)]);
    assert.equal(complete.rows[0]?.accepted,true);

    const state = await client.query<{
      failed: number;completed: number;watermarks: number;syncs: number;
      accepted_roots: number;outbox_completed: number;events: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM import_batches WHERE id=$2::uuid AND status='failed') AS failed,
        (SELECT count(*)::int FROM import_batches WHERE id=$3::uuid AND status='completed'
          AND record_count=3 AND included_count=1 AND excluded_count=0 AND duplicate_count=2) AS completed,
        (SELECT count(*)::int FROM signal_data_watermarks WHERE workspace_id=$1::uuid
          AND last_import_batch_id=$3::uuid) AS watermarks,
        (SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$3::uuid) AS syncs,
        (SELECT count(*)::int FROM (VALUES ($4::uuid),($5::uuid)) expected(id)
          WHERE signal_mention_has_accepted_import_v1($1::uuid,expected.id)) AS accepted_roots,
        (SELECT count(*)::int FROM signal_workspace_import_outbox
          WHERE import_batch_id=$3::uuid AND status='completed') AS outbox_completed,
        (SELECT count(*)::int FROM signal_workspace_import_events
          WHERE import_batch_id IN ($2::uuid,$3::uuid)) AS events
    `,[workspaceId,id.failedBatch,id.recoveryBatch,id.partialRoot,id.newRoot]);
    assert.deepEqual(state.rows[0],{
      failed: 1,completed: 1,watermarks: 1,syncs: 1,
      accepted_roots: 2,outbox_completed: 1,events: 4
    });

    const retry = await client.query<{ accepted: boolean }>(`
      SELECT accepted FROM complete_signal_workspace_import_v1(
        $1::uuid,$2,$3,3,1,0,2,1000
      )
    `,[id.recoveryBatch,enqueue.rows[0]!.worker_job_id,"a".repeat(64)]);
    assert.equal(retry.rows[0]?.accepted,true);
    assert.equal(await scalar<number>(client,
      "SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1::uuid",
      [id.recoveryBatch]),1);
  } finally { await client.end(); }
});

async function seedAuthority(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations(id,slug,legal_name,display_name,status)
    VALUES($1::uuid,'async-import','Async import','Async import','active')
  `,[id.organization]);
  await client.query(`
    INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1::uuid,'async-import@example.test','Async operator','noisia_internal',
      'noisia_admin',$2::uuid,'active')
  `,[id.actor,id.organization]);
  await client.query(`
    INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status)
    VALUES($1::uuid,$2::uuid,'async-import-brand','Async import brand','Async import brand',
      ARRAY['MX']::char(2)[],'active')
  `,[id.brand,id.organization]);
}

async function insertRoot(
  client: pg.Client,workspaceId: string,mentionId: string,batchId: string,
  externalId: string,hashChar: string
) {
  await client.query(`
    INSERT INTO mentions(
      id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
      source_system,source_file_id,text_hash,text_clean,text_snippet,text_length,language,
      published_at,platform,resolved_platform,quality_score,inclusion_status
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,'fixture',$5::uuid,
      $6,$7,$7,length($7),'es','2026-08-01T12:00:00Z','web','web',9,'included')
  `,[mentionId,workspaceId,id.source,externalId,batchId,hashChar.repeat(64),`Text ${externalId}`]);
}

async function scalar<T>(client: pg.Client,sql: string,params: unknown[]) {
  const result = await client.query(sql,params);return Object.values(result.rows[0] ?? {})[0] as T;
}

function hash(value: string) {
  return `sha256:${(awaitImportCrypto(value))}`;
}

function awaitImportCrypto(value: string) {
  // Test identities only; deterministic and deliberately not used as authority.
  return Buffer.from(value).toString("hex").padEnd(64,"0").slice(0,64);
}

function requireLocal(value: string) {
  const parsed = new globalThis.URL(value);
  assert.ok(["127.0.0.1","localhost","::1"].includes(parsed.hostname));
  assert.match(parsed.pathname,/import[_-]0079/u);
}
