import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {
  CONSUMER_CPU_LIMITS_V1,
  createConsumerMainThreadCpuObserverV1,
  loadConsumerCpuSourcesV1,
  sanitizeConsumerCpuProfileV1,
  type ConsumerCpuBackendV1,
} from './signal-listening-consumer-main-thread-cpu.synthetic.fixture';
import {runListeningPipelineProfileV1} from './signal-listening-pipeline-profile.synthetic.fixture';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';

const native=process.env.NOISIA_R16_CONSUMER_MAIN_THREAD_CPU_PG==='true';
const pure=process.env.NOISIA_R16_CONSUMER_MAIN_THREAD_CPU_PURE==='true';
assert.ok(!(native&&pure),'native and pure consumer CPU modes must stay separate');

const nativeTitle='native Listening main-thread CPU profile brackets the drained synthetic consumer pipeline';
const repoRoot=resolve(process.cwd());
let sourcesPromise:ReturnType<typeof loadConsumerCpuSourcesV1>|undefined;
const sources=()=>sourcesPromise??=loadConsumerCpuSourcesV1(repoRoot);

type CpuRawProfile={nodes:unknown[];startTime:number;endTime:number;samples:unknown[];timeDeltas:unknown[]};
function validProfile(endTime=2_000):CpuRawProfile{
  return{nodes:[{id:1,callFrame:{url:'',functionName:'(root)',lineNumber:-1,columnNumber:-1},children:[]}],
    startTime:0,endTime,samples:[1],timeDeltas:[endTime]};
}

function backend(overrides:Partial<ConsumerCpuBackendV1>={},profile:unknown=validProfile()):ConsumerCpuBackendV1{
  return{connect(){},async enable(){},async setSamplingInterval(){},async start(){},async stop(){return{profile};},async disable(){},disconnect(){},...overrides};
}

async function runThenPublish<T>(run:()=>Promise<T>,publish:()=>Promise<void>):Promise<T>{
  let hasPrimary=false,primary:unknown,result:T|undefined;
  try{result=await run();}catch(error){hasPrimary=true;primary=error;}
  let hasPublishFailure=false,publishFailure:unknown;
  try{await publish();}catch(error){hasPublishFailure=true;publishFailure=error;}
  if(hasPrimary)throw primary;
  if(hasPublishFailure)throw publishFailure;
  return result as T;
}

function nativeCpuCaptureComplete(value:{status:unknown;stop_reason:unknown}):boolean{
  return value.status==='observed'&&value.stop_reason==='job_drained';
}

test(nativeTitle,{skip:!native},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native CPU capture is authorized only in CI');
  assert.notEqual(process.env.NOISIA_R16_CONSUMER_MAIN_THREAD_CPU_PURE,'true');
  const directory=process.env.R16_LISTENING_PIPELINE_PROFILE_EVIDENCE_DIR;
  assert.ok(directory,'private profile evidence directory is required');
  let observer:ReturnType<typeof createConsumerMainThreadCpuObserverV1>|undefined;
  const pipelineReceipt=await runThenPublish(
    ()=>runListeningPipelineProfileV1({observeWorker:async(body,clock)=>{
      observer=createConsumerMainThreadCpuObserverV1({repoRoot,sourceManifest:await sources(),clock});
      await observer.run(body);
    }}),
    ()=>observer?observer.publish(directory):Promise.resolve(),
  );
  assert.ok(pipelineReceipt,'native pipeline receipt must exist');
  assert.equal(pipelineReceipt.status,'observed');
  assert.equal(pipelineReceipt.interpretation,'provider_store_query_correlated_http_spans_independent_no_causal_claim',
    'CPU evidence requires the original timeline to be complete, untrimmed, and fully correlated');
  assert.ok(observer,'native CPU observer must be created immediately before the worker');
  const snapshot=observer.snapshot();
  assert.equal(nativeCpuCaptureComplete(snapshot),true,'native acceptance requires profiling through the drained worker');
  assert.equal(snapshot.stop_commands,1);
  assert.equal(snapshot.worker,'drained');
  assert.equal(snapshot.h1_accepted,false);
  assert.equal(snapshot.cpu,'SAMPLED_NOT_EXACT');
  assert.equal(snapshot.hard_duration_bound,false);
  const persisted=JSON.parse(await readFile(join(directory,'listening-main-thread-cpu.json'),'utf8')) as typeof snapshot;
  const pipeline=JSON.parse(await readFile(join(directory,'listening-pipeline-profile.json'),'utf8'));
  const sourceBinding=pipeline.source_binding as {status:string;matches_expected_git:boolean;expected_git:unknown;runtime_before:unknown;runtime_after:unknown};
  assert.equal(sourceBinding.status,'observed','CPU acceptance requires complete full-source provenance');
  assert.equal(sourceBinding.matches_expected_git,true);
  assert.deepEqual(sourceBinding.runtime_before,sourceBinding.expected_git,'runtime source before setup must match immutable Git');
  assert.deepEqual(sourceBinding.runtime_after,sourceBinding.expected_git,'runtime source after factory cleanup must match immutable Git');
  assert.equal((sourceBinding.expected_git as {head_sha:string}).head_sha,process.env.GITHUB_SHA);
  const events=pipeline.events as Record<string,unknown>;
  const counters=events.event_counts as Record<string,{seen:number;recorded:number;dropped:number}>;
  for(const [name,count] of Object.entries(counters)){
    assert.equal(count.dropped,0,name+' timeline events must not be dropped');
    assert.equal(count.recorded,count.seen,name+' timeline events must all be retained');
  }
  const templateCounts=events.query_template_counts as {seen:number;recorded:number;dropped:number};
  assert.equal(templateCounts.dropped,0,'timeline query templates must not be dropped');
  assert.equal(templateCounts.recorded,templateCounts.seen,'timeline query templates must all be retained');
  const correlation=pipeline.correlation as Record<string,unknown>;
  assert.equal(correlation.provider_events_unmatched,0);
  assert.equal(correlation.durability_events_unmatched,0);
  const timeline=events.events as Record<string,number[][]>;
  const storeEvents=timeline.store??[];
  const inputBatches=storeEvents.filter(row=>row[2]===1);
  const reserveBatches=storeEvents.filter(row=>row[2]===3);
  const calibrationEvents=timeline.calibration??[];
  const measuredCalibration=calibrationEvents.find(row=>row[1]===0);
  assert.equal(inputBatches[0]?.[3],4096,'the complete calibrated selection remains present before the first reservation');
  assert.ok(reserveBatches.length>0,'the native consumer must record its reservations');
  assert.ok(reserveBatches.every(row=>(row[3]??0)>0),'every reservation must contain only its observed proposals');
  assert.ok(measuredCalibration,'the unbounded continuous measured phase must remain observable after warmup');
  const measuredAt=measuredCalibration?.[0];assert.equal(typeof measuredAt,'number');
  const nextCalibration=calibrationEvents.find(row=>(row[0]??-1)>measuredAt!);
  const firstMeasuredReserve=reserveBatches.find(row=>(row[0]??-1)>=measuredAt!&&(!nextCalibration||(row[0]??Infinity)<(nextCalibration[0]??-1)));
  assert.ok(firstMeasuredReserve&&(firstMeasuredReserve[3]??Infinity)<=1024,'the first measured reservation stays inside the 1,024-call handoff bound');
  assert.equal(reserveBatches.reduce((sum,row)=>sum+(row[3]??0),0),4096,'all 4,096 selected consumers are reserved exactly once');
  assert.deepEqual(persisted,snapshot,'persisted CPU evidence must equal the safe observer snapshot');
  const capture=persisted.capture;
  assert.ok(capture,'successful CPU observation must retain a profile');
  assert.equal(capture.summary.positions,'GENERATED_NO_SOURCE_MAP');
  assert.equal(capture.summary.attribution,'main_thread_samples_not_exact_cpu');
  assert.equal(capture.summary.inclusive_samples,'NOT_COMPUTED');
  assert.ok(capture.profile.duration_us<=CONSUMER_CPU_LIMITS_V1.observed_ms*1000);
});

if(pure){
  test('source provenance expected manifest comes from immutable Git objects, not the measured checkout',async()=>{
    const privateParent=join(repoRoot,'.data','piloto-masivo','r16');
    await mkdir(privateParent,{recursive:true,mode:0o700});
    const temp=await mkdtemp(join(privateParent,'consumer-source-provenance-'));
    try{
      const git=(...args:string[])=>execFileSync('git',args,{cwd:temp,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      await mkdir(join(temp,'infrastructure','db'),{recursive:true});
      await mkdir(join(temp,'scripts','r16'),{recursive:true});
      await writeFile(join(temp,'infrastructure','db','included.ts'),'export const value = 1;\n');
      await writeFile(join(temp,'infrastructure','db','excluded.md'),'private docs are not source inputs\n');
      git('init','--quiet');
      git('config','user.email','r16-source-provenance-test@invalid');
      git('config','user.name','R16 source provenance test');
      git('add','infrastructure/db/included.ts','infrastructure/db/excluded.md');
      git('commit','--quiet','-m','source provenance fixture');
      const expectedCommit=git('rev-parse','HEAD').trim();
      const expected=captureR16ExpectedGitProvenanceV1(temp,expectedCommit);
      const before=await captureR16SourceProvenanceV1(temp);
      assert.equal(expected.head_sha,expectedCommit);
      assert.deepEqual(expected.file_manifest,before.file_manifest);
      assert.equal(expected.source_tree_sha256,before.source_tree_sha256);
      assert.equal(expected.file_count,1);
      assert.equal(expected.tree_status_sha256,before.tree_status_sha256);

      await writeFile(join(temp,'infrastructure','db','included.ts'),'export const value = 2;\n');
      await writeFile(join(temp,'scripts','r16','untracked.ts'),'export const untracked = true;\n');
      const after=await captureR16SourceProvenanceV1(temp);
      const independentlyRecomputed=captureR16ExpectedGitProvenanceV1(temp,expectedCommit);
      assert.deepEqual(independentlyRecomputed,expected,'expectedGit must remain anchored to the immutable commit');
      assert.notDeepEqual(after.file_manifest,expected.file_manifest,'dirty and untracked runtime source must not be self-expected');
      assert.notEqual(after.source_tree_sha256,expected.source_tree_sha256);
      assert.notEqual(after.tree_status_sha256,expected.tree_status_sha256);
    }finally{await rm(temp,{recursive:true,force:true});}
  });

  test('native CPU acceptance rejects a watchdog-stopped partial interval',()=>{
    assert.equal(nativeCpuCaptureComplete({status:'observed',stop_reason:'job_drained'}),true);
    assert.equal(nativeCpuCaptureComplete({status:'observed',stop_reason:'watchdog'}),false);
    assert.equal(nativeCpuCaptureComplete({status:'INCONCLUSIVE',stop_reason:'job_drained'}),false);
  });

  test('CPU stop latch is shared by watchdog and worker drain, then cleanup runs once',async()=>{
    const calls={stop:0,disable:0,disconnect:0,clear:0};let watchdog:(()=>void)|undefined,releaseBody:(()=>void)|undefined;
    let resolveStarted:(()=>void)|undefined,resolveEntered:(()=>void)|undefined;
    const started=new Promise<void>(resolvePromise=>{resolveStarted=resolvePromise;});
    const entered=new Promise<void>(resolvePromise=>{resolveEntered=resolvePromise;});
    const waitForBody=new Promise<void>(resolvePromise=>{releaseBody=resolvePromise;});
    const observer=createConsumerMainThreadCpuObserverV1({repoRoot,sourceManifest:await sources(),backend:backend({
      async start(){resolveStarted?.();},async stop(){calls.stop++;return{profile:validProfile()};},
      async disable(){calls.disable++;},disconnect(){calls.disconnect++;},
    }),watchdog:stop=>{watchdog=stop;return()=>{calls.clear++;};}});
    const running=observer.run(async()=>{resolveEntered?.();await waitForBody;});
    await started;
    await entered;
    assert.ok(watchdog,'watchdog must be armed after profiler start');
    watchdog();
    releaseBody?.();
    await running;
    assert.equal(calls.stop,1,'watchdog and finally must share one Profiler.stop command');
    assert.equal(calls.disable,1);
    assert.equal(calls.disconnect,1);
    assert.equal(calls.clear,1);
  });

  test('worker primary survives profiler-stop and separate publication failures',async()=>{
    const primary=Object.assign(new Error('private worker detail'),{code:'PRIVATE_WORKER_CODE'});
    const privateParent=join(repoRoot,'.data','piloto-masivo','r16');
    await mkdir(privateParent,{recursive:true,mode:0o700});
    const temp=await mkdtemp(join(privateParent,'consumer-cpu-test-'));
    try{
      const observer=createConsumerMainThreadCpuObserverV1({repoRoot,sourceManifest:await sources(),backend:backend({
        async stop(){throw Object.assign(new Error('private inspector detail'),{code:'PRIVATE_INSPECTOR_CODE'});},
      })});
      await assert.rejects(observer.run(async()=>{throw primary;}),error=>error===primary);
      assert.deepEqual(observer.snapshot().errors,['stop']);
      await writeFile(join(temp,'listening-pipeline-profile.json'),Buffer.alloc(CONSUMER_CPU_LIMITS_V1.combined_artifact_bytes+1),{mode:0o600});
      let publishError:unknown;
      try{await observer.publish(temp);}catch(error){publishError=error;}
      assert.ok(publishError instanceof Error);
      assert.equal(publishError.message,'consumer_cpu_publication_failed');
      assert.equal(primary.message,'private worker detail','secondary profiler/publication failures must not rewrite worker primary');
      assert.equal((publishError as Error).message.includes('PRIVATE_'),false);

      for(const falsyPrimary of [undefined,null,0,''] as const){
        const second=createConsumerMainThreadCpuObserverV1({repoRoot,sourceManifest:await sources(),backend:backend({
          async stop(){throw new Error('secondary stop error');},
        })});
        let caught=false,observed:unknown;
        try{
          await runThenPublish(
            ()=>second.run(async()=>{throw falsyPrimary;}),
            async()=>{throw new Error('secondary publication error');},
          );
        }catch(error){caught=true;observed=error;}
        assert.equal(caught,true,'the primary rejection must remain observable even when falsy');
        assert.ok(Object.is(observed,falsyPrimary),'publication and stop failures must not replace the exact primary value');
      }
    }finally{await rm(temp,{recursive:true,force:true});}
  });

  test('CPU sanitizer drops dynamic frame strings and rejects malformed or over-limit profiles',async()=>{
    const manifest=await sources();
    const dynamic=validProfile();
    (dynamic.nodes[0] as Record<string,unknown>).callFrame={url:'/tmp/PRIVATE_SENTINEL/path.js',functionName:'privateCustomerName',lineNumber:9,columnNumber:3};
    const safe=sanitizeConsumerCpuProfileV1(dynamic,repoRoot,manifest);
    const encoded=JSON.stringify(safe);
    assert.doesNotMatch(encoded,/PRIVATE_SENTINEL|privateCustomerName|path\.js/u);
    assert.equal(safe.profile.nodes[0]!.frame.category,'unknown');
    assert.equal(safe.profile.nodes[0]!.frame.position_kind,'NONE');

    const tooManySamples={...validProfile(),samples:Array.from({length:CONSUMER_CPU_LIMITS_V1.samples+1},()=>1),
      timeDeltas:Array.from({length:CONSUMER_CPU_LIMITS_V1.samples+1},()=>1)};
    assert.throws(()=>sanitizeConsumerCpuProfileV1(tooManySamples,repoRoot,manifest),/consumer_cpu_profile_invalid_or_over_limit/u);
    const tooManyNodes={...validProfile(),nodes:Array.from({length:CONSUMER_CPU_LIMITS_V1.nodes+1},(_,index)=>({
      id:index+1,callFrame:{url:'',functionName:'(root)',lineNumber:-1,columnNumber:-1},children:[]}))};
    assert.throws(()=>sanitizeConsumerCpuProfileV1(tooManyNodes,repoRoot,manifest),/consumer_cpu_profile_invalid_or_over_limit/u);
    const deepNodes=Array.from({length:CONSUMER_CPU_LIMITS_V1.depth+2},(_,index)=>({
      id:index+1,callFrame:{url:'',functionName:'(root)',lineNumber:-1,columnNumber:-1},children:index+2<CONSUMER_CPU_LIMITS_V1.depth+2?[index+2]:[]}));
    assert.throws(()=>sanitizeConsumerCpuProfileV1({...validProfile(),nodes:deepNodes},repoRoot,manifest),
      /consumer_cpu_profile_invalid_or_over_limit/u);
    const getterFrame=Object.defineProperty({},'url',{enumerable:true,get(){throw new Error('PRIVATE_GETTER');}});
    const poisoned={nodes:[{id:1,callFrame:getterFrame,children:[]}],startTime:0,endTime:1,samples:[1],timeDeltas:[1]};
    assert.throws(()=>sanitizeConsumerCpuProfileV1(poisoned,repoRoot,manifest),/consumer_cpu_profile_invalid_or_over_limit/u);
  });

  test('CPU sanitizer does not read Proxy array length, iterator, or map traps',async()=>{
    const trapReads:string[]=[];
    const guarded=<T>(values:T[])=>new Proxy(values,{get(target,key,receiver){
      if(key==='length'||key===Symbol.iterator||key==='map'){
        trapReads.push(typeof key==='symbol'?key.toString():key);
        throw new Error('PRIVATE_ARRAY_TRAP');
      }
      return Reflect.get(target,key,receiver);
    }});
    const raw=validProfile() as {nodes:unknown[];samples:number[];timeDeltas:number[]};
    raw.nodes=guarded(raw.nodes);
    raw.samples=guarded(raw.samples);
    raw.timeDeltas=guarded(raw.timeDeltas);
    let safe:ReturnType<typeof sanitizeConsumerCpuProfileV1>|undefined;
    try{safe=sanitizeConsumerCpuProfileV1(raw,repoRoot,await sources());}catch(error){
      assert.ok(error instanceof Error);
      assert.equal(error.message,'consumer_cpu_profile_invalid_or_over_limit');
    }
    assert.deepEqual(trapReads,[],'array validation must use own descriptors, not get/iterator/map traps');
    if(safe)assert.deepEqual(safe.profile.samples,[1]);
  });

  test('late profiler stop produces inconclusive evidence without abandoning worker drain',async()=>{
    let bodyDrained=false;
    const observer=createConsumerMainThreadCpuObserverV1({repoRoot,sourceManifest:await sources(),backend:backend({},validProfile(60_000_001))});
    await assert.rejects(observer.run(async()=>{bodyDrained=true;}),error=>
      error instanceof Error&&error.message==='consumer_cpu_observation_incomplete');
    const result=observer.snapshot();
    assert.equal(bodyDrained,true);
    assert.equal(result.stop_commands,1);
    assert.equal(result.errors.includes('sanitize'),true);
    assert.equal(result.status,'INCONCLUSIVE');
    assert.equal(result.hard_duration_bound,false);
  });
}
