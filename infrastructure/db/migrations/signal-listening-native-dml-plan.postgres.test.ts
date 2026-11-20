import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Client,type PoolClient} from 'pg';
import {buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,
 signalListeningCalibrationShapeV1,llmCostMicroUsdV1,llmPriceV1,type SignalListeningInputV1} from '@noisia/query-engine';
import type {LabelingCallProposalV1,LabelingCallV1,LabelingRunV1} from '../signal-labeling-runs';
import {deriveSignalListeningCalibrationV1} from '../signal-listening-calibration';
import {createR16ListeningNativeFixtureV1} from '../../../scripts/r16/listening-native-fixture';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {withR16ListeningRuntimeWitnessV1,type R16ListeningRuntimeWitnessV1} from '../../../scripts/r16/run-listening-benchmark';
import {startR16HttpFilesystemStorageV1} from '../../../scripts/r16/http-filesystem-storage';
import {buildSyntheticJevResponseV1} from '../../../scripts/r16/synthetic-jev';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';
import {createSignalListeningRuntimeStoreV1} from '../../../services/workers/src/workers/signal-listening-jev';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {createNativeDmlPlanObserverV1,NATIVE_DML_PLAN_TITLE_V1,nativeDmlPlanShaV1,
 createNativeDmlPlanClientGuardV1,nativeDmlPlanOwnerOutcomeV1,nativeDmlLateGrowthLimitV1,
 type NativeDmlPlanSnapshotV1,type NativeDmlPlanClientStateV1,createNativeDmlNestedRecorderV1,
 NATIVE_DML_NESTED_FILE_V1,NATIVE_DML_NESTED_LIMITS_V1,NATIVE_DML_NESTED_PREFLIGHT_SQL_V1} from './signal-listening-native-dml-plan.test-support';
import {captureNativeLateSnapshotV1,NATIVE_LATE_SNAPSHOT_CONTRACT_V1} from './signal-listening-native-dml-late-snapshot.test-support';
import {observeNativeLateSurveyV1,NativeLateSurveyObservationErrorV1} from './signal-listening-native-late-survey.test-support';


/** Fast compatibility probe on the owned migrated lab, before any cold fixture. */
async function instrumentationPreflight(recorder:ReturnType<typeof createNativeDmlNestedRecorderV1>){
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 const lifecycle=recorder.probe(client,{phase:'preflight',operation:'select',sql:NATIVE_DML_NESTED_PREFLIGHT_SQL_V1});
 let begun=false,savepoint=false,rollbackSent=false,released=false,restorationAttempted=false,primary:unknown;
 try{
  await client.connect();await client.query('BEGIN');begun=true;
  await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'");await lifecycle.beforeSavepoint();
  await client.query('SAVEPOINT r16_nested_preflight');savepoint=true;await lifecycle.afterSavepoint();
  lifecycle.explainStarted();try{await client.query(NATIVE_DML_NESTED_PREFLIGHT_SQL_V1);}finally{lifecycle.explainFinished();}
  rollbackSent=true;await client.query('ROLLBACK TO SAVEPOINT r16_nested_preflight');
  await client.query('RELEASE SAVEPOINT r16_nested_preflight');released=true;
  restorationAttempted=true;await lifecycle.afterRestore();lifecycle.assertCapture();
 }catch(error){primary=error;
  if(savepoint&&!rollbackSent){rollbackSent=true;
   try{await client.query('ROLLBACK TO SAVEPOINT r16_nested_preflight');await client.query('RELEASE SAVEPOINT r16_nested_preflight');released=true;}
   catch(cleanup){primary=new AggregateError([primary,cleanup],'nested_preflight_rollback_failed',{cause:primary});}}
  if(released&&!restorationAttempted){restorationAttempted=true;try{await lifecycle.afterRestore();}
   catch(cleanup){primary=new AggregateError([primary,cleanup],'nested_preflight_restore_failed',{cause:primary});}}
 }finally{
  lifecycle.finish();
  if(begun)try{await client.query('ROLLBACK');}catch(cleanup){primary=new AggregateError([primary,cleanup],'nested_preflight_owner_rollback_failed',{cause:primary});}
  try{await client.end();if(recorder.preflight)recorder.preflight.close_ack=true;}
  catch(cleanup){primary=new AggregateError([primary,cleanup],'nested_preflight_close_failed',{cause:primary});}
 }
 if(primary!==undefined)throw primary;
}

const enabled=process.env.NOISIA_R16_NATIVE_DML_PLAN_PG==='true';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const clean='sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const execution={max_in_flight:1024,window_size:4096,max_buffered_bytes:512*1024*1024,
 flush_size:1024,max_flushes:2,flush_interval_ms:250};
const bounds={max_rows:4096,max_working_bytes:execution.max_buffered_bytes};
async function privateJson(path:string,value:unknown,maxBytes:number){
 const raw=JSON.stringify(value);assert.ok(Buffer.byteLength(raw)<=maxBytes,'native_dml_plan_evidence_too_large');
 const handle=await open(path,'wx',0o600);try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 return{file:path.split('/').at(-1)!,bytes:Buffer.byteLength(raw),sha256:nativeDmlPlanShaV1(raw)};
}
/** Every business table written by these commands/installed triggers, including
 * receipt materializations, is compared in full. No body/value is put in TAP. */
async function snapshot(c:PoolClient,run:LabelingRunV1):Promise<NativeDmlPlanSnapshotV1>{
 const tables:[string,string,string[]][]=[
  ['calls','SELECT to_jsonb(t) row FROM signal_labeling_calls t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['links','SELECT to_jsonb(t) row FROM signal_listening_call_questions t WHERE run_id=$1 ORDER BY call_id,question_key',[run.id]],
  ['answers','SELECT to_jsonb(t) row FROM signal_listening_answers t WHERE run_id=$1 ORDER BY root_id,question_key',[run.id]],
  ['failures','SELECT to_jsonb(t) row FROM signal_listening_failures t WHERE run_id=$1 ORDER BY call_id',[run.id]],
  ['raw_pages','SELECT to_jsonb(t) row FROM signal_labeling_raw_pages t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['raw_members','SELECT to_jsonb(t) row FROM signal_labeling_raw_page_members t WHERE run_id=$1 ORDER BY call_id',[run.id]],
  ['mutation_fences','SELECT to_jsonb(t) row FROM signal_labeling_page_mutation_fences t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['run','SELECT to_jsonb(t) row FROM signal_labeling_runs t WHERE id=$1',[run.id]],
  ['admission','SELECT to_jsonb(t) row FROM signal_processing_admissions t WHERE id=$1',[run.processing_admission_id!]],
 ];
 const full:Record<string,unknown>={},counts:Record<string,number>={};
 for(const[key,sql,values]of tables){const rows=(await c.query(sql,values)).rows;full[key]=rows;counts[key]=rows.length;}
 full.exposure=(await c.query(`SELECT exposure.total_micro_usd::text organization,
  (SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd
   ELSE reserved_micro_usd END),0)::text FROM signal_labeling_calls WHERE run_id=$1) run
  FROM signal_processing_admissions a CROSS JOIN LATERAL signal_processing_org_exposure_v1(a.organization_id,a.budget_date,a.budget_timezone) exposure
  WHERE a.id=$2`,[run.id,run.processing_admission_id])).rows;
 return{raw:JSON.stringify(full),counts};
}
async function lateSnapshot(c:PoolClient,run:LabelingRunV1,onUnknown:(error:unknown)=>void):Promise<NativeDmlPlanSnapshotV1>{
 const tables:[string,string,string[]][]=[
  ['calls','SELECT to_jsonb(t) row FROM signal_labeling_calls t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['links','SELECT to_jsonb(t) row FROM signal_listening_call_questions t WHERE run_id=$1 ORDER BY call_id,question_key',[run.id]],
  ['answers','SELECT to_jsonb(t) row FROM signal_listening_answers t WHERE run_id=$1 ORDER BY root_id,question_key',[run.id]],
  ['failures','SELECT to_jsonb(t) row FROM signal_listening_failures t WHERE run_id=$1 ORDER BY call_id',[run.id]],
  ['raw_pages','SELECT to_jsonb(t) row FROM signal_labeling_raw_pages t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['raw_members','SELECT to_jsonb(t) row FROM signal_labeling_raw_page_members t WHERE run_id=$1 ORDER BY call_id',[run.id]],
  ['mutation_fences','SELECT to_jsonb(t) row FROM signal_labeling_page_mutation_fences t WHERE run_id=$1 ORDER BY id',[run.id]],
  ['run','SELECT to_jsonb(t) row FROM signal_labeling_runs t WHERE id=$1',[run.id]],
  ['admission','SELECT to_jsonb(t) row FROM signal_processing_admissions t WHERE id=$1',[run.processing_admission_id!]],
 ];
 assert.deepEqual(tables.map(row=>row[0]),['calls','links','answers','failures','raw_pages','raw_members','mutation_fences','run','admission']);
 return captureNativeLateSnapshotV1({client:c,tables:tables.map(([name,sql,values])=>({name,sql,values})),
  scope:{workspace_id:run.workspace_id,run_id:run.id,processing_admission_id:run.processing_admission_id!},onUnknown,
  exposure:{sql:"SELECT exposure.total_micro_usd::text organization,(SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)::text FROM signal_labeling_calls WHERE run_id=$1) run FROM signal_processing_admissions a CROSS JOIN LATERAL signal_processing_org_exposure_v1(a.organization_id,a.budget_date,a.budget_timezone) exposure WHERE a.id=$2",
   values:[run.id,run.processing_admission_id!]}});
}
async function privateLineJson(path:string,value:unknown,maxBytes:number){
 const raw=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(raw)<=maxBytes,'native_late_survey_evidence_too_large');
 const handle=await open(path,'wx',0o600);try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 return{file:path.split('/').at(-1)!,bytes:Buffer.byteLength(raw),sha256:nativeDmlPlanShaV1(raw)};
}
type NativeLateCensusV1={total_calls:number;durable_applied_calls:number;base_calls:number;consumer_calls:number;resolved_roots:number;unresolved_roots:number};

async function assertAnswerTriggers(c:Pick<PoolClient,'query'>){
 const rows=(await c.query(`SELECT t.tgname,t.tgenabled,t.tgtype,p.proname,n.nspname,p.prosrc,
  pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='public.signal_listening_answers'::regclass
  AND NOT t.tgisinternal ORDER BY t.tgname`)).rows;
 assert.equal(rows.length,1,'native_dml_plan_unreviewed_answer_trigger');
 const row=rows[0]!;assert.equal(row.tgname,'signal_listening_answer_guard');assert.equal(row.tgenabled,'O');
 assert.equal(row.tgtype,31);assert.equal(row.proname,'signal_listening_answer_guard_v1');assert.equal(row.nspname,'public');
 assert.equal(nativeDmlPlanShaV1(row.prosrc),'83a1d0366bee6339fb010140084bc42dfcabe7b63bb07dc8566272eb7659357f');
 return rows.map(({prosrc,...other})=>({...other,prosrc_sha256:nativeDmlPlanShaV1(prosrc)}));
}

test(NATIVE_DML_PLAN_TITLE_V1,{skip:!enabled,timeout:30*60*1000},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 assert.match(process.env.GITHUB_SHA??'',/^[0-9a-f]{40}$/u);
 for(const key of ['NOISIA_R16_NATIVE_FIXTURE_PG','NOISIA_MASS_LABELING_ENABLED','NOISIA_SIGNAL_LISTENING_ENABLED'])assert.equal(process.env[key],'true');
 const pg=new URL(process.env.DATABASE_URL??'');assert.equal(pg.hostname,'127.0.0.1');assert.equal(pg.protocol,'postgresql:');
 assert.equal(pg.pathname,'/noisia_mfp_ci');assert.equal(pg.username,'postgres');
 for(const key of Object.keys(process.env))assert.ok(!/(?:ANTHROPIC|SONNET|VOYAGE).*?(?:API_KEY|TOKEN)/u.test(key),'native_dml_plan_real_provider_key_forbidden');
 const envDirectory=process.env.R16_NATIVE_DML_PLAN_EVIDENCE_DIR;
 assert.equal(envDirectory,'.data/piloto-masivo/r16/native-dml-plan-evidence');
 const directory=resolve(repo,envDirectory!);await mkdir(directory,{recursive:true,mode:0o700});
 const sourceBefore=await captureR16SourceProvenanceV1(repo),expected=await captureR16ExpectedGitProvenanceV1(repo,process.env.GITHUB_SHA!);
 assert.equal(sourceBefore.tree_status_sha256,clean);assert.deepEqual(sourceBefore,expected);
 const workflowPath='.github/workflows/mfp-postgres.yml';
 const workflow=await readFile(join(repo,workflowPath));
 assert.equal(nativeDmlPlanShaV1(workflow),nativeDmlPlanShaV1(execFileSync('git',['show',expected.head_sha+':'+workflowPath],{cwd:repo})));
 const observer=createNativeDmlPlanObserverV1();
 const moneySource=await readFile(join(repo,'infrastructure/db/migrations/0337_signal_listening_wire_population.sql'),'utf8');
 const guardSource=await readFile(join(repo,'infrastructure/db/migrations/0339_signal_listening_answer_guard_narrow.sql'),'utf8');
 assert.equal(nativeDmlPlanShaV1(moneySource),'5af216411e8924fa757b3ecae5ae574cb8737ca754f7c06a27eec455396980eb');
 assert.equal(nativeDmlPlanShaV1(guardSource),'903e7cc04436235751cd19e047122560c0df3e397da6b70134c86cb01358c9f0');
 const money=/CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS \$\$([\s\S]*?)\$\$;/u.exec(moneySource)?.[1];
 const answer_guard=/CREATE OR REPLACE FUNCTION signal_listening_answer_guard_v1\(\) RETURNS trigger[\s\S]*?AS \$\$([\s\S]*?)\$\$;/u.exec(guardSource)?.[1];
 assert.ok(money&&answer_guard,'nested_fixed_prosrc_missing');
 assert.equal(nativeDmlPlanShaV1(money),'c9aba3719759b7cf09d96371be79838f487707b66a3c20d13070e7559a31a2e0');
 assert.equal(nativeDmlPlanShaV1(answer_guard),'83a1d0366bee6339fb010140084bc42dfcabe7b63bb07dc8566272eb7659357f');
 const nested=createNativeDmlNestedRecorderV1({money,answer_guard});
 const lateObserver=createNativeDmlPlanObserverV1(),lateNested=createNativeDmlNestedRecorderV1({money,answer_guard});
 let lateMode=false,earlyScopeClosed=false,surveyClosed=false,lateAttempted=false;
 let sourceLateBefore:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>|undefined;
 let runtimeWitnessLate:R16ListeningRuntimeWitnessV1|undefined;
 const lateAnswerTriggers:{before:unknown;after:unknown}={before:null,after:null};
 const lateCensus:{before?:NativeLateCensusV1;after?:NativeLateCensusV1}={};
 const lateCohort:Record<string,unknown>={},growth={cohorts:0,native_calls:0,legacy_calls:0,elapsed_ms:0};
 type NativeStore=ReturnType<typeof createSignalListeningRuntimeStoreV1>;
 type Profile=NonNullable<Awaited<ReturnType<typeof deriveSignalListeningCalibrationV1>>>;
 const continuation:{value?:{run:LabelingRunV1;store:NativeStore;profiles:Map<string,Profile>;
  proposals:(inputs:SignalListeningInputV1[])=>LabelingCallProposalV1<SignalListeningInputV1>[];
  complete:(calls:ReadonlyArray<LabelingCallV1<SignalListeningInputV1>>)=>Promise<void>}}={};
 const clientStates:NativeDmlPlanClientStateV1[]=[];
 const phaseReceipts:Array<Record<string,unknown>>=[];let runForSnapshot:LabelingRunV1|undefined;
 let runtimeWitness:R16ListeningRuntimeWitnessV1|undefined,finalCensus:Record<string,number>|undefined;
 const answerTriggers:{before:unknown;after:unknown}={before:null,after:null};
 let fixtureReturned=false,storageClosed=false,storageRemoved=false,failed=false,primary:unknown;
 let rawDirectory:string|undefined,http:Awaited<ReturnType<typeof startR16HttpFilesystemStorageV1>>|undefined;
 const withFixture=createR16ListeningNativeFixtureV1({loadNativeCensus:args=>loadR16ListeningNativeCensusV1(args),
  decorateDatabase(database){
   return{query:database.query.bind(database),connect:async()=>{
    const c=await database.connect();
    const guard=createNativeDmlPlanClientGuardV1(c,async({sql,values,normal,markUnknown})=>{
     if(sql==='BEGIN'){const result=await normal();await c.query("SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='1s'");return result;}
     if(!runForSnapshot)return normal();
     return (lateMode?lateObserver:observer).query({client:c,sql,values,snapshot:()=>lateMode?lateSnapshot(c,runForSnapshot!,markUnknown):snapshot(c,runForSnapshot!),onUnknown:markUnknown,
      beforeProbe:async operation=>{if(operation==='apply')await assertAnswerTriggers(c);},
      instrumentation:identity=>(lateMode?lateNested:nested).probe(c,identity),normal});
    });clientStates.push(guard.state);return guard.client;
   }};
  }});
 const workload=r16ListeningWorkloadV2('defined_consumer_second_pass');
 try{
  await instrumentationPreflight(nested);
  rawDirectory=await mkdtemp(join(tmpdir(),'r16-native-dml-plan-'));
  http=await startR16HttpFilesystemStorageV1(rawDirectory);
  const storage=createWorkspaceEngineStorageV1({url:http.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
  await withFixture({workload,storage},async f=>{
   assert.equal(f.root_ids.length,32768);assert.equal(new Set(f.root_ids).size,32768);
   await withR16ListeningRuntimeWitnessV1(f.access.database,async witness=>{
    runtimeWitness=witness;answerTriggers.before=await assertAnswerTriggers(f.access.database);
    const store=createSignalListeningRuntimeStoreV1(f.access.database,{execution,storage});
    const run=await store.claim(f.run_id);assert.ok(run);runForSnapshot=run;
    const profiles=new Map<string,Profile>();
    const all=await store.inputs(run,bounds);assert.ok(all.length>=752);assert.ok(all.every(i=>i.question_keys.join(',')==='promotion,voice'));
    const size=(i:SignalListeningInputV1)=>Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(i,workload.configuration)));
    const sorted=all.map(input=>({input,bytes:size(input)})).sort((a,b)=>a.bytes-b.bytes||a.input.root_id.localeCompare(b.input.root_id));
    const chosen=[sorted[0]!.input,sorted.at(-1)!.input,...sorted.slice(1,-1).map(row=>row.input)].slice(0,752);
    const anchorIds=new Set(chosen.slice(0,32).map(i=>i.root_id)),nativeIds=new Set(chosen.slice(32).map(i=>i.root_id));
    assert.equal(anchorIds.size,32);assert.equal(nativeIds.size,720);
    const proposals=(inputs:SignalListeningInputV1[]):LabelingCallProposalV1<SignalListeningInputV1>[]=>inputs.map(input=>{
     const request=buildSignalListeningJevRequestV1(input,workload.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
     return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};
    });
    const complete=async(calls:ReadonlyArray<LabelingCallV1<SignalListeningInputV1>>)=>{
     const pages=calls.map(call=>{
      const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,workload.configuration);
      const body=buildSyntheticJevResponseV1(request),response=JSON.parse(body),usage=jevUsageV1(response.usage);
      return{call,raw:JSON.stringify({http_status:200,latency_ms:125,body}),usage,
       settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1('typesafe',workload.configuration.model,'sync',.042)),
       result:mapSignalListeningJevResponseV1(input,run.context,workload.configuration,response)};
     });
     await store.persistRawPage(run,pages);await store.settlePage(run,pages);
     await store.apply(run,pages.map(row=>({call:row.call,results:[row.result]})));
    };
    for(const phase of ['base','consumer']as const){
     const pending:SignalListeningInputV1[]=phase==='base'?chosen:await store.inputs(run,bounds);
     const selected:SignalListeningInputV1[]=pending.filter(i=>anchorIds.has(i.root_id)||nativeIds.has(i.root_id));assert.equal(selected.length,752);
     const keys=phase==='base'?['promotion','voice']:workload.question_keys.filter(key=>!['promotion','voice'].includes(key));
     assert.ok(selected.every(input=>JSON.stringify([...input.question_keys].sort())===JSON.stringify([...keys].sort())));
     const anchors=selected.filter(i=>anchorIds.has(i.root_id)),batch=selected.filter(i=>nativeIds.has(i.root_id));
     const warm=await store.reserve(run,proposals(anchors));assert.equal(warm.length,32);await store.markSubmitting(run,warm);await complete(warm);
     const shape=signalListeningCalibrationShapeV1(workload.configuration,anchors[0]!);
     const profile=await deriveSignalListeningCalibrationV1({...f.access,run_id:run.id,shape_digest:shape.shape_digest});
     assert.ok(profile);assert.equal(profile.sample_count,32);assert.equal(profile.source_run_id,run.id);profiles.set(phase,profile);
     assert.equal(new Set(profile.source_call_ids).size,32);assert.equal(profile.scope.phase,phase==='base'?'base':'consumer_category');
     assert.ok(batch.every(input=>size(input)>=profile.request_min_bytes&&size(input)<=profile.request_max_bytes));
     const paid:{n:number}=(await f.access.database.query(`SELECT count(*)::int n FROM signal_labeling_calls c
      WHERE c.run_id=$1 AND c.id=ANY($2::uuid[]) AND c.status='settled' AND c.results_applied
      AND c.raw_storage_verified_at IS NOT NULL AND c.raw_storage_verified_key=c.raw_storage_key`,[run.id,profile.source_call_ids])).rows[0];
     assert.equal(paid.n,32);await store.renew(run);
     observer.arm(phase,keys);
     const admission=await store.admitAndMarkSelected!(run,proposals(batch),{
      selectFresh:rows=>rows,validateBeforeCommit:(calls,rows)=>{assert.equal(calls.length,720);assert.equal(rows.length,720);assert.ok(calls.every(c=>c.status==='submitting'));},
     });
     assert.equal(admission.kind,'committed');if(admission.kind!=='committed')throw Error('native_dml_plan_unexpected_legacy');
     assert.equal(admission.calls.length,720);const admittedIds=admission.calls.map(call=>call.id);
     observer.bindApplyRoster(admittedIds);await complete(admission.calls);observer.finishPhase();
     phaseReceipts.push({phase,bootstrap_calls:32,native_calls:720,question_keys:keys,profile,RAW_source_count:paid.n,
      native_call_ids_sha256:nativeDmlPlanShaV1(JSON.stringify([...admittedIds].sort()))});
     await store.renew(run);
    }
    const count=(await f.access.database.query(`SELECT count(*)::int total_calls,
     count(*) FILTER(WHERE status='settled' AND results_applied AND raw_storage_verified_at IS NOT NULL AND raw_storage_verified_key=raw_storage_key)::int durable_applied_calls
     FROM signal_labeling_calls WHERE run_id=$1`,[run.id])).rows[0];
    assert.equal(count.total_calls,1504);assert.equal(count.durable_applied_calls,1504);
    const resolved=await f.readResolvedRootIds();assert.equal(resolved.length,752);
    assert.deepEqual([...new Set(resolved)].sort(),chosen.map(i=>i.root_id).sort());
    finalCensus={population:32768,bootstrap_calls:64,native_calls:1440,total_calls:1504,resolved_roots:752,unresolved_roots:32016};
    answerTriggers.after=await assertAnswerTriggers(f.access.database);assert.deepEqual(answerTriggers.after,answerTriggers.before);
    assert.equal(observer.observations.length,6);
    assert.deepEqual(observer.observations.map(row=>row.phase+':'+row.operation),
     ['base:insert','base:mark','base:apply','consumer:insert','consumer:mark','consumer:apply']);
    continuation.value={run,store,profiles,proposals,complete};
   });

   earlyScopeClosed=true;lateAttempted=true;sourceLateBefore=await captureR16SourceProvenanceV1(repo);assert.deepEqual(sourceLateBefore,expected);
   const state=continuation.value;assert.ok(state,'native_late_early_context_missing');const{run,store}=state;
   const consumerKeys=workload.question_keys.filter(key=>!['promotion','voice'].includes(key)).sort();assert.equal(consumerKeys.length,2);
   const baseKeys=['promotion','voice'];
   const census=async():Promise<NativeLateCensusV1>=>{
    const row=(await f.access.database.query(`SELECT count(*)::int total_calls,
     count(*) FILTER(WHERE status='settled' AND results_applied AND raw_storage_verified_at IS NOT NULL AND raw_storage_verified_key=raw_storage_key)::int durable_applied_calls,
     count(*) FILTER(WHERE inputs->0->'question_keys'=$2::jsonb)::int base_calls,
     count(*) FILTER(WHERE inputs->0->'question_keys'=$3::jsonb)::int consumer_calls,
     count(DISTINCT inputs->0->>'root_id') FILTER(WHERE inputs->0->'question_keys'=$2::jsonb)::int base_distinct,
     count(DISTINCT inputs->0->>'root_id') FILTER(WHERE inputs->0->'question_keys'=$3::jsonb)::int consumer_distinct
     FROM signal_labeling_calls WHERE run_id=$1`,[run.id,JSON.stringify(baseKeys),JSON.stringify(consumerKeys)])).rows[0];
    assert.ok(row);assert.equal(row.total_calls,row.durable_applied_calls);assert.equal(row.base_calls,row.base_distinct);
    assert.equal(row.consumer_calls,row.consumer_distinct);assert.equal(row.total_calls,row.base_calls+row.consumer_calls);
    assert.ok(row.base_calls<=32768&&row.consumer_calls<=row.base_calls);
    return{total_calls:row.total_calls,durable_applied_calls:row.durable_applied_calls,base_calls:row.base_calls,
     consumer_calls:row.consumer_calls,resolved_roots:row.consumer_calls,unresolved_roots:32768-row.consumer_calls};
   };
   const initial=await census();assert.equal(initial.total_calls,1504);assert.equal(initial.base_calls,752);assert.equal(initial.consumer_calls,752);
   await instrumentationPreflight(lateNested);
   const beganGrowth=performance.now();let current=initial;
   while(current.base_calls<32768||current.total_calls<60000){
    assert.ok(growth.cohorts<256,'native_late_growth_cohort_bound');await store.renew(run);
    const batch=await store.withInputSurvey(run,bounds,async scope=>{
     if(current.unresolved_roots>=4096)assert.equal(scope.hints.length,4096,'native_late_full_frontier_must_fit');
     const base=scope.hints.filter(hint=>hint.question_keys.join(',')===baseKeys.join(','));
     const candidates=base.length?base:scope.hints.filter(hint=>hint.question_keys.join(',')===consumerKeys.join(','));
     const batchLimit=nativeDmlLateGrowthLimitV1({remaining_base:32768-current.base_calls,has_base_hints:base.length>0});
     const remaining=execution.max_buffered_bytes-scope.retained_bytes;assert.ok(remaining>0);
     const selected:typeof candidates=[];let retained=0;
     for(const hint of candidates){if(selected.length===batchLimit)break;const bytes=Number(hint.working_bytes);
      assert.ok(Number.isSafeInteger(bytes)&&bytes>=0);if(retained+bytes>remaining)break;selected.push(hint);retained+=bytes;}
     assert.ok(selected.length>0,'native_late_growth_no_bounded_pending_group');
     const hydration=await scope.hydrate(selected.map(h=>h.root_id),{max_rows:720,max_working_bytes:remaining});
     assert.equal(hydration.kind,'ready');if(hydration.kind!=='ready')throw Error('native_late_growth_stale');
     assert.equal(hydration.inputs.length,selected.length);assert.ok(hydration.retained_bytes+scope.retained_bytes<=execution.max_buffered_bytes);
     return hydration.inputs;
    });
    assert.ok(batch.length>0&&batch.length<=720);const proposals=state.proposals(batch);
    const admission=await store.admitAndMarkSelected!(run,proposals,{selectFresh:rows=>rows,
     validateBeforeCommit:(calls,rows)=>{assert.equal(calls.length,batch.length);assert.equal(rows.length,batch.length);}});
    let calls:ReadonlyArray<LabelingCallV1<SignalListeningInputV1>>;
    if(admission.kind==='committed'){calls=admission.calls;growth.native_calls+=calls.length;}
    else{const legacy=await store.reserve(run,proposals);assert.equal(legacy.length,batch.length);await store.markSubmitting(run,legacy);calls=legacy;growth.legacy_calls+=calls.length;}
    await state.complete(calls);growth.cohorts++;await store.renew(run);
    const next=await census();assert.equal(next.total_calls,current.total_calls+batch.length);assert.ok(next.total_calls<=64816,'native_late_keep720_pending');current=next;
   }
   growth.elapsed_ms=performance.now()-beganGrowth;
   assert.equal(current.base_calls,32768);assert.ok(current.total_calls>=60000&&current.total_calls<=64816);
   assert.ok(current.unresolved_roots>=720);lateCensus.before=current;
   const beforeResolved=await f.readResolvedRootIds();assert.equal(beforeResolved.length,current.resolved_roots);assert.equal(new Set(beforeResolved).size,beforeResolved.length);
   await store.renew(run);
   let selectedLate:SignalListeningInputV1[];
   try{
    const survey=await observeNativeLateSurveyV1({database:f.access.database,run,
     createStore:database=>createSignalListeningRuntimeStoreV1(database,{execution,storage}),consumerKeys,phase:'late-consumer',
     sourceBinding:{expected_git:expected,runtime_before:sourceLateBefore}});
    await privateLineJson(join(directory,'native-late-survey-plans.json'),survey.plans,4*1024*1024);
    await privateLineJson(join(directory,'native-late-survey.json'),survey.receipt,1024*1024);
    selectedLate=survey.inputs;surveyClosed=true;
   }catch(error){
    if(error instanceof NativeLateSurveyObservationErrorV1){
     await privateLineJson(join(directory,'native-late-survey.json'),error.receipt,1024*1024);
     try{await privateLineJson(join(directory,'native-late-survey-plans.json'),error.plans,4*1024*1024);}
     catch(writeError){throw new AggregateError([error,writeError],'native_late_survey_partial_write_failed',{cause:error});}
    }
    throw error;
   }
   assert.equal(selectedLate.length,720);assert.equal(new Set(selectedLate.map(i=>i.root_id)).size,720);
   assert.ok(selectedLate.every(i=>i.question_keys.join(',')===consumerKeys.join(',')));
   const profile=state.profiles.get('consumer');assert.ok(profile);assert.equal(profile.sample_count,32);assert.equal(profile.source_run_id,run.id);
   assert.ok(selectedLate.every(input=>{const bytes=Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(input,workload.configuration)));
    return bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes;}),'native_late_profile_real_extremes_required');
   Object.assign(lateCohort,{phase:'late-consumer',calls:720,answers:1440,question_keys:consumerKeys,profile,
    root_ids_sha256:nativeDmlPlanShaV1(JSON.stringify(selectedLate.map(i=>i.root_id).sort()))});
   await withR16ListeningRuntimeWitnessV1(f.access.database,async witness=>{
    runtimeWitnessLate=witness;lateAnswerTriggers.before=await assertAnswerTriggers(f.access.database);
    await store.renew(run);lateMode=true;lateObserver.arm('late-consumer',consumerKeys);
    const admission=await store.admitAndMarkSelected!(run,state.proposals(selectedLate),{
     selectFresh:rows=>rows,validateBeforeCommit:(calls,rows)=>{assert.equal(calls.length,720);assert.equal(rows.length,720);assert.ok(calls.every(c=>c.status==='submitting'));}});
    assert.equal(admission.kind,'committed');if(admission.kind!=='committed')throw Error('native_late_profile_uncovered');
    const ids=admission.calls.map(call=>call.id);assert.equal(ids.length,720);lateObserver.bindApplyRoster(ids);
    lateCohort.native_call_ids_sha256=nativeDmlPlanShaV1(JSON.stringify([...ids].sort()));
    await state.complete(admission.calls);lateObserver.finishPhase();lateMode=false;
    lateCensus.after=await census();assert.equal(lateCensus.after.total_calls,current.total_calls+720);
    assert.equal(lateCensus.after.base_calls,32768);assert.equal(lateCensus.after.consumer_calls,current.consumer_calls+720);
    const afterResolved=await f.readResolvedRootIds();assert.equal(afterResolved.length,lateCensus.after.resolved_roots);assert.equal(new Set(afterResolved).size,afterResolved.length);
    lateAnswerTriggers.after=await assertAnswerTriggers(f.access.database);assert.deepEqual(lateAnswerTriggers.after,lateAnswerTriggers.before);
    await store.renew(run);assert.deepEqual(lateObserver.observations.map(row=>row.phase+':'+row.operation),['late-consumer:insert','late-consumer:mark','late-consumer:apply']);
   });
  });fixtureReturned=true;
 }catch(error){failed=true;primary=error;}
 finally{
  try{if(http){await http.close();storageClosed=true;}if(rawDirectory){await rm(rawDirectory,{recursive:true});storageRemoved=true;}}
  catch(error){if(!failed){failed=true;primary=error;}}
 }
 const sourceAfter=await captureR16SourceProvenanceV1(repo);let sourceClean=false;
 try{assert.deepEqual(sourceAfter,expected);sourceClean=true;}catch(error){if(!failed){failed=true;primary=error;}}
 const plans=[];
 for(const row of observer.observations){
  const{plan,...metadata}=row;
  if(plan!==null){const stored=await privateJson(join(directory,row.file),plan,4*1024*1024);
   assert.equal(stored.bytes,row.plan_bytes);assert.equal(stored.sha256,row.plan_sha256);}
  plans.push(metadata);
 }
 for(const probe of nested.probes){const row=observer.observations.find(row=>row.phase===probe.phase&&row.operation===probe.operation);
  if(row)probe.outer={calls:row.calls,answers:row.answers,query_raw_sha256:row.query_raw_sha256,query_normalized_sha256:row.query_normalized_sha256,
   plan_sha256:row.plan_sha256,apply_roster_sha256:row.apply_roster_sha256};}
 const nestedReceipt={contract:'r16-native-dml-nested-plans-v2',status:failed?'failed':'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  baseline_head:'b34a7e24073bf1f32420a9c97736700fd74b7c71',source_binding_digest:expected.source_tree_sha256,
  limits:NATIVE_DML_NESTED_LIMITS_V1,preflight_receipt:nested.preflight,probes:nested.probes,
  failure:failed?{kind:primary instanceof Error?primary.name:typeof primary,code:primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:null}:null,
  limitations:['Diagnostic instrumentation overhead; inclusive durations are not CPU and nested levels must not be summed.',
   'One raw sample per exact SQL and phase/operation does not measure every physical plan variant.',
   'Optional contexts over8KiB are omitted explicitly with full bytes/SHA and observed attribution evidence; omitted context cannot be reconstructed from SHA.',
   'Early752 roots/1504 calls; not late65536 ledger, deferred COMMIT fences or H1 capacity.',
   'Counters cover notices actually delivered; no proof of every possible server message. LOAD remains session-local until connection closes.']};
 const nestedFile=await privateJson(join(directory,NATIVE_DML_NESTED_FILE_V1),nestedReceipt,NATIVE_DML_NESTED_LIMITS_V1.file_bytes);
 const latePlans=[];
 for(const row of lateObserver.observations){const{plan,...metadata}=row;
  if(plan!==null){const stored=await privateJson(join(directory,row.file),plan,4*1024*1024);assert.equal(stored.bytes,row.plan_bytes);assert.equal(stored.sha256,row.plan_sha256);}latePlans.push(metadata);}
 for(const probe of lateNested.probes){const row=lateObserver.observations.find(row=>row.phase===probe.phase&&row.operation===probe.operation);
  if(row)probe.outer={calls:row.calls,answers:row.answers,query_raw_sha256:row.query_raw_sha256,query_normalized_sha256:row.query_normalized_sha256,plan_sha256:row.plan_sha256,apply_roster_sha256:row.apply_roster_sha256};}
 const lateNestedReceipt={contract:'r16-native-dml-late-nested-plans-v1',status:failed?'failed':'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  baseline_head:expected.head_sha,source_binding_digest:expected.source_tree_sha256,limits:NATIVE_DML_NESTED_LIMITS_V1,
  preflight_receipt:lateNested.preflight,probes:lateNested.probes,
  failure:failed?{kind:primary instanceof Error?primary.name:typeof primary,code:primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:null}:null,
  limitations:['Late diagnostic inclusive wall observations, not CPU or H1.','Independent late retained3MiB budget; early3MiB plus late3MiB aggregate<=6MiB; archive32MiB expanded/16MiB conservative ZIP unchanged.']};
 const lateNestedFile=await privateJson(join(directory,'native-dml-late-nested-plans.json'),lateNestedReceipt,NATIVE_DML_NESTED_LIMITS_V1.file_bytes);
 const lateReceipt={contract:'r16-listening-native-dml-late-plan-v1',status:failed?'failed':'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  external_provider_requests:0,external_provider_spend_micro_usd:0,scope:'late_consumer_720_after_native_60000_plus_ledger',
  source:{expected_git:expected,before:sourceLateBefore??null,after:sourceAfter,workflow:{path:workflowPath,sha256:nativeDmlPlanShaV1(workflow)}},
  runtime_witness:runtimeWitnessLate??null,answer_triggers:lateAnswerTriggers,
  fixture:lateCensus.before?{population:32768,before:lateCensus.before,after:lateCensus.after??null,cohort:lateCohort,growth}:null,
  snapshot_contract:NATIVE_LATE_SNAPSHOT_CONTRACT_V1,plans:latePlans,nested:lateNestedFile,
  connection_uncertainty:clientStates.filter(state=>state.unknown_ack).map(state=>({...state})),
  closure:{fixture_returned:fixtureReturned,storage_closed:storageClosed,storage_removed:storageRemoved,source_clean:sourceClean,early_scope_closed:earlyScopeClosed,survey_closed:surveyClosed},
  failure:failed?{kind:primary instanceof Error?primary.name:typeof primary,
   code:primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:null,
   owner_outcome:nativeDmlPlanOwnerOutcomeV1(primary),unknown_ack:lateObserver.observations.some(row=>row.unknown_ack)||clientStates.some(state=>state.unknown_ack)||nativeDmlPlanOwnerOutcomeV1(primary)==='unknown',late_attempted:lateAttempted}:null};
 await privateJson(join(directory,'native-dml-late-plans.json'),lateReceipt,1024*1024);
 const receipt={contract:'r16-listening-native-dml-plan-v1',status:failed?'failed':'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  external_provider_requests:0,external_provider_spend_micro_usd:0,
  scope:'early_752_roots_on_32768_corpus_not_late_ledger_or_capacity',
  source:{expected_git:expected,before:sourceBefore,after:sourceAfter,workflow:{path:workflowPath,sha256:nativeDmlPlanShaV1(workflow)}},
  runtime_witness:runtimeWitness??null,answer_triggers:answerTriggers,
  connection_uncertainty:clientStates.filter(state=>state.unknown_ack).map(state=>({...state})),
  fixture:finalCensus?{...finalCensus,phases:phaseReceipts}:null,plans,nested:nestedFile,
  closure:{fixture_returned:fixtureReturned,storage_closed:storageClosed,storage_removed:storageRemoved,source_clean:sourceClean},
  failure:failed?{kind:primary instanceof Error?primary.name:typeof primary,
   code:primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:null,
   owner_outcome:nativeDmlPlanOwnerOutcomeV1(primary),
   unknown_ack:observer.observations.some(row=>row.unknown_ack)||clientStates.some(state=>state.unknown_ack)||nativeDmlPlanOwnerOutcomeV1(primary)==='unknown'}:null};
 await privateJson(join(directory,'native-dml-plans.json'),receipt,1024*1024);
 if(failed)throw primary;
 assert.ok(plans.every(p=>p.savepoint_ack&&p.rollback_ack&&p.release_ack&&p.snapshot_equal&&p.normal_original_succeeded&&!p.unknown_ack));
 assert.equal(latePlans.length,3);assert.ok(latePlans.every(p=>p.savepoint_ack&&p.rollback_ack&&p.release_ack&&p.snapshot_equal&&p.normal_original_succeeded&&!p.unknown_ack));
});
