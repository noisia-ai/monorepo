import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import type pg from "pg";
export async function seed(client: pg.PoolClient) {
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

export async function processingBatch(
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

export async function dispatchAndBegin(client: pg.PoolClient,id: string,job: string) {
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

export function byteLength(value:string){return Buffer.byteLength(value,"utf8");}
export function sha(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
export async function scalar<T>(client:pg.PoolClient,sql:string,params:unknown[]){const r=await client.query(sql,params);return Object.values(r.rows[0]??{})[0] as T;}

export async function addRoots(client:pg.PoolClient,fixture:Awaited<ReturnType<typeof seed>>,batch:Awaited<ReturnType<typeof processingBatch>>,size:number){
  await client.query(`INSERT INTO mentions(id,workspace_id,data_source_id,source_file_id,canonical_mention_id,
    provider_record_id,external_id,source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status,quality_score)
   SELECT id,$1::uuid,$2::uuid,$3::uuid,id,'finalization-'||id,id::text,'listening_csv',
    encode(sha256(convert_to(id::text,'UTF8')),'hex'),repeat('synthetic content ',80)||n,1300,
    '2026-08-01T12:00:00Z'::timestamptz,'web','included',7
   FROM (SELECT gen_random_uuid() id,n FROM generate_series(1,$4::int) n) roots`,[fixture.workspace,fixture.source,batch.id,size]);
  await client.query("ANALYZE mentions");
  await client.query(`SELECT record_signal_workspace_import_provenance_set_v1($1::uuid,
   (SELECT array_agg(id ORDER BY id) FROM mentions WHERE source_file_id=$1::uuid),
   array_fill('included'::text,ARRAY[$2::int]))`,[batch.id,size]);
  await client.query('ANALYZE signal_mention_import_memberships');
}

export async function complete(client:pg.PoolClient,batch:Awaited<ReturnType<typeof processingBatch>>,size:number){
 return client.query(`SELECT * FROM complete_signal_workspace_import_v1($1::uuid,$2,$3,$4,$4,0,0,$5)`,
 [batch.id,batch.job,createHash('sha256').update('finalization:'+batch.id).digest('hex'),size,byteLength('synthetic finalization')]);
}
