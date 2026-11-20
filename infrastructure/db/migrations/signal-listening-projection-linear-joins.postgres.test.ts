import {compareWirePopulationV1} from './signal-listening-wire-population.oracle';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {PoolClient,QueryResult} from 'pg';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {setSignalListeningDiscoveryManualV1} from '../signal-listening-discovery';
import * as human from '../signal-listening-human-edits';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1} from '@noisia/query-engine';
import {candidateProjectionMetadataSqlV1,projectionMetadataBeforeLinearJoinsV1,compareProjectionLinearJoinsOnClientV1,
 runProjectionLinearPair4096V1,type ProjectionLinearJoinsOracleContextV1,type ProjectionLinearJoinsOracleCountersV1} from './signal-listening-projection-linear-joins.oracle';
const enabled=process.env.NOISIA_R16_PROJECTION_LINEAR_JOINS_PG==='true';
const budget=512*1024*1024;
function oracleDatabase(database:LabelingDatabaseV1,counters:ProjectionLinearJoinsOracleCountersV1):LabelingDatabaseV1{
 return{query:database.query.bind(database),connect:async()=>{
  const c=await database.connect(),context:ProjectionLinearJoinsOracleContextV1={};
  return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{
   const result:QueryResult=await target.query(sql,params);
   await compareProjectionLinearJoinsOnClientV1(target,sql,params,result,context,counters);return result;
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 }} as LabelingDatabaseV1;
}
async function pair(c:PoolClient,sql:string,params:unknown[]){
 assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
 await compareWirePopulationV1(c,[params[0],params[1],params[2],params[3],params[7],'llm-processing']);
 const before=(await c.query(projectionMetadataBeforeLinearJoinsV1,params)).rows,after=(await c.query(sql,params)).rows;
 assert.deepEqual(after,before,'complete metadata rows, projection and weights match frozen a883 in one RR/RO');return after;
}
test('projection linear joins native preserves256keys, Unicode microseconds, byte sentinels, reservations and rights',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{seed_published_at:'2026-01-01T00:00:00.123456Z',study_author_metadata:true,wire_octet_probe:true,beforeProcessing:async f=>{
 const canceled=await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[f.run_id,f.workspace_id]);assert.equal(canceled.rows.length,1);
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id},base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,instructions:'Café 😀 漢字 "evidence"\n',questions:[...base.questions,
  ...Array.from({length:254},(_,i)=>({key:'detail_'+String(i).padStart(3,'0'),type:'noul' as const,text:'Café 😀?',positive:'sí 漢字',negative:'no',scope:'all' as const,origin:'brand_os' as const,human_locked:false}))]})});
 const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
 const octets=(await f.database.query('SELECT max(octet_length(text)) bytes,max(length(text)) chars FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2',[f.workspace_id,f.map_id])).rows[0];assert.ok(octets.bytes>octets.chars);assert.ok(octets.bytes<12000);
 const counters={metadata:0,hydrated:0,sentinel:0},database=oracleDatabase(f.database,counters);
 const store=createSignalListeningStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider');}}),run=await store.claim(admitted.run_id);assert.ok(run);
 try{
  const callsBefore=(await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n;
  assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:1}),[]);assert.equal(counters.hydrated,0);
  await assert.rejects(store.inputs(run,{max_rows:3,max_working_bytes:1,on_oversize:'error'}),/labeling_input_memory_bound/);
  const full=await store.inputs(run),bounded=await store.inputs(run,{max_rows:3,max_working_bytes:budget});assert.deepEqual(bounded,full.slice(0,3));assert.ok(bounded.length>=2);
  assert.ok(bounded.every(i=>i.question_keys.length===256&&Object.keys(i.question_digests).length===256));
  assert.ok(bounded.every(i=>i.author===null&&i.title===null&&i.language===null&&i.content_type===null&&i.published_at.endsWith('.123Z')));
  const c=await f.database.connect();let weights:number[]=[];
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const fixed=Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(cfg.configuration));
   const rows=await pair(c,await candidateProjectionMetadataSqlV1(),[f.workspace_id,cfg.id,f.map_id,run.entity_context_digest,run.id,3,fixed,bounded.map(i=>i.root_id),String(budget)]);weights=rows.map(r=>Number(r.working_bytes));
   const date=(await c.query("SELECT to_jsonb(m)->>'published_at' value FROM mentions m WHERE workspace_id=$1 AND id=$2",[f.workspace_id,bounded[0]!.root_id])).rows[0].value;assert.match(date,/\.123456/);
  }finally{await c.query('ROLLBACK');c.release();}
  assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:weights[0]!+weights[1]!-1}),bounded.slice(0,1));
  assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:weights[0]!+weights[1]!}),bounded.slice(0,2));
  assert.ok(counters.metadata>0&&counters.hydrated>0&&counters.sentinel>0);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,callsBefore,'read-only oracle creates no calls');
  const input=bounded[0]!,request=buildSignalListeningJevRequestV1(input,cfg.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
  const calls=await store.reserve(run,[{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:1000}]);assert.equal(calls.length,1);
  assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:budget})).some(i=>i.root_id===input.root_id));
  await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);
  assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:budget})).some(i=>i.root_id===input.root_id),'same-run unknown work remains reserved');
  await assert.rejects(store.inputs({...run,workspace_id:randomUUID()},{max_rows:3,max_working_bytes:budget}),/listening_run_unavailable/);
  await f.database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
  const read=async(bounded:boolean)=>{try{return{rows:await store.inputs(run,bounded?{max_rows:3,max_working_bytes:budget}:undefined)}}catch(e){return{error:(e as Error).message}}};
  assert.deepEqual(await read(true),await read(false),'current source denial remains the same native result/error');
 }finally{await store.release(run);}
}}));

test('projection linear joins native preserves awaiting/excluded, H5 precedence and a global byte prefix across pages',{skip:!enabled,timeout:600000},async()=>{
 await withDiscoveryAdvanceFixtureV1(async f=>{
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const scoped={key:'consumer_probe',type:'noul' as const,text:'Does this describe category use?',positive:'Category use',negative:'Other',scope:'consumer_category' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const};
 const excluded=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...f.cfg.configuration,questions:[...f.cfg.configuration.questions,scoped]})});
 const awaiting=await saveSignalListeningConfigurationV1({...access,expected_revision:excluded.revision,provenance:'human',configuration:{...excluded.configuration,questions:excluded.configuration.questions.map(q=>q.key==='promotion'?{...q,text:q.text+' New pending version.',human_locked:true}:q)}});
 const ctx=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const sql=await candidateProjectionMetadataSqlV1();
  for(const [cfg,state]of [[excluded,'excluded'],[awaiting,'awaiting_base']] as const){
   const native=(await c.query("SELECT scope_state,answer FROM signal_listening_population_roots_v1($1,$2,$3,$4,$5,'llm-processing') WHERE question_key='consumer_probe'",[f.workspace_id,cfg.id,f.map_id,ctx,f.roots])).rows;assert.ok(native.length>0&&native.every(r=>r.scope_state===state&&r.answer===null));
   const rows=await pair(c,sql,[f.workspace_id,cfg.id,f.map_id,ctx,randomUUID(),4096,1000,f.roots,String(budget)]);
   assert.ok(rows.every(r=>!r.projection?.question_keys.includes('consumer_probe')),'scoped excluded/awaiting questions never enter metadata');
  }
  for(const roots of [[],[null],Array(4097).fill(f.roots[0])])assert.deepEqual(await pair(c,sql,[f.workspace_id,awaiting.id,f.map_id,ctx,randomUUID(),4096,1000,roots,String(budget)]),[]);
  assert.deepEqual(await pair(c,sql,[randomUUID(),awaiting.id,f.map_id,ctx,randomUUID(),4096,1000,f.roots,String(budget)]),[]);
  assert.deepEqual(await pair(c,sql,[f.workspace_id,randomUUID(),f.map_id,ctx,randomUUID(),4096,1000,f.roots,String(budget)]),[]);
 }finally{await c.query('ROLLBACK');c.release();}
},{no_category:true});

 await withSignalStudyFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const initial=await human.getSignalListeningHumanEditContextV1(access),from=initial.configuration.questions.find(q=>q.topic_source==='discovered')!.key,to='additional_defined_topic';
  const moved=await human.correctSignalListeningTopicMembershipV1({...access,expected:initial.expected,root_id:f.roots[0]!,from_question_key:from,to_question_key:to,idempotency_key:randomUUID()});
  const next=await human.getSignalListeningHumanEditContextV1(access);
  const removed=await human.correctSignalListeningTopicMembershipV1({...access,expected:next.expected,root_id:f.roots[0]!,from_question_key:to,idempotency_key:randomUUID()});
  await setSignalListeningDiscoveryManualV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,question_key:from,root_id:f.roots[2]!,belongs:false});
  const before=(await f.database.query('SELECT id,revision,configuration_id FROM signal_listening_human_edits WHERE workspace_id=$1 ORDER BY revision',[f.workspace_id])).rows;
  const c=await f.database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const sql=await candidateProjectionMetadataSqlV1();
   const ctx=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
   const decisions=(await c.query('SELECT belongs FROM signal_listening_human_memberships WHERE workspace_id=$1',[f.workspace_id])).rows;
   assert.ok(decisions.some(d=>d.belongs===true)&&decisions.some(d=>d.belongs===false));
   for(const cid of [initial.expected.configuration_id,moved.configuration_id,removed.configuration_id]){
    const rows=await pair(c,sql,[f.workspace_id,cid,f.map_id,ctx,randomUUID(),4096,1000,f.roots,String(budget)]);
    assert.ok(rows.every(r=>!r.projection?.question_keys.includes(from)&&!r.projection?.question_keys.includes(to)),'cache and native human precedence stay exact');
   }
   const labels=(await c.query("SELECT human_belongs,effective_belongs,label_source,answer,cache_call_id FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,$5,'client-derived-metrics') WHERE root_id=$6 AND question_key=$7",[f.workspace_id,removed.configuration_id,f.map_id,ctx,f.roots,f.roots[0],to])).rows;
   assert.equal(labels.length,1);assert.equal(labels[0].human_belongs,false);assert.equal(labels[0].effective_belongs,false);assert.equal(labels[0].label_source,'human');assert.ok(labels[0].cache_call_id);
  }finally{await c.query('ROLLBACK');c.release();}
  assert.deepEqual((await f.database.query('SELECT id,revision,configuration_id FROM signal_listening_human_edits WHERE workspace_id=$1 ORDER BY revision',[f.workspace_id])).rows,before);
 },{complete_listening:true,additional_defined_topic:true});

 await runMassLabelingAcceptanceFixtureV1('product',{population_count:70,beforeProcessing:async f=>{
  const canceled=await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[f.run_id,f.workspace_id]);assert.equal(canceled.rows.length,1);
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,questions:[...base.questions,{key:'consumer_probe',type:'noul',text:'Does this describe category use?',positive:'Category use',negative:'Other',scope:'consumer_category',origin:'brand_os',human_locked:false,topic_source:'defined'}]})});
  const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
  const counters={metadata:0,hydrated:0,sentinel:0};let pages:Array<Array<{root_id:string;working_bytes:string;projection:unknown}>>=[],pageBudgets:string[]=[],rootPages=0;
  const original=oracleDatabase(f.database,counters),database={query:original.query.bind(original),connect:async()=>{const c=await original.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{
   const result=await target.query(sql,params);if(sql.startsWith('/* labeling_listening_root_page_v1 */'))rootPages++;if(sql.startsWith('/* labeling_listening_input_metadata_v1 */')){pages.push(result.rows);pageBudgets.push(String(params?.[8]));}return result;
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as LabelingDatabaseV1;
  const store=createSignalListeningStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider');}}),run=await store.claim(admitted.run_id);assert.ok(run);
  try{const all=await store.inputs(run);assert.equal(all.length,70);
   const proposals=all.slice(0,62).map(input=>{const request=buildSignalListeningJevRequestV1(input,cfg.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:1000};});
   assert.equal((await store.reserve(run,proposals)).length,62);pages=[];
   assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:budget}),all.slice(62,65));assert.deepEqual(pages.map(p=>p.length),[2,1]);
   const weights=pages.flat().map(r=>Number(r.working_bytes)),exactBudget=weights[0]!+weights[1]!;
   assert.equal(weights.length,3);assert.ok(weights.every(w=>Number.isSafeInteger(w)&&w>=8192));
   pages=[];rootPages=0;const beforeExact={...counters};
   assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:exactBudget}),all.slice(62,64));
   assert.deepEqual(pages.map(p=>p.length),[2]);assert.equal(rootPages,1,'exact fit stops before another source-page query');
   assert.deepEqual(pages[0]!.map(r=>r.root_id),all.slice(62,64).map(i=>i.root_id));assert.ok(pages[0]!.every(r=>r.projection!==null));
   assert.equal(pages[1],undefined);assert.equal(pages[2],undefined);
   assert.equal(counters.metadata-beforeExact.metadata,1);assert.equal(counters.hydrated-beforeExact.hydrated,1);assert.equal(counters.sentinel-beforeExact.sentinel,0);
   pages=[];pageBudgets=[];rootPages=0;const beforeAcross={...counters};
   assert.ok(weights[2]!>1,'one remaining byte cannot fit the third root');
   assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:exactBudget+1}),all.slice(62,64));
   assert.deepEqual(pages.map(p=>p.length),[2,1]);assert.equal(rootPages,2);assert.equal(pages[2],undefined);
   assert.deepEqual(pageBudgets,[String(exactBudget+1),'1'],'second page receives only the unspent global byte');
   assert.deepEqual(pages.flat().map(r=>r.root_id),all.slice(62,65).map(i=>i.root_id));
   assert.equal(pages[1]![0]!.projection,null,'next-page root remains the non-fitting sentinel under the SAME global budget');
   assert.equal(counters.metadata-beforeAcross.metadata,2);assert.equal(counters.hydrated-beforeAcross.hydrated,1);assert.equal(counters.sentinel-beforeAcross.sentinel,1);
   pages=[];rootPages=0;const beforeShort={...counters};
   assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:exactBudget-1}),all.slice(62,63));
   assert.deepEqual(pages.map(p=>p.length),[2]);assert.equal(rootPages,1);assert.equal(pages[1],undefined);
   assert.deepEqual(pages[0]!.map(r=>r.root_id),all.slice(62,64).map(i=>i.root_id));
   assert.ok(pages[0]![0]!.projection!==null);assert.equal(pages[0]![1]!.projection,null,'first-page second root is the non-fitting sentinel');
   assert.equal(counters.metadata-beforeShort.metadata,1);assert.equal(counters.hydrated-beforeShort.hydrated,1);assert.equal(counters.sentinel-beforeShort.sentinel,1);
   assert.ok(counters.metadata>0&&counters.hydrated>0&&counters.sentinel>0);
  }finally{await store.release(run);}
 }});
});

// IMPORTANT: benchmark fixture uses the accredited GLOBAL R16 lab Pool and
// persists4096 roots. ROOT must run this file in a dedicated fresh VM/database,
// never before Main/mini in the same populated base. No rollback workaround.
test('projection linear joins native4096 paired RRRO preserves rows and removes both materialized CTE rescans',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
 const canceled=await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[f.run_id,f.workspace_id]);assert.equal(canceled.rows.length,1);
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
 const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
 const counters={metadata:0,hydrated:0,sentinel:0};let captures=0;
 const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect(),context:ProjectionLinearJoinsOracleContextV1={};return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{
  const result=await target.query(sql,params);await compareProjectionLinearJoinsOnClientV1(target,sql,params,result,context,counters);
  if(sql.startsWith('/* labeling_listening_input_metadata_v1 */')&&params?.length===9){assert.equal((params[7] as string[]).length,4096);assert.equal(captures,0);captures++;
   const receipt=await runProjectionLinearPair4096V1(target,params);assert.equal(receipt.output_count,4096);
   console.log('# projection linear joins pair4096 '+JSON.stringify(receipt));
  }return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as LabelingDatabaseV1;
 const store=createSignalListeningStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider');}}),run=await store.claim(admitted.run_id);assert.ok(run);
 try{const rows=await store.inputs(run,{max_rows:4096,max_working_bytes:budget});assert.equal(rows.length,4096);assert.equal(captures,1);assert.equal(counters.metadata,1);assert.equal(counters.hydrated,1);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0,'paired READ ONLY queries create no calls');
 }finally{await store.release(run);}
}}}));
