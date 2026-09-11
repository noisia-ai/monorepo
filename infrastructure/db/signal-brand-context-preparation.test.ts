import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSignalBrandContextPreparationV1, signalBrandContextPreparationRuntimeFromEnvV1,
  type SignalBrandContextPreparationRuntimeV1 } from './signal-brand-context-preparation';
import { canonicalBrandContextLocaleV1, resolveSignalBrandContextAuthorityV1 } from './signal-brand-context-authority';
import type { SignalSemanticContextQueryable } from './signal-semantic-context-proposal';
const runtime:SignalBrandContextPreparationRuntimeV1={semantic:{available:true,provider:'anthropic',model:'claude-sonnet-4-6',model_version:'claude-sonnet-4-6',
  pricing_version:'synthetic-v1',max_input_tokens:20000,max_output_tokens:16000,model_max_output_tokens:64000,
  input_usd_per_million_tokens:'3',output_usd_per_million_tokens:'15',platform_hard_cap_micro_usd:500000n},
  prototype:{available:true,max_run_cost_micro_usd:20000},queue_configured:true,worker_alive:true,recovery_alive:true};
const actor='10000000-0000-4000-8000-000000000001';const now=new Date('2026-09-10T12:01:00Z');
test('server quote binds actor, prices, caps and canonical models; confirmation window is distinct from run admission',()=>{
 const q=quoteSignalBrandContextPreparationV1({actor_user_id:actor,runtime,now});assert.equal(q.available,true);
 assert.equal(q.quote_expires_at,'2026-09-10T12:30:00.000Z');assert.equal(q.admission_not_after,'2026-09-11T12:00:00.000Z');
 assert.equal(q.semantic_cap_micro_usd,'500000');assert.equal(q.prototype_cap_micro_usd,'20000');
 assert.equal(quoteSignalBrandContextPreparationV1({actor_user_id:actor.toUpperCase(),runtime,now}).quote_digest,q.quote_digest);
 for(const candidate of [{...runtime,semantic:{...runtime.semantic,platform_hard_cap_micro_usd:500001n}},
   {...runtime,prototype:{...runtime.prototype,max_run_cost_micro_usd:20001}},
   {...runtime,semantic:{...runtime.semantic,input_usd_per_million_tokens:'4'}}])
  assert.notEqual(quoteSignalBrandContextPreparationV1({actor_user_id:actor,runtime:candidate,now}).quote_digest,q.quote_digest);
 assert.notEqual(quoteSignalBrandContextPreparationV1({actor_user_id:actor.replace(/1$/,'2'),runtime,now}).quote_digest,q.quote_digest);
});
test('quote cannot authorize without either provider or any required runtime capability',()=>{
 for(const key of ['queue_configured','worker_alive','recovery_alive'] as const)
  assert.equal(quoteSignalBrandContextPreparationV1({actor_user_id:actor,runtime:{...runtime,[key]:false},now}).available,false);
 for(const r of [{...runtime,semantic:{...runtime.semantic,available:false}}, {...runtime,prototype:{...runtime.prototype,available:false}},
  {...runtime,semantic:{...runtime.semantic,model:'claude-opus-4-6'}}])
  assert.equal(quoteSignalBrandContextPreparationV1({actor_user_id:actor,runtime:r,now}).available,false);
});
test('runtime configuration cannot manufacture credentials or costs',()=>{
 const empty=signalBrandContextPreparationRuntimeFromEnvV1({},runtime);assert.equal(empty.semantic.available,false);assert.equal(empty.prototype.available,false);
 assert.throws(()=>signalBrandContextPreparationRuntimeFromEnvV1({NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD:'NaN'},runtime),/configuration/);
});
test('BCP47 normalization keeps language/region and rejects invalid locale values',()=>{
 assert.equal(canonicalBrandContextLocaleV1('es-mx'),'es-MX');assert.equal(canonicalBrandContextLocaleV1('ja-Jpan-JP'),'ja-JP');
 for(const bad of ['','not a locale','es_MX','../../MX'])assert.throws(()=>canonicalBrandContextLocaleV1(bad));
});
function fakeAuthority(countries:string[],contentDigest='sha256:'+'b'.repeat(64),retainedLocale?:string):SignalSemanticContextQueryable{
 return{async query<T>(sql:string){let rows:unknown[]=[];
  if(sql.includes('FROM brand_os_profiles'))rows=[{id:'10000000-0000-4000-8000-000000000002',version:1,digest:brandContextSnapshotFixtureV1(actor,countries).digest,countries}];
  else if(sql.includes('AS name,brand.description'))rows=[brandContextSnapshotFixtureV1(actor,countries).snapshot];
  else if(sql.includes("action='prepare-brand-context'"))rows=retainedLocale?[{locale:retainedLocale}]:[];
  else if(sql.includes('FROM brand_knowledge_sources'))rows=[{id:'10000000-0000-4000-8000-000000000003',source_kind:'brand_brief',file_hash:null,content_digest:contentDigest}];
  return{rows:rows as T[],rowCount:rows.length};}};
}
const ws={id:'10000000-0000-4000-8000-000000000004',organizationId:actor,subject:{type:'brand' as const,id:actor},timezone:'America/Mexico_City'};
test('Brand OS and KB provide sufficient authority without any acquisition brief',async()=>{
 const authority=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX']),workspace:ws});
 assert.equal(authority.primaryLocale,'es-MX');assert.deepEqual(authority.localeVariants,['es-MX']);assert.deepEqual(authority.markets,['MX']);
 const jp=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['JP']),workspace:ws});assert.equal(jp.primaryLocale,'ja-JP');
 const override=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX']),workspace:ws,primary_locale:'en-US'});
 assert.equal(override.primaryLocale,'en-US');assert.deepEqual(override.localeVariants,['en-US','es-MX']);
 assert.notEqual(authority.localeContextDigest,override.localeContextDigest);
});
test('a previously inferred locale never survives a Brand OS country change as an implicit override',async()=>{
 const changed=await resolveSignalBrandContextAuthorityV1({
   queryable:fakeAuthority(['JP'],'sha256:'+'b'.repeat(64),'es-MX'),workspace:ws
 });
 assert.equal(changed.primaryLocale,'ja-JP');
 assert.deepEqual(changed.localeVariants,['ja-JP']);
 assert.deepEqual(changed.markets,['JP']);
});
test('knowledge content changes authority while identical input stays idempotent',async()=>{
 const a=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX']),workspace:ws});
 const b=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX']),workspace:ws});
 const c=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX'],'sha256:'+'c'.repeat(64)),workspace:ws});
 assert.deepEqual(a,b);assert.notEqual(a.knowledgeDigest,c.knowledgeDigest);assert.notEqual(a.sourceAuthorityDigest,c.sourceAuthorityDigest);
});

test('readonly status reports current success without a historical failure and preserves the accepted receipt',async()=>{
 const { loadSignalBrandContextPreparationV1 }=await import('./signal-brand-context-preparation');
 const live=await resolveSignalBrandContextAuthorityV1({queryable:fakeAuthority(['MX']),workspace:ws});
 const accepted={contract_version:'brand-context-preparation-v1',operation_id:actor,workspace_id:ws.id,generation_id:actor,
  generation_key:'semantic-context-v1',state:'queued',semantic_run_id:null,prototype_run_id:null,active_elements:0,exceptions:0,error_code:null,replayed:false};
 const op={id:actor,result:accepted,brand_context_progress:{attempt:1,last_error:'brand_context_coordinator_failed'},
  brand_context_preparation:{generation_id:actor,source_authority_digest:live.sourceAuthorityDigest,admission:{admission_not_after:'2026-09-12T00:00:00.000Z'}}};
 const sql:string[]=[];const authority=fakeAuthority(['MX']);
 const client={async query<T extends Record<string,unknown>>(query:string,values?:unknown[]){sql.push(query);
   let rows:unknown[]|null=null;
   if(query.includes('actor.status actor_status'))rows=[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}];
   else if(query.includes('u.user_type='))rows=[{organization_id:ws.organizationId,brand_id:ws.subject.id,timezone:ws.timezone,internal:true}];
   else if(query.includes('SELECT * FROM signal_governance_control_operations'))rows=[op];
   else if(query.includes('SELECT gen.status generation_status'))rows=[{generation_status:'published',has_successor:false,semantic_run_id:actor,
     semantic_status:'completed',error_code:'old_failure',prototype_run_id:actor,prototype_status:'completed',prototype_error:'older_failure',active_elements:2,exceptions:1,admission_current:false}];
   return rows?{rows:rows as T[],rowCount:rows.length}:authority.query<T>(query,values);
  },release(){}};
 const database={query:client.query,async connect(){return client;}};
 const view=await loadSignalBrandContextPreparationV1({database:database as never,workspace_id:ws.id,actor_user_id:actor,idempotency_key:'accepted-request-1'});
 assert.equal(view.current?.state,'ready');assert.equal(view.current?.error_code,null);assert.equal(view.current?.active_elements,2);
 assert.equal(view.current?.exceptions,1);assert.equal(view.request?.state,'queued');
 assert.ok(sql[0]?.includes('READ ONLY'));assert.ok(sql.every(query=>!/^\s*(INSERT|UPDATE|DELETE)/iu.test(query)));
});

test('complete knowledge sources preserve their tail, whitespace and Unicode across bounded fragments',async()=>{
 const { fragmentSignalSemanticContextSourceBlocksV1 }=await import('./signal-semantic-context-proposal');
 const { signalSemanticContextProposalInputSchemaV1 }=await import('@noisia/query-engine');
 const source={source_alias:'src.0001',source_kind:'knowledge_source' as const,content_kind:'brand_brief',title:'Complete source',
  text:'a'.repeat(3999)+'😀\n  '+'b'.repeat(8000)+' FINAL_FACT'};
 const blocks=fragmentSignalSemanticContextSourceBlocksV1([source]);
 const parsed=signalSemanticContextProposalInputSchemaV1.shape.knowledge_blocks.parse(blocks);
 assert.equal(parsed.map(block=>block.text).join(''),source.text);
 assert.ok(parsed.every(block=>block.text.length<=4000&&block.source_alias==='src.0001'));
 assert.ok(parsed.at(-1)?.text.endsWith('FINAL_FACT'));
 assert.deepEqual(fragmentSignalSemanticContextSourceBlocksV1([source]),blocks);
 assert.equal(fragmentSignalSemanticContextSourceBlocksV1([{text:'x'.repeat(50000)}]).length,13);
});
test('knowledge capacity overflow rejects the complete input instead of silently dropping source blocks',async()=>{
 const { fragmentSignalSemanticContextSourceBlocksV1 }=await import('./signal-semantic-context-proposal');
 assert.equal(fragmentSignalSemanticContextSourceBlocksV1([{text:'x'.repeat(4000*240)}]).length,240);
 assert.throws(()=>fragmentSignalSemanticContextSourceBlocksV1([{text:'x'.repeat(4000*240+1)}]),
  error=>error instanceof Error&&'code' in error&&error.code==='semantic_context_knowledge_capacity_exceeded');
});

test('the real preparation input includes all KB fragments and brand description with one authority ref per source',async()=>{
 const { prepareSignalSemanticContextProposalInputV1 }=await import('./signal-semantic-context-proposal');
 const { signalSemanticContextProposalDigestV1:digest }=await import('@noisia/query-engine');
 const profileId='10000000-0000-4000-8000-000000000002',sourceId='10000000-0000-4000-8000-000000000003';
 const body='Evidence paragraph. '.repeat(300)+'TAIL_BEYOND_FOUR_THOUSAND';
 const sourceDigest='sha256:'+'b'.repeat(64),brandDigest='sha256:'+'a'.repeat(64);
 const knowledgeDigest=digest({sources:[{id:sourceId,kind:'brand_brief',digest:sourceDigest}],chunks:[]});
 let profileQuery='';
 const queryable:SignalSemanticContextQueryable={async query<T extends Record<string,unknown>>(sql:string){let rows:unknown[]=[];
   if(sql.includes('FROM signal_semantic_context_generations'))rows=[{id:actor,generation_key:'semantic-context-v1',status:'draft',
     brand_os_profile_id:profileId,brand_os_digest:brandDigest,knowledge_digest:knowledgeDigest,locale_context_digest:'sha256:'+'c'.repeat(64),
     primary_locale:'es-MX',locale_variants:['es-MX'],markets:['MX'],timezone:ws.timezone}];
   else if(sql.includes('FROM brand_os_profiles profile')){profileQuery=sql;rows=[{id:profileId,display_name:'Synthetic brand',aliases:[],
     industry:'food',industry_sub:null,description:'DISTINCT_BRAND_DESCRIPTION',metadata:{snapshot_hash:brandDigest}}];}
   else if(sql.includes("SELECT 'knowledge_source'::text")){assert.ok(!sql.includes('left('));rows=[{source_type:'knowledge_source',id:sourceId,
     parent_id:null,content_kind:'brand_brief',title:'Complete KB',body}];}
   else if(sql.includes("SELECT 'source'::text record_kind"))rows=[{record_kind:'source',id:sourceId,source_id:null,source_kind:'brand_brief',authority_digest:sourceDigest}];
   return{rows:rows as T[],rowCount:rows.length};}};
 const prepared=await prepareSignalSemanticContextProposalInputV1({queryable,workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},generation_key:'semantic-context-v1'});
 const kb=prepared.input.knowledge_blocks.filter(block=>block.source_kind==='knowledge_source');
 assert.ok(kb.length>1);assert.equal(kb.map(block=>block.text).join(''),body);
 assert.equal(new Set(kb.map(block=>block.source_alias)).size,1);assert.equal(prepared.source_refs.size,2);
 assert.ok(JSON.stringify(prepared.prompt).includes('TAIL_BEYOND_FOUR_THOUSAND'));
 assert.ok(JSON.stringify(prepared.prompt).includes('DISTINCT_BRAND_DESCRIPTION'));
 assert.match(profileQuery,/metadata->>'description'/u);
 assert.doesNotMatch(profileQuery,/JOIN brands/u,
  'prompt identity must come from the immutable profile rather than mutable brand fields');
});

test('proposal preflight receives only exact runtime capabilities, excluding BigInt money and extra objects',async()=>{
 const { signalBrandContextProposalRuntimeCapabilitiesV1 }=await import('./signal-brand-context-preparation');
 const { loadSignalSemanticContextProposalPreflightRuntimeV1 }=await import('./signal-semantic-context-proposal');
 const contaminated={...runtime,worker_alive:false,extra:{amount:1n}};
 const capabilities=signalBrandContextProposalRuntimeCapabilitiesV1(contaminated);
 assert.deepEqual(capabilities,{queue_configured:true,worker_alive:false,recovery_alive:true});
 assert.deepEqual(Object.keys(capabilities).sort(),['queue_configured','recovery_alive','worker_alive']);
 assert.doesNotThrow(()=>JSON.stringify(capabilities));
 const queryable:SignalSemanticContextQueryable={async query(){return{rows:[],rowCount:0};}};
 const args={queryable,workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},
   actor:{id:actor,user_type:'noisia_internal' as const},configuration:{...runtime.semantic,available:false}};
 await assert.rejects(loadSignalSemanticContextProposalPreflightRuntimeV1({...args,runtime:contaminated}),/BigInt/u);
 const preflight=await loadSignalSemanticContextProposalPreflightRuntimeV1({...args,runtime:capabilities});
 assert.deepEqual(preflight.runtime,capabilities);assert.match(preflight.preflight_digest,/^sha256:[0-9a-f]{64}$/u);
 assert.ok(preflight.blockers.includes('proposal_worker_unavailable'));
 assert.equal(preflight.provider_calls,0);assert.doesNotThrow(()=>JSON.stringify(preflight));
});
