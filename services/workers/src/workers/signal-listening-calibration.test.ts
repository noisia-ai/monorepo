import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildSignalListeningJevRequestV1,signalListeningBaseTemplateV1,signalListeningCalibrationShapeV1,
  signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
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
test('a missing profile bootstraps at most32 roots on one slot with fixed official quota and reusable ordinary requests',async()=>{
  const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>null});
  assert.equal(plan.warmup,true);assert.equal(plan.execution.window_size,32);assert.equal(plan.execution.max_in_flight,1);
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
    assert.equal(peak,1);assert.deepEqual(requests,['I drink tea','I drink tea','I drink tea']);
    assert.equal(raw[0]!.rate_reservation?.estimated_input_tokens,65536);
    await Promise.all(raw.map(value=>runtime.provider.observeUsage!(value,100)));assert.equal(observations,3);
    const calibration=Object.values(calibrations[0]as Record<string,{kind:string;fixed_input_tokens:number}>)[0]!;
    assert.equal(calibration.kind,'official_context_bound');assert.equal(calibration.fixed_input_tokens,65536);
    assert.equal(env.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON,'untouched-old-profile');
  }finally{await runtime.provider.close?.();}
});
test('only an exact ledger profile and covered request bytes unlock configured concurrency; new configurations bootstrap',async()=>{
  const f=fixture(),plan=await planSignalListeningCalibrationV1({...f,inputs:[f.input],execution,loadProfile:async()=>f.profile});
  assert.equal(plan.warmup,false);assert.equal(plan.execution.max_in_flight,1024);assert.equal(plan.execution.window_size,4096);
  const outside=await planSignalListeningCalibrationV1({...f,inputs:[{...f.input,text:'I drink tea '.repeat(200)}],execution,loadProfile:async()=>f.profile});
  assert.equal(outside.warmup,true);assert.equal(outside.execution.max_in_flight,1);
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
 assert.equal(plan.warmup,true);assert.equal(plan.execution.max_in_flight,1);assert.ok([...plan.profiles.values()].every(p=>p===null));
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
