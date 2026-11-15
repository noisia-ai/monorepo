import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {assertColdListeningDiagnosticEnvironmentV1,coldListeningDiagnosticModeV1,extractColdListeningFullArmV1,captureColdDiagnosticInstrumentV1,assertColdDiagnosticInstrumentCleanV1,assertColdDiagnosticInstrumentUnchangedV1,observeColdDiagnosticV1,compareColdDiagnosticObservationsV1} from './cold-listening-plan-diagnostic.mjs';
const env={GITHUB_ACTIONS:'true',NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',NOISIA_R16_NATIVE_FIXTURE_PG:'true',NOISIA_SIGNAL_LISTENING_ENABLED:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/noisia_mfp_ci'};
test('cold-plan command requires separate real CI ownership; environment syntax cannot accredit a Pool',()=>{
 assert.doesNotThrow(()=>assertColdListeningDiagnosticEnvironmentV1(env));
 for(const delta of [{GITHUB_ACTIONS:'false'},{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},
  {NOISIA_R16_NATIVE_FIXTURE_PG:'false'},{NOISIA_SIGNAL_LISTENING_ENABLED:'false'},
  {DATABASE_URL:'postgresql://postgres:synthetic@remote.invalid:5432/noisia_mfp_ci'},
  {DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/preserved_archive'},
  {ANTHROPIC_API_KEY:'synthetic-but-forbidden'},{TYPESAFE_API_KEY:'synthetic-but-forbidden'},{VOYAGE_API_KEY:'synthetic-but-forbidden'}]){
  assert.throws(()=>assertColdListeningDiagnosticEnvironmentV1({...env,...delta}));
 }
});
test('1002 control is explicit and 32768 stops before any full quote or row census',()=>{
 assert.equal(coldListeningDiagnosticModeV1(1002),'controlled_before_after_analyze');
 assert.equal(coldListeningDiagnosticModeV1(32768),'plan_only_before_quote');
 for(const n of [0,3,1000,1003,32769,NaN])assert.throws(()=>coldListeningDiagnosticModeV1(n));
});
test('EXPLAIN extracts the actual full arm and only annotates native parameter types',async()=>{
 const source=await readFile(new URL('../../infrastructure/db/migrations/0315_signal_listening_population_lexical_plan.sql',import.meta.url),'utf8');
 const extract=(value:string)=>value.split('RETURN QUERY EXECUTE $population$')[1]!.split('$population$ USING')[0]!.trim();
 const original=extract(source),typed=extractColdListeningFullArmV1(source).trim();
 // Remove only our added annotations: the SQL body and every predicate remain.
 const positions=[...original.matchAll(/\$([1-6])(?![0-9:]|\s*::)/gu)];let offset=0;let expected=original;
 const types=['uuid','uuid','uuid','text','uuid[]','text'];
 for(const position of positions){const at=position.index!+offset+position[0].length,cast='::'+types[Number(position[1])-1];expected=expected.slice(0,at)+cast+expected.slice(at);offset+=cast.length;}
 assert.equal(typed,expected);assert.ok(typed.includes('$5::uuid[] IS NULL'));assert.ok(!typed.includes('::uuid::uuid'));
 assert.throws(()=>extractColdListeningFullArmV1('SELECT 1'),/full_arm_unrecognized/);
});

test('instrument manifest seals tracked script, test and workflow and rejects untracked or tampered instruments',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-cold-instrument-')),execute=promisify(execFile);
 const git=async(...args:string[])=>execute('git',args,{cwd:directory});
 const files=['scripts/r16-diagnostics/cold-listening-plan-diagnostic.mts','scripts/r16-diagnostics/cold-listening-plan-diagnostic.test.mts','.github/workflows/r16-cold-plan-diagnostic.yml'];
 try{await git('init','-q');
  for(const path of files){await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),'synthetic instrument '+path+'\n');}
  await git('add','--',...files.slice(0,2));await git('-c','user.name=R16 synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic instrument');
  const untracked=await captureColdDiagnosticInstrumentV1(directory);assert.equal(untracked.files[2]!.tracked,false);assert.throws(()=>assertColdDiagnosticInstrumentCleanV1(untracked));
  await git('add','--',files[2]!);await git('-c','user.name=R16 synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic workflow');
  const before=await captureColdDiagnosticInstrumentV1(directory);assertColdDiagnosticInstrumentCleanV1(before);
  assertColdDiagnosticInstrumentUnchangedV1(before,await captureColdDiagnosticInstrumentV1(directory));
  await writeFile(join(directory,files[2]!),'tampered workflow\n');
  const dirty=await captureColdDiagnosticInstrumentV1(directory);assert.notEqual(dirty.files[2]!.sha256,before.files[2]!.sha256);assert.ok(dirty.status.includes(files[2]!));
  assert.throws(()=>assertColdDiagnosticInstrumentUnchangedV1(before,dirty));
  await git('add','--',files[2]!);await git('-c','user.name=R16 synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Changed synthetic workflow');
  const changed=await captureColdDiagnosticInstrumentV1(directory);assertColdDiagnosticInstrumentCleanV1(changed);assert.throws(()=>assertColdDiagnosticInstrumentUnchangedV1(before,changed));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('only SQLSTATE 57014 is censored and subsequent controls remain observable',async()=>{
 const cold=await observeColdDiagnosticV1(async()=>{throw Object.assign(Error('synthetic statement timeout'),{code:'57014'});});
 assert.equal(cold.state,'censored');if(cold.state==='censored'){assert.equal(cold.statement_timeout_ms,15000);assert.ok(!('value'in cold));}
 const warm=await observeColdDiagnosticV1(async()=>({bytes:'123'})),after=await observeColdDiagnosticV1(async()=>({bytes:'123'}));
 assert.deepEqual(compareColdDiagnosticObservationsV1([{label:'cold',observation:cold},{label:'warm',observation:warm},{label:'after',observation:after}]),
  {status:'verified_complete_observations',equal:true,compared_labels:['warm','after'],censored_labels:['cold']});
 assert.deepEqual(compareColdDiagnosticObservationsV1([{label:'before',observation:cold},{label:'after',observation:after}]),
  {status:'unavailable_censored',equal:null,compared_labels:['after'],censored_labels:['before']});
 const different=await observeColdDiagnosticV1(async()=>({bytes:'456'}));assert.throws(()=>compareColdDiagnosticObservationsV1([{label:'warm',observation:warm},{label:'after',observation:different}]));
 for(const code of ['listening_forbidden','listening_policy_changed','23514','XX000']){
  await assert.rejects(observeColdDiagnosticV1(async()=>{throw Object.assign(Error('synthetic fatal error'),{code});}),error=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===code));
 }
 await assert.rejects(observeColdDiagnosticV1(async()=>{throw Error('source changed');}),/source changed/);
});
