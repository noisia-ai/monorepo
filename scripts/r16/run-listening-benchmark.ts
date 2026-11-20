import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertR16ListeningSyntheticPreflightV1} from './listening-preflight';
import {createR16BootstrapObservationRecorderV1,type R16CalibrationObservationInputV1} from './bootstrap-observation-spans';
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
import {assertSharedWireDefaultRuntimeV1,sharedWireDefaultContractV1,withSharedWireDefaultPostcheckV1} from '../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle';
import {wirePopulationMigrationV1,wirePopulationMoneyProsrcShaV1,wirePopulationPartsV1,wirePopulationShaV1,wirePopulationSourceShaV1} from '../../infrastructure/db/migrations/signal-listening-wire-population.oracle';
import {assertCompactCatalogV1,compactFullStreamMigrationV1,compactFullStreamProsrcShaV1,compactFullStreamSourceShaV1,compactRawNameV1,compactShaV1} from '../../infrastructure/db/migrations/signal-listening-compact-population.oracle';
export const answerGuardMigrationV1='0339_signal_listening_answer_guard_narrow.sql';
export const answerGuardNameV1='signal_listening_answer_guard_v1';
export const answerGuardSourceShaV1='903e7cc04436235751cd19e047122560c0df3e397da6b70134c86cb01358c9f0';
export const answerGuardProsrcShaV1='83a1d0366bee6339fb010140084bc42dfcabe7b63bb07dc8566272eb7659357f';
const answerGuardShaV1=(value:string)=>createHash('sha256').update(value).digest('hex');
export type R16ListeningAnswerGuardRuntimeReceiptV1={
 contract:'r16-listening-answer-guard-runtime-witness-v1';migration:string;source_sha256:string;prosrc_sha256:string;
 function:Record<string,unknown>;acl:Array<Record<string,unknown>>;
};
export const mainMoneyNameV1='signal_listening_statement_money_v1';
export const mainMoneyCatalogSqlV1=`/* r16_main_money_catalog */ SELECT p.oid::text,p.pronamespace::text,p.prolang::text,p.proname,p.proowner::text,p.proacl::text,p.provolatile,p.prosecdef,p.proconfig,
 p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.pronargs,p.proargtypes::text,p.pronargdefaults,p.proargdefaults::text,
 pg_catalog.pg_get_expr(p.proargdefaults,0) default_arguments,p.prorettype::text,pg_catalog.format_type(p.prorettype,NULL) return_type,
 p.proallargtypes::text,p.proargmodes::text,p.proargnames::text,p.provariadic::text,p.protrftypes::text,p.proretset,p.procost,p.prorows,
 p.prosupport::text,p.probin,p.prosqlbody::text,l.lanname,p.prosrc,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor::text,'grantee',a.grantee::text,'privilege_type',a.privilege_type,
  'is_grantable',a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable)
  FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb) effective_acl
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid='public.signal_listening_statement_money_v1()'::pg_catalog.regprocedure`;
export type R16MainMoneyRuntimeReceiptV1={
 contract:'r16-main-money-E-runtime-catalog-witness-v1';migration:string;source_sha256:string;prosrc_sha256:string;
 function:Record<string,unknown>;acl:Array<Record<string,unknown>>;
};
const answerGuardCatalogSqlV1=`/* r16_answer_guard_catalog */ SELECT p.oid::text,p.proname,p.proowner::text,p.proacl::text,p.provolatile,p.prosecdef,p.proconfig,
 p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.pronargs,p.proargtypes::text,p.pronargdefaults,p.proargdefaults::text,pg_catalog.pg_get_expr(p.proargdefaults,0) default_arguments,
 p.prorettype::text,p.proallargtypes::text,p.proargmodes::text,p.proargnames::text,p.proretset,p.procost,p.prorows,p.prosupport::text,l.lanname,p.prosrc
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname='signal_listening_answer_guard_v1'`;
const answerGuardAclSqlV1=`/* r16_answer_guard_acl */ SELECT a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE n.nspname='public' AND p.proname='signal_listening_answer_guard_v1' ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable`;

export type R16ListeningRuntimeReceiptV1=Awaited<ReturnType<typeof assertSharedWireDefaultRuntimeV1>>;
export type R16ListeningRuntimeDatabaseV1=Parameters<typeof assertSharedWireDefaultRuntimeV1>[0];
export type R16ListeningCompactRuntimeReceiptV1={
 contract:'r16-compact-population-runtime-witness-v1';
 migration:string;source_sha256:string;prosrc_sha256:string;
 function:Record<string,unknown>;acl:Array<Record<string,unknown>>;
};
export type R16ListeningRuntimeWitnessV1={
 contract:'r16-listening-runtime-witness-v1';
 before:R16ListeningRuntimeReceiptV1|null;
 after:R16ListeningRuntimeReceiptV1|null;
 main_money:{before:R16MainMoneyRuntimeReceiptV1|null;after:R16MainMoneyRuntimeReceiptV1|null};
 compact:{before:R16ListeningCompactRuntimeReceiptV1|null;after:R16ListeningCompactRuntimeReceiptV1|null};
 answer_guard:{before:R16ListeningAnswerGuardRuntimeReceiptV1|null;after:R16ListeningAnswerGuardRuntimeReceiptV1|null};
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
 const witness:R16ListeningRuntimeWitnessV1={contract:'r16-listening-runtime-witness-v1',before:null,after:null,main_money:{before:null,after:null},compact:{before:null,after:null},answer_guard:{before:null,after:null}};
 let captureAfterFailed=false,captureAfterFailure:unknown;
 const captureMainMoney=async():Promise<R16MainMoneyRuntimeReceiptV1>=>{
  const source=await readFile(new URL('../../infrastructure/db/migrations/'+wirePopulationMigrationV1,import.meta.url),'utf8');
  assert.equal(wirePopulationShaV1(source),wirePopulationSourceShaV1,'0337 MAIN Money E source must match the reviewed full migration');
  const parts=wirePopulationPartsV1(source),match=/CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS \$\$([\s\S]*?)\$\$;\n/u.exec(parts.money);
  assert.ok(match,'0337 must contain the exact zero-argument MAIN Money trigger body');
  const prosrc=match[1]!,expected=await sharedWireDefaultContractV1();
  assert.equal(expected.default_arm,'E','MAIN Money runtime must remain strict E');
  assert.equal(expected.migration,wirePopulationMigrationV1,'MAIN Money must come from native wire population 0337');
  assert.equal(wirePopulationShaV1(prosrc),wirePopulationMoneyProsrcShaV1,'0337 MAIN Money E prosrc SHA is fixed');
  assert.equal(prosrc,expected.prosrc,'0337 MAIN Money E body must match the strict source-aware oracle');
  const rows=(await database.query(mainMoneyCatalogSqlV1)).rows;
  assert.equal(rows.length,1,'actual public MAIN Money E function must exist exactly once');
  const row=rows[0]!;assert.equal(row.prosrc,prosrc,'actual pg_proc.prosrc must match the independently parsed 0337 MAIN Money E body');
  const expectedMetadata={proname:mainMoneyNameV1,provolatile:'v',prosecdef:false,proconfig:['search_path=public, extensions, pg_temp'],proisstrict:false,
   proparallel:'u',proleakproof:false,prokind:'f',pronargs:0,proargtypes:'',pronargdefaults:0,proargdefaults:null,default_arguments:null,
   prorettype:'2279',return_type:'trigger',proallargtypes:null,proargmodes:null,proargnames:null,provariadic:'0',protrftypes:null,proretset:false,
   procost:100,prorows:0,prosupport:'-',probin:null,prosqlbody:null,lanname:'plpgsql'};
  const{prosrc:observedProsrc,oid,pronamespace,prolang,proowner,proacl,effective_acl,...metadata}=row;
  assert.equal(observedProsrc,prosrc,'actual MAIN Money pg_proc body must match exact source E');
  assert.ok(typeof oid==='string'&&/^\d+$/u.test(oid),'MAIN Money function OID must be captured from pg_proc');
  assert.ok(typeof pronamespace==='string'&&/^\d+$/u.test(pronamespace),'MAIN Money namespace OID must be captured from pg_proc');
  assert.ok(typeof prolang==='string'&&/^\d+$/u.test(prolang),'MAIN Money language OID must be captured from pg_proc');
  assert.ok(typeof proowner==='string'&&/^\d+$/u.test(proowner),'MAIN Money function owner OID must be captured from pg_proc');
  assert.ok(proacl===null||typeof proacl==='string','MAIN Money raw ACL must preserve nullable pg_proc.proacl');
  assert.deepEqual(metadata,expectedMetadata,'actual MAIN Money pg_proc signature, defaults and complete function attributes must match the PG17 trigger contract');
  assert.ok(Array.isArray(effective_acl),'MAIN Money effective ACL must be captured from the same pg_proc catalog row');
  const acl=(effective_acl as Array<Record<string,unknown>>).map(grant=>({...grant}));
  assert.ok(acl.every(grant=>typeof grant.grantor==='string'&&/^\d+$/u.test(grant.grantor)&&typeof grant.grantee==='string'&&/^\d+$/u.test(grant.grantee)
   &&grant.privilege_type==='EXECUTE'&&typeof grant.is_grantable==='boolean'),'MAIN Money effective ACL entries must retain complete numeric grant identities');
  return{contract:'r16-main-money-E-runtime-catalog-witness-v1',migration:wirePopulationMigrationV1,source_sha256:wirePopulationShaV1(source),
   prosrc_sha256:wirePopulationShaV1(prosrc),function:{oid,pronamespace,prolang,proowner,proacl,...metadata},acl};
 };
 const captureCompact=async():Promise<R16ListeningCompactRuntimeReceiptV1>=>{
  const catalog=await assertCompactCatalogV1(database as Parameters<typeof assertCompactCatalogV1>[0]);
  const row=catalog.functions.find(candidate=>candidate.proname===compactRawNameV1);assert.ok(row,'current compact raw function must exist');
  assert.equal(compactShaV1(String(row.prosrc)),compactFullStreamProsrcShaV1,'actual compact pg_proc.prosrc SHA must match strict0338 source');
  assert.equal(row.pronargs,6,'compact raw identity signature must retain six input arguments');
  assert.equal(row.proargtypes,'2950 2950 2950 25 2951 25','compact raw input argument types must match the registered uuid/uuid/uuid/text/uuid[]/text signature');
  assert.equal(row.prorettype,'2249','compact raw function must return the registered TABLE record type');
  assert.equal(row.proretset,true,'compact raw function must remain set-returning');
  assert.equal(row.proallargtypes,'{2950,2950,2950,25,2951,25,2950,25,1184,25,25,23,23,16,25,16,25,3802}',
   'compact raw TABLE must retain all six input and twelve output argument types');
  assert.equal(row.proargmodes,'{i,i,i,i,i,i,t,t,t,t,t,t,t,t,t,t,t,t}',
   'compact raw signature must keep six inputs followed by twelve TABLE outputs');
  assert.deepEqual(row.proargnames,['w','cid','mid','ctx','roots','purpose','root_id','input_digest','published_at','question_key','question_digest','body_chars','wire_chars','has_topic_source','domain','candidate','scope_state','answer'],
   'compact raw input and TABLE output names/order are fixed');
  assert.equal(row.provolatile,'s');assert.equal(row.prosecdef,false);
  assert.deepEqual(row.proconfig,['search_path=public, extensions, pg_temp']);
  const{prosrc,...metadata}=row;
  return{contract:'r16-compact-population-runtime-witness-v1',migration:compactFullStreamMigrationV1,source_sha256:compactFullStreamSourceShaV1,
   prosrc_sha256:compactShaV1(String(prosrc)),function:metadata,
   acl:catalog.acl.filter(grant=>grant.proname===compactRawNameV1).map(({proname,...grant})=>grant)};
 };
 const captureAnswerGuard=async():Promise<R16ListeningAnswerGuardRuntimeReceiptV1>=>{
  const source=await readFile(new URL('../../infrastructure/db/migrations/'+answerGuardMigrationV1,import.meta.url),'utf8');
  assert.equal(answerGuardShaV1(source),answerGuardSourceShaV1,'0339 answer-guard source must match the reviewed migration');
  const match=/CREATE OR REPLACE FUNCTION signal_listening_answer_guard_v1\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS \$\$([\s\S]*?)\$\$;\n/u.exec(source);
  assert.ok(match,'0339 must contain the exact zero-argument BEFORE trigger function source');
  const prosrc=match[1]!;assert.equal(answerGuardShaV1(prosrc),answerGuardProsrcShaV1,'0339 answer-guard prosrc source digest is fixed');
  const rows=(await database.query(answerGuardCatalogSqlV1)).rows;assert.equal(rows.length,1,'actual public answer guard must exist exactly once');
  const row=rows[0]!;assert.equal(row.prosrc,prosrc,'actual pg_proc.prosrc must match the independently parsed 0339 source');
  const expected={proname:answerGuardNameV1,provolatile:'v',prosecdef:false,proconfig:['search_path=public, extensions, pg_temp'],proisstrict:false,
   proparallel:'u',proleakproof:false,prokind:'f',pronargs:0,proargtypes:'',pronargdefaults:0,proargdefaults:null,default_arguments:null,prorettype:'2279',
   proallargtypes:null,proargmodes:null,proargnames:null,proretset:false,procost:100,prorows:0,prosupport:'-',lanname:'plpgsql'};
  const {prosrc:observedProsrc,oid,proowner,proacl,...metadata}=row;
  assert.equal(observedProsrc,prosrc,'actual pg_proc source must match the separately pinned fixture body');
  assert.ok(typeof oid==='string'&&/^\d+$/u.test(oid),'answer guard OID must be captured from pg_proc');
  assert.ok(typeof proowner==='string'&&/^\d+$/u.test(proowner),'answer guard owner must be captured from pg_proc');
  assert.deepEqual(metadata,expected,'actual pg_proc signature and complete function attributes must match trigger contract');
  const acl=(await database.query(answerGuardAclSqlV1)).rows.map(grant=>({...grant}));
  assert.ok(acl.length>0,'effective answer-guard ACL must be present');
  return{contract:'r16-listening-answer-guard-runtime-witness-v1',migration:answerGuardMigrationV1,source_sha256:answerGuardShaV1(source),
   prosrc_sha256:answerGuardShaV1(prosrc),function:{oid,proowner,proacl,...metadata},acl};
 };
 const capture=async(phase:'before'|'after')=>{
  const money=await assertSharedWireDefaultRuntimeV1(database),mainMoney=await captureMainMoney(),compact=await captureCompact(),answerGuard=await captureAnswerGuard();
  if(phase==='after'){
   assert.deepEqual(money,witness.before,'Money E catalog/source must remain exact across the measured run');
   assert.deepEqual(mainMoney,witness.main_money.before,'MAIN Money E actual catalog/source/owner/raw and effective ACL must remain exact across the measured run');
   assert.deepEqual(compact,witness.compact.before,'compact0338 catalog/source/owner/ACL must remain exact across the measured run');
   assert.deepEqual(answerGuard,witness.answer_guard.before,'answer guard 0339 catalog/source/owner/ACL must remain exact across the measured run');
  }
  // Publish all four witnesses only after every source and catalog capture validates.
  witness[phase]=money;witness.main_money[phase]=mainMoney;witness.compact[phase]=compact;witness.answer_guard[phase]=answerGuard;return money;
 };
 const captureAfter=async()=>{try{
  const receipt=await capture('after');
  if(captureAfterFailed){witness.after=null;witness.main_money.after=null;witness.compact.after=null;witness.answer_guard.after=null;throw captureAfterFailure;}
  return receipt;
 }catch(error){if(!captureAfterFailed)captureAfterFailure=error;captureAfterFailed=true;witness.after=null;witness.main_money.after=null;witness.compact.after=null;witness.answer_guard.after=null;throw captureAfterFailure;}};
 const value=await withSharedWireDefaultPostcheckV1(async()=>{
  await capture('before');
  const result=await body(witness,captureAfter);
  if(captureAfterFailed)throw captureAfterFailure;
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
  const latency_ms:number[]=[];
  const calibrationRecorder=createR16BootstrapObservationRecorderV1({start_time_ms:start,now:()=>performance.now()});
  const providerFetch=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});
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
  const nativeStore=args.query_profiler?.wrapStore(unobservedStore,undefined,()=>performance.now()-start)??unobservedStore;
  const store={...nativeStore,async apply(...params:Parameters<typeof nativeStore.apply>){
   await nativeStore.apply(...params);
   const roots=[...new Set(params[1].flatMap(row=>row.results.map(result=>result.root_id)))];
   for(let offset=0;offset<roots.length;offset+=1024)await sample(roots.slice(offset,offset+1024));
  }};
  let jobs=0;
  for(;jobs<(args.max_jobs??10000)&&resolved.size<expected.size;jobs++){
    const jobOrdinal=jobs+1,jobStart=calibrationRecorder.elapsed();let jobWarmup=false;
    let outcome:Awaited<ReturnType<typeof signalListeningJevJobV1>>;
    try{
     outcome=await signalListeningJevJobV1(f.run_id,{database:f.access.database,store,execution,preflight:()=>assertR16ListeningSyntheticPreflightV1({storage,storage_url:storageServer.base_url,configuration:workload.configuration,configuration_digest:workload.configuration_digest,env:process.env}),calibrated_provider_factory,
      observe_stream:metrics=>resources.observeStream(metrics),
      observe_calibration:event=>{
       if(event.warmup)jobWarmup=true;
       // Preserve compatibility with the current worker callback while also
       // observing optional lifecycle fields from a source-compatible worker.
       calibrationRecorder.observe(jobOrdinal,event as R16CalibrationObservationInputV1);
      }});
    }finally{calibrationRecorder.finishJob(jobOrdinal,jobStart,jobWarmup);}
    sampleResources();
    if(['failed','outcome_unknown','lease_lost'].includes(outcome.status))break;
   }
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
  sampleResources();
  const wall_elapsed_ms=performance.now()-start;
  const capacity=summarizeR16ListeningCapacityV2({wall_elapsed_ms,processing_elapsed_ms:classification_wall_elapsed_ms,
   native_processing_complete,resolved_roots:resolved.size,commits,latency_ms});
  const capacity_gates={...capacity.gates,
   expected_primary_request_count:args.arm!=='defined_consumer_second_pass'||requests===expected.size*registration.expected_primary_http_calls_per_resolved_root,
   serving:metrics.length===workload.question_keys.length&&metrics.every((m,i)=>m.question_key===workload.question_keys[i]
    &&m.configuration_id===f.access.configuration_id&&m.counts.pending===0&&m.counts.awaiting_base===0&&m.distribution.length>0&&m.trend.length>0
    &&m.topic_cross.length>0)};
  const calibrationObservation=calibrationRecorder.snapshot();
  assert.equal((await captureR16SourceProvenanceV1(repo)).source_tree_sha256,source_provenance.source_tree_sha256,'source changed during measurement');
  return{contract_version:'r16-listening-capacity-measurement-v2',acceptance:'pending_native_fault_and_census_validation',
   capacity_gates,capacity,source_provenance,job_spans:calibrationObservation.job_spans,
   warmup_wall_ms:calibrationObservation.warmup_wall_ms,warmup_wall_ms_known_completed:calibrationObservation.warmup_wall_ms_known_completed,
   warmup_wall_ms_basis:calibrationObservation.warmup_wall_ms_basis,warmup_intervals_may_overlap_processing:calibrationObservation.warmup_intervals_may_overlap_processing,
   bootstrap_observation_status:calibrationObservation.bootstrap_observation_status,
   bootstrap_observation_issues:calibrationObservation.bootstrap_observation_issues,bootstrap_spans:calibrationObservation.bootstrap_spans,
   workload,root_census_digest:digest([...expected].sort()),cold_elapsed_ms:performance.now()-coldStart,wall_elapsed_ms,classification_wall_elapsed_ms,
   fully_resolved_distinct_roots:resolved.size,requests,requests_per_resolved_root:resolved.size?requests/resolved.size:null,latency_ms,calibration:calibrationObservation.calibration,commits,jobs,metrics,storage:storageServer.metrics(),
   unresolved_roots:expected.size-resolved.size,storage_spans,sql_profile:args.query_profiler?.snapshot()??null,
   resource_observation:resources.snapshot({max_in_flight:execution.max_in_flight,window_size:execution.window_size,
    max_buffered_bytes:execution.max_buffered_bytes,flush_size:execution.flush_size,max_flushes:execution.max_flushes,
    flush_interval_ms:execution.flush_interval_ms})};
  });
  return{...observed.value,runtime_witness:observed.runtime_witness};
  });
 }finally{await storageServer.close();}
}
