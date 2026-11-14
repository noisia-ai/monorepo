import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1,signalListeningJevIdentityV1,signalListeningQuestionDigestV1,
  signalListeningConsumerCutV1,labelerDigestV1,entityContextDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningResultV1} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallV1} from '@noisia/db';
import type {JevProviderV1,JevRequestV1} from '../providers/typesafe-jev';
import {processSignalListeningJevV1,signalListeningJevJobV1,createSignalListeningProviderV1} from './signal-listening-jev';
const execution={max_in_flight:8,flush_size:8,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:200};
function fixture(configuration:SignalListeningConfigurationV1,windows:string[][],cache:Record<string,unknown>={}){
  const context={entities:[{entity_id:'category',kind:'category' as const,name:'tea',aliases:[],disambiguation:null}]};
  const identity=signalListeningJevIdentityV1(configuration),root_id=randomUUID();
  const run={id:randomUUID(),workspace_id:randomUUID(),actor_user_id:randomUUID(),kind:'mass_labeling',identity,
    labeler_digest:labelerDigestV1(identity),entity_context_digest:entityContextDigestV1(context),entity_context_version_no:1,
    context,lease_token:randomUUID(),cursor_root_id:null,cap_micro_usd:'1000000',processing_admission_id:randomUUID(),
    status:'running',error_code:null}as LabelingRunV1;
  const calls:LabelingCallV1<SignalListeningInputV1>[]=[],results:SignalListeningResultV1[]=[],requests:JevRequestV1[]=[],events:string[]=[];
  type Store=Parameters<typeof processSignalListeningJevV1>[0]['store'];
  const store={async claim(){return run.status==='completed'?null:run;},async renew(){},async release(){},async refresh(){return{status:run.status,error_code:null};},
    async fail(){run.status='failed';},async calls(){return calls.filter(call=>!call.results_applied);},
    async inputs(){const keys=windows.shift();if(!keys)return[];
      return[{root_id,input_digest:digest('input'),text:'I drink tea',title:null,platform:null,content_type:null,author:null,
        published_at:'2026-01-01T00:00:00Z',language:'en',map_id:randomUUID(),question_keys:keys,
        question_digests:Object.fromEntries(keys.map(key=>[key,signalListeningQuestionDigestV1(configuration,configuration.questions.find(q=>q.key===key)!)])),
        scope_basis:{},configuration_digest:digest(configuration)}];},
    async reserve(_run:LabelingRunV1,proposals:Record<string,unknown>[]){const rows=proposals.map(proposal=>({...proposal,id:randomUUID(),status:'reserved',raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0}));calls.push(...rows as never[]);return rows;},
    async markSubmitting(_run:LabelingRunV1,rows:LabelingCallV1<SignalListeningInputV1>[]){rows.forEach(call=>{call.status='submitting';});},
    async persistRawPage(_run:LabelingRunV1,rows:Array<{call:LabelingCallV1<SignalListeningInputV1>;raw:string}>){events.push('durable');rows.forEach(row=>{row.call.raw_body=row.raw;});},
    async settlePage(_run:LabelingRunV1,rows:Array<{call:LabelingCallV1<SignalListeningInputV1>}>){events.push('settled');for(const row of rows){assert.ok(row.call.raw_body);row.call.status='settled';}},
    async markFailed(_run:LabelingRunV1,rows:LabelingCallV1<SignalListeningInputV1>[],unknown:boolean){rows.forEach(call=>{call.status=unknown?'unknown':'failed';});},
    async apply(_run:LabelingRunV1,rows:Array<{call:LabelingCallV1<SignalListeningInputV1>;results:SignalListeningResultV1[]}>){events.push('apply');for(const row of rows){row.call.results_applied=true;results.push(...row.results);for(const result of row.results)Object.assign(cache,result.answers);}},
    async finish(){if(run.status!=='failed')run.status=windows.length?'running':'completed';return run.status;},
  }as unknown as Store;
  const provider:JevProviderV1={max_response_bytes:16384,max_concurrency:8,async evaluate(request){requests.push(request);
    const answers=Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:.1}
      :{type:'choice',choice:key==='voice'?'individual':Object.keys(q.criteria)[0],confidence:.9,
        probabilities:Object.fromEntries(Object.keys(q.criteria).map((key,i,all)=>[key,i===0?.9:.1/(all.length-1)]))}]));
    // Preserve normalized probabilities while selecting the configured individual option.
    if(answers.voice){const question=request.questions.voice!;const voice=answers.voice as {probabilities:Record<string,number>};voice.probabilities=Object.fromEntries(Object.keys(question.type==='choice'?question.criteria:{}).map((key,_i,all)=>[key,key==='individual'?.9:.1/(all.length-1)]));}
    return{body:JSON.stringify({model:request.model,usage:{input_tokens:100,output_tokens:0},answers}),http_status:200,latency_ms:1};}};
  return{run,store,provider,results,requests,events,cache};
}
test('listening transports only supplied pending questions, preserving incremental answers and consumer phases',async()=>{
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
  configuration.questions.push({key:'occasion',type:'choice',text:'When is it consumed?',scope:'consumer_category',origin:'brand_os',human_locked:true,
    options:[{key:'morning',definition:'Morning'},{key:'evening',definition:'Evening'}]},
    {key:'unasked_topic',type:'noul',text:'Unselected discovered topic',scope:'all',origin:'agent',human_locked:false,topic_source:'discovered',positive:'Present',negative:'Absent'});
  const cache:Record<string,unknown>={},first=fixture(configuration,[['voice','promotion'],['occasion']],cache);
  const outcome=await processSignalListeningJevV1({run_id:first.run.id,store:first.store,provider:first.provider,execution});
  assert.equal(outcome.status,'completed');assert.deepEqual(first.requests.map(request=>Object.keys(request.questions)),[['promotion','voice'],['occasion']]);
  assert.equal(signalListeningConsumerCutV1(configuration,'I drink tea',cache as never),'included');
  assert.equal('unasked_topic'in cache,false);assert.equal(first.results.some(result=>'trigger_barrier'in result.answers),false);
  assert.ok(first.events.indexOf('durable')<first.events.indexOf('settled'));
  const before=structuredClone(cache);
  configuration.questions.push({key:'sentiment',type:'choice',text:'How is it evaluated?',scope:'all',origin:'brand_os',human_locked:true,
    options:[{key:'good',definition:'Positive'},{key:'bad',definition:'Negative'}]});
  const next=fixture(configuration,[['sentiment']],cache);
  await processSignalListeningJevV1({run_id:next.run.id,store:next.store,provider:next.provider,execution});
  assert.deepEqual(Object.keys(next.requests[0]!.questions),['sentiment']);
  for(const [key,answer]of Object.entries(before))assert.deepEqual(cache[key],answer);
});
test('listening job is disabled without its explicit owner flag before any database or provider work',async()=>{
  const previous=process.env.NOISIA_SIGNAL_LISTENING_ENABLED;delete process.env.NOISIA_SIGNAL_LISTENING_ENABLED;
  try{await assert.rejects(signalListeningJevJobV1(randomUUID()),/listening_provider_disabled/);}
  finally{if(previous===undefined)delete process.env.NOISIA_SIGNAL_LISTENING_ENABLED;else process.env.NOISIA_SIGNAL_LISTENING_ENABLED=previous;}
});

test('missing calibrated provider configuration closes the claimed run without any physical send',async()=>{
  const f=fixture(signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),[['voice','promotion']]);
  let initialized=0;
  const provider=createSignalListeningProviderV1(f.run.labeler_digest,execution,()=>{initialized++;throw Error('missing-account-calibration');});
  const outcome=await processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider,execution});
  assert.equal(outcome.status,'failed');assert.equal(outcome.unresolved_billing_requests,0);assert.equal(initialized,1);
  assert.equal(f.requests.length,0);assert.equal(f.results[0]?.status,'error');assert.deepEqual(f.cache,{});
});
