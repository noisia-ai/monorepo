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
