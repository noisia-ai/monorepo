import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,signalListeningBaseTemplateV1,signalListeningJevIdentityV1,signalListeningQuestionDigestV1,
  signalListeningCalibrationShapeV1,signalListeningConsumerCutV1,validateSignalListeningConfigurationV1,compileSignalListeningSnapshotV1,labelerDigestV1,entityContextDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalListeningCalibrationProfileV1,type SignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningResultV1} from '@noisia/query-engine';
import {signalListeningInputSurveyStorageBoundV1,LABELING_INPUT_MAX_WORKING_BYTES_V1,type LabelingRunV1,type LabelingCallV1} from '@noisia/db';
import type {JevProviderV1,JevRequestV1} from '../providers/typesafe-jev';
import {processSignalListeningJevV1,signalListeningJevJobV1,createSignalListeningSelectionIndexV1} from './signal-listening-jev';
import {jevCallWorkingBytesV2} from './signal-jev-streaming-window';
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
    assert.equal(outcome.labeled,32);assert.equal(f.requests.length,32);assert.ok(peak>=2);assert.ok(peak<=8);assert.equal(derivations,1);
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
 let boundedReads=0;
 f.store.inputs=async(_run,bounds)=>{assert.ok(bounds,'every native hydration must receive a byte and row budget');boundedReads++;
  assert.ok(bounds.max_working_bytes>0&&bounds.max_working_bytes<=execution.max_buffered_bytes);
  return[...pending.values()].filter(input=>!f.calls.some(call=>call.inputs.some(sent=>sent.root_id===input.root_id))).slice(0,bounds.max_rows);};
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
   await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,window_size:200},preflight:async()=>{},
    calibration:{load:async()=>profile,derive:async()=>{
     derivations++;const receipts=f.calls.filter(call=>call.status==='settled'&&call.results_applied).slice(-32);assert.equal(receipts.length,32);
     const sizes=receipts.map(call=>bytes(call.request as JevRequestV1));
     profile={...profile,source_digest:digest(receipts.map(call=>call.id)),source_call_ids:receipts.map(call=>call.id),sample_count:receipts.length,
      request_min_bytes:Math.min(...sizes),request_max_bytes:Math.max(...sizes),max_input_tokens_per_byte:Math.max(...sizes.map(n=>100/n))*1.25};return profile;
    }}});
   peaks.push(peak);windows.push(f.requests.slice(before));assert.ok(windows.length<10,'bounded progress must finish rather than warming covered prefixes forever');
  }
  assert.equal(windows.length,1,'one lease now continues after Native calibration ACK');assert.equal(windows[0]!.length,corpus.length);assert.ok(peaks[0]!>=2);assert.ok(peaks[0]!<=8);assert.ok(boundedReads>=2);
  for(const index of [32,70,90])assert.ok(windows[0]!.some(request=>request.state===corpus[index]!.text));
  assert.ok(peaks.slice(1).every(value=>value>1));assert.equal(derivations,1);assert.equal(f.requests.length,corpus.length);
  assert.equal(f.calls.length,corpus.length);assert.equal(new Set(f.calls.map(call=>call.inputs[0]!.root_id)).size,corpus.length);
  assert.ok(f.calls.every(call=>!cached.some(input=>input.root_id===call.inputs[0]!.root_id)));
 }finally{for(const[key,value]of [['NOISIA_SIGNAL_LISTENING_ENABLED',previous.owner],['NOISIA_JEV_PROVIDER_ENABLED',previous.provider]]as const)
  if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
for(const withUnknownWithoutRaw of [false,true])test(`recovery precedes an outlier of another shape and finds paid raw beyond32 (unresolved sibling ${withUnknownWithoutRaw})`,async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 configuration.questions.push({key:'occasion',type:'noul',text:'Occasion?',positive:'Present',negative:'Absent',scope:'all',origin:'brand_os',human_locked:true});
 const f=fixture(configuration,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;
 const inputRows=Array.from({length:40},(_,i)=>({...sample,root_id:randomUUID(),text:i===0?'x'.repeat(5000):sample.text}));
 inputRows[0]={...inputRows[0]!,question_keys:['occasion'],question_digests:{occasion:signalListeningQuestionDigestV1(configuration,configuration.questions.at(-1)!)}};
 const proposals=inputRows.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(f.run,input,request);
  return{request,request_digest,custom_id:'listening_'+request_digest.slice(7,67),inputs:[input],reserved_micro_usd:100};});
 await f.store.reserve(f.run,proposals);const page=randomUUID(),raws=new Map<string,string>();
 for(const index of [33,34]){const call=f.calls[index]!;call.status='unknown';const value=await f.provider.evaluate(call.request as JevRequestV1);
  const raw=JSON.stringify({...value,rate_calibration:{labeler_digest:'sha256:'+'a'.repeat(64),input_bytes:100,
    kind:withUnknownWithoutRaw?'measured':'official_context_bound'}});
  raws.set(call.id,raw);call.has_raw=true;call.raw_page_id=page;call.raw_page_size_bytes=4096;call.raw_size_bytes=Buffer.byteLength(raw);}
 if(withUnknownWithoutRaw)f.calls[39]!.status='unknown';f.requests.splice(0);f.run.error_code='labeling_outcome_unknown';
 let loads=0,metadataReads=0,calibrationLoads=0,derivations=0;
 f.store.calls=async(_run,read)=>{
  let calls=f.calls.filter(call=>!call.results_applied);if(read?.metadata_only){metadataReads++;return calls.map(call=>({...call,raw_body:null}));}
  assert.ok(read?.call_ids);loads++;calls=calls.filter(call=>read!.call_ids!.includes(call.id));
  for(const call of calls)call.raw_body=raws.get(call.id)??null;return calls;
 };
 f.store.finish=async()=>{const unknown=f.calls.some(call=>call.status==='unknown'),pending=f.calls.some(call=>!call.results_applied);f.run.error_code=unknown?'labeling_outcome_unknown':null;
  const status=unknown?'failed' as const:pending?'running' as const:'completed' as const;f.run.status=status;return status;};
 f.store.fail=async(_run,code)=>{f.run.error_code=code;f.run.status='failed';};
 f.store.refresh=async()=>({status:f.run.status,error_code:f.run.error_code??null});
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const previous=process.env.NOISIA_SIGNAL_LISTENING_ENABLED;process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';
 try{
  const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution,preflight:async()=>{},
   calibration:{load:async()=>{calibrationLoads++;throw Error('must recover before calibrating');},derive:async()=>{derivations++;assert.ok(f.calls.slice(33,35).every(call=>call.status==='settled'&&call.results_applied));return null;}}});
  assert.equal(outcome.labeled,2);assert.equal(f.requests.length,0);assert.equal(metadataReads,1);assert.equal(loads,1);assert.equal(calibrationLoads,0);assert.equal(derivations,withUnknownWithoutRaw?0:1,'only interrupted warmup derives a profile; measured recovery retains its wider profile');
  assert.ok(f.calls.slice(33,35).every(call=>call.status==='settled'&&call.results_applied));assert.equal(f.results.length,2);
  assert.ok(f.calls.slice(0,33).every(call=>call.status==='reserved'&&!call.results_applied));
  if(withUnknownWithoutRaw){assert.equal(f.calls[39]!.status,'unknown');assert.equal(f.calls[39]!.results_applied,false);assert.equal(f.run.error_code,'labeling_outcome_unknown');}
  else assert.equal(f.run.error_code,null);
 }finally{if(previous===undefined)delete process.env.NOISIA_SIGNAL_LISTENING_ENABLED;else process.env.NOISIA_SIGNAL_LISTENING_ENABLED=previous;}
});

test('automatic measured listening admits a new bounded ordinary shape and stops its admission when Native profile is unavailable',async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(configuration,[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!,shape=signalListeningCalibrationShapeV1(configuration,sample);
 const corpus=[{...sample,root_id:randomUUID()},{...sample,root_id:randomUUID()},
  {...sample,root_id:randomUUID(),question_keys:['promotion'],question_digests:{promotion:sample.question_digests.promotion!}}];
 f.store.inputs=async()=>corpus.filter(input=>!f.calls.some(call=>call.inputs.some(sent=>sent.root_id===input.root_id))).slice(0,2);
 f.store.finish=async()=>f.calls.length===3?'completed':'running';
 const bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(sample,configuration))),scope={workspace_id:f.run.workspace_id,
  configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
 const profile:SignalListeningCalibrationProfileV1={scope,scope_digest:digest(scope),source_digest:digest('measured'),source_call_ids:Array.from({length:32},()=>randomUUID()),
  source_run_id:f.run.id,request_min_bytes:bytes,request_max_bytes:bytes+100,max_input_tokens_per_byte:.25,sample_count:32,status:'measured'};
 const database={async query(sql:string){if(sql.includes('SELECT run.workspace_id'))return{rows:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]};
  if(sql.includes('signal_workspace_features'))return{rows:[{enabled:true}]};throw Error('unexpected query');
 }}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 try{
  for(const name of names)process.env[name]='true';
  const result=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,window_size:2},
   preflight:async()=>{},calibration:{load:async args=>args.shape_digest===shape.shape_digest?profile:null,derive:async()=>null}});
  assert.equal(result.status,'completed');assert.equal(f.requests.length,3);assert.equal(f.calls.length,3);
  assert.equal(f.calls.filter(call=>call.inputs[0]!.root_id===corpus[2]!.root_id).length,1,'the new shape is an ordinary reusable label, never a probe');
  assert.ok(f.calls.every(call=>call.status==='settled'&&call.results_applied));
 }finally{names.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});


test('prepared selection exceeding retained request and response memory reserves and sends nothing',async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(configuration,[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!;let reads=0,reserves=0;
 f.store.inputs=async(_run,bounds)=>{reads++;assert.ok(bounds);assert.equal(bounds.max_working_bytes,512*1024);
  return[{...sample,text:'tea '.repeat(8000)}];};
 f.store.reserve=async()=>{reserves++;throw Error('must not reserve oversized initial selection');};
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 try{
  for(const name of names)process.env[name]='true';
  await assert.rejects(signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,
   execution:{...execution,max_buffered_bytes:512*1024},preflight:async()=>{},calibration:{load:async()=>null,derive:async()=>null}}),/listening_selection_memory_bound/);
  assert.equal(reads,1);assert.equal(reserves,0);assert.equal(f.requests.length,0);
 }finally{names.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});

for(const failure of['unusable_usage','invalid_answers']as const)test(`parallel warmup closes admission on ${failure}, drains siblings and cannot resend ambiguous attempts`,async()=>{
 const f=fixture(signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!,corpus=Array.from({length:40},()=>({...sample,root_id:randomUUID()}));
 let reserved=false;f.store.inputs=async()=>reserved?[]:corpus;
 const reserve=f.store.reserve;f.store.reserve=async(run,proposals)=>{reserved=true;return reserve(run,proposals);};
 let physical=0;const evaluate=f.provider.evaluate;
 f.provider.evaluate=async(...args)=>{const i=physical++;if(i===0){await new Promise(resolve=>setTimeout(resolve,2));return{body:JSON.stringify({model:args[0].model,...(failure==='invalid_answers'?{usage:{input_tokens:100,output_tokens:0}}:{}),answers:{}}),http_status:200,latency_ms:2};}
  await new Promise(resolve=>setTimeout(resolve,20));return evaluate(...args);};
 const outcome=await processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider:f.provider,
  execution:{...execution,window_size:32,max_in_flight:4,flush_size:1}});
 assert.ok(physical>=2);assert.ok(physical<=5,'only the initial four plus one handoff racing asynchronous raw validation may send');
 assert.ok(f.calls.filter(c=>c.status==='reserved').every(c=>!c.raw_body&&!c.results_applied),'never-sent reservations retain no invented technical response');
 assert.equal(f.results.filter(r=>r.status==='labeled').length,physical-1,'all handed-off siblings drain');
 if(failure==='unusable_usage'){
  assert.equal(outcome.status,'failed');assert.ok(f.calls.some(call=>call.status==='unknown'));const before=physical;
  await processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider:f.provider,execution,recovery_only:true});
  assert.equal(physical,before,'ambiguous physical receipt is not resubmitted');
 }
});

test('planned page recovery reuses the injected shared-account factory for verified usage without any provider handoff',{timeout:10000},async()=>{
 const f=fixture(signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!,inputs=Array.from({length:3},()=>({...sample,root_id:randomUUID()}));
 const proposals=inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,f.run.identity.params.configuration as never),request_digest=signalListeningRequestDigestV1(f.run,input,request);
  return{request,request_digest,custom_id:'listening_'+request_digest.slice(7,67),inputs:[input],reserved_micro_usd:100};});
 await f.store.reserve(f.run,proposals);const page=randomUUID(),scope=digest('original-account-calibration');
 for(const call of f.calls){const raw=await f.provider.evaluate(call.request as JevRequestV1);call.status='unknown';call.has_raw=true;call.raw_page_id=page;call.raw_page_size_bytes=8192;
  call.raw_body=JSON.stringify({...raw,rate_calibration:{labeler_digest:scope,input_bytes:100,kind:'official_context_bound'}});}
 f.requests.splice(0);f.store.fail=async(_run,code)=>{f.run.status='failed';f.run.error_code=code;};
 f.store.refresh=async()=>({status:f.run.status,error_code:f.run.error_code??null});
 let factoryCalls=0,observations=0,handoffs=0,closed=0;
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:true}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const previous={owner:process.env.NOISIA_SIGNAL_LISTENING_ENABLED,account:process.env.NOISIA_TYPESAFE_ACCOUNT_ID};
 process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';delete process.env.NOISIA_TYPESAFE_ACCOUNT_ID;
 try{
  const result=await signalListeningJevJobV1(f.run.id,{database,store:f.store,execution,preflight:async()=>{},
   calibrated_provider_factory:args=>{factoryCalls++;assert.equal(args.labeler_digest,scope);return{max_concurrency:1,max_response_bytes:16384,
    evaluate:async()=>{handoffs++;throw Error('recovery cannot send');},observeUsage:async(_raw,tokens)=>{assert.equal(tokens,100);observations++;},close:async()=>{closed++;}};},
   calibration:{load:async()=>{throw Error('recovery cannot invent a calibration profile');},derive:async()=>null}});
  assert.equal(result.labeled,3);assert.equal(factoryCalls,1);assert.equal(observations,3);assert.equal(handoffs,0);assert.equal(closed,1);assert.equal(f.requests.length,0);
  assert.ok(f.calls.every(c=>c.results_applied&&c.status==='settled'));
 }finally{for(const[key,value]of[['NOISIA_SIGNAL_LISTENING_ENABLED',previous.owner],['NOISIA_TYPESAFE_ACCOUNT_ID',previous.account]]as const)if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('measured prefetch loads an existing second-phase profile before reserving and keeps one invocation without new warmup',async()=>{
 const draft=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 draft.questions.push({key:'consumer_topic',type:'noul',text:'Consumer tea?',positive:'Consumer tea',negative:'Other',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined'});
 const configuration=validateSignalListeningConfigurationV1(draft);
 const f=fixture(configuration,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;
 const consumer={...sample,root_id:randomUUID(),question_keys:['consumer_topic'],question_digests:{consumer_topic:signalListeningQuestionDigestV1(configuration,configuration.questions.at(-1)!)}};
 // The third root already has its bases: the native reader may expose its
 // consumer phase after an initial page containing only base-question roots.
 const corpus=[{...sample,root_id:randomUUID()},{...sample,root_id:randomUUID()},consumer];
 f.store.inputs=async()=>corpus.filter(input=>!f.calls.some(call=>call.inputs.some(sent=>sent.root_id===input.root_id))).slice(0,2);
 f.store.finish=async()=>f.calls.length===3?'completed':'running';
 const profiles=new Map(corpus.map(input=>{const shape=signalListeningCalibrationShapeV1(configuration,input),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(input,configuration)));
  const scope={workspace_id:f.run.workspace_id,configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
  return[shape.shape_digest,{scope,scope_digest:digest(scope),source_digest:digest(['stored-ledger',shape.shape_digest]),source_call_ids:Array.from({length:32},()=>randomUUID()),source_run_id:f.run.id,
   request_min_bytes:bytes,request_max_bytes:bytes+100,max_input_tokens_per_byte:.25,sample_count:32,status:'measured'} as SignalListeningCalibrationProfileV1];}));
 const loads:string[]=[];const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 try{for(const name of names)process.env[name]='true';
  const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,window_size:2},preflight:async()=>{},
   calibration:{load:async args=>{assert.equal(args.workspace_id,f.run.workspace_id);assert.equal(args.actor_user_id,f.run.actor_user_id);assert.equal(args.configuration_digest,digest(configuration));loads.push(args.shape_digest);return profiles.get(args.shape_digest)??null;},
    derive:async()=>{throw Error('continuity cannot create or derive another warmup');}}});
  assert.equal(outcome.status,'completed');assert.equal(f.requests.length,3);assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(call=>call.request_digest)).size,3);
  assert.ok(f.calls.every(call=>call.status==='settled'&&call.results_applied));assert.equal(loads.length,2);assert.equal(new Set(loads).size,2);
  assert.ok(f.requests.some(request=>Object.keys(request.questions).join(',')==='consumer_topic'));
 }finally{names.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});

test('default Listening job with one HTTP slot keeps the distant anchor and both Native-dependent phases under one real claim/finish',{timeout:15000},async()=>{
 const draft=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 draft.questions.push({key:'consumer_topic',type:'noul',text:'Consumer tea?',positive:'Present',negative:'Absent',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined'});
 const configuration=validateSignalListeningConfigurationV1(draft),f=fixture(configuration,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;
 const bases=Array.from({length:80},(_,i)=>({...sample,root_id:randomUUID(),text:i===79?'tea '.repeat(500):sample.text}));
 const consumers=bases.map(input=>({...input,question_keys:['consumer_topic'],question_digests:{consumer_topic:signalListeningQuestionDigestV1(configuration,configuration.questions.at(-1)!)}}));
 const profiles=new Map<string,SignalListeningCalibrationProfileV1>(),appliedBase=new Set<string>(),durable=new Map<string,number>();let claims=0,finishes=0,releases=0,initialReserved=0,heldApply=false;
 const metrics:Array<{reserved_working_bytes:number;active_flushes:number;in_flight:number}>=[],events:Array<{transition?:string;selected_roots:number;outcome?:string}>=[];
 const claim=f.store.claim,release=f.store.release,reserve=f.store.reserve,apply=f.store.apply,persist=f.store.persistRawPage;
 f.store.persistRawPage=async(run,rows)=>{await persist(run,rows);for(const row of rows)durable.set(row.call.id,Buffer.byteLength(row.raw));};
 f.store.claim=async(...args)=>{claims++;return claim(...args);};f.store.release=async(...args)=>{releases++;return release(...args);};
 f.store.inputs=async(_run,bounds)=>[...bases,...consumers.filter(input=>appliedBase.has(input.root_id))]
  .filter(input=>!f.calls.some(call=>call.inputs[0]!.root_id===input.root_id&&call.inputs[0]!.question_keys[0]===input.question_keys[0])).slice(0,bounds!.max_rows);
 f.store.reserve=async(run,proposals)=>{if(!f.calls.length){initialReserved=proposals.length;assert.equal(initialReserved,32);assert.ok(proposals.some(p=>p.inputs[0]!.root_id===bases[79]!.root_id));}return reserve(run,proposals);};
 f.store.apply=async(run,rows)=>{
  assert.ok(rows.every(row=>row.call.status==='settled'&&durable.has(row.call.id)),'durable storage owns RAW before APPLY; transient bodies may already be released');
  if(!heldApply){heldApply=true;const retained=f.calls.reduce((n,call)=>n+jevCallWorkingBytesV2(call),0),custody=rows.reduce((n,row)=>n+Math.min(16384*24+64*1024,durable.get(row.call.id)!*24+64*1024),0);
   assert.ok(metrics.at(-1)!.reserved_working_bytes>=retained+custody);assert.equal(f.requests.some(r=>'consumer_topic'in r.questions),false);
   await new Promise(resolve=>setTimeout(resolve,10));assert.ok(metrics.at(-1)!.reserved_working_bytes>=retained+custody,'RAW custody cannot be released while APPLY is awaiting its ACK');}
  await apply(run,rows);for(const row of rows)if('voice'in row.results[0]!.answers)appliedBase.add(row.call.inputs[0]!.root_id);
 };
 const evaluate=f.provider.evaluate;f.provider.evaluate=async(...args)=>{if('consumer_topic'in args[0].questions){const root=consumers.find(input=>input.text===args[0].state&&appliedBase.has(input.root_id));assert.ok(root,'consumer is only exposed after real base APPLY');}return evaluate(...args);};
 f.store.finish=async()=>{finishes++;const status=f.calls.length===160&&f.calls.every(call=>call.results_applied)?'completed' as const:'running' as const;f.run.status=status;return status;};
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 try{for(const name of names)process.env[name]='true';
  const result=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,max_in_flight:1,flush_size:8,max_flushes:2},preflight:async()=>{},observe_stream:value=>metrics.push(value),observe_calibration:value=>events.push(value),
   calibration:{load:async args=>profiles.get(args.shape_digest)??null,derive:async args=>{
    const receipts=f.calls.filter(call=>call.results_applied&&call.status==='settled'&&signalListeningCalibrationShapeV1(configuration,call.inputs[0]!).shape_digest===args.shape_digest).slice(-32);
    assert.ok(receipts.length>0);const shape=signalListeningCalibrationShapeV1(configuration,receipts[0]!.inputs[0]!),sizes=receipts.map(call=>Buffer.byteLength(JSON.stringify(call.request))),scope={workspace_id:f.run.workspace_id,configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
    const profile:SignalListeningCalibrationProfileV1={scope,scope_digest:digest(scope),source_digest:digest(receipts.map(call=>call.id)),source_call_ids:receipts.map(call=>call.id),source_run_id:f.run.id,
     request_min_bytes:Math.min(...sizes),request_max_bytes:Math.max(...sizes),max_input_tokens_per_byte:.25,sample_count:receipts.length,status:'measured'};profiles.set(args.shape_digest,profile);return profile;
   }}});
  assert.equal(result.status,'completed');assert.equal(result.labeled,160);assert.equal(f.requests.length,160);assert.equal(initialReserved,32);
  assert.deepEqual([claims,finishes,releases],[1,1,1]);assert.equal(new Set(f.calls.map(call=>call.request_digest)).size,160);assert.ok(f.calls.every(call=>call.results_applied&&durable.has(call.id)&&call.status==='settled'));assert.equal(durable.size,160);
  assert.equal(events.filter(event=>event.transition==='bootstrap_start').length,2);assert.ok(events.filter(event=>event.transition==='bootstrap_end').every(event=>event.outcome==='measured'));
  assert.ok(metrics.every(value=>value.in_flight<=1&&value.active_flushes<=2&&value.reserved_working_bytes>=0&&value.reserved_working_bytes<=execution.max_buffered_bytes));assert.equal(metrics.at(-1)!.reserved_working_bytes,0);
 }finally{names.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});

for(const [cap,rejection]of [[15,'labeling_budget_exceeded'],[32,'labeling_budget_exceeded'],[32,'listening_forbidden']]as const)test(`complete bootstrap respects the Native financial prefix and drains paid custody at cap ${cap}, ${rejection}`,{timeout:10000},async()=>{
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(configuration,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;
 const corpus=Array.from({length:80},()=>({...sample,root_id:randomUUID()})),durable=new Set<string>();let releases=0,reserves=0,profile:SignalListeningCalibrationProfileV1|null=null;
 f.store.release=async()=>{releases++;};f.store.inputs=async(_run,bounds)=>corpus.filter(input=>!f.calls.some(call=>call.inputs[0]!.root_id===input.root_id)).slice(0,bounds!.max_rows);
 const reserve=f.store.reserve,persist=f.store.persistRawPage;f.store.persistRawPage=async(run,rows)=>{await persist(run,rows);for(const row of rows)durable.add(row.call.id);};
 f.store.reserve=async(run,proposals)=>{reserves++;if(f.calls.length+proposals.length>cap)throw Error(rejection);return reserve(run,proposals);};
 f.store.finish=async()=> 'running';
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 const memory:number[]=[];try{for(const name of names)process.env[name]='true';
  await assert.rejects(signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:{...execution,max_in_flight:1},preflight:async()=>{},observe_stream:value=>memory.push(value.reserved_working_bytes),
   calibration:{load:async()=>profile,derive:async()=>{const receipts=f.calls.filter(call=>call.results_applied);assert.equal(receipts.length,32);
    const shape=signalListeningCalibrationShapeV1(configuration,sample),scope={workspace_id:f.run.workspace_id,configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
    const bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(sample,configuration)));profile={scope,scope_digest:digest(scope),source_digest:digest(receipts.map(call=>call.id)),source_call_ids:receipts.map(call=>call.id),source_run_id:f.run.id,
     request_min_bytes:bytes,request_max_bytes:bytes,max_input_tokens_per_byte:.25,sample_count:32,status:'measured'};return profile;}}}),new RegExp(rejection));
  assert.equal(releases,1);assert.equal(f.requests.length,cap===15?0:32);assert.equal(f.calls.length,cap===15?0:32);assert.equal(reserves,cap===15?1:2);
  assert.ok(f.calls.every(call=>call.results_applied&&durable.has(call.id)&&call.status==='settled'),'all paid prefix receipts survive the later rejection');
  if(cap===32)assert.equal(memory.at(-1),f.calls.reduce((n,call)=>n+jevCallWorkingBytesV2(call),0),'on error only the caller-owned initial request page remains, with no paid RAW custody');
 }finally{names.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});


test('indexed Listening selection preserves the original intersection oracle across order, duplicates, subsets and replacement',()=>{
 const key=(input:SignalListeningInputV1)=>digest({root_id:input.root_id,input_digest:input.input_digest,question_digests:input.question_digests});
 const oracle=(inputs:SignalListeningInputV1[],selection:SignalListeningInputV1[]|undefined,limit:number)=>{
  if(!selection)return inputs.slice(0,limit);const available=new Map(inputs.map(input=>[key(input),input]));
  return selection.flatMap(input=>{const found=available.get(key(input));return found?[found]:[];}).slice(0,limit);
 };
 const index=createSignalListeningSelectionIndexV1(key);let seed=97;const random=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const pool=Array.from({length:20},(_,i)=>({root_id:`root-${i%5}`,input_digest:digest(`input-${i%3}`),question_digests:{q:digest(`q-${i%4}`)},text:'synthetic',title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01T00:00:00Z',language:'en',map_id:'synthetic',question_keys:['q'],scope_basis:{q:'all'},configuration_digest:digest('configuration')}));
 for(let trial=0;trial<160;trial++){
  const selection=trial%13===0?undefined:Array.from({length:random(25)},()=>pool[random(pool.length)]!);
  const inputs=Array.from({length:random(25)},()=>({...pool[random(pool.length)]!,text:`payload-${random(100)}`}));
  const limit=random(20);assert.deepEqual(index.select(inputs,selection,limit),oracle(inputs,selection,limit));
  for(const input of inputs)assert.deepEqual(index.select([input],selection,limit),oracle([input],selection,limit));
 }
 const original=pool[0]!,replacement={...original,text:'last input payload'},selection=[original,original,pool[1]!];
 assert.deepEqual(index.select([original,replacement],selection,5),[replacement,replacement]);
 for(const changed of [{...original,root_id:'other'},{...original,input_digest:digest('different')},{...original,question_digests:{q:digest('changed')}}])assert.deepEqual(index.select([changed],selection,5),[]);
 selection.splice(0,selection.length,pool[2]!);index.invalidate();assert.deepEqual(index.select([original,pool[2]!],selection,5),[pool[2]!]);
 assert.deepEqual(index.select([original],undefined,5),[original]);assert.deepEqual(index.select([original],[],5),[]);
});

test('a4096-root continuation hashes selection once and each singleton once, then invalidates per page',()=>{
 let hashes=0;const key=(input:SignalListeningInputV1)=>{hashes++;return digest({root_id:input.root_id,input_digest:input.input_digest,question_digests:input.question_digests});};
 const index=createSignalListeningSelectionIndexV1(key),selection=Array.from({length:4096},(_,i)=>({root_id:`root-${i}`,input_digest:digest(`input-${i}`),question_digests:{q:digest('q')},text:'synthetic',title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01T00:00:00Z',language:'en',map_id:'synthetic',question_keys:['q'],scope_basis:{q:'all'},configuration_digest:digest('configuration')}));
 for(const input of selection)assert.deepEqual(index.select([input],selection,4096),[input]);
 assert.equal(hashes,8192,'N page keys + N supplied keys; never N*(N+1)');
 const next=selection.slice().reverse();assert.deepEqual(index.select([selection[0]!],next,4096),[selection[0]!]);assert.equal(hashes,12289);
 index.invalidate();assert.deepEqual(index.select([selection[0]!],next,4096),[selection[0]!]);assert.equal(hashes,16386);
});


test('compiled run binding rejects another generation and forged or foreign snapshots before money or HTTP',async()=>{
 const c=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(c,[['voice','promotion']]);
 f.run.entity_context_version_no=1;const original=f.store.inputs.bind(f.store);f.store.inputs=async(...args)=>{const inputs=await original(...args);f.run.entity_context_version_no++;return inputs;};
 await assert.rejects(processSignalListeningJevV1({run_id:f.run.id,store:f.store,provider:f.provider,execution}),/listening_identity_invalid/);
 assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
 for(const snapshot of [{} as never,compileSignalListeningSnapshotV1({...c,instructions:'Another snapshot'})]){
  const next=fixture(c,[['voice','promotion']]);
  await assert.rejects(processSignalListeningJevV1({run_id:next.run.id,store:next.store,provider:next.provider,execution,compiled_snapshot:()=>snapshot}),/compiled_snapshot_invalid|identity_invalid/);
  assert.equal(next.calls.length,0);assert.equal(next.requests.length,0);
 }
});

test('a new claimed run/config compiles fresh bytes and raw invalid JSON still fails at the boundary',async()=>{
 const first=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),second={...first,instructions:'Different stored generation rules'};
 const a=fixture(first,[['voice','promotion']]),b=fixture(second,[['voice','promotion']]);
 await processSignalListeningJevV1({run_id:a.run.id,store:a.store,provider:a.provider,execution});
 await processSignalListeningJevV1({run_id:b.run.id,store:b.store,provider:b.provider,execution});
 assert.notEqual(JSON.stringify(a.requests[0]!.questions),JSON.stringify(b.requests[0]!.questions));
 const bad=fixture(first,[['voice','promotion']]);bad.run.identity.params.configuration={untrusted:true};
 await assert.rejects(processSignalListeningJevV1({run_id:bad.run.id,store:bad.store,provider:bad.provider,execution}),/configuration_invalid/);
 assert.equal(bad.requests.length,0);
});


test('job stream observation cannot change physical attempts, raw custody or settlement even when callback mutates and throws',async()=>{
 const config=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(k=>process.env[k]);
 const snapshots:Array<{in_flight:number;reserved_working_bytes:number;buffered_responses:number;active_flushes:number}>=[];
 async function execute(observed:boolean){
  const f=fixture(config,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;let reserved=false;
  f.store.inputs=async()=>reserved?[]:[sample];const reserve=f.store.reserve;
  f.store.reserve=async(run,rows)=>{reserved=true;return reserve(run,rows);};
  const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
  const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution,preflight:async()=>{},
   calibration:{load:async()=>null,derive:async()=>null},...(observed?{observe_stream:(metrics:typeof snapshots[number])=>{
    snapshots.push({...metrics});metrics.in_flight=-999;throw Error('observer exception must not affect custody');
   }}:{})});
  return{outcome,requests:f.requests,events:f.events,calls:f.calls.map(call=>({status:call.status,applied:call.results_applied,
   reserved:call.reserved_micro_usd,raw:call.raw_body})),answers:f.results.map(r=>r.answers)};
 }
 try{
  names.forEach(k=>process.env[k]='true');const baseline=await execute(false),observed=await execute(true);
  assert.equal(baseline.outcome.labeled,1);assert.equal(observed.outcome.labeled,1);
  assert.deepEqual(observed.requests,baseline.requests);assert.equal(observed.requests.length,1);
  assert.deepEqual(observed.calls,baseline.calls);assert.deepEqual(observed.answers,baseline.answers);
  assert.deepEqual(observed.events,['durable','settled','apply']);assert.deepEqual(observed.events,baseline.events);
  assert.ok(snapshots.some(s=>s.in_flight===1));assert.ok(snapshots.some(s=>s.active_flushes===1));
  assert.ok(snapshots.every(s=>s.in_flight>=0&&s.reserved_working_bytes>=0&&s.buffered_responses>=0&&s.active_flushes>=0));
  assert.equal(snapshots.at(-1)!.in_flight,0);assert.equal(snapshots.at(-1)!.active_flushes,0);
 }finally{names.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});


test('larger Listening stream custody keeps initial and continuous reads inside the native read cap and drains exact intents',async()=>{
 const config=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),f=fixture(config,[['voice','promotion']]);
 const sample=(await f.store.inputs(f.run))[0]!,corpus=Array.from({length:6},()=>({...sample,root_id:randomUUID()}));
 const reads:Array<{max_rows:number;max_working_bytes:number;on_oversize?:string}>=[];
 const durable=new Map<string,string>(),persist=f.store.persistRawPage;
 f.store.persistRawPage=async(run,rows)=>{await persist(run,rows);for(const row of rows)durable.set(row.call.id,row.raw);};
 f.store.inputs=async(_run,bounds)=>{
  assert.ok(bounds);if(bounds.max_working_bytes>LABELING_INPUT_MAX_WORKING_BYTES_V1)throw Error('labeling_input_bounds_invalid');
  reads.push({...bounds});return corpus.filter(i=>!f.calls.some(c=>c.inputs[0]!.root_id===i.root_id)).slice(0,bounds.max_rows);
 };
 f.store.finish=async()=>{const status=f.results.length===corpus.length?'completed' as const:'running' as const;f.run.status=status;return status;};
 const shape=signalListeningCalibrationShapeV1(config,sample),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(sample,config)));
 const scope={workspace_id:f.run.workspace_id,configuration_digest:digest(config),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
 const profile:SignalListeningCalibrationProfileV1={scope,scope_digest:digest(scope),source_digest:digest('known-measured-profile'),source_run_id:f.run.id,
  source_call_ids:Array.from({length:32},()=>randomUUID()),sample_count:32,request_min_bytes:bytes,request_max_bytes:bytes,max_input_tokens_per_byte:.25,status:'measured'};
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(k=>process.env[k]);
 try{
  names.forEach(k=>process.env[k]='true');const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,
   execution:{...execution,window_size:2,max_buffered_bytes:2*1024**3},preflight:async()=>{},calibration:{load:async()=>profile,derive:async()=>{throw Error('no warmup needed');}}});
  assert.equal(outcome.status,'completed');assert.equal(f.requests.length,corpus.length);assert.equal(f.calls.length,corpus.length);
  assert.equal(new Set(f.calls.map(c=>c.inputs[0]!.root_id)).size,corpus.length);
  assert.ok(f.calls.every(c=>c.status==='settled'&&c.results_applied&&durable.has(c.id)&&c.raw_body===null));
  assert.ok(reads.length>1);assert.equal(reads[0]!.max_rows,2);assert.equal(reads[0]!.max_working_bytes,LABELING_INPUT_MAX_WORKING_BYTES_V1);
  assert.equal(reads[0]!.on_oversize,'error');assert.ok(reads.slice(1).some(r=>r.on_oversize==='empty'));
  assert.ok(reads.every(r=>r.max_rows<=2&&r.max_working_bytes<=LABELING_INPUT_MAX_WORKING_BYTES_V1));
 }finally{names.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});


test('a large metadata quote opts out to the original4096 legacy reader and physically drains its next pending input',async()=>{
 const draft=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 for(let index=draft.questions.length;index<256;index++)draft.questions.push({key:'q'+String(index).padStart(3,'0')+'x'.repeat(60),type:'noul',text:'Pending optional question',
  positive:'Present',negative:'Absent',scope:'all',origin:'brand_os',human_locked:true});
 const configuration=validateSignalListeningConfigurationV1(draft),f=fixture(configuration,[['voice','promotion']]),sample=(await f.store.inputs(f.run))[0]!;
 const corpus=[{...sample,root_id:randomUUID()},{...sample,root_id:randomUUID()}],reads:Array<{max_rows:number;max_working_bytes:number}>=[];
 const capacity={...execution,window_size:4096,max_buffered_bytes:512*1024*1024};
 assert.ok(signalListeningInputSurveyStorageBoundV1(f.run,4096)>capacity.max_buffered_bytes,'the additive metadata acceleration itself cannot fit');
 let first=true,surveys=0;
 f.store.withInputSurvey=async()=>{surveys++;throw Error('oversized metadata must never be allocated or silently shrink4096');};
 f.store.inputs=async(_run,bounds)=>{
  assert.ok(bounds);reads.push({...bounds});const pending=corpus.filter(input=>!f.calls.some(call=>call.inputs[0]!.root_id===input.root_id));
  const count=first?1:bounds.max_rows;first=false;return pending.slice(0,count);
 };
 f.store.finish=async()=>{const status=f.results.length===2?'completed' as const:'running' as const;f.run.status=status;return status;};
 const shape=signalListeningCalibrationShapeV1(configuration,sample),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(sample,configuration))),
  scope={workspace_id:f.run.workspace_id,configuration_digest:digest(configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest};
 const profile:SignalListeningCalibrationProfileV1={scope,scope_digest:digest(scope),source_digest:digest('known-large-config-profile'),source_run_id:f.run.id,
  source_call_ids:Array.from({length:32},()=>randomUUID()),sample_count:32,request_min_bytes:bytes,request_max_bytes:bytes,max_input_tokens_per_byte:.25,status:'measured'};
 const database={query:async(sql:string)=>({rows:sql.includes('signal_workspace_features')?[{enabled:true}]:[{workspace_id:f.run.workspace_id,labeler_digest:f.run.labeler_digest,recovery_only:false}]})}as NonNullable<Parameters<typeof signalListeningJevJobV1>[1]>['database'];
 const names=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED']as const,previous=names.map(key=>process.env[key]);
 try{
  names.forEach(key=>process.env[key]='true');const outcome=await signalListeningJevJobV1(f.run.id,{database,store:f.store,provider:f.provider,execution:capacity,preflight:async()=>{},
   calibration:{load:async()=>profile,derive:async()=>{throw Error('no bootstrap needed');}}});
  assert.equal(outcome.status,'completed');assert.equal(surveys,0);assert.equal(f.requests.length,2);assert.equal(f.results.length,2);
  assert.equal(new Set(f.calls.map(call=>call.inputs[0]!.root_id)).size,2);assert.ok(f.calls.every(call=>call.results_applied&&call.status==='settled'));
  assert.ok(reads.length>=2);assert.equal(reads[0]!.max_rows,4096);assert.equal(reads[1]!.max_rows,4096,'the continuous fallback preserves the original complete window');
  assert.ok(reads.every(bounds=>bounds.max_rows<=4096&&bounds.max_working_bytes<=LABELING_INPUT_MAX_WORKING_BYTES_V1));
 }finally{names.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
});
