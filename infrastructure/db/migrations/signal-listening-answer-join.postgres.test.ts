import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {PoolClient} from 'pg';
import {labelerDigestV1,signalListeningJevIdentityV1,validateSignalListeningConfigurationV1,type SignalListeningResultV1} from '@noisia/query-engine';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {readSignalLabelingRunExposureV1} from '../signal-labeling-runs';
import {authorizeSignalListeningV1,saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {assertMassLabelingMapCurrentV1} from '../signal-mass-labeling';
import {withSharedWireFixtureV1,withSharedWireTxV1,prepareSharedWireRawV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {withSharedWireDefaultPostcheckV1,assertSharedWireDefaultRuntimeV1} from './signal-listening-statement-shared-wire.oracle';
import {answerGuardSourcesV1,assertAnswerGuardRuntimeV1,answerGuardProjectionOracleV1,answerGuardProductSqlV1,drainAnswerGuardWaitersV1} from './signal-listening-answer-join.oracle';
const enabled=process.env.NOISIA_R16_ANSWER_JOIN_PG==='true',root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const git=(dir:string,args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',timeout:2000,maxBuffer:65536,stdio:['ignore','pipe','ignore']}).trim();
type Arm='C'|'E';type Paid=Awaited<ReturnType<typeof prepareSharedWireRawV1>>;
type Pages=Array<{call:Paid[number]['call'];results:SignalListeningResultV1[]}>;
const order=['C','E','E','C']as const;
const report:any={contract:'r16-answer-guard-join-native-oracle-v1',status:'running',diagnostic_only:true,test_only:true,base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',
 source:null,probe:null,source6:[],new_files:[],guard_file:null,guard_c_sha256:null,guard_e_sha256:null,product_files:[],product_sql_sha256:{},defaults:[],installed:[],
 projection:[],attempts:[],waits:[],runtime:[],paired:[],completed:[],failures:[],unavailable_reasons:[],hz_before:null,hz_after:null,cpu_viability:null,
 h1_accepted:false,gain_claim:false,migration_created:false,physical_http_attempts:0,cpu_scope:'leader_backend_brackets_include_probes',
 worker_cpu:'unknown',sql_function_cpu:'unknown',control_subtracted:false,memory_claim:false,capacity_claim:false,
 human_scope:'new versioned human configuration preserved; membership-serving integration remains in full runtime/H6'};
let c='',e='',cpu:any,profiler:any,owned:any,probeRoot='',probeSha='',sequence=0;
let product:Awaited<ReturnType<typeof answerGuardProductSqlV1>>;
const errorInfo=(error:any)=>({code:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null,
 message:/^[a-z][a-z0-9_]{0,100}$/.test(error?.message??'')?error.message:'native_or_assertion_failure'});
async function checked(phase:string,needs:string[],body:()=>Promise<void>){try{assert.ok(needs.every(n=>report.completed.includes(n)),'previous native gate failed');await body();report.completed.push(phase);}
 catch(error){report.failures.push({phase,...errorInfo(error)});throw error;}}
async function hz(){const collector=await profiler.startPgCpuProfileV1({targetRoot:root,targetSha:report.source,intervalMs:0,maxDurationMs:30000}),r=await collector.stop();
 assert.ok(r.ownership);assert.equal(r.cleanup.status,'completed');assert.deepEqual(r.reason_codes,[]);assert.equal(r.snapshots.length,2);
 const first=r.snapshots[0].postgres,h=first.clk_tck,pm=first.pids.find((p:any)=>p.pid===first.postmaster_pid);assert.match(h,/^[1-9][0-9]*$/);assert.ok(pm);
 assert.ok(r.snapshots.every((s:any)=>s.postgres.clk_tck===h&&s.postgres.postmaster_pid===pm.pid&&s.postgres.pids.find((p:any)=>p.pid===pm.pid)?.starttime_ticks===pm.starttime_ticks));
 return{clk_tck:h,ownership:r.ownership,collector:r.collector,postmaster:{pid:pm.pid,starttime_ticks:pm.starttime_ticks},interval_ms:0,stopped_before_queries:true,
  brackets:r.snapshots.map((s:any)=>({label:s.label,bracket:s.bracket}))};}
before(async()=>{if(!enabled)return;await checked('setup',[],async()=>{
 assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(process.env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 for(const name of Object.keys(process.env))assert.ok(!/(ANTHROPIC|SONNET|VOYAGE|TYPESAFE|OPENAI).*?(API_KEY|TOKEN)/.test(name));
 const workspace=await realpath(process.env.GITHUB_WORKSPACE!);assert.equal(await realpath(root),root);assert.ok(root.startsWith(workspace+sep));
 probeRoot=process.env.R16_ANSWER_JOIN_PROBE_ROOT!;probeSha=process.env.R16_ANSWER_JOIN_PROBE_SHA!;
 assert.ok(probeRoot&&probeRoot!==root&&probeRoot.startsWith(workspace+sep));assert.equal(await realpath(probeRoot),probeRoot);assert.match(probeSha,/^[0-9a-f]{40}$/);
 assert.equal(git(probeRoot,['rev-parse','HEAD']),probeSha);assert.equal(git(probeRoot,['status','--porcelain','--untracked-files=all']),'');
 report.source=git(root,['rev-parse','HEAD']);report.probe=probeSha;assert.equal(git(root,['status','--porcelain','--untracked-files=all']),'');
 const load=(name:string)=>import(pathToFileURL(join(probeRoot,'scripts/r16-diagnostics/listening-small',name)).href);
 cpu=await load('query-cpu-oracle.mjs');profiler=await load('profile-pg-cpu.mjs');const marker=await load('run.mts');
 for(const d of cpu.SOURCE_DECLARATIONS_V1){assert.equal(hash(await readFile(new URL('./'+d.file,import.meta.url),'utf8')),d.sha256);report.source6.push({...d});}
 for(const file of ['signal-listening-answer-join.oracle.ts','signal-listening-answer-join.test.ts','signal-listening-answer-join.postgres.test.ts'])report.new_files.push({file,sha256:hash(await readFile(new URL('./'+file,import.meta.url),'utf8'))});
 const sources=await answerGuardSourcesV1();c=sources.c;e=sources.e;report.guard_file=sources.file;report.guard_c_sha256=hash(c);report.guard_e_sha256=hash(e);
 product=await answerGuardProductSqlV1();report.product_files=product.files;report.product_sql_sha256=product.hashes;
 const local=await import('./signal-r16-local-pg.fixture'),pool=await local.openR16CiPostgresV1();
 try{await marker.writeProfileOnlyPgOwnershipMarkerV1({targetRoot:root,targetSha:report.source,pool,localPg:local,env:process.env,inspectFormat:profiler.PG_CPU_INSPECT_FORMAT_V1});owned=await hz();report.hz_before=owned;const raw=await pool.connect();try{report.cpu_viability=await control(raw);}finally{raw.release();}}
 finally{await pool.end();}
 });});
after(async()=>{if(!enabled)return;
 if(owned)try{report.hz_after=await hz();assert.equal(report.hz_after.clk_tck,owned.clk_tck);assert.deepEqual(report.hz_after.ownership,owned.ownership);assert.deepEqual(report.hz_after.postmaster,owned.postmaster);}catch(error){report.failures.push({phase:'final_owned',...errorInfo(error)});}
 try{assert.equal(git(root,['rev-parse','HEAD']),report.source);assert.equal(git(root,['status','--porcelain','--untracked-files=all']),'');assert.equal(git(probeRoot,['rev-parse','HEAD']),probeSha);assert.equal(git(probeRoot,['status','--porcelain','--untracked-files=all']),'');}
 catch(error){report.failures.push({phase:'final_sources',...errorInfo(error)});}
 report.proc_reads_observed=sequence;report.status=report.failures.length?'failed':'observed';const json=JSON.stringify(report);assert.ok(Buffer.byteLength(json)<=256*1024);
 console.log('# answer join RESULT '+json);if(report.failures.length)throw Error('answer_join_native_failed');
});
async function fixture(body:(f:SharedWireFixtureV1)=>Promise<void>,scaled=false){await withSharedWireFixtureV1(async f=>{
 const before=await assertAnswerGuardRuntimeV1(f.database,c),statementBefore=await assertSharedWireDefaultRuntimeV1(f.database);assert.equal(statementBefore.runtime_kind,'C');await withSharedWireDefaultPostcheckV1(()=>body(f),async()=>{const after=await assertAnswerGuardRuntimeV1(f.database,c),statementAfter=await assertSharedWireDefaultRuntimeV1(f.database);assert.deepEqual(after,before);assert.deepEqual(statementAfter,statementBefore);report.defaults.push({before,after,statementBefore,statementAfter});});
 },undefined,scaled?{mode:'scaled_recovery'}:{});}
async function installed(f:SharedWireFixtureV1,arm:Arm,body:()=>Promise<void>){await withSharedWireDefaultPostcheckV1(async()=>{
 if(arm==='E')await f.database.query(e);report.installed.push({arm,...await assertAnswerGuardRuntimeV1(f.database,arm==='C'?c:e)});await body();
 },async()=>{if(arm==='E')await f.database.query(c);await assertAnswerGuardRuntimeV1(f.database,c);});}
async function paid(f:SharedWireFixtureV1,count=3,single=false){const view={...f,inputs:f.inputs.slice(0,count).map(input=>{
 if(!single)return input;const i=structuredClone(input);i.question_keys=['promotion'];i.question_digests={promotion:i.question_digests.promotion!};i.scope_basis={};return i;})};
 const outcomes=await prepareSharedWireRawV1(view,500);assert.equal(outcomes.length,count);const pages:Pages=outcomes.map(o=>({call:o.call,results:[o.result]}));return{view,outcomes,pages};}
async function snapshot(f:SharedWireFixtureV1,raw:Pick<PoolClient,'query'>=f.database){return(await raw.query(`SELECT jsonb_build_object(
 'calls',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id),'[]') FROM signal_labeling_calls x WHERE run_id=$1),
 'answers',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'created_at' ORDER BY root_id,question_key),'[]') FROM signal_listening_answers x WHERE run_id=$1),
 'caps',(SELECT jsonb_build_object('run',r.cap_micro_usd,'admission',a.execution_cap_micro_usd,'action',pa.max_execution_micro_usd) FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id JOIN signal_processing_policy_actions pa ON pa.policy_version_id=a.policy_version_id AND pa.action=a.action WHERE r.id=$1),
 'fences',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM signal_labeling_page_mutation_fences x WHERE run_id=$1))::text value`,[f.run.id])).rows[0].value as string;}
async function stage(raw:PoolClient,f:SharedWireFixtureV1,pages:Pages){const out=await raw.query(product.sql.results,[f.run.id,JSON.stringify(pages.map(p=>({id:p.call.id,results:p.results})))]);assert.equal(out.rowCount,pages.length);}
function writeRows(pages:Pages){return pages.flatMap(p=>{const result=p.results[0]!;return Object.entries(result.answers).map(([question_key,answer])=>({root_id:result.root_id,input_digest:result.input_digest,
 question_key,question_digest:result.question_digests[question_key],answer,call_id:p.call.id}));});}
async function attemptRows(f:SharedWireFixtureV1,pages:Pages){const calls=(await f.database.query('SELECT id,request_digest,raw_sha256 FROM signal_labeling_calls WHERE run_id=$1 AND id=ANY($2::uuid[])',[f.run.id,pages.map(p=>p.call.id)])).rows;
 return writeRows(pages).map(row=>{const call=calls.find(call=>call.id===row.call_id);assert.ok(call);return{...row,workspace_id:f.run.workspace_id,run_id:f.run.id,entity_context_digest:f.run.entity_context_digest,request_digest:call.request_digest,raw_sha256:call.raw_sha256};});}
// Explicit columns retain the real created_at default. Unlike the production
// ledger JOIN this path deliberately attempts forged ws/run/call values, so
// those rows cannot disappear in a test-side selector before the BEFORE guard.
const direct=`INSERT INTO signal_listening_answers(workspace_id,root_id,input_digest,entity_context_digest,question_digest,question_key,answer,run_id,call_id,request_digest,raw_sha256)
 SELECT x.workspace_id,x.root_id,x.input_digest,x.entity_context_digest,x.question_digest,x.question_key,x.answer,x.run_id,x.call_id,x.request_digest,x.raw_sha256
 FROM jsonb_to_recordset($1::jsonb) x(workspace_id uuid,root_id uuid,input_digest text,entity_context_digest text,question_digest text,question_key text,answer jsonb,run_id uuid,call_id uuid,request_digest text,raw_sha256 text)
 ON CONFLICT DO NOTHING`;
async function rejected(f:SharedWireFixtureV1,arm:Arm,rows:any[],prepare?:(raw:PoolClient)=>Promise<void>){let attempted=false,found:any;
 try{await withSharedWireTxV1(f,async raw=>{await raw.query(arm==='C'?c:e);await assertAnswerGuardRuntimeV1(raw,arm==='C'?c:e);await prepare?.(raw);attempted=true;await raw.query(direct,[JSON.stringify(rows)]);});}
 catch(error){found=errorInfo(error);}assert.equal(attempted,true,'failure must occur in the actual answer INSERT');assert.ok(found,'the invalid answer attempt must reject');return found;
}
test('E answer join native projection preserves every composite and FOUND across missing and mismatched identities',{skip:!enabled,timeout:600000},async()=>checked('projection',['setup'],async()=>{
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f);await f.store.apply(f.run,p.pages);const answers=(await f.database.query('SELECT to_jsonb(a) value FROM signal_listening_answers a WHERE run_id=$1 ORDER BY root_id,question_key',[f.run.id])).rows;
  assert.equal(answers.length,6);const sample=answers[0].value,other=p.pages.find(page=>page.call.id!==sample.call_id)!;
  const unowned=(await f.database.query('SELECT id FROM signal_labeling_runs r WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM signal_listening_runs o WHERE o.run_id=r.id) LIMIT 1',[f.run.workspace_id])).rows[0];assert.ok(unowned);
  const variants=[['present',sample],['missing_call',{...sample,call_id:randomUUID()}],['missing_run',{...sample,run_id:randomUUID()}],
   ['missing_owner_existing_run',{...sample,run_id:unowned.id}],['missing_question',{...sample,question_key:'nonexistent_question'}],['null_question',{...sample,question_key:null}],
   ['mismatched_workspace',{...sample,workspace_id:randomUUID()}],['other_call_same_run',{...sample,call_id:other.call.id}]]as const;
  const raw=await f.database.connect();await withSharedWireDefaultPostcheckV1(async()=>{
   await raw.query(answerGuardProjectionOracleV1(c,'C'));await raw.query(answerGuardProjectionOracleV1(c,'E'));
   await raw.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
    const anchor=(await raw.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot;
    for(const [name,row]of variants){const result=(await raw.query(`SELECT pg_temp.noisia_answer_projection_c(jsonb_populate_record(NULL::signal_listening_answers,$1::jsonb))::text c,
     pg_temp.noisia_answer_projection_e(jsonb_populate_record(NULL::signal_listening_answers,$1::jsonb))::text e`,[JSON.stringify(row)])).rows[0];assert.equal(result.e,result.c);
     const value=JSON.parse(result.c);assert.equal(value.found,name==='present'||name==='missing_call'||name==='other_call_same_run');
     assert.deepEqual(value.field_types,{call:'signal_labeling_calls',run:'signal_labeling_runs',owner:'signal_listening_runs',question:'signal_listening_questions'});
     if(name==='missing_call'){assert.equal(value.call.id,null);assert.equal(value.run.id,f.run.id);assert.equal(value.owner.run_id,f.run.id);assert.ok(value.question.configuration_id);}
     if(name==='missing_question'){assert.equal(value.question.configuration_id,null);assert.ok(value.run.id);}
     report.projection.push({arm,case:name,equal:true,found:value.found,projection_sha256:hash(result.c)});
    }assert.equal((await raw.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot,anchor);
   }finally{await raw.query('ROLLBACK');}
  },async()=>{try{await raw.query('DROP FUNCTION IF EXISTS pg_temp.noisia_answer_projection_c(signal_listening_answers),pg_temp.noisia_answer_projection_e(signal_listening_answers)');}finally{raw.release();}});
  const check=await f.database.connect();try{assert.equal(await readSignalLabelingRunExposureV1(check,f.run.id),'18');}finally{check.release();}
  const verified=(await f.database.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status='settled' AND results_applied AND raw_storage_verified_at IS NOT NULL AND raw_storage_verified_key=raw_storage_key",[f.run.id])).rows[0].n;
  assert.equal(verified,3);report.runtime.push({arm,case:'positive_native_apply',paid_calls:verified,answers:answers.length,exposure_micro_usd:'18',raw_durable_verified:true});
 }));
}));
test('E answer join native BEFORE guards every conflict and malformed receipt attempt',{skip:!enabled,timeout:600000},async()=>checked('attempts',['projection'],async()=>{
 // Each arm has its own real RAW/settled ledger, and all direct attempts are
 // checked by the public BEFORE guard, including conflict-suppressed tuples.
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f);await f.store.apply(f.run,[p.pages[0]!]);const all=await attemptRows(f,p.pages),sample=all.find(r=>r.call_id===p.pages[0]!.call.id)!;
  const baseline=await snapshot(f),controls=(await f.database.query(direct,[JSON.stringify([sample,sample])])).rowCount;assert.equal(controls,0);
  report.attempts.push({arm,case:'existing_valid_duplicate',attempted_rows:2,inserted_rows:controls});
  const defects=[['call_missing',{call_id:randomUUID()}],['call_mismatch',{call_id:p.pages[1]!.call.id}],['run',{run_id:randomUUID()}],['workspace',{workspace_id:randomUUID()}],
   ['root',{root_id:randomUUID()}],['input',{input_digest:'forged'}],['context',{entity_context_digest:'forged'}],['question_digest',{question_digest:'sha256:'+'f'.repeat(64)}],
   ['question_key',{question_key:'missing_question'}],['request',{request_digest:'forged'}],['raw',{raw_sha256:'sha256:'+'f'.repeat(64)}],['value',{answer:{type:'noul',noul:.999}}]]as const;
  for(const [name,patch]of defects){const error=await rejected(f,arm,[{...sample,...patch}]);assert.deepEqual(error,{code:'P0001',message:'listening_answer_receipt_invalid'});
   assert.equal(await snapshot(f),baseline);report.attempts.push({arm,case:name,scope:'direct_before_attempt',attempted_rows:1,rejected:error});}
  const later=all.filter(row=>row.call_id!==p.pages[0]!.call.id),valid=later[0]!,bad={...later.find(row=>row.call_id!==valid.call_id)!,raw_sha256:'sha256:'+'f'.repeat(64)};
  const mixed=await rejected(f,arm,[valid,bad],raw=>stage(raw,f,p.pages.slice(1)));assert.equal(mixed.message,'listening_answer_receipt_invalid');assert.equal(await snapshot(f),baseline);
  report.attempts.push({arm,case:'invalid_sibling_aborts_all',attempted_rows:2,rejected:mixed,baseline_unchanged:true});
  await withSharedWireTxV1(f,async raw=>{await raw.query(arm==='C'?c:e);await stage(raw,f,p.pages.slice(1));const inserted=await raw.query(direct,[JSON.stringify([valid,valid])]);assert.equal(inserted.rowCount,1);
   report.attempts.push({arm,case:'internal_valid_duplicate',attempted_rows:2,inserted_rows:inserted.rowCount});});
  assert.equal(await snapshot(f),baseline);
  const internalBad=await rejected(f,arm,[valid,{...valid,raw_sha256:'sha256:'+'f'.repeat(64)}],raw=>stage(raw,f,p.pages.slice(1)));
  assert.deepEqual(internalBad,{code:'P0001',message:'listening_answer_receipt_invalid'});assert.equal(await snapshot(f),baseline);
  report.attempts.push({arm,case:'internal_invalid_duplicate_aborts_all',attempted_rows:2,rejected:internalBad,baseline_unchanged:true});
  // Mutable results must be re-read on every attempt, not approved per call.
  const mutable=await rejected(f,arm,[sample],async raw=>{const result=structuredClone(p.pages[0]!.results[0]!);result.answers[sample.question_key]={...sample.answer,synthetic_divergence:true} as any;
   await stage(raw,f,[{call:p.pages[0]!.call,results:[result]}]);});assert.equal(mutable.message,'listening_answer_receipt_invalid');
  report.attempts.push({arm,case:'mutable_result_after_first_apply',attempted_rows:1,rejected:mutable});assert.equal(await snapshot(f),baseline);
  for(const [question,answer]of [['promotion',{type:'noul',noul:2}],['voice',{type:'choice',choice:'not_native',confidence:2,probabilities:{not_native:1}}]]as const){
   const attempt=all.find(r=>r.call_id===p.pages[1]!.call.id&&r.question_key===question)!;assert.ok(attempt);
   const result=structuredClone(p.pages[1]!.results[0]!);result.answers[question]=answer as any;
   const error=await rejected(f,arm,[{...attempt,answer}],raw=>stage(raw,f,[{call:p.pages[1]!.call,results:[result]}]));
   assert.deepEqual(error,{code:'P0001',message:'listening_answer_invalid'});report.attempts.push({arm,case:'matching_malformed_'+question,attempted_rows:1,rejected:error});
  }
  assert.equal(await snapshot(f),baseline);
 }));
 // A committed conflicting row is genuinely invisible to this pre-existing RR
 // snapshot. A valid new sibling must not survive its bad tuple's rejection.
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f),rows=await attemptRows(f,p.pages),observer=await f.database.connect();let error:any;
  try{await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');assert.equal((await observer.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n,0);
   await f.store.apply(f.run,[p.pages[0]!]);assert.equal((await observer.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n,0);
   await stage(observer,f,[p.pages[1]!]);const sibling=rows.find(r=>r.call_id===p.pages[1]!.call.id)!,conflict={...rows.find(r=>r.call_id===p.pages[0]!.call.id)!,raw_sha256:'forged'};
   try{await observer.query(direct,[JSON.stringify([sibling,conflict])]);}catch(failure){error=errorInfo(failure);}assert.deepEqual(error,{code:'P0001',message:'listening_answer_receipt_invalid'});
  }finally{try{await observer.query('ROLLBACK');}finally{observer.release();}}
  const actual=(await f.database.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n;assert.equal(actual,2);
  report.attempts.push({arm,case:'invisible_RR_conflict_sibling_abort',attempted_rows:2,rejected:error,committed_original_answers:actual,invalid_sibling_answers:0});
 }));
}));
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function waitBlock(f:SharedWireFixtureV1,holder:number,waiter?:number){const deadline=Date.now()+5000;
 while(Date.now()<deadline){const rows=(await f.database.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>$1
  AND $1::int=ANY(pg_blocking_pids(pid)) AND ($2::int IS NULL OR pid=$2) AND (query LIKE '%raw_run_fence%' OR query LIKE 'INSERT INTO signal_listening_answers%')`,[holder,waiter??null])).rows;
  if(rows.length){assert.equal(rows.length,1);return rows[0].pid as number;}await delay(10);
 }assert.fail('the exact native contender never waited on the owned holder');}
async function heldApply(f:SharedWireFixtureV1,pages:Pages,mutate:(holder:PoolClient)=>Promise<void>){
 const holder=await f.database.connect();let pending:Promise<any>|undefined,blocked=false;
 return withSharedWireDefaultPostcheckV1(async()=>{await holder.query('BEGIN');const pid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  await holder.query('SELECT id FROM signal_labeling_runs WHERE id=$1 FOR UPDATE',[f.run.id]);
  pending=f.store.apply(f.run,pages).then(()=>({ok:true}),error=>({ok:false,error:errorInfo(error)}));
  await waitBlock(f,pid);blocked=true;await mutate(holder);await holder.query('COMMIT');const out=await pending;assert.equal(out.ok,false);return{blocked,error:out.error};
 },()=>drainAnswerGuardWaitersV1(holder,pending));
}
test('E answer join native revocations after lock waits and lease expiry remain fenced',{skip:!enabled,timeout:600000},async()=>checked('waits',['attempts'],async()=>{
 for(const kind of ['source','license','retention']as const){let reference:any;
  for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
   const p=await paid(f),rows=await attemptRows(f,p.pages),baseline=await snapshot(f);
   const observed=await heldApply(f,p.pages,async holder=>{const sql=kind==='source'?"UPDATE data_sources SET status='archived' WHERE workspace_id=$1":kind==='license'?
    "UPDATE signal_licensing_policies SET status='retired',effective_to=clock_timestamp() WHERE workspace_id=$1":
    "UPDATE signal_retention_policies SET status='retired',effective_to=clock_timestamp() WHERE workspace_id=$1";
    assert.ok((await holder.query(sql,[f.run.workspace_id])).rowCount!>0);});
   reference??=observed.error;assert.deepEqual(observed.error,reference);assert.equal(await snapshot(f),baseline);
   const directError=await rejected(f,arm,[rows[0]!],raw=>stage(raw,f,p.pages));assert.deepEqual(directError,{code:'P0001',message:'listening_answer_receipt_invalid'});
   report.waits.push({arm,case:kind+'_revoked_after_apply_run_wait',scope:'native_apply_then_direct_before_right',blocked:observed.blocked,
    apply_error:observed.error,direct_error:directError,baseline_unchanged:true});
  }));
 }
 for(const kind of ['role','grant']as const)for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f);await f.store.apply(f.run,p.pages);const rows=await attemptRows(f,p.pages),baseline=await snapshot(f);
  // Use a genuine authorized client identity/grant before revoking it. This is
  // synthetic fixture data; the run's immutable actor ID never changes.
  const scope=(await f.database.query('SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1',[f.run.workspace_id])).rows[0];
  await f.database.query("UPDATE users SET user_type='client',primary_role='client_admin',organization_id=$2,status='active' WHERE id=$1",[f.run.actor_user_id,scope.organization_id]);
  await f.database.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id) VALUES($1,$2,'admin',$1)
   ON CONFLICT(user_id,brand_id) DO UPDATE SET access_level='admin',revoked_at=NULL`,[f.run.actor_user_id,scope.brand_id]);
  assert.equal((await f.database.query('SELECT signal_processing_actor_v1($1,$2) allowed',[f.run.workspace_id,f.run.actor_user_id])).rows[0].allowed,true);
  assert.equal((await f.database.query(direct,[JSON.stringify([rows[0]])])).rowCount,0,'authorized duplicate genuinely reaches the current BEFORE guard');
  const holder=await f.database.connect(),contender=await f.database.connect();let pending:Promise<any>|undefined;
  await withSharedWireDefaultPostcheckV1(async()=>{
   await holder.query('BEGIN');await contender.query('BEGIN');const holderPid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid),waiterPid=Number((await contender.query('SELECT pg_backend_pid() pid')).rows[0].pid);
   const mutation=kind==='role'?await holder.query("UPDATE users SET primary_role='client_viewer' WHERE id=$1",[f.run.actor_user_id]):
    await holder.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[f.run.actor_user_id,scope.brand_id]);assert.ok(mutation.rowCount!>0);
   pending=contender.query(direct,[JSON.stringify([rows[0]])]).then(()=>({ok:true}),error=>({ok:false,error:errorInfo(error)}));
   await waitBlock(f,holderPid,waiterPid);await holder.query('COMMIT');const observed=await pending;assert.equal(observed.ok,false);
   assert.deepEqual(observed.error,{code:'42501',message:'processing_forbidden'});report.waits.push({arm,case:kind+'_revoked_after_actor_lock_wait',scope:'answer_before_actor',blocked:true,rejected:observed.error});
  },()=>drainAnswerGuardWaitersV1(holder,pending,contender));
  assert.equal(await snapshot(f),baseline);
 }));
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f),baseline=await snapshot(f);await f.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  await assert.rejects(f.store.apply(f.run,p.pages),/labeling_lease_lost/);assert.equal(await snapshot(f),baseline);
  report.waits.push({arm,case:'expired_before_apply',scope:'native_apply_run_fence',rejected:true,baseline_unchanged:true});
 }));
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f),baseline=await snapshot(f);let delayed=false,inserted=false;
  const database:SharedWireFixtureV1['database']={query:f.database.query.bind(f.database),connect:async()=>{const raw=await f.database.connect();return new Proxy(raw,{get(target,key){
   if(key==='query')return async(sql:string,values?:unknown[])=>{if(sql==='COMMIT'){delayed=true;await delay(1700);}const result=await target.query(sql,values);if(sql===product.sql.answers)inserted=true;return result;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
  const store=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no individual raw/provider');}});
  await f.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1",[f.run.id]);
  await assert.rejects(store.apply(f.run,p.pages),/labeling_lease_lost/);assert.equal(delayed,true);assert.equal(inserted,true);assert.equal(await snapshot(f),baseline);
  report.waits.push({arm,case:'expired_at_real_apply_COMMIT',scope:'native_deferred_apply_fence',delayed_commit:true,answer_insert_completed:true,baseline_unchanged:true});
 }));
}));
test('E answer join native replay historical paid configuration and technical failures retain precedence',{skip:!enabled,timeout:600000},async()=>checked('runtime',['waits'],async()=>{
 for(const arm of ['C','E']as const)await fixture(async f=>installed(f,arm,async()=>{
  const p=await paid(f),cfg={...f.configuration,instructions:f.configuration.instructions+' New synthetic human instructions.',questions:f.configuration.questions.map(q=>({...q,human_locked:true}))};
  const later=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,expected_revision:1,provenance:'human',configuration:cfg});
  const newDefinition=(await f.database.query('SELECT question_digest FROM signal_listening_questions WHERE configuration_id=$1 AND question_key=$2',[later.id,p.pages[0]!.call.inputs[0]!.question_keys[0]])).rows[0];
  assert.notEqual(newDefinition.question_digest,p.pages[0]!.results[0]!.question_digests[p.pages[0]!.call.inputs[0]!.question_keys[0]!]);
  const humanBefore=(await f.database.query('SELECT configuration::text value FROM signal_listening_configurations WHERE id=$1',[later.id])).rows[0].value;
  await f.store.apply(f.run,[p.pages[0]!]);const first=await snapshot(f);await f.store.apply(f.run,[p.pages[0]!]);assert.equal(await snapshot(f),first);
  const divergent=structuredClone(p.pages[0]!);divergent.results[0]!.answers.promotion={type:'noul',noul:.8};
  await assert.rejects(f.store.apply(f.run,[divergent]),/labeling_result_replay_conflict/);assert.equal(await snapshot(f),first);
  assert.equal((await f.database.query('SELECT configuration::text value FROM signal_listening_configurations WHERE id=$1',[later.id])).rows[0].value,humanBefore);
  await assert.rejects(withSharedWireTxV1(f,async raw=>{await raw.query('UPDATE signal_listening_answers SET answer=answer WHERE run_id=$1',[f.run.id]);}),/listening_history_immutable/);
  const input=p.pages[1]!.call.inputs[0]!,technical:SignalListeningResultV1={root_id:input.root_id,input_digest:input.input_digest,entity_context_digest:f.run.entity_context_digest,
   question_digests:{...input.question_digests},answers:{},status:'error',error_code:'synthetic_observed_technical_failure'};
  await f.store.apply(f.run,[{call:p.pages[1]!.call,results:[technical]}]);
  const failure=(await f.database.query('SELECT error_code FROM signal_listening_failures WHERE call_id=$1',[p.pages[1]!.call.id])).rows[0];assert.equal(failure.error_code,technical.error_code);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_answers WHERE call_id=$1',[p.pages[1]!.call.id])).rows[0].n,0);
  const rows=await attemptRows(f,[p.pages[1]!]);const denied=await rejected(f,arm,[rows[0]!]);assert.deepEqual(denied,{code:'P0001',message:'listening_answer_receipt_invalid'});
  report.runtime.push({arm,case:'historical_paid_human_configuration_replay_technical',new_question_digest_differs:true,human_configuration_preserved:true,
   same_replay_unchanged:true,divergent_replay_rejected:true,answer_update_rejected:true,technical_failure_recorded:true,technical_negative_answers:0,
   technical_answer_rejected:denied,technical_origin:'existing worker error-result contract applied by native API to a genuine observed paid RAW receipt'});
 }));
}));
async function readCPU(raw:PoolClient){const start=process.hrtime.bigint(),out=await raw.query(cpu.CPU_READ_SQL_V1),end=process.hrtime.bigint();assert.equal(out.rows.length,1);
 return cpu.parseQueryCpuSampleV1(out.rows[0],{start_ns:String(start),end_ns:String(end)},sequence++);}
async function control(raw:PoolClient){const a=await readCPU(raw),b=await readCPU(raw);return{snapshots:[a,b],cpu:cpu.queryCpuDeltaV1(a,b,owned.clk_tck)};}
async function sourceApplyFence(raw:PoolClient,f:SharedWireFixtureV1,pages:Pages){
 const fence=()=>raw.query(product.sql.runFence,[f.run.id,f.run.lease_token,f.run.workspace_id]);assert.equal((await fence()).rows.length,1);
 const ids=pages.map(p=>p.call.id);assert.equal((await raw.query(product.sql.callLock,[f.run.workspace_id,f.run.id,ids])).rows.length,pages.length);
 const replay=(await raw.query(product.sql.replay,[f.run.workspace_id,f.run.id,ids,JSON.stringify(pages.map(p=>({id:p.call.id,results:p.results})))])).rows;
 assert.equal(replay.length,pages.length);assert.ok(replay.every(r=>r.replay_ok&&!r.results_applied));
 assert.equal((await fence()).rows.length,1);await raw.query(product.sql.mutationFence,[f.run.workspace_id,f.run.id,f.run.lease_token,'apply']);
 await stage(raw,f,pages);
 // The batch's production write authorization and historical-owner checks are
 // outside the timed answer INSERT, in the same order as the native APPLY.
 await authorizeSignalListeningV1(raw,{workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id},'process');
 const owner=(await raw.query('SELECT o.* FROM signal_listening_runs o WHERE workspace_id=$1 AND run_id=$2',[f.run.workspace_id,f.run.id])).rows[0];
 assert.ok(owner);assert.equal(f.run.identity.params.request_version,'listening-jev-v1');
 assert.equal(labelerDigestV1(f.run.identity),labelerDigestV1(signalListeningJevIdentityV1(validateSignalListeningConfigurationV1(f.run.identity.params.configuration))));
 await assertMassLabelingMapCurrentV1(raw,f.run.workspace_id,owner.map_id);
}
test('E answer join native CEEC pairs 1000 genuine paid calls for one and two questions',{skip:!enabled,timeout:600000},async()=>checked('paired',['runtime'],async()=>{
 for(const single of [true,false])await fixture(async whole=>{
  assert.equal(whole.inputs.length,1002);const p=await paid(whole,1000,single),f=p.view,rows=writeRows(p.pages),expected=single?1000:2000;
  assert.equal(rows.length,expected);assert.ok(p.pages.every(page=>page.results[0]!.status==='labeled'||page.results[0]!.status==='abstained'));
  const actualPaid=(await f.database.query(`SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status='settled' AND NOT results_applied
   AND usage IS NOT NULL AND settled_micro_usd IS NOT NULL AND raw_storage_verified_at IS NOT NULL AND raw_storage_verified_key=raw_storage_key`,[f.run.id])).rows[0].n;assert.equal(actualPaid,1000);
  const baseline=await snapshot(f),encodedRows=JSON.stringify(rows),observation:any={case:single?'one_selected_promotion':'two_selected_voice_promotion',order,committed:false,
   calls:actualPaid,selected_questions_per_call:single?1:2,expected_answer_rows:expected,configured_questions:f.configuration.questions.length,
   source_insert_sha256:product.hashes.answers,source_results_sha256:product.hashes.results,baseline_sha256:hash(baseline),
   fresh_read_committed_transactions:true,same_dml_snapshot:false,measured_scope:'production answer INSERT only; real RAW/settle committed before all arms',arms:[],controls:[]};
  for(const arm of order)await withSharedWireTxV1(f,async raw=>{
   const tx=(await raw.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only")).rows[0];assert.deepEqual(tx,{isolation:'read committed',read_only:'off'});
   assert.equal(hash(await snapshot(f,raw)),hash(baseline));assert.equal(await readSignalLabelingRunExposureV1(raw,f.run.id),'6000');
   await raw.query(arm==='C'?c:e);const active=await assertAnswerGuardRuntimeV1(raw,arm==='C'?c:e);
   await sourceApplyFence(raw,f,p.pages);const applied=(await raw.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND results_applied',[f.run.id])).rows[0].n;assert.equal(applied,1000);
   observation.controls.push({arm,phase:'before',...await control(raw)});
   // This raw client is privately checked out by withSharedWireTxV1. No other
   // caller receives it, and every operation is awaited serially. Probe reads
   // remain outside the target SQL and no transport/body reserialization is timed.
   const before=await readCPU(raw),start=process.hrtime.bigint();const inserted=await raw.query(product.sql.answers,[f.run.workspace_id,f.run.entity_context_digest,f.run.id,encodedRows]);
   const end=process.hrtime.bigint(),after=await readCPU(raw);assert.equal(inserted.rowCount,expected);
   assert.ok(BigInt(before.bracket.end_ns)<=start&&end<=BigInt(after.bracket.start_ns));
   observation.controls.push({arm,phase:'after',...await control(raw)});await raw.query('SET CONSTRAINTS ALL IMMEDIATE');
   const actual=(await raw.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n;assert.equal(actual,expected);
   const exposure=await readSignalLabelingRunExposureV1(raw,f.run.id);assert.equal(exposure,'6000');
   // Deferred mutation fences have random IDs; compare all call/result/answer
   // fields independently while proving each real constraint before rollback.
   const proof=(await raw.query(`SELECT jsonb_build_object(
    'calls',(SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id) FROM signal_labeling_calls x WHERE run_id=$1),
    'answers',(SELECT jsonb_agg(to_jsonb(x)-'created_at' ORDER BY root_id,question_key) FROM signal_listening_answers x WHERE run_id=$1))::text value`,[f.run.id])).rows[0].value;
   observation.arms.push({arm,active,query_bracket:{start_ns:String(start),end_ns:String(end)},query_wall_ns:String(end-start),snapshots:[before,after],
    cpu:cpu.queryCpuDeltaV1(before,after,owned.clk_tck),inserted_rows:inserted.rowCount,answer_rows:actual,results_applied_calls:applied,
    exposure_micro_usd:exposure,result_sha256:hash(proof),constraints_checked_before_rollback:true});
  });
  assert.equal(hash(await snapshot(f)),hash(baseline));assert.equal(new Set(observation.arms.map((a:any)=>a.result_sha256)).size,1);
  assert.deepEqual(observation.arms.map((a:any)=>a.arm),order);report.paired.push(observation);
 },true);
}));
