/** Provider-free receipt recovery against the migrated public schema. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createProcessingPolicyIdentitiesV1} from "../../infrastructure/db/migrations/signal-processing-policy.fixture";
import {createSignalLabelingStoreV1, type LabelingRunV1} from "../../infrastructure/db/signal-labeling-runs";
import {main,openDatabase} from "./guard.mjs";

await main(async()=>{
 const pool=await openDatabase(),client=await pool.connect();
 let stage="fixture",savepoint=false;
 try{
  await client.query("BEGIN");
  const identity=await createProcessingPolicyIdentitiesV1({database:pool,scoped:client});
  const workspace=identity.first.workspace_id,actor=identity.actors.firstAdmin;
  const prep=randomUUID(),labeler=randomUUID(),runId=randomUUID(),lease=randomUUID();
  await client.query(`INSERT INTO signal_corpus_preparation_runs
    (id,workspace_id,actor_user_id,worker_job_id,status,phase,input_revision,completed_at)
    VALUES($1,$2,$3,$4,'completed','complete',1,now())`,[prep,workspace,actor,`ci-${prep}`]);
  await client.query(`INSERT INTO signal_entity_context_versions
    (workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
    VALUES($1,1,$2,'{"entities":[]}'::jsonb,'{}'::jsonb,'targeted',0)`,[workspace,`sha256:${"1".repeat(64)}`]);
  await client.query(`INSERT INTO signal_labeler_versions
    (id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
    VALUES($1,'facets','anthropic','claude-sonnet-5-5',$2,$3,$4,'{}'::jsonb)`,
    [labeler,`sha256:${"2".repeat(64)}`,`sha256:${"3".repeat(64)}`,`sha256:${"4".repeat(64)}`]);
  await client.query(`INSERT INTO signal_labeling_runs
    (id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,
    entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,
    actor_user_id,lease_token,lease_until)
    VALUES($1,$2,'facets',$3,$4,$5,1,'running',47,$6,$7,$8,$9,now()+interval '5 minutes')`,
    [runId,workspace,labeler,prep,`sha256:${"1".repeat(64)}`,randomUUID(),`sha256:${"5".repeat(64)}`,actor,lease]);
  const submitted=randomUUID(),reserved=randomUUID(),key=`ci/${submitted}`;
  await client.query(`INSERT INTO signal_labeling_calls
    (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
    status,reserved_micro_usd,budget_date,budget_timezone,raw_sha256,raw_storage_key,
    raw_size_bytes,raw_storage_verified_at,raw_storage_verified_key)
    VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
    'submitted',47,current_date,'UTC',$6,$7,7,now(),$7)`,
    [submitted,runId,workspace,`ci-${submitted}`,`sha256:${"6".repeat(64)}`,`sha256:${"0".repeat(64)}`,key]);
  // No body and no verification mark is a valid reserved call.
  await client.query(`INSERT INTO signal_labeling_calls
    (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
    status,reserved_micro_usd,budget_date,budget_timezone)
    VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
    'reserved',13,current_date,'UTC')`,
    [reserved,runId,workspace,`ci-${reserved}`,`sha256:${"7".repeat(64)}`]);
  const query=async(sql:string,params?:unknown[])=>{
   if(sql==="BEGIN"){assert.equal(savepoint,false);savepoint=true;return client.query("SAVEPOINT receipt");}
   if(sql==="COMMIT"){assert.equal(savepoint,true);savepoint=false;return client.query("RELEASE SAVEPOINT receipt");}
   if(sql==="ROLLBACK"){assert.equal(savepoint,true);savepoint=false;
    await client.query("ROLLBACK TO SAVEPOINT receipt");return client.query("RELEASE SAVEPOINT receipt");}
   return client.query(sql,params);
  };
  const db={connect:async()=>({query,release(){}}),query};
  const run={id:runId,workspace_id:workspace,lease_token:lease} as LabelingRunV1;
  const transient=createSignalLabelingStoreV1({database:db as never,storeRaw:async()=>"",loadRaw:async()=>{throw Error("workspace_engine_storage_unavailable");}});
  stage="transient";await assert.rejects(transient.calls(run),/labeling_raw_storage_unavailable/u);
  assert.equal((await client.query("SELECT status FROM signal_labeling_calls WHERE id=$1",[submitted])).rows[0].status,"submitted");
  const invalid=createSignalLabelingStoreV1({database:db as never,storeRaw:async()=>"",loadRaw:async()=>{throw Error("workspace_engine_storage_object_missing");}});
  stage="invalid";await assert.rejects(invalid.calls(run),/labeling_raw_receipt_invalid/u);
  stage="terminal";await invalid.fail(run,"labeling_raw_receipt_invalid");
  const calls=(await client.query("SELECT id,status,settled_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1",[runId])).rows;
  assert.deepEqual(calls.find((row:{id:string})=>row.id===reserved),{id:reserved,status:"failed",settled_micro_usd:null});
  assert.deepEqual(calls.find((row:{id:string})=>row.id===submitted),{id:submitted,status:"failed",settled_micro_usd:"47"});
  assert.deepEqual((await client.query("SELECT status,error_code FROM signal_labeling_runs WHERE id=$1",[runId])).rows[0],
   {status:"failed",error_code:"labeling_raw_receipt_invalid"});
  await client.query("ROLLBACK");
  console.log(JSON.stringify({status:"passed",gate:"migrated_receipt",cases:5,provider_calls:0,cost_micro_usd:0}));
 }catch(error){console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null}));throw error;}
 finally{await client.query("ROLLBACK").catch(()=>{});client.release();await pool.end();}
});
