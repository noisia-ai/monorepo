import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {completeWorkspaceImport,workspaceImportClosureTimeoutMs,WorkspaceImportClosureReconciledError} from "./workspace-import-completion";

const request=(count=50_000)=>({workspaceId:"00000000-0000-4000-8000-000000000001",dataSourceId:"00000000-0000-4000-8000-000000000002",importBatchId:"00000000-0000-4000-8000-000000000003",workerJobId:"job-one",fileHash:"a".repeat(64),verifiedHash:"a".repeat(64),verifiedBytes:100,expectedBytes:100,processedBytes:100,progressRecords:count,stats:{record_count:count,included_count:1,excluded_count:0,duplicate_count:count-1}});
function fixture(options:{commitError?:boolean;committed?:boolean;queryError?:boolean;reconcileLockFailures?:number;hang?:"completion"|"commit"|"rollback"|"reconciliation"}={}){
 const sql:string[]=[];const releases:unknown[]=[];const events:string[]=[];let acquisitions=0,closures=0,commits=0,reconciles=0;
 const row={import_batch_id:request().importBatchId,accepted:true,accepted_batch_id:request().importBatchId};
 const database={query:async(text:string)=>{sql.push('pool:'+text);closures++;return{rows:[row]};},connect:async()=>{
  const index=acquisitions++;events.push(`acquire:${index}`);
  return{release:(error?:unknown)=>{events.push(`release:${index}`);releases.push(error);},query:async(text:string)=>{
   sql.push(text);events.push(`query:${index}:${text}`);
   if(text==='ROLLBACK'&&index===0&&options.hang==='rollback')return new Promise(()=>undefined);
   if(text.includes('complete_signal_workspace_import_v1')){closures++;if(index===0&&options.hang==='completion')return new Promise(()=>undefined);if(options.queryError)throw Object.assign(new Error('cancelled'),{code:'57014'});return{rows:[row]};}
   if(text.includes('fail_signal_workspace_import_v1')){reconciles++;if(index===1&&options.hang==='reconciliation')return new Promise(()=>undefined);if(reconciles<=(options.reconcileLockFailures??0))throw Object.assign(new Error('lock'),{code:'55P03'});return{rows:[]};}
   if(text.includes('FROM import_batches'))return{rows:[{status:index===0?'processing':options.committed?'completed':'failed',worker_job_id:'job-one',source_file_hash:'a'.repeat(64),record_count:50_000,included_count:1,excluded_count:0,duplicate_count:49_999,processed_bytes:'100',failure_code:'closure_commit_unconfirmed',failure_detail:{},id:request().importBatchId}]};
   if(text==='COMMIT'){commits++;if(index===0&&options.hang==='commit')return new Promise(()=>undefined);if(index===0&&options.commitError)throw Object.assign(new Error('socket closed'),{code:'ECONNRESET'});}
   return{rows:[]};
  }};
 }} as unknown as Pick<Pool,'query'|'connect'>;
 return{database,sql,releases,events,counts:()=>({acquisitions,closures,commits,reconciles})};
}
test('large closure budget is proportional and capped without changing small batches',()=>{
 assert.equal(workspaceImportClosureTimeoutMs(49_999),null);assert.equal(workspaceImportClosureTimeoutMs(50_000),900_000);
 assert.equal(workspaceImportClosureTimeoutMs(95_100),1_141_200);assert.equal(workspaceImportClosureTimeoutMs(1_000_000),1_500_000);
});
test('small closure uses the original pool query without any transaction settings',async()=>{
 const f=fixture();await completeWorkspaceImport(f.database,request(49_999));assert.deepEqual(f.counts(),{acquisitions:0,closures:1,commits:0,reconciles:0});
});
test('verified large closure executes once on one client and releases it',async()=>{
 const f=fixture();const result=await completeWorkspaceImport(f.database,request());assert.equal(result.replayed,false);
 assert.deepEqual(f.counts(),{acquisitions:1,closures:1,commits:1,reconciles:0});assert.equal(f.releases.length,1);
 assert.equal(f.sql[0],'BEGIN');assert(f.sql.some(s=>s.includes("set_config('statement_timeout'")));
});
test('invalid proof stops before acquiring or executing closure',async()=>{
 for(const change of [{verifiedHash:'b'.repeat(64)},{verifiedBytes:99},{progressRecords:49_999},{stats:{...request().stats,duplicate_count:2}}]){
  const f=fixture();await assert.rejects(completeWorkspaceImport(f.database,{...request(),...change}));assert.equal(f.counts().closures,0);
 }
});
test('SQL timeout rolls back and destroys the connection without retrying the closure',async()=>{
 const f=fixture({queryError:true,reconcileLockFailures:2});
 await assert.rejects(completeWorkspaceImport(f.database,request(),{reconciliationRetryDelayMs:0}),error=>error instanceof WorkspaceImportClosureReconciledError && (error.cause as {code:string}).code==='57014');
 assert.equal(f.counts().reconciles,3);assert(f.events.indexOf('release:0')<f.events.indexOf('acquire:1'));
 assert.equal(f.counts().closures,1);assert(f.sql.includes('ROLLBACK'));assert(f.releases[0] instanceof Error);
});
test('lost COMMIT acknowledgement reconciles a durable completion without repeating closure',async()=>{
 const f=fixture({commitError:true,committed:true});const result=await completeWorkspaceImport(f.database,request(),{reconciliationRetryDelayMs:0});
 assert.equal(result.replayed,true);assert.equal(result.rows[0]?.accepted,true);assert.equal(f.counts().closures,1);assert.equal(f.counts().reconciles,1);assert(f.releases[0] instanceof Error);
});
test('COMMIT not delivered is failed by CAS and remains eligible for normal UI recovery',async()=>{
 const f=fixture({commitError:true,committed:false,reconcileLockFailures:2});
 await assert.rejects(completeWorkspaceImport(f.database,request(),{reconciliationRetryDelayMs:0}),WorkspaceImportClosureReconciledError);
 assert.equal(f.counts().closures,1);assert.equal(f.counts().reconciles,3);assert.equal(f.releases.length,4);
});

for (const hangingOperation of ["completion", "commit", "rollback", "reconciliation"] as const) {
  test(`a silent ${hangingOperation} response destroys its socket before the reconciliation fence`, async () => {
    const fixtureOptions = {
      hang: hangingOperation,
      committed: hangingOperation === "commit",
      commitError: hangingOperation === "reconciliation",
      queryError: hangingOperation === "rollback"
    };
    const state = fixture(fixtureOptions);
    const operation = completeWorkspaceImport(state.database, request(), {
      statementTimeoutMs: 5,
      completionGraceMs: 5,
      operationTimeoutMs: 10,
      reconciliationRetryDelayMs: 0
    });
    if (hangingOperation === "commit") assert.equal((await operation).replayed, true);
    else await assert.rejects(operation, WorkspaceImportClosureReconciledError);
    assert.equal(state.counts().closures, 1);
    assert(state.events.indexOf("release:0") < state.events.indexOf("acquire:1"));
    assert(state.releases[0] instanceof Error);
    if (hangingOperation === "completion" || hangingOperation === "commit") {
      assert(!state.events.includes("query:0:ROLLBACK"), "never queue rollback behind a silent operation");
    }
    if (hangingOperation === "reconciliation") assert.equal(state.counts().reconciles, 2);
  });
}
