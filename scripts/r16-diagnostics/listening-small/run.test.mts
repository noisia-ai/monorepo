import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertCpuProfilerArgsV1,assertListeningSmallGuardV1,captureCalibrationObservationV1,classificationClockMetadataV1,
  assertListeningResourceProfileV1,listeningResourceProfileV1,cpuProfileIdentityV1,cpuProfileMetadataV1,cpuProfileRangeV1,createJevHttpTokenWitnessV1,
  runListeningSmallDiagnosticV1,tokenCalibrationKindFromEnvV1,diagnosticModeV1,assertDiagnosticExecArgsV1} from './run.mjs';

async function streamProfileDependencies(){
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'resource profile contract needs checked out public target root');
 const runtime=await import(pathToFileURL(join(target,'services/workers/src/providers/jev-streaming-runtime.ts')).href) as any;
 const envFor=(profile:'baseline_512m'|'bounded_2g'):NodeJS.ProcessEnv=>({NOISIA_JEV_STREAMING_V2_ENABLED:'true',
  NOISIA_JEV_STREAM_MAX_IN_FLIGHT:profile==='baseline_512m'?'1024':'4096',
  NOISIA_JEV_STREAM_BUFFER_BYTES:profile==='baseline_512m'?'536870912':'2147483648',
  NOISIA_JEV_STREAM_FLUSH_SIZE:profile==='baseline_512m'?'1024':'4096',NOISIA_JEV_STREAM_MAX_FLUSHES:'2',
  NOISIA_JEV_STREAM_FLUSH_INTERVAL_MS:profile==='baseline_512m'?'250':'1000',NOISIA_JEV_STREAM_WINDOW_SIZE:'4096'});
 return{getExecution:runtime.jevStreamingExecutionFromEnvV2,envFor};
}

test('default resource profile resolves through the product getter to the baseline tuple',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();
 assert.equal(listeningResourceProfileV1({},'legacy'),'baseline_512m');
 const env=envFor('baseline_512m');
 assert.deepEqual(assertListeningResourceProfileV1('baseline_512m','legacy',env,getExecution),
  {max_in_flight:1024,max_buffered_bytes:536870912,flush_size:1024,max_flushes:2,flush_interval_ms:250,window_size:4096});
});

test('bounded resource profile resolves through the product getter only for neutral modes',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();
 const env={...envFor('bounded_2g'),R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g'};
 assert.equal(listeningResourceProfileV1(env,'neutral_only'),'bounded_2g');
 assert.deepEqual(assertListeningResourceProfileV1('bounded_2g','neutral_only',env,getExecution),
  {max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096});
 assert.equal(listeningResourceProfileV1(env,'sql_frontier_only'),'bounded_2g');
 assert.deepEqual(assertListeningResourceProfileV1('bounded_2g','sql_frontier_only',env,getExecution),
  {max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096});
});

test('resource profile selection rejects unknown names and bounded mode outside neutral runs',()=>{
 assert.throws(()=>listeningResourceProfileV1({R16_DIAGNOSTIC_RESOURCE_PROFILE:'surprise'},'neutral_only'),/resource_profile_invalid/u);
 assert.throws(()=>listeningResourceProfileV1({R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g'},'legacy'),/resource_profile_requires_neutral_mode/u);
});

test('resource profile workflow Bash gate allows manual SQL frontier shared smoke and preserves other mode gates',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const stepStart=workflow.indexOf('      - name: Validate resource profile selection');assert.ok(stepStart>=0,'resource profile validation step must exist');
 const nextStep=workflow.indexOf('      - name: ',stepStart+'      - name: Validate resource profile selection'.length);
 const step=workflow.slice(stepStart,nextStep<0?undefined:nextStep).split(/\r?\n/u);
 const runLine=step.findIndex(line=>line==='        run: |');assert.ok(runLine>=0,'resource profile validation must remain an inline Bash step');
 const body:string[]=[];
 for(const line of step.slice(runLine+1)){
  if(line===''){body.push('');continue;}
  if(!line.startsWith('          '))break;
  body.push(line.slice(10));
 }
 const script=body.join('\n').trimEnd();assert.ok(script.includes('reserve_shared_smoke requires a manual neutral_only or sql_frontier_only run'));
 const sha='a'.repeat(40);
 const run=(mode:string,profile:string,smoke:boolean,event:string,targetRef=sha)=>spawnSync('/bin/bash',['-euo','pipefail','-c',script],{
  encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',MODE:mode,RESOURCE_PROFILE:profile,
   RESERVE_SHARED_SMOKE:String(smoke),EVENT_NAME:event,TARGET_REF:targetRef}});
 const cases:[string,string,string,boolean,string,string,boolean][]=[
  ['SQL frontier bounded profile with shared smoke','sql_frontier_only','bounded_2g',true,'workflow_dispatch',sha,true],
  ['neutral bounded profile with shared smoke','neutral_only','bounded_2g',true,'workflow_dispatch','',true],
  ['legacy shared smoke remains rejected','legacy','baseline_512m',true,'workflow_dispatch','',false],
  ['SQL shared smoke remains manual-only','sql_frontier_only','baseline_512m',true,'pull_request',sha,false],
  ['neutral shared smoke remains manual-only','neutral_only','baseline_512m',true,'pull_request','',false],
  ['SQL mode rejects a missing explicit target','sql_frontier_only','baseline_512m',false,'workflow_dispatch','',false],
  ['SQL mode rejects a malformed explicit target','sql_frontier_only','baseline_512m',false,'workflow_dispatch','A'.repeat(40),false],
  ['legacy baseline without shared smoke remains unchanged','legacy','baseline_512m',false,'pull_request','',true],
 ];
 for(const [label,mode,profile,smoke,event,targetRef,expectedPass] of cases){
  const result=run(mode,profile,smoke,event,targetRef);
  assert.equal(result.status,expectedPass?0:1,`${label}: ${result.stderr||result.stdout}`);
 }
});

test('resource profile guard rejects environment and effective tuple drift without allocating the profile budget',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();const env=envFor('baseline_512m');
 env.NOISIA_JEV_STREAM_MAX_IN_FLIGHT='2048';
 assert.throws(()=>assertListeningResourceProfileV1('baseline_512m','legacy',env,getExecution),/stream_environment_profile_mismatch/u);
 const correct=envFor('baseline_512m');
 assert.throws(()=>assertListeningResourceProfileV1('baseline_512m','legacy',correct,current=>({...getExecution(current),max_in_flight:2048})),/stream_execution_profile_mismatch/u);
});

test('diagnostic CLI has no database side effect without explicit run flag',async()=>{
  assert.doesNotThrow(()=>assertListeningSmallGuardV1({},[]));
  assert.deepEqual(await runListeningSmallDiagnosticV1(),{
    diagnostic_only:true,h1_accepted:false,status:'no_database_action',
  });
});

test('diagnostic run requires real GitHub Actions and explicit opt-in',()=>{
  assert.throws(()=>assertListeningSmallGuardV1({},['--run']),/diagnostic_requires_github_actions/u);
  assert.throws(()=>assertListeningSmallGuardV1({GITHUB_ACTIONS:'true'},['--run']),/diagnostic_opt_in_required/u);
});

test('diagnostic run rejects provider credentials before any target access',()=>{
  const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',TYPESAFE_API_KEY:'unexpected'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
  delete env.TYPESAFE_API_KEY;
  env.NOISIA_R16_SONNET_API_KEY='unexpected';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
});

test('diagnostic run binds target and artifact to this workflow workspace',()=>{
  const env={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',GITHUB_WORKSPACE:'/tmp/work',
    R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
    R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'b'.repeat(40),
    R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/evil/result.json',
    R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_CPU_PROFILE_DIR:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate',
    DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',
    R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/artifact_path_not_bound/u);
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/target';
  env.R16_DIAGNOSTIC_ARTIFACT='/tmp/work/artifacts/r16-listening-small/result.json';
  assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
  env.R16_DIAGNOSTIC_CPU_PROFILE_DIR='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/cpu_profile_path_not_bound/u);
  env.R16_DIAGNOSTIC_CPU_PROFILE_DIR='/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate';
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/target_root_outside_workspace/u);
});

test('SQL frontier mode is manual candidate-only with an explicit immutable target ref and no profiler',()=>{
 assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'sql_frontier_only'}),'sql_frontier_only');
 assert.doesNotThrow(()=>assertDiagnosticExecArgsV1('sql_frontier_only',['--import','tsx'],'/unused'));
 assert.throws(()=>assertDiagnosticExecArgsV1('sql_frontier_only',['--cpu-prof'],'/unused'),/profiler_forbidden/u);
 const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',NOISIA_R16_SMALL_DIAGNOSTIC:'true',
  R16_DIAGNOSTIC_MODE:'sql_frontier_only',R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'c'.repeat(40),
  GITHUB_WORKSPACE:'/tmp/work',R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
  R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'b'.repeat(40),R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/artifacts/r16-listening-small/result.json',
  R16_DIAGNOSTIC_CPU_PROFILE_DIR:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate',
  DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
 assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
 assert.throws(()=>assertListeningSmallGuardV1({...env,GITHUB_EVENT_NAME:'pull_request'},['--run']),/sql_frontier_requires_manual_dispatch/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,R16_DIAGNOSTIC_TARGET_LABEL:'baseline-32f'},['--run']),/sql_frontier_requires_candidate_target/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,R16_DIAGNOSTIC_TARGET_REF_REQUESTED:''},['--run']),/target_ref_required/u);
});

test('CPU profile metadata is PID-scoped, bounded to CPU sampling, and records classification clocks',()=>{
 const execArgs=['--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir=/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate','--import','tsx'];
 assert.doesNotThrow(()=>assertCpuProfilerArgsV1(execArgs,'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'));
 assert.throws(()=>assertCpuProfilerArgsV1(execArgs.filter(arg=>arg!=='--cpu-prof'),'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'),/cpu_profile_not_enabled/u);
 assert.throws(()=>assertCpuProfilerArgsV1([...execArgs,'--heap-prof'],'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'),/heap_profile_forbidden/u);
 const clock=classificationClockMetadataV1({hrtime_origin_ns:'500000',start_hrtime_ns:'501000',end_hrtime_ns:'601000',
   performance_time_origin_ms:1_700_000_000_000,start_performance_ms:1,end_performance_ms:101});
 assert.deepEqual(clock,{clock_axis:'linux_runner_node_hrtime_monotonic_ns',runner_hrtime_origin_ns:'500000',
   classification_start_hrtime_ns:'501000',classification_end_hrtime_ns:'601000',performance_time_origin_ms:1_700_000_000_000,
   classification_start_performance_ms:1,classification_end_performance_ms:101,v8_profile_clock_bridge:'unknown',
   classification_profile_overlap:'unknown_no_cross_clock_truncation'});
 assert.deepEqual(cpuProfileMetadataV1({main_pid:12,sampler_pid:13,clock,exec_args:execArgs,
   profile_dir:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'}),{
  enabled:true,profiler:'node_cpu_prof',interval_us:1000,main_process_pid:12,sampler_process_pid:13,
  clock,output:'pid_scoped_cpu_profiles_only',
  heap_profile:false,source_text_embedded:false,overhead_measured:false,capacity_claim:false,
 });
 assert.throws(()=>classificationClockMetadataV1({hrtime_origin_ns:'500000',start_hrtime_ns:'601000',end_hrtime_ns:'501000',
   performance_time_origin_ms:1_700_000_000_000,start_performance_ms:101,end_performance_ms:1}),/classification_clock_invalid/u);
});

test('CPU profiles admit bounded worker threads only for the recorded PIDs and validate V8 time coverage',()=>{
 assert.deepEqual(cpuProfileIdentityV1('CPU.20261115.123456.12.0.0.cpuprofile',12,13),
   {filename:'CPU.20261115.123456.12.0.0.cpuprofile',pid:12,tid:0,sequence:0,role:'runner'});
 assert.equal(cpuProfileIdentityV1('CPU.20261115.123456.12.2.0.cpuprofile',12,13).role,'runner_worker_thread');
 assert.equal(cpuProfileIdentityV1('CPU.20261115.123456.13.1.0.cpuprofile',12,13).role,'sampler_worker_thread');
 assert.throws(()=>cpuProfileIdentityV1('CPU.20261115.123456.99.0.0.cpuprofile',12,13),/foreign_process/u);
 const range=cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1000,1000],startTime:1_000_000,endTime:1_002_000});
 assert.deepEqual(range,{profile_start_time_us:1_000_000,profile_end_time_us:1_002_000,profile_duration_us:2000,
   sampled_time_delta_us:2000,profile_sample_coverage:'v8_range_validated'});
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1],timeDeltas:[1000],startTime:5,endTime:5}),/time_range_invalid/u);
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1000],startTime:1_000_000,endTime:1_002_000}),/delta_count_mismatch/u);
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1_000_000,1_000_000],startTime:1_000_000,endTime:1_002_000}),/does_not_cover_samples/u);
});

test('synthetic HTTP witness correlates evaluate admission to fetches and keeps token evidence value-free',async()=>{
 const configuredEnv={NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({synthetic_digest:{kind:'measured',source:'private calibration source'}})};
 assert.equal(tokenCalibrationKindFromEnvV1(configuredEnv),'measured');
 assert.equal(tokenCalibrationKindFromEnvV1({NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:'{}'}),null);
 assert.equal(tokenCalibrationKindFromEnvV1({NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({a:{kind:'measured'},b:{kind:'official_context_bound'}})}),null);
 let fakeFetches=0;
 const witness=createJevHttpTokenWitnessV1(()=>performance.now(),32);
 const fakeFetch=witness.wrapFetch(async()=>{fakeFetches++;await new Promise(resolve=>setTimeout(resolve,8));
  if(fakeFetches===3)throw Error('synthetic private error');return new Response('synthetic response');});
 const raws=[
  {body:'private body A',http_status:200,latency_ms:8,rate_reservation:{id:'private-reservation-a',estimated_input_tokens:302},rate_calibration:{labeler_digest:'private-digest-a',input_bytes:900,kind:'measured'}},
  {body:'private body B',http_status:200,latency_ms:8,rate_reservation:{id:'private-reservation-b',estimated_input_tokens:250},rate_calibration:{labeler_digest:'private-digest-b',input_bytes:700,kind:'measured'}},
 ];
 const lifecycle:string[]=[];
 const originalProvider={max_concurrency:64,max_response_bytes:16384,close:async()=>{lifecycle.push('close');},
  observeUsage:async()=>{lifecycle.push('usage');},async evaluate(request:any){
   if(request.fail){await fakeFetch('https://private.invalid',{body:'private fetch body'});throw Error('synthetic private error');}
   await fakeFetch('https://private.invalid',{body:'private fetch body'});return raws[request.index];
  }};
 const measured=witness.wrapProvider(originalProvider,tokenCalibrationKindFromEnvV1(configuredEnv));
 assert.equal(measured.max_concurrency,64);assert.equal(measured.max_response_bytes,16384);
 const [resultA,resultB]=await Promise.all([measured.evaluate({index:0}),measured.evaluate({index:1})]);
 assert.equal(resultA,raws[0]);assert.equal(resultB,raws[1]);
 await measured.observeUsage?.(resultA as any,241);await measured.close?.();
 const errorProvider=witness.wrapProvider({...originalProvider,async evaluate(){
   await fakeFetch('https://private.invalid',{body:'private fetch body'});throw Error('synthetic private error');
  }},null);
 await assert.rejects(errorProvider.evaluate({fail:true}),/synthetic private error/u);
 const snapshot=witness.snapshot(),serialized=JSON.stringify(snapshot);
 assert.equal(fakeFetches,3);assert.equal(snapshot.evaluations_started,3);assert.equal(snapshot.evaluations_completed,2);
 assert.equal(snapshot.evaluation_errors,1);assert.equal(snapshot.evaluations_without_fetch,0);
 assert.equal(snapshot.fetches_started,3);assert.equal(snapshot.fetches_completed,2);
 assert.equal(snapshot.fetch_errors,1);assert.equal(snapshot.active_fetches,0);assert.equal(snapshot.peak_active_fetches,2);
 assert.equal(snapshot.max_fetch_starts_in_rolling_second,3);assert.equal(snapshot.pre_fetch_admission_ms.count,3);
 assert.equal(snapshot.reservation_estimate.count,2);assert.equal(snapshot.reservation_estimate.missing,0);
 assert.equal(snapshot.reservation_estimate.min,250);assert.equal(snapshot.reservation_estimate.max,302);assert.equal(snapshot.reservation_estimate.total,552);
 assert.equal(snapshot.calibration_kind_counts.measured,2);assert.equal(snapshot.calibration_kind_missing,0);
 assert.equal(snapshot.events.length,9);assert.equal(snapshot.events_dropped,0);assert.deepEqual(lifecycle,['usage','close']);
 const evaluations=snapshot.events.filter(event=>event.event.startsWith('evaluate_')).sort((a,b)=>a.sequence-b.sequence);
 assert.deepEqual(evaluations.map(event=>[event.sequence,event.event,event.estimated_input_tokens]),[
  [1,'evaluate_complete',302],[2,'evaluate_complete',250],[3,'evaluate_error',null],
 ]);
 for(const secret of ['private.invalid','private fetch body','private body A','private-reservation-a','private-digest-a','private calibration source','synthetic private error'])
  assert.ok(!serialized.includes(secret));
 assert.ok(snapshot.events.every(event=>Object.keys(event).every(key=>['sequence','event','at_ms','active_fetches','pre_fetch_admission_ms','fetch_duration_ms',
  'estimated_input_tokens','reservation_estimate_status','calibration_kind','calibration_kind_source'].includes(key))));
});

test('calibration observations preserve native phase shapes from the query-engine contract',async()=>{
  const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;
  assert.ok(target,'pure test needs the checked out public target root');
  const [contracts,calibration]=await Promise.all([
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-contracts.ts')).href),
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-calibration.ts')).href),
  ]) as any;
  const configuration=contracts.signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  configuration.questions.push({key:'consumer_test_v1',type:'noul',text:'Synthetic consumer classification',
    scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',
    positive:'Synthetic consumer topic applies',negative:'Synthetic consumer topic does not apply'});
  const baseKeys=configuration.questions.filter((question:any)=>question.origin==='base').map((question:any)=>question.key);
  const consumerKeys=configuration.questions.filter((question:any)=>question.scope==='consumer_category').map((question:any)=>question.key);
  const base=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:baseKeys});
  const consumer=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:consumerKeys});
  assert.equal(base.phase,'base');
  assert.equal(consumer.phase,'consumer_category');
  const shapeDigests=[base.shape_digest,consumer.shape_digest];
  const captured=captureCalibrationObservationV1({warmup:true,selected_roots:32,max_in_flight:32,shape_digests:shapeDigests});
  shapeDigests.pop();
  assert.deepEqual(captured.shape_digests,[base.shape_digest,consumer.shape_digest]);
});

test('neutral observer retains hashes and operation timing without SQL, binds or returned rows',async()=>{
 const {createListeningObserver,projectObserverTimeToPerformanceRangeV1,queryHash}=await import('./observer.mjs');const observer=createListeningObserver();
 try{const db=observer.wrapDatabase({async query(){return{rows:[{secret:'never record'}]};}});
 const store=observer.wrapStore({async inputs(){return db.query('SELECT private_value FROM synthetic WHERE credential=$1',['secret-bind']);}});
 await store.inputs();const snapshot=observer.snapshot(),serialized=JSON.stringify(snapshot);
 assert.ok(serialized.includes(queryHash('SELECT private_value FROM synthetic WHERE credential=$1')!));
 for(const forbidden of ['private_value','credential','secret-bind','never record'])assert.ok(!serialized.includes(forbidden));
 const events=snapshot.events as any[];assert.equal(events.filter(x=>x.kind==='query').length,1);assert.equal(events.find(x=>x.kind==='query').operation,'inputs');
 assert.equal(events.find(x=>x.kind==='query').pid,null);assert.ok(events.filter(x=>x.kind==='query'||x.kind==='store').every(x=>x.end_ms>=x.start_ms));
 const anchor=(snapshot as any).clock_anchor;assert.match(anchor.hrtime_origin_ns,/^\d+$/u);assert.equal(anchor.hrtime_origin_unit,'nanoseconds');
 assert.equal(anchor.event_offset_unit,'milliseconds');assert.ok(anchor.performance_after_ms>=anchor.performance_before_ms);
 assert.equal(anchor.uncertainty_ms,anchor.performance_after_ms-anchor.performance_before_ms);
 assert.equal(anchor.projection,'[performance_before_ms + event_offset_ms, performance_after_ms + event_offset_ms]');
 const event=events.find(x=>x.kind==='query'),projected=projectObserverTimeToPerformanceRangeV1(anchor,event.start_ms);
 assert.ok(projected.end_performance_ms>=projected.start_performance_ms);
 assert.equal(projected.uncertainty_ms,anchor.uncertainty_ms);
 }finally{await observer.close();}
});

test('observer clock projection preserves a bounded interval without fabricating an offset',async()=>{
 const {projectObserverTimeToPerformanceRangeV1}=await import('./observer.mjs');
 assert.deepEqual(projectObserverTimeToPerformanceRangeV1({performance_before_ms:100.25,performance_after_ms:100.5},25),
  {start_performance_ms:125.25,end_performance_ms:125.5,uncertainty_ms:.25});
 assert.throws(()=>projectObserverTimeToPerformanceRangeV1({performance_before_ms:100.5,performance_after_ms:100.25},25),/anchor_invalid/u);
 assert.throws(()=>projectObserverTimeToPerformanceRangeV1({performance_before_ms:100,performance_after_ms:101},-1),/anchor_invalid/u);
});

test('neutral events are bounded and wait rows expose only allowed metadata',async()=>{
 const {boundedEvents,safeWaitRow,queryHash}=await import('./observer.mjs');const bounded=boundedEvents(2);
 bounded.push(1);bounded.push(2);bounded.push(3);assert.deepEqual(bounded.snapshot(),{events:[1,2],dropped:1,limit:2});
 assert.deepEqual(safeWaitRow({pid:12,wait_event_type:'Lock',wait_event:'tuple',blocking_pids:[13,'SQL',-1],query:'secret'}),{pid:12,wait_event_type:'Lock',wait_event:'tuple',blocking_pids:[13]});
 assert.equal(safeWaitRow({pid:12,wait_event_type:'SELECT secret',wait_event:null}).wait_event_type,'redacted');
 assert.throws(()=>safeWaitRow({pid:'secret'}),/invalid_pid/u);assert.equal(queryHash({text:'SELECT  1'}),queryHash(' SELECT 1 '));
});

test('sampler refuses non-CI before starting any child and observer cleanup stops sampling',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver();
 try{await assert.rejects(observer.startSampler({target:'/missing',url:'postgresql://localhost/x',database:'noisia_mfp_ci'}),/ci_only|target_invalid/u);}finally{await observer.close();}
 const before=observer.snapshot().events.length;await new Promise(resolve=>setTimeout(resolve,280));assert.equal(observer.snapshot().events.length,before);
 assert.equal(observer.snapshot().sampler_process_pid,null);
});

test('child cleanup sends stop only to its owned child and waits for exit',async()=>{
 const {EventEmitter}=await import('node:events');const {closeOwnedChild}=await import('./observer.mjs');
 const child=new EventEmitter() as any;Object.assign(child,{exitCode:null,signalCode:null,connected:true});let message:unknown;
 child.send=(m:unknown)=>{message=m;queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});};child.kill=()=>assert.fail('graceful child must not be killed');
 await closeOwnedChild(child);assert.deepEqual(message,{kind:'stop'});await closeOwnedChild(child);
});

test('final observer snapshot includes late cleanup events with consistent counters and an immutable cutoff',async()=>{
 const {boundedEvents,finishListeningObserver}=await import('./observer.mjs');const events=boundedEvents(1);
 const early=events.snapshot();let closed=false;
 const final=await finishListeningObserver({async close(){await Promise.resolve();events.push({kind:'late_child_sample'});events.push({kind:'overflow'});closed=true;},snapshot(){assert.equal(closed,true);return events.snapshot();}});
 assert.deepEqual(early,{events:[],dropped:0,limit:1});
 assert.deepEqual(final,{events:[{kind:'late_child_sample'}],dropped:1,limit:1});
 events.push({kind:'after_cutoff'});assert.equal(final.dropped,1);assert.equal(final.events.length,1);
});

test('inner-plan guard is limited to the owned CI loopback database and role',async()=>{
 const {assertInnerPlanCaptureGuard,innerPlanQueryLabel,verifiedInnerPlanScopeV1}=await import('./observer.mjs');
 const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'};
 assert.doesNotThrow(()=>assertInnerPlanCaptureGuard(env,'noisia_mfp_ci','postgres'));
 assert.throws(()=>assertInnerPlanCaptureGuard({...env,GITHUB_ACTIONS:'false'},'noisia_mfp_ci','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard({...env,DATABASE_URL:'postgresql://postgres@db.example.test/noisia_mfp_ci'},'noisia_mfp_ci','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard(env,'private_database','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard(env,'noisia_mfp_ci','other_role'),/capture_denied/u);
 assert.equal(innerPlanQueryLabel('sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680'),'metadata');
 assert.equal(innerPlanQueryLabel('sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04'),'hydrate');
 assert.equal(innerPlanQueryLabel('sha256:8ea420589c30b27ac581ade8d7fe31c467e50d5b96abc4a96358a3133b517a66'),'metadata');
 assert.equal(innerPlanQueryLabel('sha256:8fdf796e82ccd9b4528996c607536f72bd5992946d6d3c21f0daf1700ea97d84'),'hydrate');
 assert.equal(innerPlanQueryLabel('sha256:unknown'),null);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true},'noisia_mfp_ci','postgres'),true);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'read committed',read_only:'off',superuser:true},'noisia_mfp_ci','postgres'),false);
});

test('capture scope matches the real bounded-labeling transaction path and not the unbounded path',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'scope contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const beginMatch=labeling.match(/await c\.query\(["']BEGIN["']\)/u);
 const readOnlyMatch=labeling.match(/await c\.query\(["']SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY["']\)/u);
 assert.ok(beginMatch,'transaction helper must begin with its native BEGIN statement');
 assert.ok(readOnlyMatch,'bounded path must set its native RR/RO transaction before adapter work');
 const boundedPath=/if\(bounds\)[\s\S]{0,450}return tx\(db,async c=>\{await c\.query\(["']SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY["']\);\s*return options\.adapter!\.bounded_inputs!\(c,run,read\);\}\)/u;
 assert.match(labeling,boundedPath);
 assert.match(listening,/bounded_inputs:\(c,run,bounds\)=>inputs\(c,run,limit,bounds\)/u);
 assert.match(listening,/const metadata=bounds\?await inputMetadata\(c,run,bounds\.max_rows\):null/u);
 assert.match(listening,/const rows=\(await c\.query[\s\S]{0,700}FROM \$\{hydratePopulation\}/u);
 const begin='BEGIN',setReadOnly='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
 const statements:string[]=[];let isolation='read committed',readOnly='off',inTransaction=false;
 const client={async query(sql:string){statements.push(sql);if(sql===begin){inTransaction=true;isolation='read committed';readOnly='off';}
  else if(sql===setReadOnly&&inTransaction){isolation='repeatable read';readOnly='on';}
  else throw Error('unexpected_transaction_command');return{rows:[]};}};
 await client.query(begin);await client.query(setReadOnly);
 const {verifiedInnerPlanScopeV1}=await import('./observer.mjs');
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation,read_only:readOnly,superuser:true},'noisia_mfp_ci','postgres'),true);
 assert.deepEqual(statements,[begin,setReadOnly]);
 isolation='read committed';readOnly='off';
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation,read_only:readOnly,superuser:true},'noisia_mfp_ci','postgres'),false);
});

test('auto_explain notice parser keeps only safe plan node fields',async()=>{
 const {safeAutoExplainNotice}=await import('./observer.mjs');
 const plan=safeAutoExplainNotice({message:'duration: 1.2 ms  plan:\n'+JSON.stringify({'Query Text':"SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x",'Planning Time':.1,'Execution Time':1.2,Plan:{'Node Type':'Index Scan','Relation Name':'mentions','Alias':'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,'Index Cond':"(root_id = 'private-uuid')",Output:['private_value'],Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Subplan Name':'private_cte','Filter':"credential = 'private'",'Actual Rows':1}]}})});
 const serialized=JSON.stringify(plan);
 assert.deepEqual(plan,{query_text_sha256:`sha256:${createHash('sha256').update("SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x").digest('hex')}`,
  planning_time_ms:.1,execution_time_ms:1.2,plan:{'Node Type':'Index Scan','Relation Name':'mentions',Alias:'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Actual Rows':1}]}});
 for(const forbidden of ['private-uuid','private_value','credential','Filter','Output','Index Cond','Query Text','jsonb_agg'])assert.ok(!serialized.includes(forbidden));
 assert.equal(safeAutoExplainNotice({message:'ERROR: private SQL and params'}),null);
 assert.equal(safeAutoExplainNotice({message:'x'.repeat(1_000_001)}),null);
});

test('inner-plan setup failure rolls back its savepoint then runs the original query once without retaining the error',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any;let originalCalls=0;const statements:string[]=[];
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SAVEPOINT')||sql.startsWith('ROLLBACK TO')||sql.startsWith('RELEASE'))return{rows:[]};
   if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};
   if(sql.startsWith('LOAD'))throw Error('extension unavailable with private text');return{rows:[]};};
  const captured=await captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;return{rows:[{ok:true}]}},
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',query_ordinal:2,root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.deepEqual(captured.result,{rows:[{ok:true}]});assert.equal(originalCalls,1);assert.equal(client.listenerCount('notice'),0);
  assert.ok(captured.observation?.status==='inner_plan_unavailable');assert.equal(captured.observation.reason,'auto_explain_load_unavailable');
  assert.equal(captured.observation.query_ordinal,2);
  for(const statement of ['SAVEPOINT r16_inner_plan_capture_v1','ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1','RELEASE SAVEPOINT r16_inner_plan_capture_v1'])assert.ok(statements.includes(statement));
  assert.ok(statements.includes("SET LOCAL log_min_messages = 'WARNING'"));assert.ok(statements.includes("SET LOCAL client_min_messages = 'NOTICE'"));
  assert.ok(statements.includes('LOAD \'auto_explain\''));
  const serialized=JSON.stringify(captured);assert.ok(!serialized.includes('private setup details'));assert.ok(!serialized.includes('extension unavailable'));
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan ordinals count every eligible query and select the fixed bounded schedule',async()=>{
 const {innerPlanQueryLabel,nextInnerPlanQueryOrdinalV1,shouldCaptureInnerPlanOrdinalV1,INNER_PLAN_CAPTURE_ORDINALS}=await import('./observer.mjs');
 const hash='sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',counts=new Map<string,number>();
 assert.equal(innerPlanQueryLabel(hash),'metadata');assert.deepEqual(INNER_PLAN_CAPTURE_ORDINALS,[1,2,3,4,5,6,7,8]);
 const ordinals=Array.from({length:10},()=>nextInnerPlanQueryOrdinalV1(hash,true,counts));
 assert.deepEqual(ordinals,Array.from({length:10},(_,i)=>i+1));
 assert.deepEqual(ordinals.filter(shouldCaptureInnerPlanOrdinalV1),[1,2,3,4,5,6,7,8]);
 assert.equal(nextInnerPlanQueryOrdinalV1(hash,false,counts),null);assert.equal(counts.get(hash),10);
 assert.equal(nextInnerPlanQueryOrdinalV1('sha256:unknown',true,counts),null);
});

test('inner-plan capture retains bounded ordered plans with query-text hashes and removes its handler',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1,INNER_PLAN_MIN_DURATION_MS}=await import('./observer.mjs');
 assert.equal(INNER_PLAN_MIN_DURATION_MS,50);
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any,statements:string[]=[];let originalCalls=0;
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};return{rows:[]};};
  const captured=await captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;for(let i=0;i<35;i++)client.emit('notice',{message:'duration: 4 ms plan: '+JSON.stringify({'Query Text':`SELECT synthetic_nested_${i}('{}'::jsonb)`,Plan:{'Node Type':'Index Scan','Relation Name':'mentions','Actual Rows':64+i,'Actual Loops':3}})});return{rows:[{ok:true}]}},
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',query_ordinal:1,root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.equal(originalCalls,1);assert.ok(captured.observation?.status==='captured');
  assert.equal(captured.observation.query_ordinal,1);
  assert.equal(captured.observation.plans.length,32);assert.equal(captured.observation.plans_dropped,3);assert.equal(captured.observation.plan_notices_seen,35);
  assert.deepEqual(captured.observation.plans.map(plan=>plan.sequence),Array.from({length:32},(_,i)=>i+1));
  assert.equal(captured.observation.plans[0]?.plan['Actual Rows'],64);assert.match(captured.observation.plans[0]?.query_text_sha256??'/',/^sha256:[0-9a-f]{64}$/u);
  assert.ok(captured.observation.setup_ms>=0&&captured.observation.cleanup_ms>=0&&captured.observation.setup_cleanup_wall_ms>=0);
  assert.equal(captured.observation.analyze_overhead_measured,false);
  const serialized=JSON.stringify(captured);assert.ok(!serialized.includes('SELECT synthetic_nested_'));assert.ok(!serialized.includes("'{}'::jsonb"));
  assert.ok(statements.some(sql=>sql.startsWith("SET LOCAL auto_explain.log_level")));
  assert.ok(statements.includes('SET LOCAL auto_explain.log_min_duration = 50'));
  assert.ok(statements.includes('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1'));assert.equal(client.listenerCount('notice'),0);
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan query failure clears the listener and rolls back without swallowing the query failure',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any,statements:string[]=[];
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};return{rows:[]};};
  let originalCalls=0;
  await assert.rejects(captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;throw Error('original query failure')},
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',query_ordinal:6,root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/original query failure/u);
  assert.equal(originalCalls,1);
  assert.equal(client.listenerCount('notice'),0);assert.ok(statements.includes('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1'));
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan rollback failure propagates, never replays the query, and still removes the notice handler',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any;let originalCalls=0,rollbackCalls=0;
  client.query=async(sql:string)=>{if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};
   if(sql.startsWith('ROLLBACK TO')){rollbackCalls++;throw Error('rollback cleanup failed');}return{rows:[]};};
  await assert.rejects(captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;return{rows:[]}},
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',query_ordinal:8,root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/rollback cleanup failed/u);
  assert.equal(originalCalls,1);assert.ok(rollbackCalls>=1);assert.equal(client.listenerCount('notice'),0);
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

const DML_PLAN_TEST_ENV={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',NOISIA_R16_LISTENING_DML_PLAN_PG:'true',
 NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'};
async function withDmlPlanTestEnv<T>(action:()=>Promise<T>){
 const keys=Object.keys(DML_PLAN_TEST_ENV) as Array<keyof typeof DML_PLAN_TEST_ENV>,prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,DML_PLAN_TEST_ENV);
 try{return await action();}finally{for(const key of keys){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
const CANONICAL_STATS_BEFORE=[
 {signature:'public.signal_labeling_digest_v1(jsonb)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
 {signature:'public.signal_labeling_json_v1(jsonb)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
 {signature:'public.signal_listening_statement_roots_v1(uuid[])',function_present:true,stats_observed:true,calls:5,total_time_ms:1,self_time_ms:.5},
];
const CANONICAL_STATS_AFTER=[
 CANONICAL_STATS_BEFORE[0]!,
 {signature:'public.signal_labeling_json_v1(jsonb)',function_present:true,stats_observed:true,calls:30,total_time_ms:10,self_time_ms:4},
 {signature:'public.signal_listening_statement_roots_v1(uuid[])',function_present:true,stats_observed:true,calls:6,total_time_ms:1.2,self_time_ms:.6},
];
const FUNCTION_STATS_BEFORE=[
 {signature:'public.signal_listening_answer_guard_v1()',function_present:true,stats_observed:true,calls:10,total_time_ms:2,self_time_ms:1},
 {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',function_present:true,stats_observed:true,calls:40,total_time_ms:12,self_time_ms:10},
 {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',function_present:true,stats_observed:true,calls:5,total_time_ms:8,self_time_ms:6},
 {signature:'public.signal_processing_actor_v1(uuid, uuid)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
];
const FUNCTION_STATS_AFTER=[
 {signature:'public.signal_listening_answer_guard_v1()',function_present:true,stats_observed:true,calls:11,total_time_ms:2.5,self_time_ms:1.3},
 {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',function_present:true,stats_observed:true,calls:42,total_time_ms:13,self_time_ms:11},
 {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',function_present:true,stats_observed:true,calls:6,total_time_ms:9,self_time_ms:7},
 {signature:'public.signal_processing_actor_v1(uuid, uuid)',function_present:true,stats_observed:true,calls:9,total_time_ms:5,self_time_ms:3},
];
function fakeDmlPlanClient(options:{readOnly?:string;failLoad?:boolean;failRestore?:boolean;failStatsBefore?:boolean;failStatsAfter?:boolean;
 absentSignatures?:string[];unobservedSignatures?:string[];unobservedBeforeSignatures?:string[];missingSignatures?:string[];
 counterRegressionSignatures?:string[];invalidBeforeSignatures?:string[];restoreFailsAfterStatsError?:boolean;failActorExplain?:boolean;restoreFailsAfterActorError?:boolean}={}){
 const client=new EventEmitter() as any,statements:string[]=[],events:string[]=[],restores:Array<{name:string;value:string;local:boolean}>=[],functionStatLookups:string[][]=[];
 let statsReads=0,transactionAborted=false;
 const oldValues:Record<string,string>={log_min_messages:'warning',client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0',
  'auto_explain.log_parameter_max_length':'0','auto_explain.log_level':'notice','auto_explain.log_min_duration':'-1',
  'auto_explain.log_nested_statements':'off','auto_explain.log_analyze':'off','auto_explain.log_buffers':'off',
  'auto_explain.log_timing':'on','auto_explain.log_format':'text','auto_explain.log_verbose':'off','auto_explain.log_triggers':'off',track_functions:'none',
  lock_timeout:'0',statement_timeout:'0'};
 client.query=async(sql:string,values?:unknown[])=>{
  statements.push(sql);
  if(sql.startsWith('SAVEPOINT')){events.push('savepoint');return{rows:[]};}
  if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',read_only:options.readOnly??'off',superuser:true}]};
  if(sql.startsWith("LOAD 'auto_explain'")){events.push('load');if(options.failLoad)throw Error('private extension failure');return{rows:[]};}
  if(sql.includes('pg_stat_xact_user_functions')){statsReads++;events.push(statsReads===1?'stats-before':'stats-after');functionStatLookups.push((values?.[0] as string[]|undefined)??[]);
   if((statsReads===1&&options.failStatsBefore)||(statsReads===2&&options.failStatsAfter)){if(statsReads===2&&options.restoreFailsAfterStatsError)transactionAborted=true;throw Error('synthetic_function_stats_error');}
   const source=statsReads===1?[...FUNCTION_STATS_BEFORE,...CANONICAL_STATS_BEFORE]:[...FUNCTION_STATS_AFTER,...CANONICAL_STATS_AFTER];
   const rows=source.filter(row=>!options.missingSignatures?.includes(row.signature)).map(row=>options.absentSignatures?.includes(row.signature)
    ?{signature:row.signature,function_present:false,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null}
    :options.unobservedSignatures?.includes(row.signature)||(statsReads===1&&options.unobservedBeforeSignatures?.includes(row.signature))
     ?{signature:row.signature,function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null}:row);
   return{rows:rows.map(row=>statsReads===1&&options.invalidBeforeSignatures?.includes(row.signature)?{...row,calls:-1}:statsReads===2&&options.counterRegressionSignatures?.includes(row.signature)?{...row,calls:0}:row)};}
  if(sql.startsWith('SELECT name,current_setting'))return{rows:(values?.[0] as string[]).map(name=>({name,value:oldValues[name]}))};
  if(sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r'))return{rows:[{workspace_id:'11111111-1111-4111-8111-111111111111',actor_user_id:'22222222-2222-4222-8222-222222222222'}]};
  if(sql.startsWith('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)')){
   if(options.failActorExplain){if(options.restoreFailsAfterActorError)transactionAborted=true;throw Error('synthetic_actor_explain_error');}
   const plan={ 'Node Type':'Index Scan','Relation Name':'signal_workspaces','Index Name':'idx_signal_workspaces_org_status','Actual Rows':1,'Actual Loops':1};
   client.emit('notice',{message:'duration: 3 ms plan: '+JSON.stringify({'Query Text':sql,'Execution Time':3,Plan:plan})});
   return{rows:[{'QUERY PLAN':[{ 'Planning Time':.1,'Execution Time':3,Plan:plan}]}]};
  }
  if(sql.startsWith('RELEASE SAVEPOINT')){events.push('release');return{rows:[]};}
  if(sql.startsWith('ROLLBACK TO SAVEPOINT')){events.push('rollback');return{rows:[]};}
  if(sql.startsWith('SELECT set_config')){events.push('restore');restores.push({name:String(values?.[0]),value:String(values?.[1]),local:sql.includes('true')});if(options.failRestore)throw Error('synthetic restore failure');
   if(transactionAborted)throw Error('25P02 current transaction is aborted');return{rows:[]};}
  return{rows:[]};
 };
 return{client,statements,events,restores,oldValues,functionStatLookups};
}

test('DML plan specs match the complete source SQL, bind arity and batch-value positions',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'DML SQL contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const mark=labeling.match(/`(UPDATE signal_labeling_calls SET status='submitting',[\s\S]*?RETURNING id)`\s*,\s*\[run\.id,\s*calls\.map/u);
 const answers=listening.match(/`(INSERT INTO signal_listening_answers\([\s\S]*?DO NOTHING)`\s*,\s*\[run\.workspace_id,\s*run\.entity_context_digest,\s*run\.id,\s*JSON\.stringify\(rows\)\]/u);
 const reserve=labeling.match(/`(INSERT INTO signal_labeling_calls\([\s\S]*?ON CONFLICT\(custom_id\) DO NOTHING)`\s*,\s*\[\s*run\.id,[\s\S]*?JSON\.stringify\(fresh\),/u);
 assert.ok(mark,'markSubmitting SQL and run.id/calls batch position must match');assert.ok(answers,'answers INSERT SQL and $4 row batch position must match');
 assert.ok(reserve,'reserve INSERT SQL and $6 fresh-proposal batch position must match');
 const {queryHash,dmlPlanQuerySpec,dmlPlanBatchSize}=await import('./observer.mjs');
 const markHash=queryHash(mark[1]),answersHash=queryHash(answers[1]),reserveHash=queryHash(reserve[1]);
 assert.equal(markHash,'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b');
 assert.equal(answersHash,'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7');
 assert.equal(reserveHash,'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd');
 assert.deepEqual(dmlPlanQuerySpec(markHash),{label:'mark_submitting',batch_unit:'call_ids',values_count:2,batch_value_index:1,batch_kind:'array',function_stats:'canonical'});
 assert.deepEqual(dmlPlanQuerySpec(answersHash),{label:'listening_answers_insert',batch_unit:'answer_rows',values_count:4,batch_value_index:3,batch_kind:'json_array',function_stats:'answers'});
 assert.deepEqual(dmlPlanQuerySpec(reserveHash),{label:'reserve_calls_insert',batch_unit:'call_proposals',values_count:8,batch_value_index:5,batch_kind:'json_array',function_stats:'canonical'});
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(256).fill('synthetic-id')]]),256);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(255).fill('synthetic-id')]]),255);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run']]),null);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run',JSON.stringify(Array(256).fill({synthetic:true}))]]),256);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run','not-json']]),null);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport',JSON.stringify(Array(256).fill({synthetic:true})),'date','UTC']]),256);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport',JSON.stringify(Array(255).fill({synthetic:true})),'date','UTC']]),255);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport','not-json','date','UTC']]),null);
});

test('RAW attach frontier requires bounded persistRawPage context and exact SQL binds while retaining only counts',async()=>{
 const {queryHash,dmlPlanQuerySpec,rawPageDmlContextFromStoreArgsV1,rawPageDmlBatchSizeV1,SQL_FRONTIER_DML_BATCH_LIMIT}=await import('./observer.mjs');
 const lockSql=`SELECT c.id FROM signal_labeling_calls c
        JOIN signal_labeling_raw_page_members m ON m.call_id=c.id AND m.workspace_id=c.workspace_id AND m.run_id=c.run_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 ORDER BY c.id FOR UPDATE OF c`;
 const updateSql=`UPDATE signal_labeling_calls c SET raw_sha256=m.raw_sha256,raw_storage_key=p.storage_key,
        raw_size_bytes=m.raw_size_bytes,raw_storage_verified_at=COALESCE(c.raw_storage_verified_at,p.verified_at),
        raw_storage_verified_key=p.storage_key,updated_at=CASE WHEN c.raw_sha256 IS NULL THEN clock_timestamp() ELSE c.updated_at END
        FROM signal_labeling_raw_page_members m JOIN signal_labeling_raw_pages p ON p.id=m.page_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 AND c.id=m.call_id AND c.workspace_id=m.workspace_id AND c.run_id=m.run_id
          AND c.request_digest=m.request_digest AND p.status='verified'
          AND (c.raw_sha256 IS NULL OR c.raw_sha256=m.raw_sha256 AND c.raw_storage_key=p.storage_key AND c.raw_size_bytes=m.raw_size_bytes)
        RETURNING c.id`;
 const lockHash=queryHash(lockSql),updateHash=queryHash(updateSql);
 assert.equal(lockHash,'sha256:b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670');
 assert.equal(updateHash,'sha256:99746d65e4fad037daa0402f77a11a5677c191c74ef01741a1182cf05e201d20');
 assert.equal(dmlPlanQuerySpec(lockHash)?.label,'raw_attach_call_lock');assert.equal(dmlPlanQuerySpec(updateHash)?.label,'raw_attach_call_update');
 const rows=Array.from({length:256},(_,i)=>({call:{id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`},sensitive:'must-not-be-retained'}));
 const run={id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222'};
 const context=rawPageDmlContextFromStoreArgsV1([run,rows]);assert.deepEqual(context,{operation:'persistRawPage',run_id:run.id,workspace_id:run.workspace_id,batch_size:256});
 assert.equal(JSON.stringify(context).includes('sensitive'),false);assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),256);
 assert.equal(rawPageDmlBatchSizeV1(updateHash,[updateSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),256);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',run.id]],context),null);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],{...context,batch_size:SQL_FRONTIER_DML_BATCH_LIMIT+1}),null);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql+' /* drift */',['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,[...rows.slice(0,255),rows[0]]]),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,[{call:{id:'not-a-uuid'}}]]),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,Array(SQL_FRONTIER_DML_BATCH_LIMIT+1).fill(rows[0])]),null);
});

test('function-stat OID contract ignores the source functions’ real argument names',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'function-stat contract test needs checked out public target root');
 const listening=await readFile(join(target,'infrastructure/db/migrations/0296_signal_listening_configuration.sql'),'utf8');
 const policy=await readFile(join(target,'infrastructure/db/migrations/0155_signal_processing_policy.sql'),'utf8');
 const actor=await readFile(join(target,'infrastructure/db/migrations/0218_signal_processing_internal_admin_actor.sql'),'utf8');
 assert.match(listening,/CREATE FUNCTION signal_listening_root_right_v1\(w uuid,r uuid,purpose text\)/u);
 assert.match(policy,/CREATE FUNCTION signal_processing_lock_actor_v1\(target_workspace uuid,target_actor uuid,require_request boolean DEFAULT true\)/u);
 assert.match(actor,/CREATE OR REPLACE FUNCTION signal_processing_actor_v1\(target_workspace uuid,target_actor uuid\)/u);
 await withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,functionStatLookups}=fakeDmlPlanClient();
  await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
   batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
  const lookup=statements.find(sql=>sql.includes('pg_stat_xact_user_functions'))??'';
  assert.match(lookup,/to_regprocedure\(signature\)::oid/u);assert.doesNotMatch(lookup,/pg_get_function_identity_arguments|identity_arguments/u);
  assert.deepEqual(functionStatLookups[0],[
   'public.signal_listening_answer_guard_v1()',
   'public.signal_listening_root_right_v1(uuid, uuid, text)',
   'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',
   'public.signal_processing_actor_v1(uuid, uuid)',
  ]);
 });
});

test('DML capture guard requires the explicit owned CI loopback lab opt-in',async()=>{
 const {dmlPlanCaptureEnvironmentAllowed}=await import('./observer.mjs');
 assert.equal(dmlPlanCaptureEnvironmentAllowed(DML_PLAN_TEST_ENV),true);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,NOISIA_R16_LISTENING_DML_PLAN_PG:'false'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,GITHUB_ACTIONS:'false'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,NOISIA_R16_LOCAL_PG_LAB:'other'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,DATABASE_URL:'postgresql://postgres@db.example.test/noisia_mfp_ci'}),false);
});

test('DML plan notice exposes allowlisted trigger metrics and omits query text, binds and unknown trigger names',async()=>{
 const {safeDmlAutoExplainNotice}=await import('./observer.mjs');
 const queryText="INSERT INTO signal_listening_answers VALUES ('private-id', '{}'::jsonb)";
 const note=safeDmlAutoExplainNotice({message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':queryText,'Execution Time':62,
  Plan:{'Node Type':'ModifyTable','Relation Name':'signal_listening_answers','Actual Rows':256,'Actual Loops':1},
  Triggers:[{'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Time:48.2,Calls:256},
   {'Trigger Name':'mass_labeling_call_root',Relation:'signal_labeling_calls',Time:8.5,Calls:256},
   {'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Calls:0},
   {'Trigger Name':'private_dynamic_trigger',Relation:'private_table',Time:9,Calls:1}]})});
 assert.deepEqual(note?.triggers,[{name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:48.2,calls:256},
  {name:'mass_labeling_call_root',relation:'signal_labeling_calls',time_ms:8.5,calls:256},
  {name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:null,calls:0}]);
 assert.equal(note?.triggers_seen,4);assert.equal(note?.triggers_omitted,1);assert.equal(note?.triggers_unknown_time,1);
 assert.match(note?.query_text_sha256??'/',/^sha256:[0-9a-f]{64}$/u);
 const serialized=JSON.stringify(note);
 for(const forbidden of ['private-id','private_dynamic_trigger','private_table','Query Text','INSERT INTO','{}'])assert.ok(!serialized.includes(forbidden));
});

test('DML savepoint releases before the original write, captures once and keeps one ledger write in outer transaction',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,DML_PLAN_MAX_PLANS}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();let writes=0;
 const query=async()=>{writes++;events.push('write');for(let i=0;i<10;i++)client.emit('notice',{message:'duration: 61 ms plan: '+JSON.stringify({'Query Text':`UPDATE synthetic_table SET value='private_${i}'`,
  'Execution Time':61+i,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1},
  Triggers:[{'Trigger Name':'mass_labeling_scoped_update_total',Relation:'signal_labeling_calls',Time:50+i,Calls:256},
   {'Trigger Name':'unknown_private_trigger',Relation:'hidden',Time:9,Calls:1}]})});return{rows:[],rowCount:256};};
 const captured=await captureDmlPlanQueryV1({client,query,query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.equal(captured.result.rowCount,256);assert.ok(captured.observation?.status==='captured');
 assert.equal(captured.observation.batch_unit,'call_ids');
 assert.equal(captured.observation.plans.length,DML_PLAN_MAX_PLANS);assert.equal(captured.observation.plans_dropped,2);
 assert.equal(captured.observation.triggers_omitted_count,10);assert.equal(captured.observation.plans[0]?.triggers[0]?.calls,256);
 assert.equal(captured.observation.analyze_timing_overhead_measured,false);assert.equal(client.listenerCount('notice'),0);
 assert.ok(events.indexOf('release')<events.indexOf('write'));assert.equal(events.filter(x=>x==='rollback').length,0);
 assert.ok(events.lastIndexOf('restore')>events.indexOf('write'));
 assert.equal(restores.length,18);assert.ok(restores.every(row=>row.local));
 assert.deepEqual(restores[0],{name:'auto_explain.log_min_duration',value:'-1',local:true});
 assert.deepEqual(restores.at(-1),{name:'auto_explain.log_min_duration',value:oldValues['auto_explain.log_min_duration'],local:true});
 for(const {name,value} of restores.slice(1,-1))assert.equal(value,oldValues[name]);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_triggers = on'),true);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_timing = on'),true);
 assert.equal(captured.observation.analyze_timing_enabled,true);assert.equal(captured.observation.analyze_timing_overhead_measured,false);
 assert.equal(statements.some(sql=>sql.startsWith('ROLLBACK TO SAVEPOINT')),false);
 const serialized=JSON.stringify(captured);for(const forbidden of ['private_0','unknown_private_trigger','hidden','UPDATE synthetic_table'])assert.ok(!serialized.includes(forbidden));
}));

test('SQL frontier capture preserves the outer plan after nested notices, bounds nested plans, and never launches actor work',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,DML_PLAN_MAX_PLANS}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient();
 const outerSql='UPDATE synthetic_table SET value=$1 WHERE id=$2';let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;
  for(let i=0;i<10;i++)client.emit('notice',{message:'duration: 61 ms plan: '+JSON.stringify({'Query Text':`SELECT nested_${i}`,
   'Execution Time':61,Plan:{'Node Type':'Seq Scan','Relation Name':'synthetic_table','Actual Rows':1,'Actual Loops':1}})});
  client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':outerSql,'Execution Time':62,
   Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1}})});
  events.push('write');return{rowCount:256};},query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,sql_frontier_only:true,outer_query_text:outerSql,query_values:{private:'not-for-actor'}});
 assert.equal(writes,1);assert.equal(captured.observation?.outer_plan_status,'captured');assert.equal(captured.observation?.nested_plan_limit,DML_PLAN_MAX_PLANS);
 assert.equal(captured.observation?.plans.filter(plan=>plan.frontier_role==='outer').length,1);
 assert.equal(captured.observation?.plans.filter(plan=>plan.frontier_role==='nested').length,DML_PLAN_MAX_PLANS);
 assert.equal(captured.observation?.plans_dropped,2);assert.ok(captured.observation&&!('actor_function_diagnostic' in captured.observation));
 assert.ok(captured.observation?.plans.at(-1)?.frontier_role==='outer');
 const artifact=JSON.stringify(captured.observation);assert.ok(!artifact.includes('UPDATE synthetic_table')&&!artifact.includes('private')&&!artifact.includes('query_values'));
}));

test('DML setup fallback rolls back before exactly one write and leaves it in the outer transaction ledger',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failLoad:true});let writes=0;
 let clockTick=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{assert.equal(client.listenerCount('notice'),0);writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,clock:()=>++clockTick});
 assert.equal(writes,1);assert.equal(captured.result.rowCount,256);assert.ok(captured.observation?.status==='setup_unavailable');
 assert.equal(captured.observation.reason,'auto_explain_load_unavailable');assert.ok(events.indexOf('rollback')<events.indexOf('write'));
 assert.equal(captured.observation.batch_unit,'answer_rows');
 assert.equal(captured.observation.cleanup_ms,1);assert.equal(captured.observation.setup_cleanup_wall_ms,captured.observation.setup_ms+captured.observation.cleanup_ms);
 assert.equal(captured.observation.analyze_timing_enabled,false);
 assert.equal(events.filter(x=>x==='write').length,1);
}));

test('answers INSERT reports allowlisted inclusive same-transaction function-stat deltas separately from DML time',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();let writes=0,clockTick=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{
  writes++;events.push('write');client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':'INSERT INTO signal_listening_answers ...',
   'Execution Time':62,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_listening_answers','Actual Rows':256,'Actual Loops':1},
   Triggers:[{'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Time:48.2,Calls:256}]})});return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,clock:()=>++clockTick});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='captured');
 const stats=captured.observation.function_stats;assert.equal(stats?.status,'captured');assert.equal(stats?.total_time_inclusive,true);assert.equal(stats?.self_time_excludes_nested_calls,true);
 assert.equal(stats?.overhead_measured,false);assert.equal(stats?.capacity_claim,false);
 assert.deepEqual(stats?.deltas.map(({signature,calls})=>({signature,calls})),[
  {signature:'public.signal_listening_answer_guard_v1()',calls:1},
  {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',calls:2},
  {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',calls:1},
  {signature:'public.signal_processing_actor_v1(uuid, uuid)',calls:9},
 ]);
 assert.ok(stats?.deltas.every(row=>row.status==='captured'));
 assert.equal(stats?.deltas[3]?.baseline,'transaction_local_row_absent_zero_before_dml');
 assert.ok(Math.abs(stats!.deltas[0]!.total_time_ms!-.5)<1e-9);assert.ok(Math.abs(stats!.deltas[0]!.self_time_ms!-.3)<1e-9);
 assert.deepEqual(stats?.deltas.slice(1).map(row=>[row.total_time_ms,row.self_time_ms]),[[1,1],[1,1],[5,3]]);
 assert.equal(stats?.read_before_ms,1);assert.equal(stats?.read_after_ms,1);
 assert.equal(captured.observation.query_wall_ms,1);
 assert.ok(events.indexOf('release')<events.indexOf('write'));assert.equal(events.includes('rollback'),false);
 assert.ok(statements.includes("SET LOCAL track_functions = 'all'"));
 assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
 assert.equal(client.listenerCount('notice'),0);
 const serialized=JSON.stringify(captured);for(const forbidden of ['INSERT INTO','...','workspace_id','private','run_id'])assert.ok(!serialized.includes(forbidden));
}));

test('function stats distinguishes absent functions, unobserved counters, and missing lookup rows from measured zero',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');
 const answer='public.signal_listening_answer_guard_v1()',root='public.signal_listening_root_right_v1(uuid, uuid, text)',lockActor='public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',actor='public.signal_processing_actor_v1(uuid, uuid)';
 const {client}=fakeDmlPlanClient({absentSignatures:[answer],unobservedSignatures:[root],missingSignatures:[lockActor]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const deltas=captured.observation?.function_stats?.deltas;assert.ok(deltas);
 assert.deepEqual(deltas.map(({signature,status,calls,total_time_ms,self_time_ms})=>({signature,status,calls,total_time_ms,self_time_ms})),[
  {signature:answer,status:'function_absent',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:root,status:'stats_unobserved',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:lockActor,status:'lookup_unobserved',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:actor,status:'captured',calls:9,total_time_ms:5,self_time_ms:3},
 ]);
}));

test('a missing pre-write transaction counter row is declared before using its transaction-start zero baseline',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const root='public.signal_listening_root_right_v1(uuid, uuid, text)';
 const {client}=fakeDmlPlanClient({unobservedBeforeSignatures:[root]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const row=captured.observation?.function_stats?.deltas.find(item=>item.signature===root);
 assert.deepEqual(row,{signature:root,status:'captured',baseline:'transaction_local_row_absent_zero_before_dml',calls:42,total_time_ms:13,self_time_ms:11});
}));

test('post-write actor diagnostic resolves call ownership and records bounded safe EXPLAIN plans on the same backend',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'actor owner lookup contract needs checked out public target root');
 const labelingSchema=await readFile(join(target,'infrastructure/db/migrations/0221_signal_labeling_core.sql'),'utf8');
 assert.match(labelingSchema,/CREATE TABLE signal_labeling_runs\s*\(\s*id uuid PRIMARY KEY/u);
 assert.match(labelingSchema,/FOREIGN KEY\(workspace_id,run_id\) REFERENCES signal_labeling_runs\(workspace_id,id\)/u);
 const callIds=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
 const queryValues=['synthetic-workspace','synthetic-context','synthetic-run',JSON.stringify(callIds.map(call_id=>({call_id})))];let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,query_values:queryValues,clock:(()=>{let tick=0;return()=>++tick;})()});
 assert.equal(writes,1);assert.ok(captured.observation&&captured.observation.status!=='setup_unavailable');assert.equal(captured.observation.query_wall_ms,1);
 const diag=captured.observation.actor_function_diagnostic;
 assert.equal(diag?.status,'captured');assert.equal(diag?.call_ids_count,2);assert.equal(diag?.calls_resolved_count,2);
 assert.equal(diag?.timing_on,true);assert.equal(diag?.query_wall_includes_nested,true);assert.equal(diag?.analyze_overhead_measured,false);assert.equal(diag?.capacity_claim,false);
 assert.equal(diag?.lock_timeout_ms,1000);assert.equal(diag?.statement_timeout_ms,15000);assert.equal(diag?.nested_plan_limit,8);
 assert.match(diag?.function_call?.query_hash??'/',/^sha256:[0-9a-f]{64}$/u);assert.match(diag?.equivalent_body?.query_hash??'/',/^sha256:[0-9a-f]{64}$/u);
 assert.equal(diag?.function_call?.explain_plan?.plan['Node Type'],'Index Scan');assert.equal(diag?.function_call?.nested_plans.length,1);
 assert.equal(diag?.equivalent_body?.explain_plan?.plan['Index Name'],'idx_signal_workspaces_org_status');
 assert.equal(statements.filter(sql=>sql.startsWith('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)')).length,2);
 assert.ok(statements.some(sql=>sql.includes('public.signal_processing_actor_v1($1::uuid,$2::uuid)')));
 assert.ok(statements.some(sql=>sql.includes('FROM public.user_brand_access a')));assert.ok(statements.every(sql=>!sql.includes('signal_processing_lock_actor_v1')));
 const ownerLookup=statements.find(sql=>sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r'))??'';
 assert.match(ownerLookup,/JOIN signal_labeling_runs r ON r\.id=c\.run_id AND r\.workspace_id=c\.workspace_id/u);
 assert.doesNotMatch(ownerLookup,/r\.run_id\s*=\s*c\.run_id/u);
 assert.ok(statements.includes("SET LOCAL lock_timeout = '1s'"));assert.ok(statements.includes("SET LOCAL statement_timeout = '15s'"));
 assert.ok(statements.filter(sql=>sql.includes('pg_stat_xact_user_functions')).length===2);
 const statReads=statements.map((sql,index)=>sql.includes('pg_stat_xact_user_functions')?index:-1).filter(index=>index>=0);
 assert.ok(statReads[1]!<statements.findIndex(sql=>sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r')));
 assert.equal(restores.at(-2)?.name,'statement_timeout');assert.equal(restores.at(-2)?.value,oldValues.statement_timeout);
 assert.equal(restores.at(-3)?.name,'lock_timeout');assert.equal(restores.at(-3)?.value,oldValues.lock_timeout);
 assert.equal(client.listenerCount('notice'),0);assert.ok(events.indexOf('write')<events.indexOf('restore'));
 const serialized=JSON.stringify(captured);for(const forbidden of [...callIds,'synthetic-workspace','synthetic-context','synthetic-run','signal_processing_actor_v1($1'])assert.ok(!serialized.includes(forbidden));
}));

test('actor diagnostic query error stays primary over aborted-transaction GUC restore and never replays the write',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failActorExplain:true,restoreFailsAfterActorError:true});
 const callId='55555555-5555-4555-8555-555555555555';let writes=0,caught:unknown;
 try{await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,query_values:['synthetic','context','run',JSON.stringify([{call_id:callId}])]});}catch(error){caught=error;}
 assert.ok(caught instanceof AggregateError);assert.match(String((caught as AggregateError).errors[0]),/synthetic_actor_explain_error/u);
 assert.match(String((caught as AggregateError).errors[1]),/25P02/u);assert.equal(writes,1);assert.equal(events.includes('rollback'),false);
 assert.equal(client.listenerCount('notice'),0);
}));

test('function-stat setup failure falls back before the original answers write exactly once',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failStatsBefore:true});let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='setup_unavailable');assert.equal(captured.observation.function_stats?.status,'setup_unavailable');
 assert.equal(captured.observation.function_stats?.read_after_ms,null);assert.ok(events.indexOf('rollback')<events.indexOf('write'));
 assert.equal(events.filter(x=>x==='write').length,1);assert.equal(client.listenerCount('notice'),0);
}));

test('post-write function-stat failure propagates without replay or rollback',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events,restores,oldValues}=fakeDmlPlanClient({failStatsAfter:true});let writes=0;
 await assert.rejects(captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic_function_stats_error/u);
 assert.equal(writes,1);assert.equal(events.includes('rollback'),false);assert.equal(client.listenerCount('notice'),0);
 assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
}));

test('stats-read error remains primary when aborted-transaction cleanup also fails',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failStatsAfter:true,restoreFailsAfterStatsError:true});let writes=0;
 let caught:unknown;try{await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});}catch(error){caught=error;}
 assert.ok(caught instanceof AggregateError);assert.equal((caught as AggregateError).errors.length,2);
 assert.match(String((caught as AggregateError).errors[0]),/synthetic_function_stats_error/u);
 assert.match(String((caught as AggregateError).errors[1]),/25P02/u);
 assert.equal(writes,1);assert.equal(events.includes('rollback'),false);assert.equal(client.listenerCount('notice'),0);
}));

test('reserve INSERT capture labels proposal batches distinctly from answer rows',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient();let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{
  writes++;events.push('write');client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':'INSERT INTO signal_labeling_calls ...',
   'Execution Time':62,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1},
   Triggers:[{'Trigger Name':'mass_labeling_call_root',Relation:'signal_labeling_calls',Time:8.5,Calls:256}]})});return{rowCount:256};},
  query_hash:'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='captured');
 assert.equal(captured.observation.batch_unit,'call_proposals');assert.equal(captured.observation.batch_size,256);
 assert.equal(captured.observation.plans[0]?.triggers[0]?.name,'mass_labeling_call_root');
}));

test('reserve INSERT setup fallback keeps the call-proposal batch unit and runs the write once',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failLoad:true});let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='setup_unavailable');
 assert.equal(captured.observation.batch_unit,'call_proposals');assert.equal(captured.observation.reason,'auto_explain_load_unavailable');
 assert.ok(events.indexOf('rollback')<events.indexOf('write'));assert.equal(client.listenerCount('notice'),0);
}));

test('DML read-only scope mismatch falls back before write, while DML and cleanup errors never replay or leave a listener',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const hash='sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b';
 const readonly=fakeDmlPlanClient({readOnly:'on'});let fallbackWrites=0;
 const fallback=await captureDmlPlanQueryV1({client:readonly.client,query:async()=>{fallbackWrites++;readonly.events.push('write');return{rowCount:256};},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(fallbackWrites,1);assert.ok(fallback.observation?.status==='setup_unavailable');assert.equal(fallback.observation.reason,'transaction_scope_unverified');
 assert.ok(readonly.events.indexOf('rollback')<readonly.events.indexOf('write'));assert.equal(readonly.client.listenerCount('notice'),0);
 const queryError=fakeDmlPlanClient();let failedWrites=0;
 await assert.rejects(captureDmlPlanQueryV1({client:queryError.client,query:async()=>{failedWrites++;queryError.events.push('write');throw Error('synthetic_dml_error');},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic_dml_error/u);
 assert.equal(failedWrites,1);assert.equal(queryError.client.listenerCount('notice'),0);assert.equal(queryError.events.includes('rollback'),false);
 const cleanupError=fakeDmlPlanClient({failRestore:true});let cleanupWrites=0;
 await assert.rejects(captureDmlPlanQueryV1({client:cleanupError.client,query:async()=>{cleanupWrites++;cleanupError.events.push('write');return{rowCount:256};},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic restore failure/u);
 assert.equal(cleanupWrites,1);assert.equal(cleanupError.client.listenerCount('notice'),0);assert.equal(cleanupError.events.includes('rollback'),false);
}));

const CANONICAL_SIGNATURES=['public.signal_labeling_digest_v1(jsonb)','public.signal_labeling_json_v1(jsonb)','public.signal_listening_statement_roots_v1(uuid[])'];
for(const queryHash of ['sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b','sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd']){
 test('canonical DML stats are transaction-local, bounded by exact signatures and never launch actor diagnostics: '+queryHash,async()=>withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events,statements,functionStatLookups,restores,oldValues}=fakeDmlPlanClient();let writes=0;
  const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},query_hash:queryHash,batch_size:256,
   query_values:['not-an-answer-bind',JSON.stringify([{call_id:'11111111-1111-4111-8111-111111111111'}])],database:'noisia_mfp_ci',role:'postgres',env:process.env});
  assert.equal(writes,1);assert.deepEqual(functionStatLookups,[CANONICAL_SIGNATURES,CANONICAL_SIGNATURES]);
  assert.ok(events.indexOf('stats-before')<events.indexOf('release'));assert.ok(events.indexOf('release')<events.indexOf('write'));assert.ok(events.indexOf('write')<events.indexOf('stats-after'));
  assert.ok(!statements.some(sql=>sql.includes('LEFT JOIN pg_stat_user_functions')||sql.startsWith('EXPLAIN ')||sql.includes('reset')||sql.includes('clear_snapshot')));
  const stats=captured.observation?.function_stats;assert.ok(stats);assert.equal(stats.view,'pg_stat_xact_user_functions');assert.equal(stats.scope,'same_backend_current_transaction_delta');
  assert.equal(stats.measured_work,'original_dml_and_all_triggers');assert.equal(stats.cpu_time,false);assert.equal(stats.recursive_calls_are_mentions,false);
  assert.ok(captured.observation&&captured.observation.status!=='setup_unavailable');
  assert.equal(captured.observation.actor_function_diagnostic,undefined);assert.equal(client.listenerCount('notice'),0);
  assert.deepEqual(stats.deltas.map(row=>row.signature),CANONICAL_SIGNATURES);
  assert.deepEqual(stats.deltas[0],{signature:CANONICAL_SIGNATURES[0],status:'stats_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null},'an inline SQL digest may remain unobserved, not zero');
  assert.deepEqual(stats.deltas[1],{signature:CANONICAL_SIGNATURES[1],status:'captured',baseline:'transaction_local_row_absent_zero_before_dml',calls:30,total_time_ms:10,self_time_ms:4});
  assert.equal(stats.deltas[2]?.calls,1);assert.equal(stats.deltas[2]?.baseline,'observed_before');
  assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
 }));
 test('canonical DML stats fallback and post-write failure never replay the original: '+queryHash,async()=>withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');
  for(const failStatsAfter of [false,true]){const {client,events}=fakeDmlPlanClient(failStatsAfter?{failStatsAfter:true}:{failStatsBefore:true});let writes=0;
   const capture=()=>captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},query_hash:queryHash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
   if(failStatsAfter)await assert.rejects(capture,/synthetic_function_stats_error/);else{const result=await capture();assert.equal(result.observation?.function_stats?.status,'setup_unavailable');assert.ok(events.indexOf('rollback')<events.indexOf('write'));}
   assert.equal(writes,1);assert.equal(client.listenerCount('notice'),0);
  }
 }));
}
test('canonical counters keep absent lookups and after-unobserved data unknown and reject a backwards counter',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client}=fakeDmlPlanClient({missingSignatures:[CANONICAL_SIGNATURES[0]!],unobservedSignatures:[CANONICAL_SIGNATURES[1]!],counterRegressionSignatures:[CANONICAL_SIGNATURES[2]!]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.deepEqual(captured.observation?.function_stats?.deltas.map(row=>[row.status,row.calls,row.total_time_ms,row.self_time_ms]),[['lookup_unobserved',null,null,null],['stats_unobserved',null,null,null],['counter_invalid',null,null,null]]);
}));

test('canonical statistic signatures resolve source helpers, including the real JSON canonicalizer',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/migrations/0223_signal_mention_facets.sql'),'utf8');
 const roots=await readFile(join(target,'infrastructure/db/migrations/0318_signal_listening_statement_population.sql'),'utf8');
 assert.match(source,/CREATE FUNCTION signal_labeling_json_v1\(value jsonb\) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT/u);
 assert.match(source,/CREATE FUNCTION signal_labeling_digest_v1\(value jsonb\) RETURNS text LANGUAGE sql IMMUTABLE STRICT/u);
 assert.match(roots,/CREATE FUNCTION signal_listening_statement_roots_v1\(ids uuid\[\]\) RETURNS uuid\[\]/u);
 assert.ok(!source.includes('signal_labeling_canonical_json_v1'));
});

test('invalid pre-write observed counters cannot become a transaction-zero baseline',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const signature=CANONICAL_SIGNATURES[2]!;const {client}=fakeDmlPlanClient({invalidBeforeSignatures:[signature]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.deepEqual(captured.observation?.function_stats?.deltas.find(row=>row.signature===signature),{signature,status:'counter_invalid',baseline:null,calls:null,total_time_ms:null,self_time_ms:null});
}));


test('neutral mode is explicit, rejects CPU flags and preserves legacy profiler requirement',()=>{
 assert.equal(diagnosticModeV1({}),'legacy');assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'neutral_only'}),'neutral_only');
 assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'sql_frontier_only'}),'sql_frontier_only');
 assert.throws(()=>diagnosticModeV1({R16_DIAGNOSTIC_MODE:'silently-disable'}),/mode_invalid/u);
 assert.doesNotThrow(()=>assertDiagnosticExecArgsV1('neutral_only',['--import','tsx'],'/unused'));
 assert.throws(()=>assertDiagnosticExecArgsV1('neutral_only',['--cpu-prof'],'/unused'),/profiler_forbidden/u);
 assert.throws(()=>assertDiagnosticExecArgsV1('legacy',[],'/unused'),/not_enabled/u);
});

test('neutral frontier records exact batch/sequence/stream/connect correlation and redacts rows, identifiers and query text',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});
 let physicalQueries=0,releases=0,resolveConnect:()=>void=()=>{};
 const connected=new Promise<void>(r=>{resolveConnect=r;});
 const client={processID:123,async query(){physicalQueries++;return{rows:[{secret:'private returned row'}]};},release(){releases++;},on(){throw Error('must not install auto_explain notice listener');},off(){}};
 const db=observer.wrapDatabase({async connect(){await connected;return client;},async query(){physicalQueries++;return{rows:[]};}});
 const store=observer.wrapStore({async markSubmitting(_run:unknown,_rows:unknown[]){const c=await db.connect();try{return await c.query('SELECT sensitive_col FROM secret WHERE id=$1',['private bind']);}finally{c.release();}}});
 try{
  observer.beginJob(1);assert.throws(()=>observer.assertStreamObserved(),/hook_unobserved/u);
  const metrics={in_flight:3,reserved_working_bytes:4096,buffered_responses:2,active_flushes:1,client_id:'private client'};
  observer.observeStream(metrics);metrics.in_flight=999;
  const rows=[{id:'private call'},{id:'private call2'}],pending=store.markSubmitting({id:'private run'},rows);
  resolveConnect();await pending;observer.assertStreamObserved();
  const snapshot=observer.snapshot(),events=snapshot.events as any[],op=events.find(e=>e.kind==='store'),connect=events.find(e=>e.kind==='connect'),query=events.find(e=>e.kind==='query');
  assert.equal(op.batch_size,2);assert.equal(op.batch_unit,'argument_rows');assert.equal(op.last_stream_before.in_flight,3);
  assert.equal(op.sequence,query.store_sequence);assert.equal(op.sequence,connect.store_sequence);assert.equal(connect.pid,123);
  assert.equal(connect.status,'acquired');assert.ok(connect.wait_ms>=0);assert.ok(connect.start_ms>=op.start_ms&&connect.end_ms<=op.end_ms);
  assert.equal(physicalQueries,1);assert.equal(releases,1);assert.equal(snapshot.inner_plan_observations.length,0);assert.equal(snapshot.dml_plan_observations.length,0);
  const wire=JSON.stringify(snapshot);for(const x of ['private','sensitive_col','secret WHERE','client_id'])assert.ok(!wire.includes(x));
  observer.beginJob(2);assert.equal(observer.snapshot().last_stream,null);assert.throws(()=>observer.assertStreamObserved(),/hook_unobserved/u);
  observer.observeStream({in_flight:0,reserved_working_bytes:0,buffered_responses:0,active_flushes:0});observer.assertStreamObserved();
 }finally{await observer.close();}
});

test('frontier preserves original connect failure and records failure metadata without secrets',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});const primary=new Error('private failure');
 try{const db=observer.wrapDatabase({async connect(){throw primary;},async query(){return{rows:[]};}});
  const store=observer.wrapStore({async reserve(){return db.connect();}});await assert.rejects(store.reserve({},[{}]),e=>e===primary);
  const events=observer.snapshot().events as any[];assert.equal(events.find(x=>x.kind==='connect').status,'failed');
  assert.equal(events.find(x=>x.kind==='store').status,'failed');assert.ok(!JSON.stringify(events).includes('private failure'));
 }finally{await observer.close();}
});


test('neutral mode runs a whitelisted mark DML exactly once without plan/stat/GUC instrumentation',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const match=source.match(/`(UPDATE signal_labeling_calls SET status='submitting',[\s\S]*?RETURNING id)`\s*,\s*\[run\.id,\s*calls\.map/u);assert.ok(match);
 const {createListeningObserver,dmlPlanQuerySpec,queryHash}=await import('./observer.mjs');assert.ok(dmlPlanQuerySpec(queryHash(match[1])));
 const observer=createListeningObserver({neutral_only:true});let calls=0;
 const client={processID:123,async query(sql:string){calls++;assert.equal(sql,match[1]);return{rows:[]};},on(){throw Error('plan listener forbidden');},off(){}};
 try{
  observer.setInnerPlanRootCount(4096);const db=observer.wrapDatabase({async connect(){return client;},query:client.query});const c=await db.connect();
  await c.query(match[1],['synthetic-run',Array.from({length:256},(_,i)=>`synthetic-${i}`)]);
  assert.equal(calls,1);assert.equal(observer.snapshot().dml_plan_observations.length,0);assert.equal(observer.snapshot().inner_plan_observations.length,0);
 }finally{await observer.close();}
});

test('invalid or missing stream metadata never becomes a complete native stream observation',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});
 try{observer.beginJob(1);observer.observeStream({in_flight:'1',reserved_working_bytes:0,buffered_responses:0,active_flushes:0});
  assert.equal(observer.snapshot().invalid_stream_observations,1);assert.equal(observer.snapshot().last_stream,null);
  assert.throws(()=>observer.assertStreamObserved(),/unobserved_or_invalid/u);
 }finally{await observer.close();}
});


test('neutral mode also bypasses automatic SELECT plan capture for the real eligible metadata query',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const template=source.match(/`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?LIMIT \$6)`/u);
 assert.ok(template);
 const refs=[...new Set([...template[1]!.matchAll(/\$\{([A-Za-z_]+)\}/gu)].map(m=>m[1]!))].sort();
 assert.ok(JSON.stringify(refs)===JSON.stringify(['noHumanDecision','unresolvedScope'])
  ||JSON.stringify(refs)===JSON.stringify(['pendingScope','population']),'unknown metadata template format');
 let sql=template[1]!;
 for(const name of refs){
  // Only the two known source formats; literal interpolation, never eval or a copied query.
  const value=source.match(new RegExp('const '+name+'=(?:`([^`]+)`|"([^\"]+)");','u'));
  assert.ok(value,'metadata literal missing');const literal=value[1]??value[2];assert.ok(literal&&!literal.includes('${'));
  sql=sql.replaceAll('${'+name+'}',literal);
 }
 assert.ok(!sql.includes('${'),'unresolved metadata interpolation');
 const {createListeningObserver,queryHash,innerPlanQueryLabel}=await import('./observer.mjs');
 if(refs[0]==='noHumanDecision')assert.equal(innerPlanQueryLabel(queryHash(sql)),'metadata');
 else{
  assert.equal(queryHash(sql),'sha256:1c6942d84ff9c1edf7f35f28e0ba14d854fac1c51a64b2bbbdd51c1f5abc6d5f');
  assert.equal(innerPlanQueryLabel(queryHash(sql)),null,'historical metadata is not in the current capture allowlist');
 }
 const observer=createListeningObserver({neutral_only:true});let calls=0;
 const client={processID:123,async query(actual:string){calls++;assert.equal(actual,sql);return{rows:[]};},on(){throw Error('SELECT plan listener forbidden');},off(){}};
 try{observer.setInnerPlanRootCount(4096);const db=observer.wrapDatabase({async connect(){return client;},query:client.query});const c=await db.connect();await c.query(sql,[]);
  assert.equal(calls,1);assert.equal(observer.snapshot().inner_plan_observations.length,0);
 }finally{await observer.close();}
});
