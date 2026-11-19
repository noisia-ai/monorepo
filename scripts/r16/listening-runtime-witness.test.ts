import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
 assertSharedWireDefaultRuntimeV1,sharedWireDefaultContractV1,sharedWireDefaultRuntimeSqlV1,
} from '../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle';
import {compactRawNameV1,compactFullStreamMigrationV1,compactFullStreamSourceV1} from '../../infrastructure/db/migrations/signal-listening-compact-population.oracle';
import {withR16ListeningRuntimeWitnessV1,type R16ListeningRuntimeDatabaseV1} from './run-listening-benchmark';

async function nativeRow(){
 const contract=await sharedWireDefaultContractV1();
 return{contract,row:{prosrc:contract.prosrc,...contract.metadata}};
}
async function compactSource(){
 const previous=await readFile(new URL('../../infrastructure/db/migrations/0335_signal_listening_compact_population.sql',import.meta.url),'utf8');
 const current=await readFile(new URL('../../infrastructure/db/migrations/'+compactFullStreamMigrationV1,import.meta.url),'utf8');
 return compactFullStreamSourceV1(previous,current);
}
function compactCatalog(body:string,mutate:(rows:Record<string,unknown>[])=>void=()=>{}){
 const names=['signal_listening_population_roots_v1','signal_listening_effective_population_roots_v2','signal_listening_population_v1',compactRawNameV1,
  'signal_listening_effective_compact_population_roots_v1','signal_listening_compact_population_v1'];
 const rows=names.map((proname,index)=>({oid:String(100+index),proname,prosrc:proname===compactRawNameV1?body:`source-${proname}`,
  proowner:'10',proacl:'{owner=X/owner}',provolatile:'s',prosecdef:false,proconfig:['search_path=public, extensions, pg_temp'],proisstrict:false,
  proparallel:'u',proleakproof:false,prokind:'f',pronargs:6,proargtypes:'2950 2950 2950 25 2951 25',pronargdefaults:0,default_arguments:null,
  prorettype:'2249',proallargtypes:'{2950,2950,2950,25,2951,25,2950,25,1184,25,25,23,23,16,25,16,25,3802}',
  proargmodes:'{i,i,i,i,i,i,t,t,t,t,t,t,t,t,t,t,t,t}',
  proargnames:['w','cid','mid','ctx','roots','purpose','root_id','input_digest','published_at','question_key','question_digest','body_chars','wire_chars','has_topic_source','domain','candidate','scope_state','answer'],
  proretset:true,procost:'100',prorows:'1000',prosupport:'-',lanname:'plpgsql'}));
 mutate(rows);
 const acl=names.map(proname=>({proname,grantor:'10',grantee:'10',privilege_type:'EXECUTE',is_grantable:false}));
 return{rows,acl};
}
function fakeDatabase(read:(sql:string,readIndex:number)=>Promise<{rows:Record<string,unknown>[]}>|{rows:Record<string,unknown>[]}):R16ListeningRuntimeDatabaseV1{
 let readIndex=0;
 return{query:async(sql:string)=>{readIndex++;return read(sql,readIndex);}} as unknown as R16ListeningRuntimeDatabaseV1;
}
function respond(money:Record<string,unknown>,catalog:ReturnType<typeof compactCatalog>,sql:string){
 if(sql===sharedWireDefaultRuntimeSqlV1)return{rows:[money]};
 if(sql.includes('aclexplode'))return{rows:catalog.acl};
 assert.match(sql,/FROM pg_catalog\.pg_proc p/u);return{rows:catalog.rows};
}

test('the witness records strict Money E and actual compact0338 source/catalog/owner/ACL',async()=>{
 const {contract,row}=await nativeRow(),source=await compactSource(),catalog=compactCatalog(source.body),database=fakeDatabase(sql=>respond(row,catalog,sql));
 const observed=await withR16ListeningRuntimeWitnessV1(database,async(witness,captureAfter)=>{
  assert.equal(witness.before?.actual_pg_proc_checked,true);assert.equal(witness.before?.default_arm,'E');
  assert.equal(witness.compact.before?.prosrc_sha256,'91192c5bf9d19e8b25ee745728236cdddba191255e93515964e11a4b714f4b6b');
  await captureAfter();return{serving_ready:true};
 });
 assert.deepEqual(observed.value,{serving_ready:true});assert.equal(contract.default_arm,'E');
 assert.equal(observed.runtime_witness.contract,'r16-listening-runtime-witness-v1');
 assert.deepEqual(observed.runtime_witness.before,observed.runtime_witness.after);
 assert.deepEqual(observed.runtime_witness.compact.before,observed.runtime_witness.compact.after);
 assert.equal(observed.runtime_witness.compact.before?.migration,compactFullStreamMigrationV1);
 assert.equal(observed.runtime_witness.compact.before?.function.oid,'103');
 assert.equal('prosrc' in observed.runtime_witness.compact.before!.function,false);
});

test('the actual compact after-catalog capture runs after serving and before wall close',async()=>{
 const {row}=await nativeRow(),source=await compactSource(),catalog=compactCatalog(source.body),events:string[]=[],database=fakeDatabase(sql=>{
  if(sql===sharedWireDefaultRuntimeSqlV1)events.push('money');else if(sql.includes('aclexplode'))events.push('acl');else events.push('catalog');
  return respond(row,catalog,sql);
 });
 const result=await withR16ListeningRuntimeWitnessV1(database,async(_witness,captureAfter)=>{
  events.push('serving');await captureAfter();events.push('wall_end');return{wall_end_observed:true};
 });
 assert.deepEqual(events,['money','catalog','acl','serving','money','catalog','acl','wall_end']);
 assert.equal(result.runtime_witness.compact.before?.contract,'r16-compact-population-runtime-witness-v1');
});

test('a stale0335 compact body is rejected before the full-run body and postcheck remains attempted',async()=>{
 const {row}=await nativeRow(),source=await compactSource(),catalog=compactCatalog(source.oldBody);let bodyCalled=false;
 const database=fakeDatabase(sql=>respond(row,catalog,sql));
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{bodyCalled=true;}),error=>error instanceof AggregateError);
 assert.equal(bodyCalled,false);
});

test('missing compact catalog, mismatched attributes, and changed ACL fail closed',async()=>{
 const {row}=await nativeRow(),source=await compactSource();
 for(const mutate of [
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows=catalog.rows.filter(candidate=>candidate.proname!==compactRawNameV1);},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proparallel='s';},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.acl[3]!.grantee='PUBLIC';},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proallargtypes=null;},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proargmodes=null;},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proargmodes='{i,i,i,i,i,i,t,t,t,t,t,t,t,t,t,t,t}';},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proargnames=null;},
  (catalog:ReturnType<typeof compactCatalog>)=>{catalog.rows[3]!.proargnames=['w','cid','mid','ctx','roots','purpose','root_id','input_digest','published_at','question_key','question_digest','body_chars','wire_chars','has_topic_source','domain','candidate','wrong','answer'];},
 ]){
  const catalog=compactCatalog(source.body);mutate(catalog);let bodyCalled=false;
  await assert.rejects(withR16ListeningRuntimeWitnessV1(fakeDatabase(sql=>respond(row,catalog,sql)),async()=>{bodyCalled=true;}),error=>error instanceof AggregateError);
  assert.equal(bodyCalled,false);
 }
});

test('compact metadata or ACL drift between before and after fails closed',async()=>{
 const {row}=await nativeRow(),source=await compactSource();
 for(const drift of ['owner','acl'] as const){
  let catalogReads=0,observed:{after:unknown;compact:{after:unknown}}|undefined;
  const database=fakeDatabase(sql=>{
   if(sql.includes('aclexplode')){
    const catalog=compactCatalog(source.body);
    if(catalogReads>=2&&drift==='owner')for(const grant of catalog.acl){grant.grantor='11';grant.grantee='11';}
    if(catalogReads>=2&&drift==='acl')for(const grant of catalog.acl)grant.grantee='PUBLIC';
    return respond(row,catalog,sql);
   }
   if(sql.includes('FROM pg_catalog.pg_proc p')){
    catalogReads++;
    const catalog=compactCatalog(source.body,rows=>{if(catalogReads>=2&&drift==='owner')for(const entry of rows){entry.proowner='11';entry.proacl='{11=X/11}';}});
    return respond(row,catalog,sql);
   }
   return respond(row,compactCatalog(source.body),sql);
  });
  await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async(witness,captureAfter)=>{observed=witness;await captureAfter();}),error=>{
   assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,2);
   assert.ok(error.errors.every(item=>item instanceof Error&&item.message.includes('compact0338 catalog/source/owner/ACL')));return true;
  });
  assert.ok(observed);assert.equal(observed.after,null);assert.equal(observed.compact.after,null);
 }
});

test('a caught partial after-capture cannot produce a successful witness',async()=>{
 const {row}=await nativeRow(),source=await compactSource(),sentinel=new Error('synthetic_acl_read_failure');let aclReads=0;
 const database=fakeDatabase(sql=>{
  if(sql.includes('aclexplode')&&++aclReads===2)throw sentinel;
  return respond(row,compactCatalog(source.body),sql);
 });
 let witness:{after:unknown;compact:{after:unknown}}|undefined;
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async(current,captureAfter)=>{
  witness=current;await assert.rejects(captureAfter(),error=>error===sentinel);
  return{unexpected_success:true};
 }),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors.every(item=>item===sentinel)&&error.cause===sentinel);
 assert.ok(witness);assert.equal(witness.after,null);assert.equal(witness.compact.after,null);
});

test('a first null or undefined capture failure is preserved over a later failure',async()=>{
 const {row}=await nativeRow(),source=await compactSource();
 for(const firstError of [null,undefined]){
  let aclReads=0;const laterError=new Error('synthetic_later_capture_failure');
  const database=fakeDatabase(sql=>{
   if(sql.includes('aclexplode')){
    aclReads++;
    if(aclReads===2)throw firstError;
    if(aclReads===3)throw laterError;
   }
   return respond(row,compactCatalog(source.body),sql);
  });
  await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async(_witness,captureAfter)=>{
   await assert.rejects(captureAfter(),error=>error===firstError);
   await assert.rejects(captureAfter(),error=>error===firstError);
   return{};
  }),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors.every(item=>item===firstError));
 }
});

test('a primary full-run error stays primary while both after checks still run',async()=>{
 const {row}=await nativeRow(),source=await compactSource(),primary=new Error('synthetic_primary_failure'),events:string[]=[],catalog=compactCatalog(source.body);
 const database=fakeDatabase(sql=>{events.push(sql===sharedWireDefaultRuntimeSqlV1?'money':sql.includes('aclexplode')?'acl':'catalog');return respond(row,catalog,sql);});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{events.push('body');throw primary;}),error=>error===primary);
 assert.deepEqual(events,['money','catalog','acl','body','money','catalog','acl']);
});

test('missing compact postcheck leaves both after receipts null',async()=>{
 const {row}=await nativeRow(),source=await compactSource(),postcheck=new Error('synthetic_after_unavailable');let witness:{before:unknown;after:unknown;compact:{before:unknown;after:unknown}}|undefined;
 const database=fakeDatabase((sql,index)=>{if(index<=3)return respond(row,compactCatalog(source.body),sql);throw postcheck;});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async(current,captureAfter)=>{witness=current;await captureAfter();return{};}),error=>error instanceof AggregateError);
 assert.ok(witness);assert.notEqual(witness.before,null);assert.equal(witness.after,null);assert.notEqual(witness.compact.before,null);assert.equal(witness.compact.after,null);
});

test('the strict Money E precheck remains unchanged',async()=>{
 const {contract,row}=await nativeRow(),invalid={...row,prosrc:`${row.prosrc} `},source=await compactSource(),catalog=compactCatalog(source.body),database=fakeDatabase(sql=>respond(invalid,catalog,sql));
 await assert.rejects(assertSharedWireDefaultRuntimeV1(database),error=>error instanceof Error&&error.message.startsWith('actual pg_proc.prosrc SHA must match source-aware default'));
 assert.equal(contract.default_arm,'E');
});

test('historical Money C is rejected before the full-run body',async()=>{
 const{sharedWireSourcesV1,sharedWirePayloadBarrierSourceV1,sharedWireDefaultContractFromSourcesV1}=await import('../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle');
 const[,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);const historical=sharedWireDefaultContractFromSourcesV1(sourceB,sharedWirePayloadBarrierSourceV1(sourceB));let bodyCalled=false;
 const database=fakeDatabase(sql=>sql===sharedWireDefaultRuntimeSqlV1?{rows:[{prosrc:historical.prosrc,...historical.metadata}]}:{rows:[]});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{bodyCalled=true;}),error=>error instanceof AggregateError);
 assert.equal(bodyCalled,false);
});

test('historical Money D is rejected before the full-run body',async()=>{
 const{readFile}=await import('node:fs/promises'),{sharedWireSourcesV1,sharedWirePayloadBarrierSourceV1,sharedWireDefaultContractFromSourcesV1}=await import('../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle');
 const[,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);const sourceC=sharedWirePayloadBarrierSourceV1(sourceB),sourceD=await readFile(new URL('../../infrastructure/db/migrations/0336_signal_listening_statement_native_projection.sql',import.meta.url),'utf8');
 const historical=sharedWireDefaultContractFromSourcesV1(sourceB,sourceC,sourceD);let bodyCalled=false;
 const database=fakeDatabase(sql=>sql===sharedWireDefaultRuntimeSqlV1?{rows:[{prosrc:historical.prosrc,...historical.metadata}]}:{rows:[]});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{bodyCalled=true;}),error=>error instanceof AggregateError);
 assert.equal(bodyCalled,false);
});
