import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {loadSignalTopicInheritedContextStoreV1} from './signal-topic-catalog';
import {loadSignalWorkspaceAutonomousContextInputsV1} from './signal-workspace-topic-prototype-inputs';
import {signalSemanticContextProposalDigestV1,signalWorkspaceEmbeddingDigestV1,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from '@noisia/query-engine';
import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import {signalBrandOsCanonicalSnapshotHashV1,type SignalBrandOsCanonicalSnapshotV1} from './signal-brand-os-snapshot';
import {loadSignalWorkspaceTopicPrototypesV1,quoteSignalWorkspaceTopicPrototypesV1,requestSignalWorkspaceTopicPrototypesV1} from './signal-workspace-topic-prototypes-management';
import {claimSignalWorkspaceEmbeddingRunV1} from './signal-workspace-embeddings';

const workspaceId='10000000-0000-4000-8000-000000000001';
const sha=(value:string)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
type Locale={primary_locale:string|null;locale_variants:string[];markets:string[];timezone:string};
function source(locale:Locale|null,brief:unknown=null,successor?:{status:string;locale:Locale}){
  const queries:string[]=[];
  const selected=successor?.status==='published'?successor.locale:locale;
  const sealed=brandContextSnapshotFixtureV1(workspaceId,selected?.markets??['MX']).snapshot;
  let live:SignalBrandOsCanonicalSnapshotV1=structuredClone(sealed);
  let profileDigest=signalBrandOsCanonicalSnapshotHashV1(sealed);
  let sources:Array<{id:string;source_kind:string;file_hash:null;content_digest:string}>=[];
  let currentBrief=brief;
  const canonical=(value:string)=>{try{return new Intl.Locale(value).toString();}catch{return value;}};
  const authority={brand_os_digest:profileDigest,knowledge_digest:signalSemanticContextProposalDigestV1({sources:[],chunks:[]}),
    locale_context_digest:signalSemanticContextProposalDigestV1({primary_locale:selected?.primary_locale==null?null:canonical(selected.primary_locale),
      locale_variants:[...new Set(selected?.locale_variants.map(canonical)??[])].sort(),markets:[...(selected?.markets??[])].sort(),timezone:selected?.timezone})};
  const queryable={async query<Row extends Record<string,unknown>>(sql:string,params?:unknown[]){queries.push(sql);let rows:unknown[]=[];
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE)/u.test(sql));
    if(sql.includes('AS workspace_id, brand.id::text AS brand_id'))rows=[{workspace_id:workspaceId,brand_id:workspaceId,
      brand_name:'Synthetic brand',brand_slug:'synthetic',brand_handles:[],description:'Brand evidence',industry:null,industry_sub:null,countries:['MX']}];
    else if(sql.includes("SELECT 'primary_brand'::text AS scope"))rows=[{scope:'primary_brand',entity_id:workspaceId,entity_label:'Synthetic brand',aliases:[]}];
    else if(sql.includes("SELECT 'brand_objective' AS kind"))rows=[];
    else if(sql.includes('SELECT plan.acquisition_brief,workspace.timezone'))rows=[{acquisition_brief:currentBrief,
      timezone:brief==null?selected?.timezone??'America/Mexico_City':'America/Mexico_City',organization_id:workspaceId,brand_id:workspaceId}];
    else if(sql.includes('WITH active_profile AS('))rows=[];
    else if(sql.includes('WITH generation AS(')){
      assert.deepEqual(params,[workspaceId]);
      assert.match(sql,/generation\.status='published'/u);
      assert.match(sql,/ORDER BY generation\.generation_version DESC LIMIT 1/u);
      assert.doesNotMatch(sql,/successor\.supersedes_generation_id=generation\.id/u,
        'an unpublished successor must not remove the latest published generation');
      assert.match(sql,/element\.disposition='approved' AND element\.lifecycle_state='active'/u);
      assert.match(sql,/generation\.primary_locale,generation\.locale_variants,generation\.markets,generation\.timezone/u);
      const version=successor?.status==='published'?5:4;
      rows=selected?[{generation_id:workspaceId,generation_key:`semantic-context-v${version}`,generation_version:version,generation_status:'published',
        pack_digest:sha(`pack${version}`),draft_digest:sha(`draft${version}`),...selected,...authority,element_id:workspaceId,element_key:'benefit.repair',element_version:2,
        element_kind:'benefit',display_text:'Published benefit',canonical_key:'repair',scope:null,relation_kind:null,relation_target_key:null,
        element_digest:sha('element')}]:[];
    }else if(sql.includes('FROM brand_os_profiles profile WHERE profile.brand_id=')){
      assert.deepEqual(params,[workspaceId,workspaceId]);rows=[{id:workspaceId,version:1,digest:profileDigest,countries:live.countries}];
    }else if(sql.includes('AS name,brand.description'))rows=[live];
    else if(sql.includes('SELECT acquisition_brief brief'))rows=currentBrief==null?[]:[{brief:currentBrief}];
    else if(sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS'))rows=[{
      knowledge_digest:signalSemanticContextProposalDigestV1({sources:sources.map(item=>({
        id:item.id,kind:item.source_kind,digest:item.content_digest})),chunks:[]})}];
    else throw new Error('Unexpected context query');
    return{rows:rows as Row[],rowCount:rows.length};}};
  return{queryable,queries,drift(kind:'brand_os'|'knowledge'|'locale'|'unreconciled'){
    if(kind==='knowledge')sources=[{id:workspaceId,source_kind:'text',file_hash:null,content_digest:sha('new KB')}];
    else if(kind==='locale')currentBrief={primary_locale:'en-US',languages:['en-US'],countries:['US']};
    else{live={...live,description:'Changed description'};if(kind==='brand_os')profileDigest=signalBrandOsCanonicalSnapshotHashV1(live);}
  }};
}
for(const [country,primary,timezone] of [['JP','ja-JP','Asia/Tokyo'],['BR','pt-BR','America/Sao_Paulo'],['MX','es-MX','America/Mexico_City']]){
  test(`${country}: Topics and prototype inputs inherit the published locale without a hidden acquisition brief`,async()=>{
    const f=source({primary_locale:primary!,locale_variants:[primary!],markets:[country!],timezone:timezone!});
    const inherited=await loadSignalTopicInheritedContextStoreV1({...f,workspace_id:workspaceId,complete_context:true});
    assert.deepEqual(inherited.locale,{primary_locale:primary,languages:[primary],markets:[country],timezone});
    const plan=await loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId});
    assert.deepEqual(plan.context.locale,inherited.locale);assert.equal(plan.context.context_digest,inherited.context_digest);
    assert.ok(plan.context_inputs.length>0);
    for(const [hash,text]of Object.entries(plan.texts))assert.equal(hash,sha(text));
    const texts=Object.values(plan.texts).join('\n');assert.ok(texts.includes(`Languages: ${primary}`));assert.ok(texts.includes(`Markets: ${country}`));
    assert.equal(inherited.context_refs.filter(ref=>ref.source_type==='semantic_context_element').length,1);
    assert.ok(!texts.includes('Languages: es-MX')||country==='MX');
  });
}
test('an explicit acquisition plan overrides serving locale but cannot replace current published authority for new inputs',async()=>{
  const brief={primary_locale:'en-US',languages:['es-MX','en-US'],countries:['US','MX']};
  for(const published of [null,{primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'}]){
    const f=source(published,brief);
    const context=await loadSignalTopicInheritedContextStoreV1({...f,workspace_id:workspaceId});
    assert.deepEqual(context.locale,{primary_locale:'en-US',languages:['en-US','es-MX'],markets:['MX','US'],timezone:'America/Mexico_City'});
    await assert.rejects(loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId}),
      published?/brand_context_source_stale/u:/brand_context_semantic_context_required/u);
  }
});
test('an explicit plan and published generation with exactly the same authority can prepare inputs',async()=>{
  const locale={primary_locale:'en-US',locale_variants:['en-US','es-MX'],markets:['MX','US'],timezone:'America/Mexico_City'};
  const brief={primary_locale:'en-US',languages:locale.locale_variants,countries:locale.markets};
  const inputs=await loadSignalWorkspaceAutonomousContextInputsV1({...source(locale,brief),workspace_id:workspaceId});
  assert.deepEqual(inputs.context.locale,{primary_locale:'en-US',languages:locale.locale_variants,markets:locale.markets,timezone:locale.timezone});
});
test('published locale variants are canonical and deterministic; locale-only changes invalidate plan inputs',async()=>{
  const locale={primary_locale:'pt-br',locale_variants:['pt-br','pt-BR','en-US'],markets:['BR'],timezone:'America/Sao_Paulo'};
  const first=await loadSignalTopicInheritedContextStoreV1({...source(locale),workspace_id:workspaceId});
  const same=await loadSignalTopicInheritedContextStoreV1({...source({...locale,primary_locale:'pt-BR',locale_variants:['en-US','pt-BR']}),workspace_id:workspaceId});
  assert.deepEqual(first,same);assert.deepEqual(first.locale.languages,['en-US','pt-BR']);
  const changed=await loadSignalTopicInheritedContextStoreV1({...source({...locale,primary_locale:'ja-JP',locale_variants:['ja-JP']}),workspace_id:workspaceId});
  assert.notEqual(changed.context_digest,first.context_digest);
  assert.notDeepEqual(changed.embedding_contexts,first.embedding_contexts);
});
test('missing published authority stays visible as missing; prototypes never infer Spanish from a country',async()=>{
  const f=source(null);
  const context=await loadSignalTopicInheritedContextStoreV1({...f,workspace_id:workspaceId});
  assert.equal(context.locale.primary_locale,null);assert.deepEqual(context.locale.languages,[]);
  await assert.rejects(loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId}),/brand_context_semantic_context_required/u);
  const malformedPlan=source({primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'},{});
  await assert.rejects(loadSignalWorkspaceAutonomousContextInputsV1({...malformedPlan,workspace_id:workspaceId}),/brand_context_source_stale/u,
    'an explicit but incomplete plan cannot silently borrow a different authority');
});
test('invalid or absent published primary locale is not replaced by a variant',async()=>{
  for(const primary of [null,'und','es_MX','not a locale']){
    const f=source({primary_locale:primary,locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'});
    await assert.rejects(loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId}),/workspace_topic_locale_required|brand_context_source_stale/u);
  }
});

test('only a published successor replaces serving locale, approved context and prototype identity',async()=>{
  const prior={primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'};
  const child={primary_locale:'pt-BR',locale_variants:['pt-BR'],markets:['BR'],timezone:'America/Sao_Paulo'};
  const baseline=await loadSignalWorkspaceAutonomousContextInputsV1({...source(prior),workspace_id:workspaceId});
  for(const status of ['draft','failed']){
    const pending=await loadSignalWorkspaceAutonomousContextInputsV1({...source(prior,null,{status,locale:child}),workspace_id:workspaceId});
    assert.deepEqual(pending,baseline);
  }
  const published=await loadSignalWorkspaceAutonomousContextInputsV1({...source(prior,null,{status:'published',locale:child}),workspace_id:workspaceId});
  assert.equal(published.context.locale.primary_locale,'pt-BR');
  assert.notEqual(published.context.context_digest,baseline.context.context_digest);
  assert.ok(published.context.context_refs.some(ref=>ref.version==='semantic-context:semantic-context-v5:2'));
});

for(const drift of ['brand_os','knowledge','locale','unreconciled'] as const){
  test(`${drift} drift blocks new prototype inputs while the prior published pack remains readable`,async()=>{
    const locale={primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'};
    const f=source(locale,null,{status:'draft',locale});
    const initial=await loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId});
    f.drift(drift);
    await assert.rejects(loadSignalWorkspaceAutonomousContextInputsV1({...f,workspace_id:workspaceId}),
      error=>error instanceof Error&&'code'in error&&error.code==='brand_context_source_stale');
    const historical=await loadSignalTopicInheritedContextStoreV1({...f,workspace_id:workspaceId});
    assert.deepEqual(historical.context_refs,initial.context.context_refs,'published element identity remains available to serving');
    assert.ok(historical.embedding_text.includes('Published benefit'));
    assert.equal(f.queries.some(sql=>/^\s*(INSERT|UPDATE|DELETE)/u.test(sql)),false);
  });
}

// Public quote/request/status/claim use the actual plan and authority resolvers.
// Only persistence is a query double; no DB connection or provider is installed.
function stores(context:ReturnType<typeof source>){
  const statements:string[]=[],writes:unknown[][]=[];
  const now='2026-09-11T12:00:00.000000Z';
  let replay:Record<string,unknown>|null=null;
  let hasCatalog=true;
  const counts={total_topics:0,completed_topics:0,partial_topics:0,pending_topics:0,total_input_references:0,
    processed_input_references:0,total_unique_inputs:0,processed_unique_inputs:0,cache_hits:0,embedded_unique_inputs:0};
  const completed={id:workspaceId,status:'completed',topic_input_digest:sha('paid historical plan'),counts,
    hard_cap_micro_usd:1000,estimated_upper_micro_usd:100,reserved_micro_usd:0,settled_micro_usd:42,
    unknown_reserved_micro_usd:0,observed_exception_micro_usd:0,error_code:null,created_at:now,updated_at:now,completed_at:now};
  const client={release(){},async query<Row extends Record<string,unknown>>(sql:string,values:unknown[]=[]){
    statements.push(sql);let rows:unknown[]=[];
    if(sql.startsWith('BEGIN')||['COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL')||sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('actor.status actor_status'))rows=[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}];
    else if(sql.startsWith('SELECT id,taxonomy_id FROM signal_taxonomy_profiles'))rows=hasCatalog?[{id:workspaceId,taxonomy_id:workspaceId}]:[];
    else if(sql.includes("metadata->>'catalog_role' catalog_role,metadata->>'source_catalog_profile_id' source_catalog_profile_id")){
      assert.deepEqual(values,[workspaceId]);
      assert.match(sql,/FROM signal_taxonomy_profiles WHERE workspace_id=\$1::uuid AND kind='topic'/u);
      assert.match(sql,/metadata->>'contract_version'='signal-topic-catalog-v1'/u);
      rows=hasCatalog?[{id:workspaceId,taxonomy_id:workspaceId,version:1,status:'draft',context_hash:sha('working catalog'),
        created_at:now,updated_at:now,catalog_role:'working',source_catalog_profile_id:null}]:[];
    }
    else if(sql.startsWith('SELECT id,metadata,status FROM taxonomy_terms'))rows=[];
    else if(sql.startsWith('SELECT signal_topic_membership_override_digest_v1'))rows=[{digest:sha('corrections')}];
    else if(sql.startsWith('SELECT chunk_sha256 FROM signal_workspace_chunk_embeddings'))rows=[];
    else if(sql.startsWith('WITH resumable AS MATERIALIZED'))rows=[{observed_at:now,resume_run_id:null,required_cap_micro_usd:null,
      blocking_run_kind:null,blocked_status:null,recoverable_input_keys:[]}];
    else if(sql.startsWith('SELECT id,status,error_code,topic_input_digest'))rows=replay?[replay]:[];
    else if(sql.startsWith('WITH recent AS MATERIALIZED'))rows=[{observed_at:now,active_run:null,latest_run:completed,
      latest_completed:completed,request_run:completed,blocking_run_kind:null}];
    else if(sql.startsWith('SELECT workspace_id,input_contract FROM signal_workspace_embedding_runs'))rows=[{workspace_id:workspaceId,input_contract:'topic_prototypes'}];
    else if(sql.startsWith('SELECT run.id,run.workspace_id,run.preparation_run_id'))rows=[{id:workspaceId,workspace_id:workspaceId,
      actor_user_id:workspaceId,input_contract:'topic_prototypes',status:'queued',worker_job_id:'synthetic-prototypes',
      profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,execution_live:false,policy_live:true,taxonomy_profile_id:workspaceId,
      topic_input_digest:sha('queued prior plan')}];
    else if(sql.startsWith('UPDATE signal_workspace_embedding_runs SET status=$2')){
      assert.deepEqual(values,[workspaceId,'stale','workspace_embedding_inputs_changed']);writes.push(values);
    }else return context.queryable.query<Row>(sql,values);
    return{rows:rows as Row[],rowCount:rows.length};}};
  const database={query:client.query,async connect(){return client;}} as unknown as Pool;
  return{database,completed,statements,writes,removeCatalog(){hasCatalog=false;},setReplay(value:Record<string,unknown>){replay=value;}};
}
for(const drift of ['brand_os','knowledge','locale','unreconciled','missing'] as const){
  test(`${drift}: public quote/request block; historical receipt survives and a queued worker cannot send`,async()=>{
    const context=source(drift==='missing'?null:{primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'});
    const f=stores(context),args={database:f.database,workspace_id:workspaceId,actor_user_id:workspaceId};
    const quote=drift==='missing'?{plan_digest:sha('old plan'),quote_digest:sha('old quote')}:
      await quoteSignalWorkspaceTopicPrototypesV1(args);
    if(drift!=='missing')context.drift(drift);
    const errorCode=drift==='missing'?/brand_context_semantic_context_required/u:/brand_context_source_stale/u;
    const cachedQueries=f.statements.filter(sql=>sql.startsWith('SELECT chunk_sha256')).length;
    await assert.rejects(quoteSignalWorkspaceTopicPrototypesV1(args),errorCode);
    const request={...args,...quote,idempotency_key:'prior-prototype-intent',hard_cap_micro_usd:1000,
      max_run_cost_micro_usd:1000,provider_available:true};
    await assert.rejects(requestSignalWorkspaceTopicPrototypesV1(request),errorCode);
    assert.equal(f.statements.filter(sql=>sql.startsWith('SELECT chunk_sha256')).length,cachedQueries,'no new budget quote after stale authority');
    const status=await loadSignalWorkspaceTopicPrototypesV1({...args,idempotency_key:request.idempotency_key});
    assert.equal(status.is_current,false);assert.equal(status.current_plan_digest,null);
    assert.equal(status.availability,drift==='missing'?'context_required':'context_stale');
    assert.equal(status.latest_completed?.id,f.completed.id);assert.equal(status.latest_completed?.settled_micro_usd,42);
    assert.equal(status.request_run?.id,f.completed.id);assert.deepEqual(f.writes,[]);
    f.setReplay({...f.completed,actor:workspaceId,digest:signalWorkspaceEmbeddingDigestV1({input_contract:'topic_prototypes',
      plan_digest:request.plan_digest,quote_digest:request.quote_digest,hard_cap_micro_usd:1000,profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1})});
    const before=context.queries.length;
    assert.deepEqual(await requestSignalWorkspaceTopicPrototypesV1({...request,provider_available:false}),{run_id:workspaceId,replayed:true});
    assert.equal(context.queries.length,before,'accepted replay does not read changed authority or create another run');
    assert.equal(await claimSignalWorkspaceEmbeddingRunV1({database:f.database,run_id:workspaceId,worker_job_id:'synthetic-prototypes'}),null);
    assert.equal(f.writes.length,1,'only the queued run is marked stale; no lease, reservation or outbox is created');
  });
}
test('missing catalog does not hide semantic publication blockers behind an impossible initialization action',async()=>{
  for(const availability of ['no_topics','context_required','context_stale']){
    const context=source(availability==='context_required'?null:{primary_locale:'ja-JP',locale_variants:['ja-JP'],markets:['JP'],timezone:'Asia/Tokyo'});
    if(availability==='context_stale')context.drift('knowledge');
    const f=stores(context);f.removeCatalog();
    const status=await loadSignalWorkspaceTopicPrototypesV1({database:f.database,workspace_id:workspaceId,actor_user_id:workspaceId});
    assert.equal(status.availability,availability);assert.equal(status.is_current,false);assert.deepEqual(f.writes,[]);
  }
});
