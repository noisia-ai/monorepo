import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createListeningObserver,DML_PLAN_MAX_PLANS,DML_PLAN_MIN_BATCH,DML_PLAN_MIN_DURATION_MS,finishListeningObserver,
 INNER_PLAN_CAPTURE_ORDINALS,INNER_PLAN_MIN_DURATION_MS} from './observer.mjs';

const ROOT_COUNT=4096;
const MAX_MS=9*60*1000;
const NOOP={diagnostic_only:true,h1_accepted:false,status:'no_database_action'} as const;
type ListeningResourceProfileV1='baseline_512m'|'bounded_2g';
type ListeningExecutionV1={max_in_flight:number;max_buffered_bytes:number;flush_size:number;max_flushes:number;flush_interval_ms:number;window_size:number};
const listeningResourceProfilesV1:Record<ListeningResourceProfileV1,ListeningExecutionV1>={
 baseline_512m:{max_in_flight:1024,max_buffered_bytes:512*1024*1024,flush_size:1024,max_flushes:2,flush_interval_ms:250,window_size:4096},
 bounded_2g:{max_in_flight:4096,max_buffered_bytes:2*1024*1024*1024,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096},
};
const providerSecrets=['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','TYPESAFE_API_KEY',
  'NOISIA_TYPESAFE_API_KEY','VOYAGE_API_KEY','VOYAGEAI_API_KEY','SONNET_API_KEY'];
const probeFiles=['.github/workflows/r16-listening-small-diagnostic.yml',
  'scripts/r16-diagnostics/listening-small/run.mts','scripts/r16-diagnostics/listening-small/run.test.mts',
  'scripts/r16-diagnostics/listening-small/observer.mts'] as const;
const sha=(value:string)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const percentile=(xs:number[],p:number)=>{if(!xs.length)return 0;const s=[...xs].sort((a,b)=>a-b);return s[Math.ceil(s.length*p)-1]!;};
type CalibrationKindV1='measured'|'official_context_bound';
type TokenWitnessContextV1={sequence:number;evaluate_start_ms:number;fetch_started:boolean};
function emptyTimingSummaryV1(){return{count:0,min_ms:null as number|null,max_ms:null as number|null,total_ms:0};}
function addTimingV1(summary:ReturnType<typeof emptyTimingSummaryV1>,value:number){
  if(!Number.isFinite(value)||value<0)return;
  summary.count++;summary.min_ms=summary.min_ms===null?value:Math.min(summary.min_ms,value);
  summary.max_ms=summary.max_ms===null?value:Math.max(summary.max_ms,value);summary.total_ms+=value;
}
export function tokenCalibrationKindFromEnvV1(env:NodeJS.ProcessEnv):CalibrationKindV1|null{
  try{
    const parsed=JSON.parse(env.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON??'null');
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    const values=Object.values(parsed);if(values.length!==1||!values[0]||typeof values[0]!=='object')return null;
    const kind=(values[0] as {kind?:unknown}).kind??'measured';
    return kind==='measured'||kind==='official_context_bound'?kind:null;
  }catch{return null;}
}
type JevHttpWitnessEventV1={sequence:number;event:'fetch_start'|'fetch_end'|'evaluate_complete'|'evaluate_error';at_ms:number;active_fetches:number;
  pre_fetch_admission_ms?:number;fetch_duration_ms?:number;estimated_input_tokens?:number|null;reservation_estimate_status?:'captured'|'missing'|'invalid'|'unavailable';
  calibration_kind?:CalibrationKindV1|null;calibration_kind_source?:'response'|'config'|'missing'};
export function createJevHttpTokenWitnessV1(clock=()=>performance.now(),eventLimit=30_000){
  const context=new AsyncLocalStorage<TokenWitnessContextV1>(),events:JevHttpWitnessEventV1[]=[];
  let sequence=0,active=0,peak=0,startsPerSecondPeak=0,eventsDropped=0,evaluationsCompleted=0,evaluationErrors=0,evaluationsWithoutFetch=0;
  let fetchesStarted=0,fetchesCompleted=0,fetchErrors=0,fetchWithoutContext=0,reservationsMissing=0,calibrationKindsMissing=0,calibrationKindsMismatch=0;
  const startTimes:number[]=[],preFetch=emptyTimingSummaryV1(),fetchTiming=emptyTimingSummaryV1();
  let estimatedTokensCount=0,estimatedTokensMissing=0,estimatedTokensMin:number|null=null,estimatedTokensMax:number|null=null,estimatedTokensTotal=0;
  const responseKinds:Record<CalibrationKindV1,number>={measured:0,official_context_bound:0};
  const configuredKinds:Record<CalibrationKindV1,number>={measured:0,official_context_bound:0};
  const push=(event:typeof events[number])=>{if(events.length<eventLimit)events.push(event);else eventsDropped++;};
  const wrapFetch=(inner:typeof fetch):typeof fetch=>async(...args:any[])=>{
    const invoke=inner as (...fetchArgs:any[])=>Promise<Response>;
    const current=context.getStore();
    if(!current){fetchWithoutContext++;return invoke(...args);}
    const started=clock(),admissionMs=started-current.evaluate_start_ms;current.fetch_started=true;
    fetchesStarted++;active++;peak=Math.max(peak,active);addTimingV1(preFetch,admissionMs);
    startTimes.push(started);while(startTimes.length&&startTimes[0]!<started-1000)startTimes.shift();
    if(startTimes.length>16_384)startTimes.splice(0,startTimes.length-16_384);
    startsPerSecondPeak=Math.max(startsPerSecondPeak,startTimes.length);
    push({sequence:current.sequence,event:'fetch_start',at_ms:started,active_fetches:active,pre_fetch_admission_ms:admissionMs});
    try{const response=await invoke(...args);fetchesCompleted++;return response;}
    catch(error){fetchErrors++;throw error;}
    finally{const ended=clock(),duration=ended-started;active--;addTimingV1(fetchTiming,duration);
      push({sequence:current.sequence,event:'fetch_end',at_ms:ended,active_fetches:active,fetch_duration_ms:duration});}
  };
  const wrapProvider=(provider:any,configuredKind:CalibrationKindV1|null)=>{
    if(configuredKind)configuredKinds[configuredKind]++;
    const wrapped={...provider,async evaluate(request:any,options:any){
      const item:TokenWitnessContextV1={sequence:++sequence,evaluate_start_ms:clock(),fetch_started:false};
      try{
        const raw=await context.run(item,()=>provider.evaluate(request,options));evaluationsCompleted++;
        if(!item.fetch_started)evaluationsWithoutFetch++;
        const reservation=raw?.rate_reservation,estimate=reservation?.estimated_input_tokens;
        let estimateStatus:JevHttpWitnessEventV1['reservation_estimate_status']='missing';
        if(reservation&&typeof reservation==='object'){
          if(Number.isSafeInteger(estimate)&&estimate>=0){estimatedTokensCount++;estimatedTokensTotal+=estimate;
            estimatedTokensMin=estimatedTokensMin===null?estimate:Math.min(estimatedTokensMin,estimate);
            estimatedTokensMax=estimatedTokensMax===null?estimate:Math.max(estimatedTokensMax,estimate);estimateStatus='captured';}
          else{estimatedTokensMissing++;estimateStatus='invalid';}
        }else reservationsMissing++;
        const rawKind=(raw as any)?.rate_calibration?.kind;
        const validRawKind:CalibrationKindV1|null=rawKind==='measured'||rawKind==='official_context_bound'?rawKind:null;
        const kind:CalibrationKindV1|null=validRawKind??configuredKind;
        if(kind!==null)responseKinds[kind]++;else calibrationKindsMissing++;
        if(validRawKind!==null&&configuredKind!==null&&validRawKind!==configuredKind)calibrationKindsMismatch++;
        push({sequence:item.sequence,event:'evaluate_complete',at_ms:clock(),active_fetches:active,
          estimated_input_tokens:estimateStatus==='captured'?estimate:null,reservation_estimate_status:estimateStatus,
          calibration_kind:kind,calibration_kind_source:validRawKind?'response':kind?'config':'missing'});
        return raw;
      }catch(error){evaluationErrors++;if(!item.fetch_started)evaluationsWithoutFetch++;
        push({sequence:item.sequence,event:'evaluate_error',at_ms:clock(),active_fetches:active,
          estimated_input_tokens:null,reservation_estimate_status:'unavailable',calibration_kind:configuredKind,
          calibration_kind_source:configuredKind?'config':'missing'});throw error;}
    }};
    if(typeof provider.close==='function')wrapped.close=provider.close.bind(provider);
    if(typeof provider.observeUsage==='function')wrapped.observeUsage=provider.observeUsage.bind(provider);
    return wrapped;
  };
  return{wrapFetch,wrapProvider,snapshot(){return{contract_version:'r16-jev-http-token-witness-v1',diagnostic_only:true,h1_accepted:false,
    status:sequence===0?'not_observed':evaluationErrors?'captured_with_errors':'captured',
    configured_calibration_kind_counts:configuredKinds,evaluations_started:sequence,evaluations_completed:evaluationsCompleted,evaluation_errors:evaluationErrors,
    evaluations_without_fetch:evaluationsWithoutFetch,
    fetches_started:fetchesStarted,fetches_completed:fetchesCompleted,fetch_errors:fetchErrors,fetch_without_evaluate_context:fetchWithoutContext,
    active_fetches:active,peak_active_fetches:peak,max_fetch_starts_in_rolling_second:startsPerSecondPeak,
    pre_fetch_admission_ms:preFetch,fetch_duration_ms:fetchTiming,
    reservation_estimate:{count:estimatedTokensCount,missing:estimatedTokensMissing,min:estimatedTokensMin,max:estimatedTokensMax,total:estimatedTokensTotal},
    reservation_missing:reservationsMissing,calibration_kind_counts:responseKinds,calibration_kind_missing:calibrationKindsMissing,
    calibration_kind_mismatch:calibrationKindsMismatch,events:[...events],events_dropped:eventsDropped,event_limit:eventLimit,
    event_timing_overhead_measured:false,capacity_claim:false};}};
}

export function diagnosticModeV1(env:NodeJS.ProcessEnv){
 const mode=env.R16_DIAGNOSTIC_MODE??'legacy';
 assert.ok(mode==='legacy'||mode==='neutral_only'||mode==='sql_frontier_only','diagnostic_mode_invalid');return mode;
}
export function listeningResourceProfileV1(env:NodeJS.ProcessEnv,mode:string):ListeningResourceProfileV1{
 const requested=env.R16_DIAGNOSTIC_RESOURCE_PROFILE??'baseline_512m';
 assert.ok(requested==='baseline_512m'||requested==='bounded_2g','resource_profile_invalid');
 assert.ok(requested!=='bounded_2g'||mode==='neutral_only'||mode==='sql_frontier_only','resource_profile_requires_neutral_mode');
 return requested;
}
export function assertListeningResourceProfileV1(profile:ListeningResourceProfileV1,mode:string,env:NodeJS.ProcessEnv,
 executionFromEnv:(env:NodeJS.ProcessEnv)=>ListeningExecutionV1|undefined):ListeningExecutionV1{
 listeningResourceProfileV1({R16_DIAGNOSTIC_RESOURCE_PROFILE:profile},mode);
 const expected=listeningResourceProfilesV1[profile];
 const streamEnv={NOISIA_JEV_STREAM_MAX_IN_FLIGHT:expected.max_in_flight,NOISIA_JEV_STREAM_BUFFER_BYTES:expected.max_buffered_bytes,
  NOISIA_JEV_STREAM_FLUSH_SIZE:expected.flush_size,NOISIA_JEV_STREAM_MAX_FLUSHES:expected.max_flushes,
  NOISIA_JEV_STREAM_FLUSH_INTERVAL_MS:expected.flush_interval_ms,NOISIA_JEV_STREAM_WINDOW_SIZE:expected.window_size};
 for(const [key,value] of Object.entries(streamEnv))assert.equal(env[key],String(value),'stream_environment_profile_mismatch');
 const effective=executionFromEnv(env);
 assert.ok(effective,'stream_execution_profile_missing');
 assert.deepEqual(effective,expected,'stream_execution_profile_mismatch');
 return effective;
}
export function assertDiagnosticExecArgsV1(mode:string,args:string[],profileDir:string){
 if(mode!=='legacy')assert.ok(!args.some(a=>a.startsWith('--cpu-prof')||a.startsWith('--heap')),'diagnostic_profiler_forbidden');
 else assertCpuProfilerArgsV1(args,profileDir);
}
export function assertListeningSmallGuardV1(env:NodeJS.ProcessEnv,args:string[]){
  if(!args.includes('--run'))return;
  assert.equal(env.GITHUB_ACTIONS,'true','diagnostic_requires_github_actions');
  assert.equal(env.NOISIA_R16_SMALL_DIAGNOSTIC,'true','diagnostic_opt_in_required');
  const mode=diagnosticModeV1(env);
  listeningResourceProfileV1(env,mode);
  if(mode==='sql_frontier_only'){
    assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch','sql_frontier_requires_manual_dispatch');
    assert.equal(env.R16_DIAGNOSTIC_TARGET_LABEL,'candidate','sql_frontier_requires_candidate_target');
    assert.ok(/^[0-9a-f]{40}$/u.test(env.R16_DIAGNOSTIC_TARGET_REF_REQUESTED??''),'sql_frontier_target_ref_required');
  }
  if(providerSecrets.some(key=>env[key]!==undefined)||Object.keys(env).some(key=>/(?:SONNET|VOYAGE)/u.test(key)&&/(?:API_KEY|TOKEN)/u.test(key)))
    throw Error('provider_credentials_forbidden');
  assert.ok(env.R16_DIAGNOSTIC_TARGET_ROOT,'target_root_required');
  const root=resolve(env.R16_DIAGNOSTIC_TARGET_ROOT!);
  assert.equal(root,resolve(env.GITHUB_WORKSPACE??'', 'target'),'target_root_outside_workspace');
  assert.equal(resolve(env.R16_DIAGNOSTIC_PROBE_ROOT??''),resolve(env.GITHUB_WORKSPACE??'','probe'),'probe_root_outside_workspace');
  assert.ok(/^[0-9a-f]{40}$/u.test(env.R16_DIAGNOSTIC_TARGET_REF_REQUESTED??''),'target_ref_required');
  assert.ok(/^[0-9a-f]{40}$/u.test(env.R16_DIAGNOSTIC_PROBE_REF_REQUESTED??''),'probe_ref_required');
  const pg=new URL(env.DATABASE_URL??'');
  const redis=new URL(env.R16BENCH_REDIS_URL??'');
  assert.equal(pg.protocol,'postgresql:');assert.equal(pg.hostname,'127.0.0.1');
  assert.equal(pg.pathname,'/noisia_mfp_ci');assert.equal(pg.username,'postgres');
  assert.ok(pg.port);assert.equal(pg.search,'');assert.equal(pg.hash,'');
  assert.ok(['redis:','rediss:'].includes(redis.protocol)&&['127.0.0.1','localhost','[::1]'].includes(redis.hostname),'redis_must_be_loopback');
  const out=resolve(env.R16_DIAGNOSTIC_ARTIFACT??'');
  assert.equal(out,resolve(env.GITHUB_WORKSPACE??'','artifacts','r16-listening-small','result.json'),'artifact_path_not_bound');
  const profileDir=resolve(env.R16_DIAGNOSTIC_CPU_PROFILE_DIR??'');
  const label=env.R16_DIAGNOSTIC_TARGET_LABEL;
  assert.ok(label==='baseline-32f'||label==='candidate','cpu_profile_target_label_invalid');
  assert.equal(profileDir,resolve(env.GITHUB_WORKSPACE??'','artifacts','r16-listening-small',`cpu-profile-${label}`),'cpu_profile_path_not_bound');
}

export function assertCpuProfilerArgsV1(args:string[],profileDir:string){
  assert.ok(args.includes('--cpu-prof'),'cpu_profile_not_enabled');
  assert.ok(args.includes('--cpu-prof-interval=1000'),'cpu_profile_interval_invalid');
  assert.ok(args.includes(`--cpu-prof-dir=${profileDir}`),'cpu_profile_directory_invalid');
  assert.ok(!args.some(arg=>arg.startsWith('--heap')),'heap_profile_forbidden');
}
export function cpuProfileIdentityV1(filename:string,mainPid:number,samplerPid:number){
  const match=/^CPU\.(\d{8})\.(\d{6})\.(\d+)\.(\d+)\.(\d+)\.cpuprofile$/u.exec(filename);
  assert.ok(match,'cpu_profile_filename_invalid');
  const pid=Number(match[3]),tid=Number(match[4]),sequence=Number(match[5]);
  assert.ok(Number.isSafeInteger(pid)&&Number.isSafeInteger(tid)&&Number.isSafeInteger(sequence),'cpu_profile_identity_invalid');
  assert.ok(pid===mainPid||pid===samplerPid,'cpu_profile_foreign_process');
  return{filename,pid,tid,sequence,role:pid===mainPid?(tid===0?'runner':'runner_worker_thread'):(tid===0?'sampler':'sampler_worker_thread')};
}
export function cpuProfileRangeV1(profile:any){
  assert.ok(profile&&typeof profile==='object'&&Array.isArray(profile.nodes)&&Array.isArray(profile.samples)&&Array.isArray(profile.timeDeltas),'cpu_profile_format_invalid');
  const start=profile.startTime,end=profile.endTime;
  assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&end>start,'cpu_profile_time_range_invalid');
  assert.equal(profile.timeDeltas.length,profile.samples.length,'cpu_profile_sample_delta_count_mismatch');
  const sampled=profile.timeDeltas.reduce((sum:number,delta:unknown)=>{
    assert.ok(typeof delta==='number'&&Number.isFinite(delta)&&delta>=0,'cpu_profile_sample_delta_invalid');return sum+delta;
  },0);
  const duration=end-start,gap=duration-sampled;
  assert.ok(gap>=-2000&&gap<=Math.max(1_000_000,duration*.05),'cpu_profile_time_range_does_not_cover_samples');
  return{profile_start_time_us:start,profile_end_time_us:end,profile_duration_us:duration,sampled_time_delta_us:sampled,
    profile_sample_coverage:'v8_range_validated'};
}
export function classificationClockMetadataV1(args:{hrtime_origin_ns:string;start_hrtime_ns:string;end_hrtime_ns:string;
  performance_time_origin_ms:number;start_performance_ms:number;end_performance_ms:number}){
  const safeNs=(value:string)=>/^\d{1,30}$/u.test(value)?BigInt(value):null;
  const origin=safeNs(args.hrtime_origin_ns),start=safeNs(args.start_hrtime_ns),end=safeNs(args.end_hrtime_ns);
  assert.ok(origin!==null&&start!==null&&end!==null&&start>=origin&&end>=start,'classification_clock_invalid');
  assert.ok(Number.isFinite(args.performance_time_origin_ms)&&Number.isFinite(args.start_performance_ms)
    &&Number.isFinite(args.end_performance_ms)&&args.end_performance_ms>=args.start_performance_ms,'classification_performance_clock_invalid');
  return{clock_axis:'linux_runner_node_hrtime_monotonic_ns',runner_hrtime_origin_ns:args.hrtime_origin_ns,
    classification_start_hrtime_ns:args.start_hrtime_ns,classification_end_hrtime_ns:args.end_hrtime_ns,
    performance_time_origin_ms:args.performance_time_origin_ms,classification_start_performance_ms:args.start_performance_ms,
    classification_end_performance_ms:args.end_performance_ms,v8_profile_clock_bridge:'unknown',
    classification_profile_overlap:'unknown_no_cross_clock_truncation'};
}
export function cpuProfileMetadataV1(args:{main_pid:number;sampler_pid:number|null;clock:ReturnType<typeof classificationClockMetadataV1>;
  exec_args:string[];profile_dir:string}){
  assert.ok(Number.isSafeInteger(args.main_pid)&&args.main_pid>0,'cpu_profile_main_pid_invalid');
  assert.ok(args.sampler_pid===null||(Number.isSafeInteger(args.sampler_pid)&&args.sampler_pid>0),'cpu_profile_sampler_pid_invalid');
  assertCpuProfilerArgsV1(args.exec_args,args.profile_dir);
  return{enabled:true,profiler:'node_cpu_prof',interval_us:1000,main_process_pid:args.main_pid,sampler_process_pid:args.sampler_pid,
    clock:args.clock,
    output:'pid_scoped_cpu_profiles_only',heap_profile:false,source_text_embedded:false,overhead_measured:false,capacity_claim:false};
}

export function captureCalibrationObservationV1(event:{warmup:boolean;selected_roots:number;max_in_flight:number;shape_digests:string[]}){
  if(!Array.isArray(event.shape_digests)||event.shape_digests.some(digest=>typeof digest!=='string'))
    throw Error('listening_calibration_observation_invalid');
  return{warmup:event.warmup,selected_roots:event.selected_roots,max_in_flight:event.max_in_flight,
    shape_digests:[...event.shape_digests]};
}

async function atomicJson(path:string,value:unknown){
  await mkdir(join(path,'..'),{recursive:true});
  const h=await open(path,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
}
function moduleAt<T>(root:string,relative:string):Promise<T>{return import(pathToFileURL(join(root,relative)).href) as Promise<T>;}
function safeError(error:unknown){return error instanceof Error&&/^(?:r16|listening|mass_labeling|labeling|workspace_engine|jev)_[a-z0-9_]{1,100}$/u.test(error.message)?error.message:'listening_small_diagnostic_failed';}
const gitHead=(root:string)=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
async function probeFileHashes(root:string){return Object.fromEntries(await Promise.all(probeFiles.map(async path=>[path,sha(await readFile(join(root,path),'utf8'))])));}

export async function runListeningSmallDiagnosticV1(){
  if(!process.argv.slice(2).includes('--run'))return NOOP;
  assertListeningSmallGuardV1(process.env,process.argv.slice(2));
  const target=resolve(process.env.R16_DIAGNOSTIC_TARGET_ROOT!);
  const probe=resolve(process.env.R16_DIAGNOSTIC_PROBE_ROOT!);
  const artifact=resolve(process.env.R16_DIAGNOSTIC_ARTIFACT!);
  const outputRoot=resolve(process.env.GITHUB_WORKSPACE??'','artifacts','r16-listening-small');
  assert.ok(artifact.startsWith(outputRoot+sep),'artifact_path_not_bound');
  const targetHeadBefore=gitHead(target),probeHeadBefore=gitHead(probe),probeHashesBefore=await probeFileHashes(probe);
  assert.equal(targetHeadBefore,process.env.R16_DIAGNOSTIC_TARGET_REF_REQUESTED,'target_ref_checkout_mismatch');
  assert.equal(probeHeadBefore,process.env.R16_DIAGNOSTIC_PROBE_REF_REQUESTED,'probe_ref_checkout_mismatch');
  const started=performance.now();
  const mode=diagnosticModeV1(process.env);
  const neutralOnly=mode==='neutral_only';
  const sqlFrontierOnly=mode==='sql_frontier_only';
  const profilerDisabled=mode!=='legacy';
  let resourceProfile:ListeningResourceProfileV1|undefined;
  let effectiveExecution:ListeningExecutionV1|undefined;
  resourceProfile=listeningResourceProfileV1(process.env,mode);
  assertDiagnosticExecArgsV1(mode,process.execArgv,resolve(process.env.R16_DIAGNOSTIC_CPU_PROFILE_DIR!));
  const monotonicOrigin=process.hrtime.bigint();
  let stage='imports';
  let storageServer:any;
  let httpTokenWitness:ReturnType<typeof createJevHttpTokenWitnessV1>|undefined;
  const observer=createListeningObserver({neutral_only:neutralOnly,sql_frontier_only:sqlFrontierOnly});
  observer.setInnerPlanRootCount(ROOT_COUNT);
  try{
    Object.assign(process.env,{NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',NOISIA_R16_NATIVE_FIXTURE_PG:'true',
      NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',
      NOISIA_MASS_LABELING_ENABLED:'true'});
    const [fixture,localPg,workloadModule,configurationModule,preparationModule,censusModule,servingModule,
      jobModule,providerModule,storageModule,syntheticModule,filesystemModule,profilerModule,provenanceModule,preflightModule,queryModule]
      =await Promise.all([
        moduleAt<any>(target,'infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture.ts'),
        moduleAt<any>(target,'infrastructure/db/migrations/signal-r16-local-pg.fixture.ts'),
        moduleAt<any>(target,'scripts/r16/listening-workload.ts'),
        moduleAt<any>(target,'infrastructure/db/signal-listening-configuration.ts'),
        moduleAt<any>(target,'infrastructure/db/signal-listening-preparation.ts'),
        moduleAt<any>(target,'scripts/r16/listening-native-census.ts'),
        moduleAt<any>(target,'infrastructure/db/signal-listening-serving.ts'),
        moduleAt<any>(target,'services/workers/src/workers/signal-listening-jev.ts'),
        moduleAt<any>(target,'services/workers/src/providers/jev-streaming-runtime.ts'),
        moduleAt<any>(target,'services/workers/src/workers/signal-workspace-engine-storage.ts'),
        moduleAt<any>(target,'scripts/r16/synthetic-jev.ts'),
        moduleAt<any>(target,'scripts/r16/http-filesystem-storage.ts'),
        moduleAt<any>(target,'scripts/r16/query-profiler.ts'),
        moduleAt<any>(target,'scripts/r16/source-provenance.ts'),
        moduleAt<any>(target,'scripts/r16/listening-preflight.ts'),
        moduleAt<any>(target,'packages/query-engine/src/index.ts'),
      ]);
    stage='resource_profile';
    effectiveExecution={...assertListeningResourceProfileV1(resourceProfile,mode,process.env,providerModule.jevStreamingExecutionFromEnvV2)};
    const source=await provenanceModule.captureR16SourceProvenanceV1(target);
    assert.equal(source.tree_status_sha256,'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','target_tree_must_be_clean');
    const workload=workloadModule.r16ListeningWorkloadV2('defined_consumer_second_pass');
    const instrument=sha(await readFile(new URL(import.meta.url),'utf8'));
    const profile=new profilerModule.R16QueryProfilerV1();
    const outputDir=join(outputRoot,'objects');
    storageServer=await filesystemModule.startR16HttpFilesystemStorageV1(outputDir);
    const storage=storageModule.createWorkspaceEngineStorageV1({url:storageServer.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
    const dbPool=await localPg.openR16CiPostgresV1();
    try{
      const baseline=await dbPool.query(`SELECT (SELECT count(*)::int FROM mentions) roots,(SELECT count(*)::int FROM signal_labeling_calls) calls,(SELECT count(*)::int FROM signal_listening_configurations) configurations`);
      assert.deepEqual(baseline.rows[0],{roots:0,calls:0,configurations:0},'owned_database_must_be_empty');
    }finally{await dbPool.end();}
    let result:any;
    stage='native_fixture';
    await fixture.runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:ROOT_COUNT,execution_cap_micro_usd:20_000_000,
      import_batch_size:512,preparation_page_size:100,embedding_page_limit:264,
      beforeProcessing:async(ctx:any)=>{
        stage='prepare_admission';
        const db=profile.wrapDatabase(observer.wrapDatabase(ctx.database));
        const databaseName=(await ctx.database.query('SELECT current_database() database')).rows[0].database;
        await observer.startSampler({target,url:process.env.DATABASE_URL!,database:databaseName});
        const canceled=await db.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1 AND r.workspace_id=$2
          AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id`,[ctx.run_id,ctx.workspace_id]);
        assert.equal(canceled.rows.length,1,'fixture_legacy_run_has_physical_calls');
        const access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
        const cfg=await configurationModule.saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});
        const admissionStarted=performance.now();
        const prepared=await preparationModule.prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
          idempotency_key:`r16-listening-small:${createHash('sha256').update(String(Date.now())).digest('hex')}`,
          cap_micro_usd:20_000_000,provider_available:true,prototype_provider_available:false});
        assert.ok(prepared.status==='labeling'&&prepared.run_id,'native_preparation_did_not_admit');
        const binding={...access,configuration_id:cfg.id,map_id:ctx.map_id,question_key:'voice'};
        stage='census';
        const census=await censusModule.loadR16ListeningNativeCensusV1({...binding,run_id:prepared.run_id},ROOT_COUNT);
        const expected=new Set(census.root_ids);assert.equal(expected.size,ROOT_COUNT);
        const execution={...effectiveExecution!};
        const latencies:number[]=[],calibrations:any[]=[],commits:number[]=[];
        const synthetic=syntheticModule.createSyntheticJevFetchV1({latencyForRequest:(i:number)=>125+((i*137+47)%351)});
        let requests=0;const countedFetch:typeof fetch=async(...args:any[])=>{requests++;const t=performance.now();try{return await synthetic(...args);}finally{latencies.push(performance.now()-t);}};
        const tokenWitness=createJevHttpTokenWitnessV1();httpTokenWitness=tokenWitness;
        const providerFactory=(opts:any)=>{
          const env={...opts.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:`r16-listening-small:${census.organization_id}`,
            NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:process.env.R16BENCH_REDIS_URL!,NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',
            NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'};
          const runtime=providerModule.createCalibratedJevRuntimeProviderV2({...opts,env,fetch:tokenWitness.wrapFetch(countedFetch)});
          return tokenWitness.wrapProvider(runtime,tokenCalibrationKindFromEnvV1(env));
        };
        const unprofiled=jobModule.createSignalListeningRuntimeStoreV1(db,{execution,storage});
        const profiled=observer.wrapStore(profile.wrapStore(unprofiled));
        const store={...profiled,async apply(...args:any[]){await profiled.apply(...args);const roots=[...new Set(args[1].flatMap((row:any)=>row.results.map((x:any)=>x.root_id)))];
          for(let n=0;n<roots.length;n+=1024){const resolved=await census.readResolvedRootIds(roots.slice(n,n+1024));commits.push(resolved.length);}}};
        const rootSet=new Set<string>();
        const startedProcessing=performance.now(),classificationStartHrtime=process.hrtime.bigint();let classificationEndHrtime:bigint|undefined;
        let classificationEndPerformanceMs:number|undefined,jobs=0;
        stage='native_jobs';
        while(jobs<100&&rootSet.size<ROOT_COUNT&&performance.now()-started<MAX_MS){
          const before=calibrations.length;observer.beginJob(jobs+1);
          const outcome=await jobModule.signalListeningJevJobV1(prepared.run_id,{database:db,store,execution,storage,
            preflight:()=>preflightModule.assertR16ListeningSyntheticPreflightV1({storage,storage_url:storageServer.base_url,
              configuration:workload.configuration,configuration_digest:workload.configuration_digest,env:process.env}),
            calibrated_provider_factory:providerFactory,
            ...(neutralOnly?{observe_stream:(metrics:unknown)=>observer.observeStream(metrics)}:{}),
            observe_calibration:(event:any)=>calibrations.push(captureCalibrationObservationV1(event))});
          jobs++;
          if(['failed','outcome_unknown','lease_lost'].includes(outcome.status))throw Error('native_job_failed');
          if(neutralOnly)observer.assertStreamObserved();
          const resolved=await census.readResolvedRootIds();resolved.forEach((id:string)=>rootSet.add(id));
          if(performance.now()-started>MAX_MS)throw Error('diagnostic_timeout');
          if(calibrations.length===before&&outcome.status==='idle')throw Error('native_job_no_progress');
        }
        assert.equal(rootSet.size,ROOT_COUNT,'native_census_incomplete');
        const runStatus=await servingModule.getSignalListeningStatusV1(binding);
        assert.equal(runStatus.run?.status,'completed','native_run_not_completed');
        assert.equal(runStatus.run?.reserved_micro_usd,'0','native_reservation_not_drained');
        assert.equal(runStatus.run?.unknown_micro_usd,'0','native_unknown_exposure');
        const serving=await servingModule.readSignalListeningQuestionsMetricsV1({...binding,question_keys:workload.question_keys});
        assert.equal(serving.length,workload.question_keys.length,'serving_metrics_missing');
        assert.ok(serving.every((item:any)=>item.counts.pending===0&&item.counts.awaiting_base===0),'serving_has_unresolved_work');
        classificationEndPerformanceMs=performance.now();classificationEndHrtime=process.hrtime.bigint();
        const warmups=calibrations.filter((item:any)=>item.warmup);
        const phaseByShape=new Map<string,string>();
        for(const group of ['base','consumer_category'] as const){
          const keys=workload.configuration.questions.filter((question:any)=>group==='base'?question.origin==='base':question.scope==='consumer_category').map((question:any)=>question.key);
          for(let mask=1;mask<(1<<keys.length);mask++){
            const subset=keys.filter((_:string,index:number)=>(mask&(1<<index))!==0);
            const shape=queryModule.signalListeningCalibrationShapeV1(workload.configuration,{question_keys:subset});
            phaseByShape.set(shape.shape_digest,shape.phase);
          }
        }
        assert.equal(warmups.length,2,'expected_base_and_consumer_native_warmups');
        assert.ok(warmups.every((item:any)=>item.selected_roots===32&&item.shape_digests.length===1),'expected_32_root_warmup_per_phase');
        const warmupPhases=warmups.map((item:any)=>phaseByShape.get(item.shape_digests[0])).sort();
        assert.deepEqual(warmupPhases,['base','consumer_category'],'unexpected_native_warmup_phases');
        const latencySummary={count:latencies.length,min_ms:Math.min(...latencies),p50_ms:percentile(latencies,.5),p95_ms:percentile(latencies,.95),max_ms:Math.max(...latencies)};
        assert.equal(requests,ROOT_COUNT*2,'expected_two_provider_requests_per_root');
        const counts=await db.query(`SELECT count(*)::int job_count FROM signal_labeling_calls WHERE run_id=$1`,[prepared.run_id]);
        const provenanceAfter=await provenanceModule.captureR16SourceProvenanceV1(target);
        assert.equal(provenanceAfter.source_tree_sha256,source.source_tree_sha256,'target_source_changed_during_run');
        const runInstrument=sha(await readFile(new URL(import.meta.url),'utf8'));
        assert.equal(runInstrument,instrument,'diagnostic_instrument_changed_during_run');
        const targetHeadAfter=gitHead(target),probeHeadAfter=gitHead(probe),probeHashesAfter=await probeFileHashes(probe);
        assert.equal(targetHeadAfter,targetHeadBefore,'target_head_changed_during_run');
        assert.equal(probeHeadAfter,probeHeadBefore,'probe_head_changed_during_run');
        assert.deepEqual(probeHashesAfter,probeHashesBefore,'probe_files_changed_during_run');
        const observerSnapshot=observer.snapshot();
        const classificationClock=classificationClockMetadataV1({hrtime_origin_ns:monotonicOrigin.toString(),
          start_hrtime_ns:classificationStartHrtime.toString(),end_hrtime_ns:classificationEndHrtime!.toString(),
          performance_time_origin_ms:performance.timeOrigin,start_performance_ms:startedProcessing,end_performance_ms:classificationEndPerformanceMs!});
        result={contract_version:'r16-listening-small-diagnostic-v1',diagnostic_only:true,h1_accepted:false,
          a_b_source_verified:false,
          target_label:process.env.R16_DIAGNOSTIC_TARGET_LABEL??'unspecified',
          target_ref_requested:process.env.R16_DIAGNOSTIC_TARGET_REF_REQUESTED,
          target_head_before:targetHeadBefore,target_head_after:targetHeadAfter,
          probe_ref_requested:process.env.R16_DIAGNOSTIC_PROBE_REF_REQUESTED,
          probe_head_before:probeHeadBefore,probe_head_after:probeHeadAfter,
          probe_file_sha256_before:probeHashesBefore,probe_file_sha256_after:probeHashesAfter,
          acceptance_thresholds_applied:false,root_count:ROOT_COUNT,expected_http_requests:ROOT_COUNT*2,observed_http_requests:requests,
          source_tree_sha256_before:source.source_tree_sha256,source_tree_sha256_after:provenanceAfter.source_tree_sha256,
          source_status_sha256:source.tree_status_sha256,instrument_sha256_before:instrument,instrument_sha256_after:runInstrument,
          workload_digest:workload.configuration_digest,
          native:{status:runStatus.run?.status,resolved_roots:rootSet.size,reserved_micro_usd:runStatus.run?.reserved_micro_usd,
            unknown_micro_usd:runStatus.run?.unknown_micro_usd,job_count:jobs,call_count:counts.rows[0]?.job_count,
            preparation_admission_wall_ms:startedProcessing-admissionStarted,classification_serving_wall_ms:classificationEndPerformanceMs!-startedProcessing,
            classification_start_performance_ms:startedProcessing,classification_end_performance_ms:classificationEndPerformanceMs,
            classification_start_hrtime_ns:classificationStartHrtime.toString(),classification_end_hrtime_ns:classificationEndHrtime!.toString(),
            warmups:warmups.length,warmup_phases:warmupPhases,calibrations,commit_batch_count:commits.length},
          diagnostic_mode:mode,
          resource_profile:{requested_profile:resourceProfile,execution:effectiveExecution},
          cpu_profile:profilerDisabled?{enabled:false,reason:sqlFrontierOnly?'sql_frontier_only':'neutral_only',classification_clock:classificationClock,capacity_claim:false}:cpuProfileMetadataV1({main_pid:process.pid,sampler_pid:observerSnapshot.sampler_process_pid,
            clock:classificationClock,exec_args:process.execArgv,
            profile_dir:resolve(process.env.R16_DIAGNOSTIC_CPU_PROFILE_DIR!)}),
          observed_http_latency:latencySummary,storage:storageServer.metrics(),sql_profile:profile.snapshot(),
          token_budget_http_witness:httpTokenWitness.snapshot(),
          inner_plan_capture:{enabled:!profilerDisabled,disabled_reason:profilerDisabled?mode:null,diagnostic_only:true,threshold_roots:1024,max_captures_per_query_hash:INNER_PLAN_CAPTURE_ORDINALS.length,capture_ordinals:INNER_PLAN_CAPTURE_ORDINALS,min_duration_ms:INNER_PLAN_MIN_DURATION_MS,
            plans_below_min_duration_captured:false,observations:observerSnapshot.inner_plan_observations},
          dml_plan_capture:{enabled:!neutralOnly,disabled_reason:neutralOnly?'neutral_only':null,diagnostic_only:true,opt_in_required:true,min_batch_size:DML_PLAN_MIN_BATCH,max_captures_per_query_hash:1,min_duration_ms:DML_PLAN_MIN_DURATION_MS,
            plans_below_min_duration_captured:false,max_plans_per_capture:DML_PLAN_MAX_PLANS+(sqlFrontierOnly?1:0),...(sqlFrontierOnly?{nested_plan_limit:DML_PLAN_MAX_PLANS,outer_plan_absence:'unknown'}:{}),trigger_names_allowlisted:true,raw_query_or_values_recorded:false,
            analyze_timing_enabled:!neutralOnly,analyze_timing_overhead_measured:false,capacity_claim:false,
            sql_frontier:sqlFrontierOnly?observerSnapshot.sql_frontier_capture:null,
            observations:observerSnapshot.dml_plan_observations},
          root_census_sha256:sha([...rootSet].sort().join('\n')),
          serving_question_count:serving.length,total_wall_ms:performance.now()-started};
      }} });
    stage='write_artifact';
    result.observer=await finishListeningObserver(observer);
    await atomicJson(artifact,result);
    await storageServer.close();storageServer=undefined;
    process.stdout.write(JSON.stringify({status:'complete',diagnostic_only:true,h1_accepted:false,artifact:'artifacts/r16-listening-small/result.json'})+'\n');
    return result;
  }catch(error){
    let observerSnapshot:any;
    try{observerSnapshot=await finishListeningObserver(observer);}catch(cleanupError){observerSnapshot={...observer.snapshot(),cleanup_error:safeError(cleanupError)};}
    const failure={contract_version:'r16-listening-small-diagnostic-v1',diagnostic_only:true,h1_accepted:false,
      status:'failed',stage,code:safeError(error),total_wall_ms:performance.now()-started,process_id:process.pid,
      diagnostic_mode:mode,
      resource_profile:{requested_profile:resourceProfile??process.env.R16_DIAGNOSTIC_RESOURCE_PROFILE??'baseline_512m',execution:effectiveExecution??null},
      cpu_profile:profilerDisabled?{enabled:false,reason:sqlFrontierOnly?'sql_frontier_only':'neutral_only',capacity_claim:false}:{enabled:true,profiler:'node_cpu_prof',interval_us:1000,main_process_pid:process.pid,
        sampler_process_pid:observerSnapshot.sampler_process_pid??null,output:'pid_scoped_cpu_profiles_only',heap_profile:false,
        source_text_embedded:false,overhead_measured:false,capacity_claim:false},observer:observerSnapshot,
      token_budget_http_witness:httpTokenWitness?.snapshot()??{contract_version:'r16-jev-http-token-witness-v1',diagnostic_only:true,
        h1_accepted:false,status:'not_started',capacity_claim:false,event_timing_overhead_measured:false},
      inner_plan_capture:{enabled:!profilerDisabled,disabled_reason:profilerDisabled?mode:null,diagnostic_only:true,threshold_roots:1024,max_captures_per_query_hash:INNER_PLAN_CAPTURE_ORDINALS.length,capture_ordinals:INNER_PLAN_CAPTURE_ORDINALS,min_duration_ms:INNER_PLAN_MIN_DURATION_MS,
        plans_below_min_duration_captured:false,observations:observerSnapshot.inner_plan_observations},
      dml_plan_capture:{enabled:!neutralOnly,disabled_reason:neutralOnly?'neutral_only':null,diagnostic_only:true,opt_in_required:true,min_batch_size:DML_PLAN_MIN_BATCH,max_captures_per_query_hash:1,min_duration_ms:DML_PLAN_MIN_DURATION_MS,
        plans_below_min_duration_captured:false,max_plans_per_capture:DML_PLAN_MAX_PLANS+(sqlFrontierOnly?1:0),...(sqlFrontierOnly?{nested_plan_limit:DML_PLAN_MAX_PLANS,outer_plan_absence:'unknown'}:{}),trigger_names_allowlisted:true,raw_query_or_values_recorded:false,
        analyze_timing_enabled:!neutralOnly,analyze_timing_overhead_measured:false,capacity_claim:false,
        sql_frontier:sqlFrontierOnly?observerSnapshot.sql_frontier_capture:null,
        observations:observerSnapshot.dml_plan_observations}};
    await atomicJson(artifact,failure).catch(()=>undefined);
    await storageServer?.close().catch(()=>undefined);
    process.stderr.write('listening_small_diagnostic_failed; sanitized artifact written\n');
    process.exitCode=1;return failure;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv.slice(2).includes('--run'))process.stdout.write(JSON.stringify(NOOP)+'\n');
  else await runListeningSmallDiagnosticV1();
}
