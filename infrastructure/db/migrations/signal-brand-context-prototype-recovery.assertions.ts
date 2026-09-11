import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {activateSignalBrandContextGenerationWithQueryableV1,ensureSignalBrandContextPreparationV1,
 quoteSignalBrandContextPreparationV1,advanceSignalBrandContextPreparationsV1,
 type SignalBrandContextPreparationRuntimeV1} from '../signal-brand-context-preparation';
import {initializeSignalWorkspaceTopicPrototypeCatalogV1,quoteSignalWorkspaceTopicPrototypesV1,
 requestSignalWorkspaceTopicPrototypesV1} from '../signal-workspace-topic-prototypes-management';
import {SignalSemanticContextProposalExecutionError} from '../signal-semantic-context-proposal';
import {WorkspaceEmbeddingProviderErrorV1} from '../../../services/workers/src/workers/signal-workspace-embeddings-provider';
import {executeBrandContextSyntheticPrototypeRunV1,createBrandContextSyntheticVoyageProviderV1} from './signal-brand-context.synthetic.fixture';

type Scope={database:Pool;scoped:PoolClient;workspace_id:string;actor_user_id:string;generation_id:string;generation_key:string;
 runtime:SignalBrandContextPreparationRuntimeV1};
const wholeHistory=async(args:Scope)=>JSON.stringify((await args.database.query(`SELECT
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_semantic_context_proposal_runs r WHERE workspace_id=$1::uuid) semantic,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_semantic_context_budget_reservations r WHERE workspace_id=$1::uuid) budgets,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_workspace_embedding_runs r WHERE workspace_id=$1::uuid) runs,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_workspace_embedding_calls r WHERE workspace_id=$1::uuid) calls,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_governance_control_operations r WHERE workspace_id=$1::uuid) operations`,[args.workspace_id])).rows[0]);
const unsentProvider={async embedBatch():Promise<never>{throw new WorkspaceEmbeddingProviderErrorV1('workspace_embedding_definitely_not_sent','definitely_not_sent');}};
const except=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));

/** Runs immediately after the first real semantic completion, before the normal
 * coordinator creates its bound prototype. The old prototype is created by its
 * original request store, not by editing an origin pointer. */
export async function assertBrandContextLegacyPrototypeIsolationV1(args:Scope){
 await args.scoped.query('BEGIN');
 try{
  await activateSignalBrandContextGenerationWithQueryableV1({queryable:args.database,workspace_id:args.workspace_id,
   actor_user_id:args.actor_user_id,generation_key:args.generation_key});
  await initializeSignalWorkspaceTopicPrototypeCatalogV1(args);
  const quote=await quoteSignalWorkspaceTopicPrototypesV1(args);assert.equal(quote.requires_provider,true);
  const legacy=await requestSignalWorkspaceTopicPrototypesV1({...args,idempotency_key:randomUUID(),plan_digest:quote.plan_digest,
   quote_digest:quote.quote_digest,hard_cap_micro_usd:args.runtime.prototype.max_run_cost_micro_usd,
   max_run_cost_micro_usd:args.runtime.prototype.max_run_cost_micro_usd,provider_available:true});
  await assert.rejects(executeBrandContextSyntheticPrototypeRunV1({database:args.database,run_id:legacy.run_id,provider:unsentProvider}),/workspace_embedding_definitely_not_sent/u);
  const old=(await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[legacy.run_id])).rows[0]!.row;
  assert.equal(old.brand_context_preparation_operation_id,null);assert.equal(old.status,'failed');
  const freshQuote=quoteSignalBrandContextPreparationV1({actor_user_id:args.actor_user_id,runtime:args.runtime});
  const fresh=await ensureSignalBrandContextPreparationV1({...args,idempotency_key:randomUUID(),admission:{
   quote_digest:freshQuote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
  assert.equal(fresh.generation_id,args.generation_id);
  const bound={...args,brand_context_preparation_operation_id:fresh.operation_id};
  const nextQuote=await quoteSignalWorkspaceTopicPrototypesV1(bound);
  assert.equal(nextQuote.resume_run_id,null,'a new Brand Context admission cannot adopt a legacy unbound run');
  const next=await requestSignalWorkspaceTopicPrototypesV1({...bound,idempotency_key:randomUUID(),plan_digest:nextQuote.plan_digest,
   quote_digest:nextQuote.quote_digest,hard_cap_micro_usd:args.runtime.prototype.max_run_cost_micro_usd,
   max_run_cost_micro_usd:args.runtime.prototype.max_run_cost_micro_usd,provider_available:true});
  assert.notEqual(next.run_id,legacy.run_id);
  const created=(await args.database.query('SELECT brand_context_preparation_operation_id::text origin FROM signal_workspace_embedding_runs WHERE id=$1::uuid',[next.run_id])).rows[0]!;
  assert.equal(created.origin,fresh.operation_id);
  assert.deepEqual((await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[legacy.run_id])).rows[0]!.row,old);
  const admission=(await args.database.query(`SELECT signal_brand_context_admission_valid_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,'voyage',$5::bigint) current,
    signal_brand_context_admission_valid_v1(NULL,$2::uuid,$3::uuid,$4::uuid,'voyage',$5::bigint) unbound`,
    [fresh.operation_id,args.workspace_id,args.actor_user_id,args.generation_id,args.runtime.prototype.max_run_cost_micro_usd])).rows[0]!;
  assert.equal(admission.current,true);assert.equal(admission.unbound,false);
 }finally{await args.scoped.query('ROLLBACK');}
 return{legacy_unbound_not_adopted:true} as const;
}

/** Alternative outcomes start from the same queued C1 run in separate savepoints.
 * Only declared provider simulators run; no background Worker or queue is started. */
export async function assertBrandContextPrototypeReplacementV1(args:Scope&{prototype_run_id:string}){
 const c2={...args.runtime,prototype:{...args.runtime.prototype,max_run_cost_micro_usd:args.runtime.prototype.max_run_cost_micro_usd+1000}};
 const authorize=()=>{const quote=quoteSignalBrandContextPreparationV1({actor_user_id:args.actor_user_id,runtime:c2});
  return ensureSignalBrandContextPreparationV1({...args,runtime:c2,idempotency_key:randomUUID(),admission:{quote_digest:quote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});};
 let completedSimulatedCalls=0;
 for(const outcome of ['unsent','paid','unknown'] as const){
  await args.scoped.query('BEGIN');
  try{
   if(outcome==='paid'){
    const provider=createBrandContextSyntheticVoyageProviderV1();
    await executeBrandContextSyntheticPrototypeRunV1({database:args.database,run_id:args.prototype_run_id,provider:provider.provider});
    completedSimulatedCalls+=provider.calls.length;assert.ok(provider.calls.length>0);
   }else await assert.rejects(executeBrandContextSyntheticPrototypeRunV1({database:args.database,run_id:args.prototype_run_id,
     provider:outcome==='unsent'?unsentProvider:{async embedBatch():Promise<never>{throw new WorkspaceEmbeddingProviderErrorV1('workspace_embedding_outcome_unknown','outcome_unknown');}}}));
   const old=(await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[args.prototype_run_id])).rows[0]!.row;
   const oldCalls=(await args.database.query('SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),\'[]\'::jsonb) rows FROM signal_workspace_embedding_calls c WHERE run_id=$1::uuid',[args.prototype_run_id])).rows[0]!.rows;
   if(outcome!=='unsent'){
    if(outcome==='paid')assert.ok(Number(old.settled_micro_usd)>0);else assert.ok(Number(old.unknown_reserved_micro_usd)>0);
    const before=await wholeHistory(args);
    await assert.rejects(authorize(),error=>error instanceof SignalSemanticContextProposalExecutionError&&error.code==='brand_context_existing_run_configuration_changed');
    assert.equal(await wholeHistory(args),before,'paid or uncertain exposure blocks replacement without any receipt or ledger change');
    continue;
   }
   assert.equal(old.status,'failed');assert.equal(old.error_code,'workspace_embedding_definitely_not_sent');assert.equal(Number(old.settled_micro_usd),0);
   const fresh=await authorize();assert.equal(fresh.generation_id,args.generation_id);
   await args.database.query('SET CONSTRAINTS trg_signal_brand_context_replacement_receipt IMMEDIATE');
   await args.database.query('SET CONSTRAINTS trg_signal_brand_context_replacement_receipt DEFERRED');
   const canceled=(await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[args.prototype_run_id])).rows[0]!.row;
   assert.equal(canceled.status,'canceled');assert.deepEqual(except(canceled,['status','updated_at']),except(old,['status','updated_at']));
   assert.deepEqual((await args.database.query('SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),\'[]\'::jsonb) rows FROM signal_workspace_embedding_calls c WHERE run_id=$1::uuid',[args.prototype_run_id])).rows[0]!.rows,oldCalls);
   const op=(await args.database.query('SELECT status,brand_context_preparation FROM signal_governance_control_operations WHERE id=$1::uuid',[fresh.operation_id])).rows[0]!;
   assert.equal(op.status,'completed');assert.deepEqual(op.brand_context_preparation.replaced_prototype_run_ids,[args.prototype_run_id]);
   const advanced=await advanceSignalBrandContextPreparationsV1({...args,runtime:c2,limit:10});
   assert.ok(advanced.every(row=>!['failed','stale'].includes(row.state)));
   const next=(await args.database.query(`SELECT id::text,brand_context_preparation_operation_id::text origin FROM signal_workspace_embedding_runs
     WHERE workspace_id=$1::uuid AND brand_context_preparation_operation_id=$2::uuid`,[args.workspace_id,fresh.operation_id])).rows;
   assert.equal(next.length,1);assert.notEqual(next[0]!.id,args.prototype_run_id);assert.equal(next[0]!.origin,fresh.operation_id);
   const provider=createBrandContextSyntheticVoyageProviderV1();
   await executeBrandContextSyntheticPrototypeRunV1({database:args.database,run_id:next[0]!.id,provider:provider.provider});
   completedSimulatedCalls+=provider.calls.length;assert.ok(provider.calls.length>0);
   assert.equal((await args.database.query('SELECT status FROM signal_workspace_embedding_runs WHERE id=$1::uuid',[next[0]!.id])).rows[0]!.status,'completed');
   assert.deepEqual((await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[args.prototype_run_id])).rows[0]!.row,canceled);
  }finally{await args.scoped.query('ROLLBACK');}
 }
 return{unspent_replacement_completed:true,paid_replacement_blocked:true,unknown_replacement_blocked:true,
  completed_voyage_simulated_calls:completedSimulatedCalls} as const;
}
