import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import type {PoolClient,Pool} from "pg";
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile} from "@noisia/query-engine";
import * as core from "../signal-workspace-embeddings";
import {quoteSignalWorkspaceEmbeddingsStoreV1 as quote,requestSignalWorkspaceEmbeddingsStoreV1 as request} from "../signal-workspace-embeddings-management";

const enabled=process.env.NOISIA_WORKSPACE_EMBEDDINGS_TEST_APPROVED==="true";
/** The isolated prepared fixture is shared read-only with scale tests. Store BEGIN/
 * COMMIT use real PostgreSQL savepoints inside this test's outer rollback. No guard
 * or SQL is replaced; monetary transitions remain atomic without leaving paid fixtures. */
async function fixture(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();await client.query("BEGIN");
 const stack:string[]=[];let serial=0;
 const query=async(sql:string,params?:unknown[])=>{
  if(sql==="BEGIN"){const name=`embedding_test_${++serial}`;stack.push(name);return client.query(`SAVEPOINT ${name}`);}
  if(sql==="COMMIT")return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const name=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${name}`);return client.query(`RELEASE SAVEPOINT ${name}`);}
  return client.query(sql,params);
 };
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient["query"];scoped.release=()=>{};
 const database:core.SignalWorkspaceEmbeddingsDatabaseV1={query:query as Pool["query"],connect:async()=>scoped};
 const workspace_id=process.env.NOISIA_WORKSPACE_EMBEDDINGS_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_WORKSPACE_EMBEDDINGS_TEST_ACTOR_ID!;
 const scope={database,workspace_id,actor_user_id,profile};
 const ask=async()=>{const current=await quote(scope);return request({...scope,preparation_run_id:current.preparation_run_id,quote_digest:current.quote_digest,
  hard_cap_micro_usd:current.required_cap_micro_usd??current.estimated_upper_micro_usd,idempotency_key:randomUUID()});};
 const claim=async(run_id:string)=>{const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1::uuid",[run_id])).rows[0]!;
  const lease=await core.claimSignalWorkspaceEmbeddingRunV1({database,run_id,worker_job_id:job.worker_job_id});assert.ok(lease);return lease;};
 const begin=async()=>{const requested=await ask(),lease=await claim(requested.run_id),batch=await core.readSignalWorkspaceEmbeddingBatchV1({database,lease});
  assert.ok(batch.inputs.length>0,"use the uncached isolated baseline fixture");
  const call=await core.reserveSignalWorkspaceEmbeddingCallV1({database,lease,batch});assert.ok(call);return{lease,batch,call};};
 const cleanup=async()=>{await client.query("ROLLBACK");client.release();await pool.end();};
 return{database,scope,workspace_id,actor_user_id,ask,claim,begin,cleanup};
}
function response(batch:core.SignalWorkspaceEmbeddingBatchV1,tokens=batch.inputs.length){
 const vectors=batch.inputs.map(input=>({chunk_sha256:input.chunk_sha256,embedding:Array.from({length:1024},(_,index)=>index===0?1:0)}));
 return{validated:{vectors,total_tokens:tokens,provider_request_id:"local-fixture"},raw:{http_status:200,provider_request_id:"local-fixture",body:JSON.stringify({model:profile.model,
  data:vectors.map((vector,index)=>({index,embedding:vector.embedding})),usage:{total_tokens:tokens}})}};
}

test("workspace embedding responses retain observed cost after actor or rights revocation without filling cache",{skip:!enabled,timeout:60_000},async()=>{
 for(const revoked of ["actor","rights"] as const){const f=await fixture();try{
  const {lease,batch,call}=await f.begin(),answer=response(batch);
  await core.markSignalWorkspaceEmbeddingCallSentV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
  if(revoked==="actor")await f.database.query("UPDATE users SET status='suspended' WHERE id=$1::uuid",[f.actor_user_id]);
  else await f.database.query("UPDATE data_sources SET status='inactive' WHERE workspace_id=$1::uuid AND status='active'",[f.workspace_id]);
  await core.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:answer.raw});
  await assert.rejects(core.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease,batch,call_id:call.call_id,attempt_token:call.attempt_token,validated:answer.validated}),
   revoked==="actor"?/workspace_embedding_forbidden/u:/workspace_embedding_inputs_changed/u);
  const ledger=(await f.database.query<{status:string;settled_micro_usd:string}>("SELECT status,settled_micro_usd::text FROM signal_workspace_embedding_calls WHERE id=$1::uuid",[call.call_id])).rows[0]!;
  assert.equal(ledger.status,"settled");assert.ok(Number(ledger.settled_micro_usd)>0);
  assert.equal((await f.database.query("SELECT 1 FROM signal_workspace_chunk_embeddings WHERE workspace_id=$1::uuid",[f.workspace_id])).rowCount,0);
  assert.equal((await f.database.query<{cursor_asset_sha256:string|null}>("SELECT cursor_asset_sha256 FROM signal_workspace_embedding_runs WHERE id=$1::uuid",[lease.run_id])).rows[0]!.cursor_asset_sha256,null);
 }finally{await f.cleanup();}}
});

test("workspace embedding unknown or malformed unpriced responses retain reservations across new request keys",{skip:!enabled,timeout:60_000},async()=>{
 for(const outcome of ["network","malformed","overage"] as const){const f=await fixture();try{
  const {lease,batch,call}=await f.begin();await core.markSignalWorkspaceEmbeddingCallSentV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
  if(outcome==="network")await core.failSignalWorkspaceEmbeddingCallV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token,outcome:"outcome_unknown",error_code:"workspace_embedding_outcome_unknown"});
  else if(outcome==="malformed"){
   await core.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:{body:"{broken",http_status:502,provider_request_id:null}});
   await core.failSignalWorkspaceEmbeddingCallV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token,outcome:"known_response_invalid",error_code:"workspace_embedding_response_json_invalid"});
  }else{const answer=response(batch,batch.tokens_upper+100);
   await core.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:answer.raw});
   await assert.rejects(core.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease,batch,call_id:call.call_id,attempt_token:call.attempt_token,validated:answer.validated}),/workspace_embedding_budget_violation/u);
  }
  const run=(await f.database.query<{reserved_micro_usd:string;unknown_reserved_micro_usd:string;settled_micro_usd:string;status:string;observed_exception_micro_usd:string}>(
   "SELECT reserved_micro_usd::text,unknown_reserved_micro_usd::text,settled_micro_usd::text,status,observed_exception_micro_usd::text FROM signal_workspace_embedding_runs WHERE id=$1::uuid",[lease.run_id])).rows[0]!;
  assert.equal(run.status,"outcome_unknown");assert.equal(Number(run.reserved_micro_usd),batch.reserved_micro_usd);assert.equal(run.unknown_reserved_micro_usd,run.reserved_micro_usd);assert.equal(run.settled_micro_usd,"0");
  if(outcome==="overage")assert.ok(Number(run.observed_exception_micro_usd)>batch.reserved_micro_usd);
  await assert.rejects(f.ask(),/workspace_embedding_outcome_unknown/u);
 }finally{await f.cleanup();}}
});

test("workspace embedding definitely-not-sent releases reserve and stored responses resume without a second send",{skip:!enabled,timeout:60_000},async()=>{
 for(const mode of ["not_sent","persisted"] as const){const f=await fixture();try{
  const {lease,batch,call}=await f.begin();await core.markSignalWorkspaceEmbeddingCallSentV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
  const answer=response(batch);
  if(mode==="not_sent")await core.failSignalWorkspaceEmbeddingCallV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token,outcome:"definitely_not_sent",error_code:"workspace_embedding_definitely_not_sent"});
  else{await core.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:answer.raw});
   await core.failSignalWorkspaceEmbeddingCallV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token,outcome:"local_failure",error_code:"workspace_embedding_worker_failed"});}
  const before=(await f.database.query<{status:string;reserved_micro_usd:string}>("SELECT status,reserved_micro_usd::text FROM signal_workspace_embedding_runs WHERE id=$1::uuid",[lease.run_id])).rows[0]!;
  assert.equal(before.status,"failed");assert.equal(Number(before.reserved_micro_usd),mode==="not_sent"?0:batch.reserved_micro_usd);
  const requested=await f.ask();assert.equal(requested.run_id,lease.run_id);const resumed=await f.claim(requested.run_id);
  await assert.rejects(core.readSignalWorkspaceEmbeddingBatchV1({database:f.database,lease}),/workspace_embedding_lease_lost/u);
  const nextBatch=await core.readSignalWorkspaceEmbeddingBatchV1({database:f.database,lease:resumed});const nextCall=await core.reserveSignalWorkspaceEmbeddingCallV1({database:f.database,lease:resumed,batch:nextBatch});assert.ok(nextCall);
  if(mode==="not_sent"){assert.notEqual(nextCall.call_id,call.call_id);assert.equal(nextCall.state,"reserved");}
  else{assert.equal(nextCall.call_id,call.call_id);assert.equal(nextCall.state,"response_persisted");
   const next=await core.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease:resumed,batch:nextBatch,call_id:nextCall.call_id,attempt_token:nextCall.attempt_token,validated:answer.validated});
   assert.deepEqual(next.cursor,batch.next_cursor);
   assert.equal((await f.database.query("SELECT 1 FROM signal_workspace_embedding_calls WHERE run_id=$1::uuid",[lease.run_id])).rowCount,1);
  }
 }finally{await f.cleanup();}}
});

test("workspace embedding DB rejects a false response model and accounts known invalid-output usage without caching it",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{const {lease,batch,call}=await f.begin(),answer=response(batch);
  await core.markSignalWorkspaceEmbeddingCallSentV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
  answer.raw.body=answer.raw.body.replace('"model":"voyage-4-large"','"model":"wrong-model"');
  await core.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:answer.raw});
  await assert.rejects(core.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease,batch,call_id:call.call_id,attempt_token:call.attempt_token,validated:answer.validated}),/workspace_embedding_invalid_response/u);
  await core.failSignalWorkspaceEmbeddingCallV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token,outcome:"known_response_invalid",error_code:"workspace_embedding_invalid_response",total_tokens:answer.validated.total_tokens});
  assert.equal((await f.database.query<{status:string}>("SELECT status FROM signal_workspace_embedding_calls WHERE id=$1::uuid",[call.call_id])).rows[0]!.status,"settled");
  assert.equal((await f.database.query("SELECT 1 FROM signal_workspace_chunk_embeddings WHERE workspace_id=$1::uuid",[f.workspace_id])).rowCount,0);
 }finally{await f.cleanup();}
});

test("workspace embedding SQL seals protect prior request identities, budget and vector provenance",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{const {lease,call}=await f.begin();
  const rejected=async(sql:string,params:unknown[],pattern:RegExp)=>{await f.database.query("BEGIN");try{await assert.rejects(f.database.query(sql,params),pattern);}finally{await f.database.query("ROLLBACK");}};
  await rejected("UPDATE signal_workspace_embedding_runs SET request_keys='{}'::jsonb WHERE id=$1::uuid",[lease.run_id],/append-only/u);
  await rejected("UPDATE signal_workspace_embedding_runs SET hard_cap_micro_usd=hard_cap_micro_usd+1 WHERE id=$1::uuid",[lease.run_id],/immutable/u);
  await rejected(`INSERT INTO signal_workspace_chunk_embeddings(workspace_id,config_digest,chunk_sha256,call_id,response_index,embedding)
   SELECT workspace_id,config_digest,input_keys[1],id,0,$2::vector FROM signal_workspace_embedding_calls WHERE id=$1::uuid`,
   [call.call_id,`[${Array.from({length:1024},(_,index)=>index===0?1:0).join(",")}]`],/settled response identity/u);
  await rejected(`INSERT INTO signal_workspace_embedding_calls SELECT (jsonb_populate_record(NULL::signal_workspace_embedding_calls,
   to_jsonb(source)||jsonb_build_object('id',gen_random_uuid(),'attempt_token',gen_random_uuid(),'tokens_upper',source.tokens_upper+100))).*
   FROM signal_workspace_embedding_calls source WHERE id=$1::uuid`,[call.call_id],/reservation_bound/u);
  const relations=["signal_workspace_embedding_runs","signal_workspace_embedding_calls","signal_workspace_chunk_embeddings"];
  const permissions=(await f.database.query<{relrowsecurity:boolean;public_grants:string}>(`SELECT relation.relrowsecurity,
   (SELECT count(*)::text FROM aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) acl WHERE acl.grantee=0) public_grants
   FROM pg_class relation WHERE relation.relname=ANY($1::text[])`,[relations])).rows;
  assert.equal(permissions.length,3);assert.ok(permissions.every(item=>item.relrowsecurity&&item.public_grants==="0"));
 }finally{await f.cleanup();}
});
