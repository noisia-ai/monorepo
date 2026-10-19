import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("Worker uses the sealed CSV timezone and exposes timestamp failures without a futile storage retry", {
  skip: process.env.NOISIA_NATIONAL_IMPORT_TEST_APPROVED!=="true", timeout: 120_000
}, async () => {
  const url=new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const { pool }=await import("@/lib/db");
  const { SENTIONE_CSV_47_HEADERS_V1 }=await import("@noisia/db");
  const { prepareWorkspaceManualImportInTransactionV1 }=await import("./workspace-manual-import-setup");
  const { createWorkspaceImportUploadV1,loadWorkspaceImportV1,retryWorkspaceImportFromStorageV1 }=await import("./workspace-async-import");
  const { resolveSignalWorkspaceForUser }=await import("./signal-workspace");
  const actorId=randomUUID(),suffix=randomUUID().slice(0,8);
  const originalFetch=globalThis.fetch;
  try {
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
      VALUES($1::uuid,$2,'Timestamp regression','noisia_internal','noisia_admin','active')`,
    [actorId,`timestamps-${suffix}@example.test`]);
    process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE="true";
    process.env.NOISIA_LOCAL_AUTH_EMAIL=`timestamps-${suffix}@example.test`;
    const { POST:createBrand }=await import("@/app/api/brands/route");
    const response=await createBrand(new Request("http://localhost/api/brands",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        organization_name:`Timestamps ${suffix}`,slug:`timestamps-${suffix}`,name:`Timestamps ${suffix}`,
        display_name:`Timestamps ${suffix}`,industry:"Retail",countries:["MX"],description:"Isolated timestamp regression.",
        brand_seed_handles:[],competitors:[],timezone:"America/Mexico_City",status:"active"
      })
    }));
    assert.equal(response.status,201);
    const created=await response.json() as {signal_workspace:{id:string}};
    const actor={id:actorId,userType:"noisia_internal",organizationId:null};
    const workspace=await resolveSignalWorkspaceForUser(actor,{workspaceId:created.signal_workspace.id});
    assert.ok(workspace);
    const context={workspace,actor,access:"manual-import" as const};
    const setup=await prepareWorkspaceManualImportInTransactionV1({...context,idempotencyKey:randomUUID(),input:{
      contract_version:"signal-workspace-manual-import-setup-v1",provider:"sentione",source_name:"Timestamp fixture",
      category_name:"Retail",rights:{storage_and_analysis:true,external_ai_processing:false,retention_until:null}
    }});
    const sourceId=(await pool.query<{id:string}>("SELECT id::text FROM data_sources WHERE workspace_id=$1::uuid AND source_key=$2",
      [workspace.id,setup.source_key])).rows[0]!.id;
    Object.assign(globalThis,{noisiaWorkerPgPool:pool});
    const { ingestMentionsCsvJob }=await import("../../../../../services/workers/src/workers/mentions-csv-ingest");
    process.env.SUPABASE_STORAGE_BUCKET_IMPORTS="isolated-test";
    let bytes=new Uint8Array();
    globalThis.fetch=async () => new Response(Uint8Array.from(bytes).buffer);
    const cases=[
      {zone:"America/Mexico_City",created:"2026-01-01 04:30:00",added:"2026-01-01 05:30:00",
        published:"2026-01-01T10:30:00.000Z",collected:"2026-01-01T11:30:00.000Z"},
      {zone:"UTC",created:"2026-01-01 04:30:00",added:"2026-01-01 05:30:00",
        published:"2026-01-01T04:30:00.000Z",collected:"2026-01-01T05:30:00.000Z"},
      {zone:"Asia/Tokyo",created:"2026-01-01T04:30:00-06:00",added:"2026-01-01T11:30:00Z",
        published:"2026-01-01T10:30:00.000Z",collected:"2026-01-01T11:30:00.000Z"},
      {zone:"America/New_York",created:"2026-11-01 01:30:00",added:"",code:"source_timestamp_ambiguous",field:"Created"},
      {zone:"America/New_York",created:"2026-03-08 02:30:00",added:"",code:"source_timestamp_nonexistent",field:"Created"},
      {zone:"UTC",created:"2026-02-30 04:30:00",added:"",code:"source_timestamp_invalid",field:"Created"},
      {zone:"UTC",created:"",added:"",code:"source_timestamp_required",field:"Created"},
      {zone:"UTC",created:"2026-01-01 04:30:00",added:"not-a-date",code:"source_timestamp_invalid",field:"Added to system"},
      {zone:"America/New_York",created:"2026-08-01 12:00:00",added:"",code:"source_timestamp_ambiguous",field:"Created",lateAmbiguous:true}
    ];
    for (const [index,item] of cases.entries()) {
      const values:Record<string,string>={id:`fixture-${suffix}-${index}`,Created:item.created,"Added to system":item.added,
        "Content of posts":`Isolated timestamp fixture ${suffix} ${index} contains sufficient source text.`,Language:"es",Country:"MX"};
      const rows:Record<string,string>[]=item.lateAmbiguous ? Array.from({length:601},(_,row)=>({...values,id:`${values.id}-${row}`,
        "Content of posts":`${values["Content of posts"]} Unique fixture row ${row}.`,
        Created:row===600?"2026-11-01 01:30:00":item.created})) : [values];
      bytes=new TextEncoder().encode(`${SENTIONE_CSV_47_HEADERS_V1.join(",")}\n${rows.map(row=>
        SENTIONE_CSV_47_HEADERS_V1.map(key=>row[key]??"").join(",")).join("\n")}\n`);
      const launch=async (timezone:string) => {
        const upload=await createWorkspaceImportUploadV1({...context,sourceId,fileName:"timestamps.csv",fileSizeBytes:bytes.length,
          contentType:"text/csv",idempotencyKey:randomUUID(),contributedByStudyCorpusId:null,supersedesImportBatchId:null,
          acquisition:{sourceKey:setup.source_key,slotKey:"primary-brand",queryEvidence:{class:"unavailable",queryVersion:null,
            reason:"provider_did_not_embed_query"},period:{start:"2026-01-01",end:"2026-12-31",timezone}},
          storage:{resolve:()=>({bucket:"isolated-test"}),createSignedUploads:async()=>({bucket:"isolated-test",objectPrefix:"test",
            partSizeBytes:bytes.length,expiresInSeconds:60,parts:[{partNumber:1,expectedSizeBytes:bytes.length,
              objectKey:"test.part-00001",uploadUrl:"http://localhost/fixture"}]})}
        });
        const id=upload.batch.id;
        const job=(await pool.query<{worker_job_id:string}>(
          "SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)",[id,actorId])).rows[0]!.worker_job_id;
        const execute=()=>ingestMentionsCsvJob({id:job,data:{importBatchId:id,sourceFileName:"timestamps.csv",sourceTimezone:"Pacific/Honolulu"},
          updateProgress:async()=>{}} as unknown as Parameters<typeof ingestMentionsCsvJob>[0]);
        return {id,execute};
      };
      const {id,execute}=await launch(item.zone);
      if (item.code) {
        await assert.rejects(execute(),new RegExp(item.code,"u"));
        const receipt=await loadWorkspaceImportV1({workspaceId:workspace.id,sourceId,importBatchId:id});
        assert.deepEqual(receipt?.failure,{code:item.code,recoverable:false});
        assert.equal(receipt?.recovery.recoverable_from_storage,false);
        const failure=(await pool.query<{failure_detail:{field:string;recoverable:boolean}}>(
          "SELECT failure_detail FROM import_batches WHERE id=$1::uuid",[id])).rows[0]!.failure_detail;
        assert.equal(failure.field,item.field);assert.equal(failure.recoverable,false);
        assert.equal((await pool.query<{count:number}>("SELECT count(*)::int count FROM mentions WHERE source_file_id=$1::uuid",[id])).rows[0]!.count,0,
          "a temporal error anywhere in a new file must precede canonical persistence");
        await assert.rejects(retryWorkspaceImportFromStorageV1({...context,sourceId,importBatchId:id,idempotencyKey:randomUUID()}),
          /storage_recovery_unavailable/u);
        if (item.lateAmbiguous) {
          const corrected=await launch("UTC");
          const result=await corrected.execute();
          assert.equal("accepted" in result && result.accepted,true);
          const consistency=await pool.query<{count:number;different:number}>(`SELECT count(*)::int count,
            count(*) FILTER (WHERE mention.published_at<>observation.published_at)::int different
            FROM signal_provider_mention_observations observation JOIN mentions mention ON mention.id=observation.mention_id
            WHERE observation.import_batch_id=$1::uuid`,[corrected.id]);
          assert.deepEqual(consistency.rows[0],{count:601,different:0},"changing the declared zone after preflight failure must not retain old canonical timestamps");
          // The original zone would fail validation; an exact accepted replay must
          // still recognize its durable authority instead of reparsing into new rows.
          const duplicate=await launch(item.zone);
          const duplicateResult=await duplicate.execute();
          assert.equal("accepted" in duplicateResult && duplicateResult.accepted,false);
          const duplicateReceipt=await loadWorkspaceImportV1({workspaceId:workspace.id,sourceId,importBatchId:duplicate.id});
          assert.equal(duplicateReceipt?.duplicate_of_import_id,corrected.id);
          assert.equal(duplicateReceipt?.failure?.code,"content_already_accepted");
        }
      } else {
        const result=await execute();
        assert.equal("accepted" in result && result.accepted,true);
        const rows=await pool.query<{published_at:Date;provider_collected_at:Date}>(
          `SELECT published_at,provider_collected_at FROM signal_provider_mention_observations WHERE import_batch_id=$1::uuid`,[id]);
        assert.equal(rows.rows.length,1);
        assert.equal(rows.rows[0]!.published_at.toISOString(),item.published);
        assert.equal(rows.rows[0]!.provider_collected_at.toISOString(),item.collected);
      }
    }
  } finally { globalThis.fetch=originalFetch;await pool.end(); }
});
