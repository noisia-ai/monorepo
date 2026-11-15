import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureR16SourceProvenanceV1} from './source-provenance';
import {getSignalListeningStatusV1,readSignalListeningQuestionMetricsV1} from '../../infrastructure/db/signal-listening-serving';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {signalListeningJevJobV1,createSignalListeningRuntimeStoreV1} from '../../services/workers/src/workers/signal-listening-jev';
import {createCalibratedJevRuntimeProviderV2,jevStreamingExecutionFromEnvV2} from '../../services/workers/src/providers/jev-streaming-runtime';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from './synthetic-jev';
import {startR16HttpFilesystemStorageV1} from './http-filesystem-storage';
import {r16ListeningWorkloadV1,summarizeR16ListeningCapacityV1,R16_LISTENING_PREREGISTRATION_V1 as registration,type R16ListeningArmV1} from './listening-workload';

/** Native fixture ownership is deliberately external: seeding may not invent a
 * configuration, profile, scope, admission, money event or serving projection. */
export type R16ListeningFixtureV1={
 access:Parameters<typeof readSignalListeningQuestionMetricsV1>[0];
 run_id:string;organization_id:string;root_ids:string[];
 /** PG-native projection, ALL eligible question digests resolved or natively
  * excluded, scoped to this immutable map/config/source, never call-count. */
 readResolvedRootIds(root_ids?:string[]):Promise<string[]>;
};
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
 writePreregistration(value:ReturnType<typeof r16ListeningWorkloadV1>&{registration:typeof registration;source_provenance:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>}):Promise<void>;
 withNativeFixture<T>(context:{workload:ReturnType<typeof r16ListeningWorkloadV1>;storage:WorkspaceEngineStorageV1},run:(fixture:R16ListeningFixtureV1)=>Promise<T>):Promise<T>;
 max_jobs?:number;
}){
 const redis=new URL(args.redis_url);
 if(!['127.0.0.1','localhost','[::1]'].includes(redis.hostname)||!['redis:','rediss:'].includes(redis.protocol))throw Error('r16_listening_redis_not_local');
 const workload=r16ListeningWorkloadV1(args.arm),coldStart=performance.now();
 // The persisted preregistration precedes fixture work and every physical send.
 const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),source_provenance=await captureR16SourceProvenanceV1(repo);
 await args.writePreregistration({...workload,registration,source_provenance});
 const storageServer=await startR16HttpFilesystemStorageV1(args.object_directory);
 try{
  const storage=createWorkspaceEngineStorageV1({url:storageServer.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
  return await args.withNativeFixture({workload,storage},async f=>{
  const status=await getSignalListeningStatusV1(f.access);
  assert.equal(status.configuration?.id,f.access.configuration_id);assert.equal(status.map?.id,f.access.map_id);
  assert.equal(status.run?.id,f.run_id);assert.equal(status.map?.root_count,registration.root_count);
  assert.equal(digest(status.configuration?.configuration),workload.configuration_digest);
  assert.equal(f.root_ids.length,registration.root_count);const expected=new Set(f.root_ids);assert.equal(expected.size,f.root_ids.length);
  const execution=jevStreamingExecutionFromEnvV2({NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_JEV_STREAM_BUFFER_BYTES:String(512*1024*1024)})!;
  const latency_ms:number[]=[],calibration:Array<{at_ms:number;warmup:boolean;selected_roots:number;max_in_flight:number;shape_digests:string[]}>=[];
  const providerFetch=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});
  const job_spans:Array<{start_ms:number;end_ms:number;warmup:boolean}>=[];
  let requests=0;const start=performance.now(),resolved=new Set<string>(),commits:Array<{at_ms:number;roots:number}>=[];
  const measuredFetch:typeof fetch=async(...params)=>{requests++;const began=performance.now();try{return await providerFetch(...params);}finally{latency_ms.push(performance.now()-began);}};
  const calibrated_provider_factory:typeof createCalibratedJevRuntimeProviderV2=opts=>createCalibratedJevRuntimeProviderV2({...opts,
   // Preserve the exact calibration JSON generated by H2 from its verified
   // ledger; only transport/account test configuration is replaced.
   env:{...opts.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:`r16-listening:${f.organization_id}`,
    NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:args.redis_url,NOISIA_TYPESAFE_ACCOUNT_RPS:'2000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},fetch:measuredFetch});
  const sample=async(root_ids?:string[])=>{
   const population=root_ids?new Set(root_ids):expected,previous=root_ids?new Set([...resolved].filter(id=>population.has(id))):resolved;
   const rows=await f.readResolvedRootIds(root_ids),newIds=reconcileR16ListeningResolvedRootsV1(population,previous,rows);
   if(newIds.length){newIds.forEach(id=>resolved.add(id));commits.push({at_ms:performance.now()-start,roots:newIds.length});}
  };
  const nativeStore=createSignalListeningRuntimeStoreV1(f.access.database,{execution,storage});
  const store={...nativeStore,async apply(...params:Parameters<typeof nativeStore.apply>){
   await nativeStore.apply(...params);
   const roots=[...new Set(params[1].flatMap(row=>row.results.map(result=>result.root_id)))];
   for(let offset=0;offset<roots.length;offset+=1024)await sample(roots.slice(offset,offset+1024));
  }};
  let jobs=0;
  for(;jobs<(args.max_jobs??10000)&&resolved.size<expected.size;jobs++){
    const jobStart=performance.now()-start,calibrationIndex=calibration.length;
    const outcome=await signalListeningJevJobV1(f.run_id,{database:f.access.database,store,execution,preflight:async()=>{},calibrated_provider_factory,
     observe_calibration:event=>calibration.push({...event,at_ms:performance.now()-start})});
    job_spans.push({start_ms:jobStart,end_ms:performance.now()-start,warmup:calibration.slice(calibrationIndex).some(event=>event.warmup)});
    if(['failed','outcome_unknown','lease_lost'].includes(outcome.status))break;
   }
  const classification_wall_elapsed_ms=performance.now()-start;
  const beforeFinal=resolved.size;await sample();
  assert.equal(resolved.size,beforeFinal,'final census found roots not observed after native page apply');
  const metrics=await Promise.all(workload.question_keys.map(question_key=>readSignalListeningQuestionMetricsV1({...f.access,question_key})));
  const wall_elapsed_ms=performance.now()-start;
  const capacity=summarizeR16ListeningCapacityV1({wall_elapsed_ms,resolved_roots:resolved.size,commits,latency_ms});
  const capacity_gates={...capacity.gates,
   serving:metrics.every(m=>m.counts.pending===0&&m.counts.awaiting_base===0&&m.distribution.length>0&&m.trend.length>0
    &&m.topic_cross.length>0)};
  assert.equal((await captureR16SourceProvenanceV1(repo)).source_tree_sha256,source_provenance.source_tree_sha256,'source changed during measurement');
  return{contract_version:'r16-listening-capacity-measurement-v1',acceptance:'pending_native_fault_and_census_validation',
   capacity_gates,capacity,source_provenance,job_spans,warmup_wall_ms:job_spans.filter(span=>span.warmup).reduce((sum,span)=>sum+span.end_ms-span.start_ms,0),workload,root_census_digest:digest([...expected].sort()),cold_elapsed_ms:performance.now()-coldStart,wall_elapsed_ms,classification_wall_elapsed_ms,
   fully_resolved_distinct_roots:resolved.size,requests,latency_ms,calibration,commits,jobs,metrics,storage:storageServer.metrics(),
   unresolved_roots:expected.size-resolved.size};
  });
 }finally{await storageServer.close();}
}
