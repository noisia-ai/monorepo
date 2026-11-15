import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,signalListeningBaseTemplateV1,signalListeningJevIdentityV1,signalListeningQuestionDigestV1,
  signalListeningCalibrationShapeV1,signalListeningConsumerCutV1,labelerDigestV1,entityContextDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalListeningCalibrationProfileV1,type SignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningResultV1} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallV1} from '@noisia/db';
import type {JevProviderV1,JevRequestV1} from '../providers/typesafe-jev';
import {processSignalListeningJevV1,signalListeningJevJobV1} from './signal-listening-jev';
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
  return{run,store,provider,results,requests,events,cache,calls};
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

test('listening job automatically warms up32 ordinary roots inside the claimed run without an env profile',async()=>{
  const f=fixture(signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),[['voice','promotion']]);
  const sample=(await f.store.inputs(f.run))[0]!;let reserved=false,closed=0,derivations=0;
  const corpus=Array.from({length:40},()=>({...sample,root_id:randomUUID()}));
  f.store.inputs=async()=>reserved?[]:corpus;
  const reserve=f.store.reserve;f.store.reserve=async(run,proposals)=>{assert.ok(proposals.length<=32);reserved=true;return reserve(run,proposals);};
  const original=f.provider.evaluate;let active=0,peak=0;
  f.provider.evaluate=async(...args)=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,1));return await original(...args);}finally{active--;}};
  f.provider.close=async()=>{closed++;};
  const database={async query(sql:string){
    if(sql.includes('SELECT run.workspace_id'))return{rows:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]};
    if(sql.includes('signal_workspace_features'))return{rows:[{enabled:true}]};throw Error('unexpected database query');
  }}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
  const previous={owner:process.env.NOISIA_SIGNAL_LISTENING_ENABLED,provider:process.env.NOISIA_JEV_PROVIDER_ENABLED};
  process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';process.env.NOISIA_JEV_PROVIDER_ENABLED='true';
  try{
    const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,window_size:200},preflight:async()=>{},
      calibration:{load:async()=>null,derive:async args=>{derivations++;assert.equal(args.run_id,f.run.id);assert.equal(args.actor_user_id,f.run.actor_user_id);
        assert.equal(f.results.length,32);assert.ok(f.events.includes('durable'));return null;}}});
    assert.equal(outcome.labeled,32);assert.equal(f.requests.length,32);assert.equal(peak,1);assert.equal(derivations,1);
    assert.equal(closed,0,'an externally injected provider remains caller-owned');
  }finally{
    for(const [key,value]of [['NOISIA_SIGNAL_LISTENING_ENABLED',previous.owner],['NOISIA_JEV_PROVIDER_ENABLED',previous.provider]]as const)
      if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

test('recovery-only applies a paid sibling while an unknown raw-less attempt stays blocked without another fetch',async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(configuration,[['voice','promotion']]);
 const input=(await f.store.inputs(f.run))[0]!;
 const proposals=[input,{...input,root_id:randomUUID()}].map(i=>{const request=buildSignalListeningJevRequestV1(i,configuration),request_digest=signalListeningRequestDigestV1(f.run,i,request);
  return{request,request_digest,custom_id:'listening_'+request_digest.slice(7,67),inputs:[i],reserved_micro_usd:100};});
 const calls=await f.store.reserve(f.run,proposals);await f.store.markSubmitting(f.run,calls);
 const raw=await f.provider.evaluate(proposals[0]!.request);f.requests.splice(0);
 calls[0]!.raw_body=JSON.stringify(raw);calls[1]!.status='unknown';f.run.error_code='labeling_outcome_unknown';
 f.store.finish=async()=>{f.run.status='failed';return'failed';};
 const outcome=await processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider:f.provider,execution,recovery_only:true});
 assert.equal(outcome.labeled,1);assert.equal(f.results.length,1);assert.equal(calls[0]!.results_applied,true);
 assert.equal(calls[1]!.status,'unknown');assert.equal(calls[1]!.results_applied,false);assert.equal(f.requests.length,0);
 assert.equal((await processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider:f.provider,execution,recovery_only:true})).status,'outcome_unknown');
 assert.equal(f.requests.length,0);
});

test('heterogeneous pending batches warm their extremes once then remain parallel without reprobing cached roots',async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(configuration,[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!,shape=signalListeningCalibrationShapeV1(configuration,sample);
 const corpus=Array.from({length:112},(_,i)=>({...sample,root_id:randomUUID(),text:i<32?'I drink tea':'x'.repeat(5+(i*13)%400)}));
 corpus[32]!.text='x'.repeat(600);corpus[70]!.text='x'.repeat(1000);corpus[90]!.text='a';
 const cached=Array.from({length:3},()=>({...sample,root_id:randomUUID(),text:'cached root must not be sent'}));
 const pending=new Map<string,SignalListeningInputV1>(corpus.map(input=>[input.root_id,input]));
 f.store.inputs=async()=>[...pending.values()];
 const apply=f.store.apply;f.store.apply=async(run,rows)=>{await apply(run,rows);for(const row of rows)pending.delete(row.call.inputs[0]!.root_id);};
 f.store.finish=async()=>{const status=pending.size?'running' as const:'completed' as const;f.run.status=status;return status;};
 const bytes=(request:JevRequestV1)=>Buffer.byteLength(JSON.stringify(request)),normalBytes=bytes(buildSignalListeningJevRequestV1(sample,configuration));
 const scope={workspace_id:f.run.workspace_id,configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
 let profile:SignalListeningCalibrationProfileV1={scope,scope_digest:digest(scope),source_digest:digest('measured-baseline'),source_call_ids:Array.from({length:32},()=>randomUUID()),
  source_run_id:f.run.id,request_min_bytes:normalBytes,request_max_bytes:normalBytes+100,max_input_tokens_per_byte:.25,sample_count:32,status:'measured'};
 let derivations=0,active=0,peak=0;const peaks:number[]=[],windows:JevRequestV1[][]=[];
 const evaluate=f.provider.evaluate;f.provider.evaluate=async(...args)=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,1));return await evaluate(...args);}finally{active--;}};
 const database={async query(sql:string){if(sql.includes('SELECT run.workspace_id'))return{rows:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]};
  if(sql.includes('signal_workspace_features'))return{rows:[{enabled:true}]};throw Error('unexpected database query');
 }}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const previous={owner:process.env.NOISIA_SIGNAL_LISTENING_ENABLED,provider:process.env.NOISIA_JEV_PROVIDER_ENABLED};
 process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';process.env.NOISIA_JEV_PROVIDER_ENABLED='true';
 try{
  while(pending.size){peak=0;const before=f.requests.length;
   await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,window_size:40},preflight:async()=>{},
    calibration:{load:async()=>profile,derive:async()=>{
     derivations++;const receipts=f.calls.filter(call=>call.status==='settled'&&call.results_applied).slice(-32);assert.equal(receipts.length,32);
     const sizes=receipts.map(call=>bytes(call.request as JevRequestV1));
     profile={...profile,source_digest:digest(receipts.map(call=>call.id)),source_call_ids:receipts.map(call=>call.id),sample_count:receipts.length,
      request_min_bytes:Math.min(...sizes),request_max_bytes:Math.max(...sizes),max_input_tokens_per_byte:Math.max(...sizes.map(n=>100/n))*1.25};return profile;
    }}});
   peaks.push(peak);windows.push(f.requests.slice(before));assert.ok(windows.length<10,'bounded progress must finish rather than warming covered prefixes forever');
  }
  assert.equal(windows[0]!.length,32);assert.equal(peaks[0],1);
  for(const index of [32,70,90])assert.ok(windows[0]!.some(request=>request.state===corpus[index]!.text));
  assert.ok(peaks.slice(1).every(value=>value>1));assert.equal(derivations,1);assert.equal(f.requests.length,corpus.length);
  assert.equal(f.calls.length,corpus.length);assert.equal(new Set(f.calls.map(call=>call.inputs[0]!.root_id)).size,corpus.length);
  assert.ok(f.calls.every(call=>!cached.some(input=>input.root_id===call.inputs[0]!.root_id)));
 }finally{for(const[key,value]of [['NOISIA_SIGNAL_LISTENING_ENABLED',previous.owner],['NOISIA_JEV_PROVIDER_ENABLED',previous.provider]]as const)
  if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
