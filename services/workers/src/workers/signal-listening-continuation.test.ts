import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,signalListeningCalibrationShapeV1,
 buildSignalListeningJevRequestV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalListeningInputV1,type SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingInputBoundsV1,SignalListeningInputHintV1,SignalListeningInputSurveyV1} from '@noisia/db';
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

// Regression: one clientInfo per request and cooperative descriptor preparation.
test('continuation descriptor preparation yields during real clientInfo, validates once and rejects mutation again at SEND',async()=>{
 const f=fixture(),input=f.input(700),known=f.profile([input]);
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[input],execution,loadProfile:async()=>known});
 let inspections=0,clients=0,physical=0;
 const counted=Object.defineProperty({...known},'source_call_ids',{enumerable:true,get(){inspections++;return known.source_call_ids;}});
 plan.profiles.set(known.scope.shape_digest,counted);
 const make=()=>createSignalListeningCalibratedProviderV1({plan,continuation:{warmingShape:()=>undefined,allowsOfficial:()=>false,consumeOfficial:()=>assert.fail('measured preparation is not an official physical request')},
  factory:()=>{clients++;return{evaluate:async()=>{physical++;throw Error('a mutated request must not reach transport');}};}});
 const baseline=make(),request=buildSignalListeningJevRequestV1(input,f.configuration);
 baseline.prepareRequests([request]);const oneValidation=inspections;assert.ok(oneValidation>0);
 inspections=0;assert.equal(baseline.prepareContinuationRequests([request,request,request]),true);assert.equal(inspections,3*oneValidation);
 await baseline.provider.close!();
 for(const invalidate of[false,true]){
  const runtime=make();clients=0;inspections=0;let valid=true,during=0;
  const timer=new Promise<void>(resolve=>setImmediate(()=>{during=inspections;if(invalidate)valid=false;resolve();}));
  const staged=await runtime.prepareContinuationRequestsAsync(Array.from({length:128},()=>request),{valid:()=>valid});await timer;
  assert.equal(during,64*oneValidation,'the event-loop callback runs DURING clientInfo preparation, not only before or after it');
  assert.equal(clients,0,'descriptors create no definitive client before the final epoch check');
  if(invalidate){assert.equal(staged.kind,'stale');assert.equal(inspections,64*oneValidation);}
  else{
   assert.equal(inspections,128*oneValidation,'each async request has one validation, not two full passes');
   assert.equal(staged.kind,'prepared');if(staged.kind!=='prepared')assert.fail('expected staged descriptors');
   assert.equal(staged.activate(),'ready');assert.equal(clients,1);assert.throws(()=>staged.activate(),/preparation_already_transferred/);
   Object.assign(request,{model:'changed-after-preparation'});await assert.rejects(runtime.provider.evaluate(request),/listening_request_plan_changed/);
   assert.equal(physical,0,'preparation descriptors are not an authorization or send-time body cache');request.model=f.configuration.model;
  }
  await runtime.provider.close!();
 }
});

function scopedSurveyMock(current:()=>SignalListeningInputV1[],options:{stateBytes?:(input:SignalListeningInputV1,index:number)=>number;
 stale?:(ids:readonly string[])=>boolean;working?:(input:SignalListeningInputV1)=>number}={}){
 let active=false,reads=0;const hydration:Array<{read:number;ids:string[]}>=[],encoded:string[]=[];
 const working=options.working??(()=>65536);
 const read=async<T>(bounds:LabelingInputBoundsV1,body:(scope:SignalListeningInputSurveyV1)=>Promise<T>):Promise<T>=>{
  assert.equal(active,false,'one owned client/RR, never a nested acquisition');active=true;const sequence=++reads;
  const inputs=[...current()].sort((a,b)=>a.root_id.localeCompare(b.root_id)),byRoot=new Map(inputs.map(input=>[input.root_id,input]));
  try{const hints:SignalListeningInputHintV1[]=[];let bytes=0;
   for(const[index,input]of inputs.entries()){
    if(hints.length>=bounds.max_rows)break;
    const cost=working(input);if(bytes+cost>bounds.max_working_bytes){bounds.on_byte_limit?.();if(!hints.length&&bounds.on_oversize==='error')throw Error('labeling_input_memory_bound');break;}
    bytes+=cost;encoded.push(input.root_id);
    hints.push(Object.freeze({root_id:input.root_id,input_digest:input.input_digest,working_bytes:String(cost),
     state_json_bytes:options.stateBytes?.(input,index)??Buffer.byteLength(JSON.stringify(input.text)),question_keys:Object.freeze([...input.question_keys]),
     question_digests:Object.freeze({...input.question_digests}),scope_basis:Object.freeze({...input.scope_basis})}));
   }
   const allowed=new Set(hints.map(hint=>hint.root_id));
   return await body({hints:Object.freeze(hints),retained_bytes:1024*1024,async hydrate(ids,budget){
    assert.equal(active,true,'all body reads must stay in the same RR callback');assert.ok(ids.length>0&&ids.length<=1024);assert.equal(new Set(ids).size,ids.length);
    assert.ok(ids.every(id=>allowed.has(id)));hydration.push({read:sequence,ids:[...ids]});
    if(options.stale?.(ids)||ids.some(id=>!byRoot.has(id)))return{kind:'stale'};
    const retained=ids.reduce((sum,id)=>sum+working(byRoot.get(id)!),0);if(retained>budget.max_working_bytes)return{kind:'stale'};
    return{kind:'ready',inputs:ids.map(id=>structuredClone(byRoot.get(id)!)),retained_bytes:retained};
   }});
  }finally{active=false;}
 };
 return{read,hydration,encoded,state:()=>({active,reads}),storage_bound:1024*1024};
}
function orderedInput(f:ReturnType<typeof fixture>,index:number,keys=['voice','promotion']){
 const hex=index.toString(16).padStart(32,'0'),root_id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 return{...f.input(index,keys),root_id};
}
async function measuredSurveyController(f:ReturnType<typeof fixture>,inputs:SignalListeningInputV1[],reader:ReturnType<typeof scopedSurveyMock>,
 profiles=new Map<string,SignalListeningCalibrationProfileV1>(),events:SignalListeningCalibrationEventV1[]=[]){
 const known=f.profile([inputs[0]!,inputs.at(-1)!]);profiles.set(known.scope.shape_digest,known);
 const load=async(id:string)=>{assert.equal(reader.state().active,false,'profile SQL belongs outside the RR/poolmax1 callback');return profiles.get(id)??null;};
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[inputs[0]!],execution,loadProfile:load});
 const controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:[inputs[0]!],execution,loadProfile:load,deriveProfile:async()=>null,observe:event=>events.push(event),
  factory:()=>{assert.equal(reader.state().active,false,'final runtime client construction belongs outside RR');return{evaluate:async()=>{throw Error('selection proof must not physically send');}};}});
 controller.takeInitialSelection();return controller;
}
const surveyArgs=(reader:ReturnType<typeof scopedSurveyMock>)=>({available_bytes:execution.max_buffered_bytes,max_calls:4096,
 storage_bound:reader.storage_bound,signal:new AbortController().signal,read:reader.read});

test('fresh4096 metadata survey hydrates and prepares only the bounded1024 measured prefix',async()=>{
 const f=fixture(),inputs=Array.from({length:4096},(_,i)=>orderedInput(f,i)),reader=scopedSurveyMock(()=>inputs),controller=await measuredSurveyController(f,inputs,reader);
 const next=await controller.selectNextSurvey(surveyArgs(reader));assert.equal(next.decision,true);assert.equal(next.selected.length,1024);
 assert.deepEqual(next.selected.map(input=>input.root_id),inputs.slice(0,1024).map(input=>input.root_id));assert.deepEqual(reader.hydration.map(call=>call.ids.length),[1024]);
 assert.equal(reader.encoded.length,4096,'the whole survey precedes prefix selection');assert.equal(reader.state().active,false);assert.equal(next.byte_limited,false);
 assert.equal(controller.preparationValid(next.preparation_epoch),true);controller.closeObservation();await controller.runtime.provider.close!();
});

test('the last FITTING4096-root outlier selects global32 anchors before any Native admission',async()=>{
 const f=fixture(),inputs=Array.from({length:4097},(_,i)=>orderedInput(f,i));inputs[4095]!.text='tea '+('z'.repeat(5000));inputs[4096]!.text='non-fitting body must never be encoded';
 const reader=scopedSurveyMock(()=>inputs,{working:input=>input===inputs[4096]?execution.max_buffered_bytes:65536}),events:SignalListeningCalibrationEventV1[]=[];
 const controller=await measuredSurveyController(f,inputs.slice(0,4095),reader,new Map(),events),next=await controller.selectNextSurvey(surveyArgs(reader));
 assert.equal(next.decision,true);assert.equal(next.selected.length,32);assert.deepEqual(next.selected.slice(0,2).map(input=>input.root_id),[inputs[0]!.root_id,inputs[4095]!.root_id]);
 assert.deepEqual(next.selected.slice(2).map(input=>input.root_id),inputs.slice(1,31).map(input=>input.root_id));
 assert.deepEqual(reader.hydration.map(call=>call.ids.length),[32]);assert.equal(reader.encoded.includes(inputs[4096]!.root_id),false);
 assert.equal(controller.minimumNextCalls(),32);assert.equal(controller.nextAdmissionHint().kind,'bootstrap');assert.equal(events.filter(event=>event.transition==='bootstrap_start').length,1);
 controller.closeObservation();await controller.runtime.provider.close!();
});

test('a missing metadata shape loads its profile only after RR release and reopens a fresh survey',async()=>{
 const f=fixture(),initial=[orderedInput(f,1)],pending=Array.from({length:40},(_,i)=>orderedInput(f,100+i,['topic'])),reader=scopedSurveyMock(()=>pending),profiles=new Map<string,SignalListeningCalibrationProfileV1>();
 const known=f.profile([pending[0]!,pending.at(-1)!]);profiles.set(known.scope.shape_digest,known);
 const controller=await measuredSurveyController(f,initial,reader,profiles),next=await controller.selectNextSurvey(surveyArgs(reader));
 assert.equal(next.decision,true);assert.equal(next.selected.length,40);assert.equal(reader.state().reads,2);assert.deepEqual(reader.hydration.map(call=>call.ids.length),[40]);
 assert.equal(reader.state().active,false);assert.equal(controller.nextAdmissionHint().kind,'open');controller.closeObservation();await controller.runtime.provider.close!();
});

test('measured metadata preparation yields during the4096 scan and BASE APPLY invalidates it before a newly earlier consumer is selected',async()=>{
 const f=fixture();let inputs=Array.from({length:4096},(_,i)=>orderedInput(f,100+i));const original=inputs,reader=scopedSurveyMock(()=>inputs),profiles=new Map<string,SignalListeningCalibrationProfileV1>();
 const consumer=orderedInput(f,1,['topic']),knownConsumer=f.profile([consumer]);profiles.set(knownConsumer.scope.shape_digest,knownConsumer);
 const controller=await measuredSurveyController(f,inputs,reader,profiles);let callbackInsideRead=false;
 const applied=new Promise<void>(resolve=>{setImmediate(()=>{callbackInsideRead=reader.state().active;inputs=[consumer,...original.slice(1)];void controller.applied(f.applied(f.calls([original[0]!]))).then(resolve);});});
 const stale=await controller.selectNextSurvey(surveyArgs(reader));await applied;
 assert.equal(callbackInsideRead,true,'the event-loop callback must run DURING preparation even with measured profiles');
 assert.equal(stale.decision,'wait_for_apply');assert.equal(stale.admission_deferred,true);assert.equal(stale.selected.length,0);assert.equal(reader.hydration.length,0,'stale metadata cannot hydrate/prepare a paid cohort');
 const fresh=await controller.selectNextSurvey(surveyArgs(reader));assert.equal(fresh.decision,true);assert.equal(fresh.selected[0]!.root_id,consumer.root_id,'a fresh survey sees a consumer whose ID is earlier than the old cursor');
 assert.ok(reader.state().reads>=2);controller.closeObservation();await controller.runtime.provider.close!();
});

for(const fault of['encoder_drift','stale_anchor']as const)test(`global anchor selection ${fault} never downgrades the32 cohort or mixes RR snapshots`,async()=>{
 const f=fixture(),inputs=Array.from({length:4096},(_,i)=>orderedInput(f,i));inputs[4095]!.text='tea '+('z'.repeat(5000));
 const reader=scopedSurveyMock(()=>inputs,{...(fault==='encoder_drift'?{stateBytes:(input:SignalListeningInputV1,index:number)=>index===4095?Buffer.byteLength(JSON.stringify(inputs[0]!.text)):Buffer.byteLength(JSON.stringify(input.text))+(index===0?1:0)}:{}),
  ...(fault==='stale_anchor'?{stale:(ids:readonly string[])=>ids.includes(inputs[4095]!.root_id)}:{})});
 const controller=await measuredSurveyController(f,inputs.slice(0,4095),reader),next=await controller.selectNextSurvey(surveyArgs(reader));
 if(fault==='encoder_drift'){
  assert.equal(next.decision,true);assert.equal(next.selected.length,32);assert.deepEqual(next.selected.slice(0,2).map(input=>input.root_id),[inputs[0]!.root_id,inputs[4095]!.root_id]);
  assert.deepEqual(reader.hydration.map(call=>call.ids.length),[1024,1024,1024,1024,1024,32]);assert.equal(new Set(reader.hydration.map(call=>call.read)).size,1,'fallback scans EVERY chunk and anchors in the SAME RR');
 }else{
  assert.equal(next.decision,'wait_for_apply');assert.equal(next.admission_deferred,true);assert.equal(next.selected.length,0);
  assert.deepEqual(reader.hydration.map(call=>call.ids.length),[32,32]);assert.equal(controller.minimumNextCalls(),0,'provisional anchors cannot publish before a valid complete cohort exists');
  assert.equal(controller.nextAdmissionHint().kind,'open');
 }
 assert.equal(reader.state().active,false);controller.closeObservation();await controller.runtime.provider.close!();
});


test('metadata byte classification never expands the original fitting read domain to a later outlier',async()=>{
 const f=fixture(),inputs=Array.from({length:4096},(_,i)=>orderedInput(f,i));inputs[4095]!.text='tea '+('z'.repeat(5000));
 const reader=scopedSurveyMock(()=>inputs,{working:input=>input===inputs[2000]?execution.max_buffered_bytes+1:65536});
 const controller=await measuredSurveyController(f,inputs.slice(0,2000),reader),next=await controller.selectNextSurvey(surveyArgs(reader));
 assert.equal(next.decision,true);assert.equal(next.selected.length,1024);assert.equal(next.byte_limited,true);
 assert.equal(reader.encoded.length,2000);assert.equal(reader.encoded.includes(inputs[2000]!.root_id),false);assert.equal(reader.encoded.includes(inputs[4095]!.root_id),false);
 assert.equal(controller.nextAdmissionHint().kind,'open','the outlier outside the original fitting prefix cannot create a bootstrap');
 assert.deepEqual(reader.hydration.map(call=>call.ids.length),[1024]);controller.closeObservation();await controller.runtime.provider.close!();
});


test('an epoch change during final real descriptor preparation publishes no bootstrap and creates no new client',async()=>{
 const f=fixture(),inputs=Array.from({length:128},(_,i)=>orderedInput(f,i)),reader=scopedSurveyMock(()=>inputs),known=f.profile([inputs[0]!,inputs.at(-1)!]);
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[inputs[0]!],execution,loadProfile:async()=>known});
 let inspections=0,clients=0,armed=false,scheduled=false,inside=false;
 let controller!:Awaited<ReturnType<typeof createSignalListeningContinuationV1>>,done!:()=>void;
 const applied=new Promise<void>(resolve=>{done=resolve;});
 const counted=Object.defineProperty({...known},'source_call_ids',{enumerable:true,get(){
  inspections++;
  if(armed&&!scheduled&&inspections>10){scheduled=true;setImmediate(()=>{inside=reader.state().active;void controller.applied(f.applied(f.calls([inputs[0]!]))).then(done);});}
  return known.source_call_ids;
 }});plan.profiles.set(known.scope.shape_digest,counted);
 controller=await createSignalListeningContinuationV1({run_id:f.run_id,initial_plan:plan,initial_inputs:[inputs[0]!],execution,loadProfile:async()=>known,deriveProfile:async()=>null,
  factory:()=>{clients++;return{evaluate:async()=>{throw Error('selection proof must not physically send');}};}});
 controller.takeInitialSelection();clients=0;inspections=0;armed=true;
 const stale=await controller.selectNextSurvey(surveyArgs(reader));await applied;
 assert.equal(inside,false,'clientInfo validation and its cooperative yield occur AFTER the RR is closed');
 assert.equal(stale.decision,'wait_for_apply');assert.equal(stale.selected.length,0);assert.equal(clients,0);assert.equal(controller.stopReason(),undefined);
 assert.equal(controller.nextAdmissionHint().kind,'open');assert.equal(controller.preparationValid(stale.preparation_epoch),false);
 const fresh=await controller.selectNextSurvey(surveyArgs(reader));assert.equal(fresh.decision,true);assert.equal(fresh.selected.length,128);
 controller.closeObservation();await controller.runtime.provider.close!();
});
