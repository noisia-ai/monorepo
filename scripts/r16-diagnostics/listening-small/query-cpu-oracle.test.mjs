import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import { CPU_READ_SQL_V1, TARGET_SHA_V1, SOURCE_DECLARATIONS_V1, parseQueryCpuSampleV1,
  queryCpuDeltaV1, createQueryCpuDriverForTestV1, validateQueryCpuInvocationV1,
  verifyInlineSourcesV1, writeQueryCpuArtifactForTestV1,runQueryCpuPreflightForTestV1,
  afterQueryCpuPreflightForTestV1,finishQueryCpuPostchecksForTestV1 } from './query-cpu-oracle.mjs';

function stat(pid=263,u='100',s='20',start='52607',comm='postgres') {
  const f=Array(24).fill('0');f[0]='S';f[11]=u;f[12]=s;f[19]=start;
  return `${pid} (${comm}) ${f.join(' ')}`;
}
const sample=(u='100',s='20',seq=0)=>parseQueryCpuSampleV1({pid:263,stat:stat(263,u,s)+'\n'},
  {start_ns:String(seq*10),end_ns:String(seq*10+2)},seq);
test('fixed CPU read is bounded and has no wrapper around the native target',()=>{
  assert.equal(CPU_READ_SQL_V1,"SELECT pg_backend_pid() pid,pg_read_file('/proc/self/stat',0,8192,false) stat");
  assert.equal(SOURCE_DECLARATIONS_V1.length,6);
});
test('proc adapter accepts one trailing LF, preserves large counters and excludes raw stat/comm',()=>{
  const p=parseQueryCpuSampleV1({pid:263,stat:stat(263,'9007199254740993','20','52607','a ) b')+'\n'},
    {start_ns:'1',end_ns:'2'},0);
  assert.equal(p.utime_ticks,'9007199254740993');assert.equal(p.starttime_ticks,'52607');
  assert.ok(!JSON.stringify(p).includes('a ) b'));assert.ok(!('stat' in p));
});
for(const [name,value]of [['empty',''],['missing LF',stat()],['double LF',stat()+'\n\n'],['embedded LF',stat().replace(' S ',' S\n')+'\n'],
  ['negative ticks',stat(263,'-1')],['truncated','263 (postgres) S'],['oversized','x'.repeat(8193)],
  ['CRLF',stat()+'\r\n']])test(`proc adapter rejects ${name} without retaining private input`,()=>{
  assert.throws(()=>parseQueryCpuSampleV1({pid:263,stat:value},{start_ns:'1',end_ns:'2'},0),/cpu_stat_invalid/);
});
test('proc adapter requires SQL PID match and valid monotonic read brackets',()=>{
  assert.throws(()=>parseQueryCpuSampleV1({pid:262,stat:stat()+'\n'},{start_ns:'1',end_ns:'2'},0),/cpu_pid_mismatch/);
  assert.throws(()=>parseQueryCpuSampleV1({pid:263,stat:stat()+'\n'},{start_ns:'2',end_ns:'1'},0),/cpu_bracket_invalid/);
});
test('CPU delta uses integer arithmetic, reports leader/probes scope and never subtracts control',()=>{
  const d=queryCpuDeltaV1(sample('9007199254740993','20'),sample('9007199254740996','22',1),'100');
  assert.equal(d.total_ticks,'5');assert.equal(d.total_ns,'50000000');assert.equal(d.user_ticks,'3');
  assert.deepEqual(d.elapsed_ns,{minimum:'8',maximum:'12'});
  assert.equal(d.includes_probes,true);assert.equal(d.worker_cpu,'unknown');assert.equal(d.control_subtracted,false);
});
test('zero increment is tick resolution rather than proof of zero CPU',()=>{
  const d=queryCpuDeltaV1(sample(),sample('100','20',1),'100');
  assert.equal(d.total_ticks,'0');assert.equal(d.zero_interpretation,'no_observed_tick_increment');
  assert.equal(d.tick_resolution_ns,'10000000');
});
for(const [name,mutate,hz]of [
  ['reused PID',s=>({...s,starttime_ticks:'999'}),'100'],['different PID',s=>({...s,pid:264}),'100'],
  ['regression',s=>({...s,utime_ticks:'99'}),'100'],['invalid HZ',s=>s,'0'],
  ['noninteger HZ',s=>s,'100.1'],['overlapping reads',s=>({...s,bracket:{start_ns:'1',end_ns:'12'}}),'100'],
])test(`CPU delta rejects ${name}`,()=>assert.throws(()=>queryCpuDeltaV1(sample(),mutate(sample('101','20',1)),hz),/cpu_/));

function fakeDriver(overrides={}) {
  const calls=[];let seq=0;
  const read=async()=>{calls.push('read');return sample(String(100+seq),'20',seq++);};
  const ops={read,validator:async()=>{calls.push('select');return{invalid_questions:false,invalid_request:false,invalid_prior:false};},
    insert:async()=>{calls.push('insert');return 1000;},mark:async()=>{calls.push('mark');},
    constraints:async()=>{calls.push('constraints');},nowNs:()=>BigInt(seq*10-7),hz:'100',...overrides};
  return{driver:createQueryCpuDriverForTestV1(ops),calls};
}
test('finite driver has no client/query/release/pool escape and SELECT owns exactly two reads',async()=>{
  const {driver,calls}=fakeDriver();assert.deepEqual(Object.keys(driver).sort(),['control','dmlC','selectC']);
  const out=await driver.selectC();assert.deepEqual(calls,['read','select','read']);
  assert.equal(out.cpu.total_ticks,'1');assert.equal(out.snapshots.length,2);
});
test('DML retains INSERT then mark then constraints and four shared boundary snapshots',async()=>{
  const {driver,calls}=fakeDriver();const out=await driver.dmlC();
  assert.deepEqual(calls,['read','insert','read','mark','read','constraints','read']);
  assert.equal(out.snapshots.length,4);assert.equal(out.inserted_count,1000);
  assert.deepEqual(out.stages.map(s=>s.stage),['insert','mark','constraints']);
});
test('control is two real reads with no target and no subtraction',async()=>{
  const {driver,calls}=fakeDriver();const out=await driver.control();
  assert.deepEqual(calls,['read','read']);assert.equal(out.cpu.total_ticks,'1');
});
test('gate claims ownership before its first await and rejects interleaved caller',async()=>{
  let resume;const held=new Promise(r=>{resume=r;});let first=true;
  const f=fakeDriver({nowNs:()=>15n,read:async()=>{f.calls.push('read');if(first){first=false;await held;}return sample('100','20',f.calls.length);}});
  const a=f.driver.selectC();await assert.rejects(f.driver.control(),/cpu_client_busy/);
  assert.deepEqual(f.calls,['read']);resume();await a;
  assert.deepEqual(f.calls,['read','select','read']);
});
test('gate releases after rejection and does not execute a target after failed pre-read',async()=>{
  let fail=true,seq=0;const f=fakeDriver({read:async()=>{if(fail){fail=false;throw Error('cpu_stat_invalid');}return sample('100','20',seq++);}});
  await assert.rejects(f.driver.selectC(),/cpu_stat_invalid/);assert.deepEqual(f.calls,[]);
  assert.equal((await f.driver.control()).cpu.total_ticks,'0');
});
test('native target failure propagates, does not fabricate after-counter or CPU zero',async()=>{
  const f=fakeDriver({insert:async()=>{throw Object.assign(Error('private SQL'),{code:'23514'});}});
  await assert.rejects(f.driver.dmlC(),e=>e.code==='23514');assert.deepEqual(f.calls,['read']);
});
test('target wall bracket must lie between its actual snapshot read brackets',async()=>{
  const {driver}=fakeDriver({nowNs:()=>1n});await assert.rejects(driver.selectC(),/cpu_target_bracket_invalid/);
});

function preflightPool(readResponse,identityPatch={}) {
  const calls=[];const raw={query:async sql=>{calls.push(sql);
    if(sql===CPU_READ_SQL_V1)return await readResponse();
    if(sql.startsWith('SELECT current_user'))return{rows:[{role:'postgres',superuser:true,database:'noisia_mfp_ci',version:170005,system_identifier:'7400000000000000001',...identityPatch}]};
    return{rows:[]};},release:()=>calls.push('release')};
  return{pool:{connect:async()=>raw,end:async()=>calls.push('end')},raw,calls};
}
const owned={clk_tck:'100',ownership:{postgres_system_identifier_sha256:createHash('sha256').update('7400000000000000001').digest('hex')}};
for(const [name,response,reason]of [
 ['permission denied',async()=>{throw Object.assign(Error('private pg file path'),{code:'42501'});},'pg_read_file_sqlstate_42501'],
 ['proc missing',async()=>{throw Object.assign(Error('private pg file path'),{code:'58P01'});},'pg_read_file_sqlstate_58P01'],
 ['empty proc',async()=>({rows:[{pid:263,stat:''}]}),'proc_stat_empty'],
 ['truncated proc',async()=>({rows:[{pid:263,stat:stat()}]}),'cpu_stat_invalid'],
])test(`preflight ${name} attempts both isolations then skips all native cohorts with a real reason`,async()=>{
  const f=preflightPool(response);let clock=0n;
  const checks=await runQueryCpuPreflightForTestV1(f.pool,owned,()=>clock++,{next:0});
  assert.equal(checks.length,2);assert.ok(checks.every(c=>c.status==='unavailable'&&c.reason===reason&&c.cpu===null));
  assert.equal(f.calls.filter(c=>c==='ROLLBACK').length,2);assert.equal(f.calls.filter(c=>c==='release').length,2);assert.equal(f.calls.at(-1),'end');
  const report={preflight:checks,oracles_executed:0,oracle_checks_passed:0};let ran=false;
  await afterQueryCpuPreflightForTestV1(report,async()=>{ran=true;});
  assert.equal(ran,false);assert.equal(report.status,'unavailable');assert.equal(report.oracles_executed,0);
  assert.ok(!JSON.stringify(report).includes('private'));
});
test('healthy preflight reads exactly two snapshots in each native isolation and closes the genuine client',async()=>{
  let ticks=100,clock=0n;const f=preflightPool(async()=>({rows:[{pid:263,stat:stat(263,String(ticks++))+'\n'}]}));
  const checks=await runQueryCpuPreflightForTestV1(f.pool,owned,()=>clock++,{next:0});
  assert.ok(checks.every(c=>c.status==='observed'&&c.cpu.total_ticks==='1'));assert.equal(f.calls.filter(c=>c===CPU_READ_SQL_V1).length,4);
  assert.equal(f.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.ok(f.calls.includes('BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE'));
  assert.equal(f.calls.at(-1),'end');
});
test('preflight cannot broaden a role or recover from native identity failure',async()=>{
  const f=preflightPool(async()=>{throw Error('must not read proc');},{superuser:false});let clock=0n;
  await assert.rejects(runQueryCpuPreflightForTestV1(f.pool,owned,()=>clock++,{next:0}));
  assert.equal(f.calls.includes(CPU_READ_SQL_V1),false);assert.equal(f.calls.at(-1),'end');
});
test('incomplete preflight and missing native checks fail closed rather than become observed',async()=>{
  await assert.rejects(afterQueryCpuPreflightForTestV1({preflight:[],oracles_executed:0,oracle_checks_passed:0},async()=>{}),/cpu_preflight_incomplete/);
  const report={preflight:[{status:'observed'},{status:'observed'}],oracles_executed:6,oracle_checks_passed:5};
  await assert.rejects(afterQueryCpuPreflightForTestV1(report,async()=>{}));assert.notEqual(report.status,'observed');
});
for(const [phase,sqlstate]of [['native_C_oracles','23514'],['preflight','08006']])
test(`${phase} failure survives a later owned-inspect failure and final source still gets checked`,async()=>{
  const primary={phase,reason:'native_oracle_failure',sqlstate};
  const report={status:'failed',failure:primary,secondary_failures:[]};let sourceChecked=false;
  await finishQueryCpuPostchecksForTestV1(report,{
    identity:async()=>{throw Error('cpu_owned_identity_unavailable');},
    source:async()=>{sourceChecked=true;},
  });
  assert.equal(report.status,'failed');assert.equal(report.failure,primary);assert.equal(sourceChecked,true);
  assert.deepEqual(report.secondary_failures,[{phase:'final_identity',reason:'cpu_owned_identity_unavailable',sqlstate:null,primary_phase:phase}]);
});
test('multiple failed postchecks retain the first failure and record the later source cause',async()=>{
  const report={status:'observed',failure:null,secondary_failures:[]};
  await finishQueryCpuPostchecksForTestV1(report,{
    identity:async()=>{throw Error('cpu_owned_identity_changed');},source:async()=>{throw Error('cpu_source_hash_mismatch');},
  });
  assert.equal(report.status,'failed');assert.equal(report.failure.phase,'final_identity');
  assert.deepEqual(report.secondary_failures,[{phase:'final_source',reason:'cpu_source_hash_mismatch',sqlstate:null,primary_phase:'final_identity'}]);
});
test('a source-only postcheck failure turns an otherwise observed run into failed',async()=>{
  const report={status:'observed',failure:null,secondary_failures:[]};
  await finishQueryCpuPostchecksForTestV1(report,{identity:async()=>{},source:async()=>{throw Error('cpu_source_identity_invalid');}});
  assert.equal(report.status,'failed');assert.deepEqual(report.failure,{phase:'final_source',reason:'cpu_source_identity_invalid',sqlstate:null});
  assert.deepEqual(report.secondary_failures,[]);
});
test('successful postchecks preserve the existing result without replay or repair',async()=>{
  const calls=[],report={status:'unavailable',failure:null,secondary_failures:[]};
  await finishQueryCpuPostchecksForTestV1(report,{identity:async()=>{calls.push('identity');},source:async()=>{calls.push('source');}});
  assert.equal(report.status,'unavailable');assert.equal(report.failure,null);assert.deepEqual(report.secondary_failures,[]);
  assert.deepEqual(calls,['identity','source']);
});

const opts={targetRoot:'/workspace/target',targetSha:TARGET_SHA_V1,probeRoot:'/workspace/probe',
  probeSha:'1'.repeat(40),artifact:'/tmp/runner/query/query-cpu.json'};
const env={GITHUB_ACTIONS:'true',CI:'true',RUNNER_OS:'Linux',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'query-cpu',GITHUB_WORKSPACE:'/workspace',RUNNER_TEMP:'/tmp/runner',
  NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17'};
test('invocation requires actual manual Linux CI and exact b95 target before side effects',()=>{
  assert.doesNotThrow(()=>validateQueryCpuInvocationV1(opts,env,'linux'));
  for(const patch of [{GITHUB_EVENT_NAME:'push'},{GITHUB_ACTIONS:'false'},{CI:'false'},{RUNNER_OS:'macOS'},
    {NOISIA_R16_LOCAL_PG_LAB:'other'},{GITHUB_WORKSPACE:undefined},{RUNNER_TEMP:undefined}])
    assert.throws(()=>validateQueryCpuInvocationV1(opts,{...env,...patch},'linux'),/cpu_invocation_invalid/);
  assert.throws(()=>validateQueryCpuInvocationV1({...opts,targetSha:'2'.repeat(40)},env,'linux'),/cpu_invocation_invalid/);
  assert.throws(()=>validateQueryCpuInvocationV1(opts,env,'darwin'),/cpu_invocation_invalid/);
});
test('invocation rejects path traversal, same checkout, unsafe artifact and provider credentials',()=>{
  for(const patch of [{targetRoot:'/workspace/probe'},{probeRoot:'/workspace/../probe'},
    {artifact:'/workspace/query-cpu.json'},{artifact:'/tmp/runner/query/other.json'}])
    assert.throws(()=>validateQueryCpuInvocationV1({...opts,...patch},env,'linux'),/cpu_invocation_invalid/);
  assert.throws(()=>validateQueryCpuInvocationV1(opts,{...env,ANTHROPIC_API_KEY:'private'},'linux'),/cpu_provider_credentials_forbidden/);
});
test('inline source declaration refuses even harmless changes to the exact target literals',()=>{
  assert.throws(()=>verifyInlineSourcesV1('different target oracle'),/cpu_inline_source_mismatch/);
});
test('artifact writer uses no-overwrite 0600, bounds bytes, fsyncs and never serializes Error details',async()=>{
  const calls=[];const fs={open:async(...args)=>{calls.push(args);return{writeFile:async s=>calls.push(s),sync:async()=>calls.push('sync'),close:async()=>calls.push('close')};}};
  await writeQueryCpuArtifactForTestV1('/tmp/query-cpu.json',{status:'unavailable',cpu:null},fs);
  assert.deepEqual(calls[0],['/tmp/query-cpu.json','wx',0o600]);assert.ok(calls.includes('sync'));assert.equal(calls.at(-1),'close');
  await assert.rejects(writeQueryCpuArtifactForTestV1('/tmp/query-cpu.json',{bad:'x'.repeat(2*1024*1024)},fs),/cpu_artifact_limit/);
  await assert.rejects(writeQueryCpuArtifactForTestV1('/tmp/query-cpu.json',{error:Error('private')},fs),/cpu_artifact_value_invalid/);
});
