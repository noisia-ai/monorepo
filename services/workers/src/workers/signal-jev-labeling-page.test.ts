import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
  }else{assert.equal(observedBeforeFeed,false);assert.equal(sent.includes('2'),false,'no premature handoff');if(mode==='feed_memory_only')assert.equal(sent.length,1,'future input custody must leave response headroom for the already reserved call');}
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

test('reserved admission wake keeps ready response headroom while the future read remains pending',async()=>{
 const x=await exerciseAdmissionWake('feed_memory_only');assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');assert.equal(x.sent.length,1);assert.equal(x.result.value?.labeled,1);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
});

test('a later ready cohort reaches committed handoff without releasing the next feeder',{timeout:5000},async()=>{
 const {processJevStreamingWindowV2,jevCallWorkingBytesV2}=await import('./signal-jev-streaming-window');
 type Store=Parameters<typeof processJevStreamingWindowV2<FacetInput,string>>[0]['store'];
 for(const futureCount of [1,2]){
  const make=(index:number)=>({id:`headroom-${index}`,request_digest:`headroom-${index}`,status:'reserved',raw_body:null,results_applied:false,
   request:{model:'jev-1.13.0',state:String(index),questions:{q:{type:'noul',instructions:'configured'}}},
   inputs:[{root_id:String(index),text:String(index)}]})as unknown as LabelingCallV1<FacetInput>;
  const initial=make(0),future=Array.from({length:futureCount},(_,index)=>make(index+1)),all=[initial,...future];
  const initialApplied=deferredFrontier(),secondFeedStarted=deferredFrontier(),secondFeedGate=deferredFrontier(),
   futureResponses=deferredFrontier(),allFutureStarted=deferredFrontier();
  const responseBytes=4096*24+64*1024;
  // One case leaves enough input room to overlap the feeder with Mark; the
  // other leaves <8192 bytes after two ready response allowances and defers it.
  const budget=futureCount===1?210000:all.reduce((sum,call)=>sum+jevCallWorkingBytesV2(call),0)+2*responseBytes+4096;
  const events:string[]=[],memory:number[]=[],sent:string[]=[],raw:string[]=[],settled:string[]=[],applied:string[]=[],requeued:string[]=[];
  let feeds=0,active=0,peak=0,feedReleased=false;
  const store={markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>{
    const rows=select();for(const call of rows){call.status='submitting';events.push(`commit:${call.id}`);}return rows;
   },persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{
    for(const row of rows){assert.ok(sent.includes(row.call.id));assert.ok(!raw.includes(row.call.id));row.call.raw_body=row.raw;raw.push(row.call.id);}
   },settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
    for(const row of rows){assert.ok(raw.includes(row.call.id));assert.ok(!settled.includes(row.call.id));settled.push(row.call.id);row.call.status='settled';}
   },apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
    for(const row of rows){assert.ok(settled.includes(row.call.id));assert.ok(!applied.includes(row.call.id));applied.push(row.call.id);row.call.results_applied=true;
     if(row.call===initial)initialApplied.resolve();}
   },finish:async()=>all.every(call=>call.results_applied)?'completed':'running',
   requeueUnsent:async(_run:unknown,rows:Array<LabelingCallV1<FacetInput>>)=>{requeued.push(...rows.map(call=>call.id));},
   markFailed:async()=>{throw Error('unexpected persistence failure');},
  }as unknown as Store;
  const pending=processJevStreamingWindowV2({run:{}as LabelingRunV1,calls:[initial],store,cancellation:new AbortController(),
   execution:{max_in_flight:futureCount,window_size:3,flush_size:1,max_flushes:2,max_buffered_bytes:budget,flush_interval_ms:60000},
   defer_initial_prefetch_until_handoff:true,revisit_empty_after_apply:true,
   feed_next:async()=>{
    feeds++;if(feeds===1){await initialApplied.promise;return future;}
    assert.equal(feeds,2,'one pending future feeder');events.push('feed:2:start');secondFeedStarted.resolve();await secondFeedGate.promise;return{closed:true};
   },observe_stream:metrics=>memory.push(metrics.reserved_working_bytes),
   provider:{max_concurrency:futureCount,max_response_bytes:4096,async evaluate(request){
    const call=all.find(call=>String(request.state)===String(call.request.state))!;
    assert.ok(events.includes(`commit:${call.id}`),'native Mark ACK precedes every evaluate');assert.ok(!sent.includes(call.id));
    sent.push(call.id);events.push(`evaluate:${call.id}`);active++;peak=Math.max(peak,active);
    try{if(call!==initial){if(future.every(row=>sent.includes(row.id)))allFutureStarted.resolve();await futureResponses.promise;}
     return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};
    }finally{active--;}
   }},price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),hooks:{map:(_run,call)=>[call.id],error:()=>{throw Error('no invented technical result');},labeled:()=>true,fail_on_error:true},
  }).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  try{
   await Promise.race([secondFeedStarted.promise,allFutureStarted.promise,pending]);
   await new Promise<void>(resolve=>setImmediate(resolve));
   assert.equal(feedReleased,false);assert.ok(initial.results_applied,'this is a later frontier, not the initial handoff');
   assert.ok(future.every(call=>sent.includes(call.id)),'all ready calls must reach committed handoff while the next feeder is still pending');
   if(futureCount===1)assert.ok(events.includes('feed:2:start'),'a smaller concurrent input budget still permits prefetch');
   else assert.ok(!events.includes('feed:2:start'),'insufficient remaining input headroom defers prefetch rather than starving the ready cohort');
  }finally{
   initialApplied.resolve();futureResponses.resolve();feedReleased=true;events.push('feed:2:release');secondFeedGate.resolve();await pending;
  }
  const result=await pending;assert.equal(result.error,undefined);assert.equal(result.value?.status,'completed');assert.equal(result.value?.labeled,all.length);
  assert.equal(feeds,2);assert.ok(peak<=futureCount);assert.ok(memory.every(bytes=>bytes>=0&&bytes<=budget));assert.equal(memory.at(-1),0);
  assert.deepEqual([...sent].sort(),all.map(call=>call.id).sort());assert.deepEqual([...raw].sort(),[...sent].sort());
  assert.deepEqual([...settled].sort(),[...raw].sort());assert.deepEqual([...applied].sort(),[...raw].sort());assert.deepEqual(requeued,[]);
 }
});

/** While the second native authority fence waits, one paid sibling completes
 * and one future input page commits. Neither requires another physical send. */
async function exerciseLateMark(mode:'progress'|'future_pending'|'memory_limited'|'abort_before_selection'|'abort_after_selection'|'ack_lost'|'authority_failed'|'invalid_handoff'){
 const {processJevStreamingWindowV2}=await import('./signal-jev-streaming-window');
 type Store=Parameters<typeof processJevStreamingWindowV2<FacetInput,string>>[0]['store'];
 const make=(i:number)=>({id:`late-${i}`,request_digest:`late-${i}`,status:'reserved',raw_body:null,results_applied:false,
  request:{model:'jev-1.13.0',state:String(i),questions:{q:{type:'noul',instructions:'configured'}}},
  inputs:[{root_id:String(i),text:String(i)}]})as unknown as LabelingCallV1<FacetInput>;
 const initial=[make(0),make(1),make(2)],future=make(3),all=[...initial,future];
 const httpStarted=deferredFrontier(),firstResponse=deferredFrontier(),secondResponse=deferredFrontier(),
  secondMarkStarted=deferredFrontier(),futureCommit=deferredFrontier(),futureReturned=deferredFrontier(),
  secondBuffered=deferredFrontier(),selectionGate=deferredFrontier(),selected=deferredFrontier(),commitGate=deferredFrontier(),applyGate=deferredFrontier();
 const cancellation=new AbortController(),events:string[]=[],sent:string[]=[],memory:number[]=[],cohorts:string[][]=[],requeued:string[]=[],raw:string[]=[],settled:string[]=[],applied:string[]=[];
 const budget=mode==='memory_limited'?552*1024:2*1024*1024,responseBytes=4096*24+64*1024;
 const credits:Array<{at:'before_authority_wait'|'after_authority_wait';in_flight:number;response_slots:number;committed_reserved:number}>=[];
 let observed={in_flight:0,reserved_working_bytes:0};
 const captureCredit=(at:typeof credits[number]['at'])=>credits.push({at,in_flight:observed.in_flight,
  response_slots:Math.min(2-observed.in_flight,Math.floor((budget-observed.reserved_working_bytes)/responseBytes)),
  committed_reserved:all.filter(row=>row.status==='reserved'&&(row!==future||events.includes('future:commit'))).length});
 let marks=0,reads=0,inFlight=0,peak=0,nativeSelections=0;
 const mark=async(select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>,native:boolean)=>{
  const index=++marks;events.push(`authority:${index}`);
  if(index===2){captureCredit('before_authority_wait');secondMarkStarted.resolve();await selectionGate.promise;captureCredit('after_authority_wait');}
  if(index===2&&mode==='authority_failed')throw Error('authority_revoked');
  if(native)nativeSelections++;
  const rows=[...select()];cohorts.push(rows.map(row=>row.id));events.push(`select:${index}`);
  if(index===2){selected.resolve();await commitGate.promise;}
  for(const row of rows)row.status='submitting';
  events.push(`commit:${index}`);
  if(index===2&&mode==='ack_lost')throw Error('submitting_ack_lost');
  if(index===2&&mode==='invalid_handoff')return rows.slice(0,1);
  return rows;
 };
 const store={
  // The legacy mock deliberately preserves its early fixed cohort. Running the
  // regression against the previous driver therefore records [0,1],[2],[3].
  markSubmitting:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{await mark(()=>rows,false);},
  markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>mark(select,true),
  requeueUnsent:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{
   for(const row of rows){assert.ok(!sent.includes(row.id),'only physically unsent identities can requeue');requeued.push(row.id);row.status='reserved';}
  },
  persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{
   for(const row of rows){raw.push(row.call.id);row.call.raw_body=row.raw;}
  },
  settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
   for(const row of rows){assert.ok(raw.includes(row.call.id));settled.push(row.call.id);row.call.status='settled';}
  },
  apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
   if(mode==='memory_limited')await applyGate.promise;
   for(const row of rows){assert.ok(settled.includes(row.call.id));applied.push(row.call.id);row.call.results_applied=true;}
  },
  finish:async()=>all.every(row=>row.results_applied)?'completed':'running',
  markFailed:async()=>{throw Error('no paid receipt may be replaced by a technical result');},
 }as unknown as Store;
 const pending=processJevStreamingWindowV2({run:{}as LabelingRunV1,calls:initial,store,cancellation,
  price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  execution:{max_in_flight:2,window_size:4,flush_size:2,max_flushes:1,max_buffered_bytes:budget,flush_interval_ms:60000},
  feed_next:async()=>{
   if(++reads>1)return{closed:true};
   await futureCommit.promise;events.push('future:commit');futureReturned.resolve();return[future];
  },
  observe_stream:m=>{observed=m;memory.push(m.reserved_working_bytes);if(m.buffered_responses===2)secondBuffered.resolve();},
  provider:{max_concurrency:2,max_response_bytes:4096,async evaluate(request){
   const id=`late-${request.state}`;sent.push(id);events.push(`http:${id}`);inFlight++;peak=Math.max(peak,inFlight);
   if(sent.length===2)httpStarted.resolve();
   try{
    if(request.state==='0')await firstResponse.promise;
    if(request.state==='1')await secondResponse.promise;
    const body=JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}});
    return{http_status:200,latency_ms:1,body:mode==='memory_limited'&&request.state==='1'?' '.repeat(4096-Buffer.byteLength(body))+body:body};
   }finally{inFlight--;}
  }},hooks:{map:(_run,call)=>[call.id],error:()=>{throw Error('no invented result');},labeled:()=>true,fail_on_error:true},
 }).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
 try{
  await httpStarted.promise;firstResponse.resolve();await secondMarkStarted.promise;
  assert.deepEqual(sent,['late-0','late-1']);
  // The second response and the future committed page arrive while authority
  // still owns its gate. A checkpoint observes their completed continuations.
  secondResponse.resolve();await secondBuffered.promise;
  if(mode!=='future_pending'){futureCommit.resolve();await futureReturned.promise;}
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(events.includes('http:late-3'),false,'future reservation is not submitting authority');
  if(mode==='abort_before_selection')cancellation.abort();
  selectionGate.resolve();
  if(mode!=='authority_failed'){
   await selected.promise;
   assert.deepEqual(sent,['late-0','late-1'],'no selected sibling is sent before COMMIT acknowledgement');
   if(mode==='abort_after_selection')cancellation.abort();
  }
 }finally{
  firstResponse.resolve();secondResponse.resolve();futureCommit.resolve();selectionGate.resolve();commitGate.resolve();applyGate.resolve();await pending;
 }
 const result=await pending;
 assert.ok(peak<=2);assert.ok(memory.every(bytes=>bytes>=0&&bytes<=budget),'all input, HTTP and response custody share the same bound');
 assert.equal(new Set(sent).size,sent.length);assert.equal(new Set(requeued).size,requeued.length);
 assert.deepEqual([...raw].sort(),[...sent].sort());assert.deepEqual([...settled].sort(),[...raw].sort());assert.deepEqual([...applied].sort(),[...raw].sort());
 for(const id of sent){const index=cohorts.findIndex(rows=>rows.includes(id));assert.ok(index>=0);assert.ok(events.indexOf(`commit:${index+1}`)<events.indexOf(`http:${id}`));}
 return{result,cohorts,sent,requeued,memory,nativeSelections,events,all,credits};
}
test('native late Mark incorporates HTTP capacity and only already committed future calls after authority waits',{timeout:3000},async()=>{
 const x=await exerciseLateMark('progress');assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');
 assert.deepEqual(x.cohorts,[['late-0','late-1'],['late-2','late-3']]);assert.equal(x.nativeSelections,2);
 assert.equal(x.result.value?.labeled,4);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
 assert.ok(x.events.indexOf('future:commit')<x.events.indexOf('select:2'));
 assert.deepEqual(x.credits,[{at:'before_authority_wait',in_flight:1,response_slots:1,committed_reserved:1},
  {at:'after_authority_wait',in_flight:0,response_slots:2,committed_reserved:2}]);
});
test('native late Mark abort before selection keeps new calls reserved and drains paid siblings',{timeout:3000},async()=>{
 const x=await exerciseLateMark('abort_before_selection');assert.equal(x.result.error,undefined);assert.deepEqual(x.sent,['late-0','late-1']);
 assert.deepEqual(x.cohorts,[['late-0','late-1'],[]]);assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
 assert.ok(x.all.slice(2).every(row=>row.status==='reserved'&&!row.results_applied));
});
test('native late Mark cannot consume a future page whose reservation acknowledgement is still pending',{timeout:3000},async()=>{
 const x=await exerciseLateMark('future_pending');assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');
 assert.deepEqual(x.cohorts,[['late-0','late-1'],['late-2'],['late-3']]);
 assert.ok(x.events.indexOf('select:2')<x.events.indexOf('future:commit'));assert.ok(x.events.indexOf('future:commit')<x.events.indexOf('select:3'));
 assert.equal(x.credits[1]?.response_slots,2);assert.equal(x.credits[1]?.committed_reserved,1);assert.equal(x.memory.at(-1),0);
});
test('native late Mark keeps paid response custody charged even when HTTP capacity is free',{timeout:3000},async()=>{
 const x=await exerciseLateMark('memory_limited');assert.equal(x.result.error,undefined);assert.equal(x.result.value?.status,'completed');
 assert.deepEqual(x.cohorts,[['late-0','late-1'],['late-2'],['late-3']]);
 assert.equal(x.credits[1]?.in_flight,0);assert.equal(x.credits[1]?.response_slots,1);assert.equal(x.credits[1]?.committed_reserved,2);
 assert.equal(x.memory.at(-1),0);
});
test('native late Mark delivers every committed selected sibling despite abort before its acknowledgement',{timeout:3000},async()=>{
 const x=await exerciseLateMark('abort_after_selection');assert.equal(x.result.error,undefined);
 assert.deepEqual(x.cohorts,[['late-0','late-1'],['late-2','late-3']]);assert.deepEqual(x.sent,['late-0','late-1','late-2','late-3']);
 assert.deepEqual(x.requeued,[]);assert.equal(x.memory.at(-1),0);
});
for(const mode of ['ack_lost','invalid_handoff']as const)test(`native late Mark ${mode} reconciles its exact unsent cohort without another physical attempt`,{timeout:3000},async()=>{
 const x=await exerciseLateMark(mode);assert.equal(x.result.error?.message,mode==='ack_lost'?'submitting_ack_lost':'jev_stream_selection_handoff_invalid');
 assert.deepEqual(x.sent,['late-0','late-1']);assert.deepEqual(x.requeued,['late-2','late-3']);
 assert.ok(x.all.slice(2).every(row=>row.status==='reserved'&&!row.results_applied));
});
test('native late Mark rejected authority never selects or charges response memory for new calls',{timeout:3000},async()=>{
 const x=await exerciseLateMark('authority_failed');assert.equal(x.result.error?.message,'authority_revoked');
 assert.deepEqual(x.cohorts,[['late-0','late-1']]);assert.deepEqual(x.sent,['late-0','late-1']);assert.deepEqual(x.requeued,[]);
 assert.ok(x.all.slice(2).every(row=>row.status==='reserved'&&!row.results_applied));
});

test('Listening first reserve is capped and feeder handoff waits for every committed evaluate call',{timeout:15000},async()=>{
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const run={id:'first-reserve',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
 const corpus=Array.from({length:4096},(_,index)=>({root_id:`first-${index}`,text:`mention-${index}`}))as FacetInput[];
 const calls:LabelingCallV1<FacetInput>[]=[],events:string[]=[],reserveProposalCounts:number[]=[];
 let storeReads=0,feedReads=0,providerStarted=0,physicalFetchStarted=0;
 let releaseRateGate:(()=>void)|undefined,releaseFeedObserved:(()=>void)|undefined;
 const rateGate=new Promise<void>(resolve=>{releaseRateGate=resolve;});
 const feedObserved=new Promise<void>(resolve=>{releaseFeedObserved=resolve;});
 const store={claim:async()=>run,renew:async()=>{},release:async()=>{},calls:async()=>calls.filter(call=>!call.results_applied),
  inputs:async()=>{storeReads++;return corpus;},
  reserve:async(_run:unknown,proposals:unknown[])=>{reserveProposalCounts.push(proposals.length);events.push(`reserve:${proposals.length}`);
   const rows=proposals.map((proposal,index)=>({...proposal as object,id:`first-call-${calls.length+index}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];
   calls.push(...rows);return rows;},
  markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>{
   const selected=select();events.push(`mark:${selected.length}`);for(const call of selected)call.status='submitting';return selected;},
  requeueUnsent:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{for(const call of rows)call.status='reserved';},
  persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{for(const row of rows)row.call.raw_body=row.raw;},
  settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows)row.call.status='settled';},
  apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;results:string[]}>)=>{for(const row of rows)row.call.results_applied=true;},
  finish:async()=>{run.status='running';return'running';},fail:async()=>{},markFailed:async()=>{},
 }as unknown as Args['store'];
 const provider:Args['provider']={max_concurrency:1024,max_response_bytes:16384,async evaluate(request){
  providerStarted++;events.push(`evaluate:${providerStarted}`);await rateGate;physicalFetchStarted++;
  return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};
 }};
 let released=0;
 const hooks:Args['hooks']={continuous_windows:()=>true,revisit_empty_after_apply:true,
  price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  propose:(_run,inputs)=>inputs.map(input=>({request:{model:'jev-1.13.0',state:input.text,questions:{q:{type:'noul',instructions:'configured'}}},
   request_digest:input.root_id,custom_id:input.root_id,inputs:[input],reserved_micro_usd:100})),
  map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>[],labeled:()=>true,fail_on_error:true};
 const pending=processJevLabelingPageV1({run_id:run.id,store,provider,hooks,
  execution:{max_in_flight:1024,window_size:4096,flush_size:1024,max_flushes:2,max_buffered_bytes:512*1024*1024,flush_interval_ms:60_000},
  initial_reservation:{max_calls:1024,release_selection:()=>{released++;events.push('selection:released');}},
  read_next_inputs:async(_leased,bounds)=>{feedReads++;assert.ok(bounds.max_rows<=4096&&bounds.max_working_bytes>0);
   if(feedReads===1){assert.equal(providerStarted,1024,'every first-cohort call must reach evaluate before fresh prefetch');
    assert.equal(physicalFetchStarted,0,'handoff must not wait for provider rate admission or physical fetch');releaseFeedObserved?.();}
   return[];
  }});
 await feedObserved;
 assert.equal(storeReads,1);assert.equal(reserveProposalCounts[0],1024);
 assert.equal(events.indexOf('selection:released')<events.indexOf('mark:1024'),true);
 assert.equal(providerStarted,1024);assert.equal(physicalFetchStarted,0);
 releaseRateGate?.();
 const result=await pending;
 assert.equal(result.status,'running');assert.equal(providerStarted,1024);assert.equal(calls.length,1024);
 assert.equal(calls.filter(call=>call.results_applied).length,1024);assert.equal(released>=1,true);
});

test('a partial initial reservation sends only the authorized prefix and preserves later admission',{timeout:10000},async()=>{
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const run={id:'partial-first-reserve',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
 const inputs=Array.from({length:16},(_,index)=>({root_id:`partial-${index}`,text:`mention-${index}`}))as FacetInput[];
 const calls:LabelingCallV1<FacetInput>[]=[],proposed:number[]=[],sent:string[]=[];let released=0,feedReads=0;
 const store={claim:async()=>run,renew:async()=>{},release:async()=>{},calls:async()=>calls.filter(call=>!call.results_applied),inputs:async()=>inputs,
  reserve:async(_run:unknown,proposals:unknown[])=>{proposed.push(proposals.length);const rows=proposals.slice(0,3).map((proposal,index)=>({...proposal as object,
    id:`partial-call-${index}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];calls.push(...rows);return rows;},
  markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>{const rows=select();for(const row of rows)row.status='submitting';return rows;},
  requeueUnsent:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{for(const row of rows)row.status='reserved';},
  persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{for(const row of rows)row.call.raw_body=row.raw;},
  settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows)row.call.status='settled';},
  apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{for(const row of rows)row.call.results_applied=true;},
  finish:async()=>{run.status='running';return'running';},fail:async()=>{},markFailed:async()=>{},
 }as unknown as Args['store'];
 const provider:Args['provider']={max_concurrency:8,max_response_bytes:4096,async evaluate(request){sent.push(String(request.state));return{http_status:200,latency_ms:1,
  body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};}};
 const hooks:Args['hooks']={continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  propose:(_run,rows)=>rows.map(input=>({request:{model:'jev-1.13.0',state:input.text,questions:{q:{type:'noul',instructions:'configured'}}},
   request_digest:input.root_id,custom_id:input.root_id,inputs:[input],reserved_micro_usd:100})),map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>[],labeled:()=>true};
 const result=await processJevLabelingPageV1({run_id:run.id,store,provider,hooks,
  execution:{max_in_flight:8,window_size:16,flush_size:8,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:60_000},
  initial_reservation:{max_calls:1024,release_selection:()=>{released++;}},
  read_next_inputs:async()=>{feedReads++;return[];}});
 assert.equal(proposed[0],8,'initial proposal count is bounded by max_in_flight as well as 1,024');
 assert.deepEqual(sent,['mention-0','mention-1','mention-2'],'only committed reservation rows may reach the provider');
 assert.equal(calls.length,3);assert.equal(calls.every(call=>call.results_applied),true);assert.equal(feedReads>=1,true);
 assert.equal(released>=1,true);assert.equal(result.status,'running');
});

test('selection is released after reserve when the first Mark acknowledgement is lost',{timeout:5000},async()=>{
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const run={id:'lost-first-mark',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
 const input={root_id:'lost-first-mark-root',text:'mention'} as FacetInput;
 const calls:LabelingCallV1<FacetInput>[]=[],events:string[]=[];let sent=0;
 const store={claim:async()=>run,renew:async()=>{},release:async()=>{},calls:async()=>calls.filter(call=>!call.results_applied),inputs:async()=>[input],
  reserve:async(_run:unknown,proposals:unknown[])=>{events.push('reserve');const rows=proposals.map((proposal,index)=>({...proposal as object,
    id:`lost-call-${index}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];calls.push(...rows);return rows;},
  markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>{assert.equal(select().length,1);events.push('mark_ack_lost');throw Error('submitting_ack_lost');},
  requeueUnsent:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{events.push('requeue');for(const row of rows)row.status='reserved';},
  persistRawPage:async()=>{},settlePage:async()=>{},apply:async()=>{},finish:async()=>{run.status='running';return'running';},
  fail:async()=>{},markFailed:async()=>{},
 }as unknown as Args['store'];
 const provider:Args['provider']={max_concurrency:4,max_response_bytes:4096,async evaluate(){sent++;throw Error('must not hand off without known Mark acknowledgement');}};
 const hooks:Args['hooks']={continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  propose:(_run,rows)=>rows.map(value=>({request:{model:'jev-1.13.0',state:value.text,questions:{q:{type:'noul',instructions:'configured'}}},
   request_digest:value.root_id,custom_id:value.root_id,inputs:[value],reserved_micro_usd:100})),map:()=>[],error:()=>[],labeled:()=>true};
 let released=0;
 await assert.rejects(processJevLabelingPageV1({run_id:run.id,store,provider,hooks,
  execution:{max_in_flight:4,window_size:8,flush_size:4,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:60_000},
  initial_reservation:{max_calls:1024,release_selection:()=>{released++;events.push('selection_released');}},
  read_next_inputs:async()=>{throw Error('feeder must not start before successful Mark handoff');}}),/submitting_ack_lost/u);
 assert.deepEqual(events.slice(0,3),['reserve','selection_released','mark_ack_lost']);
 assert.equal(events.includes('requeue'),true);assert.equal(sent,0);assert.equal(released,1);
 assert.equal(calls.length,1);assert.equal(calls[0]?.status,'reserved');assert.equal(calls[0]?.results_applied,false);
});

async function exerciseFeederProposalYield(cancelDuringYield:boolean){
 type Args=Parameters<typeof processJevLabelingPageV1<FacetInput,string>>[0];
 const {jevCallWorkingBytesV2}=await import('./signal-jev-streaming-window');
 const control=new AbortController(),run={id:'proposal-yield',lease_token:'lease',error_code:null,status:'running'}as LabelingRunV1;
 const initial=Array.from({length:cancelDuringYield?1:1024},(_,index)=>({root_id:`initial-${index}`,text:`initial-${index} `+'x'.repeat(3600)}))as FacetInput[];
 const future=Array.from({length:4096},(_,index)=>({root_id:`future-${String(index).padStart(4,'0')}`,text:`future-${String(index).padStart(4,'0')}`}))as FacetInput[];
 const proposal=(input:FacetInput)=>{
  const request={model:'jev-1.13.0',state:input.text,questions:{q:{type:'noul',instructions:'configured'}}};
  return{request,request_digest:createHash('sha256').update(JSON.stringify(request)).digest('hex'),custom_id:input.root_id,inputs:[input],reserved_micro_usd:100};
 };
 const expected=future.map(proposal),calls:LabelingCallV1<FacetInput>[]=[],marked=new Set<string>(),sent:string[]=[],raw:string[]=[],settled:string[]=[],applied:string[]=[],requeued:string[]=[],memory:number[]=[];
 let futureProposed=0,sentinelAt:number|undefined,reads=0,futureReserves=0,selectionReleases=0,leaseReleases=0,active=0,peak=0;
 let sentinel:ReturnType<typeof setImmediate>|undefined;
 const store={claim:async()=>run,renew:async()=>{},release:async()=>{leaseReleases++;},calls:async()=>calls.filter(call=>!call.results_applied),inputs:async()=>initial,
  reserve:async(_run:unknown,proposals:ReturnType<typeof proposal>[])=>{
   if(proposals[0]?.inputs[0]?.root_id.startsWith('future-')){
    futureReserves++;assert.equal(cancelDuringYield,false,'cancellation during the compiler yield must not reserve this cohort');
    assert.equal(sentinelAt,64,'the first event-loop sentinel must run after 64 admitted proposals, before reservation');
    assert.equal(futureProposed,4096);assert.equal(proposals.length,4096);
    assert.equal(JSON.stringify(proposals),JSON.stringify(expected),'yield preserves every proposal byte, digest and its original order');
   }
   const reserved=proposals.map(value=>({...value,id:`call-${value.custom_id}`,status:'reserved',raw_body:null,results_applied:false}))as LabelingCallV1<FacetInput>[];
   calls.push(...reserved);return reserved;
  },markSubmittingSelected:async(_run:unknown,select:()=>ReadonlyArray<LabelingCallV1<FacetInput>>)=>{
   const rows=select();for(const call of rows){assert.ok(!marked.has(call.id));marked.add(call.id);call.status='submitting';}return rows;
  },requeueUnsent:async(_run:unknown,rows:LabelingCallV1<FacetInput>[])=>{requeued.push(...rows.map(call=>call.id));for(const call of rows)call.status='reserved';},
  persistRawPage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>;raw:string}>)=>{
   for(const row of rows){assert.ok(sent.includes(row.call.id));assert.ok(!raw.includes(row.call.id));raw.push(row.call.id);row.call.raw_body=row.raw;}
  },settlePage:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
   for(const row of rows){assert.ok(raw.includes(row.call.id));assert.ok(!settled.includes(row.call.id));settled.push(row.call.id);row.call.status='settled';}
  },apply:async(_run:unknown,rows:Array<{call:LabelingCallV1<FacetInput>}>)=>{
   for(const row of rows){assert.ok(settled.includes(row.call.id));assert.ok(!applied.includes(row.call.id));applied.push(row.call.id);row.call.results_applied=true;}
  },finish:async()=>calls.every(call=>call.results_applied)?'completed':'running',fail:async()=>{throw Error('unexpected failure');},markFailed:async()=>{throw Error('unexpected failure');},
 }as unknown as Args['store'];
 const hooks:Args['hooks']={continuous_windows:()=>true,revisit_empty_after_apply:true,price:()=>llmPriceV1('typesafe','jev-1.13.0','sync',.042),
  propose:(_run,inputs)=>inputs.map(input=>{
   if(input.root_id.startsWith('future-')){
    futureProposed++;if(futureProposed===1)sentinel=setImmediate(()=>{sentinel=undefined;sentinelAt=futureProposed;if(cancelDuringYield)control.abort();});
   }return proposal(input);
  }),map:(_run,call)=>[call.inputs[0]!.root_id],error:()=>{throw Error('no invented technical result');},labeled:()=>true,fail_on_error:true};
 const provider:Args['provider']={max_concurrency:cancelDuringYield?1:1024,max_response_bytes:4096,async evaluate(request){
  const call=calls.find(call=>call.request===request)!;assert.ok(call&&marked.has(call.id),'committed Mark must precede every evaluate');assert.ok(!sent.includes(call.id));
  sent.push(call.id);active++;peak=Math.max(peak,active);
  try{return{http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,usage:{input_tokens:1,output_tokens:0},answers:{q:{type:'noul',noul:.8}}})};}
  finally{active--;}
 }};
 const bounds={max_in_flight:1024,window_size:4096,flush_size:1024,max_flushes:2,max_buffered_bytes:512*1024*1024,flush_interval_ms:250};
 const pending=processJevLabelingPageV1({run_id:run.id,store,provider,hooks,execution:bounds,signal:control.signal,
  initial_reservation:{max_calls:1024,release_selection:()=>{selectionReleases++;}},observe_stream:metrics=>memory.push(metrics.reserved_working_bytes),
  read_next_inputs:async(_run,limits)=>{
   if(reads++>0)return[];
   assert.equal(limits.max_rows,4096);
   if(!cancelDuringYield)assert.ok(expected.reduce((sum,value)=>sum+jevCallWorkingBytesV2(value)+8192,0)<=limits.max_working_bytes,'all 4096 exact proposals fit the existing feeder byte budget');
   return future;
  }}).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
 let result:Awaited<typeof pending>;
 try{result=await pending;}finally{if(sentinel!==undefined)clearImmediate(sentinel);control.abort();await pending;}
 assert.equal(result.error,undefined);assert.equal(result.value?.status,cancelDuringYield?'stopped':'completed');assert.equal(sentinelAt,64);
 assert.equal(futureReserves,cancelDuringYield?0:1);assert.equal(futureProposed,cancelDuringYield?64:4096);
 assert.equal(sent.filter(id=>id.startsWith('call-future-')).length,cancelDuringYield?0:4096);
 assert.equal(leaseReleases,1);assert.ok(selectionReleases>=2,'initial and feeder selection ownership is released');assert.deepEqual(requeued,[]);
 assert.ok(peak<=bounds.max_in_flight);assert.ok(memory.every(bytes=>bytes>=0&&bytes<=bounds.max_buffered_bytes));assert.equal(memory.at(-1),0);
 assert.equal(new Set(sent).size,sent.length);assert.deepEqual([...raw].sort(),[...sent].sort());assert.deepEqual([...settled].sort(),[...raw].sort());assert.deepEqual([...applied].sort(),[...raw].sort());
}
test('the 4096-proposal feeder yields before reservation without changing bytes, digests or order',{timeout:15000},async()=>{
 await exerciseFeederProposalYield(false);
});
test('cancellation during a feeder compiler yield reserves and sends none of that cohort',{timeout:5000},async()=>{
 await exerciseFeederProposalYield(true);
});
