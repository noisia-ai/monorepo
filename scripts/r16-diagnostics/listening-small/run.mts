import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createListeningObserver,DML_PLAN_MAX_PLANS,DML_PLAN_MIN_BATCH,DML_PLAN_MIN_DURATION_MS,finishListeningObserver,INNER_PLAN_MIN_DURATION_MS} from './observer.mjs';

const ROOT_COUNT=4096;
const MAX_MS=9*60*1000;
const NOOP={diagnostic_only:true,h1_accepted:false,status:'no_database_action'} as const;
const providerSecrets=['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','TYPESAFE_API_KEY',
  'NOISIA_TYPESAFE_API_KEY','VOYAGE_API_KEY','VOYAGEAI_API_KEY','SONNET_API_KEY'];
const probeFiles=['.github/workflows/r16-listening-small-diagnostic.yml',
  'scripts/r16-diagnostics/listening-small/run.mts','scripts/r16-diagnostics/listening-small/run.test.mts',
  'scripts/r16-diagnostics/listening-small/observer.mts'] as const;
const sha=(value:string)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const percentile=(xs:number[],p:number)=>{if(!xs.length)return 0;const s=[...xs].sort((a,b)=>a-b);return s[Math.ceil(s.length*p)-1]!;};

export function assertListeningSmallGuardV1(env:NodeJS.ProcessEnv,args:string[]){
  if(!args.includes('--run'))return;
  assert.equal(env.GITHUB_ACTIONS,'true','diagnostic_requires_github_actions');
  assert.equal(env.NOISIA_R16_SMALL_DIAGNOSTIC,'true','diagnostic_opt_in_required');
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
  let stage='imports';
  let storageServer:any;
  const observer=createListeningObserver();
  observer.setInnerPlanRootCount(ROOT_COUNT);
  try{
    Object.assign(process.env,{NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',NOISIA_R16_NATIVE_FIXTURE_PG:'true',
      NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',
      NOISIA_JEV_STREAM_BUFFER_BYTES:String(512*1024*1024),NOISIA_MASS_LABELING_ENABLED:'true'});
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
        const execution=providerModule.jevStreamingExecutionFromEnvV2(process.env)!;
        const latencies:number[]=[],calibrations:any[]=[],commits:number[]=[];
        const synthetic=syntheticModule.createSyntheticJevFetchV1({latencyForRequest:(i:number)=>125+((i*137+47)%351)});
        let requests=0;const countedFetch:typeof fetch=async(...args:any[])=>{requests++;const t=performance.now();try{return await synthetic(...args);}finally{latencies.push(performance.now()-t);}};
        const providerFactory=(opts:any)=>providerModule.createCalibratedJevRuntimeProviderV2({...opts,
          env:{...opts.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:`r16-listening-small:${census.organization_id}`,
            NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:process.env.R16BENCH_REDIS_URL!,NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',
            NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},fetch:countedFetch});
        const unprofiled=jobModule.createSignalListeningRuntimeStoreV1(db,{execution,storage});
        const profiled=observer.wrapStore(profile.wrapStore(unprofiled));
        const store={...profiled,async apply(...args:any[]){await profiled.apply(...args);const roots=[...new Set(args[1].flatMap((row:any)=>row.results.map((x:any)=>x.root_id)))];
          for(let n=0;n<roots.length;n+=1024){const resolved=await census.readResolvedRootIds(roots.slice(n,n+1024));commits.push(resolved.length);}}};
        const rootSet=new Set<string>();
        const startedProcessing=performance.now();let jobs=0;
        stage='native_jobs';
        while(jobs<100&&rootSet.size<ROOT_COUNT&&performance.now()-started<MAX_MS){
          const before=calibrations.length;
          const outcome=await jobModule.signalListeningJevJobV1(prepared.run_id,{database:db,store,execution,storage,
            preflight:()=>preflightModule.assertR16ListeningSyntheticPreflightV1({storage,storage_url:storageServer.base_url,
              configuration:workload.configuration,configuration_digest:workload.configuration_digest,env:process.env}),
            calibrated_provider_factory:providerFactory,
            observe_calibration:(event:any)=>calibrations.push(captureCalibrationObservationV1(event))});
          jobs++;
          if(['failed','outcome_unknown','lease_lost'].includes(outcome.status))throw Error('native_job_failed');
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
            preparation_admission_wall_ms:startedProcessing-admissionStarted,classification_serving_wall_ms:performance.now()-startedProcessing,
            warmups:warmups.length,warmup_phases:warmupPhases,calibrations,commit_batch_count:commits.length},
          observed_http_latency:latencySummary,storage:storageServer.metrics(),sql_profile:profile.snapshot(),
          inner_plan_capture:{diagnostic_only:true,threshold_roots:1024,max_captures_per_query_hash:2,min_duration_ms:INNER_PLAN_MIN_DURATION_MS,
            plans_below_min_duration_captured:false,observations:observer.snapshot().inner_plan_observations},
          dml_plan_capture:{diagnostic_only:true,opt_in_required:true,min_batch_size:DML_PLAN_MIN_BATCH,max_captures_per_query_hash:1,min_duration_ms:DML_PLAN_MIN_DURATION_MS,
            plans_below_min_duration_captured:false,max_plans_per_capture:DML_PLAN_MAX_PLANS,trigger_names_allowlisted:true,raw_query_or_values_recorded:false,
            analyze_timing_enabled:true,analyze_timing_overhead_measured:false,capacity_claim:false,
            observations:observer.snapshot().dml_plan_observations},
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
    const observerSnapshot=await finishListeningObserver(observer);
    const failure={contract_version:'r16-listening-small-diagnostic-v1',diagnostic_only:true,h1_accepted:false,
      status:'failed',stage,code:safeError(error),total_wall_ms:performance.now()-started,observer:observerSnapshot,
      inner_plan_capture:{diagnostic_only:true,threshold_roots:1024,max_captures_per_query_hash:2,min_duration_ms:INNER_PLAN_MIN_DURATION_MS,
        plans_below_min_duration_captured:false,observations:observerSnapshot.inner_plan_observations},
      dml_plan_capture:{diagnostic_only:true,opt_in_required:true,min_batch_size:DML_PLAN_MIN_BATCH,max_captures_per_query_hash:1,min_duration_ms:DML_PLAN_MIN_DURATION_MS,
        plans_below_min_duration_captured:false,max_plans_per_capture:DML_PLAN_MAX_PLANS,trigger_names_allowlisted:true,raw_query_or_values_recorded:false,
        analyze_timing_enabled:true,analyze_timing_overhead_measured:false,capacity_claim:false,
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
