/** Remote-only, physical rollback. Real stores/Worker/SQL authority; synthetic ledger receipt, no transport. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {SignalWorkspaceEmbeddingsDatabaseV1} from '../../infrastructure/db/signal-workspace-embeddings';
type Pool=SignalWorkspaceEmbeddingsDatabaseV1 & {end():Promise<void>};
import {main,openDatabase} from './guard.mjs';
import {quoteWorkspaceCorpusEmbeddingsForActorV1 as quote,requestWorkspaceCorpusEmbeddingsForActorV1 as request} from '../../apps/studio/src/lib/data-os/workspace-corpus-embeddings';
import {claimSignalWorkspaceEmbeddingRunV1 as claim,markSignalWorkspaceEmbeddingCallSentV1 as markSent,persistSignalWorkspaceEmbeddingResponseV1 as persist,failSignalWorkspaceEmbeddingCallV1 as failCall} from '../../infrastructure/db/signal-workspace-embeddings';
import {signalWorkspaceEmbeddingsJobV1} from '../../services/workers/src/workers/signal-workspace-embeddings';

await main(async()=>{
 if(!process.argv.includes('--rollback-check'))throw Error('mfp_rollback_check_required');
 const identity=JSON.parse(await readFile(process.env.NOISIA_MFP_IDENTITY_FILE??'.data/dev-corpus/identity.json','utf8')) as {workspace_id:string;brand_id:string};
 const pool:Pool=await openDatabase(),raw=await pool.connect();
 const flag=process.env.NOISIA_MENTION_FACETS_ENABLED,enabled=process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
 let phase='preflight',serial=0,transaction=false;const stack:string[]=[];
 const report=(next:string)=>{phase=next;console.log(JSON.stringify({phase}));};
 const query=async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const key=`embedding_${++serial}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
  if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==='ROLLBACK'){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
  return raw.query(sql,params);
 };
 const database={query:query as Pool['query'],connect:async()=>Object.assign(Object.create(raw),{query,release(){}}) as typeof raw};
 const census=async()=>(await raw.query(`SELECT (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$1) runs,
 (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$1) calls,
 (SELECT count(*)::int FROM signal_workspace_chunk_embeddings WHERE workspace_id=$1) cache,
 (SELECT count(*)::int FROM signal_processing_admissions WHERE workspace_id=$1) admissions`,[identity.workspace_id])).rows[0];
 const deny=async(fn:()=>Promise<unknown>,pattern:RegExp)=>{await raw.query('SAVEPOINT deny');try{await assert.rejects(fn,pattern);}finally{await raw.query('ROLLBACK TO SAVEPOINT deny');await raw.query('RELEASE SAVEPOINT deny');}};
 try{
  const baseline=await census();
  assert.equal((await raw.query(`SELECT count(*)::int n FROM signal_workspace_embedding_runs WHERE workspace_id=$1 AND status IN('queued','running')`,[identity.workspace_id])).rows[0].n,0);
  await raw.query('BEGIN');transaction=true;await raw.query("SET LOCAL statement_timeout='90s'");
  process.env.NOISIA_MENTION_FACETS_ENABLED='true';process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED='true';
  assert.ok(process.env.VOYAGE_API_KEY,'provider presence required, never transported');
  assert.equal(process.env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD,undefined,'harness tests DB policy separately from explicit env limit');
  const current=(await raw.query(`SELECT p.*,w.brand_id FROM signal_workspaces w JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active' WHERE w.id=$1`,[identity.workspace_id])).rows[0];
  assert.ok(current);assert.equal(current.brand_id,identity.brand_id);
  const actor=randomUUID();await raw.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES($1,$2,'Rollback embedding client','client','client_admin',$3,'active')`,[actor,`${actor}@fixture.example.test`,current.organization_id]);
  await raw.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'admin')",[actor,identity.brand_id]);
  const scope={database,workspaceId:identity.workspace_id,actorUserId:actor};
  for(const cap of [null,100] as const){
   await raw.query('SAVEPOINT scenario');report(cap===null?'unlimited':'strict');const policy=randomUUID();
   await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $1,$2,max(version)+1,'draft',now()-interval '1 second','infinity',$3,NULL,$4 FROM signal_processing_policy_versions WHERE organization_id=$2`,[policy,current.organization_id,current.budget_timezone,current.created_by_user_id]);
   await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,action,kind,provider,model,configuration,configuration_digest,CASE WHEN action='corpus_embeddings' THEN $3::bigint ELSE max_execution_micro_usd END,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[policy,current.id,cap]);
   await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[current.id]);await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy]);
   report('quote');const quoted=await quote(scope);assert.equal(quoted.can_execute,true);assert.equal(quoted.max_run_cost_micro_usd,cap);assert.equal(quoted.missing_asset_chunks,0);
   const body={preparation_run_id:quoted.preparation_run_id,quote_digest:quoted.quote_digest,hard_cap_micro_usd:cap};
   if(cap!==null){await deny(()=>request({...scope,idempotencyKey:randomUUID(),body:{...body,hard_cap_micro_usd:null}}),/budget_exceeds_limit/);await deny(()=>request({...scope,idempotencyKey:randomUUID(),body:{...body,hard_cap_micro_usd:cap+1}}),/budget_exceeds_limit/);}
   const key=randomUUID();report('admission');await request({...scope,idempotencyKey:key,body});
   const run=(await raw.query(`SELECT r.*,a.action FROM signal_workspace_embedding_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id WHERE r.workspace_id=$1 AND r.request_keys ? $2`,[identity.workspace_id,key])).rows[0];assert.ok(run);assert.equal(run.action,'corpus_embeddings');assert.equal(run.hard_cap_micro_usd===null?null:Number(run.hard_cap_micro_usd),cap);
   report('replay');await request({...scope,idempotencyKey:key,body});
   report('worker_cache');let transports=0;const task={id:run.worker_job_id,data:{run_id:run.id},updateProgress:async()=>{}};
   const result=await signalWorkspaceEmbeddingsJobV1(task,{database,provider:{async embedBatch(){transports++;throw Error('transport_forbidden');}}});assert.equal('status' in result&&result.status,'completed');assert.equal(transports,0);
   assert.equal((await raw.query('SELECT counts FROM signal_workspace_embedding_runs WHERE id=$1',[run.id])).rows[0].counts.completed_roots,quoted.eligible_roots);
   report('new_admission_for_ledger');const k2=randomUUID();await request({...scope,idempotencyKey:k2,body});
   const r2=(await raw.query('SELECT * FROM signal_workspace_embedding_runs WHERE workspace_id=$1 AND request_keys ? $2',[identity.workspace_id,k2])).rows[0];
   const lease=await claim({database,run_id:r2.id,worker_job_id:r2.worker_job_id});assert.ok(lease);
   // Explicit synthetic reservation exercises the real SQL ledger and pre-send API,
   // not cache eligibility: existing corpus caches are never removed or falsified.
   const insertCall=async(amount:number,tokens=100)=>(await raw.query(`INSERT INTO signal_workspace_embedding_calls(workspace_id,run_id,config_digest,batch_digest,request_digest,input_keys,batch,tokens_upper,reserved_micro_usd)
    VALUES($1,$2,$3,$4,$4,ARRAY[$4],'{}',$6,$5) RETURNING id,attempt_token`,[identity.workspace_id,r2.id,r2.config_digest,`sha256:${'a'.repeat(64)}`,amount,tokens])).rows[0];
   report('ledger_reserve');if(cap!==null)await deny(()=>insertCall(120,1000),/processing_execution_cap_exhausted|workspace_embedding_budget/);const call=await insertCall(12);
   report('revoked_before_transport');await raw.query('SAVEPOINT revoked');await raw.query('UPDATE user_brand_access SET revoked_at=now() WHERE user_id=$1 AND brand_id=$2',[actor,identity.brand_id]);
   await deny(()=>markSent({database,lease,call_id:call.id,attempt_token:call.attempt_token}),/workspace_embedding_forbidden/);
   await raw.query('ROLLBACK TO SAVEPOINT revoked');await raw.query('RELEASE SAVEPOINT revoked');
   report('send_and_receipt');await markSent({database,lease,call_id:call.id,attempt_token:call.attempt_token});
   await persist({database,call_id:call.id,attempt_token:call.attempt_token,response:{http_status:200,provider_request_id:'synthetic-no-transport',body:JSON.stringify({model:r2.profile.model,usage:{total_tokens:1},data:[]})}});
   await failCall({database,lease,call_id:call.id,attempt_token:call.attempt_token,outcome:'known_response_invalid',error_code:'workspace_embedding_invalid_response',total_tokens:1});
   assert.equal((await raw.query('SELECT observed_micro_usd::int n FROM signal_workspace_embedding_calls WHERE id=$1',[call.id])).rows[0].n,1);
   process.env.NOISIA_MENTION_FACETS_ENABLED='false';await deny(()=>request({...scope,idempotencyKey:randomUUID(),body}),/workspace_embedding_forbidden/);process.env.NOISIA_MENTION_FACETS_ENABLED='true';
   await raw.query('ROLLBACK TO SAVEPOINT scenario');await raw.query('RELEASE SAVEPOINT scenario');report('scenario_pass');
  }
  await raw.query('ROLLBACK');transaction=false;assert.deepEqual(await census(),baseline);report('rollback_census_pass');
  console.log(JSON.stringify({provider_calls:0,ledger:'synthetic rollback',worker:'real cache completion',status:'passed'}));
 }catch(error){const e=error as Error&{code?:string};console.error(JSON.stringify({phase,name:e.name,code:e.code,message:/^[a-z_]+$/u.test(e.message)?e.message:undefined,frame:e.stack?.split('\n').find(line=>line.includes('embeddings-selfservice-check'))?.trim()}));throw error;}
 finally{if(transaction)await raw.query('ROLLBACK');raw.release();await pool.end();if(flag===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=flag;if(enabled===undefined)delete process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;else process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED=enabled;}
});
