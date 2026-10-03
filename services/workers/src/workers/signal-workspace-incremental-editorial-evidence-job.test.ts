import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1,type SignalWorkspaceIncrementalCheckpointV1,type SignalWorkspaceEngineDatabaseV1,
 type SignalWorkspaceIncrementalArtifactRefV1,type SignalWorkspaceIncrementalEditorialPreparationLeaseV1} from '@noisia/db';
import {signalWorkspaceIncrementalEditorialEvidenceJobV1 as run,safeWorkspaceIncrementalEditorialPreparationErrorV1 as safe,type WorkspaceIncrementalEditorialEvidenceStoresV1} from './signal-workspace-incremental-editorial-evidence-job';
import {preparationEvidenceFixtureV1} from './signal-workspace-incremental-editorial-preparation.fixture';
import type {WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
const sha=(value:string|Buffer)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
async function fixture(){
 const f=await preparationEvidenceFixtureV1(),args=await f.args(),checkpoint:SignalWorkspaceIncrementalCheckpointV1={...args.current.checkpoint,output_artifact_id:id(10),descriptor_digest:sha('descriptor'),input_artifact_id:id(50),output_index_artifact_id:id(51),model_bank_artifact_id:id(52),model_version_id:id(53),history_artifact_id:id(54)};
 const workspace_id=args.current.checkpoint.workspace_id,numeric_execution_id=args.current.checkpoint.execution_id,actor_user_id=id(9),source_digest=sha('accepted current source');
 const worker_job_id=`workspace-incremental-editorial-evidence-${numeric_execution_id}-${source_digest.slice(7)}`;
 const lease:SignalWorkspaceIncrementalEditorialPreparationLeaseV1={workspace_id,numeric_execution_id,actor_user_id,source_digest,worker_job_id,preparation_token:id(11)};
 const objects=new Map<string,Buffer>(),refs:SignalWorkspaceIncrementalArtifactRefV1[]=[];
 for(const [i,name] of ['manifest.json','roots.jsonl','population.jsonl','memberships.jsonl','pending-cohort.jsonl','model-components.json','candidate-groups.json'].entries()){
  const body=await readFile(join(f.directory,name)),storage_key=`workspace-engine/${workspace_id}/${numeric_execution_id}/${name}.${sha(body).slice(7)}.parts.json`;objects.set(storage_key,body);
  refs.push({artifact_id:i===0?id(10):id(20+i),owner_execution_id:numeric_execution_id,artifact_key:name,storage_key,sha256:sha(body),size_bytes:body.length,media_type:'application/octet-stream',metadata:{}});
 }
 const counters={get:0,put:0,heartbeat:0,fragments:0,complete:0,fail:0,roots:0};let status='dispatched',lost=false,artifact:string|undefined,failCode:string|undefined;
 const uploads:Array<{file:string;sha256:string;size_bytes:number}>=[];
 const database={query:async()=>assert.fail('uninjected database IO'),connect:async()=>assert.fail('uninjected database connection')} as unknown as SignalWorkspaceEngineDatabaseV1;
 const storage:WorkspaceEngineStorageV1={get:async request=>{counters.get++;assert.equal(request.workspace_id,workspace_id);assert.equal(request.execution_id,numeric_execution_id);await writeFile(request.destination,objects.get(request.stored.storage_key)!);},
  put:async request=>{counters.put++;const body=await readFile(request.file);assert.equal(sha(body),request.sha256);assert.equal(body.length,request.size_bytes);uploads.push({file:basename(request.file),sha256:request.sha256,size_bytes:request.size_bytes});
   const storage_key=`workspace-engine/${workspace_id}/${numeric_execution_id}/${basename(request.file)}.${request.sha256.slice(7)}.parts.json`;objects.set(storage_key,body);return{storage_key,sha256:request.sha256,size_bytes:body.length,media_type:request.media_type};}};
 const stores:WorkspaceIncrementalEditorialEvidenceStoresV1={
  claim:async request=>{assert.equal(request.worker_job_id,worker_job_id);if(status==='completed')return{completed:true,artifact_id:artifact!};status='dispatched';return{completed:false,lease};},
  context:async()=>({lease,snapshot:{} as never,checkpoint,artifacts:refs.slice(0,6)}),
  heartbeat:async()=>{counters.heartbeat++;},
  roots:async request=>{const rows=f.roots.filter(root=>!request.after_root_id||root.root_id>request.after_root_id).slice(0,4);counters.roots+=rows.length;
   const items=rows.map(({unit_keys:_units,state:_state,discovery_pending:_pending,...root})=>root);return{items,next_cursor:items.at(-1)?.root_id??request.after_root_id??null,done:rows.length<4};},
  origins:async()=>({items:[{kind:'incremental',execution_id:numeric_execution_id,checkpoint,artifacts:refs}],next_cursor:numeric_execution_id,done:true}),
  exclusions:async()=>({items:[],next_cursor:null,done:true}),
  fragments:async request=>{counters.fragments++;assert.ok(request.references.length<=10);return [...await args.read_fragments(request.references)];},
  complete:async request=>{counters.complete++;assert.equal(request.evidence.census.roots,13);assert.equal(request.evidence.census.chunks,145);assert.equal(request.evidence.units.length,1);
   artifact=id(40);status='completed';if(lost){lost=false;throw Object.assign(Error('commit acknowledgement lost'),{code:'ECONNRESET'});}return{artifact_id:artifact,evidence_digest:request.evidence.evidence_digest,replayed:false};},
  fail:async request=>{counters.fail++;failCode=request.error_code;if(status!=='completed')status='failed';},
  reject:async request=>{failCode=request.error_code;},
 };
 const scratch=join(f.root,'job');await mkdir(scratch);
 const job={name:SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1,id:worker_job_id,data:{execution_id:numeric_execution_id,workspace_id,actor_user_id},updateProgress:async()=>{}};
 return{...f,job,stores,storage,database,scratch,counters,objects,uploads,lease,status:()=>status,error:()=>failCode,loseAck:()=>{lost=true;},invoke:(options:Partial<Parameters<typeof run>[1]>={})=>run(job,{database,stores,storage,scratch_root:scratch,...options})};
}
test('durable preparation downloads exact streams once, verifies EOF and final long-root fragment, never opens models or providers',async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('provider/network forbidden'));const f=await fixture();try{
  await f.invoke();assert.equal(f.counters.get,7);assert.equal(f.counters.put,2);assert.equal(f.counters.roots,13);assert.equal(f.counters.fragments,1);assert.ok(f.counters.heartbeat>10);assert.equal(f.status(),'completed');
  const stream=f.uploads.find(row=>row.file.endsWith('.jsonl'))!;const body=[...f.objects.values()].find(body=>sha(body)===stream.sha256)!;const cluster=JSON.parse(body.toString()).cluster;
  assert.equal(cluster.representatives[0].chunk_index,132);assert.equal(cluster.root_count,13);assert.equal(cluster.chunk_count,145);assert.deepEqual(await readdir(f.scratch),[]);
 }finally{await f.cleanup();}
});
test('completion ACK lost is read from durable outbox on replay without storage or scratch IO',async()=>{const f=await fixture();try{
 f.loseAck();await assert.rejects(f.invoke(),/preparation_transport_unavailable/u);assert.equal(f.status(),'completed');const prior={...f.counters};
 const result=await f.invoke({storage:{get:async()=>assert.fail('download on replay'),put:async()=>assert.fail('upload on replay')},scratch_root:'/not-created'});assert.equal(result.replayed,true);assert.deepEqual(f.counters,prior);
 }finally{await f.cleanup();}});
test('transport failure after uploading stream leaves no plan and retries the exact deterministic bytes',async()=>{const f=await fixture();try{
 const storage={...f.storage,put:async(request:Parameters<WorkspaceEngineStorageV1['put']>[0])=>{if(request.file.endsWith('.json'))throw Error('workspace_engine_storage_unavailable');return f.storage.put(request);}};
 await assert.rejects(f.invoke({storage}),/preparation_transport_unavailable/u);assert.equal(f.counters.complete,0);assert.equal(f.status(),'failed');const first=f.uploads[0];
 await f.invoke();assert.deepEqual(f.uploads[1],first);assert.equal(f.status(),'completed');assert.equal(f.counters.complete,1);
 }finally{await f.cleanup();}});
test('missing last DB root, revoked text, bad file SHA, or wrong scope never publish a plan',async t=>{
 for(const scenario of ['last-root','rights','sha','scope'] as const)await t.test(scenario,async()=>{const f=await fixture();try{
  if(scenario==='last-root'){const prior=f.stores.roots;f.stores.roots=async request=>{const page=await prior(request);return page.done?{...page,items:page.items.slice(0,-1),next_cursor:page.items.at(-2)?.root_id??request.after_root_id??null}:page;};}
  if(scenario==='rights')f.stores.fragments=async()=>{throw Error('workspace_incremental_editorial_preparation_source_stale');};
  if(scenario==='sha'){const key=[...f.objects.keys()].find(key=>key.includes('memberships.jsonl'))!;f.objects.set(key,Buffer.from('corrupt'));}
  if(scenario==='scope'){const prior=f.stores.context;f.stores.context=async request=>{const result=await prior(request);return{...result,lease:{...result.lease,workspace_id:id(800)}};};}
  await assert.rejects(f.invoke());assert.equal(f.counters.complete,0);assert.equal(f.counters.put,0);assert.notEqual(f.error(),'workspace_incremental_editorial_preparation_transport_unavailable');
 }finally{await f.cleanup();}});
});
test('only concrete transport codes are retryable; integrity, SQL check violations and generic errors stay terminal',()=>{
 for(const code of ['ECONNRESET','08006','40001','40P01'])assert.equal(safe(Object.assign(Error('private detail'),{code})),'workspace_incremental_editorial_preparation_transport_unavailable');
 for(const error of [Error('private detail'),Object.assign(Error('check violated'),{code:'23514'}),Error('workspace_incremental_projection_files_artifact_invalid')])assert.notEqual(safe(error),'workspace_incremental_editorial_preparation_transport_unavailable');
});
test('job identity is bound to execution and explicit evidence kind',async()=>{
 for(const data of [{execution_id:id(1),workspace_id:id(2),actor_user_id:id(3)},null])await assert.rejects(run({name:'wrong',id:'bad',data}),/preparation_job_invalid/u);
});
