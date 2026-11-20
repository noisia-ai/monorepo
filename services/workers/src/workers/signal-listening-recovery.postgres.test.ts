import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runMassLabelingAcceptanceFixtureV1} from '../../../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1,requestSignalListeningV1,deriveSignalListeningCalibrationV1,loadSignalListeningCalibrationV1,type LabelingCallV1,type LabelingRunV1} from '@noisia/db';
import {signalListeningBaseTemplateV1,signalListeningRequestDigestV1,buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,
 signalListeningCalibrationShapeV1,type SignalListeningInputV1} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from '../../../../infrastructure/db/migrations/signal-listening-localized.synthetic.fixture';
import {createWorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {createSignalListeningRuntimeStoreV1,signalListeningJevJobV1} from './signal-listening-jev';
import {jevUsageV1} from './signal-jev-labeling-page';
const execution={max_in_flight:64,flush_size:32,max_flushes:2,max_buffered_bytes:64*1024*1024,flush_interval_ms:5,window_size:200};
test('metadata recovery finds paid and rejected raw beyond32 before calibrating another shape, reads its single page once and preserves unknown money',{
 skip:process.env.NOISIA_R16_LISTENING_RECOVERY_PG!=='true',timeout:600000,
},async()=>{
 const owner=process.env.NOISIA_SIGNAL_LISTENING_ENABLED;process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';
 try{await runMassLabelingAcceptanceFixtureV1('product-recovery',{beforeProcessing:async ctx=>{
  const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,questions:[...base.questions,
   {key:'occasion',type:'noul',text:'Consumer occasion?',positive:'Configured positive '.repeat(60),negative:'Not present',scope:'consumer_category',origin:'brand_os',human_locked:true}]})});
  const request=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const directory=await mkdtemp(join(tmpdir(),'r16-recovery-pg-')),objects=new Map<string,string>();
  try{
   const storage=createWorkspaceEngineStorageV1({url:'http://127.0.0.1',service_role_key:'synthetic',bucket:'corpus-files',fetch:async(url,options)=>{
    const path=new URL(String(url)).pathname;if(path.includes('/bucket/'))return Response.json({id:'corpus-files',public:false});
    const key=path.replace('/object/authenticated/','/object/');
    if(options?.method==='POST'){
     if(objects.has(key))return new Response(null,{status:409});const bytes=Buffer.from(options.body as Uint8Array),file=join(directory,createHash('sha256').update(key).digest('hex'));
     await writeFile(file,bytes,{flag:'wx'});const fd=await open(file,'r+');try{await fd.sync();}finally{await fd.close();}objects.set(key,file);assert.deepEqual(await readFile(file),bytes);return Response.json({});
    }
    const file=objects.get(key);return file?new Response(new Uint8Array(await readFile(file))):new Response(null,{status:404});
   }});
   let loads=0;const get=storage.get;storage.get=async args=>{loads++;await get(args);};
   const store=createSignalListeningRuntimeStoreV1(database,{execution,storage}),run=await store.claim(request.run_id);assert.ok(run);
   const proposals=(inputs:SignalListeningInputV1[])=>inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,cfg.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
    return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};});
   const outcome=(call:LabelingCallV1<SignalListeningInputV1>)=>({model:cfg.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(
    Object.entries(buildSignalListeningJevRequestV1(call.inputs[0]!,cfg.configuration).questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:.1}:
      {type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(option=>[option,option==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))});
   const seed=await store.reserve(run,proposals((await store.inputs(run)).slice(0,32)));await store.markSubmitting(run,seed);
   await store.persistRawPage(run,seed.map(call=>({call,raw:JSON.stringify({http_status:200,latency_ms:1,body:JSON.stringify(outcome(call))})})));
   await store.settlePage(run,seed.map(call=>({call,usage:jevUsageV1(outcome(call).usage),settled_micro_usd:6})));
   await store.apply(run,seed.map(call=>({call,results:[mapSignalListeningJevResponseV1(call.inputs[0]!,run.context,cfg.configuration,outcome(call))]})));
   const shape=signalListeningCalibrationShapeV1(cfg.configuration,seed[0]!.inputs[0]!);
   const profile=await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest});assert.equal(profile?.sample_count,32);
   const pending=await store.inputs(run),consumer=pending.find(input=>input.question_keys.length===1&&input.question_keys[0]==='occasion')!;assert.ok(consumer);
   const inputs=[consumer,...pending.filter(input=>input.question_keys.includes('voice')).slice(0,39)];assert.equal(inputs.length,40);
   const calls=await store.reserve(run,proposals(inputs));
   // Native reserve order is created_at/id; pick receipt33 from that exact order.
   const ordered=[...calls].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id));
   const paid=ordered.slice(33,35),rejected=ordered[35]!,unknown=ordered[39]!;
   await store.markSubmitting(run,[...paid,rejected,unknown]);
   await store.markFailed(run,[paid[0]!,rejected,unknown],true);
   await store.persistRawPage(run,[...paid.map(call=>({call,raw:JSON.stringify({http_status:200,latency_ms:1,body:JSON.stringify(outcome(call))})})),
    {call:rejected,raw:JSON.stringify({http_status:429,latency_ms:1,body:JSON.stringify({error:'synthetic rate limit',usage:{input_tokens:0,output_tokens:0}})})}]);
   // Settlement committed but its acknowledgement was lost before application.
   await store.settlePage(run,[{call:paid[1]!,usage:jevUsageV1(outcome(paid[1]!).usage),settled_micro_usd:6}]);
   for(const bad of [[paid[0]!.id,paid[0]!.id],['invalid-uuid'],Array.from({length:201},()=>randomUUID())])
    await assert.rejects(store.calls(run,{metadata_only:true,call_ids:bad}),/call_selection_invalid/);
   await assert.rejects(store.calls({...run,lease_token:randomUUID()},{metadata_only:true}),/lease_lost/);
   await assert.rejects(store.calls({...run,actor_user_id:randomUUID()},{metadata_only:true}),/forbidden/);
   await assert.rejects(store.calls({...run,workspace_id:randomUUID()},{metadata_only:true}),/policy_changed|forbidden|context_changed/);
   assert.deepEqual(await store.calls(run,{call_ids:[randomUUID()]}),[]);
   const beforeMeta=loads,metadata=await store.calls(run,{metadata_only:true});assert.equal(loads,beforeMeta);
   assert.equal(metadata[0]!.has_raw,true);assert.ok(metadata.every(call=>call.raw_body===null&&call.inputs.length===0&&Object.keys(call.request).length===0&&Number(call.request_size_bytes)>0));
   await store.release(run,{immediate:true});
   await database.query("UPDATE signal_labeling_runs SET next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
   const boundedBefore=loads;
   await assert.rejects(signalListeningJevJobV1(run.id,{database,store,execution:{...execution,max_buffered_bytes:1},preflight:async()=>{},
    provider:{evaluate:async()=>{throw Error('must never send');}},calibration:{load:async()=>{throw Error('must not calibrate');},derive:deriveSignalListeningCalibrationV1}}),/memory_budget_exceeded/);
   assert.equal(loads,boundedBefore,'insufficient memory fails before downloading or parsing any artifact');
   let sends=0,calibrations=0;const before=loads;
   const processed=await signalListeningJevJobV1(run.id,{database,store,execution,preflight:async()=>{},provider:{evaluate:async()=>{sends++;throw Error('no new sends before reconciliation');}},
    calibration:{load:async()=>{calibrations++;throw Error('must reconcile before calibrating the consumer outlier');},derive:deriveSignalListeningCalibrationV1}});
   assert.equal(sends,0);assert.equal(calibrations,0);assert.equal(loads-before,1,'three members share one authenticated page download and parse');
   assert.equal(processed.labeled,2);
   assert.equal((await loadSignalListeningCalibrationV1({...access,configuration_digest:cfg.configuration_digest,model:cfg.configuration.model,shape_digest:shape.shape_digest}))?.source_digest,profile?.source_digest,'covered recovery preserves the earlier measured coverage');
   for(const call of paid){const row=(await database.query('SELECT status,results_applied,settled_micro_usd::text FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0]!;
    assert.equal(row.status,'settled');assert.equal(row.results_applied,true);assert.equal(row.settled_micro_usd,'6');}
   const unresolved=(await database.query('SELECT status,results_applied,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=$1',[unknown.id])).rows[0]!;
   assert.deepEqual(unresolved,{status:'unknown',results_applied:false,reserved_micro_usd:'1000'});
   assert.equal((await database.query('SELECT status FROM signal_labeling_calls WHERE id=$1',[rejected.id])).rows[0].status,'unknown');
   const untouched=ordered.filter(call=>!paid.includes(call)&&call!==rejected&&call!==unknown);
   assert.equal((await database.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) AND status='reserved' AND NOT results_applied",[untouched.map(call=>call.id)])).rows[0].n,untouched.length);
   await assert.rejects(requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true}),/already_active|prior_outcome_unresolved|outcome_unknown/);
  }finally{await rm(directory,{recursive:true,force:true});}
 }});}finally{if(owner===undefined)delete process.env.NOISIA_SIGNAL_LISTENING_ENABLED;else process.env.NOISIA_SIGNAL_LISTENING_ENABLED=owner;}
});
