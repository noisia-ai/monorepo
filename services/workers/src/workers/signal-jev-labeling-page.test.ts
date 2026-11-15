import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallV1} from '@noisia/db';
import {processJevLabelingPageV1} from './signal-jev-labeling-page';
const execution={max_in_flight:1,flush_size:32,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:32};
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
