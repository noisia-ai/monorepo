import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runMassLabelingAcceptanceFixtureV1} from '../../../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1,requestSignalListeningV1,loadSignalListeningCalibrationV1,prepareSignalListeningV1} from '@noisia/db';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as embeddingProfile,signalListeningBaseTemplateV1,signalListeningCalibrationShapeV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1} from '@noisia/query-engine';
import {createWorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {createSignalListeningRuntimeStoreV1,signalListeningJevJobV1,drainSignalListeningOnceV1} from './signal-listening-jev';
import {createBrandContextSyntheticVoyageProviderV1} from '../../../../infrastructure/db/migrations/signal-brand-context.synthetic.fixture';
import {signalWorkspaceEmbeddingsJobV1} from './signal-workspace-embeddings';
import type {JevProviderV1,JevRequestV1} from '../providers/typesafe-jev';
const execution={max_in_flight:64,flush_size:32,max_flushes:2,max_buffered_bytes:64*1024*1024,flush_interval_ms:5,window_size:200};
test('automatic listening runtime calibrates finite normal receipts, adds only missing questions and drains superseded failed raw from the dispatcher',{
 skip:process.env.NOISIA_R16_LISTENING_RUNTIME_PG!=='true',timeout:180000,
},async()=>{
 const previous={owner:process.env.NOISIA_SIGNAL_LISTENING_ENABLED,provider:process.env.NOISIA_JEV_PROVIDER_ENABLED,key:process.env.TYPESAFE_API_KEY,stream:process.env.NOISIA_JEV_STREAMING_V2_ENABLED};
 process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';process.env.NOISIA_JEV_PROVIDER_ENABLED='true';
 process.env.TYPESAFE_API_KEY='synthetic-test-only';process.env.NOISIA_JEV_STREAMING_V2_ENABLED='true';
 try{await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const directory=await mkdtemp(join(tmpdir(),'r16-runtime-pg-')),objects=new Map<string,string>();
  try{
   // Run the production multipart writer, manifests and verification reader. Its
   // HTTP boundary is a private fsync/readback emulator, never a remote bucket.
   const storage=createWorkspaceEngineStorageV1({url:'http://127.0.0.1',service_role_key:'synthetic',bucket:'corpus-files',fetch:async(url,options)=>{
    const path=new URL(String(url)).pathname;
    if(path.includes('/bucket/'))return Response.json({id:'corpus-files',public:false});
    const key=path.replace('/object/authenticated/','/object/');
    if(options?.method==='POST'){
     if(objects.has(key))return new Response(null,{status:409});
     const body=Buffer.from(options.body as Uint8Array),file=join(directory,createHash('sha256').update(key).digest('hex'));
     await writeFile(file,body,{flag:'wx'});const fd=await open(file,'r+');try{await fd.sync();}finally{await fd.close();}
     objects.set(key,file);assert.deepEqual(await readFile(file),body);return Response.json({});
    }
    const file=objects.get(key);return file?new Response(new Uint8Array(await readFile(file))):new Response(null,{status:404});
   }});
   const store=createSignalListeningRuntimeStoreV1(database,{execution,storage}),requests:JevRequestV1[]=[];
   const provider:JevProviderV1={max_concurrency:64,max_response_bytes:16384,async evaluate(request){requests.push(request);
    return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:120,output_tokens:20},
     answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:.1}:
      {type:'choice',choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(option=>[option,option==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))})};}};
   const runJob=(id:string)=>signalListeningJevJobV1(id,{database,store,provider,execution,preflight:async()=>{}});
   const base=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
   const first=await requestSignalListeningV1({...access,configuration_id:base.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   assert.equal((await runJob(first.run_id)).status,'completed');assert.equal(requests.length,3);
   const profile=await loadSignalListeningCalibrationV1({...access,configuration_digest:base.configuration_digest,model:base.configuration.model,
    shape_digest:signalListeningCalibrationShapeV1(base.configuration,{question_keys:['voice','promotion']}).shape_digest});
   assert.equal(profile?.sample_count,3);assert.equal(profile?.source_call_ids.length,3);assert.equal(profile?.source_run_id,first.run_id);
   const extra=await saveSignalListeningConfigurationV1({...access,expected_revision:base.revision,provenance:'human',configuration:{...base.configuration,
    questions:[...base.configuration.questions,{key:'occasion',type:'noul',text:'Is an occasion present?',positive:'An occasion is present.',negative:'No occasion.',scope:'all',origin:'brand_os',human_locked:true}]}});
   const second=await requestSignalListeningV1({...access,configuration_id:extra.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   assert.equal((await runJob(second.run_id)).status,'completed');assert.equal(requests.length,6);
   assert.ok(requests.slice(3).every(request=>Object.keys(request.questions).join(',')==='occasion'));
   const thirdCfg=await saveSignalListeningConfigurationV1({...access,expected_revision:extra.revision,provenance:'human',configuration:{...extra.configuration,
    questions:extra.configuration.questions.map(q=>q.key==='occasion'?{...q,text:'Is another occasion present?'}:q)}});
   const third=await requestSignalListeningV1({...access,configuration_id:thirdCfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const leased=await store.claim(third.run_id);assert.ok(leased);const input=(await store.inputs(leased))[0]!;
   const request=buildSignalListeningJevRequestV1(input,thirdCfg.configuration),request_digest=signalListeningRequestDigestV1(leased,input,request);
   const calls=await store.reserve(leased,[{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000}]);
   await store.markSubmitting(leased,calls);const receipt=await provider.evaluate(request);
   await store.persistRawPage(leased,[{call:calls[0]!,raw:JSON.stringify(receipt)}]);
   const newest=await saveSignalListeningConfigurationV1({...access,expected_revision:thirdCfg.revision,provenance:'human',configuration:{...thirdCfg.configuration,instructions:'Human revision after the paid raw receipt.'}});
   await store.release(leased);
   await database.query("UPDATE signal_labeling_runs SET status='failed',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1",[third.run_id]);
   const before=requests.length;await drainSignalListeningOnceV1({database,run:runJob});
   assert.equal(requests.length,before,'a superseded receipt is never physically sent again');
   assert.equal((await database.query('SELECT results_applied FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0].results_applied,true);
   assert.equal((await database.query('SELECT status FROM signal_labeling_runs WHERE id=$1',[third.run_id])).rows[0].status,'failed');
   const replacement=await requestSignalListeningV1({...access,configuration_id:newest.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   assert.ok(replacement.run_id);
   await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[replacement.run_id]);
   const defined=await saveSignalListeningConfigurationV1({...access,expected_revision:newest.revision,provenance:'human',configuration:{...newest.configuration,
    questions:[...newest.configuration.questions,...Array.from({length:9},(_,i)=>({key:'defined_'+i,type:'noul' as const,text:'Configured topic '+i,
      positive:'Exact bicycle positive '+i,negative:'Other content',scope:'all' as const,origin:'brand_os' as const,human_locked:true,topic_source:'defined' as const}))]}});
   // Grant the synthetic prototype action through the same draft/publish policy
   // guards. This is isolated fixture setup, never a runtime permission grant.
   const policyId=randomUUID();
   await database.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $2,p.organization_id,p.version+1,'draft',transaction_timestamp(),p.valid_until,p.budget_timezone,p.daily_cap_micro_usd,$3
    FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[access.workspace_id,policyId,access.actor_user_id]);
   await database.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $2,a.action,a.kind,a.provider,a.model,a.configuration,a.configuration_digest,a.max_execution_micro_usd,a.automatic_allowed
    FROM signal_processing_policy_actions a JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
    JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[access.workspace_id,policyId]);
   await database.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    VALUES($1,'topic_prototype_embeddings','provider','voyage','voyage-4-large',$2::jsonb,signal_semantic_context_digest_json_v2($2::jsonb),100000,false)`,[policyId,JSON.stringify(embeddingProfile)]);
   await database.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=(SELECT organization_id FROM signal_workspaces WHERE id=$1) AND status='active'",[access.workspace_id]);
   await database.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policyId]);
   const prepared=await prepareSignalListeningV1({...access,configuration_id:defined.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,
    provider_available:true,prototype_provider_available:true});
   assert.equal(prepared.status,'waiting_prototypes');assert.ok(prepared.prototype_run_id);
   const voyage=createBrandContextSyntheticVoyageProviderV1(),job=(await database.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[prepared.prototype_run_id])).rows[0]!;
   await signalWorkspaceEmbeddingsJobV1({id:job.worker_job_id,data:{run_id:prepared.prototype_run_id!},updateProgress:async()=>{}},{database,provider:voyage.provider});
   await drainSignalListeningOnceV1({database,run:runJob});
   const flow=(await database.query('SELECT listening_run_id,status FROM signal_listening_preparations WHERE id=$1',[prepared.preparation_id])).rows[0]!;
   assert.ok(flow.listening_run_id,'the dispatcher advances prototype completion into its governed listening child');
   assert.equal((await database.query('SELECT status FROM signal_labeling_runs WHERE id=$1',[flow.listening_run_id])).rows[0].status,'completed');
   assert.equal((await database.query('SELECT count(*)::int n FROM signal_listening_question_vectors WHERE configuration_id=$1',[defined.id])).rows[0].n,9);
   assert.ok(voyage.calls.length>0);

  }finally{await rm(directory,{recursive:true,force:true});}
 }});}finally{for(const[key,value]of [['NOISIA_SIGNAL_LISTENING_ENABLED',previous.owner],['NOISIA_JEV_PROVIDER_ENABLED',previous.provider],['TYPESAFE_API_KEY',previous.key],['NOISIA_JEV_STREAMING_V2_ENABLED',previous.stream]]as const)
  if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
