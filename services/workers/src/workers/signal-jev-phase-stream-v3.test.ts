import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingRunV1} from '@noisia/db';
import {createTypesafeJevClientV1,type JevResponseV1} from '../providers/typesafe-jev';
import {registerJevPhaseProviderV3,isJevPhaseProviderV3} from '../providers/jev-phase-provider-v3';
import {processJevStreamingWindowV2,jevCallWorkingBytesV2,type JevStreamingMetricsV2} from './signal-jev-streaming-window';
import {createJevListeningPhaseBindingV3,jevLegacyCaptureProfileV3} from './signal-jev-phase-profile-v3';
import {captureJevDeferredRawV1,createJevDeferredRawWitnessV1,packJevDeferredRawV3} from '../providers/jev-deferred-raw';
import {jevDeferredRetainedBytesV3,jevLegacyPhaseFlushBytesV3} from './signal-jev-phase-geometry-v3';

type Result={answers:JevResponseV1['answers']};
type Args=Parameters<typeof processJevStreamingWindowV2<FacetInput,Result>>[0];
function gate(){let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}
function fixture(options:{fault?:'RAW'|'settle'|'APPLY'|'feedback';loseMark?:boolean;loseFinish?:boolean;large?:boolean;survey?:boolean;registered?:boolean;captureAliases?:boolean;adversarialValue?:unknown;invalidBody?:boolean}={}){
 const execution={max_in_flight:3,window_size:4,flush_size:1,max_flushes:2,flush_interval_ms:1000,max_buffered_bytes:512*1024*1024};
 const calls=Array.from({length:3},(_,i)=>({id:'phase-'+i,custom_id:'custom-'+i,request_digest:'digest-'+i,reserved_micro_usd:100,
  request:{model:'jev-1.13.0',state:'state-'+i,questions:{q:{type:'noul',instructions:'configured'}}},
  inputs:[{root_id:'root-'+i,input_digest:'input-'+i,text:'state-'+i}],status:'reserved',raw_body:null,results_applied:false,
  provider_batch_id:null,retry_depth:0}))as LabelingCallV1<FacetInput>[];
 const payload={model:'jev-1.13.0',answers:{q:{type:'noul',noul:1,extra:{nested:[1e20,'é😀']}}},usage:{input_tokens:1,output_tokens:0,extra:{nested:['kept']}}};
 const compact=JSON.stringify(options.invalidBody?{model:payload.model,answers:payload.answers}:payload),body=options.large?compact+' '.repeat(16384-Buffer.byteLength(compact)):compact;
 const rawGates=[gate(),gate(),gate()],settleGates=[gate(),gate(),gate()],rawEntered=[gate(),gate(),gate()],settleEntered=[gate(),gate(),gate()];
 const finishGate=gate(),finishEntered=gate(),surveyGate=gate(),surveyEntered=gate(),failure=Error('phase '+options.fault);
 const received=gate();
 const snapshots:JevStreamingMetricsV2[]=[],events:string[]=[],raws:string[]=[],observedUsage:unknown[]=[];
 let sends=0,finishes=0,feeds=0,surveyCredit=0,rawIndex=0,technicalApplied=0;
 const provider=createTypesafeJevClientV1({enabled:true,api_key:'local-test-only',max_response_bytes:16384,concurrency:3,
  fetch:(async()=>{sends++;return new Response(body,{status:200});})as typeof fetch});
 // Explicit closed finite test protocol: not an inference from injected Fetch.
 if(options.registered!==false)registerJevPhaseProviderV3(provider,()=>true);
 provider.observeUsage=async raw=>{events.push('feedback');assert.equal(raw.body,body);if(options.fault==='feedback')throw failure;};
 const store={
  async markSubmitting(_run:unknown,page:typeof calls){for(const call of page)call.status='submitting';},
  async persistRawPage(_run:unknown,page:Array<{call:typeof calls[number];raw:string}>){
   const i=rawIndex++;events.push('RAW-'+i);for(const row of page)raws.push(row.raw);rawEntered[i]!.resolve();await rawGates[i]!.promise;
   if(options.fault==='RAW')throw failure;for(const row of page)row.call.raw_body=row.raw;
  },
  async settlePage(_run:unknown,page:Array<{call:typeof calls[number];usage:unknown}>){
   const i=Number(page[0]!.call.id.split('-').at(-1));events.push('settle-'+i);settleEntered[i]!.resolve();await settleGates[i]!.promise;
   if(options.fault==='settle')throw failure;for(const row of page){observedUsage.push(row.usage);row.call.status='settled';}
  },
  async apply(_run:unknown,page:Array<{call:typeof calls[number];results:Result[]}>){
   if(options.fault==='APPLY'){
    if(options.captureAliases){
      if(page[0]!.call.id==='phase-0'){Object.assign(failure,{params:page});throw failure;}
      throw options.adversarialValue;
    }
    throw failure;
   }
   for(const row of page){
    if(options.invalidBody){
      technicalApplied++;events.push('technical-APPLY');assert.deepEqual(row.results[0]!.answers,{});
      assert.equal(snapshots.at(-1)!.response_phase!.active_flushes,1,'technical results are allocated/applied only under owned F');
    }else assert.deepEqual(row.results[0]!.answers,payload.answers);
    row.call.results_applied=true;
   }
  },
  async markFailed(_run:unknown,page:typeof calls,unknown:boolean){if(options.loseMark)throw 0;for(const call of page)call.status=unknown?'unknown':'failed';},
  async requeueUnsent(){throw Error('all paid members were delivered');},
  async fail(){if(options.invalidBody){events.push('run-failed');return;}throw Error('no technical-result replacement');},
  async finish(){finishes++;finishEntered.resolve();await finishGate.promise;if(options.loseFinish)throw 0;return options.fault?'outcome_unknown':'completed';},
 }as unknown as Args['store'];
 const hooks:Args['hooks']={map:(_run,_call,parsed)=>[{answers:structuredClone(parsed.answers)}],error:()=>options.invalidBody?[{answers:{}}]:[],labeled:()=>true,fail_on_error:options.invalidBody===true};
 const args:Args={run:{id:'phase-run',lease_token:'lease',status:'running',error_code:null}as LabelingRunV1,calls,provider,store,execution,hooks,
  cancellation:new AbortController(),price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),observe_stream:m=>{snapshots.push(m);const s=m.response_phase;if(s&&s.capture_bytes===0&&s.retained_calls+s.flushing_calls===3)received.resolve();},
  response_budget_binding:createJevListeningPhaseBindingV3(provider,execution,hooks.map)};
 if(options.survey)args.feed_next=async available=>{feeds++;surveyCredit=available;surveyEntered.resolve();await surveyGate.promise;return{closed:true};};
 const releaseAll=()=>{for(const g of [...rawGates,...settleGates,finishGate,surveyGate])g.resolve();};
 return{args,calls,body,payload,provider,snapshots,rawGates,settleGates,rawEntered,settleEntered,finishGate,finishEntered,surveyGate,surveyEntered,received,raws,observedUsage,events,failure,releaseAll,
  state:()=>({sends,finishes,feeds,surveyCredit,technicalApplied}),last:()=>snapshots.at(-1)!};
}

test('V3 two real flush frames own distinct F while Survey and all paid responses coexist', {timeout:5000},async()=>{
 const f=fixture({survey:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  await f.surveyEntered.promise;await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.received.promise;
  // First holds RAW, second advances to settlement: both async owners coexist.
  f.rawGates[1]!.resolve();await f.settleEntered[1]!.promise;
  const m=f.last(),s=m.response_phase!;assert.equal(s.active_flushes,2);assert.equal(s.headroom_borrowed,true);
  assert.equal(f.state().sends,3);assert.ok(f.state().surveyCredit>0);
  const profile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!;
  const packetOf=(raw:string)=>{const owner={},witness=createJevDeferredRawWitnessV1(owner);const value=witness(JSON.parse(raw));return packJevDeferredRawV3(captureJevDeferredRawV1(owner,value)!);};
  const first=packetOf(f.raws[0]!),second=packetOf(f.raws[1]!);
  const R1=jevDeferredRetainedBytesV3(first),R2=jevDeferredRetainedBytesV3(second),F=jevLegacyPhaseFlushBytesV3(f.body,second.bytes,1)+profile.flush_fixed_bytes;
  assert.ok(s.retained_bytes>=R1+R2);assert.equal(s.capture_bytes,0);
  assert.equal(s.flush_workspace_bytes,F,'the concurrent second flush pays its full F');
  assert.equal(s.owned_bytes,profile.ledger_bytes+s.protected_bytes+s.error_protected_bytes+s.retained_bytes+F,'R for every response, only first borrows G');
  assert.equal(m.reserved_working_bytes,f.calls.reduce((n,c)=>n+jevCallWorkingBytesV2(c),0)+f.state().surveyCredit+s.owned_bytes);
  assert.ok(f.snapshots.some(v=>v.response_phase?.reserved_calls===3&&v.response_phase.owned_bytes===profile.ledger_bytes+v.response_phase.protected_bytes+v.response_phase.error_protected_bytes+3*(16384*24+65536)),'all P and G predate HTTP handoff');
  assert.ok(f.snapshots.every(v=>v.reserved_working_bytes<=512*1024*1024));
 }finally{f.releaseAll();}
 await pending;assert.equal(f.last().response_phase!.closed,true);assert.equal(f.last().response_phase!.owned_bytes,0);
 assert.deepEqual((f.observedUsage[0]as Record<string,unknown>).extra,f.payload.usage.extra);
});

test('V3 one-row protected progress drains paid maximum bodies while a Survey owns all other credit',{timeout:5000},async()=>{
 const f=fixture({large:true,survey:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  await f.surveyEntered.promise;await f.rawEntered[0]!.promise;
  assert.equal(f.last().response_phase!.active_flushes,1,'second full F does not fit the remaining freed capture credit');
  for(let i=0;i<3;i++){await f.rawEntered[i]!.promise;f.rawGates[i]!.resolve();f.settleGates[i]!.resolve();await f.settleEntered[i]!.promise;}
 }finally{f.releaseAll();}
 await pending;assert.equal(f.raws.length,3);assert.equal(f.state().sends,3);assert.equal(f.last().response_phase!.owned_bytes,0);
});

for(const fault of ['RAW','settle','APPLY','feedback']as const)test(`V3 quarantines ${fault} UNKNOWN then drains siblings without replay or R release before ledger ACK`,{timeout:5000},async()=>{
 const f=fixture({fault,loseMark:true}),pending=processJevStreamingWindowV2(f.args);let caught:unknown;
 // Attach the rejection observer immediately; all gates still control progress.
 const observed=pending.catch(error=>{caught=error;});
 try{
  for(const g of [...f.rawGates,...f.settleGates])g.resolve();
  await f.finishEntered.promise;
  const s=f.last().response_phase!;assert.equal(s.active_flushes,0);assert.equal(s.quarantined_calls,3);
  assert.equal(s.admission_closed,true);assert.equal(s.closed,false);assert.ok(s.owned_bytes>s.protected_bytes);
  assert.equal(f.raws.length,3);assert.equal(f.state().sends,3);
  assert.ok(f.calls.every(call=>call.raw_body===null),'no materialized wrapper survives the consume frame');
  f.finishGate.resolve();await observed;
 }finally{f.releaseAll();}
 assert.ok(caught!==undefined);
 if(fault!=='feedback'){assert.ok(caught instanceof AggregateError);assert.strictEqual(caught.errors[0],f.failure);assert.strictEqual(caught.errors[1],0);}
 else assert.strictEqual(caught,f.failure);
 assert.equal(f.last().response_phase!.quarantined_calls,0);assert.equal(f.last().response_phase!.retained_bytes,0);
 assert.equal(f.last().response_phase!.closed,false,'the same opaque first error still owns its F at egress');
 assert.ok(f.last().response_phase!.error_retained_bytes>0);assert.equal(f.raws.length,3,'quarantined RAW is never re-enqueued/replayed');
});

test('V3 lost reconciliation ACK never reports a false closed owner or returns quarantined R',{timeout:5000},async()=>{
 const f=fixture({fault:'RAW',loseMark:true,loseFinish:true}),pending=processJevStreamingWindowV2(f.args);f.releaseAll();
 await assert.rejects(pending,AggregateError);const s=f.last().response_phase!;
 assert.equal(s.quarantined_calls,3);assert.equal(s.closed,false);assert.equal(s.admission_closed,true);assert.ok(s.owned_bytes>s.protected_bytes);
 assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
});

test('arbitrary injected Fetch and representation witnesses never enable phase credit',{timeout:5000},async()=>{
 const f=fixture({registered:false});assert.equal(isJevPhaseProviderV3(f.provider),false);assert.equal(f.args.response_budget_binding,undefined);
 const pending=processJevStreamingWindowV2(f.args);f.releaseAll();await pending;
 assert.ok(f.snapshots.every(m=>m.response_phase===undefined));assert.equal(f.raws.length,3);
});

for(const variant of ['foreign-binding','foreign-mapper','recovery']as const)test(`V3 ${variant} retains the complete legacy path`,{timeout:5000},async()=>{
 const f=fixture();
 if(variant==='foreign-binding')f.args.response_budget_binding={...f.args.response_budget_binding}as NonNullable<Args['response_budget_binding']>;
 if(variant==='foreign-mapper'){const original=f.args.hooks.map;f.args.hooks={...f.args.hooks,map:(...params)=>original(...params)};}
 if(variant==='recovery')for(const call of f.calls){call.raw_body=JSON.stringify({body:f.body,http_status:200,latency_ms:1});call.status='settled';}
 const pending=processJevStreamingWindowV2(f.args);f.releaseAll();await pending;
 assert.ok(f.snapshots.every(m=>m.response_phase===undefined));assert.equal(f.state().sends,variant==='recovery'?0:3);
});

for(const [label,later]of [['zero',0],['null',null],['undefined',undefined]]as const)test(`V3 original error retaining result/params survives later ${label} and paid buffered siblings`,{timeout:5000},async()=>{
 const f=fixture({fault:'APPLY',captureAliases:true,adversarialValue:later}),pending=processJevStreamingWindowV2(f.args);
 let caught:unknown;const observed=pending.catch(error=>{caught=error;});
 try{
  await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.received.promise;
  f.rawGates[0]!.resolve();f.settleGates[0]!.resolve();
  await f.rawEntered[2]!.promise; // First fatal returned G_progress while its F remains in G_error.
  for(const g of [...f.rawGates,...f.settleGates])g.resolve();
  await f.finishEntered.promise;const before=f.last().response_phase!;
  assert.equal(before.quarantined_calls,3);assert.equal(before.active_flushes,0);assert.equal(before.capture_bytes,0);
  assert.ok(before.error_retained_bytes>0);assert.ok(before.retained_bytes>0);assert.equal(before.admission_closed,true);
  f.finishGate.resolve();await observed;
 }finally{f.releaseAll();}
 assert.strictEqual(caught,f.failure);const params=(f.failure as Error&{params:Array<{results:Result[]}>}).params;
 assert.deepEqual(params[0]!.results[0]!.answers,f.payload.answers,'the original opaque error still retains full result extras');
 const egress=f.last().response_phase!;assert.equal(egress.retained_bytes,0);assert.ok(egress.error_retained_bytes>0);
 assert.equal(egress.closed,false);assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
});

test('V3 invalid-body technical results own a terminal F frame without RAW replay and keep R until finish ACK',{timeout:5000},async()=>{
 const f=fixture({invalidBody:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  for(const g of [...f.rawGates,...f.settleGates])g.resolve();await f.finishEntered.promise;
  const s=f.last().response_phase!;assert.equal(s.quarantined_calls,3);assert.ok(s.retained_bytes>0);
  assert.equal(s.error_retained_bytes,0);assert.equal(s.active_flushes,0);assert.equal(s.closed,false);
  assert.equal(f.state().technicalApplied,3);assert.equal(f.raws.length,3);assert.equal(f.state().sends,3);
  assert.ok(f.events.indexOf('run-failed')<f.events.indexOf('technical-APPLY'));
  f.finishGate.resolve();await pending;
 }finally{f.releaseAll();}
 assert.equal(f.last().response_phase!.closed,true);assert.equal(f.last().response_phase!.owned_bytes,0);
});

test('V3 terminal APPLY failure retains original error escrow and reconciles immutable R without replay',{timeout:5000},async()=>{
 const f=fixture({invalidBody:true,fault:'APPLY'}),pending=processJevStreamingWindowV2(f.args);let caught:unknown;
 const observed=pending.catch(error=>{caught=error;});f.releaseAll();await observed;
 assert.strictEqual(caught,f.failure);assert.equal(f.raws.length,3);assert.equal(f.state().sends,3);
 const s=f.last().response_phase!;assert.equal(s.retained_bytes,0);assert.ok(s.error_retained_bytes>0);assert.equal(s.closed,false);
});

test('V3 first escaped-body allocation occurs only after the flush has claimed F and both escrows',{timeout:5000},async()=>{
 const f=fixture({large:true}),original=JSON.stringify;let escapedBodies=0;
 JSON.stringify=((value:unknown,...rest:unknown[])=>{
  if(value===f.body){
   escapedBodies++;const s=f.last().response_phase!;assert.ok(s.active_flushes>0);assert.ok(s.flushing_calls>0);
   assert.ok(s.protected_bytes>0);assert.ok(s.error_protected_bytes>0);
   assert.ok(f.last().reserved_working_bytes<=f.args.execution.max_buffered_bytes);
  }
  return Reflect.apply(original,JSON,[value,...rest]);
 })as typeof JSON.stringify;
 try{const pending=processJevStreamingWindowV2(f.args);f.releaseAll();await pending;}
 finally{JSON.stringify=original;f.releaseAll();}
 assert.equal(escapedBodies,3);assert.equal(f.raws.length,3);assert.equal(f.state().sends,3);
});

test('V3 Native fresh selection owns capture and both escrows before COMMIT ACK and sends only afterward',{timeout:5000},async()=>{
 const f=fixture(),commit=gate(),selected=gate();let feeds=0,selections=0,validations=0;
 f.args.calls=f.calls.slice(0,1);
 const proposals=f.calls.slice(1).map(call=>({custom_id:call.custom_id,request_digest:call.request_digest,request:call.request,inputs:call.inputs,reserved_micro_usd:call.reserved_micro_usd}));
 f.args.feed_next=async()=>++feeds===1?{proposals,workspace_bytes:65536,byte_limited:false}:{closed:true};
 f.args.store.admitAndMarkSelected=async(_run,candidates,callbacks)=>{
  selections++;const chosen=callbacks.selectFresh(candidates),rows=chosen.map(proposal=>{
   const row=f.calls.find(call=>call.custom_id===proposal.custom_id)!;row.status='submitting';return row;
  });
  validations++;callbacks.validateBeforeCommit(rows,chosen);selected.resolve();await commit.promise;return{kind:'committed',calls:rows};
 };
 const pending=processJevStreamingWindowV2(f.args);
 try{
  await selected.promise;const s=f.last().response_phase!;
  assert.equal(f.state().sends,1,'Native paid cohort has not crossed COMMIT ACK');
  assert.ok(s.capture_bytes>=2*(24*16384+65536));assert.ok(s.protected_bytes>0);assert.ok(s.error_protected_bytes>0);
  assert.ok(f.last().reserved_working_bytes<=f.args.execution.max_buffered_bytes);
  commit.resolve();f.releaseAll();await pending;
 }finally{commit.resolve();f.releaseAll();}
 assert.equal(selections,1);assert.equal(validations,1);assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
 assert.equal(f.last().response_phase!.owned_bytes,0);
});

test('V3 small initial budget preserves formerly legal LEGACY delivery without an optimization rejection',{timeout:5000},async()=>{
 const f=fixture();f.args.execution={...f.args.execution,max_buffered_bytes:4*1024*1024};
 const pending=processJevStreamingWindowV2(f.args);f.releaseAll();await pending;
 assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);assert.ok(f.snapshots.every(s=>s.response_phase===undefined));
});

test('V3 empty initial feed retains full LEGACY until a later ordinary invocation rather than narrowing legal hydration',{timeout:5000},async()=>{
 const f=fixture();let feeds=0;f.args.calls=[];f.args.feed_next=async()=>++feeds===1?f.calls:{closed:true};
 const pending=processJevStreamingWindowV2(f.args);f.releaseAll();await pending;
 assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);assert.ok(f.snapshots.every(s=>s.response_phase===undefined));
});
