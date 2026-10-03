import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {SignalTopicCatalogError} from '../signal-topic-catalog';
import {initializeSignalWorkspaceTopicPrototypeCatalogV1,loadSignalWorkspaceTopicPrototypesV1,
 quoteSignalWorkspaceTopicPrototypesV1} from '../signal-workspace-topic-prototypes-management';
import {executeBrandContextSyntheticPrototypeRunV1} from './signal-brand-context.synthetic.fixture';
type Scope={database:Pool;scoped:PoolClient;workspace_id:string;actor_user_id:string};
export async function assertBrandContextMissingPublicationFenceV1(args:Scope){
 await args.scoped.query('BEGIN');
 try{
  await initializeSignalWorkspaceTopicPrototypeCatalogV1(args);
  const status=await loadSignalWorkspaceTopicPrototypesV1(args);
  assert.equal(status.availability,'context_required');assert.equal(status.current_plan_digest,null);
  await assert.rejects(quoteSignalWorkspaceTopicPrototypesV1(args),error=>error instanceof SignalTopicCatalogError
   &&error.code==='brand_context_semantic_context_required');
  const counts=(await args.database.query(`SELECT
   (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid) runs,
   (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$1::uuid) calls`,[args.workspace_id])).rows[0]!;
  assert.deepEqual(counts,{runs:0,calls:0});
 }finally{await args.scoped.query('ROLLBACK');}
}
export async function assertBrandContextPrototypeAuthorityFenceV1(args:Scope&{brand_id:string;source_id:string;prototype_run_id:string}){
 await args.scoped.query('BEGIN');
 try{
  const prior=(await args.database.query('SELECT to_jsonb(r) row FROM signal_workspace_embedding_runs r WHERE id=$1::uuid',[args.prototype_run_id])).rows[0]!.row;
  assert.equal(prior.status,'queued');
  // This is an input-only mutation; no model, receipt, state, or cache is seeded.
  const changed=await args.database.query(`UPDATE brand_knowledge_sources SET raw_text=raw_text||' Synthetic input changed before Voyage.'
   WHERE id=$1::uuid AND brand_id=$2::uuid`,[args.source_id,args.brand_id]);assert.equal(changed.rowCount,1);
  const status=await loadSignalWorkspaceTopicPrototypesV1(args);
  assert.equal(status.availability,'context_stale');assert.equal(status.current_plan_digest,null);
  assert.equal(status.active_run?.id,args.prototype_run_id,'stale source status retains the existing run receipt');
  await assert.rejects(quoteSignalWorkspaceTopicPrototypesV1(args),error=>error instanceof SignalTopicCatalogError&&error.code==='brand_context_source_stale');
  let sends=0;
  await executeBrandContextSyntheticPrototypeRunV1({database:args.database,run_id:args.prototype_run_id,
   provider:{async embedBatch():Promise<never>{sends++;throw new Error('synthetic stale input must never reach provider');}}});
  assert.equal(sends,0);
  const current=(await args.database.query(`SELECT status,error_code,execution_token,
   (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE run_id=r.id) calls,
   settled_micro_usd::text,unknown_reserved_micro_usd::text FROM signal_workspace_embedding_runs r WHERE id=$1::uuid`,[args.prototype_run_id])).rows[0]!;
  assert.deepEqual(current,{status:'stale',error_code:'workspace_embedding_inputs_changed',execution_token:null,calls:0,
   settled_micro_usd:'0',unknown_reserved_micro_usd:'0'});
 }finally{await args.scoped.query('ROLLBACK');}
}
