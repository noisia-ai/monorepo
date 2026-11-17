import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as engine from '@noisia/query-engine';
import type * as native from './signal-labeling-runs';
type Call=native.LabelingCallV1;type Selector=()=>ReadonlyArray<Call>;
type SelectedStore={markSubmittingSelected?:(run:native.LabelingRunV1,select:Selector)=>Promise<ReadonlyArray<Call>>};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
function fixture(options:{enabled?:boolean;raw?:boolean;parallel?:boolean;denied?:boolean;lease?:boolean;commitError?:Error;rollbackError?:Error;updateError?:Error;authorityGate?:ReturnType<typeof deferred>;callGate?:ReturnType<typeof deferred>}={}){
 const events:string[]=[],run={id:'run',workspace_id:'workspace',actor_user_id:'actor',kind:'mass_labeling',identity:{provider:'typesafe',model:'jev-1.13.0'},entity_context_digest:'ctx',cap_micro_usd:'1000000',processing_admission_id:'admission'}as native.LabelingRunV1;
 const calls=Array.from({length:3},(_,i)=>({id:'call'+i,status:'reserved',raw_body:null,request:{test:i},inputs:[]}as unknown as Call));let clientReleased=0,locked:string[]=[],updated:string[]=[];
 const client={query:async(sql:string,params:unknown[]=[])=>{
  if(sql.startsWith('WITH raw_run_fence')){events.push('run');return{rows:options.lease?[]:[{id:run.id}]};}
  if(sql.includes("'signal-processing-policy:'")){events.push('policy');return{rows:[]};}
  if(sql.startsWith('SELECT signal_processing_lock_v1')){events.push('org');return{rows:[]};}
  if(sql.includes('signal_corpus_preparation_runs')){events.push('prepared');return{rows:[{}]};}
  if(sql.includes('signal_processing_org_exposure_v1')){events.push('orgSum');return{rows:[{total_micro_usd:'0'}]};}
  if(sql.startsWith('SELECT COALESCE(sum(')){events.push('runSum');if(options.authorityGate)await options.authorityGate.promise;return{rows:[{total:'0'}]};}
  if(sql.startsWith('SELECT id FROM signal_labeling_calls')){events.push('calls');locked=[...(params[2] as string[])];if(options.callGate)await options.callGate.promise;return{rows:locked.map(id=>({id}))};}
  if(sql.startsWith('INSERT INTO signal_labeling_page_mutation_fences')){events.push('fence');return{rows:[]};}
  if(sql.startsWith('UPDATE signal_labeling_calls SET status=')){events.push('update');if(options.updateError)throw options.updateError;updated=[...(params[1]as string[])];return{rowCount:updated.length,rows:updated.map(id=>({id}))};}
  if(sql==='COMMIT'&&options.commitError){events.push(sql);throw options.commitError;}
  if(sql==='ROLLBACK'&&options.rollbackError){events.push(sql);throw options.rollbackError;}
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){events.push(sql);return{rows:[]};}
  assert.fail('unexpected store query');
 },release(){events.push('release');clientReleased++;}};
 const dependencies:Record<string,unknown>={'node:crypto':crypto,'@noisia/query-engine':engine,
 './signal-workspace-capabilities':{loadSignalWorkspaceCapabilitiesStoreV1:async()=>{events.push('actor');return{can_request_processing:!options.denied};}},
 './signal-workspace-features':{signalWorkspaceFeatureEnabledV1:async()=>true},'./signal-processing-policy':{},
 './signal-mention-facets':{inspectFacetContextChangeV1:async()=>{events.push('context');return{digest:'ctx'};}},
 './signal-labeling-raw-page-store':{createLabelingRawPageStoreV1:()=>({})},'./signal-labeling-raw-pages':{LABELING_RAW_PAGE_MAX_MEMBERS_V1:4096},'./signal-labeling-input-bounds':{}};
 const module={exports:{}};const compiled=ts.transpileModule(readFileSync(new URL('./signal-labeling-runs.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];},module,module.exports);
 const factory=(module.exports as typeof native).createSignalLabelingStoreV1;
 const store=factory({database:{query:client.query,connect:async()=>{events.push('connect');return client;}}as unknown as Parameters<typeof factory>[0]['database'],page_size:3,
 storeRaw:async()=>'unused',...(options.raw===false?{}:{rawPages:{}as never}),assertRawReady:async()=>{events.push('rawReady');},
 adapter:{kind:'mass_labeling',parallel_native_pages:options.parallel!==false,...(options.enabled===false?{}:{reserve_selection:'native_listening_pending' as const}),inputs:async()=>[],pending:async()=>0,write:async()=>{},
 policy:async()=>({organization_id:'org',budget_date:'2026-01-01',budget_timezone:'UTC',daily_cap_micro_usd:'1000000',max_execution_micro_usd:'1000000',provider:'typesafe',model:'jev-1.13.0',action:'mass_labeling_jev'}),policy_action:'mass_labeling_jev',authority:async()=>{events.push('owner');},beforeSubmit:async()=>{events.push('beforeSubmit');}}})as ReturnType<typeof factory>&SelectedStore;
 return{store,run,calls,events,get locked(){return locked;},get updated(){return updated;},get clientReleased(){return clientReleased;}};
}
test('late Mark exists only for native Listening selection plus parallel durable RAW',()=>{
 assert.equal(typeof fixture().store.markSubmittingSelected,'function');
 for(const options of [{enabled:false},{raw:false},{parallel:false}])assert.equal(fixture(options).store.markSubmittingSelected,undefined);
});
test('late selection runs once only after authority waits, copies its array, then follows native order through COMMIT',async()=>{
 const authorityGate=deferred(),callGate=deferred(),f=fixture({authorityGate,callGate});let selections=0,ready=false;const selected=[f.calls[0]!];
 const pending=f.store.markSubmittingSelected!(f.run,(...args:unknown[])=>{assert.equal(args.length,0);selections++;assert.ok(ready);f.events.push('select');return selected;});
 while(!f.events.includes('runSum'))await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(selections,0);
 selected.push(f.calls[1]!);ready=true;authorityGate.resolve();
 while(!f.events.includes('calls'))await new Promise<void>(resolve=>setImmediate(resolve));selected.push(f.calls[2]!);callGate.resolve();
 const result=await pending;assert.equal(selections,1);assert.deepEqual(result,[f.calls[0],f.calls[1]]);assert.notEqual(result,selected);
 assert.deepEqual(f.locked,['call0','call1']);assert.deepEqual(f.updated,['call0','call1']);assert.equal(result[0],f.calls[0]);
 assert.deepEqual(f.events,['rawReady','connect','BEGIN','run','policy','org','actor','context','prepared','owner','orgSum','runSum','select','calls','beforeSubmit','run','fence','update','COMMIT','release']);
});
test('authority or lease rejection happens before the selector and cannot write calls',async()=>{
 for(const options of [{denied:true},{lease:true}]){const f=fixture(options);let invoked=0;
  await assert.rejects(f.store.markSubmittingSelected!(f.run,()=>{invoked++;return f.calls;}),/labeling_forbidden|labeling_lease_lost/);
  assert.equal(invoked,0);assert.deepEqual(f.updated,[]);assert.ok(f.events.includes('ROLLBACK'));assert.equal(f.clientReleased,1);
 }
});
test('empty selection is a committed no-op without call locks, mutation fence or UPDATE',async()=>{
 const f=fixture();assert.deepEqual(await f.store.markSubmittingSelected!(f.run,()=>[]),[]);
 assert.equal(f.events.includes('calls'),false);assert.equal(f.events.includes('fence'),false);assert.equal(f.events.includes('update'),false);assert.ok(f.events.includes('COMMIT'));
});
test('malformed, duplicate, over-bound, sent or RAW selections reject without awaiting or writing',async()=>{
 for(const select of [(f:ReturnType<typeof fixture>)=>[f.calls[0],f.calls[0]],(f:ReturnType<typeof fixture>)=>[...f.calls,f.calls[0]],
  (f:ReturnType<typeof fixture>)=>[{...f.calls[0],status:'submitting'}],(f:ReturnType<typeof fixture>)=>[{...f.calls[0],raw_body:'paid raw'}],
  ()=>Promise.resolve([]),()=>null]){const f=fixture();await assert.rejects(f.store.markSubmittingSelected!(f.run,(()=>select(f))as Selector),/labeling_mark_selection_invalid|labeling_result_call_conflict/);
  assert.deepEqual(f.updated,[]);assert.equal(f.events.includes('fence'),false);
 }
});
test('selector errors and lost COMMIT acknowledgement retain the primary and never resolve a handoff',async()=>{
 const primary=Error('primary');for(const kind of ['selector','commit']as const){const f=fixture(kind==='commit'?{commitError:primary}:{});let handed=false;
  await assert.rejects(f.store.markSubmittingSelected!(f.run,()=>{if(kind==='selector')throw primary;return f.calls;}).then(()=>{handed=true;}),error=>error===primary);
  assert.equal(handed,false);assert.equal(f.clientReleased,1);assert.ok(f.events.includes('ROLLBACK'));
 }
 const secondary=Error('rollback'),f=fixture({updateError:primary,rollbackError:secondary});
 await assert.rejects(f.store.markSubmittingSelected!(f.run,()=>f.calls),error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[primary,secondary]);assert.equal(error.cause,primary);return true;});
});
