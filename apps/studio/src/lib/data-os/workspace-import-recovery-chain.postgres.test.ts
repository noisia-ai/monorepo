import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("storage recovery follows verified ancestry and rejects broken ownership", {
  skip: process.env.NOISIA_NATIONAL_IMPORT_TEST_APPROVED !== "true"
}, async () => {
  const url=new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const {pool}=await import("@/lib/db");
  const {prepareWorkspaceManualImportInTransactionV1}=await import("./workspace-manual-import-setup");
  const {createWorkspaceImportUploadV1,retryWorkspaceImportFromStorageV1,resolveWorkspaceImportStorageRootV1}=await import("./workspace-async-import");
  const {resolveSignalWorkspaceForUser}=await import("./signal-workspace");
  const suffix=randomUUID().slice(0,8),actorId=randomUUID();
  const originalFetch=globalThis.fetch;
  try {
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
      VALUES($1::uuid,$2,'Recovery chain fixture','noisia_internal','noisia_admin','active')`,
      [actorId,`chain-${suffix}@example.test`]);
    process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE="true";
    process.env.NOISIA_LOCAL_AUTH_EMAIL=`chain-${suffix}@example.test`;
    const {POST:createBrand}=await import("@/app/api/brands/route");
    const response=await createBrand(new Request("http://localhost/api/brands",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        organization_name:`Chain fixture ${suffix}`,slug:`chain-fixture-${suffix}`,
        name:`Chain fixture ${suffix}`,display_name:`Chain fixture ${suffix}`,industry:"Retail",
        countries:["MX"],description:"Isolated storage ancestry fixture.",brand_seed_handles:[],
        competitors:[],timezone:"America/Mexico_City",status:"active"
      })
    }));
    assert.equal(response.status,201);
    const created=await response.json() as {signal_workspace:{id:string}};
    const actor={id:actorId,userType:"noisia_internal",organizationId:null};
    const workspace=await resolveSignalWorkspaceForUser(actor,{workspaceId:created.signal_workspace.id});
    assert.ok(workspace);
    const context={workspace,actor,access:"manual-import" as const};
    const setup=await prepareWorkspaceManualImportInTransactionV1({...context,idempotencyKey:randomUUID(),input:{
      contract_version:"signal-workspace-manual-import-setup-v1",provider:"sentione",
      source_name:"Storage chain fixture",category_name:"Retail",
      rights:{storage_and_analysis:true,external_ai_processing:false,retention_until:null}
    }});
    const source=(await pool.query<{id:string}>(`SELECT id::text FROM data_sources
      WHERE workspace_id=$1::uuid AND source_key=$2`,[workspace.id,setup.source_key])).rows[0]!;
    const fileSize=64;
    const upload=await createWorkspaceImportUploadV1({...context,sourceId:source.id,
      fileName:"chain-fixture.csv",fileSizeBytes:fileSize,contentType:"text/csv",idempotencyKey:randomUUID(),
      contributedByStudyCorpusId:null,supersedesImportBatchId:null,
      acquisition:{sourceKey:setup.source_key,slotKey:"primary-brand",
        queryEvidence:{class:"unavailable",queryVersion:null,reason:"provider_did_not_embed_query"},
        period:{start:"2026-08-01",end:"2026-08-31",timezone:workspace.timezone}},
      storage:{resolve:()=>({bucket:"isolated-test"}),createSignedUploads:async({objectPrefix})=>({
        bucket:"isolated-test",objectPrefix,partSizeBytes:fileSize,expiresInSeconds:60,
        parts:[{partNumber:1,expectedSizeBytes:fileSize,objectKey:`${objectPrefix}.part-00001`,uploadUrl:"http://localhost/fixture"}]
      })}
    });
    const fail=async(id:string)=>{
      const job=(await pool.query<{worker_job_id:string}>(
        "SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)",[id,actorId])).rows[0]!.worker_job_id;
      await pool.query("SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)",[id,job]);
      await pool.query("SELECT fail_signal_workspace_import_v1($1::uuid,$2,'processing_failed','{}'::jsonb,0,0)",[id,job]);
    };
    const storageReads:string[]=[];
    process.env.SUPABASE_STORAGE_BUCKET_IMPORTS="isolated-test";
    globalThis.fetch=async(request,init)=>{
      assert.equal(init?.method,"HEAD");storageReads.push(String(request));
      return new Response(null,{headers:{"content-length":String(fileSize)}});
    };
    const retry=(id:string)=>retryWorkspaceImportFromStorageV1({...context,sourceId:source.id,importBatchId:id,idempotencyKey:randomUUID()});
    await fail(upload.batch.id);
    const first=await retry(upload.batch.id);
    await fail(first.batch.id);
    const second=await retry(first.batch.id);
    await fail(second.batch.id);
    const third=await retry(second.batch.id);
    const root=(await pool.query<{storage_object_key:string}>("SELECT storage_object_key FROM import_batches WHERE id=$1::uuid",[upload.batch.id])).rows[0]!;
    assert.equal(storageReads.length,3);
    assert.ok(storageReads.every(path=>decodeURIComponent(path).includes(root.storage_object_key)));
    const chain=(await pool.query<{id:string;storage_source_import_batch_id:string;storage_object_key:string}>(`
      SELECT id::text,storage_source_import_batch_id::text,storage_object_key FROM import_batches
      WHERE id=ANY($1::uuid[])`,[[first.batch.id,second.batch.id,third.batch.id]])).rows;
    assert.equal(chain.find(row=>row.id===second.batch.id)?.storage_source_import_batch_id,first.batch.id);
    assert.equal(chain.find(row=>row.id===third.batch.id)?.storage_source_import_batch_id,second.batch.id);
    assert.ok(chain.every(row=>row.storage_object_key===root.storage_object_key));
    assert.equal((await pool.query<{count:number}>("SELECT count(*)::int count FROM mentions WHERE workspace_id=$1::uuid",[workspace.id])).rows[0]!.count,0);
    await assert.rejects(retryWorkspaceImportFromStorageV1({...context,sourceId:randomUUID(),importBatchId:first.batch.id,idempotencyKey:randomUUID()}),/import_not_found/u);
    assert.equal(storageReads.length,3,"a source mismatch must reject before reading storage");

    // Invalid historical graphs cannot be inserted through real triggers. A transaction-local
    // shadow table exercises the resolver SQL against corruption without disabling live guards.
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TEMP TABLE import_batches(
        id uuid,workspace_id uuid,data_source_id uuid,status text,ingestion_phase text,
        storage_source_import_batch_id uuid,supersedes_import_batch_id uuid,
        storage_bucket text,storage_object_key text,expected_file_size_bytes bigint,
        storage_part_count integer,storage_part_size_bytes bigint,upload_protocol text,source_file_name text
      ) ON COMMIT DROP`);
      const owner=randomUUID(),middle=randomUUID(),leaf=randomUUID();
      const object=`workspace-imports/${workspace.id}/${owner}/chain.csv`;
      for(const [id,parent] of [[owner,null],[middle,owner],[leaf,middle]])await client.query(`
        INSERT INTO import_batches VALUES($1::uuid,$2::uuid,$3::uuid,'failed','failed',$4::uuid,$4::uuid,
          'isolated-test',$5,64,1,64,'parts-v1','chain.csv')`,[id,workspace.id,source.id,parent,object]);
      const resolve=()=>resolveWorkspaceImportStorageRootV1({queryable:client,workspaceId:workspace.id,sourceId:source.id,importBatchId:leaf});
      assert.equal(await resolve(),owner);
      for(const [column,value] of [
        ["workspace_id",randomUUID()],["data_source_id",randomUUID()],
        ["supersedes_import_batch_id",randomUUID()],["storage_source_import_batch_id",randomUUID()],
        ["storage_bucket","foreign-bucket"],["storage_object_key",`${object}.altered`],
        ["expected_file_size_bytes",65],["storage_part_count",2],["storage_part_size_bytes",32],
        ["upload_protocol","different"],["source_file_name","different.csv"],["status","completed"]
      ] as const){
        await client.query("SAVEPOINT malformed");
        await client.query(`UPDATE import_batches SET ${column}=$1 WHERE id=$2::uuid`,[value,middle]);
        await assert.rejects(resolve(),/storage_authority_mismatch/u,`must reject invalid ${column}`);
        await client.query("ROLLBACK TO SAVEPOINT malformed");
      }
      await client.query("SAVEPOINT cycle");
      await client.query("UPDATE import_batches SET storage_source_import_batch_id=$1::uuid,supersedes_import_batch_id=$1::uuid WHERE id=$2::uuid",[leaf,owner]);
      await assert.rejects(resolve(),/storage_authority_mismatch/u);
      await client.query("ROLLBACK TO SAVEPOINT cycle");
      await client.query("UPDATE import_batches SET storage_object_key=$1",[`workspace-imports/${workspace.id}/${randomUUID()}/chain.csv`]);
      await assert.rejects(resolve(),/storage_authority_mismatch/u,"matching bytes and ancestry cannot authorize another object's prefix");
    } finally {await client.query("ROLLBACK");client.release();}
  } finally {globalThis.fetch=originalFetch;await pool.end();}
});
