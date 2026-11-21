import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,signalListeningBaseTemplateV1,signalListeningJevIdentityV1,entityContextDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
 buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,type SignalListeningConfigurationV1,
 type SignalListeningInputV1,type SignalListeningResultV1} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingRunV1} from '@noisia/db';
import {createTypesafeJevClientV1} from '../providers/typesafe-jev';
import {registerJevPhaseProviderV3,registerJevPhaseStoreV3} from '../providers/jev-phase-provider-v3';
import {registerJevListeningMetadataMapperV3,bindJevListeningMetadataV3,JEV_LISTENING_METADATA_SLOTS_V3,JEV_LISTENING_METADATA_FIXED_BYTES_V3} from './signal-jev-listening-metadata-v3';
import {processJevStreamingWindowV2,jevCallWorkingBytesV2,type JevStreamingMetricsV2} from './signal-jev-streaming-window';
import {createJevListeningPhaseBindingV3,jevLegacyCaptureProfileV3} from './signal-jev-phase-profile-v3';
import {jevLegacyPhaseFlushBytesV3,jevLegacyPhaseMaximumFlushBytesV3,jevListeningPhaseFlushBytesV3} from './signal-jev-phase-geometry-v3';

type Args=Parameters<typeof processJevStreamingWindowV2<SignalListeningInputV1,SignalListeningResultV1>>[0];
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),sha='sha256:'+'a'.repeat(64);
const gate=()=>{let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
const base=signalListeningBaseTemplateV1({category:'synthetic',lexicon_terms:['synthetic']});
const configuration:SignalListeningConfigurationV1={...base,questions:[...base.questions,
 {key:'q',text:'Configured question',type:'noul',scope:'all',origin:'agent',human_locked:false,positive:'yes',negative:'no'}]};
function fixture(options:{holdInitialResponse?:boolean;fault?:'RAW'|'settle'|'APPLY'|'feedback';later?:unknown;lostFinish?:boolean;foreignStore?:boolean;invalid?:boolean;nativePrimary?:boolean;bootstrap?:boolean;missingUsage?:boolean}={}){
 const context={entities:[]},run:LabelingRunV1={id:id(90),workspace_id:id(91),actor_user_id:id(92),kind:'mass_labeling',labeler_digest:sha,
  identity:signalListeningJevIdentityV1(configuration),entity_context_digest:entityContextDigestV1(context),entity_context_version_no:1,context,
  lease_token:id(93),cursor_root_id:null,cap_micro_usd:'1000000',processing_admission_id:null,status:'running',error_code:null};
 const calls=Array.from({length:3},(_,i):LabelingCallV1<SignalListeningInputV1>=>{
  const input:SignalListeningInputV1={root_id:id(i+1),input_digest:sha,text:'synthetic state',title:null,platform:'instagram',content_type:'comment',author:null,
   published_at:'2026-11-21T00:00:00.000Z',language:'pt',map_id:id(94),question_keys:['q'],question_digests:{q:sha},scope_basis:{q:'all'},configuration_digest:digest(configuration)};
  const request=buildSignalListeningJevRequestV1(input,configuration);
  return{id:id(i+11),custom_id:'call-'+i,request_digest:sha,reserved_micro_usd:100,request,inputs:[input],status:'reserved',raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0};
 });
 // Calls deliberately have distinct semantic attempt identities.
 calls.forEach((call,i)=>{call.request_digest='sha256:'+String(i+1).repeat(64);});
 const payload={model:'jev-1.13.0',answers:{q:{type:'noul',noul:1,extra:{keep:[1e20,'é😀',String.fromCharCode(0xd800)]}}},usage:{input_tokens:1,output_tokens:0,extra:{keep:[1e20]}}};
 const body=JSON.stringify(options.missingUsage?{model:payload.model,answers:payload.answers}:options.invalid?{...payload,model:'wrong-model'}:payload).replaceAll('100000000000000000000','1e20'),execution={max_in_flight:3,window_size:4,flush_size:1,max_flushes:2,flush_interval_ms:1000,max_buffered_bytes:512*1024*1024};
 const rawGates=[gate(),gate(),gate()],rawEntered=[gate(),gate(),gate()],settleGates=[gate(),gate(),gate()],settleEntered=[gate(),gate(),gate()];
 const commit=gate(),selected=gate(),finished=gate(),finishEntered=gate(),failure=Error('metadata '+options.fault);
 const initialResponse=options.holdInitialResponse?gate():undefined;
 const survey=gate(),surveyEntered=gate(),allReceived=gate();
 const snapshots:JevStreamingMetricsV2[]=[],raws:Array<{call:LabelingCallV1<SignalListeningInputV1>;raw:string}>=[],results:SignalListeningResultV1[]=[],settlements:unknown[]=[];
 let sends=0,feeds=0,surveyCredit=0,rawIndex=0,nativeCalls:LabelingCallV1<SignalListeningInputV1>[]=[];
 const provider=createTypesafeJevClientV1({enabled:true,api_key:'synthetic-only',max_response_bytes:16384,concurrency:3,
  fetch:(async()=>{sends++;if(sends===1&&initialResponse)await initialResponse.promise;return new Response(body,{status:200});})as typeof fetch});
 registerJevPhaseProviderV3(provider,()=>true);
 provider.observeUsage=async raw=>{assert.equal(raw.body,body);assert.ok(raws.some(row=>row.raw===JSON.stringify(raw)),'feedback sees the exact durable RAW wrapper, including all extras');if(options.fault==='feedback')throw failure;};
 const store={
  async markSubmitting(_run:unknown,page:typeof calls){for(const call of page)call.status='submitting';},
  async admitAndMarkSelected(_run:LabelingRunV1,candidates:Parameters<NonNullable<Args['store']['admitAndMarkSelected']>>[1],callbacks:Parameters<NonNullable<Args['store']['admitAndMarkSelected']>>[2]){
   const chosen=callbacks.selectFresh(candidates);
   // Mirrors the OWNERSHIP boundary of the real Native constructor: fresh
   // final request/input clones, never the calibrator's proposal references.
   nativeCalls=chosen.map((proposal):LabelingCallV1<SignalListeningInputV1>=>({...calls.find(c=>c.custom_id===proposal.custom_id)!,request:structuredClone(proposal.request),inputs:structuredClone(proposal.inputs),status:'submitting'}));
   callbacks.validateBeforeCommit(nativeCalls,chosen);selected.resolve();await commit.promise;return{kind:'committed' as const,calls:nativeCalls};
  },
  async persistRawPage(_run:unknown,page:Array<{call:typeof calls[number];raw:string}>){const index=rawIndex++;raws.push(...page);rawEntered[index]!.resolve();await rawGates[index]!.promise;if(options.fault==='RAW')throw failure;},
  async settlePage(_run:unknown,page:Parameters<Args['store']['settlePage']>[1]){const index=Number(page[0]!.call.id.slice(-2))-11;settleEntered[index]!.resolve();await settleGates[index]!.promise;if(options.fault==='settle')throw failure;settlements.push(...page.map(row=>row.usage));},
  async apply(_run:unknown,page:Parameters<Args['store']['apply']>[1]){
   if(options.fault==='APPLY'&&!(options.nativePrimary&&page[0]!.call.id===id(11))){if(page[0]!.call.id===id(options.nativePrimary?12:11)){Object.assign(failure,{params:page});throw failure;}throw options.later;}
   for(const row of page){results.push(...row.results);row.call.results_applied=true;}
  },
  async markFailed(){},async requeueUnsent(){throw Error('no paid replay');},async fail(){},
  async finish(){finishEntered.resolve();await finished.promise;if(options.lostFinish)throw null;return'completed';},
 }as unknown as Args['store'];
 const hooks:Args['hooks']={map:(_run,call,parsed)=>[mapSignalListeningJevResponseV1(call.inputs[0]!,context,configuration,parsed)],
  error:(_run,call,code)=>[{root_id:call.inputs[0]!.root_id,input_digest:call.inputs[0]!.input_digest,entity_context_digest:run.entity_context_digest,status:'error',answers:{},question_digests:{...call.inputs[0]!.question_digests},error_code:code}],labeled:r=>r.status==='labeled'};
 registerJevPhaseStoreV3(store);registerJevListeningMetadataMapperV3(hooks.map);
 const binding=createJevListeningPhaseBindingV3(provider,execution,hooks.map)!;bindJevListeningMetadataV3(binding,provider,hooks.map,store,false);
 const args:Args={run,calls:calls.slice(0,1),provider,store:options.foreignStore?{...store,apply:(...a)=>store.apply(...a)}:store,execution,hooks,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  cancellation:new AbortController(),response_budget_binding:binding,next_admission_hint:()=>options.bootstrap?{kind:'bootstrap',bootstrap_id:1,covered_call_limit:3,wait_for_apply:false}:{kind:'open'},observe_stream:m=>{snapshots.push(m);const s=m.response_phase;if(s&&s.capture_bytes===0&&s.retained_calls+s.flushing_calls===3)allReceived.resolve();},
  feed_next:async available=>{if(++feeds===1)return{proposals:calls.slice(1).map(c=>({custom_id:c.custom_id,request_digest:c.request_digest,request:c.request,inputs:c.inputs,reserved_micro_usd:c.reserved_micro_usd})),workspace_bytes:65536,byte_limited:false};surveyCredit=available;surveyEntered.resolve();await survey.promise;return{closed:true};}};
 const release=()=>{initialResponse?.resolve();for(const g of [...rawGates,...settleGates,commit,finished,survey])g.resolve();};
 return{args,calls,body,payload,provider,store,snapshots,raws,results,settlements,rawGates,rawEntered,settleGates,settleEntered,commit,selected,finished,finishEntered,survey,surveyEntered,allReceived,initialResponse,failure,release,native:()=>nativeCalls,last:()=>snapshots.at(-1)!,state:()=>({sends,surveyCredit})};
}

test('metadata Native clones seal before paid COMMIT and two blocked flushes own exact new F beside Survey',{timeout:5000},async()=>{
 const f=fixture({holdInitialResponse:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  await f.selected.promise;
  const before=f.last(),capturing=before.response_phase!,P=24*16384+65536;
  const captureProfile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!;
  const G=jevLegacyPhaseMaximumFlushBytesV3(16384,P,1)+captureProfile.flush_fixed_bytes;
  assert.equal(f.state().sends,1,'only the initial HTTP has started; Native COMMIT is still blocked');assert.equal(f.raws.length,0);
  assert.equal(f.native().length,2);assert.deepEqual(f.native().map(call=>call.id),f.calls.slice(1).map(call=>call.id));
  assert.equal(f.calls[0]!.status,'submitting');assert.ok(f.native().every(call=>call.status==='submitting'));
  // reserved_calls describes P leases, including an HTTP already capturing;
  // it is independent of the database submitting status and Native cohort size.
  assert.equal(before.in_flight,1);assert.equal(capturing.reserved_calls,1+f.native().length);
  assert.equal(capturing.capture_bytes,3*P);assert.equal(capturing.retained_bytes,0);
  assert.equal(capturing.retained_calls,0);assert.equal(capturing.flushing_calls,0);assert.equal(capturing.active_flushes,0);
  assert.equal(capturing.protected_bytes,G);assert.equal(capturing.error_protected_bytes,G);
  assert.equal(capturing.owned_bytes,captureProfile.ledger_bytes+2*G+3*P);
  const draftCallBytes=f.calls.slice(1).reduce((n,call)=>n+jevCallWorkingBytesV2(call),0);
  const returnedCallBytes=f.native().reduce((n,call)=>n+jevCallWorkingBytesV2(call),0);
  assert.equal(before.reserved_working_bytes,capturing.owned_bytes+jevCallWorkingBytesV2(f.calls[0]!)+draftCallBytes+2*8192+65536+returnedCallBytes,
    'the fresh Native draft, returned calls and transaction workspace remain separately charged before COMMIT');
  assert.ok(capturing.reserved_calls<=f.args.execution.max_in_flight);assert.ok(capturing.reserved_calls<=f.args.execution.window_size);
  assert.ok(before.reserved_working_bytes<=f.args.execution.max_buffered_bytes);
  assert.equal(f.last().response_metadata_native_rows,0);assert.equal(f.last().response_metadata_legacy_received_rows,0);
  for(const call of f.native()){assert.ok(Object.isFrozen(call.inputs));assert.ok(Object.isFrozen(call.inputs[0]!.question_digests));}
  assert.equal(Object.isFrozen(f.calls[1]!.inputs),false,'the Native producer/calibrator still owns its distinct input graph');
  assert.notStrictEqual(f.native()[0]!.inputs,f.calls[1]!.inputs);assert.notStrictEqual(f.native()[0]!.request,f.calls[1]!.request);
  // Complete only the initial HTTP while Native still waits for COMMIT.
  f.initialResponse!.resolve();await f.rawEntered[0]!.promise;
  assert.strictEqual(f.raws[0]!.call,f.calls[0]);assert.equal(f.state().sends,1,'initial handoff cannot send a Native request before COMMIT');
  const handedOff=f.last().response_phase!;
  assert.equal(handedOff.reserved_calls,2);assert.equal(handedOff.capture_bytes,2*P);
  assert.equal(handedOff.retained_calls,0);assert.equal(handedOff.flushing_calls,1);assert.equal(handedOff.active_flushes,1);assert.equal(handedOff.headroom_borrowed,true);
  assert.equal(handedOff.flush_workspace_bytes,0);assert.ok(handedOff.retained_bytes>0);
  assert.equal(handedOff.owned_bytes,captureProfile.ledger_bytes+2*G+2*P+handedOff.retained_bytes);
  assert.equal(f.last().reserved_working_bytes,before.reserved_working_bytes-P+handedOff.retained_bytes);
  assert.equal(f.last().response_metadata_native_rows,0);assert.equal(f.last().response_metadata_legacy_received_rows,1);
  f.commit.resolve();await f.rawEntered[1]!.promise;await f.allReceived.promise;await f.surveyEntered.promise;
  const profile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!,s=f.last().response_phase!,second=f.raws[1]!;
  const rawBytes=Buffer.byteLength(second.raw),F=jevListeningPhaseFlushBytesV3(f.body,rawBytes,1)+profile.flush_fixed_bytes;
  assert.equal(s.active_flushes,2);assert.equal(s.flush_workspace_bytes,F);assert.equal(s.headroom_borrowed,true);
  assert.equal(f.last().response_metadata_native_rows,1,'the other received Native row has only a quote and no F claim yet');
  assert.equal(f.last().response_metadata_legacy_received_rows,1);
  assert.equal(f.last().reserved_working_bytes,s.owned_bytes+f.calls.reduce((n,c)=>n+jevCallWorkingBytesV2(c),0)+f.state().surveyCredit);
  assert.equal(profile.flush_fixed_bytes,65536+25);
  const e=f.args.execution,baseLedger=e.window_size*55*64+e.max_flushes*(16*e.flush_size+1024)+65536+(24*16384+65536);
  assert.equal(profile.ledger_bytes-baseLedger,e.window_size*JEV_LISTENING_METADATA_SLOTS_V3*64+JEV_LISTENING_METADATA_FIXED_BYTES_V3);
  f.rawGates[1]!.resolve();await f.settleEntered[1]!.promise;assert.equal(f.last().response_phase!.flush_workspace_bytes,F,'SQL/settlement await retains its entire F');
 }finally{f.release();}
 await pending;assert.equal(f.last().response_phase!.owned_bytes,0);assert.equal(f.state().sends,3);
 assert.equal(f.last().response_metadata_native_rows,2);assert.equal(f.last().response_metadata_legacy_received_rows,1);assert.equal(f.last().response_metadata_legacy_terminal_rows,0);
 assert.deepEqual(f.results[0]!.answers,f.payload.answers);assert.deepEqual((f.settlements[0]as {extra:unknown}).extra,f.payload.usage.extra);
 assert.ok(f.snapshots.every(m=>m.reserved_working_bytes<=f.args.execution.max_buffered_bytes&&m.in_flight<=f.args.execution.max_in_flight&&m.active_flushes<=f.args.execution.max_flushes),'every observed stage keeps the original memory/HTTP/two-flush quotas');
});

for(const fault of ['RAW','settle','APPLY','feedback']as const)test(`metadata ${fault} UNKNOWN preserves error aliases and quarantine through lost ACK`,{timeout:5000},async()=>{
 const f=fixture({fault,lostFinish:true}),pending=processJevStreamingWindowV2(f.args);let known=false,caught:unknown;
 const observed=pending.catch(error=>{known=true;caught=error;});
 try{await f.selected.promise;f.commit.resolve();await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.allReceived.promise;}finally{f.release();}
 await observed;
 assert.equal(known,true);assert.ok(caught!==undefined);assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
 const s=f.last().response_phase!;assert.equal(s.closed,false);assert.equal(s.admission_closed,true);assert.equal(s.quarantined_calls,3);assert.ok(s.retained_bytes>0);assert.ok(s.error_retained_bytes>0);
});

for(const [label,later]of [['zero',0],['null',null],['undefined',undefined]]as const)test(`metadata first fatal result aliases survive later ${label} while paid siblings drain`,{timeout:5000},async()=>{
 const f=fixture({fault:'APPLY',later,nativePrimary:true}),pending=processJevStreamingWindowV2(f.args);let caught:unknown;
 const observed=pending.catch(error=>{caught=error;});
 try{
  f.commit.resolve();await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.allReceived.promise;
  f.rawGates[1]!.resolve();f.settleGates[1]!.resolve();await f.rawEntered[2]!.promise;
  const profile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!,row=f.raws[1]!;
  assert.equal(f.last().response_phase!.error_retained_bytes,jevListeningPhaseFlushBytesV3(f.body,Buffer.byteLength(row.raw),1)+profile.flush_fixed_bytes,'the exact smaller Native F stays with the ORIGINAL error');
 }finally{f.release();}
 await observed;assert.strictEqual(caught,f.failure);assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
 const params=(f.failure as Error&{params:Array<{results:SignalListeningResultV1[]}>}).params;
 assert.deepEqual(params[0]!.results[0]!.answers,f.payload.answers);assert.equal(f.last().response_phase!.closed,false);assert.ok(f.last().response_phase!.error_retained_bytes>0);
});

test('a foreign store wrapper keeps complete Legacy F and never seals its Native-shaped input',{timeout:5000},async()=>{
 const f=fixture({foreignStore:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  await f.selected.promise;assert.equal(Object.isFrozen(f.native()[0]!.inputs),false);f.commit.resolve();
  await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.allReceived.promise;
  const profile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!,row=f.raws[1]!;
  assert.equal(f.last().response_phase!.flush_workspace_bytes,jevLegacyPhaseFlushBytesV3(f.body,Buffer.byteLength(row.raw),1)+profile.flush_fixed_bytes);
 }finally{f.release();}
 await pending;assert.equal(f.state().sends,3);assert.equal(f.last().response_metadata_native_rows,0);assert.equal(f.last().response_metadata_legacy_received_rows,3);
});

test('invalid received response with observed usage retains extras under normal F without technical replay',{timeout:5000},async()=>{
 const f=fixture({invalid:true}),pending=processJevStreamingWindowV2(f.args);f.release();await pending;
 assert.equal(f.state().sends,3);assert.equal(f.results.length,3);assert.ok(f.results.every(r=>r.status==='error'&&r.error_code==='jev_response_invalid'));
 assert.equal(f.last().response_phase!.owned_bytes,0);
});


test('a changed preparation closes Native admission before paid COMMIT without reusing sealed lineage',{timeout:5000},async()=>{
 const f=fixture();f.args.preparation_valid=()=>false;
 const pending=processJevStreamingWindowV2(f.args);f.release();await pending;
 assert.equal(f.native().length,0);assert.equal(f.state().sends,1);
 assert.equal(Object.isFrozen(f.calls[1]!.inputs),false);assert.equal(f.last().response_phase!.owned_bytes,0);
});


test('official bootstrap Native clones retain Legacy F and remain owned by their calibrator',{timeout:5000},async()=>{
 const f=fixture({bootstrap:true}),pending=processJevStreamingWindowV2(f.args);
 try{
  await f.selected.promise;assert.equal(Object.isFrozen(f.native()[0]!.inputs),false);f.commit.resolve();
  await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.allReceived.promise;
  const profile=jevLegacyCaptureProfileV3(f.provider,f.args.execution)!,row=f.raws[1]!;
  assert.equal(f.last().response_phase!.flush_workspace_bytes,jevLegacyPhaseFlushBytesV3(f.body,Buffer.byteLength(row.raw),1)+profile.flush_fixed_bytes);
 }finally{f.release();}
 await pending;assert.equal(f.state().sends,3);assert.equal(f.last().response_phase!.owned_bytes,0);assert.equal(f.last().response_metadata_native_rows,0);assert.equal(f.last().response_metadata_legacy_received_rows,3);
});


test('scalar receipt distinguishes reduced Native receive credit from all Legacy terminal applications',{timeout:5000},async()=>{
 const f=fixture({missingUsage:true}),pending=processJevStreamingWindowV2(f.args);
 try{await f.selected.promise;f.commit.resolve();await f.rawEntered[0]!.promise;await f.rawEntered[1]!.promise;await f.allReceived.promise;}finally{f.release();}
 await pending;assert.equal(f.state().sends,3);assert.equal(f.raws.length,3);
 assert.equal(f.last().response_metadata_native_rows,2);assert.equal(f.last().response_metadata_legacy_received_rows,1);
 assert.equal(f.last().response_metadata_legacy_terminal_rows,3);assert.equal(f.last().response_phase!.owned_bytes,0);
});
