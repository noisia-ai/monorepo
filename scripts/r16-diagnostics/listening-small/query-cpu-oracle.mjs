// Diagnostic-only, fixed b95 C oracle. Never import a target .test.ts or replace a function.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseProcStatV1,startPgCpuProfileV1,runBoundedCommandForTestV1,PG_CPU_INSPECT_FORMAT_V1} from './profile-pg-cpu.mjs';

export const TARGET_SHA_V1='b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1';
export const CPU_READ_SQL_V1="SELECT pg_backend_pid() pid,pg_read_file('/proc/self/stat',0,8192,false) stat";
export const SOURCE_DECLARATIONS_V1=Object.freeze([
 ['0330_signal_listening_statement_shared_wire.sql','94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305'],
 ['0331_signal_listening_statement_payload.sql','cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5'],
 ['signal-listening-statement-shared-wire.oracle.ts','0aab9ee2a1b8f909081ede8b2be78022e0bb103cff57a63f6bf9c31accc97991'],
 ['signal-listening-statement-shared-wire.fixture.ts','33008e28c6423492dd905d4ed736403c0ee7899c3622967ec55e1ec81962924b'],
 ['signal-listening-statement-shared-wire.postgres.test.ts','3962bd0ac8986829330faae8e40292eb7f5d5994ecc85f92e5fb2dbd861b13f5'],
 ['signal-listening-statement-shared-wire.test.ts','35706f345f3a7f50593bd089f4d9026f7b5ffc07e0639662c4ab827d33ae4b21'],
].map(([file,sha256])=>Object.freeze({file,sha256})));
const DB='infrastructure/db/migrations';
const MAX_ARTIFACT_BYTES=2*1024*1024;
const sha=s=>createHash('sha256').update(s).digest('hex');
const uint=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s);
const n=s=>{if(!uint(s))throw Error('cpu_counter_invalid');return BigInt(s);};
const hzValue=s=>{if(!uint(s)||n(s)===0n||n(s)>1000000000n)throw Error('cpu_hz_invalid');return n(s);};
const under=(p,root)=>p.startsWith(root+path.sep);
const canonical=p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p;

// These are the minimal inline statements in b95's oracle, not an SQL input API.
const SQL=Object.freeze({
 snapshot:"SELECT jsonb_build_object('calls',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM signal_labeling_calls c WHERE run_id=$1),'links',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY call_id,question_key),'[]') FROM signal_listening_call_questions q WHERE run_id=$1),'answers',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY root_id,question_key),'[]') FROM signal_listening_answers a WHERE run_id=$1)) value",
 owner:'SELECT configuration_id,map_id,configuration_digest FROM signal_listening_runs WHERE run_id=$1',
 caps:`SELECT r.cap_micro_usd::text run_cap,a.execution_cap_micro_usd::text admission_cap,pa.max_execution_micro_usd::text action_cap
    FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id
    JOIN signal_processing_policy_actions pa ON pa.policy_version_id=a.policy_version_id AND pa.action=a.action WHERE r.id=$1`,
 mark:"UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",
 constraints:'SET CONSTRAINTS ALL IMMEDIATE',
 result:'SELECT id,status,request_digest,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id',
 transaction:"SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only",
});
export function verifyInlineSourcesV1(source){
 if(typeof source!=='string'||Object.values(SQL).some(sql=>!source.includes(sql)))throw Error('cpu_inline_source_mismatch');
 return Object.fromEntries(Object.entries(SQL).map(([name,sql])=>[name,{sha256:sha(sql),source:'signal-listening-statement-shared-wire.postgres.test.ts',source_sha256:SOURCE_DECLARATIONS_V1[4].sha256}]));
}

export function parseQueryCpuSampleV1(row,bracket,sequence){
 if(typeof row?.stat!=='string'||Buffer.byteLength(row.stat)>8192||!row.stat.endsWith('\n')||row.stat.includes('\r'))throw Error('cpu_stat_invalid');
 const text=row.stat.slice(0,-1);if(text.includes('\n'))throw Error('cpu_stat_invalid');
 let p;try{p=parseProcStatV1(text);}catch{throw Error('cpu_stat_invalid');}
 if(!Number.isSafeInteger(row.pid)||row.pid!==p.pid)throw Error('cpu_pid_mismatch');
 if(!uint(bracket?.start_ns)||!uint(bracket?.end_ns)||n(bracket.end_ns)<n(bracket.start_ns)||!Number.isSafeInteger(sequence)||sequence<0)throw Error('cpu_bracket_invalid');
 return{sequence,pid:p.pid,starttime_ticks:p.starttime_ticks,utime_ticks:p.utime_ticks,stime_ticks:p.stime_ticks,
  bracket:{start_ns:bracket.start_ns,end_ns:bracket.end_ns}};
}
export function queryCpuDeltaV1(before,after,hz){
 const h=hzValue(hz);
 if(before.pid!==after.pid||before.starttime_ticks!==after.starttime_ticks)throw Error('cpu_backend_identity_changed');
 const u=n(after.utime_ticks)-n(before.utime_ticks),s=n(after.stime_ticks)-n(before.stime_ticks);
 if(u<0n||s<0n)throw Error('cpu_counter_regressed');
 if(n(after.bracket.start_ns)<n(before.bracket.end_ns)||n(after.bracket.end_ns)<n(after.bracket.start_ns))throw Error('cpu_bracket_overlap');
 return{user_ticks:String(u),system_ticks:String(s),total_ticks:String(u+s),user_ns:String(u*1000000000n/h),
  system_ns:String(s*1000000000n/h),total_ns:String((u+s)*1000000000n/h),clk_tck:hz,tick_resolution_ns:String(1000000000n/h),
  elapsed_ns:{minimum:String(n(after.bracket.start_ns)-n(before.bracket.end_ns)),maximum:String(n(after.bracket.end_ns)-n(before.bracket.start_ns))},
  scope:'leader_backend_cpu_between_proc_read_points',includes_probes:true,control_subtracted:false,worker_cpu:'unknown',
  zero_interpretation:u+s===0n?'no_observed_tick_increment':null};
}

// The driver receives only these three finite methods. ops and the authentic raw
// client stay in the owner module's closure; no Proxy crosses a native helper.
function createDriver(ops){
 let busy=false;
 const exclusive=async action=>{if(busy)throw Error('cpu_client_busy');busy=true;try{return await action();}finally{busy=false;}};
 const timed=async action=>{const start=ops.nowNs();const value=await action();return{value,bracket:{start_ns:String(start),end_ns:String(ops.nowNs())}};};
 const stage=(name,a,q,b)=>{if(n(a.bracket.end_ns)>n(q.bracket.start_ns)||n(q.bracket.start_ns)>n(q.bracket.end_ns)||n(q.bracket.end_ns)>n(b.bracket.start_ns))throw Error('cpu_target_bracket_invalid');
  return{stage:name,query_bracket:q.bracket,query_wall_ns:String(n(q.bracket.end_ns)-n(q.bracket.start_ns)),cpu:queryCpuDeltaV1(a,b,ops.hz)};};
 return Object.freeze({
  control:()=>exclusive(async()=>{const a=await ops.read(),b=await ops.read();return{snapshots:[a,b],cpu:queryCpuDeltaV1(a,b,ops.hz)};}),
  selectC:()=>exclusive(async()=>{const a=await ops.read(),q=await timed(ops.validator),b=await ops.read();
   return{snapshots:[a,b],...stage('validator_C',a,q,b),flags:q.value};}),
  dmlC:()=>exclusive(async()=>{const a=await ops.read(),insert=await timed(ops.insert),b=await ops.read(),
   mark=await timed(ops.mark),c=await ops.read(),constraints=await timed(ops.constraints),d=await ops.read();
   return{snapshots:[a,b,c,d],inserted_count:insert.value,stages:[
    stage('insert',a,insert,b),stage('mark',b,mark,c),stage('constraints',c,constraints,d)]};}),
 });
}
// Explicit pure-test injection seam; the CLI constructs ops internally only.
export const createQueryCpuDriverForTestV1=createDriver;

export function validateQueryCpuInvocationV1(o,e,platform){
 if(platform!=='linux'||e.GITHUB_ACTIONS!=='true'||e.CI!=='true'||e.RUNNER_OS!=='Linux'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||
  !/^[1-9][0-9]*$/.test(e.GITHUB_RUN_ID??'')||!/^[1-9][0-9]*$/.test(e.GITHUB_RUN_ATTEMPT??'')||!/^[A-Za-z0-9_-]+$/.test(e.GITHUB_JOB??'')||
  !canonical(e.GITHUB_WORKSPACE)||!canonical(e.RUNNER_TEMP)||e.NOISIA_R16_LOCAL_PG_LAB!=='r16-benchmark-pg17'||
  o.targetSha!==TARGET_SHA_V1||!/^[0-9a-f]{40}$/.test(o.probeSha??'')||o.probeSha===o.targetSha||
  !canonical(o.targetRoot)||!canonical(o.probeRoot)||o.targetRoot===o.probeRoot||!under(o.targetRoot,e.GITHUB_WORKSPACE)||!under(o.probeRoot,e.GITHUB_WORKSPACE)||
  !canonical(o.artifact)||!under(o.artifact,e.RUNNER_TEMP)||path.basename(o.artifact)!=='query-cpu.json')throw Error('cpu_invocation_invalid');
 if(Object.keys(e).some(k=>/(ANTHROPIC|SONNET|VOYAGE|TYPESAFE|OPENAI).*?(API_KEY|TOKEN)/.test(k)))throw Error('cpu_provider_credentials_forbidden');
}
async function git(root,args,maxBytes=65536){
 const r=await runBoundedCommandForTestV1('git',args,undefined,{cwd:root,timeoutMs:2000,maxBytes});
 if(r.status!=='ok'||r.cleanup?.reaped===false)throw Error('cpu_source_command_failed');return r.stdout;
}
async function checkSources(o){
 for(const [root,expected]of [[o.targetRoot,o.targetSha],[o.probeRoot,o.probeSha]]){
  if(await fs.realpath(root)!==root||(await git(root,['rev-parse','HEAD'],128)).trim()!==expected||
   (await git(root,['status','--porcelain','--untracked-files=all'])).trim())throw Error('cpu_source_identity_invalid');
 }
 const sources=[];let inline;
 for(const d of SOURCE_DECLARATIONS_V1){const file=path.join(o.targetRoot,DB,d.file),st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024||await fs.realpath(file)!==file)throw Error('cpu_source_file_invalid');
  const body=await fs.readFile(file,'utf8');if(sha(body)!==d.sha256)throw Error('cpu_source_hash_mismatch');sources.push({...d});
  if(d.file.endsWith('.postgres.test.ts'))inline=verifyInlineSourcesV1(body);
 }
 // The invoked module must itself be the sealed probe checkout, never a sibling.
 if(fileURLToPath(import.meta.url)!==path.join(o.probeRoot,'scripts/r16-diagnostics/listening-small/query-cpu-oracle.mjs'))throw Error('cpu_probe_location_invalid');
 return{sources,inline};
}
async function artifactDirectory(o){
 const dir=path.dirname(o.artifact),st=await fs.lstat(dir);
 if(await fs.realpath(dir)!==dir||!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o777)!==0o700)throw Error('cpu_artifact_directory_invalid');
 try{await fs.lstat(o.artifact);throw Error('cpu_artifact_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
}
async function ownedHz(o){
 // Stop BOTH endpoint collections before opening a database or a query window.
 // interval=0 has no interval sampler; stop cancels the existing deadline timer.
 const collector=await startPgCpuProfileV1({targetRoot:o.targetRoot,targetSha:o.targetSha,intervalMs:0,maxDurationMs:30000});
 const receipt=await collector.stop();
 if(!receipt.ownership||receipt.cleanup.status!=='completed'||receipt.snapshots.length!==2||receipt.reason_codes.length)throw Error('cpu_owned_identity_unavailable');
 const snapshots=receipt.snapshots;
 const hz=snapshots[0]?.postgres?.clk_tck;hzValue(hz);
 const postmaster=snapshots[0].postgres.pids.find(p=>p.pid===snapshots[0].postgres.postmaster_pid);
 if(!postmaster||snapshots.some(s=>s.postgres?.clk_tck!==hz||s.postgres.postmaster_pid!==postmaster.pid||
  s.postgres.pids.find(p=>p.pid===postmaster.pid)?.starttime_ticks!==postmaster.starttime_ticks))throw Error('cpu_owned_identity_changed');
 return{clk_tck:hz,ownership:receipt.ownership,collector:receipt.collector,
  scope:'owned_container_getconf_outside_query_windows',interval_ms:0,collector_stopped_before_queries:true,
  snapshots:snapshots.map(s=>({label:s.label,bracket:s.bracket,ownership_binding_sha256:s.ownership_binding_sha256})),
  postmaster:{pid:postmaster.pid,starttime_ticks:postmaster.starttime_ticks}};
}
const IDENTITY_SQL=`SELECT current_user role,r.rolsuper superuser,current_database() database,current_setting('server_version_num')::int version,
 system_identifier::text system_identifier FROM pg_control_system() CROSS JOIN pg_roles r WHERE r.rolname=current_user`;
class CpuUnavailable extends Error{}
function unavailableReason(e){
 if(e instanceof CpuUnavailable)return e.message;
 if(/^cpu_(stat_invalid|pid_mismatch|bracket_invalid|backend_identity_changed|counter_regressed|bracket_overlap|hz_invalid|counter_invalid)$/.test(e?.message??''))return e.message;
 return null;
}
function safeFailure(e){return{reason:unavailableReason(e)??(/^cpu_[a-z_]+$/.test(e?.message??'')?e.message:'native_oracle_failure'),sqlstate:/^[0-9A-Z]{5}$/.test(e?.code??'')?e.code:null};}
async function finishPostchecks(report,checks){
 for(const [phase,check]of [['final_identity',checks.identity],['final_source',checks.source]]){
  try{await check();}catch(e){
   report.status='failed';const failure={phase,...safeFailure(e)};
   if(report.failure){report.secondary_failures.push({...failure,primary_phase:report.failure.phase});}
   else report.failure=failure;
  }
 }
}
export const finishQueryCpuPostchecksForTestV1=finishPostchecks;
function reader(raw,clock,sequence){return async()=>{
 const start=clock();let row;
 try{const result=await raw.query(CPU_READ_SQL_V1);if(result.rows.length!==1)throw new CpuUnavailable('cpu_sample_row_count');row=result.rows[0];}
 catch(e){if(e instanceof CpuUnavailable)throw e;throw new CpuUnavailable(/^[0-9A-Z]{5}$/.test(e?.code??'')?'pg_read_file_sqlstate_'+e.code:'pg_read_file_failed');}
 const end=clock();if(row?.stat==='')throw new CpuUnavailable('proc_stat_empty');
 return parseQueryCpuSampleV1(row,{start_ns:String(start),end_ns:String(end)},sequence.next++);
};}
async function identity(raw,owned){
 const result=await raw.query(IDENTITY_SQL);assert.equal(result.rows.length,1);const row=result.rows[0];
 assert.equal(row.role,'postgres');assert.equal(row.superuser,true);assert.ok(row.version>=170000&&row.version<180000);
 assert.ok(row.database==='noisia_mfp_ci'||/^noisia_mfp_recovery_[0-9a-f]{32}$/.test(row.database));
 assert.equal(sha(row.system_identifier),owned.ownership.postgres_system_identifier_sha256);
 return{role:'postgres',existing_superuser:true,server_major:17,system_identifier_sha256:sha(row.system_identifier),database_kind:row.database==='noisia_mfp_ci'?'owned_ci_base':'native_disposable_clone'};
}
async function preflight(pool,owned,clock,sequence){
 const checks=[];
 try{for(const [isolation,begin]of [['repeatable read read only','BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'],['read committed read write','BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE']]){
  const raw=await pool.connect();try{await raw.query(begin);const pg=await identity(raw,owned),read=reader(raw,clock,sequence);
   try{const a=await read(),b=await read();checks.push({isolation,status:'observed',identity:pg,snapshots:[a,b],cpu:queryCpuDeltaV1(a,b,owned.clk_tck)});}
   catch(e){const reason=unavailableReason(e);if(!reason)throw e;checks.push({isolation,status:'unavailable',reason,cpu:null});}
  }finally{try{await raw.query('ROLLBACK');}finally{raw.release();}}
 }}finally{await pool.end();}return checks;
}
export const runQueryCpuPreflightForTestV1=preflight;
async function afterPreflight(report,action){
 if(report.preflight.length!==2)throw Error('cpu_preflight_incomplete');
 if(report.preflight.some(p=>p.status!=='observed')){
  assert.equal(report.oracles_executed,0);assert.equal(report.oracle_checks_passed,0);report.status='unavailable';
  report.unavailable_reasons=report.preflight.filter(p=>p.status!=='observed').map(p=>p.reason);return;
 }
 await action();assert.equal(report.oracles_executed,6);assert.equal(report.oracle_checks_passed,6);report.status='observed';
}
export const afterQueryCpuPreflightForTestV1=afterPreflight;

async function nativeCohort(o,modules,owned,report,clock,sequence){
 const {fixture,oracle,anchor,workload,exposure}=modules;
 const [sourceA,sourceB]=await oracle.sharedWireSourcesV1();assert.ok(sourceA&&sourceB);
 const sourceC=await fs.readFile(path.join(o.targetRoot,DB,'0331_signal_listening_statement_payload.sql'),'utf8');
 assert.equal(sourceC,oracle.sharedWirePayloadBarrierSourceV1(sourceB));
 const sql=anchor.anchorListeningStatementOracleParametersV1(oracle.sharedWireValidationV1(sourceC));
 report.validation_sql_sha256=sha(sql);
 await fixture.withSharedWireFixtureV1(async whole=>{
  const before=await oracle.assertSharedWireDefaultRuntimeV1(whole.database);assert.equal(before.runtime_kind,'C');report.default_before=before;
  await oracle.withSharedWireDefaultPostcheckV1(async()=>{
   assert.equal(whole.inputs.length,1002);const f={...whole,inputs:whole.inputs.slice(0,1000)},fixed=fixture.sharedWireProposalsV1(f,500);
   assert.equal(fixed.length,1000);assert.ok(f.inputs.every(i=>i.question_keys.length===2&&Object.keys(i.scope_basis).length===2));
   report.cohort={population:whole.inputs.length,calls_per_repetition:fixed.length,repetitions:3,reserved_micro_usd_per_call:500,
    fixed_rows_sha256:sha(JSON.stringify(fixed)),scope:'native_consumer2_nonempty_scope_basis'};
   const snapshot=async raw=>JSON.stringify((await raw.query(SQL.snapshot,[f.run.id])).rows[0].value);
   const caps=async raw=>{const row=(await raw.query(SQL.caps,[f.run.id])).rows[0];assert.ok(row);
    for(const value of [row.run_cap,row.admission_cap,row.action_cap])assert.ok(value===null||BigInt(value)>=506012n);
    return{run_cap:row.run_cap,admission_cap:row.admission_cap,action_cap:row.action_cap};};
   const state=async(raw,readOnly)=>{assert.deepEqual((await raw.query(SQL.transaction)).rows[0],{isolation:readOnly?'repeatable read':'read committed',read_only:readOnly?'on':'off'});return identity(raw,owned);};
   const newDriver=(raw,values)=>createDriver({hz:owned.clk_tck,nowNs:clock,read:reader(raw,clock,sequence),
    validator:async()=>{report.oracles_executed++;return(await raw.query(sql,values)).rows[0];},
    insert:async()=>{report.oracles_executed++;const out=await fixture.insertSharedWireCallsV1(raw,f,fixed);assert.equal(out.rows.length,1000);return out.rows.length;},
    mark:async()=>{await raw.query(SQL.mark,[fixed.map(r=>r.id)]);},constraints:async()=>{await raw.query(SQL.constraints);}});
   await fixture.withSharedWireTxV1(f,async raw=>{
    report.select_identity=await state(raw,true);assert.equal(await exposure.readSignalLabelingRunExposureV1(raw,f.run.id),'6012');
    report.initial_caps=await caps(raw);
    const owner=(await raw.query(SQL.owner,[f.run.id])).rows[0];assert.ok(owner);
    const values=[f.run.id,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,f.inputs.map(i=>i.root_id),owner.configuration_digest,JSON.stringify(fixed)];
    const reference=await oracle.compareSharedWireValidationV1(raw,sourceA,sourceB,values);
    assert.deepEqual(reference.flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});assert.equal(reference.canonical.length,1000);
    report.binds_sha256=sha(JSON.stringify(values));
    const anchorSnapshot=(await raw.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot;
    report.select_snapshot_sha256=sha(anchorSnapshot);
    const driver=newDriver(raw,values);report.controls.push({phase:'select_before',...await driver.control()});
    for(let i=0;i<3;i++){const measured=await driver.selectC();assert.deepEqual(measured.flags,reference.flags);
     report.select.push({repetition:i+1,arm:'C',...measured,result_sha256:sha(JSON.stringify(measured.flags)),validated_calls:fixed.length});report.oracle_checks_passed++;
    }
    report.controls.push({phase:'select_after',...await driver.control()});
    assert.equal((await raw.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot,anchorSnapshot);
    await state(raw,true);
   },true);
   let baseline;for(let i=0;i<3;i++)await fixture.withSharedWireTxV1(f,async raw=>{
    const pg=await state(raw,false),prior=await snapshot(raw);baseline??=prior;assert.equal(prior,baseline);
    await caps(raw);assert.equal(await exposure.readSignalLabelingRunExposureV1(raw,f.run.id),'6012');
    const driver=newDriver(raw,undefined);report.controls.push({phase:`dml_${i+1}_before`,...await driver.control()});
    const measured=await driver.dmlC();
    report.controls.push({phase:`dml_${i+1}_after`,...await driver.control()});
    const rows=(await raw.query(SQL.result,[fixed.map(r=>r.id)])).rows;
    assert.equal(rows.length,1000);assert.ok(rows.every(r=>r.status==='submitting'));
    const actualExposure=await exposure.readSignalLabelingRunExposureV1(raw,f.run.id);assert.equal(actualExposure,'506012');
    report.dml.push({repetition:i+1,arm:'C',identity:pg,...measured,result_count:rows.length,result_sha256:sha(JSON.stringify(rows)),
     exposure_micro_usd:actualExposure,baseline_sha256:sha(prior),constraints_forced_before_rollback:true,committed:false});report.oracle_checks_passed++;
   });
   assert.equal(new Set(report.dml.map(r=>r.result_sha256)).size,1);assert.equal(new Set(report.dml.map(r=>r.baseline_sha256)).size,1);
  },async()=>{const after=await oracle.assertSharedWireDefaultRuntimeV1(whole.database);report.default_after=after;assert.deepEqual(after,before);});
 },workload.r16ListeningWorkloadV2('defined_consumer_second_pass').configuration,{mode:'scaled_recovery',consumer_category:true});
}

function assertArtifactValues(v){
 if(v===null||['string','boolean'].includes(typeof v))return;
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('cpu_artifact_value_invalid');return;}
 if(Array.isArray(v)){for(const x of v)assertArtifactValues(x);return;}
 if(typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)throw Error('cpu_artifact_value_invalid');
 for(const x of Object.values(v))assertArtifactValues(x);
}
export async function writeQueryCpuArtifactForTestV1(file,report,io=fs){
 assertArtifactValues(report);const text=JSON.stringify(report,null,2)+'\n';
 if(Buffer.byteLength(text)>MAX_ARTIFACT_BYTES)throw Error('cpu_artifact_limit');
 const handle=await io.open(file,'wx',0o600);try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
}
// Shared by the actual producer and the envelope consumer's pure fixtures.
// This creates metadata only; it grants no authority and performs no I/O.
export function createQueryCpuBaseReportV1({targetSha,probeSha,sources,inline,owned}){
 return{contract:'r16-native-query-cpu-oracle-v1',status:'running',diagnostic_only:true,target_sha:targetSha,probe_sha:probeSha,
  source6:sources,inline_sql:inline,cpu_read_sql_sha256:sha(CPU_READ_SQL_V1),oracles_executed:0,oracle_checks_passed:0,
  unavailable_reasons:[],h1_accepted:false,gain_claim:false,native46_reexecuted:false,only_installed_C:true,function_replaced:false,
  hz_before:owned,hz_after:null,preflight:[],controls:[],select:[],dml:[],cpu_pure_query:'unknown',worker_cpu:'unknown',
  sql_function_cpu:'unknown',cpu_scope:'leader_backend_brackets_include_probes',control_subtracted:false,
  limits:{artifact_bytes:MAX_ARTIFACT_BYTES,repetitions:3,selected_calls:1000,proc_read_bytes:8192},
  limitations:['CPU snapshots include probe/protocol CPU; controls are observed, never subtracted.',
   'Ticks are quantized; zero increment is not proof of zero CPU.','Leader only; parallel workers and SQL function CPU unknown.',
   'Instrumented wall times are not capacity evidence. No H1 or new Native46 claim.'],failure:null,secondary_failures:[]};
}
async function run(o){
 validateQueryCpuInvocationV1(o,process.env,process.platform);
 const sealed=await checkSources(o);await artifactDirectory(o);
 const load=relative=>import(pathToFileURL(path.join(o.targetRoot,relative)).href);
 const local=await load(`${DB}/signal-r16-local-pg.fixture.ts`);
 // The original entrypoint proves Docker/loopback/server identity and registers
 // this exact Pool. The existing marker writer checks that exact WeakSet entry.
 const pool=await local.openR16CiPostgresV1();let poolTransferred=false,owned;
 try{
  const markerDir=path.join(o.targetRoot,'.data/piloto-masivo/r16/labs/benchmark-pg17');
  const st=await fs.lstat(markerDir);
  if(await fs.realpath(markerDir)!==markerDir||!st.isDirectory()||(st.mode&0o777)!==0o700)throw Error('cpu_marker_directory_invalid');
  const markerModule=await import(pathToFileURL(path.join(o.probeRoot,'scripts/r16-diagnostics/listening-small/run.mts')).href);
  await markerModule.writeProfileOnlyPgOwnershipMarkerV1({targetRoot:o.targetRoot,targetSha:o.targetSha,pool,localPg:local,
   env:process.env,inspectFormat:PG_CPU_INSPECT_FORMAT_V1});
  owned=await ownedHz(o);
 }catch(e){await pool.end();throw e;}
 const report=createQueryCpuBaseReportV1({targetSha:o.targetSha,probeSha:o.probeSha,sources:sealed.sources,inline:sealed.inline,owned});
 let phase='preflight';const clock=()=>process.hrtime.bigint(),sequence={next:0};
 try{
  poolTransferred=true;report.preflight=await preflight(pool,owned,clock,sequence);
  await afterPreflight(report,async()=>{phase='native_C_oracles';const modules={fixture:await load(`${DB}/signal-listening-statement-shared-wire.fixture.ts`),
    oracle:await load(`${DB}/signal-listening-statement-shared-wire.oracle.ts`),anchor:await load(`${DB}/signal-listening-statement-validator.oracle.ts`),
    workload:await load('scripts/r16/listening-workload.ts'),exposure:await load('infrastructure/db/signal-labeling-runs.ts')};
   await nativeCohort(o,modules,owned,report,clock,sequence);
  });
 }catch(e){report.status='failed';report.failure={phase,...safeFailure(e)};}
 finally{if(!poolTransferred)await pool.end();}
 await finishPostchecks(report,{
  identity:async()=>{report.hz_after=await ownedHz(o);assert.equal(report.hz_after.clk_tck,owned.clk_tck);
   assert.deepEqual(report.hz_after.ownership,owned.ownership);assert.deepEqual(report.hz_after.postmaster,owned.postmaster);},
  source:()=>checkSources(o),
 });
 report.coverage={select_repetitions_completed:report.select.length,dml_repetitions_completed:report.dml.length,
  dml_stages_observed:report.dml.reduce((sum,r)=>sum+r.stages.length,0),control_pairs:report.controls.length,proc_reads_observed:sequence.next};
 await artifactDirectory(o);await writeQueryCpuArtifactForTestV1(o.artifact,report);
 if(report.status==='failed')process.exitCode=1;
}
function options(argv){
 if(argv[0]!=='--run'||argv.length!==11)throw Error('cpu_arguments_invalid');const values=new Map();
 for(let i=1;i<argv.length;i+=2){if(!['--target-root','--target-sha','--probe-root','--probe-sha','--artifact'].includes(argv[i])||values.has(argv[i]))throw Error('cpu_arguments_invalid');values.set(argv[i],argv[i+1]);}
 return{targetRoot:values.get('--target-root'),targetSha:values.get('--target-sha'),probeRoot:values.get('--probe-root'),probeSha:values.get('--probe-sha'),artifact:values.get('--artifact')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await run(options(process.argv.slice(2)));}catch(e){process.stderr.write('query_cpu_oracle: '+(/^(cpu_[a-z_]+)$/.test(e?.message??'')?e.message:'guard_or_artifact_failure')+'\n');process.exitCode=1;}
}
