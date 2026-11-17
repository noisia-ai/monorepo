import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallV1} from '@noisia/db';
import {processJevLabelingPageV1} from './signal-jev-labeling-page';
import {createTypesafeJevClientV1} from '../providers/typesafe-jev';
const execution={max_in_flight:1,flush_size:32,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:32};
test('external cancellation preserves first-party unsent identity and drains paid siblings; restart sends only reserved calls',async()=>{
 for(const phase of ['before','during_mark','paid_sibling']as const){
  type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
  const control=new AbortController(),run={id:'external',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
  const rows=Array.from({length:2},(_,i)=>({id:'external-'+i,status:'reserved',raw_body:null,results_applied:false,request_digest:'digest-'+i,
   request:{model:'jev-1.13.0',state:'root-'+i,questions:{q:{type:'noul',instructions:'Configured data'}}},inputs:[{root_id:'root-'+i,text:'root-'+i}]}))as unknown as LabelingCallV1<FacetInput>[];
  let claims=0,releases=0,failures=0,requeued=0;const sent:string[]=[],applied:string[]=[];
  const store={claim:async()=>{claims++;return run;},renew:async()=>{},release:async()=>{releases++;},calls:async()=>rows.filter(r=>!r.results_applied),inputs:async()=>[],reserve:async()=>{throw Error('unexpected reserve');},
   markSubmitting:async(_run:unknown,calls:typeof rows)=>{for(const c of calls)c.status='submitting';if(phase==='during_mark')control.abort();},
   requeueUnsent:async(_run:unknown,calls:typeof rows)=>{for(const c of calls){c.status='reserved';requeued++;}},
   persistRawPage:async(_run:unknown,page:Array<{call:typeof rows[number];raw:string}>)=>{for(const r of page)r.call.raw_body=r.raw;},
   settlePage:async(_run:unknown,page:Array<{call:typeof rows[number]}>)=>{for(const r of page)r.call.status='settled';},
   apply:async(_run:unknown,page:Array<{call:typeof rows[number];results:string[]}>)=>{for(const r of page){r.call.results_applied=true;applied.push(...r.results);}},
   finish:async()=>rows.every(r=>r.results_applied)?'completed':'running',refresh:async()=>run,
   fail:async()=>{failures++;},markFailed:async()=>{failures++;},
  }as unknown as Args['store'];
  const provider=createTypesafeJevClientV1({api_key:'synthetic',enabled:true,concurrency:2,max_response_bytes:4096,fetch:async(_url,init)=>{
   const request=JSON.parse(String(init?.body));sent.push(request.state);if(phase==='paid_sibling'&&sent.length===1)control.abort();
   await new Promise(resolve=>setTimeout(resolve,1));return Response.json({model:request.model,usage:{input_tokens:10,output_tokens:0},answers:{q:{type:'noul',noul:.8}}});
  }});
  const hooks:Args['hooks']={price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),propose:()=>[],map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>{throw Error('no technical results for never sent');},labeled:()=>true,fail_on_error:true};
  if(phase==='before')control.abort();
  assert.equal((await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution:{...execution,max_in_flight:2},signal:control.signal})).status,'stopped');
  assert.equal(sent.length,phase==='paid_sibling'?1:0);assert.equal(failures,0);assert.equal(claims,phase==='before'?0:1);assert.equal(releases,phase==='before'?0:1);
  if(phase!=='before')assert.equal(requeued,phase==='paid_sibling'?1:2);
  assert.equal((await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution:{...execution,max_in_flight:2}})).status,'completed');
  assert.deepEqual([...sent].sort(),['root-0','root-1']);assert.deepEqual([...applied].sort(),['root-0','root-1']);
 }
});
test('external abort during preparation returns stopped and always removes the signal listener',async()=>{
 const control=new AbortController();let added=0,removed=0,released=0;
 const add=control.signal.addEventListener.bind(control.signal),remove=control.signal.removeEventListener.bind(control.signal);
 control.signal.addEventListener=((...args:Parameters<typeof add>)=>{added++;return add(...args);})as typeof add;
 control.signal.removeEventListener=((...args:Parameters<typeof remove>)=>{removed++;return remove(...args);})as typeof remove;
 const run={id:'prepared-stop',lease_token:'lease'}as LabelingRunV1;
 const store={claim:async()=>run,release:async()=>{released++;},renew:async()=>{},inputs:async()=>{throw Error('must not hydrate');}}as unknown as Parameters<typeof processJevLabelingPageV1>[0]['store'];
 const provider={evaluate:async()=>{throw Error('must not send');}};
 const result=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks:{}as never,signal:control.signal,
  prepare:async()=>{control.abort();return{provider,execution};}});
 assert.equal(result.status,'stopped');assert.equal(released,1);assert.equal(added,1);assert.equal(removed,1);
});
test('bounded streaming yields one window on the same run and resumes only unsent roots with immediate release',async()=>{
  const run={id:'run',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
  const windows=[[{root_id:'root1',text:'first'}],[{root_id:'root2',text:'second'}]]as FacetInput[][];
  const calls:LabelingCallV1<FacetInput>[]=[],sent:string[]=[],applied:string[]=[],releases:unknown[]=[];let claims=0;
  type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
  const store={async claim(id:string){assert.equal(id,run.id);claims++;return run;},async renew(){},async release(_run:unknown,options:unknown){releases.push(options);},
    async calls(){return calls.filter(call=>!call.results_applied);},async inputs(){return windows.shift()??[];},
    async reserve(_run:unknown,proposals:unknown[]){const rows=proposals.map(proposal=>({...proposal as object,id:`call${calls.length}`,status:'reserved',raw_body:null,results_applied:false}));calls.push(...rows as never[]);return rows;},
    async markSubmitting(_run:unknown,rows:LabelingCallV1<FacetInput>[]){rows.forEach(call=>{call.status='submitting';});},
    async persistRawPage(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>){rows.forEach(row=>{row.call.raw_body=row.raw;});},
    async settlePage(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>){rows.forEach(row=>{assert.ok(row.call.raw_body);row.call.status='settled';});},
    async apply(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;results:string[]}>){rows.forEach(row=>{applied.push(...row.results);row.call.results_applied=true;});},
    async finish(){run.status=windows.length?'running':'completed';return run.status;},async markFailed(){throw Error('unexpected_failure');},async fail(){throw Error('unexpected_run_failure');},
  }as unknown as Args['store'];
  const provider:Args['provider']={max_concurrency:1,max_response_bytes:4096,async evaluate(request){sent.push(String(request.state));return{http_status:200,latency_ms:1,
    body:JSON.stringify({model:request.model,usage:{input_tokens:10,output_tokens:0},answers:{q:{type:'noul',noul:.9}}})};}};
  const hooks:Args['hooks']={price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
    propose:(_run,inputs)=>inputs.map(input=>({request:{model:'jev-1.13.0',state:input.text,questions:{q:{type:'noul',instructions:'configured question'}}},request_digest:'digest',custom_id:input.root_id,inputs:[input],reserved_micro_usd:100})),
    map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>[],labeled:()=>true,fail_on_error:true};
  const first=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution,max_windows:1});
  assert.equal(first.status,'running');assert.deepEqual(sent,['first']);assert.equal(windows.length,1);assert.deepEqual(releases,[{immediate:true}]);
  const resumed=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution,max_windows:1});
  assert.equal(resumed.status,'completed');assert.deepEqual(sent,['first','second']);assert.deepEqual(applied,['root1','root2']);assert.equal(claims,2);
});
test('invalid max_windows fails before claiming any work',async()=>{
  let claimed=0;
  const store={claim:async()=>{claimed++;return null;}}as unknown as Parameters<typeof processJevLabelingPageV1>[0]['store'];
  for(const value of [0,-1,1.5,4097])await assert.rejects(processJevLabelingPageV1({run_id:'run',store,provider:{}as never,hooks:{}as never,execution,max_windows:value}),/jev_window_limit_invalid/);
  assert.equal(claimed,0);
});
test('asynchronous preparation runs under a renewable lease and selects immutable local execution before reserve',async()=>{
  type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
  const run={id:'prepared',lease_token:'lease',status:'running',error_code:null}as LabelingRunV1;
  const order:string[]=[];let renewals=0;
  const store={async claim(){order.push('claim');return run;},async renew(){renewals++;},async release(){order.push('release');},
    async calls(){order.push('calls');return[];},async inputs(){return[];},async reserve(){throw Error('unexpected reserve');},
    async finish(){return'completed';},async fail(){throw Error('unexpected fail');}}as unknown as Args['store'];
  const original={max_response_bytes:4096,evaluate:async()=>{throw Error('wrong provider');}};
  const args:Args={run_id:run.id,store,provider:original,hooks:{price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
    propose:()=>[],map:()=>[],error:()=>[],labeled:()=>true},lease_renewal_ms:1,
    prepare:async leased=>{assert.equal(leased.lease_token,'lease');assert.ok(Object.isFrozen(leased));order.push('prepare');
      await new Promise(resolve=>setTimeout(resolve,10));return{provider:original,execution,max_windows:1};}};
  assert.equal((await processJevLabelingPageV1(args)).status,'completed');
  assert.ok(renewals>0);assert.deepEqual(order,['claim','prepare','calls','release']);
  assert.equal(args.execution,undefined);assert.equal(args.max_windows,undefined);assert.equal(args.provider,original);
});
test('invalid preparation and transient preparation failures release the lease before any reservation without inventing a terminal outcome',async()=>{
  type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
  let releases=0,failures=0;const run={id:'run',lease_token:'lease'}as LabelingRunV1;
  const store={async claim(){return run;},async release(){releases++;},async renew(){},async fail(){failures++;},
    async reserve(){throw Error('unexpected reserve');},async calls(){throw Error('unexpected calls');}}as unknown as Args['store'];
  const base={run_id:run.id,store,provider:{evaluate:async()=>{throw Error('unexpected provider');}},hooks:{}as Args['hooks']};
  await assert.rejects(processJevLabelingPageV1({...base,prepare:async()=>{throw Error('database_temporarily_unavailable');}}),/database_temporarily_unavailable/);
  await assert.rejects(processJevLabelingPageV1({...base,prepare:async()=>({provider:base.provider,execution:{...execution,window_size:0}})}),/jev_stream_configuration_invalid/);
  assert.equal(releases,2);assert.equal(failures,0);
});
test('prepared recovery is additive and cannot disable recovery forced by the owner',async()=>{
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 for(const forced of [false,true]){
  const run={id:'recovery',lease_token:'lease',error_code:null}as LabelingRunV1;let sends=0,reserves=0;
  const store={claim:async()=>run,calls:async()=>[],renew:async()=>{},release:async()=>{},inputs:async()=>{throw Error('must not select new roots');},
   reserve:async()=>{reserves++;return[];}}as unknown as Args['store'];
  const provider={max_response_bytes:4096,evaluate:async()=>{sends++;throw Error('must not send');}};
  const hooks={recovery_only:forced,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),propose:()=>[],map:()=>[],error:()=>[],labeled:()=>true};
  const result=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution,
   prepare:async()=>({provider,execution,max_windows:1,recovery_only:!forced})});
  assert.equal(result.status,'recovery_unavailable');assert.equal(sends,0);assert.equal(reserves,0);
 }
});

test('native continuous windows reserve and send the next page before the preceding final flush on one bounded scheduler',async()=>{
  for(const max_windows of [undefined,1,2]){
    type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
    const run={id:'continuous',lease_token:'one-lease',error_code:null,status:'running'}as LabelingRunV1;
    const corpus=Array.from({length:6},(_,i)=>({root_id:`root-${i}`,text:`mention-${i}`}))as FacetInput[];
    const calls:LabelingCallV1<FacetInput>[]=[],events:string[]=[],snapshots:number[]=[];let active=0,peak=0,claims=0;
    const store={claim:async()=>{claims++;return run;},renew:async()=>{},release:async()=>{},
      calls:async()=>calls.filter(call=>!call.results_applied),
      // Match both native adapters: reservation excludes the identity even while
      // its raw response has not reached durable application yet.
      inputs:async()=>corpus.filter(input=>!calls.some(call=>call.inputs[0]!.root_id===input.root_id)).slice(0,2),
      reserve:async(_run:unknown,proposals:unknown[])=>{
        events.push(`reserve:${calls.length/2+1}`);
        const rows=proposals.map((proposal,i)=>({...proposal as object,id:`call-${calls.length+i}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];
        calls.push(...rows);return rows;},
      markSubmitting:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{for(const call of rows)call.status='submitting';},
      persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{events.push('flush');for(const row of rows)row.call.raw_body=row.raw;},
      settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows)row.call.status='settled';},
      apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows)row.call.results_applied=true;},
      finish:async()=>calls.length===corpus.length&&calls.every(call=>call.results_applied)?'completed':'running',
      markFailed:async()=>{throw Error('unexpected failure');},fail:async()=>{throw Error('unexpected failure');},
    }as unknown as Args['store'];
    const provider:Args['provider']={max_response_bytes:4096,max_concurrency:2,async evaluate(request){
      active++;peak=Math.max(peak,active);events.push(`send:${request.state}`);await Promise.resolve();active--;
      return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};}};
    const hooks:Args['hooks']={continuous_windows:()=>true,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
      propose:(_run,inputs)=>inputs.map(input=>({request:{model:'jev-1.13.0',state:input.text,questions:{q:{type:'noul',instructions:'configured'}}},
        request_digest:input.root_id,custom_id:input.root_id,inputs:[input],reserved_micro_usd:100})),
      map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>[],labeled:()=>true,fail_on_error:true};
    const result=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,max_windows,
      read_next_inputs:async(leased,bounds)=>{assert.equal(leased,run);assert.ok(bounds.max_rows>0&&bounds.max_rows<=2);
        assert.ok(bounds.max_working_bytes>0&&bounds.max_working_bytes<=execution.max_buffered_bytes);return store.inputs(leased);},
      execution:{...execution,max_in_flight:2,window_size:2,flush_size:16,flush_interval_ms:60000},observe_stream:m=>snapshots.push(m.reserved_working_bytes)});
    const expected=max_windows===1?2:max_windows===2?4:6;
    assert.equal(result.labeled,expected);assert.equal(calls.length,expected);assert.equal(claims,1);assert.ok(peak<=2);
    assert.equal(new Set(calls.map(call=>call.inputs[0]!.root_id)).size,expected);
    assert.ok(snapshots.every(bytes=>bytes>=0&&bytes<=execution.max_buffered_bytes));assert.equal(snapshots.at(-1),0);
    if(max_windows!==1){assert.ok(events.indexOf('reserve:2')<events.indexOf('flush'));
      assert.ok(events.indexOf('send:mention-2')<events.indexOf('flush'),'next HTTP feeds the same pipeline before final durable drain');}
  }
});

test('a supported 4096-member flush paginates application at the native 2000-root consumer contract',async()=>{
 const {processJevStreamingWindowV2}=await import('./signal-jev-streaming-window');
 const calls=Array.from({length:2001},(_,i)=>({id:`call-${i}`,request_digest:`digest-${i}`,status:'reserved',raw_body:null,
  request:{model:'jev-1.13.0',state:'mention',questions:{q:{type:'noul',instructions:'Configured question'}}},
  inputs:[{root_id:`root-${i}`,text:'mention'}]}))as unknown as LabelingCallV1<FacetInput>[];
 const sizes:number[]=[];let physical=0;
 type Store=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0]['store'];
 const store={markSubmitting:async()=>{},persistRawPage:async()=>{},settlePage:async()=>{},
  apply:async(_run:unknown,batch:unknown[])=>{assert.ok(batch.length<=2000);sizes.push(batch.length);},finish:async()=> 'completed',
  markFailed:async()=>{throw Error('unexpected failure');}}as unknown as Store;
 const result=await processJevStreamingWindowV2({run:{}as LabelingRunV1,calls,store,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  provider:{max_concurrency:4096,max_response_bytes:4096,async evaluate(){physical++;return{http_status:200,latency_ms:1,
   body:'{"model":"jev-1.13.0","usage":{"input_tokens":1,"output_tokens":0},"answers":{"q":{"type":"noul","noul":0.8}}}'};}},
  execution:{max_in_flight:4096,window_size:4096,flush_size:4096,max_flushes:1,max_buffered_bytes:512*1024*1024,flush_interval_ms:60000},
  cancellation:new AbortController(),hooks:{map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>[],labeled:()=>true}});
 assert.equal(physical,2001);assert.equal(result.labeled,2001);assert.deepEqual(sizes,[2000,1]);
});

test('native continuous inputs are byte-bounded before initial hydration and oversize failures retain their owner',async()=>{
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const run={id:'bounded',lease_token:'lease',error_code:null}as LabelingRunV1;
 let reads=0,reserves=0,failures=0,releases=0;
 const store={claim:async()=>run,renew:async()=>{},release:async()=>{releases++;},calls:async()=>[],
  inputs:async(_run:LabelingRunV1,bounds?:{max_rows:number;max_working_bytes:number;on_oversize?:string})=>{
   reads++;assert.equal(bounds?.max_rows,execution.window_size);assert.equal(bounds?.on_oversize,'error');
   assert.equal(bounds?.max_working_bytes,execution.max_buffered_bytes-(4096*24+64*1024));
   throw Error('labeling_input_memory_bound');
  },reserve:async()=>{reserves++;return[];},fail:async()=>{failures++;}}as unknown as Args['store'];
 await assert.rejects(processJevLabelingPageV1({run_id:run.id,store,provider:{max_response_bytes:4096,evaluate:async()=>{throw Error('unexpected HTTP');}},execution,
  hooks:{continuous_windows:()=>true,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),propose:()=>[],map:()=>[],error:()=>[],labeled:()=>true}}),/labeling_input_memory_bound/);
 assert.equal(reads,1);assert.equal(reserves,0);assert.equal(failures,0);assert.equal(releases,1);
});

test('external signal cannot silently opt a legacy non-streaming consumer into cancellation semantics',async()=>{
 let claims=0;const store={claim:async()=>{claims++;return null;}}as unknown as Parameters<typeof processJevLabelingPageV1>[0]['store'];
 await assert.rejects(processJevLabelingPageV1({run_id:'legacy',store,provider:{}as never,hooks:{}as never,signal:new AbortController().signal}),/external_signal_requires_streaming/);assert.equal(claims,0);
});

function deferredFrontier(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
/** Two phases on one root: native eligibility excludes reserved identities and
 * consumer becomes visible only after the base result is durably applied. */
async function exerciseEmptyFrontier(mode:'before_mark'|'pending_apply'|'during_read'|'legacy'|'unsupported'|'no_proposals'|'no_reservation'|'permanent'){
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const run={id:'empty-frontier',lease_token:'one-lease',error_code:null,status:'running'}as LabelingRunV1;
 const calls:LabelingCallV1<FacetInput>[]=[],events:string[]=[];
 const emptySeen=deferredFrontier(),applyStarted=deferredFrontier(),applyReturned=deferredFrontier();
 let baseApplied=false,consumerApplied=false,feedReads=0,initialReads=0,prepareCalls=0,claims=0;
 const input=(phase:string)=>({root_id:phase,text:phase})as FacetInput;
 const store={claim:async()=>{claims++;return run;},renew:async()=>{},release:async()=>{events.push('release');},calls:async()=>[],
  inputs:async()=>{initialReads++;return mode==='permanent'?[]:[input('base')];},
  reserve:async(_run:unknown,proposals:unknown[])=>{if(mode==='no_reservation'&&calls.length)return[];const rows=proposals.map((p,i)=>({...p as object,id:`call-${calls.length+i}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];calls.push(...rows);return rows;},
  markSubmitting:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{
   if(rows[0]?.inputs[0]?.text==='base'&&(mode==='before_mark'||mode==='legacy'))await emptySeen.promise;
   for(const row of rows){row.status='submitting';events.push(`mark:${row.inputs[0]!.text}`);}
  },
  persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{for(const row of rows){row.call.raw_body=row.raw;events.push(`raw:${row.call.inputs[0]!.text}`);}},
  settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows){assert.ok(row.call.raw_body);row.call.status='settled';events.push(`settle:${row.call.inputs[0]!.text}`);}},
  apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
   for(const row of rows){const phase=row.call.inputs[0]!.text;assert.equal(row.call.status,'settled');
    if(phase==='base'){applyStarted.resolve();if(mode==='pending_apply')await emptySeen.promise;baseApplied=true;applyReturned.resolve();}else consumerApplied=true;
    row.call.results_applied=true;events.push(`apply:${phase}`);
   }
  },
  finish:async()=>consumerApplied||mode==='permanent'?'completed':'running',
  fail:async()=>{throw Error('unexpected fail');},markFailed:async()=>{throw Error('unexpected unknown');},
 }as unknown as Args['store'];
 const provider:Args['provider']={max_concurrency:2,max_response_bytes:4096,async evaluate(request){events.push(`http:${request.state}`);return{http_status:200,latency_ms:1,
  body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};}};
 const result=await processJevLabelingPageV1({run_id:run.id,store,provider,
  execution:{...execution,max_in_flight:2,window_size:2,flush_size:mode==='pending_apply'||mode==='during_read'?1:32,flush_interval_ms:60000},
  read_next_inputs:async()=>{
   feedReads++;assert.ok(feedReads<=4,'at most one fresh read per apply epoch and one lookahead per nonempty page');
   if(feedReads===1){
    if(mode==='pending_apply')await applyStarted.promise;
    if(mode==='during_read'){await applyReturned.promise;await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(baseApplied);}
    emptySeen.resolve();return[];
   }
   assert.ok(baseApplied,'fresh read only after durable application');
   if(consumerApplied||calls.some(row=>row.inputs[0]!.text==='consumer'))return[];
   return[input('consumer')];
  },hooks:{continuous_windows:()=>true,revisit_empty_after_apply:mode!=='legacy',price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
   prepare_next:async()=>{prepareCalls++;return mode!=='unsupported';},
   propose:(_run,inputs)=>mode==='no_proposals'&&inputs[0]?.text==='consumer'?[]:inputs.map(row=>({request:{model:'jev-1.13.0',state:row.text,questions:{q:{type:'noul',instructions:'configured'}}},request_digest:row.text,custom_id:row.text,inputs:[row],reserved_micro_usd:100})),
   map:(_run,call)=>[call.inputs[0]!.text],error:()=>[],labeled:()=>true,fail_on_error:true,
  }});
 return{result,calls,events,baseApplied,consumerApplied,feedReads,initialReads,prepareCalls,claims};
}
for(const mode of ['before_mark','pending_apply','during_read']as const)test(`Listening empty frontier ${mode} rechecks after durable progress in the same invocation`,async()=>{
 const x=await exerciseEmptyFrontier(mode);assert.equal(x.result.status,'completed');assert.equal(x.claims,1);assert.equal(x.initialReads,1);
 assert.equal(x.calls.length,2);assert.equal(x.baseApplied,true);assert.equal(x.consumerApplied,true);assert.equal(x.feedReads,4);assert.equal(x.prepareCalls,1);
 for(const phase of ['base','consumer']){for(const stage of ['http','raw','settle','apply'])assert.equal(x.events.filter(e=>e===`${stage}:${phase}`).length,1);
  assert.ok(x.events.indexOf(`http:${phase}`)<x.events.indexOf(`raw:${phase}`));assert.ok(x.events.indexOf(`raw:${phase}`)<x.events.indexOf(`settle:${phase}`));assert.ok(x.events.indexOf(`settle:${phase}`)<x.events.indexOf(`apply:${phase}`));}
 assert.ok(x.events.indexOf('apply:base')<x.events.indexOf('http:consumer'));
});
test('legacy empty frontier still closes immediately despite later application',async()=>{
 const x=await exerciseEmptyFrontier('legacy');assert.equal(x.calls.length,1);assert.equal(x.feedReads,1);assert.equal(x.consumerApplied,false);
});
test('permanent empty native frontier closes without polling or requests',async()=>{
 const x=await exerciseEmptyFrontier('permanent');assert.equal(x.feedReads,1);assert.equal(x.calls.length,0);assert.equal(x.result.status,'completed');
});
for(const mode of ['unsupported','no_proposals','no_reservation']as const)test(`Listening ${mode} yields without retrying the empty frontier`,async()=>{
 const x=await exerciseEmptyFrontier(mode);assert.equal(x.calls.length,1);assert.equal(x.feedReads,2);assert.equal(x.prepareCalls,1);assert.equal(x.consumerApplied,false);assert.equal(x.result.status,'running');
});

test('Listening waiting at an empty frontier preserves batching while HTTP siblings remain active',async()=>{
 const {processJevStreamingWindowV2}=await import('./signal-jev-streaming-window');
 const calls=Array.from({length:2},(_,i)=>({id:`batch-${i}`,request_digest:`batch-${i}`,status:'reserved',raw_body:null,
  request:{model:'jev-1.13.0',state:String(i),questions:{q:{type:'noul',instructions:'configured'}}},inputs:[{root_id:String(i),text:String(i)}]}))as unknown as LabelingCallV1<FacetInput>[];
 const firstBuffered=deferredFrontier();let rawPages=0,reads=0,attempts=0;
 type Store=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0]['store'];
 const store={markSubmitting:async()=>{},persistRawPage:async(_run:unknown,rows:unknown[])=>{rawPages++;assert.equal(rows.length,2,'empty frontier must not flush the first response alone');},
  settlePage:async()=>{},apply:async()=>{},finish:async()=> 'completed',markFailed:async()=>{throw Error('unexpected failure');}}as unknown as Store;
 const result=await processJevStreamingWindowV2({run:{}as LabelingRunV1,calls,store,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  cancellation:new AbortController(),revisit_empty_after_apply:true,
  feed_next:async()=>{reads++;assert.ok(reads<=2);return[];},
  observe_stream:metrics=>{if(metrics.buffered_responses===1)firstBuffered.resolve();},
  provider:{max_concurrency:3,max_response_bytes:4096,async evaluate(request){attempts++;
   if(request.state==='1'){await firstBuffered.promise;await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(rawPages,0);}
   return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};}},
  execution:{...execution,max_in_flight:3,window_size:3,flush_size:32,flush_interval_ms:60000},
  hooks:{map:(_run,call)=>[call.id],error:()=>[],labeled:()=>true}});
 assert.equal(result.labeled,2);assert.equal(attempts,2);assert.equal(rawPages,1);assert.equal(reads,2);
});

/** One retained future read cannot own the wakeup of previously committed calls. */
async function exerciseAdmissionWake(mode:'http'|'apply'|'cancel'|'feed_failure'|'mark_failure'|'feed_memory_only'){
 const {processJevStreamingWindowV2}=await import('./signal-jev-streaming-window');
 type Store=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0]['store'];
 const rows=Array.from({length:mode==='feed_memory_only'?1:3},(_,i)=>({id:`wake-${i}`,request_digest:`wake-${i}`,status:'reserved',raw_body:null,results_applied:false,
  request:{model:'jev-1.13.0',state:String(i),questions:{q:{type:'noul',instructions:'configured'}}},inputs:[{root_id:String(i),text:String(i)}]}))as unknown as LabelingCallV1<FacetInput>[];
 const feedStarted=deferredFrontier(),feedGate=deferredFrontier(),firstResponse=deferredFrontier(),secondResponse=deferredFrontier(),
  firstBuffered=deferredFrontier(),applyStarted=deferredFrontier(),applyGate=deferredFrontier();
 const cancellation=new AbortController(),events:string[]=[],memory:number[]=[],sent:string[]=[],raw:string[]=[],settled:string[]=[],applied:string[]=[],requeued:string[]=[];
 let reads=0,feedReleased=false,rawPages=0,finished=0,active=0,peak=0;
 const store={markSubmitting:async(_run:unknown,calls:typeof rows)=>{
   for(const call of calls){events.push(`mark:${call.id}`);call.status='submitting';}
   if(mode==='mark_failure'&&calls.some(call=>call.id==='wake-2'))throw Error('mark_ack_lost');
  },requeueUnsent:async(_run:unknown,calls:typeof rows)=>{for(const call of calls){requeued.push(call.id);call.status='reserved';}},
  persistRawPage:async(_run:unknown,page:Array<{call:typeof rows[number];raw:string}>)=>{rawPages++;for(const row of page){raw.push(row.call.id);row.call.raw_body=row.raw;}},
  settlePage:async(_run:unknown,page:Array<{call:typeof rows[number]}>)=>{for(const row of page){assert.ok(raw.includes(row.call.id));settled.push(row.call.id);row.call.status='settled';}},
  apply:async(_run:unknown,page:Array<{call:typeof rows[number]}>)=>{applyStarted.resolve();if(mode==='apply')await applyGate.promise;
   for(const row of page){assert.ok(settled.includes(row.call.id));applied.push(row.call.id);row.call.results_applied=true;}},
  finish:async()=>{finished++;return rows.every(row=>row.results_applied)?'completed':'running';},
  markFailed:async()=>{throw Error('paid RAW must drain without invented failure');},
 }as unknown as Store;
 const budget=mode==='feed_memory_only'?210000:552*1024;
 const pending=processJevStreamingWindowV2({run:{}as LabelingRunV1,calls:rows,store,cancellation,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  execution:{max_in_flight:2,window_size:3,flush_size:2,max_flushes:1,max_buffered_bytes:budget,flush_interval_ms:60000},
  revisit_empty_after_apply:true,feed_next:async()=>{reads++;assert.equal(reads,1,'one feeder, no repeated SQL while its read is pending');feedStarted.resolve();await feedGate.promise;
   if(mode==='feed_failure')throw Error('feed_read_failed');return{closed:true};},
  observe_stream:m=>{memory.push(m.reserved_working_bytes);if(m.buffered_responses===1)firstBuffered.resolve();},
  provider:{max_concurrency:2,max_response_bytes:4096,async evaluate(request){const id=String(request.state);sent.push(id);events.push(`send:${id}`);active++;peak=Math.max(peak,active);
   try{if(id==='0')await firstResponse.promise;if(id==='1')await secondResponse.promise;
    const body=JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}});
    // A valid body at the advertised byte bound retains the whole conservative
    // response allowance until APPLY; no large real allocation is needed.
    return{http_status:200,latency_ms:1,body:mode==='apply'?' '.repeat(4096-Buffer.byteLength(body))+body:body};
   }finally{active--;}}},
  hooks:{map:(_run,call)=>[call.id],error:()=>{throw Error('no invented technical result');},labeled:()=>true,fail_on_error:true},
 }).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
 let observedBeforeFeed=false,drainedBeforeFeed=false;
 try{
  await feedStarted.promise;
  if(mode==='cancel')cancellation.abort();
  if(mode!=='feed_memory_only'){firstResponse.resolve();await firstBuffered.promise;}
  if(mode==='apply'){
   secondResponse.resolve();await applyStarted.promise;
   assert.equal(rawPages,1,'ordinary size-two batching, not a forced first-response flush');
   assert.equal(sent.includes('2'),false,'response custody remains charged while APPLY is pending');applyGate.resolve();
  }
  // An event-loop checkpoint drains the controlled promise continuations; this
  // is an ordering assertion, not a latency threshold or a benchmark sleep.
  await new Promise<void>(resolve=>setImmediate(resolve));
  observedBeforeFeed=events.includes('mark:wake-2');drainedBeforeFeed=finished>0;
  if(mode==='http'||mode==='apply'||mode==='feed_failure'){
   assert.ok(observedBeforeFeed,'already reserved remainder must be marked before the future read completes');
   assert.ok(sent.includes('2'),'the old reserved remainder must reach HTTP without waiting for future read');
  }else if(mode==='mark_failure'){
   assert.ok(observedBeforeFeed,'Mark failure must be reached without waiting on the unrelated read');assert.equal(sent.includes('2'),false,'failed Mark cannot hand off HTTP');
  }else{assert.equal(observedBeforeFeed,false);assert.equal(sent.includes('2'),false,'no premature handoff');if(mode==='feed_memory_only')assert.equal(sent.length,0,'the pending read is the only owner that can release the needed bytes');}
  assert.equal(feedReleased,false);assert.equal(drainedBeforeFeed,false,'drain must still wait for the owned pending feed');
 }finally{
  feedReleased=true;events.push('release:feed');feedGate.resolve();firstResponse.resolve();secondResponse.resolve();applyGate.resolve();await pending;
 }
 const result=await pending;
 assert.equal(reads,1);assert.ok(peak<=2);assert.ok(memory.every(bytes=>bytes>=0&&bytes<=budget),'same shared byte budget throughout');assert.ok(finished>0);
 assert.equal(new Set(sent).size,sent.length,'one physical attempt per identity');assert.equal(new Set(raw).size,raw.length);assert.equal(new Set(settled).size,settled.length);assert.equal(new Set(applied).size,applied.length);
 assert.deepEqual([...raw].sort(),sent.map(id=>`wake-${id}`).sort());assert.deepEqual([...settled].sort(),[...raw].sort());assert.deepEqual([...applied].sort(),[...raw].sort());
 return{result,rows,sent,requeued,memory,observedBeforeFeed};
}
for(const mode of ['http','apply']as const)test(`reserved admission wake follows ${mode} progress while the next read remains pending`,async()=>{
 const x=await exerciseAdmissionWake(mode);assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');assert.equal(x.result.value?.labeled,3);assert.equal(x.sent.length,3);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
});
test('reserved admission wake preserves cancellation and drains the pending feed and paid siblings',async()=>{
 const x=await exerciseAdmissionWake('cancel');assert.equal(x.result.error,undefined);assert.equal(x.sent.length,2);assert.equal(x.rows[2]!.status,'reserved');assert.equal(x.rows[2]!.results_applied,false);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
});
test('reserved admission wake preserves a later feed failure after draining every physical receipt',async()=>{
 const x=await exerciseAdmissionWake('feed_failure');assert.equal(x.result.error?.message,'feed_read_failed');assert.equal(x.sent.length,3);assert.ok(x.rows.every(row=>row.results_applied));assert.deepEqual(x.requeued,[]);
});
test('reserved admission wake requeues a failed Mark handoff once without sending or losing its identity',async()=>{
 const x=await exerciseAdmissionWake('mark_failure');assert.equal(x.result.error?.message,'mark_ack_lost');assert.equal(x.sent.length,2);assert.deepEqual(x.requeued,['wake-2']);assert.equal(x.rows[2]!.status,'reserved');assert.equal(x.rows[2]!.results_applied,false);
});

test('reserved admission wake waits safely when feeding alone owns the missing response budget',async()=>{
 const x=await exerciseAdmissionWake('feed_memory_only');assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');assert.equal(x.sent.length,1);assert.equal(x.result.value?.labeled,1);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
});
