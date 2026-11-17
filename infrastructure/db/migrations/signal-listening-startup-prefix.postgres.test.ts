import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StartupPrefixRecorderV1,captureStartupCallbackV1,closeStartupFactoryV1,writeStartupPrefixEvidenceV1,runListeningStartupPrefixV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';

if(process.env.NOISIA_R16_LISTENING_STARTUP_PREFIX_PURE==='true'){
 test('startup recorder preserves pool/client receivers, results and separate checkout waits without payloads',async()=>{
  let now=0,releases=0;const value={rows:[{secret:'not recorded'}]};
  const client={query(...args:unknown[]){assert.equal(this,client);assert.equal(args[1],binds);now+=2;return Promise.resolve(value);},release(){assert.equal(this,client);releases++;}};
  const pool={query(){assert.equal(this,pool);return Promise.resolve(value);},async connect(){assert.equal(this,pool);now+=3;return client;}};
  const binds=['secret bind'],r=new StartupPrefixRecorderV1(()=>now),wrapped=r.wrap(pool);
  await r.measure('prepare',async()=>{assert.equal(await wrapped.query(),value);const a=await wrapped.connect(),b=await wrapped.connect();assert.equal(a,b);assert.equal(await a.query('SELECT $1',binds),value);a.release();});
  const snapshot=r.snapshot();assert.equal(snapshot.seen,2);assert.equal(snapshot.recorded,1);assert.equal(snapshot.dropped,1,'unsupported SQL shape fails observation without altering result');
  assert.equal(snapshot.connect_waits.length,2);assert.ok(snapshot.connect_waits.every(t=>t[4]-t[3]===3));assert.equal(snapshot.queries[0]![1],1);assert.equal(releases,1);
  assert.doesNotMatch(JSON.stringify(snapshot),/secret|SELECT|not recorded/u);
 });
 test('startup recorder records errors once and fails closed on bounded event loss',async()=>{
  let now=0;const primary=new Error('private SQL failure'),r=new StartupPrefixRecorderV1(()=>++now,{queries:1,templates:1,bytes:4096});
  const wrapped=r.wrap({query(_sql:string){return Promise.reject(primary);}});
  await assert.rejects(wrapped.query('SELECT 1'),error=>error===primary);await assert.rejects(wrapped.query('SELECT 2'),error=>error===primary);
  const snapshot=r.snapshot();assert.equal(snapshot.queries.length,1);assert.equal(snapshot.queries[0]![6],0);assert.equal(snapshot.dropped,1);assert.equal(snapshot.pending,0);assert.doesNotMatch(JSON.stringify(snapshot),/private SQL/u);
 });
 test('startup closure requires normal factory return and preserves callback plus cleanup errors',async()=>{
  const primary=new Error('body'),cleanup=new Error('cleanup');let post=0;const state:StartupCallbackStateV1={entered:false,complete:false,failed:false};
  await assert.rejects(closeStartupFactoryV1(state,async()=>{try{await captureStartupCallbackV1(state,async()=>{throw primary;});}finally{throw cleanup;}},async()=>{post++;}),error=>error instanceof AggregateError&&error.cause===primary&&error.errors[0]===primary&&error.errors[1]===cleanup);
  assert.equal(post,1);assert.equal(state.complete,false);
  await assert.rejects(closeStartupFactoryV1({entered:false,complete:false,failed:false},async()=>{},async()=>{}),/normal callback/u);
  await closeStartupFactoryV1({entered:true,complete:true,failed:false},async()=>{},async()=>{});
 });
 test('startup evidence is exclusive, bounded and never overwrites a receipt',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'r16-startup-pure-'));
  try{await assert.rejects(writeStartupPrefixEvidenceV1(dir,{large:'x'.repeat(2*1024*1024)}),/2MiB/u);
   await writeStartupPrefixEvidenceV1(dir,{contract:'test'});const before=await readFile(join(dir,'listening-startup-prefix.json'),'utf8');
   await assert.rejects(writeStartupPrefixEvidenceV1(dir,{contract:'overwrite'}),{code:'EEXIST'});assert.equal(await readFile(join(dir,'listening-startup-prefix.json'),'utf8'),before);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
}
test('native Listening startup prefix preserves admission and initial census without provider calls',{
 skip:process.env.NOISIA_R16_LISTENING_STARTUP_PREFIX_PG!=='true',
},async()=>{
 assert.notEqual(process.env.NOISIA_R16_LISTENING_STARTUP_PREFIX_PURE,'true','native and pure modes are separate');
 const directory=process.env.R16_LISTENING_STARTUP_PREFIX_EVIDENCE_DIR;assert.ok(directory,'evidence directory required');
 const report=await runListeningStartupPrefixV1(directory);assert.equal(report.status,'observed');
});
