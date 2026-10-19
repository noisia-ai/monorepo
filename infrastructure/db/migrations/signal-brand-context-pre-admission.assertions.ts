import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {ensureSignalBrandContextPreparationV1,quoteSignalBrandContextPreparationV1,
 type SignalBrandContextPreparationRuntimeV1,type SignalBrandContextPreparationV1} from '../signal-brand-context-preparation';
import {SignalSemanticContextProposalExecutionError} from '../signal-semantic-context-proposal';

export async function assertBrandContextPreAdmissionBranchesV1(args:{database:Pool;scoped:PoolClient;workspace_id:string;
 actor_user_id:string;brand_id:string;runtime:SignalBrandContextPreparationRuntimeV1;accepted:SignalBrandContextPreparationV1}){
 const {database,scoped,runtime,accepted}=args;
 const scope={database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id};
 const census=async()=>JSON.stringify((await database.query(`SELECT
  (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE workspace_id=$1::uuid) runs,
  (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox WHERE workspace_id=$1::uuid) outbox,
  (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id=$1::uuid) budgets`,[args.workspace_id])).rows[0]);
 const before=await census();
 await scoped.query('BEGIN');
 try{
  const parent=(await database.query('SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid',[accepted.generation_id])).rows[0]!.row;
  const c2={...runtime,semantic:{...runtime.semantic,pricing_version:`${runtime.semantic.pricing_version}-runless-c2`}};
  const quote=quoteSignalBrandContextPreparationV1({actor_user_id:args.actor_user_id,runtime:c2});
  const child=await ensureSignalBrandContextPreparationV1({...scope,runtime:c2,idempotency_key:randomUUID(),admission:{
   quote_digest:quote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
  assert.notEqual(child.generation_id,accepted.generation_id);
  const row=(await database.query('SELECT supersedes_generation_id::text parent,proposal_pricing_version FROM signal_semantic_context_generations WHERE id=$1::uuid',[child.generation_id])).rows[0]!;
  assert.equal(row.parent,accepted.generation_id);assert.equal(row.proposal_pricing_version,c2.semantic.pricing_version);
  assert.deepEqual((await database.query('SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid',[accepted.generation_id])).rows[0]!.row,parent);
  assert.equal(await census(),before,'a runless configuration successor records intent without sending');
 }finally{await scoped.query('ROLLBACK');}
 await scoped.query('BEGIN');
 try{
  // Change an input only, deliberately before its ordinary reconciliation. No
  // profile, generation, permission or result is forged by this negative.
  await database.query("UPDATE brands SET description='Synthetic un-reconciled input change' WHERE id=$1::uuid",[args.brand_id]);
  const quote=quoteSignalBrandContextPreparationV1({actor_user_id:args.actor_user_id,runtime});
  await assert.rejects(ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:randomUUID(),admission:{
   quote_digest:quote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}}),
   error=>error instanceof SignalSemanticContextProposalExecutionError&&error.code==='brand_os_snapshot_stale');
  assert.equal(await census(),before,'un-reconciled Brand OS input cannot admit provider work');
 }finally{await scoped.query('ROLLBACK');}
 return{runless_configuration_successor:true,unreconciled_snapshot_blocks_admission:true} as const;
}
