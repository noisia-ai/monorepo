import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool,PoolClient} from 'pg';
import test from 'node:test';
import {
  assertListeningWriteStructureV1,
  classifyListeningWriteV1,
  createListeningWriteFunctionObserverV1,
  extractListeningWriteTemplatesV1,
  listeningWriteBatchV1,
  writeFunctionFailureReasonV1,
  writeFunctionDeltasV1,
  writeFunctionSampleTypeV1,
  type ListeningWriteTemplatesV1,
  type WriteFunctionCounterV1,
} from './signal-listening-write-functions.synthetic.fixture';

const pure=process.env.NOISIA_R16_LISTENING_WRITE_FUNCTIONS_PURE==='true';
const uuid=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;

async function productTemplates():Promise<ListeningWriteTemplatesV1>{
 const [labeling,listening]=await Promise.all([
  readFile(new URL('../signal-labeling-runs.ts',import.meta.url),'utf8'),
  readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),
 ]);
 return extractListeningWriteTemplatesV1({labeling,listening});
}

function counter(calls:number,overrides:Partial<WriteFunctionCounterV1>={}):WriteFunctionCounterV1{
 return{oid:'9001',name:'synthetic_write_function',calls,total_time:calls*2,self_time:calls,
  language:'plpgsql',volatility:'v',security_definer:false,proconfig_sha256:'a'.repeat(64),
  prosrc_sha256:'b'.repeat(64),signature_sha256:'c'.repeat(64),...overrides};
}

function nativeMock(templates:ListeningWriteTemplatesV1,args:{baseline?:boolean;emptyCounters?:boolean;rollbackFails?:boolean;releaseFails?:boolean;catalogChanges?:boolean;restoreFails?:boolean;unknownCatalogNameAfter?:string;overCapAfter?:boolean;failure?:{phase:string;value:unknown}}={}){
 let tracked:'none'|'pl'|'all'='none',calls=0,counterReads=0,releases=0;const releaseArgs:Array<unknown>=[];
 const identity={backend:'4242',database:'synthetic_db',invoker:'synthetic_role',session_role:'synthetic_role',
  isolation:'read committed',read_only:'off',search_path:'public',transaction_started:'2030-01-01T00:00:00Z',
  backend_transaction_started:'2030-01-01T00:00:00Z'};
 const resultRefs=new Map<string,{rows:Record<string,unknown>[];rowCount:number|null}>();
 const client={
  query:async(...values:unknown[])=>{
   const sql=values[0];
   if(typeof sql!=='string')return{rows:[],rowCount:0};
   if(sql.startsWith('SELECT pg_backend_pid()'))return{rows:[{...identity,track_functions:tracked}],rowCount:1};
   if(sql.startsWith('SELECT s.funcid::text oid')){
    counterReads++;
    if(args.emptyCounters)return{rows:[],rowCount:0};
    if(args.baseline===false&&counterReads%2===1)return{rows:[],rowCount:0};
    if(args.overCapAfter&&counterReads%2===0)return{rows:Array.from({length:65},(_,index)=>({oid:String(index+1)})),rowCount:65};
    const c=counter(calls);
    const row=(oid:string,name:string)=>({oid,name,calls:c.calls,total_time:c.total_time,self_time:c.self_time,
     language:c.language,volatility:c.volatility,security_definer:c.security_definer,proconfig:null,
     prosrc:args.catalogChanges&&counterReads%2===0?'changed synthetic function body':'synthetic function body',
     signature:'synthetic_write_function()'});
    if(args.unknownCatalogNameAfter&&counterReads%2===0)return{rows:[row(c.oid,c.name),row('9002',args.unknownCatalogNameAfter)],rowCount:2};
    return{rows:[row(c.oid,c.name)],rowCount:1};
   }
   if(sql==="SET LOCAL track_functions='all'"){tracked='all';return{rows:[],rowCount:null};}
   if(sql==="SET LOCAL track_functions='none'"){if(!args.restoreFails)tracked='none';return{rows:[],rowCount:null};}
   if(sql==='ROLLBACK'){if(args.rollbackFails)throw new Error('SECONDARY_PRIVATE_ROLLBACK');tracked='none';return{rows:[],rowCount:null};}
   const phase=classifyListeningWriteV1(sql,templates);
   if(phase){if(args.failure?.phase===phase)throw args.failure.value;calls++;const result={rows:[{synthetic_result:true}],rowCount:2};resultRefs.set(phase,result);return result;}
   return{rows:[],rowCount:null};
  },
  release:(destroy?:Error|boolean)=>{releases++;releaseArgs.push(destroy);if(args.releaseFails)throw new Error('SECONDARY_PRIVATE_RELEASE');},
 } as unknown as PoolClient;
 const database={connect:async()=>client,query:async()=>({rows:[],rowCount:0})} as unknown as Pool;
 return{database,client,resultRefs,releaseArgs,get releases(){return releases;}};
}

function batches(templates:ListeningWriteTemplatesV1){
 const roots=[uuid(1),uuid(2)];
 const reserve=Array(8).fill(null) as unknown[];reserve[5]=JSON.stringify(roots.map(root=>({inputs:[{root_id:root}]})));
 const mark=[uuid(10),[uuid(20),uuid(21)]];
 const apply=Array(4).fill(null) as unknown[];apply[3]=JSON.stringify(roots.map(root=>({root_id:root})));
 return{roots,reserve,mark,apply};
}

if(pure){
 test('write templates identify only the three original product statements',async()=>{
  const templates=await productTemplates();
  assert.equal(classifyListeningWriteV1(templates.reserve,templates),'reserve');
  assert.equal(classifyListeningWriteV1(templates.mark,templates),'mark');
  assert.equal(classifyListeningWriteV1(templates.apply,templates),'apply');
  assert.equal(classifyListeningWriteV1(`${templates.apply} `,templates),null);
  assert.equal(classifyListeningWriteV1({toString:()=>templates.mark},templates),null);
  assert.throws(()=>extractListeningWriteTemplatesV1({labeling:'',listening:''}),/write_functions_source_templates/);
 });

 test('write batch summaries count proposals and distinct roots without returning synthetic IDs',async()=>{
  const templates=await productTemplates(),batch=batches(templates);
  const reserve=listeningWriteBatchV1('reserve',batch.reserve,()=>{throw new Error('unused');});
  const mark=listeningWriteBatchV1('mark',batch.mark,ids=>ids.map((_,index)=>batch.roots[index]!));
  const apply=listeningWriteBatchV1('apply',batch.apply,()=>{throw new Error('unused');});
  assert.deepEqual(reserve,{proposed_rows:2,batch_roots:2,bind_count:8});
  assert.deepEqual(mark,{proposed_rows:2,batch_roots:2,bind_count:2});
  assert.deepEqual(apply,{proposed_rows:2,batch_roots:2,bind_count:4});
  const serialized=JSON.stringify([reserve,mark,apply]);
  for(const value of [...batch.roots,uuid(10),uuid(20),uuid(21)])assert.equal(serialized.includes(value),false);
  const duplicate=listeningWriteBatchV1('apply',(()=>{const v=Array(4).fill(null);v[3]=JSON.stringify([{root_id:batch.roots[0]},{root_id:batch.roots[0]}]);return v;})(),()=>[]);
  assert.equal(duplicate.batch_roots,1);
  const oversized=Array(4).fill(null);oversized[3]=JSON.stringify(Array.from({length:513},(_,index)=>({root_id:uuid(index+100)})));
  assert.throws(()=>listeningWriteBatchV1('apply',oversized,()=>[]),/write_functions_bind_rows/);
  assert.throws(()=>listeningWriteBatchV1('mark',[uuid(10),Array(513).fill(uuid(20))],()=>[]),/write_functions_mark_ids/);
 });

 test('function counters never impute absent baselines or after samples as zero',()=>{
  const before=[counter(2)],after=[counter(5)];
  assert.deepEqual(writeFunctionDeltasV1(before,after),[{oid:'9001',status:'known',calls:3,total_time:6,self_time:3}]);
  const newFunction=writeFunctionDeltasV1([],after)[0]!;
  assert.equal(newFunction.status,'UNKNOWN');assert.equal(newFunction.reason,'baseline_absent');
  assert.equal(newFunction.newly_created_between_samples,true);assert.equal(newFunction.calls,'UNKNOWN');
  assert.deepEqual(newFunction.raw_after,{calls:5,total_time:10,self_time:5});
  const absentAfter=writeFunctionDeltasV1(before,[])[0]!;
  assert.equal(absentAfter.status,'UNKNOWN');assert.equal(absentAfter.reason,'after_absent');
  assert.equal(absentAfter.calls,'UNKNOWN');assert.equal(absentAfter.raw_after,null);
  const overFunctionCap=Array.from({length:65},(_,index)=>counter(index+1,{oid:String(index+1)}));
  assert.throws(()=>writeFunctionDeltasV1(overFunctionCap,[]),/write_functions_counter_cap/);
  assert.throws(()=>writeFunctionDeltasV1(before,[counter(3,{prosrc_sha256:'d'.repeat(64)})]),/write_functions_catalog_changed/);
  assert.throws(()=>writeFunctionDeltasV1(before,[counter(1)]),/write_functions_counter_decreased/);
 });

 test('observer preserves the original query result and records reserve, mark, apply and native commit exactly once',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates);
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const originalQuery=mock.client.query,originalRelease=mock.client.release;
  const client=await observer.database.connect();
  await client.query('BEGIN');
  const reserveResult=await client.query(templates.reserve,batch.reserve);
  const markResult=await client.query(templates.mark,batch.mark);
  const applyResult=await client.query(templates.apply,batch.apply);
  await client.query('COMMIT');
  assert.equal(reserveResult,mock.resultRefs.get('reserve'));
  assert.equal(markResult,mock.resultRefs.get('mark'));
  assert.equal(applyResult,mock.resultRefs.get('apply'));
  const beforeRelease=observer.snapshot();
  assert.equal(beforeRelease.closed,false);
  assert.equal(beforeRelease.status,'INCONCLUSIVE');
  assert.deepEqual(beforeRelease.gates,{three_original_statements:true,native_commit_ack:true,
   identity_and_settings_restored:true,counters_known:true,no_recording_loss:true});
  assert.equal(beforeRelease.captures.length,3);
  for(const [index,phase] of (['reserve','mark','apply'] as const).entries()){
   const capture=beforeRelease.captures[index]!;
   assert.equal(capture.phase,phase);assert.equal(capture.stage,'committed');
   assert.equal(capture.original_executions,1);assert.equal(capture.original_succeeded,true);
   assert.equal(capture.native_commit_ack,true);assert.equal(capture.identity_same,true);
   assert.equal(capture.settings_restored,true);assert.equal(capture.result_reference_preserved,true);
   assert.equal(capture.proposed_rows,2);assert.equal(capture.batch_roots,2);
   assert.equal(capture.row_count,2);assert.equal(capture.bind_count,phase==='reserve'?8:phase==='mark'?2:4);
   assert.equal(typeof capture.elapsed_dml_ms,'number');
  }
  const safe=JSON.stringify(beforeRelease);
  for(const value of [...batch.roots,uuid(10),uuid(20),uuid(21),templates.reserve,templates.mark,templates.apply])
   assert.equal(safe.includes(value),false);
  await client.release();assert.equal(mock.releases,1);
  assert.equal(mock.client.query,originalQuery);assert.equal(mock.client.release,originalRelease);
  observer.close();const closed=observer.snapshot();assert.equal(closed.closed,true);
  assertListeningWriteStructureV1(closed);
  const mutated=()=>JSON.parse(JSON.stringify(closed)) as {captures:Array<Record<string,unknown>>;gates:Record<string,boolean>;status:string};
  const noCaptures=mutated();noCaptures.captures=[];assert.throws(()=>assertListeningWriteStructureV1(noCaptures),/write_functions_structure_capture_count/);
  const twoCaptures=mutated();twoCaptures.captures=twoCaptures.captures.slice(0,2);assert.throws(()=>assertListeningWriteStructureV1(twoCaptures),/write_functions_structure_capture_count/);
  const duplicate=mutated();duplicate.captures[2]!.phase='reserve';assert.throws(()=>assertListeningWriteStructureV1(duplicate),/write_functions_structure_phases/);
  const emptyDeltaInconsistent=mutated();emptyDeltaInconsistent.captures[0]!.deltas=[];
  assert.throws(()=>assertListeningWriteStructureV1(emptyDeltaInconsistent),/write_functions_structure_missing_deltas/);
  const rolledBack=mutated();rolledBack.captures[0]!.transaction_rolled_back=true;assert.throws(()=>assertListeningWriteStructureV1(rolledBack),/write_functions_structure_failure/);
  const unrestored=mutated();unrestored.captures[0]!.settings_restored=false;assert.throws(()=>assertListeningWriteStructureV1(unrestored),/write_functions_structure_write/);
  const overCapture=mutated();overCapture.captures[0]!.padding='x'.repeat(128*1024);
  assert.throws(()=>assertListeningWriteStructureV1(overCapture),/write_functions_structure_/);
  const overJson=mutated() as unknown as Record<string,unknown>;overJson.padding='x'.repeat(2*1024*1024);
  assert.throws(()=>assertListeningWriteStructureV1(overJson),/write_functions_structure_/);
 });

 test('observer preserves the primary write failure and records a failed rollback without claiming commit',async()=>{
  const templates=await productTemplates(),batch=batches(templates),primary=new Error('PRIMARY_PRIVATE_WRITE');
  const mock=nativeMock(templates,{rollbackFails:true,failure:{phase:'reserve',value:primary}});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  let caught:unknown;try{await client.query(templates.reserve,batch.reserve);}catch(error){caught=error;}
  assert.equal(caught,primary);
  let rollbackError:unknown;try{await client.query('ROLLBACK');}catch(error){rollbackError=error;}
  assert.ok(rollbackError instanceof AggregateError);
  assert.equal((rollbackError as AggregateError).errors[0],primary);
  assert.equal(observer.snapshot().gates.native_commit_ack,false);
  await client.release(true);observer.close();
  const receipt=observer.snapshot();
  assert.equal(receipt.status,'failed');assert.equal(receipt.captures.length,1);
  assert.equal(receipt.captures[0]!.native_commit_ack,false);
  assert.equal(receipt.captures[0]!.rollback_reset_confirmed,false);
  const safe=JSON.stringify(receipt);
  assert.equal(safe.includes('PRIMARY_PRIVATE_WRITE'),false);
  assert.equal(safe.includes('SECONDARY_PRIVATE_ROLLBACK'),false);
 });

 test('write observer accepts only statistics-limited INCONCLUSIVE after complete committed captures',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates,{baseline:false});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await client.query(templates.reserve,batch.reserve);await client.query(templates.mark,batch.mark);
  await client.query(templates.apply,batch.apply);await client.query('COMMIT');await client.release();observer.close();
  const receipt=observer.snapshot();assert.equal(receipt.status,'INCONCLUSIVE');
  assert.equal(receipt.gates.three_original_statements,true);assert.equal(receipt.gates.native_commit_ack,true);
  assert.equal(receipt.gates.identity_and_settings_restored,true);assert.equal(receipt.gates.counters_known,false);
  assertListeningWriteStructureV1(receipt);
 });

 test('empty function-counter samples remain explicitly inconclusive but cannot hide missing deltas',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates,{emptyCounters:true});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await client.query(templates.reserve,batch.reserve);await client.query(templates.mark,batch.mark);
  await client.query(templates.apply,batch.apply);await client.query('COMMIT');await client.release();observer.close();
  const receipt=observer.snapshot();assert.equal(receipt.status,'INCONCLUSIVE');
  for(const capture of receipt.captures){assert.deepEqual(capture.before,[]);assert.deepEqual(capture.after,[]);assert.deepEqual(capture.deltas,[]);}
  assertListeningWriteStructureV1(receipt);
 });

 test('observer rejects catalog mutation without exposing source text or IDs',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates,{catalogChanges:true});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await assert.rejects(client.query(templates.reserve,batch.reserve),/write_functions_catalog_changed/);
  await client.query('ROLLBACK');await client.release();observer.close();
  const receipt=observer.snapshot();assert.equal(receipt.status,'failed');assert.equal(receipt.captures[0]!.failure_stage,'after');
  const safe=JSON.stringify(receipt);assert.equal(safe.includes('synthetic function body'),false);
  for(const root of batch.roots)assert.equal(safe.includes(root),false);
  assert.throws(()=>assertListeningWriteStructureV1(receipt),/write_functions_structure_/);
 });

 test('observer records failed setting restoration and requires transaction rollback',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates,{restoreFails:true});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await assert.rejects(client.query(templates.reserve,batch.reserve),/write_functions_identity_or_setting_changed/);
  assert.equal(observer.snapshot().captures[0]!.settings_restored,false);
  await client.query('ROLLBACK');await client.release(true);observer.close();
  const receipt=observer.snapshot();assert.equal(receipt.status,'failed');
  assert.equal(receipt.captures[0]!.native_commit_ack,false);assert.equal(receipt.captures[0]!.transaction_rolled_back,true);
  assert.throws(()=>assertListeningWriteStructureV1(receipt),/write_functions_structure_/);
 });

 test('observer preserves a falsy primary through rollback and release failures',async()=>{
  const templates=await productTemplates(),batch=batches(templates);
  const mock=nativeMock(templates,{failure:{phase:'reserve',value:null},rollbackFails:true,releaseFails:true});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  let caught:unknown,wasCaught=false;try{await client.query(templates.reserve,batch.reserve);}catch(error){caught=error;wasCaught=true;}
  assert.equal(wasCaught,true);assert.equal(caught,null);
  let aggregate:unknown;try{await client.query('ROLLBACK');}catch(error){aggregate=error;}
  assert.ok(aggregate instanceof AggregateError);assert.equal((aggregate as AggregateError).errors[0],null);
  let releaseError:unknown;try{await client.release();}catch(error){releaseError=error;}
  assert.ok(releaseError instanceof AggregateError);assert.equal((releaseError as AggregateError).errors[0],null);
  assert.equal(mock.releases,1);assert.equal(mock.releaseArgs[0],true);
  observer.close();
  const safe=JSON.stringify(observer.snapshot());assert.equal(safe.includes('SECONDARY_PRIVATE_ROLLBACK'),false);
  assert.equal(safe.includes('SECONDARY_PRIVATE_RELEASE'),false);
 });

 test('failed client-wrapper installation restores and releases once while preserving a falsy primary',async()=>{
  const templates=await productTemplates();let releaseCalls=0,releaseArgument:unknown;
  const target={query:async()=>({rows:[],rowCount:0}),release:function(destroy?:Error|boolean){releaseCalls++;releaseArgument=destroy;throw new Error('INSTALL_CLEANUP_PRIVATE');}};
  const client=new Proxy(target,{defineProperty(object,key,descriptor){if(key==='query')throw null;return Reflect.defineProperty(object,key,descriptor);}});
  const database={connect:async()=>client as unknown as PoolClient,query:async()=>({rows:[],rowCount:0})} as unknown as Pool;
  const observer=createListeningWriteFunctionObserverV1({database,eligible:()=>true,templates,known_function_names:['synthetic_write_function'],roots_for_mark:()=>[]});
  let caught:unknown,wasCaught=false;try{await observer.database.connect();}catch(error){caught=error;wasCaught=true;}
  assert.equal(wasCaught,true);assert.ok(caught instanceof AggregateError);
  assert.equal((caught as AggregateError).errors[0],null);assert.equal((caught as AggregateError).cause,null);
  assert.equal(releaseCalls,1);assert.equal(releaseArgument,true);
  observer.close();
 });

 test('failure reasons expose only locally registered codes and classify arbitrary samples without values',()=>{
  let local:unknown;try{writeFunctionDeltasV1([counter(2)],[counter(-1)]);}catch(error){local=error;}
  assert.equal(writeFunctionFailureReasonV1(local),'write_functions_counter_invalid');
  const privateMessage='PRIVATE_DATABASE_FUNCTION_NAME';let messageReads=0;
  const external=Object.defineProperty(new Error('private'), 'message',{get(){messageReads++;return privateMessage;}});
  assert.equal(writeFunctionFailureReasonV1(external),'UNKNOWN');assert.equal(messageReads,0);
  assert.equal(writeFunctionFailureReasonV1(null),'UNKNOWN');
  const cases:Array<[unknown,string]>=[
   [null,'null'],[undefined,'undefined'],[privateMessage,'string'],[true,'boolean'],[1n,'bigint'],
   [Symbol(privateMessage),'symbol'],[()=>undefined,'function'],[[],'array'],[{},'object'],[0,'number_safe_integer_nonnegative'],
   [Number.MAX_SAFE_INTEGER+1,'number_unsafe_integer_nonnegative'],[0.5,'number_fraction_nonnegative'],[-1,'number_negative'],[NaN,'number_nonfinite'],[Infinity,'number_nonfinite'],
  ];
  for(const [value,kind] of cases)assert.equal(writeFunctionSampleTypeV1(value),kind);
  let proxyReads=0;const proxyArray=new Proxy([],{get(){proxyReads++;throw new Error(privateMessage);}});
  assert.equal(writeFunctionSampleTypeV1(proxyArray),'array');assert.equal(proxyReads,0);
  const receipt=JSON.stringify({reason:writeFunctionFailureReasonV1(external),sample_type:writeFunctionSampleTypeV1(privateMessage)});
  assert.equal(receipt.includes(privateMessage),false);
 });

 test('unknown catalog names retain only a hash and closed sampling context after the original write',async()=>{
  const templates=await productTemplates(),batch=batches(templates),unknown='private_unknown_function_name';
  const mock=nativeMock(templates,{unknownCatalogNameAfter:unknown});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await assert.rejects(client.query(templates.reserve,batch.reserve),/write_functions_unknown_catalog_function/);
  await client.query('ROLLBACK');await client.release(true);observer.close();
  const receipt=observer.snapshot(),capture=receipt.captures[0]!;
  assert.equal(receipt.status,'failed');assert.equal(capture.failure_stage,'after');
  assert.equal(capture.failure_reason,'write_functions_unknown_catalog_function');
  assert.equal(capture.original_executions,1);assert.equal(capture.original_succeeded,true);
  assert.equal(capture.transaction_rolled_back,true);assert.equal(capture.rollback_reset_confirmed,true);
  assert.equal(capture.native_commit_ack,false);
  const sampling=capture.sampling as {before:{stage:string;rows_seen:number|'UNKNOWN';row_index:number|null};after:{stage:string;rows_seen:number|'UNKNOWN';row_index:number|null;name_membership:string;unknown_catalog_name:{sha256:string|null;value_type:string}}};
  assert.equal(sampling.before.stage,'done');assert.equal(sampling.before.rows_seen,1);
  assert.equal(sampling.after.stage,'catalog_name');assert.equal(sampling.after.rows_seen,2);assert.equal(sampling.after.row_index,2);
  assert.equal(sampling.after.name_membership,'unknown');
  assert.equal(sampling.after.unknown_catalog_name.value_type,'string');
  assert.equal(sampling.after.unknown_catalog_name.sha256,createHash('sha256').update(unknown).digest('hex'));
  assert.equal('catalog_types' in sampling.after,false);assert.equal('counter_types' in sampling.after,false);
  const serialized=JSON.stringify(receipt);assert.equal(serialized.includes(unknown),false);
  assert.equal(serialized.includes('PRIVATE_DATABASE_FUNCTION_NAME'),false);
 });

 test('65 counter rows fail at the bounded row-count checkpoint before any rows are attached',async()=>{
  const templates=await productTemplates(),batch=batches(templates),mock=nativeMock(templates,{overCapAfter:true});
  const observer=createListeningWriteFunctionObserverV1({database:mock.database,eligible:()=>true,templates,
   known_function_names:['synthetic_write_function'],roots_for_mark:ids=>ids.map((_,index)=>batch.roots[index]!)});
  const client=await observer.database.connect();await client.query('BEGIN');
  await assert.rejects(client.query(templates.reserve,batch.reserve),/write_functions_counter_cap/);
  await client.query('ROLLBACK');await client.release(true);observer.close();
  const receipt=observer.snapshot(),capture=receipt.captures[0]!;
  assert.equal(receipt.status,'failed');assert.equal(capture.failure_reason,'write_functions_counter_cap');
  assert.equal(capture.failure_stage,'after');assert.equal(capture.original_succeeded,true);
  const sampling=capture.sampling as {after:{stage:string;rows_seen:number|'UNKNOWN';row_index:number|null}};
  assert.equal(sampling.after.stage,'row_count');assert.equal(sampling.after.rows_seen,65);assert.equal(sampling.after.row_index,null);
  assert.equal('after' in capture,false);assert.equal('deltas' in capture,false);
  assert.equal(capture.transaction_rolled_back,true);assert.equal(capture.rollback_reset_confirmed,true);
 });
}
