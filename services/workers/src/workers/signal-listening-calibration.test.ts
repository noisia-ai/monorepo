import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildSignalListeningJevRequestV1,signalListeningBaseTemplateV1,signalListeningCalibrationShapeV1,
  signalWorkspaceEmbeddingDigestV1 as digest,validateSignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {planSignalListeningCalibrationV1,createSignalListeningCalibratedProviderV1} from './signal-listening-calibration';
const execution={max_in_flight:1024,flush_size:1024,max_flushes:2,max_buffered_bytes:256*1024*1024,flush_interval_ms:250,window_size:4096};
function fixture(){
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),workspace_id=randomUUID(),configuration_digest=digest(configuration);
  const input={root_id:randomUUID(),input_digest:digest('input'),text:'I drink tea',title:null,platform:null,content_type:null,author:null,
    published_at:'2026-01-01T00:00:00Z',language:'en',map_id:randomUUID(),question_keys:['voice','promotion'],question_digests:{},scope_basis:{},configuration_digest}as SignalListeningInputV1;
  const shape=signalListeningCalibrationShapeV1(configuration,input),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(input,configuration)));
  const profile:SignalListeningCalibrationProfileV1={scope:{workspace_id,configuration_digest,model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest},
    scope_digest:digest('profile-scope'),source_digest:digest('receipts'),source_call_ids:[randomUUID()],source_run_id:randomUUID(),request_min_bytes:bytes,
    request_max_bytes:bytes+100,max_input_tokens_per_byte:.25,sample_count:1,status:'measured'};
  return{configuration,workspace_id,configuration_digest,input,profile};
}
test('explicit validated compiler measures persisted whitespace/UTF8 bytes; the default H2 compiler remains unchanged',async()=>{
 const f=fixture(),input={...f.input,text:'I drink té ☕'},compiled=buildSignalListeningJevRequestV1(input,f.configuration);
 const exact={...compiled,questions:Object.fromEntries(Object.entries(compiled.questions).map(([key,q])=>[key,{...q,instructions:{rules:'  Persisted UTF8 té ☕ rules with trailing spaces  ',question:'  Frozen question  '}}]))};
 const exactBytes=Buffer.byteLength(JSON.stringify(exact)),profile={...f.profile,request_min_bytes:exactBytes,request_max_bytes:exactBytes};
 let compilations=0;const custom=await planSignalListeningCalibrationV1({...f,inputs:[input],execution,loadProfile:async()=>profile,compile_request:value=>{assert.equal(value,input);compilations++;return exact;}});
 assert.equal(custom.warmup,false);assert.equal(custom.execution.max_in_flight,1024);assert.equal(compilations,1);
 const implicit=await planSignalListeningCalibrationV1({...f,inputs:[input],execution,loadProfile:async()=>profile});
 assert.equal(implicit.warmup,true,'default compiler cannot claim the different persisted byte coverage');
 assert.deepEqual(buildSignalListeningJevRequestV1(input,f.configuration),compiled);
 let reads=0;await assert.rejects(planSignalListeningCalibrationV1({...f,inputs:[input],execution,loadProfile:async()=>{reads++;return profile;},compile_request:'invalid' as never}),/compiler_invalid/);assert.equal(reads,0);
 await assert.rejects(planSignalListeningCalibrationV1({...f,inputs:[input],execution,loadProfile:async()=>profile,compile_request:()=>({...exact,state:'different source'})}),/compiler_invalid/);
});
test('a missing profile bootstraps at most32 roots with bounded slots, fixed official quota and reusable ordinary requests',async()=>{
  const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>null});
  assert.equal(plan.warmup,true);assert.equal(plan.execution.window_size,32);assert.equal(plan.execution.max_in_flight,32);
  const env={TYPESAFE_API_KEY:'synthetic',NOISIA_TYPESAFE_ACCOUNT_ID:'synthetic-account',NOISIA_TYPESAFE_ACCOUNT_RPS:'80',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'100000',NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:'untouched-old-profile'};
  const calibrations:unknown[]=[],requests:string[]=[];let active=0,peak=0,observations=0;
  const runtime=createSignalListeningCalibratedProviderV1({plan,env,factory:args=>{
    calibrations.push(JSON.parse(args.env!.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON!));
    return createCalibratedJevRuntimeProviderV2({...args,evaluateRedis:async(_script,_keys,values)=>{
      if(values[0]==='observe')observations++;
      return ['acquire','observe','throttle'].includes(values[0]!)?[1,0]:'9999';},
      fetch:async(_url,options)=>{
        active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));
        const request=JSON.parse(String(options?.body));requests.push(request.state);
        assert.equal((options?.headers as Record<string,string>)['TypeSafe-Danger-Zone-Long-Context'],undefined);active--;
        return Response.json({model:request.model,usage:{input_tokens:100,output_tokens:0},answers:{}});
      }});
  }});
  try{
    const request=buildSignalListeningJevRequestV1(f.input,f.configuration),raw=await Promise.all(Array.from({length:3},()=>runtime.provider.evaluate(request)));
    assert.equal(peak,3);assert.deepEqual(requests,['I drink tea','I drink tea','I drink tea']);
    assert.equal(raw[0]!.rate_reservation?.estimated_input_tokens,65536);
    await Promise.all(raw.map(value=>runtime.provider.observeUsage!(value,100)));assert.equal(observations,3);
    const calibration=Object.values(calibrations[0]as Record<string,{kind:string;fixed_input_tokens:number}>)[0]!;
    assert.equal(calibration.kind,'official_context_bound');assert.equal(calibration.fixed_input_tokens,65536);
    assert.equal(env.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON,'untouched-old-profile');
  }finally{await runtime.provider.close?.();}
});
test('only an exact ledger profile and covered request bytes unlock full configured concurrency; new configurations bootstrap',async()=>{
  const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.profile});
  assert.equal(plan.warmup,false);assert.equal(plan.execution.max_in_flight,1024);assert.equal(plan.execution.window_size,4096);
  const outside=await planSignalListeningCalibrationV1({...f,inputs:[{...f.input,text:'I drink tea '.repeat(200)}],execution,loadProfile:async()=>f.profile});
  assert.equal(outside.warmup,true);assert.equal(outside.execution.max_in_flight,32);
  const edited={...f.configuration,instructions:f.configuration.instructions+' New rule.'};
  const changed=await planSignalListeningCalibrationV1({...f,configuration:edited,configuration_digest:digest(edited),inputs:[{...f.input,configuration_digest:digest(edited)}],execution,loadProfile:async()=>null});
  assert.equal(changed.warmup,true);
  for(const bad of [{scope:{...f.profile.scope,workspace_id:randomUUID()}},{scope:{...f.profile.scope,configuration_digest:digest('other')}},
    {sample_count:0},{source_call_ids:[]},{request_min_bytes:0}])
    await assert.rejects(planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>({...f.profile,...bad})}),/listening_calibration_profile_invalid/);
});

test('a partial finite profile does not unlock concurrency for a newly expanded32-root phase',async()=>{
 const f=fixture();
 const plan=await planSignalListeningCalibrationV1({...f,inputs:Array.from({length:32},()=>({...f.input,root_id:randomUUID()})),execution,loadProfile:async()=>f.profile});
 assert.equal(plan.warmup,true);assert.equal(plan.execution.max_in_flight,32);assert.ok([...plan.profiles.values()].every(p=>p===null));
 const partial={...f.profile,sample_count:20,source_call_ids:Array.from({length:20},()=>randomUUID())};
 const remaining=await planSignalListeningCalibrationV1({...f,inputs:Array.from({length:12},()=>({...f.input,root_id:randomUUID()})),execution,loadProfile:async()=>partial});
 assert.equal(remaining.warmup,true,'a partial profile plus remaining roots must finish the32-receipt phase');
 const full={...f.profile,sample_count:32,source_call_ids:Array.from({length:32},()=>randomUUID())};
 const measured=await planSignalListeningCalibrationV1({...f,inputs:Array.from({length:32},()=>({...f.input,root_id:randomUUID()})),execution,loadProfile:async()=>full});
 assert.equal(measured.warmup,false);assert.equal(measured.execution.max_in_flight,1024);
});
test('warmup selects an outlier at33 and pending byte extrema instead of a covered prefix',async()=>{
 const f=fixture(),inputs=Array.from({length:80},(_,i)=>({...f.input,root_id:`root-${i}`}));
 inputs[32]!.text='x'.repeat(600);inputs[60]!.text='x'.repeat(1000);inputs[70]!.text='a';
 const plan=await planSignalListeningCalibrationV1({...f,inputs,execution,loadProfile:async()=>({...f.profile,sample_count:32,source_call_ids:Array.from({length:32},()=>randomUUID())})});
 assert.equal(plan.warmup,true);assert.equal(plan.selected_inputs.length,32);
 for(const index of [32,60,70])assert.ok(plan.selected_inputs.some(input=>input.root_id===inputs[index]!.root_id));
 assert.equal(plan.calibration_shapes.length,1);
 const cachedRemoved=await planSignalListeningCalibrationV1({...f,inputs:inputs.filter((_,i)=>![32,60,70].includes(i)),execution,
  loadProfile:async()=>({...f.profile,sample_count:32,source_call_ids:Array.from({length:32},()=>randomUUID())})});
 assert.equal(cachedRemoved.warmup,false);assert.equal(cachedRemoved.calibration_shapes.length,0,'covered batches retain their measured coverage instead of replacing it with latest32');
});

test('continuous preflight reuses only original measured shapes and byte coverage without creating clients for an unseen shape',async()=>{
 const f=fixture(),profile={...f.profile,sample_count:32,source_call_ids:Array.from({length:32},()=>randomUUID())};
 const plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>profile});let clients=0;
 const runtime=createSignalListeningCalibratedProviderV1({plan,factory:()=>{clients++;return{evaluate:async()=>{throw Error('no HTTP in preflight');}};}});
 const request=buildSignalListeningJevRequestV1(f.input,f.configuration);
 runtime.prepareRequests([request]);assert.equal(clients,1);
 assert.equal(runtime.prepareMeasuredRequests([request]),true);
 assert.equal(runtime.prepareMeasuredRequests([{...request,state:'x'.repeat(10000)}]),false);
 assert.equal(runtime.prepareMeasuredRequests([{...request,questions:{voice:request.questions.voice!}}]),false);
 assert.equal(clients,1,'rejected next-page inputs cannot prepare new transport shapes');
 const finite=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.profile});
 assert.equal(createSignalListeningCalibratedProviderV1({plan:finite,factory:()=>{throw Error('finite profile cannot prefetch');}}).prepareMeasuredRequests([request]),false);
 const warmup=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>null});
 assert.equal(createSignalListeningCalibratedProviderV1({plan:warmup,factory:()=>{throw Error('no warmup prefetch');}}).prepareMeasuredRequests([request]),false);
});

 test('official warmup permits bounded parallel ordinary requests without fabricating a measured profile',async()=>{
 const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:Array.from({length:40},()=>({...f.input,root_id:randomUUID()})),execution,loadProfile:async()=>null});
 assert.equal(plan.execution.max_in_flight,32);assert.equal(plan.selected_inputs.length,32);assert.ok([...plan.profiles.values()].every(value=>value===null));
 let active=0,peak=0;
 const runtime=createSignalListeningCalibratedProviderV1({plan,env:{TYPESAFE_API_KEY:'synthetic',NOISIA_TYPESAFE_ACCOUNT_ID:'test',NOISIA_TYPESAFE_ACCOUNT_RPS:'80',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'3000000'},
 factory:args=>createCalibratedJevRuntimeProviderV2({...args,evaluateRedis:async(_s,_k,v)=>{return[1,0];},
 fetch:async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json({model:f.configuration.model,usage:{input_tokens:100,output_tokens:0},answers:{}});}})});
 try{const raws=await Promise.all(plan.selected_inputs.map(input=>runtime.provider.evaluate(buildSignalListeningJevRequestV1(input,f.configuration))));
 assert.ok(peak>=2);assert.ok(peak<=32);assert.ok(raws.every(raw=>raw.rate_reservation?.estimated_input_tokens===65536));
 assert.ok(raws.every(raw=>(raw.rate_calibration as {kind?:string})?.kind==='official_context_bound'));assert.ok([...plan.profiles.values()].every(value=>value===null));
 }finally{await runtime.provider.close?.();}
});

test('parallel warmup charges retained requests and the entire raw codec envelope before choosing slots',async()=>{
 const f=fixture(),inputs=Array.from({length:32},()=>({...f.input,root_id:randomUUID()}));
 const small=await planSignalListeningCalibrationV1({...f,inputs,execution:{...execution,max_buffered_bytes:2*1024*1024},loadProfile:async()=>null});
 assert.ok(small.execution.max_in_flight>=1);assert.ok(small.execution.max_in_flight<32);
 assert.equal(small.selected_inputs.length,32,'memory cannot silently drop the preselected sample');
 await assert.rejects(planSignalListeningCalibrationV1({...f,inputs,execution:{...execution,max_buffered_bytes:458752},loadProfile:async()=>null}),/selection_memory_bound/);
});

test('closing a parallel warmup drains handed-off siblings and rejects new physical attempts',async()=>{
 const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>null});
 let release!:()=>void,closed=0,physical=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 const runtime=createSignalListeningCalibratedProviderV1({plan,factory:()=>({async evaluate(){physical++;await gate;return{body:'{}',http_status:200,latency_ms:1};},async close(){closed++;}})});
 const request=buildSignalListeningJevRequestV1(f.input,f.configuration),pending=runtime.provider.evaluate(request);
 const closing=runtime.provider.close!();await assert.rejects(runtime.provider.evaluate(request),/listening_provider_closed/);
 assert.equal(physical,1);assert.equal(closed,0);release();await pending;await closing;assert.equal(closed,1);
});

function prefetchFixture(){
 const f=fixture(),configuration=validateSignalListeningConfigurationV1({...f.configuration,questions:[...f.configuration.questions,{key:'consumer_topic',type:'noul' as const,
  text:'Does the consumer discuss tea?',positive:'Consumer tea',negative:'Other discussion',scope:'consumer_category' as const,
  origin:'brand_os' as const,human_locked:true,topic_source:'defined' as const}]});
 const configuration_digest=digest(configuration),input={...f.input,configuration_digest},next={...input,question_keys:['consumer_topic']};
 const profile=(value:SignalListeningInputV1):SignalListeningCalibrationProfileV1=>{
  const shape=signalListeningCalibrationShapeV1(configuration,value),bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(value,configuration)));
  return{...f.profile,scope:{...f.profile.scope,configuration_digest,shape_digest:shape.shape_digest,phase:shape.phase},
   scope_digest:digest(shape),source_digest:digest(['verified',shape.shape_digest]),source_call_ids:Array.from({length:32},()=>randomUUID()),
   request_min_bytes:bytes,request_max_bytes:bytes+100,sample_count:32};
 };
 return{...f,configuration,configuration_digest,input,next,base:profile(input),consumer:profile(next)};
}
test('prefetch may extend an absent shape only from its existing valid measured profile without changing requests or execution',async()=>{
 const f=prefetchFixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.base});
 const request=buildSignalListeningJevRequestV1(f.next,f.configuration),before=JSON.stringify(request),bounds={execution:{...plan.execution},response:plan.response_bound_bytes};
 let clients=0,loads=0;const runtime=createSignalListeningCalibratedProviderV1({plan,factory:()=>{clients++;throw Error('preflight cannot create a transport');}});
 assert.equal(plan.profiles.has(f.consumer.scope.shape_digest),false);assert.equal(runtime.prepareMeasuredRequests([request]),false);
 assert.equal(await runtime.prepareMeasuredRequestsWithProfiles([request,request],async id=>{loads++;assert.equal(id,f.consumer.scope.shape_digest);return f.consumer;}),true);
 assert.equal(loads,1);assert.equal(clients,0);assert.equal(plan.profiles.get(f.consumer.scope.shape_digest)?.source_digest,f.consumer.source_digest);
 assert.deepEqual(plan.profiles.get(f.consumer.scope.shape_digest)?.source_call_ids,f.consumer.source_call_ids);
 assert.equal(runtime.prepareMeasuredRequests([request]),true);assert.equal(JSON.stringify(request),before);
 assert.deepEqual({execution:plan.execution,response:plan.response_bound_bytes},bounds);
});
test('prefetch extension rejects missing, finite, uncovered or larger responses atomically and never upgrades a warmup',async()=>{
 const f=prefetchFixture(),request=buildSignalListeningJevRequestV1(f.next,f.configuration);
 const make=async()=>{const plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.base});
  return{plan,runtime:createSignalListeningCalibratedProviderV1({plan,factory:()=>{throw Error('no preflight HTTP');}})};};
 for(const profile of [null,{...f.consumer,sample_count:31,source_call_ids:f.consumer.source_call_ids.slice(0,31)},
  {...f.consumer,request_max_bytes:f.consumer.request_min_bytes-1,request_min_bytes:1}]){
  const {plan,runtime}=await make();assert.equal(await runtime.prepareMeasuredRequestsWithProfiles([request],async()=>profile),false);
  assert.equal(plan.profiles.has(f.consumer.scope.shape_digest),false);
 }
 const {plan,runtime}=await make();assert.equal(await runtime.prepareMeasuredRequestsWithProfiles([request,{...request,state:'outside '.repeat(300)}],async()=>f.consumer),false);
 assert.equal(plan.profiles.has(f.consumer.scope.shape_digest),false,'a later out-of-coverage request cannot partially extend the Map');
 const wide={...request,questions:{consumer_topic:{type:'choice' as const,instructions:request.questions.consumer_topic!.instructions,criteria:Object.fromEntries(Array.from({length:64},(_,i)=>['key_'+i+'x'.repeat(150),'criterion']))}}};
 let loads=0;assert.equal(await runtime.prepareMeasuredRequestsWithProfiles([wide],async()=>{loads++;return f.consumer;}),false);assert.equal(loads,0);assert.equal(plan.response_bound_bytes,16384);
 const bounded=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution:{...execution,window_size:1},loadProfile:async()=>f.base});
 assert.equal(await createSignalListeningCalibratedProviderV1({plan:bounded}).prepareMeasuredRequestsWithProfiles([request],async()=>{throw Error('profile metadata must stay bounded by the original window');}),false);
 assert.equal(bounded.profiles.size,1);
 const warm=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>null});
 assert.equal(await createSignalListeningCalibratedProviderV1({plan:warm}).prepareMeasuredRequestsWithProfiles([request],async()=>{throw Error('warmup cannot load a prefetch profile');}),false);
});
test('prefetch propagates authority failures and rejects foreign or malformed ledger profiles without storing them',async()=>{
 const f=prefetchFixture(),request=buildSignalListeningJevRequestV1(f.next,f.configuration);
 const make=async()=>{const plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.base});return{plan,runtime:createSignalListeningCalibratedProviderV1({plan})};};
 const denied=await make();await assert.rejects(denied.runtime.prepareMeasuredRequestsWithProfiles([request],async()=>{throw Error('listening_forbidden');}),/listening_forbidden/);
 for(const bad of [{scope:{...f.consumer.scope,workspace_id:randomUUID()}},{scope:{...f.consumer.scope,configuration_digest:digest('other')}},
  {scope:{...f.consumer.scope,model:'other'}},{scope:{...f.consumer.scope,compiler_version:'other' as never}},
  {scope:{...f.consumer.scope,phase:'base' as const}},{scope:{...f.consumer.scope,shape_digest:digest('other')}},
  {source_digest:'invalid'},{source_call_ids:Array(32).fill(f.consumer.source_call_ids[0])}]){
  const {plan,runtime}=await make();await assert.rejects(runtime.prepareMeasuredRequestsWithProfiles([request],async()=>({...f.consumer,...bad})),/listening_calibration_profile_invalid/);
  assert.equal(plan.profiles.has(f.consumer.scope.shape_digest),false);
 }
 const context=await make();await assert.rejects(context.runtime.prepareMeasuredRequestsWithProfiles([request],async()=>({...f.consumer,max_input_tokens_per_byte:1000})),/context_estimate_exceeded/);
 assert.equal(context.plan.profiles.has(f.consumer.scope.shape_digest),false);
});
