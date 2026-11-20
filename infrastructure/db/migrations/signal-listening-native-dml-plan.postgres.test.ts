import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import type {PoolClient} from 'pg';
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
 createNativeDmlPlanClientGuardV1,nativeDmlPlanOwnerOutcomeV1,
 type NativeDmlPlanSnapshotV1,type NativeDmlPlanClientStateV1} from './signal-listening-native-dml-plan.test-support';

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
 const clientStates:NativeDmlPlanClientStateV1[]=[];
 const phaseReceipts:Array<Record<string,unknown>>=[];let runForSnapshot:LabelingRunV1|undefined;
 let runtimeWitness:R16ListeningRuntimeWitnessV1|undefined,finalCensus:Record<string,number>|undefined;
 const answerTriggers:{before:unknown;after:unknown}={before:null,after:null};
 let fixtureReturned=false,storageClosed=false,storageRemoved=false,failed=false,primary:unknown;
 const rawDirectory=await mkdtemp(join(tmpdir(),'r16-native-dml-plan-'));
 const http=await startR16HttpFilesystemStorageV1(rawDirectory);
 const storage=createWorkspaceEngineStorageV1({url:http.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
 const withFixture=createR16ListeningNativeFixtureV1({loadNativeCensus:args=>loadR16ListeningNativeCensusV1(args),
  decorateDatabase(database){
   return{query:database.query.bind(database),connect:async()=>{
    const c=await database.connect();
    const guard=createNativeDmlPlanClientGuardV1(c,async({sql,values,normal,markUnknown})=>{
     if(sql==='BEGIN'){const result=await normal();await c.query("SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='1s'");return result;}
     if(!runForSnapshot)return normal();
     return observer.query({client:c,sql,values,snapshot:()=>snapshot(c,runForSnapshot!),onUnknown:markUnknown,
      beforeProbe:async operation=>{if(operation==='apply')await assertAnswerTriggers(c);},normal});
    });clientStates.push(guard.state);return guard.client;
   }};
  }});
 const workload=r16ListeningWorkloadV2('defined_consumer_second_pass');
 try{
  await withFixture({workload,storage},async f=>{
   assert.equal(f.root_ids.length,32768);assert.equal(new Set(f.root_ids).size,32768);
   await withR16ListeningRuntimeWitnessV1(f.access.database,async witness=>{
    runtimeWitness=witness;answerTriggers.before=await assertAnswerTriggers(f.access.database);
    const store=createSignalListeningRuntimeStoreV1(f.access.database,{execution,storage});
    const run=await store.claim(f.run_id);assert.ok(run);runForSnapshot=run;
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
     const pending=phase==='base'?chosen:await store.inputs(run,bounds);
     const selected=pending.filter(i=>anchorIds.has(i.root_id)||nativeIds.has(i.root_id));assert.equal(selected.length,752);
     const keys=phase==='base'?['promotion','voice']:workload.question_keys.filter(key=>!['promotion','voice'].includes(key));
     assert.ok(selected.every(input=>JSON.stringify([...input.question_keys].sort())===JSON.stringify([...keys].sort())));
     const anchors=selected.filter(i=>anchorIds.has(i.root_id)),batch=selected.filter(i=>nativeIds.has(i.root_id));
     const warm=await store.reserve(run,proposals(anchors));assert.equal(warm.length,32);await store.markSubmitting(run,warm);await complete(warm);
     const shape=signalListeningCalibrationShapeV1(workload.configuration,anchors[0]!);
     const profile=await deriveSignalListeningCalibrationV1({...f.access,run_id:run.id,shape_digest:shape.shape_digest});
     assert.ok(profile);assert.equal(profile.sample_count,32);assert.equal(profile.source_run_id,run.id);
     assert.equal(new Set(profile.source_call_ids).size,32);assert.equal(profile.scope.phase,phase==='base'?'base':'consumer_category');
     assert.ok(batch.every(input=>size(input)>=profile.request_min_bytes&&size(input)<=profile.request_max_bytes));
     const paid=(await f.access.database.query(`SELECT count(*)::int n FROM signal_labeling_calls c
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
   });
  });fixtureReturned=true;
 }catch(error){failed=true;primary=error;}
 finally{
  try{await http.close();storageClosed=true;await rm(rawDirectory,{recursive:true});storageRemoved=true;}
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
 const receipt={contract:'r16-listening-native-dml-plan-v1',status:failed?'failed':'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  external_provider_requests:0,external_provider_spend_micro_usd:0,
  scope:'early_752_roots_on_32768_corpus_not_late_ledger_or_capacity',
  source:{expected_git:expected,before:sourceBefore,after:sourceAfter,workflow:{path:workflowPath,sha256:nativeDmlPlanShaV1(workflow)}},
  runtime_witness:runtimeWitness??null,answer_triggers:answerTriggers,
  connection_uncertainty:clientStates.filter(state=>state.unknown_ack).map(state=>({...state})),
  fixture:finalCensus?{...finalCensus,phases:phaseReceipts}:null,plans,
  closure:{fixture_returned:fixtureReturned,storage_closed:storageClosed,storage_removed:storageRemoved,source_clean:sourceClean},
  failure:failed?{kind:primary instanceof Error?primary.name:typeof primary,
   code:primary&&typeof primary==='object'&&'code'in primary&&typeof primary.code==='string'?primary.code:null,
   owner_outcome:nativeDmlPlanOwnerOutcomeV1(primary),
   unknown_ack:observer.observations.some(row=>row.unknown_ack)||clientStates.some(state=>state.unknown_ack)||nativeDmlPlanOwnerOutcomeV1(primary)==='unknown'}:null};
 await privateJson(join(directory,'native-dml-plans.json'),receipt,1024*1024);
 if(failed)throw primary;
 assert.ok(plans.every(p=>p.savepoint_ack&&p.rollback_ack&&p.release_ack&&p.snapshot_equal&&p.normal_original_succeeded&&!p.unknown_ack));
});
