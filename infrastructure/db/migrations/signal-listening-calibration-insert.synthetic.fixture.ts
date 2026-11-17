import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,open,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {authorizeSignalListeningV1,listeningFailV1 as fail} from '../signal-listening-configuration';
import {deriveSignalListeningCalibrationV1} from '../signal-listening-calibration';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {withFlatPrefixFullFixtureV1,flatPrefixLedgerSqlV1,type FlatPrefixReadyFixtureV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {prepareSharedWireRawV1} from './signal-listening-statement-shared-wire.fixture';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from '../../../scripts/r16/synthetic-jev';
import {createCalibratedJevRuntimeProviderV2} from '../../../services/workers/src/providers/jev-streaming-runtime';
import {signalListeningJevJobV1} from '../../../services/workers/src/workers/signal-listening-jev';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const calibrationSqlHashV1=(s:string)=>'sha256:'+hash(s.replace(/\s+/gu,' ').trim());
export const OLD_CALIBRATION_INSERT=`INSERT INTO signal_listening_calibrations(workspace_id,source_run_id,scope_digest,source_digest,profile,created_by_user_id)
   SELECT $1,$2,profile->>'scope_digest',profile->>'source_digest',profile,$4 FROM
    (SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) evidence
   WHERE profile IS NOT NULL ON CONFLICT(scope_digest,source_digest) DO NOTHING`;
const OLD_HASH='sha256:41f386605d3fe11f3e064149c8c72a0ebd3b9314d24a7ebf96c4256da1ea99cb';
const CTE='WITH evidence AS MATERIALIZED(SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile)\n';
export function materializeCalibrationInsertV1(sql:string){assert.equal(sql,OLD_CALIBRATION_INSERT);return CTE+sql.replace(" FROM\n    (SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) evidence\n"," FROM evidence\n");}
export function undoCalibrationMaterializationV1(sql:string){assert.ok(sql.startsWith(CTE));return sql.slice(CTE.length).replace(' FROM evidence\n'," FROM\n    (SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) evidence\n");}
const NEW_CALIBRATION_INSERT=materializeCalibrationInsertV1(OLD_CALIBRATION_INSERT);
type Binds=readonly[string,string,string,string];
export class CalibrationProducerCaptureV1{
 private active=true;private captured:{sql:string;binds:Binds}|undefined;
 constructor(private workspace:string,private run:string,private actor:string){}
 intercept(sql:string,args:unknown[]){if(!this.active||calibrationSqlHashV1(sql)!==OLD_HASH)return undefined;
  assert.equal(sql,OLD_CALIBRATION_INSERT);assert.equal(this.captured,undefined,'only one setup INSERT may be omitted');assert.equal(args.length,4);assert.equal(args[0],this.workspace);assert.equal(args[1],this.run);assert.equal(args[3],this.actor);assert.match(String(args[2]),/^sha256:[a-f0-9]{64}$/u);
  this.captured={sql,binds:Object.freeze([...args])as unknown as Binds};return{rows:[],rowCount:0,command:'INSERT'};
 }
 disable(){assert.ok(this.active&&this.captured);this.active=false;return this.captured;}
}
type Counter={funcid:string;calls:string;total_time:number;self_time:number;[key:string]:unknown};
export function calibrationCounterDeltaV1(before:Counter[],after:Counter[],oids:{evidence:string;guard:string}){
 const b=new Map(before.map(r=>[r.funcid,r])),a=new Map(after.map(r=>[r.funcid,r]));const calls:Record<string,string>={},elapsed:Record<string,unknown>={};
 for(const[k,oid]of Object.entries(oids)){const x=b.get(oid),y=a.get(oid);if(!x||!y)return{known:false,reason:'required_baseline_or_after_absent_UNKNOWN',calls:null,elapsed:null};
  assert.match(x.calls,/^\d+$/u);assert.match(y.calls,/^\d+$/u);assert.ok(BigInt(y.calls)>=BigInt(x.calls)&&y.total_time>=x.total_time&&y.self_time>=x.self_time);calls[k]=String(BigInt(y.calls)-BigInt(x.calls));elapsed[k]={total_ms:y.total_time-x.total_time,self_ms:y.self_time-x.self_time};}
 return{known:true,reason:'observed_transaction_deltas_not_CPU',calls,elapsed};
}
type Timing={stratum:string;block:number;version:string;position:number;duration_ms:number};
export function calibrationPairedWallV1(rows:Timing[]){const strata:Record<string,unknown>={};let passed=rows.length===16;
 for(const stratum of ['fresh','conflict']){const r=rows.filter(x=>x.stratum===stratum),old=r.filter(x=>x.version==='OLD').map(x=>x.duration_ms),next=r.filter(x=>x.version==='NEW').map(x=>x.duration_ms);let pairs=true;
  if(r.length!==8||old.length!==4||next.length!==4||r.some(x=>!Number.isFinite(x.duration_ms)||x.duration_ms<=0)){passed=false;strata[stratum]={complete:false};continue;}
  const med=(x:number[])=>{const a=[...x].sort((a,b)=>a-b);return(a[1]!+a[2]!)/2;};
  for(const block of [0,1]){const group=r.filter(x=>x.block===block).sort((a,b)=>a.position-b.position);if(group.length!==4||group.map(x=>x.version).join(',')!=='OLD,NEW,NEW,OLD'||group.some((x,i)=>x.position!==i)){pairs=false;continue;}pairs&&=group[1]!.duration_ms<=1.10*group[0]!.duration_ms&&group[2]!.duration_ms<=1.10*group[3]!.duration_ms;}
  const ratio=med(next)/med(old),ok=ratio<=.90&&pairs;passed&&=ok;strata[stratum]={complete:true,old_median_ms:med(old),new_median_ms:med(next),median_ratio:ratio,all_pairs_within_1_10:pairs,passed:ok};}
 return{passed,strata};
}
export const calibrationCandidateAcceptedV1=(g:{semantics:boolean|null;native_counters:boolean|null;paired_wall:boolean|null})=>g.semantics===true&&g.native_counters===true&&g.paired_wall===true;
export async function withCalibrationTransactionV1<T>(pool:Pick<FlatPrefixReadyFixtureV1['database'],'connect'>,mode:'rollback'|'commit',fn:(c:PoolClient)=>Promise<T>):Promise<T>{
 const c=await pool.connect();let uncertain=false,failed=false,rollbackAttempted=false,primary:unknown,value:T|undefined;
 try{try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');}catch(e){uncertain=true;throw e;}value=await fn(c);if(mode==='commit'){try{await c.query('COMMIT');}catch(e){uncertain=true;throw e;}}else{try{rollbackAttempted=true;await c.query('ROLLBACK');}catch(e){uncertain=true;throw e;}}}
 catch(e){failed=true;primary=e;if(!rollbackAttempted){try{rollbackAttempted=true;await c.query('ROLLBACK');}catch(rollback){uncertain=true;primary=new AggregateError([e,rollback],'calibration body and rollback failed',{cause:e});}}}
 finally{c.release(uncertain);}
 if(failed)throw primary;return value as T;
}
const OWNER_SQL=`SELECT 1 FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id
   WHERE o.workspace_id=$1 AND o.run_id=$2 AND r.actor_user_id=$3`;
const SELECT_SQL='SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile';
const STATS_SQL='SELECT funcid::text,schemaname,funcname,calls::text,total_time,self_time FROM pg_stat_xact_user_functions ORDER BY funcid';
const EXECUTION={max_in_flight:1024,window_size:4096,flush_size:1024,max_flushes:2,max_buffered_bytes:512*1024*1024,flush_interval_ms:250};
async function sourceWitness(){const root=fileURLToPath(new URL('./',import.meta.url));const names=(await readdir(root)).filter(n=>/^\d{4}_.+\.sql$/u.test(n)&&Number(n.slice(0,4))>=295).sort();assert.equal(names.length,38);
 const rows=[];for(const name of names)rows.push({name,sha256:hash(await readFile(join(root,name)))});assert.equal(hash(JSON.stringify(rows)),'f2138f9cd3cde380e509366f5fe78634bcb06461dc91e10af19672ae66f1f65c');
 const producer=await readFile(new URL('../signal-listening-calibration.ts',import.meta.url),'utf8');assert.equal(hash(producer),'21fe69a4f8fe59a830fff0a7ceb1b9ea978302ed4d805333178964385f413991');assert.ok(producer.includes('`'+OLD_CALIBRATION_INSERT+'`'));assert.equal(undoCalibrationMaterializationV1(NEW_CALIBRATION_INSERT),OLD_CALIBRATION_INSERT);
 return{migration_count:38,migration_inventory_sha256:hash(JSON.stringify(rows)),producer_sha256:hash(producer),old_sql_sha256:calibrationSqlHashV1(OLD_CALIBRATION_INSERT),new_sql_sha256:calibrationSqlHashV1(NEW_CALIBRATION_INSERT),inverse_exact:true};
}
async function catalog(c:PoolClient){const rows=(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.proacl::text,pg_get_userbyid(p.proowner) owner,p.provolatile,p.proisstrict,p.prosecdef,p.proparallel,p.proleakproof,p.prokind,p.proretset,p.pronargs,p.proconfig,p.proargtypes::text,pg_get_function_result(p.oid) result FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY p.oid`,[['public.signal_listening_calibration_evidence_v1(uuid,uuid,text)','public.signal_listening_calibration_shape_v1(jsonb,text[])','public.signal_listening_calibration_guard_v1()','public.signal_listening_statement_money_v1()','public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)']])).rows;assert.equal(rows.length,5);
 for(const row of rows){assert.ok(row.proacl!==null&&row.owner==='postgres'&&!row.prosecdef);assert.deepEqual(row.proconfig,['search_path=public, extensions, pg_temp']);const file=row.proname==='signal_listening_statement_money_v1'?'0331_signal_listening_statement_payload.sql':row.proname==='signal_listening_population_roots_v1'?'0332_signal_listening_flat_prefix_preimages.sql':'0297_signal_listening_prototypes.sql';const s=await readFile(new URL('./'+file,import.meta.url),'utf8');const tail=s.slice(s.indexOf('FUNCTION '+row.proname+'('));assert.ok(tail.length<s.length);const tag=file.startsWith('0332')?'$function$':'$$';const body=tail.split('AS '+tag)[1]?.split(tag+';')[0];assert.equal(row.prosrc,body);}
 return rows.map(({prosrc,...r})=>({...r,prosrc_sha256:hash(prosrc)}));
}
async function preselect(c:PoolClient,binds:Binds){await authorizeSignalListeningV1(c,{workspace_id:binds[0],actor_user_id:binds[3]},'process');if(!(await c.query(OWNER_SQL,[binds[0],binds[1],binds[3]])).rows[0])fail('listening_calibration_run_forbidden',403);return(await c.query(SELECT_SQL,binds.slice(0,3))).rows[0]?.profile??null;}
async function expectedNative(c:PoolClient,binds:Binds){return(await c.query(`WITH e AS MATERIALIZED(SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) SELECT profile,encode(jsonb_send(profile),'hex') native_bytes FROM e`,binds.slice(0,3))).rows[0];}
async function profileRows(c:PoolClient,binds:Binds){return(await c.query(`SELECT id::text,created_at::text,scope_digest,source_digest,encode(jsonb_send(profile),'hex') native_bytes FROM signal_listening_calibrations WHERE workspace_id=$1 AND source_run_id=$2 ORDER BY id`,binds.slice(0,2))).rows;}
async function ledger(c:PoolClient,f:FlatPrefixReadyFixtureV1){return(await c.query(flatPrefixLedgerSqlV1,[f.run.workspace_id,f.run.id])).rows[0];}
async function insert(c:PoolClient,version:'OLD'|'NEW',binds:Binds){await c.query(version==='OLD'?OLD_CALIBRATION_INSERT:NEW_CALIBRATION_INSERT,[...binds]);}
async function insertPreservingFirst(c:PoolClient,version:'OLD'|'NEW',binds:Binds,value:any,record?:(ms:number)=>void){const start=process.hrtime.bigint();await insert(c,version,binds);record?.(Number(process.hrtime.bigint()-start)/1e6);return value;}
async function persistReceipt(receipt:Record<string,unknown>){const configured=process.env.R16_CALIBRATION_INSERT_EVIDENCE_DIR;assert.ok(configured);const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),directory=resolve(root,configured),part=relative(join(root,'.data'),directory);assert.ok(part&&!part.startsWith('..')&&!part.startsWith('/'));await mkdir(directory,{recursive:true,mode:0o700});assert.equal(await realpath(directory),directory);const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=2*1024*1024);const fd=await open(join(directory,'calibration-insert-materialization.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}}

export async function runCalibrationInsertPrototypeV1(){
 const started=process.hrtime.bigint(),elapsed=()=>Number(process.hrtime.bigint()-started)/1e6;let phase='preflight';
 const timings:Timing[]=[],warmups:Array<Record<string,unknown>>=[],counterWindows:Array<Record<string,any>>=[],commits:Array<Record<string,unknown>>=[];
 const report:Record<string,any>={contract:'r16-calibration-insert-materialization-v1',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',candidate_accepted:false,gates:{semantics:null,native_counters:null,paired_wall:null},timings,warmups,counter_windows:counterWindows,commits,unknowns:['function total/self elapsed is not CPU','absent required function baseline is UNKNOWN; no zero imputation','query-only diagnostic; no H1 or global CI acceptance']};
 const live=()=>assert.ok(elapsed()<=780000,'prototype total cap780s');let primary:unknown,hadFailure=false;
 try{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.NOISIA_R16_CALIBRATION_INSERT_PG,'true');
  report.source_sha=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8',timeout:5000}).trim();report.source=await sourceWitness();
  await withFlatPrefixFullFixtureV1({afterSetup:async f=>{
   phase='warmup_setup';f.deadline();const access={database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,configuration_id:f.configuration_id,map_id:f.map_id,run_id:f.run.id};
   const census=await loadR16ListeningNativeCensusV1(access as Parameters<typeof loadR16ListeningNativeCensusV1>[0],4096);assert.equal(census.root_ids.length,4096);
   assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_calibrations WHERE workspace_id=$1 AND source_run_id=$2',[f.run.workspace_id,f.run.id])).rows[0].n,0,'fresh fixture must have no preexisting profile');
   const capture=new CalibrationProducerCaptureV1(f.run.workspace_id,f.run.id,f.run.actor_user_id);
   const wrap=(raw:any)=>new Proxy(raw,{get:(target,key)=>{if(key==='query')return async(...args:any[])=>{const text=typeof args[0]==='string'?args[0]:args[0]?.text;if(typeof text==='string'){const omitted=capture.intercept(text,args[1]??[]);if(omitted)return omitted;}return target.query(...args);};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
   const setupDatabase=new Proxy(f.database,{get:(target,key)=>{if(key==='connect')return async()=>wrap(await target.connect());if(key==='query')return wrap(target).query;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
   const setupStore=createSignalListeningStoreV1({database:setupDatabase,page_size:4096,rawPages:f.rawPages,assertRawReady:f.assertRawReady,storeRawVerified:true,storeRaw:async()=>{throw Error('native RAW pages only');}});
   const redis=process.env.R16BENCH_REDIS_URL;assert.ok(redis);assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(redis).hostname));
   const synthetic=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});let http=0,calibration:unknown;
   const fetch:typeof globalThis.fetch=async(...args)=>{http++;assert.ok(http<=32,'only32 consumer HTTP setup requests');return synthetic(...args);};
   const outcome=await signalListeningJevJobV1(f.run.id,{database:setupDatabase,store:setupStore,execution:{...EXECUTION},preflight:f.assertRawReady,observe_calibration:event=>{assert.equal(calibration,undefined);calibration={warmup:event.warmup,selected_roots:event.selected_roots,max_in_flight:event.max_in_flight};},calibrated_provider_factory:options=>createCalibratedJevRuntimeProviderV2({...options,env:{...options.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:'r16-calibration:'+census.organization_id,NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:redis,NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},fetch})});
   assert.equal(outcome.status,'running');assert.equal(http,32);assert.deepEqual(calibration,{warmup:true,selected_roots:32,max_in_flight:32});
   const captured=capture.disable(),binds=captured.binds;assert.equal(captured.sql,OLD_CALIBRATION_INSERT);assert.ok(elapsed()<=600000,'setup cap600s');f.deadline();
   let sourceCatalog:any[],baseline:any,expectedBytes:string,firstValue:any;const checks:Array<Record<string,unknown>>=[];
   await withCalibrationTransactionV1(f.database,'rollback',async c=>{
    const id=(await c.query("SELECT current_database() database,pg_backend_pid()::int pid,current_setting('transaction_isolation') isolation")).rows[0];assert.match(id.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(id.isolation,'read committed');
    sourceCatalog=await catalog(c);baseline=await ledger(c,f);assert.equal(baseline.calls,4128);assert.equal(baseline.applied,4128);assert.equal(baseline.roots,4096);assert.equal(baseline.reserved_micro_usd,'0');assert.equal(baseline.unknown_micro_usd,'0');assert.equal((await profileRows(c,binds)).length,0);
    firstValue=await preselect(c,binds);assert.equal(firstValue.sample_count,32);assert.equal(firstValue.source_call_ids.length,32);assert.equal(new Set(firstValue.source_call_ids).size,32);assert.equal(firstValue.scope.phase,'consumer_category');assert.equal(firstValue.scope.configuration_digest,f.run.identity.params.configuration_digest);assert.equal(firstValue.scope.model,'jev-1.13.0');
    const expected=await expectedNative(c,binds);assert.deepEqual(firstValue,expected.profile);expectedBytes=expected.native_bytes;
    const rows=(await c.query(`SELECT c.id::text,c.inputs->0->>'root_id' root_id,c.status,c.results_applied FROM signal_labeling_calls c WHERE c.workspace_id=$1 AND c.run_id=$2 AND c.id=ANY($3::uuid[]) ORDER BY c.id`,[binds[0],binds[1],firstValue.source_call_ids])).rows;assert.equal(rows.length,32);assert.equal(new Set(rows.map(r=>r.root_id)).size,32);assert.ok(rows.every(r=>r.status==='settled'&&r.results_applied));
    const answerCount=(await c.query('SELECT count(*)::int n FROM signal_listening_answers WHERE workspace_id=$1 AND run_id=$2',binds.slice(0,2))).rows[0].n;assert.equal(answerCount,8256);
    const resolved=await census.readResolvedRootIds(rows.map(r=>r.root_id));assert.equal(resolved.length,32);
    report.setup={base_calls:4096,base_answers:8192,consumer_calls:32,consumer_answers:64,synthetic_http_requests:http,source_call_count:32,source_call_set_sha256:hash(JSON.stringify([...firstValue.source_call_ids].sort())),profile_native_bytes_sha256:hash(Buffer.from(expectedBytes!,'hex')),ledger:baseline,omitted_setup_producer_inserts:1,profile_rows_before_arms:0,capture_disabled_before_arms:true,execution:EXECUTION,elapsed_ms:elapsed(),ordinary_clone:true,external_spend_micro_usd:0};
   });
   const oids={evidence:sourceCatalog!.find(r=>r.proname==='signal_listening_calibration_evidence_v1').oid,guard:sourceCatalog!.find(r=>r.proname==='signal_listening_calibration_guard_v1').oid};report.catalog_before=sourceCatalog!;
   async function assertBaseline(c:PoolClient,stratum:'fresh'|'conflict'){assert.deepEqual(await ledger(c,f),baseline);const rows=await profileRows(c,binds);assert.equal(rows.length,stratum==='fresh'?0:1);if(rows.length)assert.equal(rows[0].native_bytes,expectedBytes!);return rows;}
   async function positive(c:PoolClient,stratum:'fresh'|'conflict',version:'OLD'|'NEW',record?:(ms:number)=>void){live();const before=await assertBaseline(c,stratum),value=await preselect(c,binds);assert.deepEqual(value,firstValue!);const returned=await insertPreservingFirst(c,version,binds,value,record);const rows=await profileRows(c,binds);assert.equal(rows.length,1);assert.equal(rows[0].native_bytes,expectedBytes!);if(stratum==='conflict')assert.deepEqual(rows,before);assert.deepEqual(await ledger(c,f),baseline);assert.deepEqual(returned,value);return returned;}
   for(const stratum of ['fresh','conflict']as const){phase=stratum;
    if(stratum==='conflict'){const value=await withCalibrationTransactionV1(f.database,'commit',async c=>{await c.query("SET LOCAL track_functions='none'");return positive(c,'fresh','NEW');});assert.deepEqual(value,firstValue!);commits.push({kind:'NEW_fresh_native_seed',profile_rows:1,profile_native_bytes_sha256:hash(Buffer.from(expectedBytes!,'hex'))});}
    for(const version of ['OLD','NEW']as const){await withCalibrationTransactionV1(f.database,'rollback',async c=>{
     live();await c.query("SET LOCAL track_functions='all'");await assertBaseline(c,stratum);const value=await preselect(c,binds);assert.deepEqual(value,firstValue!);
     await c.query('SAVEPOINT calibration_diagnostic_warmup');await insert(c,version,binds);assert.equal((await profileRows(c,binds)).length,1);await c.query('ROLLBACK TO SAVEPOINT calibration_diagnostic_warmup');await c.query('RELEASE SAVEPOINT calibration_diagnostic_warmup');await assertBaseline(c,stratum);
     const identity=(await c.query('SELECT pg_backend_pid()::int pid,txid_current()::text transaction_id')).rows[0],before=(await c.query(STATS_SQL)).rows as Counter[];
     await insert(c,version,binds);const after=(await c.query(STATS_SQL)).rows as Counter[];const endIdentity=(await c.query('SELECT pg_backend_pid()::int pid,txid_current()::text transaction_id')).rows[0];assert.deepEqual(endIdentity,identity);
     const delta=calibrationCounterDeltaV1(before,after,oids);counterWindows.push({stratum,version,...identity,tracking:'all',diagnostic_warmups:1,before,after,delta});const rows=await profileRows(c,binds);assert.equal(rows.length,1);assert.equal(rows[0].native_bytes,expectedBytes!);await assert.deepEqual(await ledger(c,f),baseline);
    });}
    for(const block of [0,1]){
     for(const version of ['OLD','NEW']as const){await withCalibrationTransactionV1(f.database,'rollback',async c=>{await c.query("SET LOCAL track_functions='none'");await positive(c,stratum,version);});warmups.push({stratum,block,version,tracking:'none'});}
     for(const[position,version]of(['OLD','NEW','NEW','OLD']as const).entries())await withCalibrationTransactionV1(f.database,'rollback',async c=>{await c.query("SET LOCAL track_functions='none'");await positive(c,stratum,version,duration_ms=>timings.push({stratum,block,position,version,duration_ms}));});
    }
   }
   assert.equal(timings.length,16);assert.equal(warmups.length,8);assert.equal(counterWindows.length,4);
   for(const version of ['OLD','NEW']as const){await withCalibrationTransactionV1(f.database,'commit',async c=>{await positive(c,'conflict',version);});commits.push({kind:version+'_conflict_native_commit',profile_rows:1});}
   const apiValue=await deriveSignalListeningCalibrationV1({...access,shape_digest:binds[2]});assert.deepEqual(apiValue,firstValue!);commits.push({kind:'original_functional_API_conflict_commit',profile_rows:1});
   phase='negative_oracles';
   for(const version of ['OLD','NEW']as const){
    await assert.rejects(withCalibrationTransactionV1(f.database,'rollback',c=>preselect(c,[binds[0],binds[1],binds[2],randomUUID()])),e=>e instanceof Error&&e.message==='listening_forbidden');checks.push({version,case:'actor_forbidden',passed:true});
    await assert.rejects(withCalibrationTransactionV1(f.database,'rollback',c=>preselect(c,[binds[0],randomUUID(),binds[2],binds[3]])),e=>e instanceof Error&&e.message==='listening_calibration_run_forbidden');checks.push({version,case:'owner_invalid',passed:true});
    await withCalibrationTransactionV1(f.database,'rollback',async c=>{
     const singleton=f.configuration.questions.find(q=>q.scope==='consumer_category')!.key;const shape=(await c.query("SELECT signal_listening_calibration_shape_v1(configuration,$2::text[])->>'shape_digest' digest FROM signal_listening_configurations WHERE id=$1",[f.configuration_id,[singleton]])).rows[0].digest;assert.ok(shape&&shape!==binds[2]);const empty:[string,string,string,string]=[binds[0],binds[1],shape,binds[3]];assert.equal(await preselect(c,empty),null);const before=await profileRows(c,binds);await insert(c,version,empty);assert.deepEqual(await profileRows(c,binds),before);
    });checks.push({version,case:'NULL_no_insert',passed:true});
   }
   await assert.rejects(withCalibrationTransactionV1(f.database,'rollback',async c=>{await preselect(c,binds);await c.query(`WITH e AS MATERIALIZED(SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) INSERT INTO signal_listening_calibrations(workspace_id,source_run_id,scope_digest,source_digest,profile,created_by_user_id) SELECT $1,$2,profile->>'scope_digest',profile->>'source_digest',profile||jsonb_build_object('sample_count',1),$4 FROM e ON CONFLICT(scope_digest,source_digest) DO NOTHING`,[...binds]);}),e=>e instanceof Error&&e.message==='listening_calibration_evidence_invalid');checks.push({case:'forged_profile_before_conflict',passed:true});
   phase='post_preselect_freshness';
   await withCalibrationTransactionV1(f.database,'rollback',async c=>{
    const prior=await preselect(c,binds);assert.deepEqual(prior,firstValue!);
    let extraCallId='';const held=await f.store.claim(f.run.id);assert.ok(held);await withSharedWireDefaultPostcheckV1(async()=>{
     const next=await f.store.inputs(held,{max_rows:1,max_working_bytes:512*1024*1024,on_oversize:'error'});assert.equal(next.length,1);
     const outcomes=await prepareSharedWireRawV1({database:f.database,run:held,inputs:next,configuration:f.configuration,configuration_id:f.configuration_id,map_id:f.map_id,store:f.store,rawPages:f.rawPages},500);assert.equal(outcomes.length,1);extraCallId=outcomes[0]!.call.id;await f.store.apply(held,outcomes.map(o=>({call:o.call,results:[o.result]})));
    },()=>f.store.release(held));
    const current=await expectedNative(c,binds);assert.equal(current.profile.sample_count,32);assert.equal(new Set(current.profile.source_call_ids).size,32);assert.ok(current.profile.source_call_ids.includes(extraCallId));assert.equal(current.profile.source_call_ids.filter((id:string)=>firstValue.source_call_ids.includes(id)).length,31);assert.notEqual(current.native_bytes,expectedBytes!);const rowBaseline=await profileRows(c,binds);
    for(const version of ['OLD','NEW']as const){await c.query('SAVEPOINT calibration_freshness_arm');const returned=await insertPreservingFirst(c,version,binds,prior);assert.deepEqual(returned,prior);const rows=await profileRows(c,binds);assert.equal(rows.length,2);assert.ok(rows.some(r=>r.native_bytes===current.native_bytes));await c.query('ROLLBACK TO SAVEPOINT calibration_freshness_arm');await c.query('RELEASE SAVEPOINT calibration_freshness_arm');assert.deepEqual(await profileRows(c,binds),rowBaseline);}
    const finalLedger=await ledger(c,f);assert.equal(finalLedger.calls,baseline.calls+1);assert.equal(finalLedger.applied,baseline.applied+1);assert.equal(finalLedger.reserved_micro_usd,'0');assert.equal(finalLedger.unknown_micro_usd,'0');report.functional_tail={extra_native_settled_applied_calls:1,extra_provider_http_requests:0,ledger:finalLedger,prior_native_bytes_sha256:hash(Buffer.from(expectedBytes!,'hex')),fresh_native_bytes_sha256:hash(Buffer.from(current.native_bytes,'hex')),both_versions_return_prior_SELECT:true,both_versions_native_BEFORE_accept_current:true,extra_profiles_committed:0};
   });checks.push({case:'fresh_evidence_after_intervening_native_commit_return_prior_SELECT',passed:true});const finalResolved=await census.readResolvedRootIds();assert.equal(finalResolved.length,33);report.functional_tail.final_distinct_resolved_roots=finalResolved.length;report.functional_tail.current_evidence_sample_count=32;
   await withCalibrationTransactionV1(f.database,'rollback',async c=>{const actualCatalog=await catalog(c);assert.deepEqual(actualCatalog,sourceCatalog!);report.catalog_after=actualCatalog;const rows=await profileRows(c,binds);assert.equal(rows.length,1);assert.equal(rows[0].native_bytes,expectedBytes!);});
   report.semantics={checks,baseline_profile_native_bytes_sha256:hash(Buffer.from(expectedBytes!,'hex')),commits:commits.length,ledger_unchanged_during_paired_arms:true,source32_provenance:true};assert.deepEqual(await sourceWitness(),report.source);
   const counterKnown=counterWindows.every(w=>w.delta.known),counterPassed=counterKnown&&['fresh','conflict'].every(stratum=>{const old=counterWindows.find(w=>w.stratum===stratum&&w.version==='OLD')!,next=counterWindows.find(w=>w.stratum===stratum&&w.version==='NEW')!;return old.delta.calls.guard==='1'&&next.delta.calls.guard==='1'&&BigInt(next.delta.calls.evidence)>0n&&BigInt(next.delta.calls.evidence)<BigInt(old.delta.calls.evidence);});
   const wall=calibrationPairedWallV1(timings);report.paired_wall=wall;report.gates={semantics:true,native_counters:counterKnown?counterPassed:null,paired_wall:wall.passed};report.candidate_accepted=calibrationCandidateAcceptedV1(report.gates);report.verdict=counterKnown?(report.candidate_accepted?'CANDIDATE_ACCEPTED':'REJECTED'):'INCONCLUSIVE';report.status='observed';report.elapsed_ms=elapsed();live();
  }});
 }catch(error){hadFailure=true;primary=error;report.status='failed';report.candidate_accepted=false;report.failure={phase,sqlstate:typeof(error as any)?.code==='string'&&/^[A-Z0-9]{5}$/u.test((error as any).code)?(error as any).code:null};}
 try{await persistReceipt(report);}catch(publication){if(hadFailure)throw new AggregateError([primary,publication],'calibration oracle and publication failed',{cause:primary});throw publication;}
 if(hadFailure)throw primary;return report;
}
