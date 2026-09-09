import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import type {Pool,PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile,SIGNAL_WORKSPACE_ENGINE_JOB_V1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as embeddings from '../signal-workspace-embeddings';
import * as money from '../signal-workspace-engine-interpretation';
import {scheduleSignalWorkspaceTopicComputationsV1} from '../signal-workspace-topic-computation';
import {insertSignalTaxonomyDraftCoreV1} from '../signal-taxonomy-profile';
import {loadSignalTopicInheritedContextStoreV1} from '../signal-topic-catalog';
import {loadSignalWorkspaceTopicPrototypePlanV1} from '../signal-workspace-topic-prototype-inputs';
import {quoteSignalWorkspaceTopicPrototypesV1,requestSignalWorkspaceTopicPrototypesV1,loadSignalWorkspaceTopicPrototypesV1,
 initializeSignalWorkspaceTopicPrototypeCatalogV1} from '../signal-workspace-topic-prototypes-management';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
const sha=(s:string)=>`sha256:${createHash('sha256').update(s,'utf8').digest('hex')}`;
async function fixture(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
 const stack:string[]=[];let index=0;const query=async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const key=`engine_${++index}`;stack.push(key);return client.query(`SAVEPOINT ${key}`);}
  if(sql==='COMMIT')return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==='ROLLBACK'){const key=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${key}`);return client.query(`RELEASE SAVEPOINT ${key}`);}
  return client.query(sql,params);
 };
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient['query'];scoped.release=()=>{};
 const database=Object.assign(Object.create(pool) as Pool,{query:query as Pool['query'],connect:async()=>scoped});
 const workspace_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_ACTOR_ID!,embedding_run_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_EMBEDDING_ID!;
 assert.ok(workspace_id&&actor_user_id&&embedding_run_id);
 const context=await loadSignalTopicInheritedContextStoreV1({queryable:database,workspace_id,complete_context:true});
 await insertSignalTaxonomyDraftCoreV1({client:scoped,workspace_id,kind:'topic',context_hash:sha('empty-real-catalog'),terms:[],rules:{topics:[]},rule_set_metadata:{},
  provider:'operator',model_version:'empty',prompt_hash:sha('empty'),model_metadata:{},profile_metadata:{contract_version:'signal-topic-catalog-v1'},context_refs:context.context_refs});
 const access={database,workspace_id,actor_user_id};
 const begin=async(parent_execution_id?:string,claude_cap_micro_usd=0)=>{const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(access);
  return engine.beginSignalWorkspaceEngineV1({...access,embedding_run_id,idempotency_key:randomUUID(),expected_catalog_digest:preflight.expected_catalog_digest,
   expected_context_digest:preflight.expected_context_digest,engine_config:{contract_version:'local-engine-fixture-v1'},claude_cap_micro_usd,parent_execution_id});};
 const cleanup=async()=>{await client.query('ROLLBACK');client.release();await pool.end();};
 return{query,database,access,workspace_id,actor_user_id,embedding_run_id,begin,cleanup};
}
async function prototypes(f:Awaited<ReturnType<typeof fixture>>){
 const q=await quoteSignalWorkspaceTopicPrototypesV1(f.access);
 const requested=await requestSignalWorkspaceTopicPrototypesV1({...f.access,idempotency_key:randomUUID(),plan_digest:q.plan_digest,quote_digest:q.quote_digest,
  hard_cap_micro_usd:q.required_cap_micro_usd??q.estimated_upper_micro_usd,provider_available:true,max_run_cost_micro_usd:5_000_000});
 const job=(await f.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1::uuid',[requested.run_id])).rows[0].worker_job_id;
 let lease=await embeddings.claimSignalWorkspaceEmbeddingRunV1({database:f.database,run_id:requested.run_id,worker_job_id:job});assert.ok(lease);
 let calls=0;
 for(;;){const batch=await embeddings.readSignalWorkspaceEmbeddingBatchV1({database:f.database,lease});if(!batch.items.length)break;
  const call=await embeddings.reserveSignalWorkspaceEmbeddingCallV1({database:f.database,lease,batch});
  if(call){calls++;const vectors=batch.inputs.map(input=>({chunk_sha256:input.chunk_sha256,embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}));
   const validated={vectors,total_tokens:vectors.length,provider_request_id:'local-engine-fixture'};
   await embeddings.markSignalWorkspaceEmbeddingCallSentV1({database:f.database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
   await embeddings.persistSignalWorkspaceEmbeddingResponseV1({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,response:{http_status:200,provider_request_id:validated.provider_request_id,
    body:JSON.stringify({model:profile.model,usage:{total_tokens:vectors.length},data:vectors.map((v,index)=>({index,embedding:v.embedding}))})}});
   lease=await embeddings.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease,batch,call_id:call.call_id,attempt_token:call.attempt_token,validated});
  }else lease=await embeddings.commitSignalWorkspaceEmbeddingBatchV1({database:f.database,lease,batch,call_id:null});
  if(batch.done)break;
 }
 await embeddings.finishSignalWorkspaceEmbeddingsV1({database:f.database,lease});return calls;
}
async function consume(f:Awaited<ReturnType<typeof fixture>>,lease:engine.SignalWorkspaceEngineLeaseV1){
 let after:engine.SignalWorkspaceEngineCursorV1|null=null;let chunks=0;const roots=new Set<string>(),hash=createHash('sha256');
 for(;;){const page=await engine.readSignalWorkspaceEngineChunksV1({database:f.database,lease,after,limit:17});
  for(const item of page.items){assert.equal(item.vector.length,1024);assert.equal(sha(item.text),item.chunk_sha256);roots.add(item.root_id);chunks++;
   hash.update(JSON.stringify([item.root_id,item.chunk_index,item.chunk_sha256])+'\n');}
  if(page.done)break;assert.notDeepEqual(page.next_cursor,after);after=page.next_cursor;
 }
 let guideAfter:engine.SignalWorkspaceEngineGuideCursorV1|null=null,guides=0;
 for(;;){const page=await engine.readSignalWorkspaceEngineGuidesV1({database:f.database,lease,after:guideAfter,limit:1});guides+=page.items.length;
  assert.ok(page.items.every(item=>item.guide_key.startsWith('scope:')));if(page.done)break;guideAfter=page.next_cursor;}
 assert.equal(chunks,lease.snapshot.expected_chunks);assert.equal(roots.size,lease.snapshot.expected_roots);assert.equal(guides,lease.snapshot.expected_guides);
 const receipt={roots:roots.size,chunks,guides,stream_digest:`sha256:${hash.digest('hex')}`};
 await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,phase:'fitting',exported:receipt});return receipt;
}
async function artifact(f:Awaited<ReturnType<typeof fixture>>,lease:engine.SignalWorkspaceEngineLeaseV1,type:'engine_model'|'engine_output'){
 const a={artifact_key:type,artifact_type:type,title:'Local fixture',storage_key:`workspace-engine/${f.workspace_id}/${lease.execution_id}/${type}.bin`,sha256:sha(type),size_bytes:10,
  media_type:'application/octet-stream',metadata:{fixture:true}} as const;
 const saved=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:a});
 assert.equal((await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:a})).artifact_id,saved.artifact_id);return saved.artifact_id;
}
test('engine exports every chunk with zero interests, autonomous cached context, private artifact authority and draft model', {skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  const plan=await loadSignalWorkspaceTopicPrototypePlanV1({queryable:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id});
  assert.equal(plan.topics.length,0);assert.ok((plan.context_inputs?.length??0)>0);
  await prototypes(f);const status=await loadSignalWorkspaceTopicPrototypesV1(f.access);assert.equal(status.is_current,true);assert.equal(status.latest_completed?.counts.completed_topics,0);
  assert.equal(status.latest_completed?.counts.processed_input_references,plan.context_inputs!.length);
  const started=await f.begin(),lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-fixture'});assert.ok(lease);
  await assert.rejects(engine.readSignalWorkspaceEngineChunksV1({database:f.database,lease:{...lease,workspace_id:randomUUID()},after:null}),/lease_conflict/u);
  const coverage=await consume(f,lease);assert.equal(coverage.roots,3);assert.equal(coverage.chunks,133);
  const model=await artifact(f,lease,'engine_model'),output=await artifact(f,lease,'engine_output');
  const finished=await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease,model_artifact_id:model,output_artifact_id:output,
   result_kind:'computational_grouping',coverage,model_configuration:{fixture:true},runtime_kind:'python',artifact_format:'joblib',license_key:'fixture-only'});
  assert.ok(finished.model_version_id);assert.deepEqual((await f.query('SELECT status FROM signal_tagging_model_version_events WHERE model_version_id=$1::uuid',[finished.model_version_id])).rows,[{status:'draft'}]);
  const child=await f.begin();const reading=await engine.loadSignalWorkspaceEngineStatusV1(f.access);
  assert.equal(reading.latest_run?.execution_id,child.execution_id);assert.equal(reading.latest_complete?.execution_id,started.execution_id);
  assert.equal(reading.latest_complete?.is_current,true);assert.equal(reading.latest_run?.claude_cap_micro_usd,0);
  const childLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...child,worker_job_id:'local-child'});assert.ok(childLease);
  assert.equal(childLease.snapshot.parent_execution_id,started.execution_id,'omitted parent selects latest compatible complete');
  const priorArtifacts=await engine.readSignalWorkspaceEngineParentArtifactsV1({database:f.database,lease:childLease});
  assert.equal(priorArtifacts.available,true);assert.equal(priorArtifacts.items.length,2);
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease:childLease,error_code:'workspace_engine_worker_failed'});
  const startKey=(await f.query('SELECT idempotency_key FROM signal_topic_catalog_executions WHERE id=$1::uuid',[child.execution_id])).rows[0].idempotency_key;
  await assert.rejects(engine.retrySignalWorkspaceEngineV1({...f.access,...child,idempotency_key:startKey}),/idempotency_conflict/u);
  assert.equal((await f.query('SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid',[child.execution_id])).rows[0].status,'failed');
  const retryKey=randomUUID();await engine.retrySignalWorkspaceEngineV1({...f.access,...child,idempotency_key:retryKey});
  const byKey=await engine.loadSignalWorkspaceEngineStatusV1({...f.access,idempotency_key:retryKey});
  assert.equal(byKey.request_run?.execution_id,child.execution_id);assert.equal(byKey.request_run?.status,'queued');
  await engine.retrySignalWorkspaceEngineV1({...f.access,...child,idempotency_key:retryKey});

 }finally{await f.cleanup();}
});
test('engine rejects missing context cache and stale completion; small populations complete without inventing a model', {skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  await f.query("UPDATE brands SET description=$2 WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id,`new local unembedded context ${randomUUID()}`]);
  await assert.rejects(f.begin(),/guides_required/u);
  await prototypes(f);const started=await f.begin(),lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-fixture'});assert.ok(lease);
  const coverage=await consume(f,lease);const output=await artifact(f,lease,'engine_output');
  await f.query('BEGIN');try{await f.query("UPDATE brands SET description='changed during fit' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
   await assert.rejects(engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease,model_artifact_id:null,output_artifact_id:output,result_kind:'insufficient_population',coverage,
    model_configuration:{},runtime_kind:'python',artifact_format:'none',license_key:null}),/inputs_stale/u);
  }finally{await f.query('ROLLBACK');}
  const finished=await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease,model_artifact_id:null,output_artifact_id:output,result_kind:'insufficient_population',coverage,
   model_configuration:{},runtime_kind:'python',artifact_format:'none',license_key:null});assert.equal(finished.model_version_id,null);
  assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_run?.result_kind,'insufficient_population');
 }finally{await f.cleanup();}
});

test('brand without a catalog has read-only preflight and cannot borrow another workspace corpus', {skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  const brand=randomUUID(),organization=(await f.query("SELECT organization_id FROM brands WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id])).rows[0].organization_id;
  await f.query("INSERT INTO brands(id,organization_id,slug,name,description,status) VALUES($1::uuid,$2::uuid,$3,'Zero interests','Local Brand OS before imports','active')",[brand,organization,`engine-${brand}`]);
  const workspace=(await f.query("SELECT id FROM signal_workspaces WHERE brand_id=$1::uuid",[brand])).rows[0].id;
  const before=(await f.query("SELECT count(*)::int count FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid",[workspace])).rows[0].count;assert.equal(before,0);
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1({...f.access,workspace_id:workspace});
  assert.equal(preflight.total_interests,0);assert.equal(preflight.embedding_run_id,null);assert.ok(preflight.expected_guides>0);
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid",[workspace])).rows[0].count,0);
  await assert.rejects(engine.beginSignalWorkspaceEngineV1({...f.access,workspace_id:workspace,embedding_run_id:f.embedding_run_id,idempotency_key:randomUUID(),
    expected_context_digest:preflight.expected_context_digest,expected_catalog_digest:preflight.expected_catalog_digest,engine_config:{fixture:true},claude_cap_micro_usd:0}),/complete_embeddings_required/u);
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid",[workspace])).rows[0].count,0);
 }finally{await f.cleanup();}
});

test('explicit context preparation initializes an empty catalog and unblocks existing corpus without recomputing it', {skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  // Keep prior evidence intact. There is no usable catalog, exactly the loader
  // path of a new brand; no corpus fixture is cloned or embedded again.
  await f.query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE workspace_id=$1::uuid AND kind='topic'",[f.workspace_id]);
  const profiles=async()=>(await f.query("SELECT count(*)::int n FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1'",[f.workspace_id])).rows[0].n;
  assert.equal(await profiles(),0);
  await f.query("UPDATE brands SET description=description||$2 WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id,` Context bootstrap ${randomUUID()}`]);
  const corpusState=async()=>(await f.query(`SELECT run.id,run.status,run.input_revision,run.counts,run.reserved_micro_usd,run.settled_micro_usd,
    (SELECT count(*)::int FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id) calls
    FROM signal_workspace_embedding_runs run WHERE workspace_id=$1::uuid AND input_contract='corpus' ORDER BY id`,[f.workspace_id])).rows;
  const beforeCorpus=await corpusState();
  const missing=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);
  assert.equal(missing.total_interests,0);assert.equal(missing.embedding_run_id,f.embedding_run_id);assert.ok(missing.missing_guides>0);
  assert.equal((await loadSignalWorkspaceTopicPrototypesV1(f.access)).availability,'no_topics');
  await assert.rejects(quoteSignalWorkspaceTopicPrototypesV1(f.access),/workspace_topic_catalog_required/u);
  assert.equal(await profiles(),0,'Status, preflight and quote must not initialize a catalog.');
  await f.query('SAVEPOINT revoked_context_actor');
  await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.actor_user_id]);
  await assert.rejects(initializeSignalWorkspaceTopicPrototypeCatalogV1(f.access),/workspace_embedding_forbidden/u);
  assert.equal(await profiles(),0);await f.query('ROLLBACK TO SAVEPOINT revoked_context_actor');
  await f.query('RELEASE SAVEPOINT revoked_context_actor');
  await assert.rejects(initializeSignalWorkspaceTopicPrototypeCatalogV1({...f.access,workspace_id:randomUUID()}),/workspace_embedding_forbidden/u);
  // A later transaction failure must not leave an initialized profile behind.
  await f.query('SAVEPOINT rollback_context_initialization');
  assert.equal((await initializeSignalWorkspaceTopicPrototypeCatalogV1(f.access)).created,true);
  assert.equal(await profiles(),1);await f.query('ROLLBACK TO SAVEPOINT rollback_context_initialization');
  await f.query('RELEASE SAVEPOINT rollback_context_initialization');assert.equal(await profiles(),0);
  const initialized=await initializeSignalWorkspaceTopicPrototypeCatalogV1(f.access);
  assert.equal(initialized.created,true);assert.equal(await profiles(),1);
  assert.deepEqual(await initializeSignalWorkspaceTopicPrototypeCatalogV1(f.access),{taxonomy_profile_id:initialized.taxonomy_profile_id,created:false});
  assert.equal((await f.query(`SELECT count(*)::int n FROM taxonomy_terms WHERE taxonomy_id=(SELECT taxonomy_id FROM signal_taxonomy_profiles WHERE id=$1::uuid)`,[initialized.taxonomy_profile_id])).rows[0].n,0);
  const plan=await loadSignalWorkspaceTopicPrototypePlanV1({queryable:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id});
  assert.equal(plan.topics.length,0);assert.ok((plan.context_inputs?.length??0)>0);
  assert.ok(plan.context_inputs?.every(input=>input.role==='scope_positive'||input.role==='scope_negative'));
  const quote=await quoteSignalWorkspaceTopicPrototypesV1(f.access);
  assert.equal(quote.total_topics,0);assert.equal(quote.total_input_references,plan.context_inputs!.length);assert.ok(quote.missing_unique_inputs>0);
  assert.ok(await prototypes(f)>0,'Only missing context inputs receive local fake responses.');
  const completed=await loadSignalWorkspaceTopicPrototypesV1(f.access);
  assert.equal(completed.availability,'available');assert.equal(completed.is_current,true);
  assert.equal(completed.latest_completed?.counts.completed_topics,0);
  assert.equal(completed.latest_completed?.counts.processed_input_references,plan.context_inputs!.length);
  const ready=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);
  assert.equal(ready.missing_guides,0);assert.equal(ready.expected_guides,plan.context_inputs!.length);
  assert.equal(ready.total_interests,0);assert.equal(ready.embedding_run_id,missing.embedding_run_id);
  assert.deepEqual(await corpusState(),beforeCorpus,'Corpus runs, coverage, calls and money must remain unchanged.');
 }finally{await f.cleanup();}
});

test('claim terminalizes expected revocation and input drift before issuing a lease', {skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);const started=await f.begin();
  for(const mutation of ['context','revision','actor']){
   await f.query('BEGIN');try{
    if(mutation==='context')await f.query("UPDATE brands SET description='new context before claim' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
    if(mutation==='revision')await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[f.workspace_id]);
    if(mutation==='actor')await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.actor_user_id]);
    assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-claim-rejection'}),null);
    const row=(await f.query('SELECT status,error_code,execution_token FROM signal_topic_catalog_executions WHERE id=$1::uuid',[started.execution_id])).rows[0];
    assert.equal(row.status,'failed');assert.equal(row.execution_token,null);assert.equal(row.error_code,mutation==='actor'?'workspace_engine_forbidden':'workspace_engine_inputs_stale');
   }finally{await f.query('ROLLBACK');}
  }
 }finally{await f.cleanup();}
});

test('engine begin dispatches atomically and the real outbox recovers lost jobs and expired leases without losing checkpoints', {skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);
  const {drainSignalTopicClassificationOutboxV1:drain}=await import('../../../services/workers/src/workers/signal-topic-classification-outbox');
  const jobs=new Map<string,{name:string;getState:()=>Promise<string>;retry:(state:'completed'|'failed')=>Promise<void>}>(),added:string[]=[];
  const queue={getJob:async(id:string)=>jobs.get(id),add:async(name:string,_data:unknown,options:Record<string,unknown>)=>{
   const id=String(options.jobId);assert.equal(name,SIGNAL_WORKSPACE_ENGINE_JOB_V1);added.push(id);
   jobs.set(id,{name,getState:async()=> 'waiting',retry:async()=>{throw new Error('waiting jobs must not be retried');}});
  }};
  const dispatch=async()=>{
   await scheduleSignalWorkspaceTopicComputationsV1({database:f.database});
   // This fixture nests all store transactions in one rollback. Advance only
   // fixture availability to its fixed now(); real drain transactions start later.
   await f.query("UPDATE signal_topic_classification_outbox SET available_at=transaction_timestamp() WHERE workspace_id=$1::uuid AND status='pending'",[f.workspace_id]);
   return drain({database:f.database,queue});
  };
  const row=async(id:string)=>(await f.query(`SELECT e.status,e.dispatch_generation,e.execution_token,e.processed_chunks::int,
    o.status dispatch_status,o.worker_job_id FROM signal_topic_catalog_executions e JOIN signal_topic_classification_outbox o ON o.execution_id=e.id WHERE e.id=$1::uuid`,[id])).rows[0];
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(f.access),key=randomUUID();
  const request={...f.access,embedding_run_id:f.embedding_run_id,idempotency_key:key,expected_catalog_digest:preflight.expected_catalog_digest,
   expected_context_digest:preflight.expected_context_digest,claude_cap_micro_usd:0,engine_config:{fixture:true},parent_execution_id:null};
  const broken=Object.assign(Object.create(f.database) as Pool,{connect:async()=>{
   const client=await f.database.connect(),wrapped=Object.create(client) as PoolClient;
   wrapped.query=((sql:string,params?:unknown[])=>sql.startsWith('INSERT INTO signal_topic_classification_outbox')
    ?Promise.reject(new Error('local outbox write failure')):client.query(sql,params)) as PoolClient['query'];return wrapped;
  }});
  await assert.rejects(engine.beginSignalWorkspaceEngineV1({...request,database:broken}),/local outbox write failure/u);
  assert.equal((await f.query('SELECT count(*)::int count FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND idempotency_key=$2',[f.workspace_id,key])).rows[0].count,0);
  const started=await engine.beginSignalWorkspaceEngineV1(request),id=started.execution_id;
  assert.equal((await engine.beginSignalWorkspaceEngineV1(request)).execution_id,id);
  assert.equal((await row(id)).dispatch_status,'pending');
  await dispatch();const first=await row(id);assert.equal(first.dispatch_status,'dispatched');
  assert.equal(added.filter(job=>job===first.worker_job_id).length,1);
  await f.query("UPDATE signal_topic_classification_outbox SET updated_at=clock_timestamp()-interval '31 seconds' WHERE execution_id=$1::uuid",[id]);
  await dispatch();assert.equal((await row(id)).worker_job_id,first.worker_job_id);
  assert.equal(added.filter(job=>job===first.worker_job_id).length,1,'ACK recovery keeps a still waiting job');
  jobs.delete(first.worker_job_id);
  await f.query("UPDATE signal_topic_classification_outbox SET updated_at=clock_timestamp()-interval '31 seconds' WHERE execution_id=$1::uuid",[id]);
  await dispatch();assert.equal(added.filter(job=>job===first.worker_job_id).length,2,'lost queued job is recreated with its original ID');
  const lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:id,worker_job_id:first.worker_job_id});assert.ok(lease);
  const coverage=await consume(f,lease),checkpoint={artifact_key:'manifest.json',artifact_type:'engine_output' as const,title:'Durable local checkpoint',
   storage_key:`workspace-engine/${f.workspace_id}/${id}/manifest.json`,sha256:sha('checkpoint'),size_bytes:10,media_type:'application/json',metadata:{bundle:[]}};
  const saved=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:checkpoint});
  const countBefore=added.length;await dispatch();assert.equal(added.length,countBefore,'live lease is left alone');
  await f.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[id]);
  await dispatch();const resumed=await row(id);
  assert.equal(resumed.status,'queued');assert.equal(resumed.dispatch_generation,2);assert.notEqual(resumed.worker_job_id,first.worker_job_id);
  assert.equal(resumed.processed_chunks,coverage.chunks);assert.equal(resumed.execution_token,null);
  await assert.rejects(engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease}),/lease_conflict/u);
  const nextLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:id,worker_job_id:resumed.worker_job_id});assert.ok(nextLease);
  assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:id,worker_job_id:resumed.worker_job_id}),null,'duplicate delivery cannot take a live lease');
  assert.equal((await engine.readSignalWorkspaceEngineCheckpointV1({database:f.database,lease:nextLease}))?.artifact_id,saved.artifact_id);
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code:'workspace_engine_worker_failed'});
  assert.equal((await row(id)).status,'running','late cleanup from old token cannot fail the recovered attempt');
  await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease:nextLease,model_artifact_id:null,output_artifact_id:saved.artifact_id,
   result_kind:'insufficient_population',coverage,model_configuration:{},runtime_kind:'python',artifact_format:'none',license_key:null});
  assert.equal((await row(id)).dispatch_status,'completed');const completeCount=added.length;
  await dispatch();assert.equal(added.length,completeCount,'complete engine is never dispatched again');
  const failed=await f.begin(),failedRow=await row(failed.execution_id);
  const failedLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...failed,worker_job_id:failedRow.worker_job_id});assert.ok(failedLease);
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease:failedLease,error_code:'workspace_engine_worker_failed'});
  const retryKey=randomUUID();await engine.retrySignalWorkspaceEngineV1({...f.access,...failed,idempotency_key:retryKey});
  const retried=await row(failed.execution_id);assert.equal(retried.dispatch_status,'pending');assert.equal(retried.dispatch_generation,2);
  await engine.retrySignalWorkspaceEngineV1({...f.access,...failed,idempotency_key:retryKey});assert.equal((await row(failed.execution_id)).worker_job_id,retried.worker_job_id);
  await dispatch();
  const staleLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...failed,worker_job_id:retried.worker_job_id});assert.ok(staleLease);
  await f.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[failed.execution_id]);
  await f.query("UPDATE brands SET description='changed after hard crash' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
  await scheduleSignalWorkspaceTopicComputationsV1({database:f.database});
  assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,...failed,worker_job_id:(await row(failed.execution_id)).worker_job_id}),null);
  assert.equal((await row(failed.execution_id)).status,'failed');assert.equal((await row(failed.execution_id)).dispatch_status,'completed');
 }finally{await f.cleanup();}
});

test('storage verification retry is explicit, current and confined to zero durable fit or provider evidence', {skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);
  const configuration:money.SignalWorkspaceEngineInterpretationConfigurationV1={provider:'anthropic',model:'fixture-claude',prompt_digest:sha('storage-prompt'),schema_digest:sha('storage-schema'),pricing_version:'local-only',
   input_micro_usd_per_million_tokens:1_000_000,output_micro_usd_per_million_tokens:1_000_000,cache_read_micro_usd_per_million_tokens:500_000,cache_creation_micro_usd_per_million_tokens:1_250_000};
  const startKey=randomUUID(),started=await engine.beginSignalWorkspaceEngineV1({...f.access,embedding_run_id:f.embedding_run_id,idempotency_key:startKey,
   expected_context_digest:preflight.expected_context_digest,expected_catalog_digest:preflight.expected_catalog_digest,engine_config:{fixture:'storage-recovery'},claude_cap_micro_usd:5000,
   interpretation_config:{call_configuration:configuration,budget_timezone:'UTC',daily_cap_micro_usd:5000}});
  const claim=async()=>{const lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-storage-recovery'});assert.ok(lease);return lease;};
  const error_code='workspace_engine_storage_verification_failed',lease=await claim();
  const coverage={roots:lease.snapshot.expected_roots,chunks:lease.snapshot.expected_chunks,guides:lease.snapshot.expected_guides};
  await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,phase:'persisting',exported:{...coverage,stream_digest:sha('local-export-receipt')}});
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code});
  const status=async()=>(await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_run!;
  assert.equal((await status()).storage_recovery_eligible,true);
  assert.equal(engine.isSignalWorkspaceEngineRetryableErrorV1(error_code),false,'Verification errors are not globally retryable.');
  assert.equal(engine.isSignalWorkspaceEngineRetryableErrorV1(error_code,await status()),true);
  const retry=(key=randomUUID())=>engine.retrySignalWorkspaceEngineV1({...f.access,...started,idempotency_key:key});
  await assert.rejects(retry(startKey),/idempotency_conflict/u);
  await f.query('SAVEPOINT storage_revoked');await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.actor_user_id]);
  await assert.rejects(retry(),/forbidden/u);await f.query('ROLLBACK TO SAVEPOINT storage_revoked');await f.query('RELEASE SAVEPOINT storage_revoked');
  await f.query('SAVEPOINT storage_stale');await f.query("UPDATE brands SET description='changed storage recovery context' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
  assert.equal((await status()).is_current,false);await assert.rejects(retry(),/inputs_stale/u);
  await f.query('ROLLBACK TO SAVEPOINT storage_stale');await f.query('RELEASE SAVEPOINT storage_stale');
  // Each negative retains real evidence within its own rollback; no guard or
  // ledger is disabled to manufacture a retryable provider outcome.
  for(const stage of ['artifact','checkpoint','model','reserved','unknown'] as const){
   await f.query('SAVEPOINT storage_evidence');
   await retry();const active=await claim(),output=await artifact(f,active,'engine_output');
   if(stage!=='artifact'){
    const model=stage==='model'?await artifact(f,active,'engine_model'):null;
    const fit=await engine.checkpointSignalWorkspaceEngineFitV1({database:f.database,lease:active,model_artifact_id:model,output_artifact_id:output,
     coverage,result_kind:model?'computational_grouping':'insufficient_population',model_configuration:{fixture:'storage-evidence'},runtime_kind:'python',artifact_format:model?'joblib':'none',license_key:null,
     interpretation_manifest:{unit_count:0,unit_digest:sha('')}});
    assert.equal(Boolean(fit.model_version_id),stage==='model');
    if(stage==='reserved'||stage==='unknown'){
     const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,execution_token:active.execution_token,idempotency_key:randomUUID(),request_digest:sha(stage),
      configuration,reserved_micro_usd:100,budget_timezone:'UTC',daily_cap_micro_usd:5000});
     if(stage==='unknown'){
      const token={database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:active.execution_token};
      assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,true);
      await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_outcome_unknown'});
     }
    }
   }
   await engine.failSignalWorkspaceEngineV1({database:f.database,lease:active,error_code});
   assert.equal((await status()).storage_recovery_eligible,false,stage);
   await assert.rejects(retry(),/retry_unavailable/u);
   await f.query('ROLLBACK TO SAVEPOINT storage_evidence');await f.query('RELEASE SAVEPOINT storage_evidence');
  }
  const key=randomUUID(),first=await retry(key);assert.equal(first.replayed,false);
  const checkpoint=(await f.query("SELECT input_digest,input_snapshot,dispatch_generation,processed_roots,processed_chunks FROM signal_topic_catalog_executions WHERE id=$1::uuid",[started.execution_id])).rows[0];
  assert.equal(checkpoint.processed_roots,coverage.roots);assert.equal(Number(checkpoint.processed_chunks),coverage.chunks);
  assert.equal(checkpoint.input_snapshot.claude_cap_micro_usd,5000);
  assert.equal((await retry(key)).replayed,true);
  assert.deepEqual((await f.query("SELECT input_digest,input_snapshot,dispatch_generation,processed_roots,processed_chunks FROM signal_topic_catalog_executions WHERE id=$1::uuid",[started.execution_id])).rows[0],checkpoint);
  assert.equal((await f.query("SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid",[started.execution_id])).rows[0].n,1);
  assert.equal((await f.query("SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid",[started.execution_id])).rows[0].n,0);
 }finally{await f.cleanup();}
});

test('interpretation evidence retry restores only a complete immutable bundle before any fit or paid evidence', {skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);
  const configuration:money.SignalWorkspaceEngineInterpretationConfigurationV1={provider:'anthropic',model:'fixture-claude',prompt_digest:sha('evidence-prompt'),schema_digest:sha('evidence-schema'),pricing_version:'local-only',
   input_micro_usd_per_million_tokens:1_000_000,output_micro_usd_per_million_tokens:1_000_000,cache_read_micro_usd_per_million_tokens:0,cache_creation_micro_usd_per_million_tokens:0};
  const startKey=randomUUID(),started=await engine.beginSignalWorkspaceEngineV1({...f.access,embedding_run_id:f.embedding_run_id,idempotency_key:startKey,
   expected_context_digest:preflight.expected_context_digest,expected_catalog_digest:preflight.expected_catalog_digest,engine_config:{fixture:'evidence-recovery'},claude_cap_micro_usd:5000,
   interpretation_config:{call_configuration:configuration,budget_timezone:'UTC',daily_cap_micro_usd:5000}});
  const claim=async()=>{const lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-evidence-recovery'});assert.ok(lease);return lease;};
  const lease=await claim(),error_code='workspace_engine_interpretation_cluster_invalid';
  const coverage={roots:lease.snapshot.expected_roots,chunks:lease.snapshot.expected_chunks,guides:lease.snapshot.expected_guides};
  await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,phase:'persisting',exported:{...coverage,stream_digest:sha('local-export-receipt')}});
  const bundle=['manifest.json','model-manifest.json','model.open.joblib','clusters.open.json','assignments.open.jsonl','roots.jsonl'].map(name=>({
   name,storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/${name}.parts.json`,sha256:sha(name),size_bytes:10,media_type:'application/octet-stream'}));
  const persist=async(entries= bundle,mode:'all'|'missing'|'mismatch'='all')=>{
   for(const file of mode==='missing'?entries.slice(0,1):entries){
    await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:{artifact_key:file.name,
     artifact_type:file.name==='model-manifest.json'||file.name.endsWith('.joblib')?'engine_model':'engine_output',title:file.name,
     storage_key:file.storage_key,sha256:mode==='mismatch'&&file.name==='clusters.open.json'?sha('wrong receipt'):file.sha256,
     size_bytes:file.size_bytes,media_type:file.media_type,metadata:{filename:file.name,...(file.name==='manifest.json'?{bundle:entries}:{} )}}});
   }
  };
  const status=async()=>(await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_run!;
  const retry=(key=randomUUID())=>engine.retrySignalWorkspaceEngineV1({...f.access,...started,idempotency_key:key});
  assert.equal(engine.isSignalWorkspaceEngineRetryableErrorV1(error_code),false);
  for(const mode of ['missing','mismatch','duplicate'] as const){
   await f.query('SAVEPOINT bad_bundle');
   if(mode==='duplicate'){
    // Exact replay of the same artifact cannot turn duplicate bundle names into coverage.
    await persist([...bundle,bundle[1]!]);
   }else await persist(bundle,mode);
   if(mode==='missing'){
    // Simulate an unavailable required checkpoint after an explicit retry;
    // this reader must throw before the Worker can choose its null/refit path.
    await f.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||'{"interpretation_evidence_checkpoint_required":true}'::jsonb WHERE id=$1::uuid`,[started.execution_id]);
    await assert.rejects(engine.readSignalWorkspaceEngineCheckpointV1({database:f.database,lease}),/workspace_engine_checkpoint_invalid/u);
   }
   await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code});
   assert.equal((await status()).interpretation_evidence_recovery_eligible,false,mode);
   await assert.rejects(retry(),/retry_unavailable/u);
   await f.query('ROLLBACK TO SAVEPOINT bad_bundle');await f.query('RELEASE SAVEPOINT bad_bundle');
  }
  await persist();await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code});
  assert.equal((await status()).interpretation_evidence_recovery_eligible,true);
  assert.equal(engine.isSignalWorkspaceEngineRetryableErrorV1(error_code,await status()),true);
  await assert.rejects(retry(startKey),/idempotency_conflict/u);
  await assert.rejects(engine.retrySignalWorkspaceEngineV1({...f.access,...started,workspace_id:randomUUID(),idempotency_key:randomUUID()}),/forbidden/u);
  for(const invalid of ['actor','context'] as const){await f.query('SAVEPOINT no_authority');
   if(invalid==='actor')await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.actor_user_id]);
   else await f.query("UPDATE brands SET description='changed after numerical output' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
   await assert.rejects(retry(),invalid==='actor'?/forbidden/u:/inputs_stale/u);
   await f.query('ROLLBACK TO SAVEPOINT no_authority');await f.query('RELEASE SAVEPOINT no_authority');
  }
  for(const stage of ['fit','model','reserved','unknown'] as const){await f.query('SAVEPOINT later_evidence');
   await retry();const active=await claim();
   const ids=(await f.query('SELECT id,artifact_key FROM analysis_artifacts WHERE engine_execution_id=$1::uuid',[started.execution_id])).rows;
   const model=stage==='model'?ids.find(row=>row.artifact_key==='model-manifest.json').id:null;
   await engine.checkpointSignalWorkspaceEngineFitV1({database:f.database,lease:active,coverage,model_artifact_id:model,
    output_artifact_id:ids.find(row=>row.artifact_key==='manifest.json').id,result_kind:model?'computational_grouping':'insufficient_population',
    model_configuration:{fixture:'evidence-recovery'},runtime_kind:'python',artifact_format:model?'joblib':'none',license_key:null,
    interpretation_manifest:{unit_count:0,unit_digest:sha('')}});
   if(stage==='reserved'||stage==='unknown'){
    const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,execution_token:active.execution_token,idempotency_key:randomUUID(),request_digest:sha(stage),
     configuration,reserved_micro_usd:100,budget_timezone:'UTC',daily_cap_micro_usd:5000});
    if(stage==='unknown'){const token={database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:active.execution_token};
     await money.markSignalWorkspaceEngineInterpretationSentV1(token);
     await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_outcome_unknown'});}
   }
   await engine.failSignalWorkspaceEngineV1({database:f.database,lease:active,error_code});
   assert.equal((await status()).interpretation_evidence_recovery_eligible,false,stage);await assert.rejects(retry(),/retry_unavailable/u);
   await f.query('ROLLBACK TO SAVEPOINT later_evidence');await f.query('RELEASE SAVEPOINT later_evidence');
  }
  const before=(await f.query('SELECT id,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid ORDER BY id',[started.execution_id])).rows;
  const key=randomUUID();assert.equal((await retry(key)).replayed,false);assert.equal((await retry(key)).replayed,true);
  const active=await claim(),checkpoint=await engine.readSignalWorkspaceEngineCheckpointV1({database:f.database,lease:active});
  assert.deepEqual(checkpoint?.metadata.bundle,bundle);
  assert.deepEqual((await f.query('SELECT id,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid ORDER BY id',[started.execution_id])).rows,before);
  const row=(await f.query('SELECT result_summary,dispatch_generation,input_snapshot FROM signal_topic_catalog_executions WHERE id=$1::uuid',[started.execution_id])).rows[0];
  assert.equal(row.result_summary.interpretation_evidence_checkpoint_required,true);assert.equal(row.dispatch_generation,2);assert.equal(row.input_snapshot.claude_cap_micro_usd,5000);
  assert.equal((await f.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid',[started.execution_id])).rows[0].n,1);
  assert.equal((await f.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[started.execution_id])).rows[0].n,0);
  // Once restoration succeeds, an editorial checkpoint and its paid receipt
  // must not invalidate the original numerical bundle on a later safe retry.
  const model=before.find(item=>item.metadata.filename==='model-manifest.json')!.id;
  await engine.checkpointSignalWorkspaceEngineFitV1({database:f.database,lease:active,coverage,model_artifact_id:model,
   output_artifact_id:checkpoint!.artifact_id,result_kind:'computational_grouping',model_configuration:{fixture:'restored-evidence'},
   runtime_kind:'python',artifact_format:'joblib',license_key:null,interpretation_manifest:{unit_count:1,unit_digest:sha('"open:fixture"\n')}});
  const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,execution_token:active.execution_token,idempotency_key:randomUUID(),request_digest:sha('after-restoration'),
   configuration,reserved_micro_usd:100,budget_timezone:'UTC',daily_cap_micro_usd:5000});
  const token={database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:active.execution_token};
  await money.markSignalWorkspaceEngineInterpretationSentV1(token);
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/response.parts.json`,
   sha256:sha('simulated response'),size_bytes:18,http_status:200,provider_request_id:null}});
  await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  await engine.checkpointSignalWorkspaceEngineInterpretationV1({database:f.database,lease:active,call_id:call.call_id,unit_keys:['open:fixture'],artifact:{
   artifact_key:'interpretation-1.json',artifact_type:'engine_proposals',title:'Simulated proposal',storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/proposal.parts.json`,
   sha256:sha('simulated proposal'),size_bytes:18,media_type:'application/json',metadata:{fixture:true}}});
  assert.deepEqual((await engine.readSignalWorkspaceEngineCheckpointV1({database:f.database,lease:active}))?.metadata.bundle,bundle);
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease:active,error_code:'workspace_engine_worker_failed'});
  await retry();const resumed=await claim();
  assert.deepEqual((await engine.readSignalWorkspaceEngineCheckpointV1({database:f.database,lease:resumed}))?.metadata.bundle,bundle);
  assert.equal((await f.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[started.execution_id])).rows[0].n,1);
 }finally{await f.cleanup();}
});

test('interpretation single-send, exact settlement after staleness, retained unknown and real budget limits', {skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);const started=await f.begin(undefined,5000),lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-money'});assert.ok(lease);
  const coverage=await consume(f,lease),model=await artifact(f,lease,'engine_model'),output=await artifact(f,lease,'engine_output');
  await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease,model_artifact_id:model,output_artifact_id:output,result_kind:'computational_grouping',coverage,
   model_configuration:{fixture:true},runtime_kind:'python',artifact_format:'joblib',license_key:'fixture-only'});
  const configuration:money.SignalWorkspaceEngineInterpretationConfigurationV1={provider:'anthropic',model:'fixture-claude',prompt_digest:sha('prompt'),schema_digest:sha('schema'),pricing_version:'local-only',
   input_micro_usd_per_million_tokens:1_000_000,output_micro_usd_per_million_tokens:1_000_000,cache_read_micro_usd_per_million_tokens:500_000,cache_creation_micro_usd_per_million_tokens:1_250_000};
  const reserve=(request:string,amount=1000)=>money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,idempotency_key:request,
   request_digest:sha(request),configuration,reserved_micro_usd:amount,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:2000});
  const key=randomUUID(),call=await reserve(key);assert.equal((await reserve(key)).call_id,call.call_id);
  const token={database:f.database,call_id:call.call_id,attempt_token:call.attempt_token};
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,true);
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,false);
  await f.query('BEGIN');try{
   await f.query("UPDATE brands SET description='changed while paid response was in flight' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/response.json`,sha256:sha('raw'),size_bytes:3,http_status:200,provider_request_id:'fixture'}});
   const settled=await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:200,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
   assert.equal(settled.settled_micro_usd,300);assert.equal(settled.state,'settled');
   await assert.rejects(reserve(randomUUID()),/inputs_stale/u);
  }finally{await f.query('ROLLBACK');}
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/response.json`,sha256:sha('raw'),size_bytes:3,http_status:200,provider_request_id:'fixture'}});
  const usage={input_tokens:100,output_tokens:200,cache_read_input_tokens:0,cache_creation_input_tokens:0};
  await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage});await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage});
  const unknownKey=randomUUID(),unknown=await reserve(unknownKey),unknownToken={database:f.database,call_id:unknown.call_id,attempt_token:unknown.attempt_token};
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(unknownToken)).send_authorized,true);
  await money.failSignalWorkspaceEngineInterpretationV1({...unknownToken,outcome:'outcome_unknown',error_code:'workspace_engine_transport_failed'});
  assert.equal((await reserve(unknownKey)).state,'outcome_unknown');assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(unknownToken)).send_authorized,false);
  await assert.rejects(reserve(randomUUID(),1000),/daily_cap_exceeded/u);
  const notSent=await reserve(randomUUID(),600);await money.failSignalWorkspaceEngineInterpretationV1({database:f.database,call_id:notSent.call_id,attempt_token:notSent.attempt_token,
   outcome:'definitely_not_sent',error_code:'workspace_engine_provider_disabled'});
  const budget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...f.access,...started});
  assert.deepEqual(budget,{hard_cap_micro_usd:5000,confirmed_micro_usd:300,reserved_micro_usd:1000,unknown_reserved_micro_usd:1000,observed_exception_micro_usd:0});
  const secondWorkspace=process.env.NOISIA_WORKSPACE_ENGINE_SECOND_WORKSPACE_ID!,secondEmbedding=process.env.NOISIA_WORKSPACE_ENGINE_SECOND_EMBEDDING_ID!;
  assert.ok(secondWorkspace&&secondEmbedding,'second owned local corpus fixture is required for cross-workspace daily budget');
  const otherAccess={...f.access,workspace_id:secondWorkspace},other={...f,workspace_id:secondWorkspace,embedding_run_id:secondEmbedding,access:otherAccess};
  const context=await loadSignalTopicInheritedContextStoreV1({queryable:f.database,workspace_id:secondWorkspace,complete_context:true});
  const connection=await f.database.connect();
  await insertSignalTaxonomyDraftCoreV1({client:connection,workspace_id:secondWorkspace,kind:'topic',context_hash:sha('second-empty-catalog'),terms:[],rules:{topics:[]},rule_set_metadata:{},
   provider:'operator',model_version:'empty',prompt_hash:sha('empty'),model_metadata:{},profile_metadata:{contract_version:'signal-topic-catalog-v1'},context_refs:context.context_refs});
  connection.release();await prototypes(other);
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(otherAccess);
  const next=await engine.beginSignalWorkspaceEngineV1({...otherAccess,embedding_run_id:secondEmbedding,idempotency_key:randomUUID(),expected_catalog_digest:preflight.expected_catalog_digest,
   expected_context_digest:preflight.expected_context_digest,claude_cap_micro_usd:5000,engine_config:{fixture:true},parent_execution_id:null});
  const nextLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...next,worker_job_id:'local-second-workspace'});assert.ok(nextLease);
  const nextCoverage=await consume(other,nextLease),nextModel=await artifact(other,nextLease,'engine_model'),nextOutput=await artifact(other,nextLease,'engine_output');
  await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease:nextLease,model_artifact_id:nextModel,output_artifact_id:nextOutput,result_kind:'computational_grouping',coverage:nextCoverage,
   model_configuration:{fixture:true},runtime_kind:'python',artifact_format:'joblib',license_key:'fixture-only'});
  const nextRequest=randomUUID();await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...otherAccess,...next,idempotency_key:nextRequest,
   request_digest:sha(nextRequest),configuration,reserved_micro_usd:1000,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:2000}),/daily_cap_exceeded/u);

 }finally{await f.cleanup();}
});

test('interpretation blocks reserved sends after observed overage and retries only an explicit definitely-not-sent predecessor', {skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  await prototypes(f);
  const configuration:money.SignalWorkspaceEngineInterpretationConfigurationV1={provider:'anthropic',model:'fixture-claude',prompt_digest:sha('prompt'),schema_digest:sha('schema'),pricing_version:'local-only',
   input_micro_usd_per_million_tokens:1_000_000,output_micro_usd_per_million_tokens:1_000_000,cache_read_micro_usd_per_million_tokens:0,cache_creation_micro_usd_per_million_tokens:0};
  const ready=async(cap:number)=>{const started=await f.begin(undefined,cap),lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-budget-guards'});assert.ok(lease);
   const coverage=await consume(f,lease),output=await artifact(f,lease,'engine_output');
   await engine.finishSignalWorkspaceEngineFitV1({database:f.database,lease,coverage,output_artifact_id:output,model_artifact_id:null,result_kind:'insufficient_population',
    model_configuration:{},runtime_kind:'python',artifact_format:'none',license_key:null});return started;
  };
  for(const scope of ['run','daily'] as const){await f.query('BEGIN');try{
   const started=await ready(scope==='run'?2000:5000),daily=scope==='daily'?2000:5000;
   const reserve=(key:string)=>money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,idempotency_key:key,request_digest:sha(key),configuration,
    reserved_micro_usd:1000,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:daily});
   const a=await reserve(randomUUID()),b=await reserve(randomUUID()),token={database:f.database,call_id:a.call_id,attempt_token:a.attempt_token};
   assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,true);
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/overage.json`,sha256:sha('overage'),size_bytes:10,http_status:200,provider_request_id:null}});
   await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:1500,output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0}});
   await assert.rejects(money.markSignalWorkspaceEngineInterpretationSentV1({database:f.database,call_id:b.call_id,attempt_token:b.attempt_token}),new RegExp(`${scope}_cap_exceeded`,'u'));
   assert.equal((await f.query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[b.call_id])).rows[0].call_state,'reserved');
   await f.query('BEGIN');try{
    await assert.rejects(f.query("UPDATE engine_cost_events SET call_state='in_flight',sent_at=clock_timestamp() WHERE id=$1::uuid",[b.call_id]),/reservation exceeds its budget/u);
   }finally{await f.query('ROLLBACK');}
   const budget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...f.access,...started});
   assert.equal(budget.confirmed_micro_usd,1500);assert.equal(budget.reserved_micro_usd,1000);assert.equal(budget.observed_exception_micro_usd,500);
  }finally{await f.query('ROLLBACK');}}
  const started=await ready(5000),key=randomUUID();
  const request={...f.access,...started,idempotency_key:key,request_digest:sha('exact retry payload'),configuration,
   reserved_micro_usd:1000,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:5000};
  const original=await money.reserveSignalWorkspaceEngineInterpretationV1(request),token={database:f.database,call_id:original.call_id,attempt_token:original.attempt_token};
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,true);
  await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:'definitely_not_sent',error_code:'workspace_engine_provider_disabled'});
  assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(request)).call_id,original.call_id);
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(token)).send_authorized,false);
  const nextRequest={...request,idempotency_key:randomUUID(),retry_of_call_id:original.call_id};
  const next=await money.reserveSignalWorkspaceEngineInterpretationV1(nextRequest);
  assert.notEqual(next.call_id,original.call_id);assert.notEqual(next.attempt_token,original.attempt_token);assert.equal(next.retry_of_call_id,original.call_id);
  assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(nextRequest)).call_id,next.call_id);
  assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1({...nextRequest,idempotency_key:randomUUID()})).call_id,next.call_id,'concurrent successor intention coalesces to the same physical attempt');
  const nextToken={database:f.database,call_id:next.call_id,attempt_token:next.attempt_token};
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(nextToken)).send_authorized,true);
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1(nextToken)).send_authorized,false);
  await money.failSignalWorkspaceEngineInterpretationV1({...nextToken,outcome:'outcome_unknown',error_code:'workspace_engine_transport_failed'});
  await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...nextRequest,idempotency_key:randomUUID(),retry_of_call_id:next.call_id}),/idempotency_conflict|retry_unavailable/u);
  assert.deepEqual((await f.query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[original.call_id])).rows,[{call_state:'definitely_not_sent'}]);
  const budget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...f.access,...started});
  assert.equal(budget.reserved_micro_usd,1000);assert.equal(budget.unknown_reserved_micro_usd,1000);
 }finally{await f.cleanup();}
});
