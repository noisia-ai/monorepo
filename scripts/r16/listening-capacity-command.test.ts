import assert from 'node:assert/strict';
import test from 'node:test';
import {assertR16ListeningCapacityLocalEnvironmentV1} from './run-listening-capacity-lab';
const env={NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',R16_LISTENING_QUIET_LAB_CONFIRMED:'true',
 NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',
 DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci',R16BENCH_REDIS_URL:'redis://127.0.0.1:54322'};
test('capacity command only admits an explicit owned quiet loopback lab, never CI or a remote target',()=>{
 assert.doesNotThrow(()=>assertR16ListeningCapacityLocalEnvironmentV1(env));
 for(const change of [{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},{GITHUB_ACTIONS:'true'},
  {R16_LISTENING_QUIET_LAB_CONFIRMED:'false'},{NOISIA_JEV_PROVIDER_ENABLED:undefined},
  {DATABASE_URL:'postgresql://postgres:synthetic@db.example.test/noisia_mfp_ci'},
  {DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/other'},
  {R16BENCH_REDIS_URL:'redis://cache.example.test:6379'}])
  assert.throws(()=>assertR16ListeningCapacityLocalEnvironmentV1({...env,...change}));
});

import {assertR16ListeningCiEnvironmentV1,retainR16ListeningCiFailureV1} from './run-listening-ci';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('CI capacity retains a separate owned-loopback boundary and cannot become a local or remote override',()=>{
 const ci={...env,GITHUB_ACTIONS:'true',NOISIA_R16_NATIVE_FIXTURE_PG:'true'};
 assert.doesNotThrow(()=>assertR16ListeningCiEnvironmentV1(ci));
 for(const change of [{GITHUB_ACTIONS:undefined},{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},
  {NOISIA_R16_NATIVE_FIXTURE_PG:'false'},{NOISIA_SIGNAL_LISTENING_ENABLED:undefined},
  {DATABASE_URL:'postgresql://postgres:synthetic@db.example.test/noisia_mfp_ci'},
  {R16BENCH_REDIS_URL:'redis://cache.example.test:6379'}])
  assert.throws(()=>assertR16ListeningCiEnvironmentV1({...ci,...change}));
 assert.throws(()=>assertR16ListeningCapacityLocalEnvironmentV1(ci),'CI cannot use the local command');
});

// Regression: the real CI catch discarded MAIN failures before measurement.
// The receipt must explain the failing source boundary without retaining secrets.
test('CI failure receipt retains bounded identifiers and source frames while redacting arbitrary error data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-ci-failure-')),repo='/synthetic/repo';
 try{const path=join(directory,'nested','listening-ci-test-failure.json');
  const cause=Object.assign(new Error('postgresql://user:secret@db.example.test/private'),{code:'42703',
   stack:'Error: credential-secret\n    at query ('+repo+'/infrastructure/db/signal-labeling-runs.ts:1091:28)\n    at /outside/private-query.ts:7:4'});
  const error=Object.assign(new Error('labeling_admission_return_invalid'),{name:'LabelingAdmissionFailureV1',code:'ERR_ASSERTION',cause,
   actual:0,expected:32,query:'SELECT private_text',credential:'sk-private-secret',
   stack:'Error: sk-private-secret\n    at work (file://'+repo+'/scripts/r16/run-listening-benchmark.ts:237:9)\n    at '+repo+'/../outside/private.ts:1:2'});
  await assert.rejects(retainR16ListeningCiFailureV1(error,'main',path,repo,{head_sha:'test-head',source_tree_sha256:'test-tree'}),caught=>caught===error);
  const bytes=await readFile(path,'utf8'),receipt=JSON.parse(bytes);
  assert.deepEqual(receipt,{contract_version:'r16-listening-ci-failure-v1',phase:'main',source:{head_sha:'test-head',source_tree_sha256:'test-tree'},
   error:{thrown_type:'object',name:'LabelingAdmissionFailureV1',code:'ERR_ASSERTION',identifier:'labeling_admission_return_invalid',actual:0,expected:32,
    frames:[{path:'scripts/r16/run-listening-benchmark.ts',line:237,column:9}],
    cause:{thrown_type:'object',name:'Error',code:'42703',frames:[{path:'infrastructure/db/signal-labeling-runs.ts',line:1091,column:28}]}}});
  for(const secret of ['postgresql','secret','private_text','SELECT','db.example.test',repo,'/outside/'])assert.equal(bytes.includes(secret),false,secret);
  assert.equal((await stat(path)).mode&0o777,0o600);assert.equal((await stat(join(directory,'nested'))).mode&0o777,0o700);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('CI failure retention preserves null, undefined, opaque thrown values and getter isolation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-ci-failure-'));
 try{let getters=0;const opaque=Object.defineProperties({},{message:{get(){getters++;throw Error('secret getter');}},stack:{get(){getters++;throw Error('secret stack');}}});
  for(const [index,error]of[null,undefined,'private-secret',opaque].entries()){
   const path=join(directory,'failure-'+index+'.json');let rejected=false;
   await retainR16ListeningCiFailureV1(error,'source',path,directory).then(()=>assert.fail('original failure must reject'),caught=>{rejected=true;assert.equal(caught,error);});
   assert.equal(rejected,true);
   assert.deepEqual(JSON.parse(await readFile(path,'utf8')).error,{thrown_type:error===null?'null':typeof error});
  }
  assert.equal(getters,0);
  const cycle=Object.assign(new Error('r16_listening_ci_capacity_rejected'),{cause:null as unknown});cycle.cause=cycle;
  const path=join(directory,'cycle.json');await assert.rejects(retainR16ListeningCiFailureV1(cycle,'gates',path,directory),caught=>caught===cycle);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')).error.cause,{thrown_type:'object',cause_omitted:true});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('CI receipt write failure never overwrites evidence or replaces the original thrown value',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-ci-failure-'));
 try{const path=join(directory,'failure.json');await writeFile(path,'existing evidence',{mode:0o600});
  for(const error of [new Error('r16_listening_ci_capacity_rejected'),null,undefined]){
   let rejected=false;await retainR16ListeningCiFailureV1(error,'measurement',path,directory).then(()=>assert.fail('original failure must reject'),caught=>{rejected=true;assert.equal(caught,error);});
   assert.equal(rejected,true);assert.equal(await readFile(path,'utf8'),'existing evidence');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
