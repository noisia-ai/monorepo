import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {canonicalEntityContextV1,entityContextDigestV1,signalListeningBaseTemplateV1,signalListeningJevIdentityV1,
 labelerDigestV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {requestMentionFacetsV1} from './signal-labeling-runs';
import type {LabelingDatabaseV1} from './signal-mention-facets';

// Runs the real entry point and real CE inspector/register against a small SQL
// double. Financial/permission correctness remains the native PG suite's gate.
function fixture(options:{changed?:boolean;superseded?:boolean}={}){
 const context=(name:string)=>canonicalEntityContextV1({entities:[{entity_id:'brand',kind:'primary_brand',name,aliases:[name],disambiguation:null}]});
 const current=context(options.changed?'xy':'brand'),previous=context('brand'),queries:string[]=[],versions:unknown[][]=[],runs:unknown[][]=[];
 let prepares=0,admissions=0,released=0;
 const identity=signalListeningJevIdentityV1(signalListeningBaseTemplateV1({category:'synthetic',lexicon_terms:['synthetic']}));
 const query=async(sql:string,params:unknown[]=[])=>{
  const q=sql.replace(/\s+/gu,' ').trim();queries.push(q);
  if(q.includes('organization.status organization_status'))return{rows:[{workspace_status:'active',brand_status:'active',organization_status:'active',brand_same_organization:true,actor_status:'active',user_type:'noisia_internal',primary_role:'admin'}]};
  if(q.startsWith('SELECT EXISTS(SELECT 1 FROM signal_workspace_features'))return{rows:[{enabled:true}]};
  if(q.startsWith('SELECT r.id,r.request_digest,l.identity'))return{rows:[]};
  if(q.startsWith('SELECT id,waiting_full_confirmation'))return{rows:options.superseded?[{id:'old-run',waiting_full_confirmation:true,entity_context_digest:'sha256:old'}]:[]};
  if(q.startsWith("UPDATE signal_labeling_runs SET status='canceled'"))return{rows:[{id:'old-run'}]};
  if(q.startsWith('SELECT r.id FROM signal_corpus_preparation_runs'))return{rows:[{id:'preparation'}]};
  if(q.includes('AS brand_name'))return{rows:[{workspace_id:'workspace',brand_id:'brand',brand_name:current.entities[0]!.name,brand_slug:'brand'}]};
  if(q.includes("'primary_brand'::text AS scope"))return{rows:current.entities.map(e=>({scope:e.kind,entity_id:e.entity_id,entity_label:e.name,aliases:e.aliases,disambiguation:e.disambiguation}))};
  if(q.includes("SELECT 'brand_objective' AS kind"))return{rows:[]};
  if(q.startsWith('SELECT context,digest,version_no'))return{rows:[{context:previous,digest:entityContextDigestV1(previous),version_no:7}]};
  if(q.includes('FROM mentions mention'))return{rows:[{root_id:'root-a',title:null,full_text:'xy',entity_ids:[]},{root_id:'root-b',title:null,full_text:'brand',entity_ids:[]}]};
  if(q.startsWith('SELECT root_id FROM signal_mention_facets_current_v1'))return{rows:[{root_id:'root-a'},{root_id:'root-b'}]};
  if(q.startsWith('INSERT INTO signal_entity_context_versions')){versions.push(params);return{rows:[]};}
  if(q.startsWith('INSERT INTO signal_entity_context_affected_roots'))return{rows:[]};
  if(q.startsWith('INSERT INTO signal_labeler_versions'))return{rows:[{id:'labeler',status:'approved'}]};
  if(q.startsWith('INSERT INTO signal_labeling_runs')){runs.push(params);return{rows:[]};}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.includes('pg_advisory_xact_lock')||q.includes('signal_processing_lock_v1')||q.includes('FOR SHARE OF'))return{rows:[]};
  throw Error('unexpected context-registration SQL: '+q);
 };
 const client={query,release(){released++;}} as unknown as PoolClient;
 const database={query,connect:async()=>client} as unknown as LabelingDatabaseV1;
 const adapter:NonNullable<Parameters<typeof requestMentionFacetsV1>[0]['adapter']>={request_identity:{test:'context-registration'},feature:'mass_labeling',policy_action:'mass_labeling_jev',select_labeler:false,
  validateIdentity(candidate){assert.deepEqual(candidate,identity);},policy:async()=>({provider:identity.provider,model:identity.model,max_execution_micro_usd:'1000000'}),
  prepare:async(_c,_w,_id,_ld,actual)=>{prepares++;assert.deepEqual(actual,current);return{roots:2,estimated_micro_usd:17,snapshot:{full_corpus:true},concept_set_digest:'test'};},
  admit:async()=>{admissions++;return{receipt:{id:'admission'}};},persist:async()=>{}};
 return{database,identity,adapter,queries,versions,runs,counts:()=>({prepares,admissions,released})};
}
test('context registration separates private adapter policy from unchanged full intent and superseding semantics',async t=>{
 const previous=process.env.NOISIA_MASS_LABELING_ENABLED;process.env.NOISIA_MASS_LABELING_ENABLED='true';
 try{for(const scenario of [
  {name:'Listening identical full census retains CE',full:true,mode:'change_only',writes:0,roster:false,waiting:false},
  {name:'classic full adapter still forces CE',full:true,mode:undefined,writes:1,roster:true,waiting:false},
  {name:'classic incremental adapter remains change-only by default',full:false,mode:undefined,writes:0,roster:false,waiting:false},
  {name:'real full CE diff is still registered and auto-confirmed',full:true,mode:'change_only',changed:true,writes:1,roster:false,waiting:false},
  {name:'real full CE diff without confirmation keeps waiting',full:false,mode:'change_only',changed:true,writes:1,roster:false,waiting:true},
  {name:'supersededFull overrides Listening opt-in',full:false,mode:'change_only',superseded:true,writes:1,roster:true,waiting:true},
 ] as const)await t.test(scenario.name,async()=>{
  const f=fixture({changed:'changed' in scenario?scenario.changed:false,superseded:'superseded' in scenario?scenario.superseded:false});if(scenario.mode)f.adapter.context_registration=scenario.mode;
  const result=await requestMentionFacetsV1({database:f.database,workspace_id:'workspace',actor_user_id:'actor',idempotency_key:'context-unit-request',cap_micro_usd:1000,provider_available:true,identity:f.identity,full_recalculation:scenario.full,adapter:f.adapter});
  assert.equal(result.waiting_full_confirmation,scenario.waiting);assert.equal(f.versions.length,scenario.writes);
  assert.equal(f.queries.some(q=>q.startsWith('SELECT root_id FROM signal_mention_facets_current_v1')),scenario.roster);
  assert.equal(f.runs[0]![14],scenario.full,'full_recalculation_confirmed preserves caller intent');
  assert.equal(f.runs[0]![6],7+scenario.writes,'CE version matches actual registration');
  assert.equal(f.runs[0]![11],digest({labeler_digest:labelerDigestV1(f.identity),budget_micro_usd:null,cap_micro_usd:1000,full_recalculation:scenario.full,adapter:f.adapter.request_identity}),'private policy never changes the request digest');
  assert.deepEqual(f.counts(),{prepares:1,admissions:1,released:1});assert.equal(f.queries.at(-1),'COMMIT');
  if(scenario.writes)assert.equal(f.versions[0]![6],'full');
 });}finally{if(previous===undefined)delete process.env.NOISIA_MASS_LABELING_ENABLED;else process.env.NOISIA_MASS_LABELING_ENABLED=previous;}
});
