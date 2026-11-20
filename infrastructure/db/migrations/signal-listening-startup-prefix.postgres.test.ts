import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StartupPrefixRecorderV1,captureStartupCallbackV1,closeStartupFactoryV1,writeStartupPrefixEvidenceV1,runListeningStartupPrefixV1,startupErrorTreeV1,startupClientPidV1,assertStartupOwnedAbsentV1,startupOwnPresenceSqlV1,startupOwnSessionsSqlV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';

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
 test('startup error tree preserves nested aggregate order and shared causes without secrets or mutation',()=>{
  const path='infrastructure/db/migrations/signal-mass-labeling-concurrent.synthetic.fixture.ts',leaf=Object.assign(new Error('SECRET SQL password'),{code:'23514'});
  leaf.stack=`SECRET SQL password\nSECRET multiline message\n    at valid (/synthetic/repo/${path}:46:14)\n    at outside (/elsewhere/SECRET.ts:1:2)\n    at sibling (/synthetic/repo/../SECRET.ts:1:2)`;
  const nested=new AggregateError([leaf],'SECRET nested',{cause:leaf}),root=new AggregateError([leaf,nested],'SECRET root',{cause:leaf});
  Object.defineProperty(leaf,'cause',{value:root});const descriptors=[root,nested,leaf].map(error=>Object.getOwnPropertyDescriptors(error));
  const tree=startupErrorTreeV1(root,'/synthetic/repo');assert.equal(tree.nodes.length,3);assert.deepEqual(tree.root,{ref:0});
  assert.deepEqual(tree.nodes[0]!.errors,[{ref:1},{ref:2}]);assert.deepEqual(tree.nodes[1]!.cause,{ref:0});assert.deepEqual(tree.nodes[2]!.cause,{ref:1});
  assert.equal(tree.nodes[1]!.code,'23514');assert.deepEqual(tree.nodes[1]!.frames,[{path,line:46,column:14}]);assert.ok(tree.references>0);
  assert.doesNotMatch(JSON.stringify(tree),/SECRET|password|SELECT|synthetic\/repo/u);assert.deepEqual([root,nested,leaf].map(error=>Object.getOwnPropertyDescriptors(error)),descriptors);
 });
 test('startup error tree bounds nodes, depth, aggregate edges and stack parsing before traversal',()=>{
  const many=new AggregateError(Array.from({length:100},()=>new Error('SECRET')),'SECRET');const tree=startupErrorTreeV1(many);
  assert.equal(tree.nodes.length,16);assert.equal((tree.nodes[0]!.errors as unknown[]).length,16);assert.equal(tree.truncated,true);
  let deep:Error=new Error('SECRET');for(let i=0;i<10;i++)deep=new Error('SECRET',{cause:deep});const depth=startupErrorTreeV1(deep);assert.equal(depth.nodes.length,5);assert.equal(depth.truncated,true);
  const huge=new Error('SECRET');huge.stack='SECRET'.repeat(4000)+'\n    at valid (/synthetic/repo/infrastructure/db/migrations/signal-mass-labeling-concurrent.synthetic.fixture.ts:46:14)';
  const bounded=startupErrorTreeV1(huge,'/synthetic/repo');assert.equal(bounded.truncated,true);assert.deepEqual(bounded.nodes[0]!.frames,[]);
  let edges=0;const indexed=new AggregateError([],'SECRET');const items=new Array(100);for(let i=0;i<100;i++)Object.defineProperty(items,i,{get(){edges++;throw new Error('SECRET');}});
  Object.defineProperty(indexed,'errors',{value:items});const fields=startupErrorTreeV1(indexed);assert.equal(edges,0);assert.equal(fields.truncated,true);assert.equal((fields.nodes[0]!.errors as unknown[]).length,16);
 });
 test('startup error tree rejects poisoned accessors, proxies, arbitrary names and non-errors without throwing',()=>{
  let getters=0;const poison=new AggregateError([],'SECRET');for(const field of ['stack','code','cause','errors','name'])Object.defineProperty(poison,field,{get(){getters++;throw new Error('SECRET');},configurable:true});
  const tree=startupErrorTreeV1(poison);assert.equal(getters,0);assert.equal(tree.truncated,true);assert.equal(tree.nodes[0]!.name,'UNKNOWN');
  for(const field of ['name','message']){const lazy=new Error('SECRET');Object.defineProperty(lazy,field,{get(){getters++;throw new Error('SECRET');}});assert.equal(startupErrorTreeV1(lazy).truncated,true);}assert.equal(getters,0,'lazy V8 stack must not materialize poisoned name/message');
  const inherited=new Error('SECRET');Object.setPrototypeOf(inherited,Object.create(Error.prototype,{name:{get(){getters++;throw new Error('SECRET');}}}));assert.equal(startupErrorTreeV1(inherited).truncated,true);assert.equal(getters,0);
  const proxy=new Proxy(new Error('SECRET'),{getOwnPropertyDescriptor(){throw new Error('SECRET');}});assert.doesNotThrow(()=>startupErrorTreeV1(proxy));assert.equal(startupErrorTreeV1(proxy).truncated,true);
  const revoked=Proxy.revocable(new Error('SECRET'),{});revoked.revoke();assert.doesNotThrow(()=>startupErrorTreeV1(revoked.proxy));
  let traps=0;const cycle:object=new Proxy({},{getPrototypeOf(){traps++;return cycle;}});assert.equal(startupErrorTreeV1(cycle).truncated,true);assert.ok(traps<=8,'prototype classification is bounded too');
  for(const value of ['SECRET',null,{name:'SECRET',stack:'SECRET'},Object.assign(new Error('SECRET'),{name:'SECRET',code:'SECRET'})])assert.doesNotMatch(JSON.stringify(startupErrorTreeV1(value)),/SECRET/u);
 });
 test('startup closure session observation is conditional on exact owned identity and preserves absence failure',async()=>{
  const own={name:'noisia_mfp_recovery_synthetic',oid:'123'},observed:Record<string,unknown>[]=[];
  for(const rows of [[],[{name:own.name,oid:'999',owner_ci:true}],[{name:own.name,oid:own.oid,owner_ci:false}]]){
   let queries=0;const db={async query(sql:string,binds:unknown[]){queries++;assert.equal(sql,startupOwnPresenceSqlV1);assert.deepEqual(binds,[own.name,own.oid]);return{rows};}};
   if(rows.length)await assert.rejects(assertStartupOwnedAbsentV1(db,own,value=>observed.push(value)),{code:'ERR_ASSERTION'});else await assertStartupOwnedAbsentV1(db,own,value=>observed.push(value));assert.equal(queries,1);
  }
  let queries=0;const snapshotError=Object.assign(new Error('SECRET query'),{code:'42703'});
  const db={async query(sql:string,binds:unknown[]){queries++;if(sql===startupOwnPresenceSqlV1)return{rows:[{...own,owner_ci:true}]};assert.equal(sql,startupOwnSessionsSqlV1);assert.deepEqual(binds,[own.oid,own.name]);throw snapshotError;}};
  await assert.rejects(assertStartupOwnedAbsentV1(db,own,value=>observed.push(value)),error=>error!==snapshotError&&(error as {code?:string}).code==='ERR_ASSERTION');
  assert.equal(queries,2);assert.equal(observed.at(-1)!.status,'UNKNOWN');assert.doesNotMatch(JSON.stringify(observed),/SECRET/u);
  await assert.rejects(assertStartupOwnedAbsentV1(db,own,()=>{throw snapshotError;}),error=>error!==snapshotError&&(error as {code?:string}).code==='ERR_ASSERTION');
 });
 test('startup session snapshot limits output and reads known client PIDs without invoking getters',async()=>{
  let getters=0;assert.equal(startupClientPidV1({processID:42}),42);assert.equal(startupClientPidV1({processID:0}),'UNKNOWN');
  const poison=Object.defineProperty({},'processID',{get(){getters++;throw new Error('SECRET');}});assert.equal(startupClientPidV1(poison),'UNKNOWN');assert.equal(getters,0);
  const own={name:'noisia_mfp_recovery_synthetic',oid:'123'};let observed:Record<string,unknown>|undefined;
  const sessions=Array.from({length:16},(_,i)=>({pid:i+1,backend_start:new Date(0),state:'idle',xact_start:null,query:'SECRET',application_name:'SECRET'}));
  const db={async query(sql:string){return{rows:sql===startupOwnPresenceSqlV1?[{...own,owner_ci:true}]:sessions};}};
  await assert.rejects(assertStartupOwnedAbsentV1(db,own,value=>{observed=value;}),{code:'ERR_ASSERTION'});
  assert.equal(observed!.possibly_truncated,true);assert.equal((observed!.sessions as unknown[]).length,16);assert.doesNotMatch(JSON.stringify(observed),/SECRET|application_name|query/u);
 });
}
test('native Listening startup prefix preserves admission and initial census without provider calls',{
 skip:process.env.NOISIA_R16_LISTENING_STARTUP_PREFIX_PG!=='true',
},async()=>{
 assert.notEqual(process.env.NOISIA_R16_LISTENING_STARTUP_PREFIX_PURE,'true','native and pure modes are separate');
 const directory=process.env.R16_LISTENING_STARTUP_PREFIX_EVIDENCE_DIR;assert.ok(directory,'evidence directory required');
 const report=await runListeningStartupPrefixV1(directory);assert.equal(report.status,'observed');
});
