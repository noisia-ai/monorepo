import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,signalListeningCalibrationShapeV1,
 buildSignalListeningJevRequestV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalListeningInputV1,type SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
import type {LabelingCallV1} from '@noisia/db';
import {planSignalListeningCalibrationV1,createSignalListeningCalibratedProviderV1,createSignalListeningContinuationV1,
 type SignalListeningCalibrationEventV1} from './signal-listening-calibration';
const execution={max_in_flight:1024,flush_size:1024,max_flushes:2,max_buffered_bytes:512*1024*1024,flush_interval_ms:250,window_size:4096};
function fixture(){
 const draft=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 draft.questions.push({key:'topic',type:'noul',text:'Tea topic?',positive:'Present',negative:'Absent',scope:'all',origin:'brand_os',human_locked:true});
 const configuration=validateSignalListeningConfigurationV1(draft),configuration_digest=digest(configuration),workspace_id=randomUUID(),run_id=randomUUID();
 const input=(i:number,keys=['voice','promotion']):SignalListeningInputV1=>({root_id:randomUUID(),input_digest:digest(i),text:'tea '+i,
  title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01T00:00:00Z',language:'en',map_id:randomUUID(),
  configuration_digest,question_keys:keys,question_digests:Object.fromEntries(keys.map(key=>[key,digest(key)])),scope_basis:{}});
 const profile=(inputs:SignalListeningInputV1[],ids:string[]=Array.from({length:32},()=>randomUUID())):SignalListeningCalibrationProfileV1=>{
  const shape=signalListeningCalibrationShapeV1(configuration,inputs[0]!),sizes=inputs.map(i=>Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(i,configuration))));
  const scope={workspace_id,configuration_digest,model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
  return{scope,scope_digest:digest(scope),source_digest:digest(ids),source_run_id:run_id,source_call_ids:ids,sample_count:ids.length,status:'measured',
   request_min_bytes:Math.min(...sizes),request_max_bytes:Math.max(...sizes),max_input_tokens_per_byte:.25};
 };
 const calls=(inputs:SignalListeningInputV1[]):LabelingCallV1<SignalListeningInputV1>[]=>inputs.map(input=>{
  const request=buildSignalListeningJevRequestV1(input,configuration),id=randomUUID();
  const call:LabelingCallV1<SignalListeningInputV1>={id,custom_id:id,request_digest:digest({input,request}),request,inputs:[input],reserved_micro_usd:100,
   status:'reserved',raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0};
  return call;
 });
 const applied=(rows:ReturnType<typeof calls>)=>rows.map(call=>({call,results:[{status:'labeled'} as never]}));
 return{configuration,configuration_digest,workspace_id,run_id,input,profile,calls,applied};
}
for(const measured of [false,true])test(`initial ${measured?'4096-input measured page':'32-anchor bootstrap'} selection transfers once and leaves no public input/text custody`,async()=>{
 const f=fixture();let inputs=Array.from({length:4096},(_,i)=>({...f.input(i),text:'unique-private-corpus-sentinel '+i}));
 const profile=measured?f.profile(inputs):null,plan=await planSignalListeningCalibrationV1({...f,inputs,execution,loadProfile:async()=>profile});
 const options={run_id:f.run_id,initial_plan:plan,initial_inputs:inputs,execution,loadProfile:async()=>profile,deriveProfile:async()=>null,
  factory:()=>({evaluate:async()=>{throw Error('ownership proof must not send');}})};
 const controller=await createSignalListeningContinuationV1(options);
 await assert.rejects(controller.selectNext([inputs[0]!]),/listening_selection_not_transferred/,'a second page cannot coexist with an untransferred initial page');
 let selection=controller.takeInitialSelection();assert.equal(selection.length,measured?4096:32);
 assert.equal(Object.getOwnPropertyDescriptor(controller,'initial_selection'),undefined,'the former retained array must not exist as a public property');
 assert.equal(Object.values(controller).some(Array.isArray),false);
 assert.equal(JSON.stringify(controller).includes('unique-private-corpus-sentinel'),false);
 assert.throws(()=>controller.takeInitialSelection(),/listening_selection_already_transferred/,'a second transfer cannot recover an alias');
 // Simulate the caller's reservation handoff/release without GC: after it
 // discards the transferred page, bootstrap bookkeeping needs only IDs, not
 // the32 original objects; measured mode keeps only its paid small prefix.
 const calls=f.calls(measured?selection.slice(0,1):selection);controller.reserved(calls);
 const remaining=inputs.find(input=>!calls.some(call=>call.inputs[0]===input))!;
 selection=[];inputs=[];options.initial_inputs=[];plan.selected_inputs=[];
 const next=await controller.selectNext([remaining]);assert.equal(next.decision,measured?true:'wait_for_apply');
 await controller.applied(f.applied(calls));assert.equal(controller.failure().failed,false);
 if(!measured)assert.equal(controller.stopReason(),'listening_calibration_profile_unavailable');
 assert.throws(()=>controller.takeInitialSelection(),/listening_selection_already_transferred/);controller.closeObservation();await controller.runtime.provider.close!();
});
test('OLD finite calibration blocks covered work; NEW admits another measured shape while its complete bootstrap waits for APPLY',async()=>{
 const f=fixture(),anchors=Array.from({length:33},(_,i)=>f.input(i)),measured=Array.from({length:4},(_,i)=>f.input(i,['topic']));
 anchors[32]!.text='x'.repeat(1500);const known=f.profile(measured),profiles=new Map([[known.scope.shape_digest,known]]),events:SignalListeningCalibrationEventV1[]=[];
 let deferReload=false,loading=false,releaseReload!:()=>void,reloadStarted!:()=>void;
 const reloadGate=new Promise<void>(resolve=>{releaseReload=resolve;}),reloadEntered=new Promise<void>(resolve=>{reloadStarted=resolve;});
 const load=async(id:string)=>{if(deferReload){loading=true;reloadStarted();await reloadGate;}return profiles.get(id)??null;};
 const old=await planSignalListeningCalibrationV1({...f,inputs:[...anchors,...measured],execution,loadProfile:load});
 assert.equal(old.selected_inputs.length,32);assert.ok(old.selected_inputs.every(input=>input.question_keys.includes('voice')));
 assert.equal(createSignalListeningCalibratedProviderV1({plan:old}).prepareMeasuredRequests(measured.map(input=>buildSignalListeningJevRequestV1(input,f.configuration))),false);
 let release!:()=>void,deriving=false,observedUsage=0,closed=0;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:old,initial_inputs:[...anchors,...measured],execution,loadProfile:load,
  deriveProfile:async()=>{deriving=true;await gate;const derived=f.profile(selection,rows.map(call=>call.id));profiles.set(derived.scope.shape_digest,derived);deferReload=true;return derived;},
  observe:event=>events.push(event),factory:args=>({async evaluate(){return{body:'{}',http_status:200,latency_ms:1,
   rate_calibration:{labeler_digest:args.labeler_digest,input_bytes:100,kind:'official_context_bound'}};},async observeUsage(){assert.equal(closed,0);observedUsage++;},async close(){closed++;}})});
 const selection=controller.takeInitialSelection(),rows=f.calls(selection);controller.reserved(rows);
 const remaining=anchors.filter(input=>!selection.includes(input));
 const waiting=await controller.selectNext([...remaining,...measured]);assert.equal(waiting.decision,true);assert.deepEqual(waiting.selected,measured);
 assert.equal((await controller.selectNext(remaining)).decision,'wait_for_apply');assert.equal(controller.minimumNextCalls(),0);
 const raw=await controller.runtime.provider.evaluate(buildSignalListeningJevRequestV1(selection[0]!,f.configuration));
 await controller.applied(f.applied(rows.slice(0,16)));assert.equal(deriving,false);
 assert.deepEqual(await controller.selectNext(remaining),{selected:[],decision:'wait_for_apply'},'first ACK leaves bootstrap calls pending');
 const promotion=controller.applied(f.applied(rows.slice(16)));assert.ok(deriving);assert.equal(closed,0);assert.equal(events.filter(e=>e.transition==='bootstrap_end').length,0);
 assert.deepEqual(await controller.selectNext(remaining),{selected:[],decision:'wait_for_apply'},'final ACK empties pending but native derivation still holds warming-shape admission');
 assert.deepEqual((await controller.selectNext([...remaining,...measured])).selected,measured,'Native derivation must ACK before warming-shape admission');
 release();await reloadEntered;assert.ok(loading);
 assert.deepEqual(await controller.selectNext(remaining),{selected:[],decision:'wait_for_apply'},'derived evidence must finish reload before warming-shape admission');
 assert.equal(events.filter(e=>e.transition==='bootstrap_end').length,0);
 releaseReload();await promotion;assert.equal(controller.failure().failed,false);
 assert.deepEqual(await controller.selectNext(remaining),{selected:remaining,decision:true});
 await controller.runtime.provider.observeUsage!(raw,100);assert.equal(observedUsage,1);assert.equal(closed,0,'promotion retains the official client for post-APPLY usage');
 assert.deepEqual(controller.execution,execution);assert.equal(controller.runtime.provider.max_response_bytes,controller.response_bound_bytes);
 assert.deepEqual(events.filter(e=>e.transition==='bootstrap_end').map(e=>e.outcome),['measured']);await controller.runtime.provider.close!();assert.ok(closed>=1);
});
test('one HTTP slot still selects the whole32 cohort including a distant extreme; retained memory is checked before any client',async()=>{
 const f=fixture(),inputs=Array.from({length:80},(_,i)=>f.input(i));inputs[79]!.text='x'.repeat(4000);
 const e={...execution,max_in_flight:1},plan=await planSignalListeningCalibrationV1({...f,inputs,execution:e,loadProfile:async()=>null});
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:inputs,execution:e,
  loadProfile:async()=>null,deriveProfile:async()=>null,factory:()=>({evaluate:async()=>{throw Error('no physical send in selection');}})});
 const selection=controller.takeInitialSelection();assert.equal(controller.bootstrap_initial_calls,32);assert.equal(controller.minimumNextCalls(),32);assert.ok(selection.includes(inputs[79]!));assert.equal(controller.execution.max_in_flight,1);
 const rows=f.calls(selection);controller.reserved(rows);assert.equal((await controller.selectNext(inputs.filter(i=>!selection.includes(i)))).decision,'wait_for_apply');
 let clients=0;await assert.rejects(createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:inputs,
  execution:{...e,max_buffered_bytes:458752},loadProfile:async()=>null,deriveProfile:async()=>null,factory:()=>{clients++;throw Error('must check retained memory first');}}),/selection_memory_bound/);assert.equal(clients,0);
 await controller.runtime.provider.close!();
});
for(const outcome of ['null','foreign','revoked','missing_source'] as const)test(`bootstrap cannot promote ${outcome} evidence; APPLY ACK is preserved and later admission stops`,async()=>{
 const f=fixture(),inputs=Array.from({length:32},(_,i)=>f.input(i));let profile:SignalListeningCalibrationProfileV1|null=null;
 const plan=await planSignalListeningCalibrationV1({...f,inputs,execution,loadProfile:async()=>null});
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:inputs,execution,loadProfile:async()=>profile,
  deriveProfile:async()=>{if(outcome==='revoked')throw Error('listening_forbidden');if(outcome==='null')return null;
   profile=f.profile(inputs,rows.map(call=>call.id));if(outcome==='foreign')profile.scope.workspace_id=randomUUID();if(outcome==='missing_source')profile.source_call_ids[0]=randomUUID();return profile;},
  factory:()=>({evaluate:async()=>{throw Error('no send');}})});
 const rows=f.calls(controller.takeInitialSelection());controller.reserved(rows);await controller.applied(f.applied(rows));
 assert.equal((await controller.selectNext([f.input(100)])).decision,false);assert.equal(controller.failure().failed,outcome!=='null');
 assert.equal(controller.stopReason(),outcome==='null'?'listening_calibration_profile_unavailable':'listening_calibration_failed');await controller.runtime.provider.close!();
});
test('a future larger response schema ends admission before profile loading, reservation or a larger client allowance',async()=>{
 const f=fixture(),wideKeys=['wide_a','wide_b','wide_c'],draft={...f.configuration,questions:[...f.configuration.questions,...wideKeys.map(key=>({key,type:'choice' as const,text:'Wide?',scope:'all' as const,origin:'brand_os' as const,human_locked:true,
  options:Array.from({length:32},(_,i)=>({key:'key_'+i+'x'.repeat(55),definition:'Option '+i}))}))]};
 const configuration=validateSignalListeningConfigurationV1(draft),configuration_digest=digest(configuration),base={...f.input(1),configuration_digest},wide={...f.input(2,wideKeys),configuration_digest};
 const shape=signalListeningCalibrationShapeV1(configuration,base),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(base,configuration)));
 const profile={...f.profile([base]),scope:{...f.profile([base]).scope,configuration_digest,shape_digest:shape.shape_digest},request_min_bytes:bytes,request_max_bytes:bytes};
 let loads=0,clients=0;const plan=await planSignalListeningCalibrationV1({...f,configuration,configuration_digest,inputs:[base],execution,loadProfile:async()=>profile});
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:[base],execution,
  loadProfile:async()=>{loads++;throw Error('wider schema must stop before loading');},deriveProfile:async()=>null,factory:args=>{clients++;assert.equal(args.env!.NOISIA_JEV_MAX_RESPONSE_BYTES,'16384');return{evaluate:async()=>{throw Error('no send');}};}});
 controller.takeInitialSelection();assert.equal((await controller.selectNext([wide])).decision,false);assert.equal(controller.stopReason(),'listening_calibration_response_bound_changed');assert.equal(loads,0);assert.equal(clients,1);assert.equal(controller.response_bound_bytes,16384);await controller.runtime.provider.close!();
});

for(const count of [1,3,7,8,32])test(`bootstrap priority ${count} consumes only a real covered ACK and releases after finite promotion`,async()=>{
 const f=fixture(),anchors=Array.from({length:count},(_,i)=>f.input(i)),measured=Array.from({length:4},(_,i)=>f.input(i,['topic']));
 const known=f.profile(measured),profiles=new Map([[known.scope.shape_digest,known]]);
 const load=async(shape:string)=>profiles.get(shape)??null;
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[...anchors,...measured],execution,loadProfile:load});
 let selected:SignalListeningInputV1[]=[],rows:ReturnType<typeof f.calls>=[];
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:[...anchors,...measured],execution,loadProfile:load,
  deriveProfile:async()=>{const profile=f.profile(selected,rows.map(row=>row.id));profiles.set(profile.scope.shape_digest,profile);return profile;},
  factory:()=>({evaluate:async()=>{throw Error('selection-only regression cannot send');}})});
 selected=controller.takeInitialSelection();rows=f.calls(selected);controller.reserved(rows);
 const initial=controller.nextAdmissionHint();assert.equal(initial.kind,'bootstrap');if(initial.kind!=='bootstrap')throw Error('missing bootstrap hint');
 assert.equal(initial.covered_call_limit,count);assert.equal(initial.wait_for_apply,false);assert.equal(initial.acknowledged_covered_calls,0);
 // Selection alone never consumes the scheduling permit. This includes the
 // exact existing32+4 contract, and deliberately leaves selectNext untrimmed.
 for(let i=0;i<2;i++)assert.deepEqual(await controller.selectNext(measured),{selected:measured,decision:true});
 assert.deepEqual(controller.nextAdmissionHint(),initial);
 const overlap=f.calls(measured.slice(0,Math.min(count,4)));controller.reserved(overlap);
 const acknowledged=controller.nextAdmissionHint();assert.equal(acknowledged.kind,'bootstrap');
 if(acknowledged.kind!=='bootstrap')throw Error('missing ACK hint');
 assert.equal(acknowledged.wait_for_apply,true);assert.equal(acknowledged.acknowledged_covered_calls,overlap.length);
 controller.reserved(overlap);assert.deepEqual(controller.nextAdmissionHint(),acknowledged,'duplicate ACK IDs never replenish or consume another permit');
 await controller.applied(f.applied(rows));assert.equal(controller.failure().failed,false);assert.deepEqual(controller.nextAdmissionHint(),{kind:'open'});
 const remaining=measured.slice(overlap.length);assert.deepEqual(await controller.selectNext(remaining),{selected:remaining,decision:remaining.length?true:false});
 // A late notification from the old generation must not consume a newly
 // opened small bootstrap. No request or permission is carried by this hint.
 await controller.selectNext([f.input(999)]);const later=controller.nextAdmissionHint();assert.equal(later.kind,'bootstrap');
 if(later.kind!=='bootstrap')throw Error('missing next bootstrap hint');assert.notEqual(later.bootstrap_id,initial.bootstrap_id);
 controller.acknowledgeCoveredReservation(initial.bootstrap_id,overlap.map(row=>row.id));assert.deepEqual(controller.nextAdmissionHint(),later);
 controller.closeObservation();await controller.runtime.provider.close!();
});
test('bootstrap priority stays deferred through pending APPLY, derive and reload without changing the existing measured selection',async()=>{
 const f=fixture(),anchors=Array.from({length:32},(_,i)=>f.input(i)),measured=Array.from({length:4},(_,i)=>f.input(i,['topic']));
 const known=f.profile(measured),profiles=new Map([[known.scope.shape_digest,known]]);
 let releaseDerive!:()=>void,releaseReload!:()=>void,reloadStarted!:()=>void,reloading=false;
 const deriveGate=new Promise<void>(resolve=>{releaseDerive=resolve;}),reloadGate=new Promise<void>(resolve=>{releaseReload=resolve;}),reloadEntered=new Promise<void>(resolve=>{reloadStarted=resolve;});
 const load=async(shape:string)=>{if(reloading){reloadStarted();await reloadGate;}return profiles.get(shape)??null;};
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[...anchors,...measured],execution,loadProfile:load});
 let selected:SignalListeningInputV1[]=[],rows:ReturnType<typeof f.calls>=[];
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:[...anchors,...measured],execution,loadProfile:load,
  deriveProfile:async()=>{await deriveGate;const profile=f.profile(selected,rows.map(row=>row.id));profiles.set(profile.scope.shape_digest,profile);reloading=true;return profile;},
  factory:()=>({evaluate:async()=>{throw Error('no physical request in metadata test');}})});
 selected=controller.takeInitialSelection();rows=f.calls(selected);controller.reserved(rows);controller.reserved(f.calls(measured));
 const waiting=()=>{const hint=controller.nextAdmissionHint();assert.equal(hint.kind,'bootstrap');if(hint.kind==='bootstrap')assert.equal(hint.wait_for_apply,true);};
 waiting();await controller.applied(f.applied(rows.slice(0,16)));waiting();
 const promotion=controller.applied(f.applied(rows.slice(16)));waiting();
 assert.deepEqual((await controller.selectNext(measured)).selected,measured,'the established measured overlap selection remains byte-equivalent');
 releaseDerive();await reloadEntered;waiting();releaseReload();await promotion;
 assert.deepEqual(controller.nextAdmissionHint(),{kind:'open'});await controller.runtime.provider.close!();
});
