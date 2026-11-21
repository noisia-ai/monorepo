import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingRunV1} from '@noisia/db';
import {createTypesafeJevClientV1,type JevResponseV1,type JevRequestV1} from '../providers/typesafe-jev';
import {captureJevDeferredRawV1} from '../providers/jev-deferred-raw';
import {processJevStreamingWindowV2} from './signal-jev-streaming-window';

type Result={answers:JevResponseV1['answers']};
type Args=Parameters<typeof processJevStreamingWindowV2<FacetInput,Result>>[0];
type Stage='none'|'RAW'|'settle'|'APPLY'|'feedback';
function gate(){let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}
function fixture(stage:Stage){
  const failure=Error('deferred '+stage),rawGate=gate(),feedbackGate=gate(),rawEntered=gate(),feedbackEntered=gate();
  const calls=Array.from({length:2},(_,i):LabelingCallV1<FacetInput>=>{
    const input={root_id:'root-'+i,input_digest:'input-'+i,text:'state-'+i,title:null,platform:'instagram',
      content_type:'comment',author:null,published_at:'2026-11-20T00:00:00.000Z',language:'pt'} satisfies FacetInput;
    const request={model:'jev-1.13.0',state:'state-'+i,questions:{q:{type:'noul',instructions:'Configured question'}}} satisfies JevRequestV1;
    return{id:'deferred-'+i,custom_id:'custom-'+i,request_digest:'digest-'+i,reserved_micro_usd:100,
      request,inputs:[input],status:'reserved',raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0};
  });
  const value={model:'jev-1.13.0',answers:{q:{type:'noul',noul:.9,extra:{unicode:'é😀',numbers:[1e20],nested:{k:true}}}},
    usage:{input_tokens:10,output_tokens:0,extra:{nested:['\ud800','kept']}}};
  const compact=JSON.stringify(value),body=compact+' '.repeat(16384-Buffer.byteLength(compact));
  const snapshots:number[]=[],durable:string[]=[],events:string[]=[],results:Result[]=[],usage:unknown[]=[];
  let sends=0,feedbacks=0,finishes=0;
  const provider=createTypesafeJevClientV1({enabled:true,api_key:'local-test-only',max_response_bytes:16384,concurrency:2,
    fetch:(async()=>{sends++;return new Response(body,{status:200,headers:{'content-length':String(Buffer.byteLength(body))}});})as typeof fetch});
  provider.observeUsage=async raw=>{
    feedbacks++;events.push('feedback');assert.equal(raw.body,body);feedbackEntered.resolve();await feedbackGate.promise;
    if(stage==='feedback')throw failure;
  };
  const store={
    async markSubmitting(_run:unknown,page:typeof calls){for(const call of page)call.status='submitting';},
    async persistRawPage(_run:unknown,page:Array<{call:typeof calls[number];raw:string}>){
      events.push('RAW');rawEntered.resolve();await rawGate.promise;if(stage==='RAW')throw failure;
      for(const row of page){durable.push(row.raw);row.call.raw_body=row.raw;}
    },
    async settlePage(_run:unknown,page:Array<{call:typeof calls[number];usage:unknown}>){events.push('settle');
      if(stage==='settle')throw failure;for(const row of page){usage.push(row.usage);row.call.status='settled';}},
    async apply(_run:unknown,page:Array<{call:typeof calls[number];results:Result[]}>){events.push('APPLY');
      if(stage==='APPLY')throw failure;for(const row of page){results.push(...row.results);row.call.results_applied=true;}},
    async markFailed(_run:unknown,page:typeof calls,unknown:boolean){for(const call of page)call.status=unknown?'unknown':'failed';},
    async requeueUnsent(){throw Error('every committed member was handed off');},
    async fail(){throw Error('no invented technical error may replace persistence failure');},
    async finish(){finishes++;return stage==='none'?'completed':'outcome_unknown';},
  }as unknown as Args['store'];
  const args:Args={run:{id:'deferred-run',lease_token:'lease',status:'running',error_code:null}as LabelingRunV1,calls,store,provider,
    price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),cancellation:new AbortController(),
    execution:{max_in_flight:2,window_size:2,flush_size:1,max_flushes:2,flush_interval_ms:1000,max_buffered_bytes:4*1024*1024},
    hooks:{map:(_run,_call,parsed)=>[{answers:structuredClone(parsed.answers)}],error:()=>{throw Error('no replacement result');},labeled:()=>true},
    observe_stream:metrics=>snapshots.push(metrics.reserved_working_bytes)};
  return{args,body,value,calls,failure,rawGate,feedbackGate,rawEntered,feedbackEntered,snapshots,durable,events,results,usage,
    state:()=>({sends,feedbacks,finishes})};
}
for(const stage of ['none','RAW','settle','APPLY','feedback']as const)test(`first-party deferred physical pipeline drains exact RAW through ${stage}`,{timeout:5000},async()=>{
  const f=fixture(stage),pending=processJevStreamingWindowV2(f.args);let rejected=false,caught:unknown;
  try{
    await f.rawEntered.promise;
    assert.equal(f.state().sends,2,'both paid siblings reach transport');
    assert.ok(f.snapshots.at(-1)!>0,'RAW wait retains legacy response custody');
    f.rawGate.resolve();
    if(stage==='none'||stage==='feedback'){
      await f.feedbackEntered.promise;
      assert.ok(f.snapshots.at(-1)!>0,'feedback wait still retains response/codec custody');
      f.feedbackGate.resolve();
    }
    await pending;
  }catch(error){rejected=true;caught=error;}
  finally{f.rawGate.resolve();f.feedbackGate.resolve();f.args.cancellation.abort();}
  assert.equal(rejected,stage!=='none');if(stage!=='none')assert.strictEqual(caught,f.failure);
  assert.equal(f.state().sends,2,'no retry or replay at any failed stage');
  assert.ok(f.snapshots.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=f.args.execution.max_buffered_bytes));
  assert.ok(f.calls.every(call=>call.raw_body===null),'consume retires the window RAW alias after its real handling');
  assert.equal(f.durable.length,stage==='RAW'?0:2);
  for(const raw of f.durable){const physical=JSON.parse(raw);assert.equal(physical.body,f.body);
    assert.equal(raw,JSON.stringify(physical));assert.equal(Buffer.byteLength(physical.body),16384);
    assert.equal(createHash('sha256').update(raw).digest('hex'),createHash('sha256').update(JSON.stringify(physical)).digest('hex'));
    assert.equal(captureJevDeferredRawV1(f.args.provider,physical),null,'RAW JSON cannot recover the process-local witness');}
  if(stage==='none'||stage==='feedback'){
    assert.equal(f.results.length,2);assert.deepEqual(f.results[0]!.answers,f.value.answers);
    assert.deepEqual((f.usage[0]as Record<string,unknown>).extra,f.value.usage.extra);
    assert.equal(f.state().feedbacks,2);
  }
});
