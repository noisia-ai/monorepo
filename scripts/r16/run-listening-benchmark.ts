import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertR16ListeningSyntheticPreflightV1} from './listening-preflight';
import {captureR16SourceProvenanceV1} from './source-provenance';
import {getSignalListeningStatusV1,readSignalListeningQuestionMetricsV1,readSignalListeningQuestionsMetricsV1} from '../../infrastructure/db/signal-listening-serving';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {signalListeningJevJobV1,createSignalListeningRuntimeStoreV1} from '../../services/workers/src/workers/signal-listening-jev';
import type {JevStreamingMetricsV2} from '../../services/workers/src/workers/signal-jev-streaming-window';
import {createCalibratedJevRuntimeProviderV2,jevStreamingExecutionFromEnvV2} from '../../services/workers/src/providers/jev-streaming-runtime';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from './synthetic-jev';
import {startR16HttpFilesystemStorageV1} from './http-filesystem-storage';
import {r16ListeningWorkloadV2,summarizeR16ListeningCapacityV2,R16_LISTENING_PREREGISTRATION_V2 as registration,type R16ListeningArmV1} from './listening-workload';
import type {R16QueryProfilerV1} from './query-profiler';
import {assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from '../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle';

export type R16ListeningRuntimeReceiptV1=Awaited<ReturnType<typeof assertSharedWireDefaultRuntimeV1>>;
export type R16ListeningRuntimeDatabaseV1=Parameters<typeof assertSharedWireDefaultRuntimeV1>[0];
export type R16ListeningRuntimeWitnessV1={
 contract:'r16-listening-runtime-witness-v1';
 before:R16ListeningRuntimeReceiptV1|null;
 after:R16ListeningRuntimeReceiptV1|null;
};
export type R16ListeningResourceObservationV1={
 sampling:'sparse_start_after_each_job_and_final';
 rss_is_peak:false;
 limits:{max_in_flight:number;window_size:number;max_buffered_bytes:number;flush_size:number;max_flushes:number;flush_interval_ms:number};
 rss_samples:Array<{at_ms:number;rss_bytes:number}>;
 stream_peaks:{in_flight:number;reserved_working_bytes:number;buffered_responses:number;active_flushes:number};
};
/** Sparse process observations are descriptive only: RSS is not a stream-budget
 * measurement and this helper never participates in any acceptance gate. */
export function createR16ListeningResourceObservationV1(readRss:()=>number=()=>process.memoryUsage().rss){
 const stream_peaks={in_flight:0,reserved_working_bytes:0,buffered_responses:0,active_flushes:0};
 const rss_samples:Array<{at_ms:number;rss_bytes:number}>=[];
 return{
  observeStream(metrics:JevStreamingMetricsV2){
   try{
    for(const key of Object.keys(stream_peaks) as Array<keyof typeof stream_peaks>){
     const value=metrics[key];if(Number.isFinite(value)&&value>=0)stream_peaks[key]=Math.max(stream_peaks[key],value);
    }
   }catch{/* Measurements cannot change a provider attempt or its receipt. */}
  },
  sampleRss(at_ms:number){
   try{const rss_bytes=readRss();if(Number.isFinite(at_ms)&&at_ms>=0&&Number.isSafeInteger(rss_bytes)&&rss_bytes>=0)
    rss_samples.push({at_ms,rss_bytes});}catch{/* Sparse process observation only. */}
  },
  snapshot(limits:R16ListeningResourceObservationV1['limits']):R16ListeningResourceObservationV1{return{sampling:'sparse_start_after_each_job_and_final',rss_is_peak:false,limits:{...limits},
   rss_samples:rss_samples.map(sample=>({...sample})),stream_peaks:{...stream_peaks}};},
 };
}
export async function withR16ListeningRuntimeWitnessV1<T>(database:R16ListeningRuntimeDatabaseV1,
 body:(witness:R16ListeningRuntimeWitnessV1,captureAfter:()=>Promise<R16ListeningRuntimeReceiptV1>)=>Promise<T>){
 const witness:R16ListeningRuntimeWitnessV1={contract:'r16-listening-runtime-witness-v1',before:null,after:null};
 const captureAfter=async()=>{const receipt=await assertSharedWireDefaultRuntimeV1(database);witness.after=receipt;return receipt;};
 const value=await withSharedWireDefaultPostcheckV1(async()=>{
  witness.before=await assertSharedWireDefaultRuntimeV1(database);
  const result=await body(witness,captureAfter);
  if(witness.after===null)await captureAfter();
  return result;
 },async()=>{if(witness.after===null)await captureAfter();});
 return{value,runtime_witness:witness};
}

/** Native fixture ownership is deliberately external: seeding may not invent a
 * configuration, profile, scope, admission, money event or serving projection. */
export type R16ListeningFixtureV1={
 access:Parameters<typeof readSignalListeningQuestionMetricsV1>[0];
 run_id:string;organization_id:string;root_ids:string[];admission_started_at_ms:number;
 /** PG-native projection, ALL eligible question digests resolved or natively
  * excluded, scoped to this immutable map/config/source, never call-count. */
 readResolvedRootIds(root_ids?:string[]):Promise<string[]>;
};
export function assertR16ListeningAdmissionClockV1(coldStart:number,admissionStart:number,now:number){
 if(![coldStart,admissionStart,now].every(Number.isFinite)||coldStart<0||admissionStart<coldStart||admissionStart>now)
  throw Error('r16_listening_admission_clock_invalid');
 return admissionStart;
}
export function reconcileR16ListeningResolvedRootsV1(expected:ReadonlySet<string>,previous:ReadonlySet<string>,rows:string[]){
 const current=new Set(rows);
 if(current.size!==rows.length||rows.some(id=>!expected.has(id))||[...previous].some(id=>!current.has(id)))
  throw Error('r16_listening_resolved_census_invalid');
 return rows.filter(id=>!previous.has(id));
}
/** Preparation harness, NO CLI/default fixture: orchestrator must supply the
 * reviewed native R16 fixture and freeze its source before a full lab run. This
 * returns measurements, not acceptance; same-source native fault pack is required. */
export async function runR16ListeningBenchmarkV1(args:{arm:R16ListeningArmV1;object_directory:string;redis_url:string;
 query_profiler?:R16QueryProfilerV1;
 writePreregistration(value:ReturnType<typeof r16ListeningWorkloadV2>&{registration:typeof registration;source_provenance:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>}):Promise<void>;
 withNativeFixture<T>(context:{workload:ReturnType<typeof r16ListeningWorkloadV2>;storage:WorkspaceEngineStorageV1},run:(fixture:R16ListeningFixtureV1)=>Promise<T>):Promise<T>;
 max_jobs?:number;
}){
 const redis=new URL(args.redis_url);
 if(!['127.0.0.1','localhost','[::1]'].includes(redis.hostname)||!['redis:','rediss:'].includes(redis.protocol))throw Error('r16_listening_redis_not_local');
 const workload=r16ListeningWorkloadV2(args.arm),coldStart=performance.now();
 // The persisted preregistration precedes fixture work and every physical send.
 const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),source_provenance=await captureR16SourceProvenanceV1(repo);
 await args.writePreregistration({...workload,registration,source_provenance});
 const storageServer=await startR16HttpFilesystemStorageV1(args.object_directory);
 try{
  const baseStorage=createWorkspaceEngineStorageV1({url:storageServer.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
  const storage_spans:Array<{operation:'preflight'|'put'|'get';elapsed_ms:number}>=[];
  const timed=async<T>(operation:'preflight'|'put'|'get',run:()=>Promise<T>)=>{
   const started=performance.now();try{return await run();}finally{storage_spans.push({operation,elapsed_ms:performance.now()-started});}
  };
  // Observe the actual production adapter, including its network/readback work.
  // No response, content byte, retry or persistence decision is replaced.
  const storage:WorkspaceEngineStorageV1={...baseStorage,
   assertReady:()=>timed('preflight',()=>baseStorage.assertReady!()),
   put:value=>timed('put',()=>baseStorage.put(value)),get:value=>timed('get',()=>baseStorage.get(value))};
  return await args.withNativeFixture({workload,storage},async f=>{
  const observed=await withR16ListeningRuntimeWitnessV1(f.access.database,async(_runtimeWitness,captureAfter)=>{
  const start=assertR16ListeningAdmissionClockV1(coldStart,f.admission_started_at_ms,performance.now());
  const status=await getSignalListeningStatusV1(f.access);
  assert.equal(status.configuration?.id,f.access.configuration_id);assert.equal(status.map?.id,f.access.map_id);
  assert.equal(status.run?.id,f.run_id);assert.equal(status.map?.root_count,registration.root_count);
  assert.equal(digest(status.configuration?.configuration),workload.configuration_digest);
  assert.equal(f.root_ids.length,registration.root_count);const expected=new Set(f.root_ids);assert.equal(expected.size,f.root_ids.length);
  const execution=jevStreamingExecutionFromEnvV2({NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_JEV_STREAM_BUFFER_BYTES:String(512*1024*1024)})!;
  const latency_ms:number[]=[],calibration:Array<{at_ms:number;warmup:boolean;selected_roots:number;max_in_flight:number;shape_digests:string[]}>=[];
  const providerFetch=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});
  const job_spans:Array<{start_ms:number;end_ms:number;warmup:boolean}>=[];
  const resources=createR16ListeningResourceObservationV1(),sampleResources=()=>resources.sampleRss(performance.now()-start);
  sampleResources();
  let requests=0;const resolved=new Set<string>(),commits:Array<{at_ms:number;roots:number}>=[];
  const measuredFetch:typeof fetch=async(...params)=>{requests++;const began=performance.now();try{return await providerFetch(...params);}finally{latency_ms.push(performance.now()-began);}};
  const calibrated_provider_factory:typeof createCalibratedJevRuntimeProviderV2=opts=>createCalibratedJevRuntimeProviderV2({...opts,
   // Preserve the exact calibration JSON generated by H2 from its verified
   // ledger; only transport/account test configuration is replaced.
   env:{...opts.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:`r16-listening:${f.organization_id}`,
    NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:args.redis_url,NOISIA_TYPESAFE_ACCOUNT_RPS:String(registration.simulator_quotas.requests_per_second),NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:String(registration.simulator_quotas.input_tokens_per_second)},fetch:measuredFetch});
  const sample=async(root_ids?:string[])=>{
   const population=root_ids?new Set(root_ids):expected,previous=root_ids?new Set([...resolved].filter(id=>population.has(id))):resolved;
   const rows=await f.readResolvedRootIds(root_ids),newIds=reconcileR16ListeningResolvedRootsV1(population,previous,rows);
   if(newIds.length){newIds.forEach(id=>resolved.add(id));commits.push({at_ms:performance.now()-start,roots:newIds.length});}
  };
  const unobservedStore=createSignalListeningRuntimeStoreV1(f.access.database,{execution,storage});
  const nativeStore=args.query_profiler?.wrapStore(unobservedStore)??unobservedStore;
  const store={...nativeStore,async apply(...params:Parameters<typeof nativeStore.apply>){
   await nativeStore.apply(...params);
   const roots=[...new Set(params[1].flatMap(row=>row.results.map(result=>result.root_id)))];
   for(let offset=0;offset<roots.length;offset+=1024)await sample(roots.slice(offset,offset+1024));
  }};
  let jobs=0;
  for(;jobs<(args.max_jobs??10000)&&resolved.size<expected.size;jobs++){
    const jobStart=performance.now()-start,calibrationIndex=calibration.length;
    const outcome=await signalListeningJevJobV1(f.run_id,{database:f.access.database,store,execution,preflight:()=>assertR16ListeningSyntheticPreflightV1({storage,storage_url:storageServer.base_url,configuration:workload.configuration,configuration_digest:workload.configuration_digest,env:process.env}),calibrated_provider_factory,
     observe_stream:metrics=>resources.observeStream(metrics),
     observe_calibration:event=>calibration.push({...event,at_ms:performance.now()-start})});
    job_spans.push({start_ms:jobStart,end_ms:performance.now()-start,warmup:calibration.slice(calibrationIndex).some(event=>event.warmup)});
    sampleResources();
    if(['failed','outcome_unknown','lease_lost'].includes(outcome.status))break;
   }
  sampleResources();
  // The job promise has drained native apply/settlement, calibration and provider
  // cleanup. Confirm its completed identity/exposure before closing active time.
  const processingStatus=await getSignalListeningStatusV1(f.access);
  const native_processing_complete=processingStatus.run?.id===f.run_id&&processingStatus.run.status==='completed'
   &&processingStatus.run.reserved_micro_usd==='0'&&processingStatus.run.unknown_micro_usd==='0'
   &&resolved.size===expected.size;
  const classification_wall_elapsed_ms=performance.now()-start;
  const beforeFinal=resolved.size;await sample();
  assert.equal(resolved.size,beforeFinal,'final census found roots not observed after native page apply');
  const metrics=await readSignalListeningQuestionsMetricsV1({...f.access,question_keys:workload.question_keys});
  // Keep the final default-body proof inside the existing admission-to-wall
  // clock. The wrapper repeats it on failures and preserves both failures.
  await captureAfter();
  const wall_elapsed_ms=performance.now()-start;
  const capacity=summarizeR16ListeningCapacityV2({wall_elapsed_ms,processing_elapsed_ms:classification_wall_elapsed_ms,
   native_processing_complete,resolved_roots:resolved.size,commits,latency_ms});
  const capacity_gates={...capacity.gates,
   expected_primary_request_count:args.arm!=='defined_consumer_second_pass'||requests===expected.size*registration.expected_primary_http_calls_per_resolved_root,
   serving:metrics.length===workload.question_keys.length&&metrics.every((m,i)=>m.question_key===workload.question_keys[i]
    &&m.configuration_id===f.access.configuration_id&&m.counts.pending===0&&m.counts.awaiting_base===0&&m.distribution.length>0&&m.trend.length>0
    &&m.topic_cross.length>0)};
  assert.equal((await captureR16SourceProvenanceV1(repo)).source_tree_sha256,source_provenance.source_tree_sha256,'source changed during measurement');
  return{contract_version:'r16-listening-capacity-measurement-v2',acceptance:'pending_native_fault_and_census_validation',
   capacity_gates,capacity,source_provenance,job_spans,warmup_wall_ms:job_spans.filter(span=>span.warmup).reduce((sum,span)=>sum+span.end_ms-span.start_ms,0),workload,root_census_digest:digest([...expected].sort()),cold_elapsed_ms:performance.now()-coldStart,wall_elapsed_ms,classification_wall_elapsed_ms,
   fully_resolved_distinct_roots:resolved.size,requests,requests_per_resolved_root:resolved.size?requests/resolved.size:null,latency_ms,calibration,commits,jobs,metrics,storage:storageServer.metrics(),
   unresolved_roots:expected.size-resolved.size,storage_spans,sql_profile:args.query_profiler?.snapshot()??null,
   resource_observation:resources.snapshot({max_in_flight:execution.max_in_flight,window_size:execution.window_size,
    max_buffered_bytes:execution.max_buffered_bytes,flush_size:execution.flush_size,max_flushes:execution.max_flushes,
    flush_interval_ms:execution.flush_interval_ms})};
  });
  return{...observed.value,runtime_witness:observed.runtime_witness};
  });
 }finally{await storageServer.close();}
}
