import assert from 'node:assert/strict';
import {chmod,mkdtemp,mkdir,readFile,stat,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createMainThreadProfileCaptureV1,MAIN_THREAD_PROFILE_INTERVAL_US_V1,sanitizeV8MainThreadProfileV1,
 createProcMainThreadCpuReaderV1,compareProcMainThreadCpuV1,MAIN_THREAD_CLK_TCK_TIMEOUT_MS_V1,readClockTicksV1} from './main-thread-profile.mjs';
import {assertDiagnosticExecArgsV1,assertListeningResourceProfileV1,assertListeningSmallGuardV1,assertProfileOnlyManualTargetV1,
 assertProfileOnlyCDefaultBeforeV1,diagnosticModeV1,listeningResourceProfileV1,PROFILE_ONLY_TARGET_SHA_V1,
 writeProfileOnlyPgOwnershipMarkerV1} from './run.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {PROFILE_ONLY_REQUIRED_PROBE_FILES_V1,validatePgProfileArtifactBytesV1,validateProfileOnlyProbeSealV1,
 validateProfileOnlyRunV1} from './profile-only-envelope.mjs';
import {PG_CPU_INSPECT_FORMAT_V1} from './profile-pg-cpu.mjs';

const fakeProfile={startTime:100,endTime:350,nodes:[
 {id:1,callFrame:{functionName:'main',url:'file:///private/study/body.json',lineNumber:4,columnNumber:2},hitCount:1,children:[2]},
 {id:2,callFrame:{functionName:'serve',url:'file:///private/study/query.sql',lineNumber:8,columnNumber:3},hitCount:2,children:[]},
],samples:[1,2,2],timeDeltas:[100,100,50]};
const resource=()=>({userCPUTime:10,systemCPUTime:2,maxRSS:123,sharedMemorySize:0,unsharedDataSize:0,unsharedStackSize:0,
 minorPageFault:0,majorPageFault:0,swappedOut:0,fsRead:0,fsWrite:0,ipcSent:0,ipcReceived:0,signalsCount:0,
 voluntaryContextSwitches:0,involuntaryContextSwitches:0});

function fakeSession(events:string[],failMethod?:string){
 return{connect(){events.push('connect');},disconnect(){events.push('disconnect');},post(method:string,paramsOrCallback?:unknown,callback?:((error:Error|null,result?:unknown)=>void)){
  events.push(`${method}:${typeof paramsOrCallback==='function'?'callback':JSON.stringify(paramsOrCallback??null)}`);
  const done=typeof paramsOrCallback==='function'?paramsOrCallback:callback;
  queueMicrotask(()=>{
   if(method===failMethod){done?.(new Error('synthetic inspector failure'));return;}
   done?.(null,method==='Profiler.stop'?{profile:fakeProfile}:{});
  });
 }};
}

test('profile-only Inspector capture samples one main-thread window and writes a private sanitized profile',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r16-profile-only-')),path=join(dir,'v8-profile.json');
 const events:string[]=[],ticks=[100n,110n,120n,130n,140n,150n,160n,170n,180n,190n,200n,210n,220n,230n,240n,250n];let tick=0;
 const capture=createMainThreadProfileCaptureV1({sessionFactory:()=>fakeSession(events) as never,monotonicNs:()=>ticks[tick++]!,
  cpuUsage:()=>({user:100+tick,system:20+tick}),resourceUsage:resource,isMainThread:true,
  threadCpuReader:()=>({status:'captured',starttime_ticks:'77',user_ticks:'12',system_ticks:'3',ticks_per_second:100})});
 try{
  const started=await capture.start();const descriptor=await capture.stop(path);
  assert.equal(capture.state,'stopped');assert.equal(started.scope,'classification_and_serving');
  assert.equal(descriptor.contract,'r16-main-thread-profile-capture-v1');assert.equal(descriptor.coverage,'main_thread_only');
  assert.equal(descriptor.scope,'classification_and_serving_boundary_bracketed');
  assert.equal(descriptor.worker_thread_cpu,'unknown');assert.equal((descriptor.sampling as any).interval_us,MAIN_THREAD_PROFILE_INTERVAL_US_V1);
  assert.equal((descriptor.window as any).profile_sampling_overlap,'unknown_v8_clock_bridge');
  assert.equal((descriptor.process_cpu as any).delta_us.total,6);
  assert.deepEqual(events.map((value)=>value.split(':')[0]),['connect','Profiler.enable','Profiler.setSamplingInterval','Profiler.start','Profiler.stop','disconnect']);
  const contents=await readFile(path,'utf8'),parsed=JSON.parse(contents);
  assert.equal(parsed.urls_embedded,false);assert.equal(parsed.nodes[0].function_name,'main');
  assert.doesNotMatch(contents,/private\/study|body\.json|query\.sql/u);
  assert.equal((await stat(path)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('profile-only rejects malformed V8 samples rather than truncating or fabricating a window',()=>{
 assert.throws(()=>sanitizeV8MainThreadProfileV1({...fakeProfile,timeDeltas:[100]}),/main_thread_profile_sample_delta_count_mismatch/u);
 assert.throws(()=>sanitizeV8MainThreadProfileV1({...fakeProfile,nodes:[{...fakeProfile.nodes[0],callFrame:{functionName:'x'.repeat(257)}}]}),
  /main_thread_profile_function_name_invalid/u);
 assert.throws(()=>sanitizeV8MainThreadProfileV1({...fakeProfile,samples:[999,2,2]}),/main_thread_profile_sample_node_missing/u);
});

test('profile-only main-thread proc reader verifies the PID/starttime pair and reports ticks without wall conversion',async()=>{
 const fixtures={
  '/proc/self/task/42/stat':{pid:42,comm:'node (worker?)',state:'R',utime_ticks:'17',stime_ticks:'4',starttime_ticks:'900'},
  '/proc/self/stat':{pid:42,comm:'node',state:'S',utime_ticks:'99',stime_ticks:'20',starttime_ticks:'900'},
 };
 const reader=createProcMainThreadCpuReaderV1({pid:42,isMainThread:true,parseProcStatV1:(text)=>JSON.parse(text),
  readText:(path)=>JSON.stringify(fixtures[path as keyof typeof fixtures]),getClockTicks:()=>100});
 const start=await reader(),end={...start,user_ticks:'22',system_ticks:'5'};
 assert.equal(start.status,'captured');assert.equal((start as any).total_ticks,'21');
 assert.equal(compareProcMainThreadCpuV1(start,end).status,'captured');
 assert.equal((compareProcMainThreadCpuV1(start,end) as any).total_ticks,'6');
 assert.equal((compareProcMainThreadCpuV1(start,end) as any).conversion,'ticks_only_no_wall_clock_attribution');
 const badReader=createProcMainThreadCpuReaderV1({pid:42,isMainThread:true,parseProcStatV1:(text)=>JSON.parse(text),
  readText:(path)=>JSON.stringify(path==='/proc/self/task/42/stat'?fixtures['/proc/self/task/42/stat']:{...fixtures['/proc/self/stat'],starttime_ticks:'901'}),
  getClockTicks:()=>100});
 await assert.rejects(badReader(),/main_thread_proc_identity_mismatch/u);
 assert.equal(compareProcMainThreadCpuV1(start,{...end,pid:43}).status,'unknown');
});

test('profile-only getconf clock query uses a bounded process call and validates its result',()=>{
 let call:unknown[]=[];
 assert.equal(readClockTicksV1((file,args,options)=>{call=[file,args,options];return '100\n';}),100);
 assert.deepEqual(call.slice(0,2),['getconf',['CLK_TCK']]);
 assert.deepEqual(call[2],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:MAIN_THREAD_CLK_TCK_TIMEOUT_MS_V1,maxBuffer:128});
 assert.throws(()=>readClockTicksV1(()=> 'not-a-number'),/main_thread_proc_clk_tck_invalid/u);
});

test('profile-only Inspector cleanup is terminal after a sampling failure and never reports a profile',async()=>{
 const events:string[]=[],capture=createMainThreadProfileCaptureV1({sessionFactory:()=>fakeSession(events,'Profiler.start') as never,
  monotonicNs:()=>1n,cpuUsage:()=>({user:1,system:1}),resourceUsage:resource,isMainThread:true});
 await assert.rejects(capture.start(),/main_thread_profile_profiler_start_failed/u);
 assert.equal(capture.state,'failed');assert.equal(events.at(-1),'disconnect');
 await assert.rejects(capture.stop('/must/not/be/written'),/main_thread_profile_stop_state_invalid/u);
});

test('profile-only size limit fails closed without silently truncating or leaving partial JSON',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r16-profile-only-cap-')),path=join(dir,'v8-profile.json');
 const capture=createMainThreadProfileCaptureV1({sessionFactory:()=>fakeSession([]) as never,monotonicNs:(()=>{let n=0n;return()=>n+=10n;})(),
  cpuUsage:()=>({user:1,system:1}),resourceUsage:resource,isMainThread:true,maxProfileBytes:32});
 try{
  await capture.start();await assert.rejects(capture.stop(path),/main_thread_profile_size_limit_exceeded/u);
  await assert.rejects(readFile(path));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('profile-only rejects an Inspector session outside the main thread',async()=>{
 const capture=createMainThreadProfileCaptureV1({sessionFactory:()=>fakeSession([]) as never,isMainThread:false});
 await assert.rejects(capture.start(),/main_thread_profile_requires_main_thread/u);
 assert.equal(capture.state,'created');
});

const validProfileEnv:NodeJS.ProcessEnv={R16_PROFILE_ONLY_WORKFLOW:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
 R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g',
 R16_DIAGNOSTIC_TARGET_REF_REQUESTED:PROFILE_ONLY_TARGET_SHA_V1,R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'f'.repeat(40),
 R16_DIAGNOSTIC_MAINLAB_DEFAULT_PRECHECK:'true',R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'false',
 R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false',R16_DIAGNOSTIC_STATEMENT_SHARED_WIRE_ORACLE:'false',RESERVE_SHARED_SMOKE:'false'};

test('profile-only mode is manual, candidate-pinned, C-prechecked and cannot accept CLI CPU or heap flags',()=>{
 assert.equal(diagnosticModeV1({...validProfileEnv,R16_DIAGNOSTIC_MODE:'profile_only'}),'profile_only');
 assertProfileOnlyManualTargetV1(validProfileEnv);
 assertListeningSmallGuardV1({...validProfileEnv,R16_DIAGNOSTIC_MODE:'profile_only',NOISIA_R16_SMALL_DIAGNOSTIC:'true',
  GITHUB_WORKSPACE:'/tmp/work',R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
  DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci',R16BENCH_REDIS_URL:'redis://127.0.0.1:6379',
  R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/artifacts/r16-listening-profile-only/run.json',
  R16_DIAGNOSTIC_CPU_PROFILE_DIR:'/tmp/work/artifacts/r16-listening-profile-only/no-cli-cpu-prof'},['--run']);
 assert.equal(listeningResourceProfileV1(validProfileEnv,'profile_only'),'bounded_2g');
 assert.throws(()=>assertProfileOnlyManualTargetV1({...validProfileEnv,GITHUB_EVENT_NAME:'pull_request'}),/profile_only_requires_manual_dispatch/u);
 assert.throws(()=>assertProfileOnlyManualTargetV1({...validProfileEnv,R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'e'.repeat(40)}),/profile_only_target_sha_invalid/u);
 assert.throws(()=>assertProfileOnlyManualTargetV1({...validProfileEnv,R16_DIAGNOSTIC_MAINLAB_DEFAULT_PRECHECK:'false'}),/profile_only_c_default_precheck_required/u);
 assert.throws(()=>assertDiagnosticExecArgsV1('profile_only',['--cpu-prof'],'/private/profile'),/profile_only_second_profiler_forbidden/u);
 assert.throws(()=>assertDiagnosticExecArgsV1('profile_only',['--heap-prof'],'/private/profile'),/profile_only_second_profiler_forbidden/u);
 assert.throws(()=>assertDiagnosticExecArgsV1('profile_only',['--prof'],'/private/profile'),/profile_only_second_profiler_forbidden/u);
});

test('profile-only accepts only the real C pg_proc precheck sealed to the six target files',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'profile-only tests require the checked out target source');
 const sourcePaths=['infrastructure/db/migrations/0330_signal_listening_statement_shared_wire.sql',
  'infrastructure/db/migrations/0331_signal_listening_statement_payload.sql',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.fixture.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.postgres.test.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.test.ts'];
 const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
 const runtime={contract:'r16-statement-shared-wire-default-runtime-v1',target:'public.signal_listening_statement_money_v1()',runtime_kind:'C',
  observed_via:'pg_proc',default_arm:'C',migration:'0331_signal_listening_statement_payload.sql',
  source_sha256:'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5',
  prosrc_sha256:'5ed4fa353803122208408b1f66a29b9fdea8599b86d0d0b8de3bb18d5b2155fa',
  actual_prosrc_sha256:'5ed4fa353803122208408b1f66a29b9fdea8599b86d0d0b8de3bb18d5b2155fa',
  metadata:{proconfig:['search_path=public, extensions, pg_temp'],lanname:'plpgsql',prosecdef:false,return_type:'trigger',pronargs:0,
   proretset:false,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f'},actual_pg_proc_checked:true,phase:'before'};
 const shaFiles=[];for(const path of sourcePaths)shaFiles.push({path,sha256:sha(await readFile(join(target,path)))});
 const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:target,encoding:'utf8'}).trim();
 const dir=await mkdtemp(join(tmpdir(),'r16-profile-only-mainlab-')),receiptPath=join(dir,'before.json');
 const receipt={phase:'before',requested_target_sha:targetSha,target_git_sha_before:targetSha,target_git_sha_after:targetSha,
  source_set:'six',source_files:shaFiles,runtime};
 try{
  await writeFile(receiptPath,JSON.stringify(receipt));
  assert.equal((await assertProfileOnlyCDefaultBeforeV1(target,receiptPath,targetSha)).runtime.runtime_kind,'C');
  await writeFile(receiptPath,JSON.stringify({...receipt,runtime:{...runtime,runtime_kind:'B'}}));
  await assert.rejects(assertProfileOnlyCDefaultBeforeV1(target,receiptPath,targetSha),/statement_default_runtime_kind_mismatch/u);
  await writeFile(receiptPath,JSON.stringify({...receipt,source_files:shaFiles.slice(1)}));
  await assert.rejects(assertProfileOnlyCDefaultBeforeV1(target,receiptPath,targetSha),/profile_only_mainlab_source_paths_invalid/u);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('profile-only ownership marker requires accredited PG17 loopback and stores no system identifier',async()=>{
 const target=await mkdtemp(join(tmpdir(),'r16-profile-only-marker-'));
 const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'profile-only',
  DATABASE_URL:'postgresql://postgres:private@127.0.0.1:54321/noisia_mfp_ci'};
 const container={name:'/r16-benchmark-pg17',id:'a'.repeat(64),running:true,restarting:false,restart_count:0,
  started_at:'2026-11-16T00:00:00Z',image:'pgvector/pgvector:pg17',image_id:'sha256:'+'b'.repeat(64),
  project:'r16bench-benchmark-pg17',service:'postgres',db_ok:true,user_ok:true,pid_mode:'',privileged:false,
  mounts:[{type:'volume',name:'r16bench-benchmark-pg17_postgres-data',destination:'/var/lib/postgresql/data'}],
  ports:[{HostIp:'127.0.0.1',HostPort:'54321'}]};
 const pool={query:async()=>({rows:[{database:'noisia_mfp_ci',version:170005,system_identifier:'7400000000000000001',pgvector:true}]})};
 const localPg={assertR16LocalPostgresPoolV1(value:unknown){assert.equal(value,pool);}};
 try{
  const inspectContainer=(name:string,options:{endpoint:string;format:string;timeoutMs:number;maxBytes:number})=>{
   assert.equal(name,'r16-benchmark-pg17');assert.deepEqual(options,{endpoint:'unix:///var/run/docker.sock',
    format:PG_CPU_INSPECT_FORMAT_V1,timeoutMs:2000,maxBytes:16384});return container;};
  const marker=await writeProfileOnlyPgOwnershipMarkerV1({targetRoot:target,targetSha:PROFILE_ONLY_TARGET_SHA_V1,pool,localPg,env,
   inspectFormat:PG_CPU_INSPECT_FORMAT_V1,inspectContainer});
  assert.equal(marker.marker.contract,'r16-pg-cpu-owned-lab-v1');
  assert.equal(marker.marker.postgres_accredited,true);
  const stored=await readFile(marker.path,'utf8');assert.doesNotMatch(stored,/7400000000000000001|private/u);
  assert.equal(JSON.parse(stored).postgres_system_identifier_sha256,createHash('sha256').update('7400000000000000001').digest('hex'));
  assert.equal((await stat(marker.path)).mode&0o777,0o600);
  await assert.rejects(writeProfileOnlyPgOwnershipMarkerV1({targetRoot:target,targetSha:PROFILE_ONLY_TARGET_SHA_V1,pool,localPg,
   env:{...env,DATABASE_URL:'postgresql://postgres:private@0.0.0.0:54321/noisia_mfp_ci'},inspectFormat:PG_CPU_INSPECT_FORMAT_V1,inspectContainer}),/profile_only_marker_loopback_invalid/u);
  await assert.rejects(writeProfileOnlyPgOwnershipMarkerV1({targetRoot:target,targetSha:PROFILE_ONLY_TARGET_SHA_V1,pool,localPg,env,
   inspectFormat:PG_CPU_INSPECT_FORMAT_V1,inspectContainer:()=>({...container,project:'foreign'})}),/profile_only_marker_project_invalid/u);
 }finally{await rm(target,{recursive:true,force:true});}
});

function validProfileRun(){
 return{contract_version:'r16-listening-profile-only-run-v1',status:'profiled',diagnostic_only:true,profiling_only:true,h1_accepted:false,
  diagnostic_mode:'profile_only',target_ref_requested:PROFILE_ONLY_TARGET_SHA_V1,target_head_before:PROFILE_ONLY_TARGET_SHA_V1,
  target_head_after:PROFILE_ONLY_TARGET_SHA_V1,probe_ref_requested:'f'.repeat(40),probe_head_before:'f'.repeat(40),probe_head_after:'f'.repeat(40),
  probe_file_sha256_before:{workflow:'a'},probe_file_sha256_after:{workflow:'a'},source_tree_sha256_before:'source',source_tree_sha256_after:'source',
  source_status_sha256:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  resource_profile:{requested_profile:'bounded_2g',execution:{max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096}},
  native:{status:'completed',resolved_roots:4096,job_count:3,reserved_micro_usd:'0',unknown_micro_usd:'0',
   classification_start_hrtime_ns:'100',classification_end_hrtime_ns:'200'},profile_window:{scope:'classification_and_serving',clock:'process.hrtime.bigint',
    start_hrtime_ns:'100',end_hrtime_ns:'200',start_performance_ms:1,end_performance_ms:2},
  observed_http_latency:{count:8192},expected_http_requests:8192,
  node_profile:{contract:'r16-main-thread-profile-capture-v1',status:'captured',coverage:'main_thread_only',worker_thread_cpu:'unknown',
   window:{profile_sampling_overlap:'unknown_v8_clock_bridge'}},
  postgres_profile:{contract:'r16-pg-cpu-profile-v1',target_sha:PROFILE_ONLY_TARGET_SHA_V1,status:'partial',interval_ms:250}};
}

test('profile-only envelope validation binds the exact mini, C target, bounded tuple and unknown clock bridge',()=>{
 const base=validProfileRun();
 assert.equal(validateProfileOnlyRunV1(base,{targetSha:PROFILE_ONLY_TARGET_SHA_V1,probeSha:'f'.repeat(40)}),base);
 assert.throws(()=>validateProfileOnlyRunV1({...base,h1_accepted:true},{targetSha:PROFILE_ONLY_TARGET_SHA_V1,probeSha:'f'.repeat(40)}),
  /profile_only_run_h1_invalid/u);
 assert.throws(()=>validateProfileOnlyRunV1({...base,native:{...base.native,job_count:2}},
  {targetSha:PROFILE_ONLY_TARGET_SHA_V1,probeSha:'f'.repeat(40)}),/profile_only_job_count_invalid/u);
 assert.throws(()=>validateProfileOnlyRunV1({...base,resource_profile:{...base.resource_profile,execution:{...base.resource_profile.execution,max_buffered_bytes:536870912}}},
  {targetSha:PROFILE_ONLY_TARGET_SHA_V1,probeSha:'f'.repeat(40)}),/profile_only_effective_profile_invalid/u);
 assert.throws(()=>validateProfileOnlyRunV1({...base,node_profile:{...base.node_profile,window:{profile_sampling_overlap:'mapped'}}},
  {targetSha:PROFILE_ONLY_TARGET_SHA_V1,probeSha:'f'.repeat(40)}),/profile_only_v8_clock_bridge_claimed/u);
});

test('profile-only envelope requires every executable/helper source in the before/after probe seal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'r16-profile-seal-'));
 try{
  const hashes:Record<string,string>={};
  for(const [index,relative] of PROFILE_ONLY_REQUIRED_PROBE_FILES_V1.entries()){
   const path=join(root,relative);await mkdir(join(path,'..'),{recursive:true});
   const content=`fixture-${index}`;await writeFile(path,content,{mode:0o600});
   hashes[relative]=`sha256:${createHash('sha256').update(content).digest('hex')}`;
  }
  assert.equal(await validateProfileOnlyProbeSealV1(hashes,root),true);
  const omitted={...hashes};delete omitted[PROFILE_ONLY_REQUIRED_PROBE_FILES_V1[0]!];
  await assert.rejects(validateProfileOnlyProbeSealV1(omitted,root),/profile_only_required_probe_file_not_sealed/u);
  const drifted={...hashes,[PROFILE_ONLY_REQUIRED_PROBE_FILES_V1[1]!]:`sha256:${'0'.repeat(64)}`};
  await assert.rejects(validateProfileOnlyProbeSealV1(drifted,root),/profile_only_required_probe_file_changed/u);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('profile-only pg artifact receipt binds exact persisted pretty JSON bytes',()=>{
 const parsed={contract:'r16-pg-cpu-profile-v1',status:'partial',snapshots:[{status:'observed',sequence:1}]};
 const bytes=Buffer.from(`${JSON.stringify(parsed,null,2)}\n`,'utf8');
 assert.equal(validatePgProfileArtifactBytesV1({artifact_bytes:bytes.byteLength},bytes,parsed),true);
 assert.throws(()=>validatePgProfileArtifactBytesV1({artifact_bytes:Buffer.byteLength(JSON.stringify(parsed))},bytes,parsed),
  /profile_only_pg_receipt_size_mismatch/u);
 const drifted=Buffer.from(`${JSON.stringify({...parsed,status:'observed'},null,2)}\n`,'utf8');
 assert.throws(()=>validatePgProfileArtifactBytesV1({artifact_bytes:drifted.byteLength},drifted,parsed),
  /profile_only_pg_artifact_content_mismatch/u);
});

test('profile-only resource getter keeps its actual manual/C-target guard and derives bounded tuple through product code',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'profile-only getter requires checked out C target');
 const runtime=await import(pathToFileURL(join(target,'services/workers/src/providers/jev-streaming-runtime.ts')).href) as any;
 const env:NodeJS.ProcessEnv={R16_PROFILE_ONLY_WORKFLOW:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
  R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:PROFILE_ONLY_TARGET_SHA_V1,
  R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'f'.repeat(40),R16_DIAGNOSTIC_MAINLAB_DEFAULT_PRECHECK:'true',
  R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g',R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'false',
  R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false',R16_DIAGNOSTIC_STATEMENT_SHARED_WIRE_ORACLE:'false',RESERVE_SHARED_SMOKE:'false',
  NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_JEV_STREAM_MAX_IN_FLIGHT:'4096',NOISIA_JEV_STREAM_BUFFER_BYTES:'2147483648',
  NOISIA_JEV_STREAM_FLUSH_SIZE:'4096',NOISIA_JEV_STREAM_MAX_FLUSHES:'2',NOISIA_JEV_STREAM_FLUSH_INTERVAL_MS:'1000',
  NOISIA_JEV_STREAM_WINDOW_SIZE:'4096'};
 const expected={max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096};
 assert.equal(listeningResourceProfileV1(env,'profile_only'),'bounded_2g');
 assert.deepEqual(assertListeningResourceProfileV1('bounded_2g','profile_only',env,runtime.jevStreamingExecutionFromEnvV2),expected);
 for(const [key,value] of [['R16_PROFILE_ONLY_WORKFLOW','false'],['GITHUB_EVENT_NAME','push'],['R16_DIAGNOSTIC_TARGET_LABEL','baseline'],
  ['R16_DIAGNOSTIC_TARGET_REF_REQUESTED','a'.repeat(40)],['R16_DIAGNOSTIC_MAINLAB_DEFAULT_PRECHECK','false'],
  ['R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN','true'],['RESERVE_SHARED_SMOKE','true']] as const){
  assert.throws(()=>assertListeningResourceProfileV1('bounded_2g','profile_only',{...env,[key]:value},runtime.jevStreamingExecutionFromEnvV2));
 }
 assert.throws(()=>listeningResourceProfileV1({...env,R16_DIAGNOSTIC_RESOURCE_PROFILE:'baseline_512m'},'profile_only'),
  /profile_only_bounded_profile_required/u);
});

async function workflowStepBody(workflow:string,name:string){
 const marker=`      - name: ${name}`;const start=workflow.indexOf(marker);assert.ok(start>=0,`workflow step ${name} exists`);
 const next=workflow.indexOf('      - name: ',start+marker.length),section=workflow.slice(start,next<0?undefined:next).split(/\r?\n/u);
 const runLine=section.findIndex(line=>line==='        run: |');assert.ok(runLine>=0,`workflow step ${name} uses a shell block`);
 const body:string[]=[];for(const line of section.slice(runLine+1)){if(line==='' ){body.push('');continue;}if(!line.startsWith('          '))break;body.push(line.slice(10));}
 return body.join('\n').trimEnd();
}

test('profile-only workflow dispatch gate executes its real Bash and rejects any other target or event',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/r16-listening-profile-only.yml',import.meta.url),'utf8');
 const body=await workflowStepBody(workflow,'Validate fixed C target and reject provider credentials');
 const run=(event:string,target:string,probe='f'.repeat(40),extra:NodeJS.ProcessEnv={})=>spawnSync('bash',['-euo','pipefail','-c',body],{
  encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',EVENT_NAME:event,TARGET_REF:target,PROBE_REF:probe,...extra}});
 assert.equal(run('workflow_dispatch',PROFILE_ONLY_TARGET_SHA_V1).status,0);
 assert.notEqual(run('pull_request',PROFILE_ONLY_TARGET_SHA_V1).status,0);
 assert.notEqual(run('workflow_dispatch','a'.repeat(40)).status,0);
 assert.notEqual(run('workflow_dispatch',PROFILE_ONLY_TARGET_SHA_V1,'not-a-sha').status,0);
 const secret='synthetic-secret-value';const rejected=run('workflow_dispatch',PROFILE_ONLY_TARGET_SHA_V1,'f'.repeat(40),{ANTHROPIC_API_KEY:secret});
 assert.notEqual(rejected.status,0);assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`,new RegExp(secret,'u'));
 assert.doesNotMatch(workflow,/NOISIA_R16_(?:LISTENING_MONEY_BATCHES|RAW_PAGE_LOCKS|INPUT_BOUNDS)_PG/u,
  'profile-only must not repeat native acceptance suites');
 assert.match(workflow,/R16_DIAGNOSTIC_MODE: profile_only/u);assert.match(workflow,/NOISIA_JEV_STREAM_BUFFER_BYTES: '2147483648'/u);
 assert.match(workflow,/timeout 12m corepack pnpm exec node --import tsx/);
 assert.doesNotMatch(workflow,/--cpu-prof|--prof-process|--heap(?:-|\s)/u);
});

test('profile-only workflow bootstrap is restricted to the approved branch and workflow path',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/r16-listening-profile-only.yml',import.meta.url),'utf8');
 const push=workflow.match(/\n  push:\n([\s\S]*?)\n  workflow_dispatch:/u)?.[1];assert.ok(push,'bootstrap push trigger is present');
 assert.deepEqual([...push.matchAll(/^    branches:\n      - ([^\n]+)$/gmu)].map(match=>match[1]),['codex/r16-listening-profile-compose']);
 assert.deepEqual([...push.matchAll(/^      - (\.github\/workflows\/[^\n]+)$/gmu)].map(match=>match[1]),
  ['.github/workflows/r16-listening-profile-only.yml']);
 const registration=workflow.slice(workflow.indexOf('  register-workflow:'),workflow.indexOf('  profile-only:'));
 assert.match(registration,/if: github\.event_name == 'push'/u);
 assert.match(registration,/R16 profile-only workflow registered on the approved branch/u);
 assert.doesNotMatch(registration,/actions\/checkout|pnpm install|lab-up|postgres|DATABASE_URL/u);
 const profileJob=workflow.slice(workflow.indexOf('  profile-only:'));
 assert.match(profileJob,/if: github\.event_name == 'workflow_dispatch'/u,
  'the push registration event cannot start the profile run');
});

test('profile-only fresh-lab gate inventories daemon, project containers/volumes/networks and fixed Redis resources',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/r16-listening-profile-only.yml',import.meta.url),'utf8');
 const body=await workflowStepBody(workflow,'Require fresh profile-only Docker lab resources');
 const root=await mkdtemp(join(tmpdir(),'r16-profile-fresh-lab-')),bin=join(root,'bin'),log=join(root,'docker-calls.log');
 await mkdir(bin);const docker=join(bin,'docker');
 await writeFile(docker,`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
scenario="$DOCKER_SCENARIO"
if [[ "$1" == info ]]; then [[ "$scenario" != daemon_error ]] || exit 1; exit 0; fi
case "$1:$2" in
  ps:*)
    if [[ "$*" == *"label=com.docker.compose.project=r16bench-benchmark-pg17"* ]]; then
      [[ "$scenario" != project_container ]] || printf '%s\\n' synthetic-resource-id
    else
      [[ "$scenario" != redis_container ]] || printf '%s\\n' r16bench-benchmark-pg17-redis-1
    fi;;
  volume:ls)
    if [[ "$*" == *"label=com.docker.compose.project=r16bench-benchmark-pg17"* ]]; then
      [[ "$scenario" != project_volume ]] || printf '%s\\n' synthetic-volume
    else
      [[ "$scenario" != fixed_volume ]] || printf '%s\\n' r16bench-benchmark-pg17_postgres-data
    fi;;
  network:ls)
    if [[ "$*" == *"label=com.docker.compose.project=r16bench-benchmark-pg17"* ]]; then
      [[ "$scenario" != project_network ]] || printf '%s\\n' synthetic-network
    else
      [[ "$scenario" != fixed_network ]] || printf '%s\\n' r16bench-benchmark-pg17_default
    fi;;
  *) exit 3;;
esac
`,{mode:0o700});await chmod(docker,0o700);
 const execute=(scenario:string)=>spawnSync('bash',['-euo','pipefail','-c',body],{cwd:root,encoding:'utf8',env:{PATH:`${bin}:/usr/bin:/bin`,DOCKER_SCENARIO:scenario,DOCKER_CALL_LOG:log}});
 try{
  const fresh=execute('fresh');assert.equal(fresh.status,0,fresh.stderr||fresh.stdout);
  assert.equal((await readFile(log,'utf8')).trim().split('\n').length,7,'fresh gate must complete all seven inventory calls');
  for(const scenario of ['daemon_error','project_container','redis_container','project_volume','fixed_volume','project_network','fixed_network']){
   await rm(log,{force:true});const rejected=execute(scenario);assert.notEqual(rejected.status,0,`${scenario} must fail closed`);
   assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`,/synthetic-(?:resource|volume|network)/u);
   if(scenario==='daemon_error')assert.equal((await readFile(log,'utf8')).trim().split('\n').length,1,'daemon failure cannot be treated as absence');
  }
  const symlinkRoot=join(root,'symlink-case'),symlinkBin=join(symlinkRoot,'bin'),symlinkLog=join(symlinkRoot,'calls.log');
  await mkdir(symlinkBin,{recursive:true});await writeFile(join(symlinkBin,'docker'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  await mkdir(join(symlinkRoot,'.data/piloto-masivo/r16/labs'),{recursive:true});
  await symlink(join(symlinkRoot,'missing-lab'),join(symlinkRoot,'.data/piloto-masivo/r16/labs/benchmark-pg17'));
  const linked=spawnSync('bash',['-euo','pipefail','-c',body],{cwd:symlinkRoot,encoding:'utf8',env:{PATH:`${symlinkBin}:/usr/bin:/bin`,DOCKER_SCENARIO:'fresh',DOCKER_CALL_LOG:symlinkLog}});
  assert.notEqual(linked.status,0,'dangling lab symlink must fail closed');
  await assert.rejects(readFile(symlinkLog,'utf8'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('profile-only artifact upload gate requires the exact fourteen-file set and size validation success',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/r16-listening-profile-only.yml',import.meta.url),'utf8');
 const body=await workflowStepBody(workflow,'Validate and whitelist the bounded profile artifact');
 const root=await mkdtemp(join(tmpdir(),'r16-profile-upload-gate-')),artifacts=join(root,'profile'),out=join(root,'output');
 const names=['mainlab-default-after.json','mainlab-default-before.json','mainlab-default-runtime.json','node-profile.json',
  'profile-only.json','profile-only.test.receipt.json','profile-only.test.tap','profile-pg-cpu.test.receipt.json',
  'profile-pg-cpu.test.tap','postgres-profile.json','run.json','run.test.receipt.json','run.test.tap','v8-main-thread-profile.json'];
 try{
  await mkdir(artifacts,{recursive:true});await writeFile(out,'');
  for(const name of names)await writeFile(join(artifacts,name),'{}\n',{mode:0o600});
  const execute=()=>spawnSync('bash',['-euo','pipefail','-c',body],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',
   PROFILE_ARTIFACT_ROOT:artifacts,GITHUB_WORKSPACE:root,GITHUB_OUTPUT:out}});
  const valid=execute();assert.equal(valid.status,0,valid.stderr||valid.stdout);assert.match(await readFile(out,'utf8'),/artifact_ok=true/u);
  await writeFile(join(artifacts,'extra-secret.json'),'not-for-upload');await writeFile(out,'');
  const rejected=execute();assert.notEqual(rejected.status,0);assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`,/not-for-upload/u);
  assert.deepEqual(JSON.parse(await readFile(join(root,'artifacts/r16-profile-only-rejected/rejection.json'),'utf8')),
   {contract:'r16-profile-only-artifact-rejection-v1',status:'rejected',reason:'artifact_file_set_invalid',total_bytes:'0',
    max_total_bytes:'67108864',diagnostic_only:true,h1_accepted:false});
  assert.match(workflow,/if: always\(\) && steps\.profile_artifact_validation\.outcome == 'success'/u,
   'full evidence uploads only after exact whitelist and size validation');
  assert.match(workflow,/steps\.profile_artifact_validation\.outcome == 'failure'/u,
   'a rejected package can upload only its bounded small rejection receipt');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('profile-only run CLI reaches its strict target guard before database or provider setup',async()=>{
 const probe=process.env.R16_DIAGNOSTIC_PROBE_ROOT;assert.ok(probe,'profile-only CLI test needs the pinned probe root');
 const cli=join(probe,'scripts/r16-diagnostics/listening-small/run.mts');
 const {NODE_OPTIONS:_nodeOptions,...baseEnv}=process.env;
 const result=spawnSync(process.execPath,['--import','tsx',cli,'--run'],{cwd:process.env.R16_DIAGNOSTIC_TARGET_ROOT,
  encoding:'utf8',timeout:5000,env:{...baseEnv,R16_PROFILE_ONLY_WORKFLOW:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
   NOISIA_R16_SMALL_DIAGNOSTIC:'true',R16_DIAGNOSTIC_MODE:'profile_only',R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g',
   R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'f'.repeat(40),
   R16_DIAGNOSTIC_MAINLAB_DEFAULT_PRECHECK:'true',R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'false',
   R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false',R16_DIAGNOSTIC_STATEMENT_SHARED_WIRE_ORACLE:'false',RESERVE_SHARED_SMOKE:'false'}});
 assert.notEqual(result.status,0);assert.match(`${result.stdout}${result.stderr}`,/profile_only_target_sha_invalid/u);
 assert.doesNotMatch(`${result.stdout}${result.stderr}`,/DATABASE_URL|provider_api|INSERT INTO/u);
});
