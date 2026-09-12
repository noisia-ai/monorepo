import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {signalWorkspaceEmbeddingDigestV1,signalTopicConsolidationActivationCommandV1,signalTopicConsolidationServingSnapshotSchemaV1} from '@noisia/query-engine';
import {selectSignalWorkspaceTopicV1} from './signal-workspace-topic-selection';
import {loadSignalWorkspaceTopicsOverviewV1} from './signal-workspace-topics-serving';
import {loadSignalTopicConsolidationActivationStatusV1,readSignalTopicConsolidationServingBindingV1,mutateSignalTopicConsolidationBindingV1} from './signal-topic-consolidation-activation';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=(c:string)=>`sha256:${c.repeat(64)}`;
const term=`consolidated_${'a'.repeat(64)}`;
const narrativeTerm=`consolidated_${'e'.repeat(64)}`;
const snapshot={id:id(3),revision_id:id(4),revision_digest:sha('b'),snapshot_digest:sha('c'),source_engine_execution_id:id(5),
 preparation_run_id:id(6),input_revision:'1',current_revision:'1',source_valid:true,expected_group_count:2,catalog:[{
 concept_key:'topic-real',concept_id:id(7),kind:'topic' as const,locale:'es-MX',semantic_identity_digest:sha('a'),term_key:term,
 label:'Conversación real',definition:'Conversación relevante para la marca.',definition_digest:sha('a'),definition_revision:1,
 created_at:'2026-09-12T00:00:00.000Z',updated_at:'2026-09-12T00:00:00.000Z'},
 {concept_key:'narrative-real',concept_id:id(10),kind:'narrative' as const,locale:'es-MX',semantic_identity_digest:sha('e'),term_key:narrativeTerm,
 label:'La voz cambia rutinas',definition:'Las personas describen un cambio en sus rutinas.',definition_digest:sha('e'),definition_revision:1,
 created_at:'2026-09-12T00:00:00.000Z',updated_at:'2026-09-12T00:00:00.000Z'}]};
const binding={snapshot_id:id(3),legacy_generation_id:null,binding_revision:1,selection_revision:8,operation_id:id(8),
 selection:{[term]:{selected:true,definition_digest:sha('a'),definition_revision:1,generation_id:id(3),semantic_identity_digest:sha('a')},
  [narrativeTerm]:{selected:true,definition_digest:sha('e'),definition_revision:1,generation_id:id(3),semantic_identity_digest:sha('e')}}};
const authority={workspace_status:'active',brand_status:'active',organization_status:'active',brand_same_organization:true,
 actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin',same_organization:true,brand_access_level:null};
test('snapshot roots keep editorial Noise distinct from numerical abstention',async()=>{
 const sql=await readFile(new URL('./migrations/0181_signal_topic_consolidation_activation.sql',import.meta.url),'utf8');
 assert.match(sql,/WHEN bool_or\(d\.disposition='noise'\) THEN 'noise' ELSE 'abstained'/u);
 assert.match(sql,/WHEN bool_or\(d\.disposition IN\('topic','narrative'\)\) THEN 'resolved'[\s\S]*WHEN bool_or\(d\.disposition='unresolved'\) THEN 'unresolved'/u);
});
test('snapshot schema rejects Noise/Unresolved catalog rows and foreign binding identity',async()=>{
 assert.equal(signalTopicConsolidationServingSnapshotSchemaV1.safeParse(snapshot).success,true);
 for(const kind of ['noise','unresolved'])assert.equal(signalTopicConsolidationServingSnapshotSchemaV1.safeParse({...snapshot,catalog:[{...snapshot.catalog[0],kind}]}).success,false);
 assert.equal(signalTopicConsolidationServingSnapshotSchemaV1.safeParse({...snapshot,catalog:[{...snapshot.catalog[0],definition_digest:sha('f')}]}).success,false);
 const client={query:async()=>({rows:[{binding:{...binding,snapshot_id:id(9)},snapshot}]})};
 await assert.rejects(readSignalTopicConsolidationServingBindingV1(client as never,id(1)),/binding_invalid/u);
});
test('active consolidation uses common rights/population reader with exact selection and sealed source, no classifier DTO',async()=>{
 const queries:string[]=[];
 const client={async query(sql:string){queries.push(sql);
  if(/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql))return{rows:[]};
  if(sql.includes('brand_access_level'))return{rows:[authority]};
  if(sql.includes('signal_topic_consolidation_binding_v1'))return{rows:[{binding,snapshot}]};
  if(sql.includes('WITH source_generation AS MATERIALIZED')){
   assert.match(sql,/signal_topic_consolidation_snapshot_roots_v1/u);
   assert.match(sql,/signal_topic_consolidation_snapshot_memberships_v1/u);
   for(const fence of ['client-derived-metrics','client-mention-list','client-text-or-excerpt','signal_mention_import_memberships','retain_until>now()'])assert.ok(sql.includes(fence));
   return{rows:[{denominator:4,processed:4,assigned_unique:2,abstained:0,noise:1,unresolved:2,unresolved_exclusive:1,withheld:0,rights_digest:sha('d'),
    date_from:null,date_to:null,counts:[{term_key:term,mention_count:2},{term_key:narrativeTerm,mention_count:1}],series:[],observed_at:'2026-09-12T00:00:00.000000Z'}]};
  }
  throw Error(`Unexpected query ${sql.slice(0,40)}`);
 },release(){}};
 const result=await loadSignalWorkspaceTopicsOverviewV1({database:{connect:async()=>client as never},workspace_id:id(1),actor_user_id:id(2)});
 assert.equal(result?.generation_id,snapshot.id);assert.equal(result?.denominator,4);assert.equal(result?.terms[0]?.mention_count,2);
 assert.equal(result?.terms[0]?.selected,true);assert.equal(result?.coverage.abstained,0);assert.equal(result?.is_current,true);
 assert.deepEqual(result?.terms.map(item=>[item.kind,item.mention_count]),[['topic',2],['narrative',1]]);
 assert.equal(result?.coverage.noise,1);assert.equal(result?.coverage.unresolved,1);
 assert.equal(queries.some(sql=>sql.includes('loadSignalWorkspaceClassificationInput')),false);
});
test('activation requires every CAS fence and explicit concepts; invalid command never opens DB',async()=>{
 const command={action:'activate',snapshot_id:id(3),snapshot_digest:sha('c'),revision_digest:sha('b'),selected_concept_keys:[],
  expected_binding_revision:0,expected_selection_revision:7,expected_snapshot_id:null,expected_legacy_generation_id:id(9)};
 assert.equal(signalTopicConsolidationActivationCommandV1.safeParse(command).success,true);
 for(const field of ['expected_binding_revision','expected_selection_revision','expected_snapshot_id','expected_legacy_generation_id','revision_digest']){
  const input={...command};delete input[field as keyof typeof input];assert.equal(signalTopicConsolidationActivationCommandV1.safeParse(input).success,false);
 }
 await assert.rejects(mutateSignalTopicConsolidationBindingV1({database:{connect:async()=>{throw Error('DB must remain closed');}},
  workspace_id:id(1),actor_user_id:id(2),idempotency_key:'valid-key',command:{...command,selected_concept_keys:'all'}}),/request_invalid/u);
});
test('activation service checks actor before mutation and preserves committed replay receipt',async()=>{
 let allowed=false,mutations=0,commits=0;
 const client={async query(sql:string){
  if(sql.startsWith('COMMIT'))commits++;
  if(/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql))return{rows:[]};
  if(sql.includes('brand_access_level'))return{rows:[{...authority,actor_status:allowed?'active':'suspended'}]};
  if(sql.includes('mutate_signal_topic_consolidation_binding_v1')){mutations++;return{rows:[{value:{operation_id:id(8),binding,replayed:true}}]};}
  throw Error('Unexpected SQL');
 },release(){}};
 const args={database:{connect:async()=>client as never},workspace_id:id(1),actor_user_id:id(2),idempotency_key:'activation-key',command:{
  action:'activate',snapshot_id:id(3),snapshot_digest:sha('c'),revision_digest:sha('b'),selected_concept_keys:['topic-real'],
  expected_binding_revision:0,expected_selection_revision:7,expected_snapshot_id:null,expected_legacy_generation_id:id(9)}};
 await assert.rejects(mutateSignalTopicConsolidationBindingV1(args),/forbidden/u);assert.equal(mutations,0);
 allowed=true;const result=await mutateSignalTopicConsolidationBindingV1(args);assert.equal(result.replayed,true);assert.equal(result.operation_id,id(8));assert.equal(commits,1);
});

test('existing selector replays durable successor commands and rejects cross-catalog idempotency collision',async()=>{
 const args={workspace_id:id(1),actor_user_id:id(2),term_key:term,selected:true,expected_selection_revision:7,
  expected_definition_revision:1,expected_definition_digest:sha('a'),generation_id:id(3),idempotency_key:'selection-replay'};
 const {workspace_id:_workspace,actor_user_id:_actor,idempotency_key:_key,...request}=args;
 const source_request_digest=signalWorkspaceEmbeddingDigestV1({action:'select_signal',...request});
 let phase='replay',mutations=0;
 const client={async query(sql:string){
  if(/^(BEGIN|SET|COMMIT|ROLLBACK)/u.test(sql)||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
  if(sql.includes('brand_access_level'))return{rows:[authority]};
  if(sql.includes('FROM signal_topic_consolidation_activation_operations'))return{rows:phase==='replay'?[{
   id:id(8),actor_user_id:id(2),command:{source_request_digest,term_key:term},result_binding:binding}]:[]};
  if(sql.includes('FROM signal_topic_catalog_operations'))return{rows:[{id:id(9),actor_user_id:id(2),action:'select_signal',request_digest:sha('f')}]};
  mutations++;throw Error('must not reread binding or mutate on replay/conflict');
 },release(){}};
 const database={connect:async()=>client as never,query:client.query as never};
 const replay=await selectSignalWorkspaceTopicV1({database,...args});assert.equal(replay.replayed,true);assert.equal(replay.operation_id,id(8));assert.equal(mutations,0);
 phase='collision';await assert.rejects(selectSignalWorkspaceTopicV1({database,...args}),/idempotency_conflict/u);assert.equal(mutations,0);
});

test('activation status returns a runtime-validated catalog, source state, capability and active revision',async()=>{
 const client={async query(sql:string){
  if(/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql))return{rows:[]};
  if(sql.includes('brand_access_level'))return{rows:[authority]};
  if(sql.includes('signal_topic_consolidation_binding_v1'))return{rows:[{value:binding}]};
  if(sql.includes('FROM signal_topic_consolidation_revisions')){
   assert.match(sql,/s\.id snapshot_id,s\.snapshot_digest/u);assert.match(sql,/signal_topic_consolidation_snapshot_current_v1/u);
   return{rows:[{revision_id:id(4),revision:2,revision_digest:sha('b'),validated_at:'2026-09-12T12:00:00.000000Z',
    snapshot_id:id(3),snapshot_digest:sha('c'),source_valid:true,catalog:snapshot.catalog}]};
  }
  if(sql.includes('SELECT r.revision FROM signal_topic_consolidation_snapshots'))return{rows:[{revision:2}]};
  throw Error(`Unexpected SQL ${sql.slice(0,80)}`);
 },release(){}};
 const result=await loadSignalTopicConsolidationActivationStatusV1({database:{connect:async()=>client as never},workspace_id:id(1),actor_user_id:id(2)});
 assert.equal(result.can_activate,true);assert.equal(result.active_revision,2);assert.equal(result.revisions[0]?.source_valid,true);
 assert.equal(result.revisions[0]?.catalog?.[0]?.concept_key,'topic-real');
});
