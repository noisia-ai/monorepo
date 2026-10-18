import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {requestConceptMembershipsV1,createConceptMembershipStoreV1} from '../signal-concept-memberships';
import {membershipLabelerIdentityV3,labelerDigestV1} from '@noisia/query-engine';
/** Runs inside the caller's rollback-only production fixture, with no provider transport. */
export async function verifyStandardV3EvaluationV1(a:{database:Pool;client:PoolClient;workspace:string;actor:string;root:string;policy:string}){
 const {client}=a;
 await client.query('SAVEPOINT standard_v3_acceptance');
 try{
  await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT policy_version_id,'concept_membership',kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='concept_membership_claude'`,[a.policy]);
  const census=async()=>(await client.query(`SELECT
   (SELECT coalesce(jsonb_agg(w ORDER BY kind),'[]') FROM signal_workspace_labelers w WHERE workspace_id=$1) selectors,
   (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
   (SELECT count(*)::int FROM signal_concept_memberships WHERE workspace_id=$1) serving,
   (SELECT count(*)::int FROM signal_entity_context_versions WHERE workspace_id=$1) contexts`,[a.workspace])).rows[0];
  const before=await census();
  for(const effort of ['low','medium'] as const){
   const args={database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,idempotency_key:`standard-v3-${effort}-acceptance`,provider_available:true,evaluation_judge_version:3 as const,evaluation_effort:effort,evaluation_root_ids:[a.root]};
   const receipt=await requestConceptMembershipsV1(args);
   assert.equal((await requestConceptMembershipsV1(args)).run_id,receipt.run_id);
   const run=(await client.query(`SELECT r.*,r.next_poll_at::text private_schedule,l.labeler_digest FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.id=$1`,[receipt.run_id])).rows[0];
   assert.equal(run.labeler_digest,labelerDigestV1(membershipLabelerIdentityV3(effort)));
   assert.equal(run.membership_snapshot.preview,true);assert.deepEqual(run.membership_snapshot.sample_root_ids,[a.root]);
   assert.equal(run.private_schedule,'infinity','private experiment is never discovered by the shared scheduler');
   assert.equal(run.waiting_full_confirmation,false);
   const store=createConceptMembershipStoreV1({database:a.database,storeRaw:async()=>{throw new Error('no_provider_receipt_expected');},loadRaw:async()=>{throw new Error('no_raw_expected');}});
   const claim=await store.claim(receipt.run_id);assert.ok(claim);
   await store.release(claim);
   assert.equal((await client.query('SELECT next_poll_at::text schedule FROM signal_labeling_runs WHERE id=$1',[receipt.run_id])).rows[0].schedule,'infinity','release preserves private driver scheduling');
   assert.deepEqual(await census(),before,'no selector, context, serving or paid call changes');
   await client.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[receipt.run_id]);
  }
 }finally{await client.query('ROLLBACK TO SAVEPOINT standard_v3_acceptance');await client.query('RELEASE SAVEPOINT standard_v3_acceptance');}
}
