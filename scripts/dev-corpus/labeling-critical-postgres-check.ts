/** Terminal provider errors and unknown release against migrated public tables. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createSignalLabelingStoreV1,type LabelingRunV1} from "../../infrastructure/db/signal-labeling-runs";
import {createMigratedLabelingFixture} from "./migrated-labeling-fixture";
import {main,openDatabase} from "./guard.mjs";

await main(async()=>{
 const pool=await openDatabase(),client=await pool.connect();let stage="fixture",savepoint=false;
 try{
  await client.query("BEGIN");
  const f=await createMigratedLabelingFixture(pool,client);
  const query=async(sql:string,params?:unknown[])=>{
   if(sql==="BEGIN"){assert.equal(savepoint,false);savepoint=true;return client.query("SAVEPOINT critical");}
   if(sql==="COMMIT"){assert.equal(savepoint,true);savepoint=false;return client.query("RELEASE SAVEPOINT critical");}
   if(sql==="ROLLBACK"){assert.equal(savepoint,true);savepoint=false;
    await client.query("ROLLBACK TO SAVEPOINT critical");return client.query("RELEASE SAVEPOINT critical");}
   return client.query(sql,params);
  };
  const db={connect:async()=>({query,release(){}}),query};
  const store=createSignalLabelingStoreV1({database:db as never,storeRaw:async()=>"",
   adapter:{kind:"facets",inputs:async()=>[],pending:async()=>0,write:async()=>{}}});
  const ids:string[]=[];
  for(const error of ["provider_usage_invalid","provider_result_missing"]){
   const id=randomUUID();ids.push(id);
   await client.query(`INSERT INTO signal_labeling_calls
    (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
     status,reserved_micro_usd,budget_date,budget_timezone,results_applied,results)
    VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
     'unknown',83,current_date,'UTC',true,$6::jsonb)`,
    [id,f.runId,f.workspaceId,`ci-${id}`,`sha256:${"6".repeat(64)}`,JSON.stringify([{error_code:error}])]);
  }
  stage="finish";const run={id:f.runId,workspace_id:f.workspaceId,lease_token:f.lease} as LabelingRunV1;
  assert.equal(await store.finish(run),"failed");
  const calls=(await client.query("SELECT id,status,stop_reason,settled_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1",[f.runId])).rows;
  for(const [index,error] of ["provider_usage_invalid","provider_result_missing"].entries())
   assert.deepEqual(calls.find((row:{id:string})=>row.id===ids[index]),
    {id:ids[index],status:"failed",stop_reason:error,settled_micro_usd:"83"});
  assert.equal((await client.query("SELECT error_code FROM signal_labeling_runs WHERE id=$1",[f.runId])).rows[0].error_code,
   "labeling_provider_usage_invalid");
  stage="release_unknown";
  const secondRun=randomUUID(),secondLease=randomUUID(),callId=randomUUID();
  await client.query(`INSERT INTO signal_labeling_runs
   (id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,
    entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,
    actor_user_id,lease_token,lease_until)
   VALUES($1,$2,'facets',$3,$4,$5,1,'running',17,$6,$7,$8,$9,now()+interval '5 minutes')`,
   [secondRun,f.workspaceId,f.labelerId,f.preparationId,`sha256:${"1".repeat(64)}`,
    randomUUID(),`sha256:${"7".repeat(64)}`,f.actorId,secondLease]);
  await client.query(`INSERT INTO signal_labeling_calls
   (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
    status,reserved_micro_usd,budget_date,budget_timezone)
   VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
    'unknown',17,current_date,'UTC')`,
   [callId,secondRun,f.workspaceId,`ci-${callId}`,`sha256:${"8".repeat(64)}`]);
  await store.releaseUnknown({id:secondRun,workspace_id:f.workspaceId,lease_token:secondLease} as LabelingRunV1,
   [{id:callId} as never],"unresolvable_after_window");
  assert.deepEqual((await client.query("SELECT status,results_applied FROM signal_labeling_calls WHERE id=$1",[callId])).rows[0],
   {status:"failed",results_applied:true});
  assert.equal((await client.query("SELECT error_code FROM signal_labeling_runs WHERE id=$1",[secondRun])).rows[0].error_code,
   "labeling_unresolvable_after_window");
  await client.query("ROLLBACK");
  console.log(JSON.stringify({status:"passed",gate:"migrated_critical",cases:4,provider_calls:0,cost_micro_usd:0}));
 }catch(error){console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null}));throw error;}
 finally{await client.query("ROLLBACK").catch(()=>{});client.release();await pool.end();}
});
