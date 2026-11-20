import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingCallProposalV1,LabelingRunV1} from '@noisia/db';
import {processJevStreamingWindowV2,jevCallWorkingBytesV2,type JevNativeAdmissionDraftV1} from './signal-jev-streaming-window';
import {createNativeListeningAdmissionWorkspaceQuoteV1,nativeListeningAdmissionWorkspaceBoundV1} from '@noisia/db';
import {signalListeningBaseTemplateV1,signalListeningJevIdentityV1} from '@noisia/query-engine';
const execution={max_in_flight:8,window_size:4096,max_buffered_bytes:16*1024*1024,flush_size:1,max_flushes:2,flush_interval_ms:250};
function gate(){let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}
type Args=Parameters<typeof processJevStreamingWindowV2<FacetInput,string>>[0];
function proposal(i:number):LabelingCallProposalV1<FacetInput>{return{custom_id:'fresh-'+i,request_digest:'digest-'+i,reserved_micro_usd:100,
 request:{model:'jev-1.13.0',state:'text-'+i,questions:{q:{type:'noul',instructions:'Configured data'}}},inputs:[{root_id:'root-'+i,text:'text-'+i}as FacetInput]};}
function call(p:LabelingCallProposalV1<FacetInput>,status:'reserved'|'submitting'='submitting'):LabelingCallV1<FacetInput>{
 // The database owns distinct JSONB objects; a worker must not require request
 // or input identity with its original proposals to transfer the validated row.
 return{...p,request:JSON.parse(JSON.stringify(p.request)),inputs:JSON.parse(JSON.stringify(p.inputs)),id:'call-'+p.custom_id,
  status,raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0};
}
function numericDraft(draft:JevNativeAdmissionDraftV1<FacetInput>):JevNativeAdmissionDraftV1<FacetInput>{
 const prefix=[0];for(const p of draft.proposals)prefix.push(prefix.at(-1)!+jevCallWorkingBytesV2(p));
 return{...draft,workspace_quote:{length:draft.proposals.length,retained_bytes:256+8*prefix.length,quote:()=>draft.workspace_bytes},call_working_prefix:Object.freeze(prefix)};
}
function fixture(quoted=false){
 const run={id:'native-fresh',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
 const proposals=[proposal(1),proposal(2)],rows:LabelingCallV1<FacetInput>[]=[],physical:string[]=[],applied:string[]=[],memory:number[]=[];
 const cancellation=new AbortController();let reserves=0,marks=0,feeds=0,notified=0,unknownFailures=0;
 const store={reserve:async(_run:unknown,drafts:typeof proposals)=>{reserves++;const next=drafts.map(p=>call(p,'reserved'));rows.push(...next);return next;},
  markSubmitting:async(_run:unknown,calls:typeof rows)=>{marks++;for(const row of calls)row.status='submitting';},
  persistRawPage:async(_run:unknown,page:Array<{call:typeof rows[number];raw:string}>)=>{for(const row of page)row.call.raw_body=row.raw;},
  settlePage:async(_run:unknown,page:Array<{call:typeof rows[number]}>)=>{for(const row of page)row.call.status='settled';},
  apply:async(_run:unknown,page:Array<{call:typeof rows[number]}>)=>{for(const row of page){row.call.results_applied=true;applied.push(row.call.id);}},
  markFailed:async()=>{throw Error('uncommitted proposals cannot become fabricated technical rows');},
  fail:async(_run:unknown,code:string)=>{if(code==='labeling_outcome_unknown')unknownFailures++;},finish:async()=>rows.every(row=>row.results_applied)?'completed':'running',
 }as unknown as Args['store'];
 const provider:Args['provider']={max_response_bytes:4096,evaluate:async request=>{physical.push(String(request.state));return{http_status:200,latency_ms:1,
  body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.9}}})};}};
 const args:Args={run,calls:[],store,provider,execution,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),cancellation,
  hooks:{map:(_run,row)=>[row.id],error:()=>[],labeled:()=>true,fail_on_error:true},observe_stream:metrics=>memory.push(metrics.reserved_working_bytes),
  feed_next:async()=>{feeds++;const draft={proposals,workspace_bytes:64*1024,byte_limited:false,on_committed:()=>{notified++;}};return feeds===1?(quoted?numericDraft(draft):draft):{closed:true};}};
 return{args,run,proposals,rows,physical,applied,memory,cancellation,state:()=>({reserves,marks,feeds,notified,unknownFailures})};
}
for(const quoted of[false,true])test(`fresh native admission owns all proposal/vector/workspace/call/response custody before COMMIT (${quoted?'numeric quote':'legacy quote'})`,async()=>{
 const f=fixture(quoted),authority=gate(),entered=gate();let validationMemory=0,selectedCount=0;
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  entered.resolve();await authority.promise;
  const selected=callbacks.selectFresh(drafts);selectedCount=selected.length;const rows=selected.map(p=>call(p));f.rows.push(...rows);
  const before=JSON.stringify(rows);callbacks.validateBeforeCommit(rows,selected);validationMemory=f.memory.at(-1)!;assert.equal(JSON.stringify(rows),before,'validation cannot mutate database values');
  assert.equal(f.physical.length,0,'COMMIT has not been acknowledged');return{kind:'committed',calls:rows};
 };
 const running=processJevStreamingWindowV2(f.args);await entered.promise;
 const proposalBytes=f.proposals.reduce((n,p)=>n+jevCallWorkingBytesV2(p)+8192,0),vectors=quoted?2*(256+8*(f.proposals.length+1)):0;assert.ok(f.memory.at(-1)!>=proposalBytes+vectors+64*1024);assert.equal(f.physical.length,0);assert.equal(f.state().feeds,1,'the single feeder cannot open another draft while native authority is pending');
 authority.resolve();const result=await running;assert.equal(selectedCount,2);
 const returnCustody=f.proposals.reduce((sum,p)=>sum+jevCallWorkingBytesV2(p),0),responses=f.proposals.length*(f.args.provider.max_response_bytes!*24+64*1024);
 assert.ok(validationMemory>=proposalBytes+vectors+64*1024+returnCustody+responses,'both numeric vectors coexist with ALL proposals, workspace, returned calls and complete response allowances before COMMIT');
 assert.equal(result.status,'completed');assert.deepEqual(f.state(),{reserves:0,marks:0,feeds:2,notified:1,unknownFailures:0});assert.equal(f.physical.length,2);assert.equal(f.applied.length,2);assert.equal(f.memory.at(-1),0);
 assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));
});
test('native unsupported preflight consumes no cohort credits and retains the complete legacy protocol for its prepared prefix',async()=>{
 const f=fixture();f.args.store.admitAndMarkSelected=async()=>({kind:'legacy'});
 const result=await processJevStreamingWindowV2(f.args);assert.equal(result.status,'completed');assert.equal(f.state().reserves,1);assert.equal(f.state().marks,1);
 assert.equal(f.state().notified,0);assert.equal(f.physical.length,2);assert.equal(f.memory.at(-1),0);
});
for(const outcome of ['rolled_back','unknown']as const)for(const quoted of[false,true])test(`native post-DML ${outcome} releases provisional custody without fallback or physical retry (${quoted?'numeric quote':'legacy quote'})`,async()=>{
 const f=fixture(quoted);f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));callbacks.validateBeforeCommit(rows,selected);
  if(outcome==='unknown')f.rows.push(...rows);
  throw Object.assign(Error('native handoff fault'),{name:'LabelingAdmissionFailureV1',outcome,call_ids:rows.map(row=>row.id),custom_ids:selected.map(row=>row.custom_id)});
 };
 await assert.rejects(processJevStreamingWindowV2(f.args),/native handoff fault/);assert.equal(f.state().reserves,0);assert.equal(f.state().marks,0);assert.equal(f.physical.length,0);assert.equal(f.applied.length,0);assert.equal(f.state().notified,0);
 assert.equal(f.state().unknownFailures,outcome==='unknown'?1:0);assert.equal(f.memory.at(-1),0);assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));assert.ok(f.rows.every(row=>row.status==='submitting'&&!row.results_applied),'no unconfirmed row is reclassified as applied or definitely-not-sent');
});
for(const quoted of[false,true])test(`native handoff delivers every prevalidated call after ACK despite cancellation and notification failure (${quoted?'numeric quote':'legacy quote'})`,async()=>{
 const f=fixture(quoted);let valid=true;f.args.preparation_valid=()=>valid;
 f.args.feed_next=async()=>{const draft={proposals:f.proposals,workspace_bytes:64*1024,byte_limited:false,on_committed:()=>{throw Error('budget notification failed');}};return quoted?numericDraft(draft):draft;};
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));f.rows.push(...rows);callbacks.validateBeforeCommit(rows,selected);valid=false;f.cancellation.abort();return{kind:'committed',calls:rows};};
 await assert.rejects(processJevStreamingWindowV2(f.args),/budget notification failed/);assert.equal(f.physical.length,2);assert.equal(f.applied.length,2);assert.equal(f.memory.at(-1),0);assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));
});
for(const quoted of[false,true])test(`native cancellation before the late selector commits an empty roster with no provider call (${quoted?'numeric quote':'legacy quote'})`,async()=>{
 const f=fixture(quoted);let validations=0;
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{f.cancellation.abort();const selected=callbacks.selectFresh(drafts);assert.equal(selected.length,0);const rows:LabelingCallV1<FacetInput>[]=[];callbacks.validateBeforeCommit(rows,selected);validations++;return{kind:'committed',calls:rows};};
 await processJevStreamingWindowV2(f.args);assert.equal(validations,1);assert.equal(f.physical.length,0);assert.equal(f.state().reserves,0);assert.equal(f.memory.at(-1),0);assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));
});
test('native expansion that exceeds the preclaimed call custody rejects before COMMIT and never evaluates',async()=>{
 const f=fixture();f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));rows[0]!.request={...rows[0]!.request,state:'x'.repeat(1024*1024)};
  assert.throws(()=>callbacks.validateBeforeCommit(rows,selected),/native.*memory|native.*handoff/);throw Object.assign(Error('native expansion rollback'),{name:'LabelingAdmissionFailureV1',outcome:'rolled_back',call_ids:rows.map(row=>row.id),custom_ids:selected.map(row=>row.custom_id)});
 };
 await assert.rejects(processJevStreamingWindowV2(f.args),/native expansion rollback/);assert.equal(f.physical.length,0);assert.equal(f.state().reserves,0);assert.equal(f.memory.at(-1),0);
});

test('native repeated selector is rejected before a second provisional claim or physical attempt',async()=>{
 const f=fixture();f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  callbacks.selectFresh(drafts);assert.throws(()=>callbacks.selectFresh(drafts),/selection_repeated/);
  throw Object.assign(Error('duplicate selector rollback'),{outcome:'rolled_back'});
 };
 await assert.rejects(processJevStreamingWindowV2(f.args),/duplicate selector rollback/);assert.equal(f.physical.length,0);assert.equal(f.state().reserves,0);assert.equal(f.memory.at(-1),0);
});

test('native duplicate ledger identity is rejected by the staged roster before COMMIT',async()=>{
 const f=fixture();f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));rows[1]!.id=rows[0]!.id;
  assert.throws(()=>callbacks.validateBeforeCommit(rows,selected),/handoff_invalid/);throw Object.assign(Error('roster rollback'),{outcome:'rolled_back'});
 };
 await assert.rejects(processJevStreamingWindowV2(f.args),/roster rollback/);assert.equal(f.physical.length,0);assert.equal(f.memory.at(-1),0);
});

import {processJevLabelingPageV1} from './signal-jev-labeling-page';
type PageArgs=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
async function pageDraftCase(mode:'native'|'unsupported'|'oversize_workspace'|'generic_zero'|'generic_multi'|'bootstrap'){
 const f=fixture(),initial={root_id:'initial-root',text:'initial'}as FacetInput;
 const inputCount=mode==='bootstrap'?32:17;
 const inputs=Array.from({length:inputCount},(_,i)=>({root_id:'candidate-'+i,text:'candidate-'+i}))as FacetInput[];
 const surveys:number[]=[],legacySizes:number[]=[],nativeSizes:number[]=[],compiled:string[]=[];
 let notifications=0,bootstrapReserved=false;
 const baseReserve=f.args.store.reserve;
 const store={...f.args.store,claim:async()=>f.run,renew:async()=>{},release:async()=>{},calls:async()=>[],inputs:async()=>[initial],
  reserve:async(...params:Parameters<typeof baseReserve>)=>{legacySizes.push(params[1].length);if(params[1].some(p=>p.inputs[0]!.root_id.startsWith('candidate-')))bootstrapReserved=true;return baseReserve(...params);},
  admitAndMarkSelected:async(_run:LabelingRunV1,drafts:LabelingCallProposalV1<FacetInput>[],callbacks:Parameters<NonNullable<Args['store']['admitAndMarkSelected']>>[2])=>{
   nativeSizes.push(drafts.length);if(mode==='unsupported')return{kind:'legacy' as const};
   const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));callbacks.validateBeforeCommit(rows,selected);f.rows.push(...rows);return{kind:'committed' as const,calls:rows};
  }}as PageArgs['store'];
 const hooks:PageArgs['hooks']={continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>f.args.price,
  native_admission:{workspace_bound:()=>mode==='oversize_workspace'?execution.max_buffered_bytes*2:64*1024,committed:()=>{notifications++;}},
  select_next_inputs:values=>({inputs:values,minimum_calls:mode==='bootstrap'&&!bootstrapReserved?32:0}),
  propose:(_run,values)=>values.flatMap(input=>{
   compiled.push(input.root_id);
   if(input===inputs[0]&&mode==='generic_zero')return[];
   const count=input===inputs[0]&&mode==='generic_multi'?2:1;
   return Array.from({length:count},(_,index)=>({...proposal(0),custom_id:input.root_id+'-'+index,request_digest:input.root_id+'-'+index,inputs:[input],
    request:{...proposal(0).request,state:input.text}}));
  }),map:(_run,row)=>[row.id],error:()=>[],labeled:()=>true,fail_on_error:true};
 const result=await processJevLabelingPageV1({run_id:f.run.id,store,provider:f.args.provider,execution,hooks,
  initial_reservation:{max_calls:1024,release_selection:()=>{}},
  prepare:async()=>({provider:f.args.provider,execution,continuous_windows:true,bootstrap_initial_calls:1}),
  read_next_inputs:async(_run,bounds)=>{surveys.push(bounds.max_rows);const known=new Set(f.rows.flatMap(row=>row.inputs.map(input=>input.root_id)));return inputs.filter(input=>!known.has(input.root_id));},
  observe_stream:metrics=>f.memory.push(metrics.reserved_working_bytes)});
 assert.equal(result.status,'completed');assert.equal(f.memory.at(-1),0);assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));
 const expected=1+inputCount+(mode==='generic_multi'?1:mode==='generic_zero'?-1:0);
 assert.equal(f.physical.length,expected);assert.equal(f.applied.length,expected);assert.equal(new Set(f.applied).size,expected);
 assert.equal(surveys[0],4096,'survey and its extrema are not narrowed to the native draft');
 return{legacySizes,nativeSizes,notifications,compiled,inputs};
}
for(const mode of ['native','unsupported']as const)test(`page ${mode} native draft preserves census without replay across fresh reads`,async()=>{
 const result=await pageDraftCase(mode);assert.ok(result.nativeSizes.length>0);assert.ok(result.nativeSizes.every(size=>size<=8));
 if(mode==='native'){assert.equal(result.legacySizes.length,1);assert.ok(result.notifications>0);}else{assert.equal(result.notifications,0);assert.ok(result.legacySizes.slice(1).every(size=>size<=8));}
});
for(const mode of ['generic_zero','generic_multi']as const)test(`page ${mode} retains the complete legacy window without a second proposal pass`,async()=>{
 const result=await pageDraftCase(mode);assert.equal(result.nativeSizes.length,0);assert.equal(result.legacySizes[1],mode==='generic_zero'?16:18);
 for(const input of result.inputs.slice(1))assert.equal(result.compiled.filter(id=>id===input.root_id).length,1);
});
test('native workspace that cannot fit one call exits before native invocation through the finite legacy protocol',async()=>{
 const result=await pageDraftCase('oversize_workspace');assert.equal(result.nativeSizes.length,0);assert.equal(result.notifications,0);
 assert.ok(result.legacySizes.slice(1).every(size=>size===1));
});
test('bootstrap anchors remain an integral 32-call legacy reservation with no native draft',async()=>{
 const result=await pageDraftCase('bootstrap');assert.equal(result.nativeSizes.length,0);assert.deepEqual(result.legacySizes,[1,32]);
});

test('native late selector observes the current bootstrap cap instead of the earlier draft size',async()=>{
 const f=fixture();f.args.next_admission_hint=()=>({kind:'bootstrap',bootstrap_id:2,covered_call_limit:1,wait_for_apply:false});
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  const selected=callbacks.selectFresh(drafts);assert.equal(selected.length,1);const rows=selected.map(p=>call(p));callbacks.validateBeforeCommit(rows,selected);f.rows.push(...rows);return{kind:'committed',calls:rows};
 };
 const result=await processJevStreamingWindowV2(f.args);assert.equal(result.roots,1);assert.equal(f.physical.length,1);assert.equal(f.memory.at(-1),0);
});
test('native late selector admits nothing after bootstrap progress consumes its one overlap',async()=>{
 const f=fixture();let waiting=false;
 f.args.next_admission_hint=()=>({kind:'bootstrap',bootstrap_id:1,covered_call_limit:2,wait_for_apply:waiting});
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  waiting=true;const selected=callbacks.selectFresh(drafts);assert.equal(selected.length,0);const rows:LabelingCallV1<FacetInput>[]=[];callbacks.validateBeforeCommit(rows,selected);return{kind:'committed',calls:rows};
 };
 await processJevStreamingWindowV2(f.args);assert.equal(f.physical.length,0);assert.equal(f.state().feeds,1);assert.equal(f.memory.at(-1),0);
});

for(const shape of ['full','partial','none','cancel']as const)test(`native prefix search ${shape} matches a linear cost oracle with logarithmically bounded quotes`,async()=>{
 const f=fixture(),first=gate(),inputCount=1024,initial={root_id:'search-initial',text:'initial'}as FacetInput;
 const inputs=Array.from({length:inputCount},(_,i)=>({root_id:'search-'+i,text:'search-'+i}))as FacetInput[];
 const e={...execution,max_in_flight:1024,max_buffered_bytes:512*1024*1024};
 const surveys:number[]=[],quoteCounts:number[]=[],draftSizes:number[]=[],legacySizes:number[]=[];let available=0,reads=0;
 const make=(input:FacetInput):LabelingCallProposalV1<FacetInput>=>({...proposal(0),custom_id:input.root_id,request_digest:input.root_id,inputs:[input],request:{...proposal(0).request,state:input.text}});
 const pureQuote=(count:number)=>shape==='full'?64*1024:shape==='none'?e.max_buffered_bytes*2:count*2*1024*1024;
 const responseBytes=(f.args.provider.max_response_bytes!*24)+64*1024;
 const costs=[0];for(const input of inputs)costs.push(costs.at(-1)!+jevCallWorkingBytesV2(make(input)));
 const oracle=()=>{let best=0;for(let n=1;n<=inputCount;n++)if(costs[n]!*2+8192*n+pureQuote(n)+responseBytes*n<=available)best=n;return best;};
 const baseReserve=f.args.store.reserve;
 const store={...f.args.store,claim:async()=>f.run,renew:async()=>{},release:async()=>{},calls:async()=>[],inputs:async()=>[initial],
  reserve:async(...params:Parameters<typeof baseReserve>)=>{legacySizes.push(params[1].length);if(legacySizes.length>1){assert.equal(params[1].length,1,'no native call fits, so the finite legacy escape keeps one root');first.resolve();}return baseReserve(...params);},
  admitAndMarkSelected:async(_run:LabelingRunV1,drafts:LabelingCallProposalV1<FacetInput>[],callbacks:Parameters<NonNullable<Args['store']['admitAndMarkSelected']>>[2])=>{
   assert.notEqual(shape,'cancel','cancellation during pure quotes cannot open native authority');
   assert.equal(drafts.length,oracle(),'the maximal valid prefix matches the complete linear oracle before mock mutation');
   assert.deepEqual(drafts.map(p=>p.inputs[0]!.root_id),inputs.slice(0,drafts.length).map(input=>input.root_id));draftSizes.push(drafts.length);
   first.resolve();const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));callbacks.validateBeforeCommit(rows,selected);f.rows.push(...rows);return{kind:'committed' as const,calls:rows};
  }}as PageArgs['store'];
 const baseEvaluate=f.args.provider.evaluate;
 const provider:PageArgs['provider']={...f.args.provider,max_concurrency:1024,evaluate:async(request,options)=>{if(request.state==='initial')await first.promise;return baseEvaluate(request,options);}};
 const running=processJevLabelingPageV1({run_id:f.run.id,store,provider,execution:e,signal:f.cancellation.signal,
  initial_reservation:{max_calls:1024,release_selection:()=>{}},prepare:async()=>({provider,execution:e,continuous_windows:true,bootstrap_initial_calls:1}),
  read_next_inputs:async(_run,bounds)=>{surveys.push(bounds.max_rows);if(reads++>0)return[];available=bounds.max_working_bytes;return inputs;},
  hooks:{continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>f.args.price,
   native_admission:{workspace_bound:(_run,drafts)=>{quoteCounts.push(drafts.length);if(shape==='cancel'&&quoteCounts.length===2){f.cancellation.abort();first.resolve();}return pureQuote(drafts.length);}},
   propose:(_run,values)=>values.map(make),map:(_run,row)=>[row.id],error:()=>[],labeled:()=>true,fail_on_error:true},
  observe_stream:metrics=>f.memory.push(metrics.reserved_working_bytes)});
 try{
  const result=await running;assert.equal(result.status,shape==='cancel'?'stopped':'completed');assert.equal(surveys[0],4096);assert.equal(quoteCounts[0],1024);
  assert.ok(quoteCounts.length<=1+Math.ceil(Math.log2(inputCount+1)),`quote calls ${quoteCounts.length} must be logarithmic rather than one per removed proposal`);
  if(shape==='full'){assert.deepEqual(quoteCounts,[1024]);assert.deepEqual(draftSizes,[1024]);}
  if(shape==='partial')assert.deepEqual(draftSizes,[oracle()]);
  if(shape==='none'){assert.deepEqual(draftSizes,[]);assert.deepEqual(legacySizes,[1,1]);}
  if(shape==='cancel'){assert.deepEqual(draftSizes,[]);assert.deepEqual(legacySizes,[1]);assert.equal(f.physical.length,1);}
  assert.equal(f.memory.at(-1),0);assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=e.max_buffered_bytes));
 }finally{first.resolve();await running.catch(()=>{});}
});

// Regression: fitting against free bytes captured before feed held the previous
// HTTP cohort produced a stable smaller cohort even after APPLY released it.
for(const mode of['native','legacy']as const)test(`numeric prefix uses current postfeed custody; ${mode} preserves the correct suffix protocol`,async()=>{
 const f=fixture(),initialApplied=gate(),initial=Array.from({length:8},(_,i)=>call(proposal(100+i),'reserved'));
 const prepared=Array.from({length:8},(_,i)=>proposal(200+i)),workspace=(n:number)=>64*1024+n*2*1024*1024;
 const reservation=f.args.provider.max_response_bytes!*24+64*1024,selectedSizes:number[]=[],notices:string[][]=[];
 let reads=0,availableAtLaunch=0,initialCount=0;
 f.args.calls=initial;f.rows.push(...initial);
 const baseApply=f.args.store.apply,baseReserve=f.args.store.reserve,legacySizes:number[]=[];
 f.args.store.reserve=async(...args:Parameters<typeof baseReserve>)=>{legacySizes.push(args[1].length);return baseReserve(...args);};
 f.args.store.apply=async(...args:Parameters<typeof baseApply>)=>{await baseApply(...args);for(const row of args[1])if(initial.includes(row.call))initialCount++;
  if(initialCount===initial.length)initialApplied.resolve();};
 const makeDraft=(proposals:typeof prepared)=>{
  const prefix=[0];for(const p of proposals)prefix.push(prefix.at(-1)!+jevCallWorkingBytesV2(p));
  const metadata=256+8*prefix.length;
  return{proposals,workspace_bytes:workspace(proposals.length),workspace_quote:{length:proposals.length,retained_bytes:metadata,quote:workspace},
   call_working_prefix:Object.freeze(prefix),byte_limited:false,on_committed:(_ids:ReadonlyArray<string>,admitted:ReadonlyArray<LabelingCallProposalV1<FacetInput>>)=>{notices.push(admitted.map(p=>p.custom_id));}};
 };
 f.args.feed_next=async available=>{
  if(reads++===0){availableAtLaunch=available;await initialApplied.promise;await new Promise<void>(resolve=>setImmediate(resolve));return makeDraft(prepared);}
  if(reads===2&&mode==='native'){
   assert.equal(notices[0]!.length,7,'only ACK identities may advance the external metadata cursor');
   // A new RR changed the unpaid suffix body. The stream must not retain and
   // silently send the previous prepared object after its first prefix ACK.
   const fresh={...prepared[7]!,request_digest:'fresh-suffix-digest',request:{...prepared[7]!.request,state:'fresh-suffix'}};
   return makeDraft([fresh]);
  }
  return{closed:true};
 };
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{
  selectedSizes.push(drafts.length);if(mode==='legacy')return{kind:'legacy'};const selected=callbacks.selectFresh(drafts),rows=selected.map(p=>call(p));
  callbacks.validateBeforeCommit(rows,selected);f.rows.push(...rows);return{kind:'committed',calls:rows};
 };
 const callCosts=[0];for(const p of prepared)callCosts.push(callCosts.at(-1)!+jevCallWorkingBytesV2(p));
 const result=await processJevStreamingWindowV2(f.args);
 // Recompute the old prefeed oracle only after its observed available is known.
 let staleBest=0;for(let n=1;n<=prepared.length;n++)if(callCosts[n]!*2+8192*n+workspace(n)+reservation*n<=availableAtLaunch)staleBest=n;
 assert.equal(staleBest,6,'the retained old timing would have cut a different prefix');
 assert.deepEqual(selectedSizes,mode==='native'?[7,1]:[7]);assert.equal(result.roots,16);assert.equal(f.physical.length,16);assert.equal(new Set(f.applied).size,16);
 assert.deepEqual(legacySizes,mode==='native'?[]:[8],'unsupported preflight preserves the ENTIRE prepared eight-call legacy prefix');
 assert.equal(f.physical.includes('text-207'),mode==='legacy');assert.equal(f.physical.includes('fresh-suffix'),mode==='native');
 assert.deepEqual(notices.map(ids=>ids.length),mode==='native'?[7,1]:[]);assert.equal(f.memory.at(-1),0);
 assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes),'both numeric vectors and the entire unused draft stay charged');
});


test('page constructs the real numeric factory only after freezing its private draft and retains both vectors through ACK',async()=>{
 const f=fixture(),entered=gate(),ack=gate(),initial={root_id:'real-quote-initial',text:'initial'}as FacetInput;
 const inputs=Array.from({length:3},(_,i)=>({root_id:'real-quote-'+i,text:'real-quote-'+i}))as FacetInput[];
 Object.assign(f.run,{kind:'mass_labeling',identity:signalListeningJevIdentityV1(signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}))});
 let factories=0,workspace=0,proposals:LabelingCallProposalV1<FacetInput>[]=[],selected:LabelingCallProposalV1<FacetInput>[]=[],reads=0;
 const store={...f.args.store,claim:async()=>f.run,renew:async()=>{},release:async()=>{},calls:async()=>[],inputs:async()=>[initial],
  admitAndMarkSelected:async(_run:LabelingRunV1,drafts:LabelingCallProposalV1<FacetInput>[],callbacks:Parameters<NonNullable<Args['store']['admitAndMarkSelected']>>[2])=>{
   selected=[...callbacks.selectFresh(drafts)];const rows=selected.map(p=>call(p));callbacks.validateBeforeCommit(rows,selected);entered.resolve();await ack.promise;
   f.rows.push(...rows);return{kind:'committed' as const,calls:rows};
  }}as PageArgs['store'];
 const running=processJevLabelingPageV1({run_id:f.run.id,store,provider:f.args.provider,execution,
  initial_reservation:{max_calls:1024,release_selection:()=>{}},prepare:async()=>({provider:f.args.provider,execution,continuous_windows:true,bootstrap_initial_calls:1}),
  read_next_inputs:async()=>reads++===0?inputs:[],observe_stream:value=>f.memory.push(value.reserved_working_bytes),
  hooks:{continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>f.args.price,
   native_admission:{workspace_bound:nativeListeningAdmissionWorkspaceBoundV1,workspace_quote:(run,drafts)=>{
    factories++;proposals=[...drafts];
    for(const draft of drafts){assert.ok(Object.isFrozen(draft)&&Object.isFrozen(draft.request)&&Object.isFrozen(draft.inputs)&&Object.isFrozen(draft.inputs[0]!));
     assert.equal(Reflect.set(draft.request,'state','mutated-after-preparation'),false,'the reusable quote has an immutable body snapshot');}
    const quote=createNativeListeningAdmissionWorkspaceQuoteV1(run,drafts);assert.ok(quote);workspace=quote.quote(drafts.length);return quote;
   }},
   propose:(_run,values)=>values.map(input=>({...proposal(0),custom_id:input.root_id,request_digest:input.root_id,inputs:[input],request:{...proposal(0).request,state:input.text}})),
   map:(_run,row)=>[row.id],error:()=>[],labeled:()=>true,fail_on_error:true}});
 try{await entered.promise;assert.equal(factories,1);assert.equal(proposals.length,3);assert.equal(selected.length,3);
  const proposalCustody=proposals.reduce((sum,p)=>sum+jevCallWorkingBytesV2(p)+8192,0),vectors=2*(256+8*(proposals.length+1)),returned=selected.reduce((sum,p)=>sum+jevCallWorkingBytesV2(p),0),responses=selected.length*(f.args.provider.max_response_bytes!*24+64*1024);
  assert.ok(f.memory.at(-1)!>=proposalCustody+vectors+workspace+returned+responses,'all five custody owners coexist until native ACK');
  assert.equal(f.physical.filter(value=>value.startsWith('real-quote-')).length,0);
  ack.resolve();const result=await running;assert.equal(result.status,'completed');assert.equal(f.physical.length,4);assert.equal(f.applied.length,4);assert.equal(f.memory.at(-1),0);
 }finally{ack.resolve();await running.catch(()=>{});}
});


for(const quoted of[false,true])test(`profile preparation invalidated while native authority waits selects no paid cohort (${quoted?'numeric quote':'legacy quote'})`,async()=>{
 const f=fixture(quoted);let valid=true;f.args.preparation_valid=()=>valid;
 f.args.store.admitAndMarkSelected=async(_run,drafts,callbacks)=>{valid=false;const selected=callbacks.selectFresh(drafts);assert.equal(selected.length,0);
  const rows:LabelingCallV1<FacetInput>[]=[];callbacks.validateBeforeCommit(rows,selected);return{kind:'committed',calls:rows};};
 await processJevStreamingWindowV2(f.args);assert.equal(f.physical.length,0);assert.equal(f.state().reserves,0);assert.equal(f.memory.at(-1),0);
 assert.ok(f.memory.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));
});
