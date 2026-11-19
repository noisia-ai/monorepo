import assert from 'node:assert/strict';
import test from 'node:test';
import {
 assertSharedWireDefaultRuntimeV1,sharedWireDefaultContractV1,sharedWireDefaultRuntimeSqlV1,
} from '../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle';
import {withR16ListeningRuntimeWitnessV1,type R16ListeningRuntimeDatabaseV1} from './run-listening-benchmark';

async function nativeRow(){
 const contract=await sharedWireDefaultContractV1();
 return{contract,row:{prosrc:contract.prosrc,...contract.metadata}};
}
function fakeDatabase(read:(sql:string,readIndex:number)=>Promise<{rows:Record<string,unknown>[]}>|{rows:Record<string,unknown>[]}):R16ListeningRuntimeDatabaseV1{
 let readIndex=0;
 return{query:async(sql:string)=>{readIndex++;return read(sql,readIndex);}} as unknown as R16ListeningRuntimeDatabaseV1;
}

test('the full-run witness returns source-aware strictD receipts for the actual function and metadata',async()=>{
 const {contract,row}=await nativeRow(),database=fakeDatabase(sql=>{
  assert.equal(sql,sharedWireDefaultRuntimeSqlV1);return{rows:[row]};
 });
 const observed=await withR16ListeningRuntimeWitnessV1(database,async(witness,captureAfter)=>{
  assert.equal(witness.before?.actual_pg_proc_checked,true);
  assert.equal(witness.before?.default_arm,'D');
  await captureAfter();
  return{serving_ready:true};
 });
 assert.deepEqual(observed.value,{serving_ready:true});
 assert.equal(contract.default_arm,'D');
 assert.equal(observed.runtime_witness.contract,'r16-listening-runtime-witness-v1');
 assert.deepEqual(observed.runtime_witness.before,observed.runtime_witness.after);
 assert.equal(observed.runtime_witness.before?.prosrc_sha256,contract.prosrc_sha256);
 assert.deepEqual(observed.runtime_witness.before?.metadata,contract.metadata);
});

test('the after witness runs after serving work and is included in the returned measurement',async()=>{
 const {row}=await nativeRow(),events:string[]=[],database=fakeDatabase(sql=>{assert.equal(sql,sharedWireDefaultRuntimeSqlV1);events.push('pg_proc');return{rows:[row]};});
 const result=await withR16ListeningRuntimeWitnessV1(database,async(_witness,captureAfter)=>{
  events.push('serving');await captureAfter();events.push('wall_end');return{wall_end_observed:true};
 });
 assert.deepEqual(events,['pg_proc','serving','pg_proc','wall_end']);
 assert.equal(result.runtime_witness.before?.actual_pg_proc_checked,true);
 assert.equal(result.runtime_witness.after?.actual_pg_proc_checked,true);
});

test('a primary full-run error stays primary while the failure postcheck still runs',async()=>{
 const {row}=await nativeRow(),primary=new Error('synthetic_primary_failure'),events:string[]=[],database=fakeDatabase(sql=>{
  assert.equal(sql,sharedWireDefaultRuntimeSqlV1);events.push('read');return{rows:[row]};
 });
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{events.push('body');throw primary;}),error=>error===primary);
 assert.deepEqual(events,['read','body','read']);
});

test('the body and postcheck failures remain separately visible',async()=>{
 const {row}=await nativeRow(),primary=new Error('synthetic_primary_failure'),postcheck=new Error('synthetic_postcheck_failure');
 const database=fakeDatabase((_sql,index)=>{if(index===1)return{rows:[row]};throw postcheck;});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{throw primary;}),error=>{
  assert.ok(error instanceof AggregateError);assert.equal(error.message,'shared_wire_default_body_and_postcheck_failed');
  assert.deepEqual(error.errors,[primary,postcheck]);assert.equal(error.cause,primary);return true;
 });
});

test('a missing after read remains null rather than becoming a fabricated receipt',async()=>{
 const {row}=await nativeRow(),postcheck=new Error('synthetic_after_unavailable');
 let observed:{before:unknown;after:unknown}|undefined;
 const database=fakeDatabase((_sql,index)=>{if(index===1)return{rows:[row]};throw postcheck;});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async(witness,captureAfter)=>{
  observed=witness;await captureAfter();return{unexpected:true};
 }),error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[postcheck,postcheck]);return true;});
 assert.ok(observed);assert.notEqual(observed.before,null);assert.equal(observed.after,null);
});

test('a failed precheck sends no body and still attempts a real postcheck',async()=>{
 const {row}=await nativeRow(),invalid={...row,prosrc:`${row.prosrc} `},primary=new Error('native_precheck_rejected');let reads=0,bodyCalled=false;
 const database=fakeDatabase((_sql,index)=>{reads++;return{rows:[index===1?invalid:row]};});
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{bodyCalled=true;}),error=>error instanceof Error&&error.message.startsWith('actual pg_proc.prosrc SHA must match source-aware default'));
 assert.equal(bodyCalled,false);assert.equal(reads,2);
});

test('a stale0331 C function is rejected before the full-run body when0336 D is current',async()=>{
 const {sharedWireSourcesV1,sharedWirePayloadBarrierSourceV1,sharedWireDefaultContractFromSourcesV1}=await import('../../infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle');
 const [,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);const historical=sharedWireDefaultContractFromSourcesV1(sourceB,sharedWirePayloadBarrierSourceV1(sourceB));assert.equal(historical.default_arm,'C');let bodyCalled=false;
 const database=fakeDatabase(()=>({rows:[{prosrc:historical.prosrc,...historical.metadata}]}));
 await assert.rejects(withR16ListeningRuntimeWitnessV1(database,async()=>{bodyCalled=true;}),error=>error instanceof AggregateError&&error.errors.every(e=>e instanceof Error&&e.message.startsWith('actual pg_proc.prosrc SHA must match source-aware default')));
 assert.equal(bodyCalled,false);
});
