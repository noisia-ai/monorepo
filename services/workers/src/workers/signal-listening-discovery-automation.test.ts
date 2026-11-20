import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {drainSignalListeningDiscoveryAutomationOnceV1,startSignalListeningDiscoveryAutomationV1,
 type ListeningDiscoveryAutomationOptionsV1} from './signal-listening-discovery-automation';
const enabled={NOISIA_LISTENING_DISCOVERY_ENABLED:'true'};
type Stores=NonNullable<ListeningDiscoveryAutomationOptionsV1['stores']>;
test('disabled automatic advances do not construct storage, query the database or inspect candidates',async()=>{
 const database={connect:async()=>{throw Error('must remain off');},query:async()=>{throw Error('must remain off');}}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>;
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1({database,env:{}}),{candidates:0,advanced:0,failed:0});
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1({database,env:enabled,should_stop:()=>true}),{candidates:0,advanced:0,failed:0});
});
test('old schemas cannot activate an automatic worker',async()=>{
 let queries=0;const database={query:async(sql:string)=>{queries++;assert.match(sql,/to_regclass/);return{rows:[{ready:false}]};}}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>;
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1({database,env:enabled}),{candidates:0,advanced:0,failed:0});assert.equal(queries,1);
});
test('the default native factory scans admitted parents without constructing a provider or starting one',async()=>{
 let scans=0;const database={query:async(sql:string)=>{
  if(sql.includes('to_regclass'))return{rows:[{ready:true}]};
  assert.match(sql,/signal_listening_discovery_advance_source_v1/);scans++;return{rows:[]};
 }}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>;
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1({database,env:enabled,
  storage:{put:async()=>{throw Error('no numeric work');},get:async()=>{throw Error('no numeric work');}}}),{candidates:0,advanced:0,failed:0});assert.equal(scans,1);
});
test('native candidates share their database and scoped stores; a global Anthropic key grants no send authority',async()=>{
 const id=randomUUID(),database={}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>;let runs=0;
 const stores={pending:async(args:{database:unknown;limit:number})=>{assert.equal(args.database,database);assert.equal(args.limit,20);return[{execution_id:id}];}}as Stores;
 const result=await drainSignalListeningDiscoveryAutomationOnceV1({database,stores,env:{...enabled,ANTHROPIC_API_KEY:'synthetic-only'},
  run:async(execution_id,args)=>{runs++;assert.equal(execution_id,id);assert.equal(args.stores,stores);assert.equal(args.database,database);
   assert.equal(args.enabled,true);assert.equal(args.provider_available,false);return{status:'provider_unavailable'};}});
 assert.equal(runs,1);assert.deepEqual(result,{candidates:1,advanced:0,failed:0});
});
test('duplicate wakeups share the active scan and shutdown waits for it without starting more work',async()=>{
 let done!:()=>void,scans=0;const blocked=new Promise<void>(resolve=>{done=resolve;});
 const stores={pending:async()=>{scans++;await blocked;return[];}}as unknown as Stores;
 const timer=startSignalListeningDiscoveryAutomationV1({database:{}as never,stores,env:enabled,interval_ms:60000,run_immediately:false});
 const a=timer.drainNow(),b=timer.drainNow();assert.equal(a,b);await Promise.resolve();assert.equal(scans,1);
 const closed=timer.close();done();await closed;await timer.drainNow();assert.equal(scans,1);
 assert.throws(()=>startSignalListeningDiscoveryAutomationV1({interval_ms:0}),/interval_invalid/);
});
test('an explicit initial intent starts its native parent before the automatic advance scan with no new authority',async()=>{
 const intent=randomUUID(),execution=randomUUID(),order:string[]=[],database={}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>;
 const initial={pending:async(args:{database:unknown;limit:number})=>{assert.equal(args.database,database);assert.equal(args.limit,20);order.push('initial');return[{intent_id:intent}];},
  start:async(args:{database:unknown;intent_id:string})=>{assert.deepEqual(args,{database,intent_id:intent});order.push('start');return{execution:{id:execution}};}};
 const stores={pending:async()=>{order.push('advance');return[{execution_id:execution}];}}as unknown as Stores;
 const result=await drainSignalListeningDiscoveryAutomationOnceV1({database,initial,stores,env:enabled,
  run:async id=>{assert.equal(id,execution);order.push('enqueue');return{status:'enqueued',round_id:randomUUID(),ordinal:1};}});
 assert.deepEqual(order,['initial','start','advance','enqueue']);assert.deepEqual(result,{candidates:2,advanced:2,failed:0});
});
test('parked initial receipts, one failed intent and shutdown cannot prevent or confer unrelated parent authority',async()=>{
 const database={}as NonNullable<ListeningDiscoveryAutomationOptionsV1['database']>,ids=[randomUUID(),randomUUID()];let started=0,scans=0;
 const stores={pending:async()=>{scans++;return[];}}as unknown as Stores;
 const result=await drainSignalListeningDiscoveryAutomationOnceV1({database,stores,env:enabled,
  initial:{pending:async()=>ids.map(intent_id=>({intent_id})),start:async()=>{if(++started===1)throw Error('native stale');return{execution:null};}}});
 assert.equal(started,2);assert.equal(scans,1);assert.deepEqual(result,{candidates:2,advanced:0,failed:1});
});
