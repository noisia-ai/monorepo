import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import {readSignalBrandOsCanonicalSnapshotV1,signalBrandOsCanonicalSnapshotHashV1,type SignalBrandOsCanonicalSnapshotV1} from './signal-brand-os-snapshot';
import {resolveSignalBrandContextAuthorityV1} from './signal-brand-context-authority';
import {ensureSignalBrandContextPreparationV1} from './signal-brand-context-preparation';
import {signalSemanticContextProposalDigestV1 as digest} from '@noisia/query-engine';
import {signalSemanticContextProposalRuntimeConfigurationFromEnvV1,type SignalSemanticContextQueryable} from './signal-semantic-context-proposal';
const actor='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const workspace={id,organizationId:actor,subject:{type:'brand' as const,id},timezone:'Asia/Tokyo'};
const runtime={semantic:signalSemanticContextProposalRuntimeConfigurationFromEnvV1({}),prototype:{available:false,max_run_cost_micro_usd:20000},
  queue_configured:false,worker_alive:false,recovery_alive:false};
function fixture(){
 const sealed=brandContextSnapshotFixtureV1(actor,['JP']).snapshot;
 let current:SignalBrandOsCanonicalSnapshotV1=structuredClone(sealed);
 let profileCountries=['JP'],profileHash=signalBrandOsCanonicalSnapshotHashV1(sealed);
 const statements:string[]=[];
 const queryable:SignalSemanticContextQueryable={async query<Row>(sql:string,values:unknown[]=[]){statements.push(sql);let rows:unknown[]=[];
   if(sql.includes('FROM brand_os_profiles')){
     assert.deepEqual(values,[id,actor]);assert.ok(!sql.includes('JOIN brands'));assert.match(sql,/profile.metadata->'countries'/u);
     rows=[{id,version:1,digest:profileHash,countries:profileCountries}];
   }else if(sql.includes('AS name,brand.description')){
     assert.deepEqual(values,[id,actor]);assert.match(sql,/brand.organization_id=\$2::uuid/u);
     rows=[current];
   }else if(sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS')){
     rows=[{knowledge_digest:digest({sources:[],chunks:[]})}];
   }else if(sql.includes('actor.status actor_status'))rows=[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}];
   else if(sql.includes("u.user_type='noisia_internal'"))rows=[{organization_id:actor,brand_id:id,timezone:workspace.timezone,internal:true}];
   else if(sql==='SELECT clock_timestamp() now')rows=[{now:new Date('2026-09-11T01:00:00Z')}];
   else if(/^\s*(INSERT|UPDATE|DELETE)/u.test(sql))throw new Error('No mutation authorized by this fixture');
   return {rows:rows as Row[],rowCount:rows.length};}};
 return{queryable,statements,setCurrent(value:Partial<SignalBrandOsCanonicalSnapshotV1>){current={...current,...value};},
   tamperProfileCountries(){profileCountries=['BR'];},reconcile(){profileHash=signalBrandOsCanonicalSnapshotHashV1(current);profileCountries=[...current.countries];}};
}
for(const drift of [
 {countries:['BR']},{competitors:[{name:'New competitor',seed_id:id}]},{description:'Committed new description'},
 {aliases:['new handle']},{industry:'food'},{knowledge_count:1}
])test(`committed Brand OS drift ${Object.keys(drift)[0]} rejects admission until canonical reconciliation`,async()=>{
 const f=fixture();f.setCurrent(drift);
 await assert.rejects(resolveSignalBrandContextAuthorityV1({queryable:f.queryable,workspace}),
   e=>e instanceof Error&&'code' in e&&e.code==='brand_os_snapshot_stale');
 const database={query:f.queryable.query,async connect(){return{query:f.queryable.query,release(){}};}} as unknown as Pool;
 await assert.rejects(ensureSignalBrandContextPreparationV1({database,workspace_id:id,actor_user_id:actor,runtime,idempotency_key:'stale-brand-prepare'}),
   e=>e instanceof Error&&'code' in e&&e.code==='brand_os_snapshot_stale');
 assert.equal(f.statements.some(sql=>/^\s*(INSERT|UPDATE|DELETE)/u.test(sql)),false);
 f.reconcile();const live=await resolveSignalBrandContextAuthorityV1({queryable:f.queryable,workspace});
 assert.equal(live.primaryLocale,'countries' in drift?'pt-BR':'ja-JP');
});
test('countries are sealed and must agree with the canonical snapshot even when the stored hash was not changed',async()=>{
 const f=fixture();f.tamperProfileCountries();await assert.rejects(resolveSignalBrandContextAuthorityV1({queryable:f.queryable,workspace}),
   e=>e instanceof Error&&'code' in e&&e.code==='brand_os_snapshot_stale');
});
test('knowledge authority returns one canonical database digest instead of every source and chunk hash',async()=>{
 const f=fixture();await resolveSignalBrandContextAuthorityV1({queryable:f.queryable,workspace});
 const statements=f.statements.filter(sql=>sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS'));
 assert.equal(statements.length,1);
 assert.match(statements[0]!,/string_agg\('\{"digest"/u);
 assert.match(statements[0]!,/signal_semantic_context_digest_v1\(/u);
 assert.doesNotMatch(statements[0]!,/jsonb_agg\(/u);
 assert.doesNotMatch(statements[0]!,/signal_semantic_context_canonical_json_v2\(jsonb_build_object/u);
 assert.doesNotMatch(statements[0]!,/SELECT chunk\.id::text,chunk\.knowledge_source_id::text/u);
});
test('processed automatic KB counts in the canonical create snapshot and stays identical through reconciliation',async()=>{
 const created={...brandContextSnapshotFixtureV1(actor).snapshot,knowledge_count:1};
 const sourceStatuses=['processed'];
 const queryable:SignalSemanticContextQueryable={async query<Row>(sql:string,values:unknown[]=[]){
   assert.deepEqual(values,[id,actor]);assert.match(sql,/source.status IN\('processed','profiled','active'\)/u);
   const counted=sourceStatuses.filter(status=>['processed','profiled','active'].includes(status)).length;
   return{rows:[{...created,knowledge_count:counted}] as Row[],rowCount:1};}};
 const saved=signalBrandOsCanonicalSnapshotHashV1(created);
 const first=await readSignalBrandOsCanonicalSnapshotV1({queryable,brand_id:id,organization_id:actor});
 assert.equal(signalBrandOsCanonicalSnapshotHashV1(first!),saved);
 sourceStatuses[0]='active';const next=await readSignalBrandOsCanonicalSnapshotV1({queryable,brand_id:id,organization_id:actor});
 assert.equal(signalBrandOsCanonicalSnapshotHashV1(next!),saved,'processing status alone cannot manufacture a new profile version');
});
test('corpus-owned sources and chunks neither count in Brand OS nor change its semantic authority',async()=>{
 const sources=[{id,study_corpus_id:null as string|null,source_kind:'brand_brief',status:'processed',text:'Brand knowledge'},
   {id:actor,study_corpus_id:actor,source_kind:'brand_brief',status:'processed',text:'Corpus knowledge'}];
 const snapshot={...brandContextSnapshotFixtureV1(actor,['JP']).snapshot,knowledge_count:1};
 const queryable:SignalSemanticContextQueryable={async query<Row>(sql:string){let rows:unknown[]=[];
   if(sql.includes('FROM brand_os_profiles'))rows=[{id,version:1,digest:signalBrandOsCanonicalSnapshotHashV1(snapshot),countries:['JP']}];
   else if(sql.includes('AS name,brand.description')){
     assert.match(sql,/source\.study_corpus_id IS NULL/u);
     rows=[{...snapshot,knowledge_count:sources.filter(source=>source.study_corpus_id===null).length}];
   }else if(sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS')){
     assert.match(sql,/source\.study_corpus_id IS NULL/u);
     const scoped=sources.filter(source=>source.study_corpus_id===null);
     rows=[{knowledge_digest:digest({
       sources:scoped.map(source=>({id:source.id,kind:source.source_kind,digest:digest(source.text)})),
       chunks:scoped.map(source=>({id:source.id,source_id:source.id,content_digest:digest(source.text)}))
     })}];
   }
   return{rows:rows as Row[],rowCount:rows.length};}};
 const before=await resolveSignalBrandContextAuthorityV1({queryable,workspace});
 sources[1]!.text='Changed corpus text, unrelated to Brand OS';
 sources.push({id:actor,study_corpus_id:id,source_kind:'brand_brief',status:'active',text:'Another corpus'});
 const after=await resolveSignalBrandContextAuthorityV1({queryable,workspace});
 assert.deepEqual(after,before);
 assert.equal((await readSignalBrandOsCanonicalSnapshotV1({queryable,brand_id:id,organization_id:actor}))!.knowledge_count,1);
 sources[0]!.text='A real Brand OS edit';
 assert.notEqual((await resolveSignalBrandContextAuthorityV1({queryable,workspace})).knowledgeDigest,before.knowledgeDigest);
});
test('brief and assertion readers exclude corpus evidence even from summarized Brand OS context',async()=>{
 const catalog=await readFile(new URL('./signal-topic-catalog.ts',import.meta.url),'utf8');
 assert.match(catalog,/AND \(brief\.knowledge_source_id IS NULL OR EXISTS\([^]*?source\.study_corpus_id IS NULL/u);
 assert.match(catalog,/WHERE workspace\.id=\$1::uuid AND assertion\.status='active' AND source\.study_corpus_id IS NULL/u);
 assert.doesNotMatch(catalog,/NOT \$2::boolean OR brief\.knowledge_source_id/u);
 const resolution=await readFile(new URL('./signal-semantic-resolution.ts',import.meta.url),'utf8');
 assert.match(resolution,/AND \(brief\.knowledge_source_id IS NULL OR EXISTS\([^]*?source\.study_corpus_id IS NULL/u);
 assert.doesNotMatch(resolution,/\$2::int IS NOT NULL OR brief\.knowledge_source_id/u);
});
