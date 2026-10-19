import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {signalSemanticContextProposalDigestV1 as digest, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from '@noisia/query-engine';
import {advanceSignalBrandContextPreparationsV1, ensureSignalBrandContextPreparationV1, quoteSignalBrandContextPreparationV1,
  type SignalBrandContextPreparationRuntimeV1} from './signal-brand-context-preparation';
import {resolveSignalBrandContextAuthorityV1} from './signal-brand-context-authority';
import {quoteSignalWorkspaceTopicPrototypesWithQueryableV1} from './signal-workspace-topic-prototypes-management';
import {loadSignalWorkspaceTopicPrototypePlanV1} from './signal-workspace-topic-prototype-inputs';
import {buildSignalSemanticContextProposalRuntimeLineageV1,type SignalSemanticContextQueryable} from './signal-semantic-context-proposal';

const actor='10000000-0000-4000-8000-000000000001',workspaceId='10000000-0000-4000-8000-000000000002';
const generationId='10000000-0000-4000-8000-000000000003',runId='10000000-0000-4000-8000-000000000004';
const profileId='10000000-0000-4000-8000-000000000005';
const runtime:SignalBrandContextPreparationRuntimeV1={semantic:{available:true,provider:'anthropic',model:'claude-sonnet-4-6',model_version:'claude-sonnet-4-6',
  pricing_version:'renewal-test',max_input_tokens:20000,max_output_tokens:16000,model_max_output_tokens:64000,
  input_usd_per_million_tokens:'3',output_usd_per_million_tokens:'15',platform_hard_cap_micro_usd:500000n},
  prototype:{available:true,max_run_cost_micro_usd:20000},queue_configured:true,worker_alive:true,recovery_alive:true};
type Op={id:string;workspace_id:string;actor_user_id:string;action:string;request_digest:string;idempotency_key:string;status:string;
  result:Record<string,unknown>|null;brand_context_preparation:Record<string,any>|null;created_at:number;brand_context_progress:null};

// Public ensure/advance and both original retry stores run here. The query double
// models elapsed DB time and the SQL grant contract; it is not a PG substitute.
// The companion SQL assertions below pin that model to the migration's latest-op
// lookup, original identity/caps and send-time authority checks.
async function fixture(phase:'semantic'|'prototype'){
  let now=new Date('2026-09-11T10:01:00Z'),clock=0,run:Record<string,any>|null=null;
  let sourceAvailable=true,uncertain=false,knowledgeValue='source';
  const completedReceipts=false,successor=false;
  const operations:Op[]=[],queries:string[]=[],writes:string[]=[],newRuns:Record<string,any>[]=[],oldGenerations:Record<string,unknown>[]=[],newArtifacts:unknown[][]=[];
  let reviewable=false;
  const source:SignalSemanticContextQueryable={async query<Row>(sql:string){let rows:unknown[]=[];
    if(sql.includes("SELECT 'knowledge_source'::text"))rows=[{source_type:'knowledge_source',id:actor,parent_id:null,content_kind:'brand_brief',title:'Synthetic',body:'Complete synthetic evidence.'}];
    else if(sql.includes("SELECT 'source'::text record_kind"))rows=[{record_kind:'source',id:actor,source_id:null,source_kind:'brand_brief',authority_digest:digest(knowledgeValue)}];
    else if(sql.includes('FROM brand_os_profiles')&&sql.includes(' display_name'))rows=[{id:actor,display_name:'Synthetic',aliases:[],industry:null,industry_sub:null,description:null,metadata:{snapshot_hash:brandContextSnapshotFixtureV1(actor).digest}}];
    else if(sql.includes('FROM brand_os_profiles'))rows=sourceAvailable?[{id:actor,version:1,digest:brandContextSnapshotFixtureV1(actor).digest,countries:['MX']}]:[];
    else if(sql.includes('AS name,brand.description'))rows=[brandContextSnapshotFixtureV1(actor).snapshot];
    else if(sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS'))rows=[{knowledge_digest:digest({
      sources:[{id:actor,kind:'brand_brief',digest:digest(knowledgeValue)}],chunks:[]})}];
    return{rows:rows as Row[],rowCount:rows.length};}};
  const live=await resolveSignalBrandContextAuthorityV1({queryable:source,workspace:{id:workspaceId,organizationId:actor,subject:{type:'brand',id:actor},timezone:'America/Mexico_City'}});
  const generation={id:generationId,generation_key:'semantic-context-v1',generation_version:1,status:phase==='semantic'?'draft':'published',
    source_digest:live.sourceAuthorityDigest,brand_os_profile_id:live.brandOsProfileId,brand_os_digest:live.brandOsDigest,knowledge_digest:live.knowledgeDigest,locale_context_digest:live.localeContextDigest,proposal_provider_lineage:buildSignalSemanticContextProposalRuntimeLineageV1(runtime.semantic),proposal_provider_lineage_digest:digest('lineage')};
  const latest=()=>operations.filter(op=>op.action==='prepare-brand-context'&&op.status==='completed'&&op.brand_context_preparation?.admission)
    .sort((a,b)=>b.created_at-a.created_at)[0];
  const admissionValid=()=>{
    const origin=operations.find(op=>op.id===run?.brand_context_preparation_operation_id),fresh=latest();
    if(!origin||!fresh||successor||fresh.actor_user_id!==origin.actor_user_id)return false;
    const a=origin.brand_context_preparation!.admission,b=fresh.brand_context_preparation!.admission;
    return ['configuration_digest','semantic_cap_micro_usd','prototype_cap_micro_usd'].every(key=>a[key]===b[key])
      && Date.parse(b.admission_not_after)>now.getTime();
  };
  const completedHistory=()=>Boolean(run?.status==='completed'&&run.provider_call_state==='settled'&&run.provider_call_count===1&&run.provider_response_private&&run.provider_response_digest&&run.settled_micro_usd!=null&&!run.lease_token&&!run.reserved&&!run.activeOutbox&&!uncertain);
  const safeUnspent=()=>Boolean(run?.status==='failed'||run?.status==='canceled')&&!uncertain&&!run?.paid;
  const compatible=(operationId:unknown)=>{const origin=operations.find(op=>op.id===run?.brand_context_preparation_operation_id),fresh=operations.find(op=>op.id===operationId);
    return Boolean(origin&&fresh&&origin.actor_user_id===fresh.actor_user_id&&['configuration_digest','semantic_cap_micro_usd','prototype_cap_micro_usd'].every(key=>origin.brand_context_preparation!.admission[key]===fresh.brand_context_preparation!.admission[key]));};
  const retryable=()=>Boolean(run?.status==='failed'&&!uncertain&&(admissionValid()||phase==='prototype'&&completedReceipts));
  const client={release(){},async query<Row extends Record<string,unknown>>(sql:string,values:unknown[]=[]){
    queries.push(sql);let rows:unknown[]=[];
    if(/^\s*(INSERT|UPDATE|DELETE)/u.test(sql))writes.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('actor.status actor_status'))rows=[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}];
    else if(sql.includes("u.user_type='noisia_internal'"))rows=[{organization_id:actor,brand_id:actor,timezone:'America/Mexico_City',internal:true}];
    else if(sql==='SELECT clock_timestamp() now')rows=[{now}];
    else if(sql.startsWith('SELECT * FROM signal_governance_control_operations'))rows=operations.filter(op=>sql.includes('WHERE id=')?op.id===values[0]:op.workspace_id===values[0]&&op.idempotency_key===values[1]);
    else if(sql.startsWith('INSERT INTO signal_governance_control_operations')){
      if(!operations.some(op=>op.idempotency_key===values[4]))operations.push({id:`op-${++clock}`,workspace_id:String(values[0]),actor_user_id:String(values[1]),
        action:String(values[2]),request_digest:String(values[3]),idempotency_key:String(values[4]),status:'in_progress',result:null,
        brand_context_preparation:values[5]?JSON.parse(String(values[5])):null,created_at:now.getTime()+clock,brand_context_progress:null});
      rows=operations.filter(op=>op.idempotency_key===values[4]);
    }else if(sql.includes('SET brand_context_progress=')){throw new Error('Coordinator error: '+values[1]);
    }else if(sql.startsWith('UPDATE signal_governance_control_operations SET')){
      const byId=sql.includes('WHERE id=');const op=operations.find(op=>byId?op.id===values[0]:op.workspace_id===values[0]&&op.idempotency_key===values[1])!;
      op.result=JSON.parse(String(values[byId?1:2]));op.status='completed';return{rows:[] as Row[],rowCount:1};
    }else if(sql.startsWith('SELECT id::text,actor_user_id::text,'))rows=operations.filter(op=>op.idempotency_key===values[1]);
    else if(sql.includes('signal_data_governance_actor_is_valid(workspace.id'))rows=[{allowed:true}];
    else if(sql.startsWith('SELECT gen.*,artifact.')||sql.startsWith('SELECT * FROM signal_semantic_context_generations'))rows=[generation];
    else if(sql.startsWith('SELECT run.id,run.created_by_user_id'))rows=phase==='semantic'&&run&&run.generation_id===values[0]?[{id:runId,created_by_user_id:run.created_by_user_id,safe_unspent:run.status==='failed'&&!uncertain,completed_history:completedHistory(),
      configuration_digest:operations[0]?.brand_context_preparation?.admission?.configuration_digest}]:[];
    else if(sql.startsWith('SELECT run.id,run.actor_user_id,'))rows=phase==='prototype'&&run&&run.status!=='canceled'&&run.brand_context_preparation_operation_id
      &&operations.find(op=>op.id===run!.brand_context_preparation_operation_id)?.brand_context_preparation?.admission.configuration_digest!==values[1]
      ?[{id:run.id,actor_user_id:actor,safe_unspent:safeUnspent()}]:[];
    else if(sql.startsWith('SELECT 1 FROM signal_semantic_context_element_versions'))rows=reviewable?[{present:true}]:[];
    else if(sql.startsWith('INSERT INTO analysis_artifacts')){newArtifacts.push(structuredClone(values));rows=[{id:'new-artifact'}];}
    else if(sql.startsWith('INSERT INTO signal_semantic_context_generations')){oldGenerations.push(structuredClone(generation));Object.assign(generation,{id:'new-generation',generation_key:values[2],generation_version:values[3],status:'draft',source_digest:newArtifacts.at(-1)![1],brand_os_profile_id:values[6],brand_os_digest:values[8],knowledge_digest:values[10],locale_context_digest:values[11],
      proposal_provider_lineage:JSON.parse(String(values[20])),proposal_provider_lineage_digest:values[21]});rows=[generation];}
    else if(sql.startsWith('INSERT INTO signal_semantic_context_events')){}
    else if(sql.startsWith('SELECT op.* FROM signal_governance_control_operations')){
      assert.match(sql,/signal_brand_context_semantic_retryable_v1\(run.id\)/u);
      assert.match(sql,/signal_brand_context_prototype_retryable_v1\(embed.id\)/u);
      assert.match(sql,/\(later.created_at,later.id\)>\(op.created_at,op.id\)/u);
      rows=!newRuns.length&&(retryable()||phase==='prototype'&&(run?.brand_context_preparation_operation_id==null||run?.status==='canceled'&&safeUnspent()))&&latest()?[latest()!]:[];
    }else if(sql.startsWith('SELECT id,run_key,status,'))rows=phase==='semantic'&&run?[{...run,retryable:retryable(),recovery_count:operations.filter(op=>op.action==='retry-semantic-context-proposal-run').length}]:
      phase==='prototype'?[{id:'paid-semantic',status:'completed',retryable:false}]:[];
    else if(sql.startsWith('SELECT run.id::text,run.workspace_id::text,'))rows=run?[run]:[];
    else if(sql.startsWith('UPDATE signal_semantic_context_proposal_runs SET status=')){
      assert.equal(phase,'semantic');assert.equal(retryable(),true);run!.status='queued';run!.error_code=null;
    }else if(sql.startsWith('UPDATE signal_semantic_context_proposal_outbox SET')){assert.equal(run!.status,'queued');run!.outbox='pending';}
    else if(sql.startsWith('INSERT INTO signal_semantic_context_proposal_run_events')){}
    else if(sql.startsWith('SELECT embed.id,embed.status,'))rows=run&&run.brand_context_preparation_operation_id&&run.status!=='canceled'?[{...run,retryable:retryable()}]:[];
    else if(sql.includes('SELECT id::text,taxonomy_id::text,version,status')||sql.startsWith('SELECT id,taxonomy_id FROM signal_taxonomy_profiles'))
      rows=[{id:profileId,taxonomy_id:profileId,version:1,status:'draft'}];
    else if(sql.startsWith('SELECT id,metadata,status FROM taxonomy_terms'))rows=[];
    else if(sql.startsWith('SELECT signal_topic_membership_override_digest_v1'))rows=[{digest:digest('corrections')}];
    else if(sql.includes('AS workspace_id, brand.id::text AS brand_id'))rows=[{workspace_id:workspaceId,brand_id:actor,brand_name:'Synthetic',brand_slug:'synthetic',brand_handles:[],description:'Context',industry:null,industry_sub:null,countries:['MX']}];
    else if(sql.includes("SELECT 'primary_brand'::text AS scope")||sql.includes("SELECT 'brand_objective' AS kind")||sql.includes('WITH active_profile AS('))rows=[];
    else if(sql.includes('SELECT plan.acquisition_brief,workspace.timezone'))rows=[{acquisition_brief:null,timezone:'America/Mexico_City',organization_id:actor,brand_id:actor}];
    else if(sql.includes('WITH generation AS('))rows=[{generation_id:generationId,generation_key:generation.generation_key,generation_version:1,generation_status:'published',
      brand_os_digest:generation.brand_os_digest,knowledge_digest:generation.knowledge_digest,locale_context_digest:generation.locale_context_digest,
      pack_digest:digest('published'),draft_digest:digest('draft'),primary_locale:'es-MX',locale_variants:['es-MX'],markets:['MX'],timezone:'America/Mexico_City',element_id:null}];
    else if(sql.startsWith('SELECT chunk_sha256 FROM signal_workspace_chunk_embeddings'))rows=[];
    else if(sql.startsWith('WITH resumable AS MATERIALIZED')){
      assert.equal(values[2],run?.topic_input_digest);const resumable=run?.status==='failed'&&(values[6]===undefined||compatible(values[6]));rows=[{observed_at:now.toISOString().replace('000Z','000000Z'),resume_run_id:resumable?runId:null,
        required_cap_micro_usd:resumable?'20000':null,blocking_run_kind:null,blocked_status:null,recoverable_input_keys:[]}];
    }else if(sql.startsWith('SELECT id,status,error_code,topic_input_digest'))rows=[];
    else if(sql.includes(' compatible\n')&&sql.includes('FOR UPDATE OF run'))rows=[{compatible:compatible(values[2])}];
    else if(sql.startsWith('INSERT INTO signal_workspace_embedding_runs')){
      assert.ok(values[14],'new Brand Context run must retain the admission pointer');
      newRuns.push({id:values[0],status:'queued',hard_cap_micro_usd:values[10],brand_context_preparation_operation_id:values[14],request_keys:JSON.parse(String(values[9]))});
    }else if(sql.startsWith("UPDATE signal_workspace_embedding_runs SET status='canceled'")){
      assert.equal(safeUnspent(),true);assert.ok(operations.some(op=>op.status==='in_progress'&&op.brand_context_preparation?.replaced_prototype_run_ids?.includes(run!.id)));
      run!.status='canceled';return{rows:[] as Row[],rowCount:1};
    }else if(sql.startsWith('UPDATE signal_workspace_embedding_runs SET status=')){
      assert.equal(phase,'prototype');assert.equal(retryable(),true);run!.status='queued';run!.dispatch_generation++;run!.error_code=null;
      run!.request_keys={...run!.request_keys,...JSON.parse(String(values[1]))};
      return{rows:[{id:runId}] as unknown as Row[],rowCount:1};
    }else if(sql.includes('FROM brand_os_profiles')||sql.includes('AS name,brand.description')||sql.includes('FROM brand_knowledge_sources')||sql.includes('FROM knowledge_chunks')
      ||sql.includes('FROM signal_acquisition_plans')||sql.includes('FROM brand_os_products')||sql.includes('FROM brand_os_competitors')||sql.includes('FROM brand_os_seed_terms')||sql.includes("brand_context_preparation->>'primary_locale'"))return source.query<Row>(sql,values);
    else throw new Error(`Unexpected query: ${sql.slice(0,100)}`);
    return{rows:rows as Row[],rowCount:rows.length};}};
  const database={query:client.query,async connect(){return client;}} as unknown as Pool;
  const args={database,workspace_id:workspaceId,actor_user_id:actor,runtime};
  const authorize=async(key:string,nextRuntime=runtime)=>ensureSignalBrandContextPreparationV1({...args,runtime:nextRuntime,idempotency_key:key,
    admission:{quote_digest:quoteSignalBrandContextPreparationV1({actor_user_id:actor,runtime:nextRuntime,now}).quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
  const initial=await authorize('original-admission');
  run={id:runId,run_key:'same-run',workspace_id:workspaceId,generation_id:generationId,created_by_user_id:actor,
    brand_context_preparation_operation_id:initial.operation_id,status:'failed',provider_call_state:'not_started',provider_call_count:0,
    provider_response_private:null,provider_response_digest:null,settled_micro_usd:null,error_code:phase==='semantic'?'provider_not_started':'workspace_embedding_definitely_not_sent',
    lease_token:null,hard_cap_micro_usd:phase==='semantic'?'500000':'20000',reservation_micro_usd:'17',queued_at:now.toISOString(),
    provider:'anthropic',model:'claude-sonnet-4-6',model_version:'claude-sonnet-4-6',pricing_version:runtime.semantic.pricing_version,
    dispatch_generation:1,request_keys:{original:true},config_digest:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,receipt_bytes:'unchanged'};
  if(phase==='prototype')run.topic_input_digest=(await loadSignalWorkspaceTopicPrototypePlanV1({...args,queryable:client})).plan_digest;
  return{args,initial,authorize,operations,queries,writes,newRuns,oldGenerations,newArtifacts,generation,client:client as unknown as PoolClient,
    changeKnowledge(){knowledgeValue='new source authority';},dropRun(){run=null;},reviewable(){reviewable=true;},get run(){return run!;},admissionValid,
    expire(){now=new Date(now.getTime()+25*60*60*1000);},noSource(){sourceAvailable=false;},makeUncertain(){uncertain=true;},
    mutateLatest(field:string,value:unknown){latest()!.brand_context_preparation!.admission[field]=value;}};
}
for(const phase of ['semantic','prototype'] as const)test(`${phase}: expired origin is renewed by a fresh same-config quote and advance resumes the original run`,async()=>{
  const f=await fixture(phase),originId=f.run.brand_context_preparation_operation_id,receipt=f.run.receipt_bytes;
  const originalReceipt=structuredClone(f.operations[0]);
  f.expire();assert.equal(f.admissionValid(),false);
  await assert.rejects(ensureSignalBrandContextPreparationV1({...f.args,idempotency_key:'expired-quote-new-intent',admission:{
    quote_digest:originalReceipt!.brand_context_preparation!.admission.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}}),
    error=>error instanceof Error&&'code' in error&&error.code==='brand_context_quote_changed');
  assert.deepEqual(await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId}),[]);
  const fresh=await f.authorize('fresh-admission');assert.notEqual(fresh.operation_id,originId);assert.equal(fresh.generation_id,f.initial.generation_id);
  assert.equal(f.admissionValid(),true);
  const resumed=await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId});
  assert.deepEqual(resumed,[{operation_id:fresh.operation_id,state:phase==='semantic'?'generating':'preparing_prototypes'}]);
  assert.equal(f.run.status,'queued');assert.equal(f.run.id,runId);assert.equal(f.run.brand_context_preparation_operation_id,originId);
  assert.equal(f.run.provider_call_count,0);assert.equal(f.run.receipt_bytes,receipt);
  assert.deepEqual(f.operations[0],originalReceipt,'renewal must not rewrite the original admission or its expiry');
  const after=structuredClone({run:f.run,operations:f.operations});f.noSource();
  const replay=await f.authorize('fresh-admission');assert.equal(replay.replayed,true);assert.equal(replay.operation_id,fresh.operation_id);
  assert.deepEqual({run:f.run,operations:f.operations},after);
  assert.deepEqual(await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId}),[]);
  assert.equal(f.writes.some(sql=>/INSERT INTO signal_(?:semantic_context_proposal_runs|workspace_embedding_runs|workspace_embedding_calls)/u.test(sql)),false);
});
for(const phase of ['semantic','prototype'] as const)test(`${phase}: fresh permission cannot select an uncertain run or mismatched immutable caps`,async()=>{
  const f=await fixture(phase);f.expire();await f.authorize('fresh-admission');
  f.mutateLatest('prototype_cap_micro_usd','20001');assert.equal(f.admissionValid(),false);
  assert.deepEqual(await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId}),[]);
  f.mutateLatest('prototype_cap_micro_usd','20000');f.makeUncertain();
  assert.deepEqual(await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId}),[]);assert.equal(f.run.status,'failed');
});
test('SQL renewal resolves the latest actor-bound admission while retry/send retain the immutable origin and receipt guards',async()=>{
  const sql=await readFile(new URL('./migrations/0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
  const admission=sql.split('CREATE FUNCTION signal_brand_context_admission_valid_v1')[1]!.split('$$;')[0]!;
  assert.match(admission,/JOIN LATERAL\(SELECT candidate\.\*/u);
  assert.match(admission,/candidate\.actor_user_id=origin\.actor_user_id/u);
  assert.match(admission,/candidate\.status='completed'/u);
  assert.match(admission,/ORDER BY candidate\.created_at DESC,candidate\.id DESC LIMIT 1/u);
  assert.match(admission,/\(op\.brand_context_preparation->'admission'->>'admission_not_after'\)::timestamptz>clock_timestamp\(\)/u);
  for(const key of ['configuration_digest','semantic_cap_micro_usd','prototype_cap_micro_usd']){
    assert.ok(admission.includes(`origin.brand_context_preparation->'admission'->>'${key}'`));
    assert.ok(admission.includes(`op.brand_context_preparation->'admission'->>'${key}'`));
  }
  for(const name of ['semantic','prototype']){
    const retry=sql.split(`CREATE FUNCTION signal_brand_context_${name}_retryable_v1`)[1]!.split('$$;')[0]!;
    assert.match(retry,/signal_brand_context_admission_valid_v1\(run\.brand_context_preparation_operation_id/u);
  }
  assert.match(sql,/Brand context run admission is immutable/u);
  assert.match(sql,/OLD\.provider_call_state='not_started' AND NEW\.provider_call_state='in_flight'/u);
  assert.match(sql,/OLD\.status='reserved' AND NEW\.status='in_flight'/u);
  assert.match(sql,/call\.status NOT IN\('definitely_not_sent','response_persisted','settled'\)/u);
});

test('Brand Context never resumes a legacy prototype: a new fenced run is created while the legacy row remains byte-identical',async()=>{
  const f=await fixture('prototype');f.run.brand_context_preparation_operation_id=null;
  const legacy=structuredClone(f.run);f.expire();const fresh=await f.authorize('legacy-new-permission');
  const q=await quoteSignalWorkspaceTopicPrototypesWithQueryableV1(f.client,{...f.args,brand_context_preparation_operation_id:fresh.operation_id});
  assert.equal(q.resume_run_id,null);assert.ok(q.requires_provider);
  const result=await advanceSignalBrandContextPreparationsV1({...f.args,workspace_id:workspaceId});
  assert.deepEqual(result,[{operation_id:fresh.operation_id,state:'preparing_prototypes'}]);
  assert.deepEqual(f.run,legacy);assert.equal(f.newRuns.length,1);
  assert.equal(f.newRuns[0]!.brand_context_preparation_operation_id,fresh.operation_id);
  assert.notEqual(f.newRuns[0]!.id,legacy.id);
  const resumableSql=f.queries.find(sql=>sql.startsWith('WITH resumable AS MATERIALIZED')&&sql.includes('preparation.id=$7'))!;
  for(const field of ['generation_id','configuration_digest','semantic_cap_micro_usd','prototype_cap_micro_usd'])assert.ok(resumableSql.includes(field));
  assert.match(resumableSql,/origin\.workspace_id=run\.workspace_id/u);assert.match(resumableSql,/origin\.actor_user_id=run\.actor_user_id/u);
  const after=structuredClone(f.newRuns);f.noSource();const replay=await f.authorize('legacy-new-permission');
  assert.equal(replay.operation_id,fresh.operation_id);assert.equal(replay.replayed,true);assert.deepEqual(f.newRuns,after);
  // Send-time SQL evaluates the newly persisted origin again, including a deadline
  // that may expire after queueing. A legacy NULL pointer cannot reach this run.
  const sql=await readFile(new URL('./migrations/0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
  const send=sql.split('CREATE FUNCTION validate_signal_brand_context_embedding_send_v1')[1]!.split('END $$;')[0]!;
  assert.match(send,/OLD.status='reserved' AND NEW.status='in_flight'/u);
  assert.match(send,/signal_brand_context_admission_valid_v1\(run.brand_context_preparation_operation_id/u);
  assert.match(send,/brand_context_admission_expired/u);
});

test('published paid semantics survive prototype configuration replacement; C2 advances once and replays',async()=>{
  const f=await fixture('prototype');f.expire();const c2={...runtime,prototype:{...runtime.prototype,max_run_cost_micro_usd:21000}};
  const old=structuredClone(f.run),oldGeneration=structuredClone(f.generation),oldReceipt=structuredClone(f.operations[0]);
  const replacement=await f.authorize('configuration-c2',c2);
  assert.equal(replacement.generation_id,f.initial.generation_id);assert.equal(f.run.status,'canceled');
  assert.deepEqual({...f.run,status:old.status},old);assert.deepEqual(f.generation,oldGeneration);assert.deepEqual(f.operations[0],oldReceipt);
  const accepted=f.operations.find(op=>op.id===replacement.operation_id)!;
  assert.deepEqual(accepted.brand_context_preparation!.replaced_prototype_run_ids,[runId]);
  assert.deepEqual(await advanceSignalBrandContextPreparationsV1({...f.args,runtime:c2,workspace_id:workspaceId}),[{operation_id:replacement.operation_id,state:'preparing_prototypes'}]);
  assert.equal(f.newRuns.length,1);assert.equal(f.newRuns[0]!.hard_cap_micro_usd,21000);
  assert.equal(f.newRuns[0]!.brand_context_preparation_operation_id,replacement.operation_id);
  assert.equal(f.writes.some(sql=>/UPDATE signal_semantic_context_proposal_runs|INSERT INTO signal_semantic_context_proposal_runs/u.test(sql)),false);
  const before=structuredClone({run:f.run,operations:f.operations,newRuns:f.newRuns});f.noSource();
  assert.equal((await f.authorize('configuration-c2',c2)).replayed,true);assert.deepEqual({run:f.run,operations:f.operations,newRuns:f.newRuns},before);
});
for(const unsafe of ['unknown','paid','active'] as const)test(`prototype config replacement rejects ${unsafe} before receipt or cancellation`,async()=>{
  const f=await fixture('prototype');if(unsafe==='unknown')f.makeUncertain();else if(unsafe==='paid')f.run.paid=true;else f.run.status='running';
  const before=structuredClone({run:f.run,operations:f.operations});
  await assert.rejects(f.authorize('unsafe-configuration',{...runtime,prototype:{...runtime.prototype,max_run_cost_micro_usd:21000}}),
    e=>e instanceof Error&&'code' in e&&e.code==='brand_context_existing_run_configuration_changed');
  assert.deepEqual({run:f.run,operations:f.operations},before);assert.equal(f.newRuns.length,0);
});

test('unconsumed draft C1 gets a new C2 lineage before any semantic run, retaining the old generation and replay',async()=>{
  const f=await fixture('semantic');f.dropRun();const old=structuredClone(f.generation);
  const c2={...runtime,semantic:{...runtime.semantic,pricing_version:'renewal-test-c2'}};
  const next=await f.authorize('draft-configuration-c2',c2);
  assert.notEqual(next.generation_id,old.id);assert.equal(next.generation_key,'semantic-context-v2');
  assert.deepEqual(f.oldGenerations,[old]);assert.equal(f.generation.proposal_provider_lineage.pricing.version,'renewal-test-c2');
  assert.equal(f.newRuns.length,0);assert.equal(f.writes.some(sql=>/INSERT INTO signal_semantic_context_proposal_runs/u.test(sql)),false);
  assert.equal((await f.authorize('draft-configuration-c2',c2)).replayed,true);assert.equal(f.oldGenerations.length,1);
});
test('a reviewed unconsumed draft cannot be silently replaced by configuration drift',async()=>{
  const f=await fixture('semantic');f.dropRun();f.reviewable();
  await assert.rejects(f.authorize('reviewed-c2',{...runtime,semantic:{...runtime.semantic,pricing_version:'c2'}}),
    e=>e instanceof Error&&'code' in e&&e.code==='brand_context_existing_run_configuration_changed');
  assert.equal(f.oldGenerations.length,0);
});
test('replacement SQL requires a scoped immutable receipt, atomic closure, and zero paid or ambiguous exposure',async()=>{
  const sql=await readFile(new URL('./migrations/0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
  const proof=sql.split('CREATE FUNCTION signal_brand_context_prototype_unspent_v1')[1]!.split('$$;')[0]!;
  for(const field of ['reserved_micro_usd','settled_micro_usd','unknown_reserved_micro_usd','observed_exception_micro_usd'])assert.ok(proof.includes(`run.${field}=0`));
  for(const field of ['execution_token','dispatch_token'])assert.ok(proof.includes(`run.${field} IS NULL`));
  assert.match(proof,/call.status<>'definitely_not_sent'/u);assert.match(proof,/call.response_body_private IS NOT NULL/u);
  assert.match(sql,/count\(\*\)<>count\(DISTINCT value::uuid\)/u);assert.match(sql,/run.workspace_id<>NEW.workspace_id OR run.actor_user_id<>NEW.actor_user_id/u);
  assert.match(sql,/origin.brand_context_preparation->>'generation_id' IS DISTINCT FROM generation.id::text/u);
  assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/u);assert.match(sql,/operation.status<>'completed'/u);
  assert.match(sql,/run.status IS DISTINCT FROM 'canceled'/u);assert.match(sql,/Canceled preparation history cannot restart/u);
});

test('paid completed draft with changed KB becomes empty current successor without admission, then accepts a separate fresh intent',async()=>{
  const f=await fixture('semantic');Object.assign(f.run,{status:'completed',provider_call_state:'settled',provider_call_count:1,
    provider_response_private:{text:'old paid evidence'},provider_response_digest:digest('paid'),settled_micro_usd:'17'});
  f.reviewable();const paid=structuredClone(f.run),oldGeneration=structuredClone(f.generation),original=structuredClone(f.operations[0]);
  f.changeKnowledge();const next=await f.authorize('paid-authority-transition');
  assert.equal(next.state,'awaiting_authorization');assert.notEqual(next.generation_id,oldGeneration.id);
  assert.deepEqual(f.run,paid);assert.deepEqual(f.operations[0],original);assert.deepEqual(f.oldGenerations,[oldGeneration]);
  assert.notEqual(f.generation.knowledge_digest,oldGeneration.knowledge_digest);
  const receipt=f.operations.find(op=>op.id===next.operation_id)!;
  assert.equal(receipt.brand_context_preparation!.admission,null);
  const artifact=f.newArtifacts.at(-1)!;assert.deepEqual(JSON.parse(String(artifact[4])),{authority_only:true,completed_stale_predecessor_run_id:runId});
  assert.equal(f.writes.some(sql=>/UPDATE signal_semantic_context_(?:proposal_runs|budget_reservations|proposal_outbox)|INSERT INTO signal_semantic_context_element_versions/u.test(sql)),false);
  const replay=await f.authorize('paid-authority-transition');assert.equal(replay.replayed,true);assert.equal(replay.state,'awaiting_authorization');
  assert.equal(f.oldGenerations.length,1);
  const fresh=await f.authorize('separate-new-authority-admission');assert.equal(fresh.generation_id,next.generation_id);assert.equal(fresh.state,'queued');
  assert.notEqual(fresh.operation_id,next.operation_id);assert.ok(f.operations.find(op=>op.id===fresh.operation_id)!.brand_context_preparation!.admission);
  assert.deepEqual(f.run,paid);assert.equal(f.newRuns.length,0);
});
for(const bad of ['unknown','active_outbox','reserved','lease','other_actor'] as const)test(`authority transition preserves and blocks ${bad} historical state`,async()=>{
  const f=await fixture('semantic');Object.assign(f.run,{status:'completed',provider_call_state:'settled',provider_call_count:1,
    provider_response_private:{text:'paid'},provider_response_digest:digest('paid'),settled_micro_usd:'17'});
  if(bad==='unknown')f.run.provider_call_state='outcome_unknown';
  if(bad==='active_outbox')f.run.activeOutbox=true;if(bad==='reserved')f.run.reserved=true;
  if(bad==='lease')f.run.lease_token=actor;if(bad==='other_actor')f.run.created_by_user_id='other';
  f.changeKnowledge();const before=structuredClone({run:f.run,operations:f.operations,generation:f.generation});
  await assert.rejects(f.authorize('blocked-authority-transition'),e=>e instanceof Error&&'code' in e&&e.code==='brand_context_previous_generation_unfinished');
  assert.deepEqual({run:f.run,operations:f.operations,generation:f.generation},before);assert.equal(f.oldGenerations.length,0);
});
test('completed historical source transition SQL proves settlement, exact drift and no inherited first admission',async()=>{
  const sql=await readFile(new URL('./migrations/0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
  const proof=sql.split('CREATE FUNCTION signal_brand_context_completed_history_v1')[1]!.split('$$;')[0]!;
  for(const guard of ["run.status='completed'","run.provider_call_state='settled'","run.provider_call_count=1",'run.provider_response_private IS NOT NULL',
    'run.validated_output_digest IS NOT NULL','run.result_digest IS NOT NULL','run.lease_token IS NULL',"reservation.status='settled'","outbox.status='completed'"])assert.ok(proof.includes(guard),guard);
  assert.match(proof,/reservation.status='reserved'/u);assert.match(proof,/signal_workspace_embedding_runs embed/u);
  assert.match(sql,/artifact_authority IS DISTINCT FROM/u);assert.match(sql,/NEW.knowledge_digest IS DISTINCT FROM predecessor.knowledge_digest/u);
  assert.match(sql,/completed_stale_predecessor_run_id'=predecessor_run.id::text/u);
  assert.match(sql,/Historical authority transition requires a separate fresh admission/u);
  assert.match(sql,/prior.status='completed'/u);
});
