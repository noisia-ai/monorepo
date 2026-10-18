import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {withBrandContextSyntheticRollbackV1} from './signal-brand-context.rollback.fixture';
import { seedComposedFixture, quoteComposedFixture, startComposedFixture, semanticConfiguration,
  composedBundleCounts } from './signal-brand-context-composed.fixture';

const hash=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
test('classic composed preparation preserves optional strict maxima through quote, admission, reservation, settlement and unsent cancellation', {
  skip:process.env.NOISIA_MFP_PG_CI!=='true', timeout:120_000,
}, async()=>{
  const physicalPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'});
  const client=await physicalPool.connect();let baseline:unknown;
  try{await withBrandContextSyntheticRollbackV1({client,verify:async(c,phase)=>{
    const census=(await c.query(`SELECT (SELECT count(*) FROM organizations) orgs,(SELECT count(*) FROM signal_processing_policy_versions) policies,
      (SELECT count(*) FROM signal_processing_admissions) admissions,(SELECT count(*) FROM signal_semantic_context_proposal_runs) semantic,
      (SELECT count(*) FROM signal_workspace_embedding_runs) embeddings,(SELECT count(*) FROM signal_brand_context_processing_receipts) receipts`)).rows[0];
    if(phase==='before')baseline=census;else assert.deepEqual(census,baseline);
   },run:async({database:pool})=>{
    assert.equal((await pool.query('SELECT current_database() name')).rows[0].name,'noisia_mfp_ci');
    const fixture=await seedComposedFixture(pool,'optional-caps',{optionalStrictCaps:true});
    const quote=await quoteComposedFixture(pool,fixture);
    assert.equal(quote.quote_status,'quoted'); assert.equal(quote.maximum_total_micro_usd,null);
    assert.equal(quote.remaining_micro_usd,null);
    assert.deepEqual(quote.actions.map(x=>x.max_execution_micro_usd),[null,null]);
    const configuration={...semanticConfiguration,platform_hard_cap_micro_usd:null};
    const started=await startComposedFixture(pool,fixture,quote.quote_digest!,'classic-null-cap-start',configuration);
    const before=await composedBundleCounts(pool,fixture.workspaceId);
    assert.equal((await startComposedFixture(pool,fixture,quote.quote_digest!,'classic-null-cap-start',configuration)).replayed,true);
    assert.deepEqual(await composedBundleCounts(pool,fixture.workspaceId),before);
    const row=(await pool.query(`SELECT run.hard_cap_micro_usd::text,run.reservation_micro_usd::text,
      receipt.semantic_cap_micro_usd::text,receipt.prototype_cap_micro_usd::text,
      admission.execution_cap_micro_usd::text FROM signal_semantic_context_proposal_runs run
      JOIN signal_brand_context_processing_receipts receipt ON receipt.semantic_run_id=run.id
      JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id WHERE run.id=$1`,[started.run_id])).rows[0];
    assert.equal(row.hard_cap_micro_usd,null); assert.equal(row.semantic_cap_micro_usd,null);
    assert.equal(row.prototype_cap_micro_usd,null); assert.equal(row.execution_cap_micro_usd,null);
    assert.ok(BigInt(row.reservation_micro_usd)>0n,'reservation is still an exact token-based exposure');
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='processing',started_at=clock_timestamp(),
      provider_call_state='in_flight',provider_call_count=1 WHERE id=$1`,[started.run_id]);
    const raw='{"synthetic":true}';
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='response_persisted',
      provider_response_private=$2,provider_response_digest=$3 WHERE id=$1`,[started.run_id,raw,hash(raw)]);
    await pool.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',input_tokens=1,output_tokens=1,
      actual_micro_usd=18,settled_at=clock_timestamp() WHERE run_id=$1`,[started.run_id]);
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='settled',
      input_tokens=1,output_tokens=1,settled_micro_usd=18 WHERE id=$1`,[started.run_id]);
    assert.equal((await pool.query('SELECT actual_micro_usd::text amount FROM signal_semantic_context_budget_reservations WHERE run_id=$1',[started.run_id])).rows[0].amount,'18');
    const canceled=await seedComposedFixture(pool,'optional-cancel',{optionalStrictCaps:true});
    const cancelQuote=await quoteComposedFixture(pool,canceled);
    const cancelRun=await startComposedFixture(pool,canceled,cancelQuote.quote_digest!,'classic-null-cap-cancel',configuration);
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',stale_at=clock_timestamp(),
      error_code='fixture_source_changed' WHERE id=$1`,[cancelRun.run_id]);
    await pool.query(`UPDATE signal_semantic_context_budget_reservations SET status='released',released_at=clock_timestamp(),
      release_reason='fixture_source_changed' WHERE run_id=$1`,[cancelRun.run_id]);
    assert.deepEqual((await pool.query('SELECT provider_call_count,provider_call_state FROM signal_semantic_context_proposal_runs WHERE id=$1',[cancelRun.run_id])).rows[0],{provider_call_count:0,provider_call_state:'not_started'});
    const capped=await seedComposedFixture(pool,'explicit-caps'); const capQuote=await quoteComposedFixture(pool,capped);
    assert.equal(capQuote.maximum_total_micro_usd,'1100000');
    await assert.rejects(startComposedFixture(pool,capped,capQuote.quote_digest!,'classic-explicit-runtime-cap',
      {...semanticConfiguration,platform_hard_cap_micro_usd:1n}),error=>(error as {code?:string}).code==='brand_context_processing_runtime_drift');
  }}); }finally{client.release();await physicalPool.end();}
});

test('classic optional cap composes the real prototype Worker with exact Voyage settlement', {
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:120_000,
},async()=>{
 const {prepareSignalSemanticContextProposalInputV1,processSignalSemanticContextProposalRunV1}=await import('../signal-semantic-context-proposal');
 const {prepareSignalBrandContextPrototypeQuoteV1,startSignalBrandContextPrototypeProcessingV1}=await import('../signal-brand-context-prototype-processing');
 const {createBrandContextSyntheticVoyageProviderV1,executeBrandContextSyntheticPrototypeRunV1}=await import('./signal-brand-context.synthetic.fixture');
 const physical=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'});
 const client=await physical.connect();let baseline:unknown;
 try{await withBrandContextSyntheticRollbackV1({client,verify:async(c,phase)=>{
  const census=(await c.query('SELECT (SELECT count(*) FROM organizations) orgs,(SELECT count(*) FROM signal_workspace_embedding_runs) runs,(SELECT count(*) FROM signal_workspace_embedding_calls) calls')).rows[0];
  if(phase==='before')baseline=census;else assert.deepEqual(census,baseline);
 },run:async({database:pool})=>{
  const fixture=await seedComposedFixture(pool,'optional-prototypes',{optionalStrictCaps:true});
  const quote=await quoteComposedFixture(pool,fixture);
  const configuration={...semanticConfiguration,platform_hard_cap_micro_usd:null};
  const started=await startComposedFixture(pool,fixture,quote.quote_digest!,'classic-optional-prototype-start',configuration);
  const prepared=await prepareSignalSemanticContextProposalInputV1({queryable:pool,workspace:{id:fixture.workspaceId,organization_id:fixture.organizationId,brand_id:fixture.brandId},generation_key:fixture.generationKey});
  const primary=prepared.input.identity.primary;
  const knowledge=prepared.input.knowledge_blocks.find(x=>x.source_kind==='knowledge_source'||x.source_kind==='knowledge_chunk')!;
  assert.ok(knowledge);
  const base={scope:'primary_brand',entity_ref:primary.entity_ref,locale:null,relation_kind:null,relation_target_key:null,confidence:1};
  let calls=0;
  const result=await processSignalSemanticContextProposalRunV1({pool,run_id:started.run_id,provider:{async generate(request){
   calls++;assert.equal(request.prompt,prepared.prompt);
   return {provider_request_id:'synthetic-classic-optional',usage:{input_tokens:1000,output_tokens:500},text:JSON.stringify({contract_version:'signal-semantic-context-proposal-output-v3',proposals:[
    {...base,element_key:'identity.fixture',element_kind:'identity_term',canonical_key:'fixture',display_text:primary.display_name,evidence:[{source_alias:primary.source_aliases[0],relation_type:'supports'}]},
    {...base,element_key:'benefit.repairs',element_kind:'benefit',canonical_key:'repairs',display_text:'Scheduled bicycle repairs',evidence:[{source_alias:knowledge.source_alias,relation_type:'supports'}]}
   ]})};
  }}});
  assert.equal(result.status,'completed');assert.equal(calls,1);
  const parent=(await pool.query('SELECT id::text FROM signal_brand_context_processing_receipts WHERE semantic_run_id=$1',[started.run_id])).rows[0].id;
  const prototype=await prepareSignalBrandContextPrototypeQuoteV1({database:pool,parent_receipt_id:parent,actor_user_id:fixture.clientActorId});
  assert.equal(prototype.maximum_micro_usd,null);assert.equal(prototype.available_today_micro_usd,null);
  assert.equal(prototype.requires_confirmation,false,'NULL cap inherits exact parent authority');
  const requested=await startSignalBrandContextPrototypeProcessingV1({database:pool,parent_receipt_id:parent,actor_user_id:fixture.clientActorId,
   idempotency_key:'classic-optional-prototype',provider_available:true});
  const simulator=createBrandContextSyntheticVoyageProviderV1();
  await executeBrandContextSyntheticPrototypeRunV1({database:pool,run_id:requested.run_id,provider:simulator.provider});
  const completed=(await pool.query('SELECT status,hard_cap_micro_usd::text,settled_micro_usd::text FROM signal_workspace_embedding_runs WHERE id=$1',[requested.run_id])).rows[0];
  assert.equal(completed.status,'completed');assert.equal(completed.hard_cap_micro_usd,null);assert.ok(BigInt(completed.settled_micro_usd)>0n);
  assert.ok(simulator.calls.length>0);
 }});}finally{client.release();await physical.end();}
});
