import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { ConceptForJudgeV1 } from '@noisia/query-engine';
import { requestHybridMembershipStageV1, configureHybridMembershipRouteV1,loadHybridMembershipRouteV1 } from '../signal-hybrid-membership';
import { createHybridMembershipStageStoreV1 } from '../signal-hybrid-runs';
import { runHybridMembershipTickV1,hybridMembershipDrainerSqlV1 } from '../../../services/workers/src/workers/signal-hybrid-membership';
import type { createAnthropicMessageBatchesClient } from '../../../services/workers/src/providers/anthropic-message-batches';

/** Real migrated schema, normal admission/reserve/store/ledger; only provider HTTP and private storage are simulated. */
export async function verifyHybridCitationQualityV1(a:{client:PoolClient;database:Pool;workspace:string;actor:string;route:string;jevRun:string;concept:ConceptForJudgeV1}) {
 const {client}=a,oldPrice=process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;process.env.NOISIA_JEV_INPUT_USD_PER_MTOK='0.042';
 try{
 for(const scenario of ['supported','repair_supported','repair_unsupported','deterministic_error','explicit_unknown_release'] as const){
  await client.query('SAVEPOINT citation_quality');
  await client.query("UPDATE signal_labeling_calls SET results_applied=true,results='[]' WHERE run_id=$1 AND status='failed'",[a.jevRun]);
  const raw=new Map<string,string>();
  const createStore=(stage:'claude'|'citation')=>createHybridMembershipStageStoreV1(stage,{database:a.database,
   storeRaw:async r=>{raw.set(r.call_id,r.raw_text);return r.call_id;},loadRaw:async r=>raw.get(r.storage_key)!});
  let claudeSends=0,verifySends=0;let requests:Array<{custom_id:string}>=[];
  const batch={id:'msgbatch_citation_fixture',processing_status:'ended',created_at:new Date().toISOString()};
  const claude={create:async(items:Array<{custom_id:string}>)=>{claudeSends++;requests=items;return batch;},get:async()=>batch,
   list:async()=>({data:[batch],has_more:false,last_id:batch.id}),results:async function*(){for(const request of requests){
    const item={custom_id:request.custom_id,result:{type:'succeeded',message:{id:'synthetic_citation',type:'message',role:'assistant',model:'claude-sonnet-5-5',stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text:scenario==='deterministic_error'?'invalid JSON':JSON.stringify({contract_version:'concept-membership-judge-v1',roots:[{root_ordinal:0,memberships:[{concept_key:a.concept.concept_key,verdict:'belongs',span_ids:['r0c0s0'],rationale:'The cited sentence establishes the decisive activity.'}]}]})}]}}};yield{item,rawText:JSON.stringify(item)};
   }}} as unknown as ReturnType<typeof createAnthropicMessageBatchesClient>;
  const jev={evaluate:async()=>{verifySends++;return {http_status:200,latency_ms:1,body:JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},answers:{support:{type:'noul',noul:scenario==='supported'||scenario==='repair_supported'&&verifySends===2?0.9:0.1}}})};}};
  const initial=await requestHybridMembershipStageV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,stage:'claude',route_digest:a.route,idempotency_key:`citation-${randomUUID()}`,provider_available:true});
  if(scenario==='explicit_unknown_release'){
   const store=createStore('claude'),run=(await store.claim(initial.run_id))!;
   const {membershipCallProposalV1}=await import('../../../services/workers/src/workers/signal-concept-membership-batch');
   const inputs=await store.inputs(run),calls=await store.reserve(run,[membershipCallProposalV1(run,inputs)]);
   await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);await store.fail(run,'labeling_outcome_unknown');await store.release(run);
   await assert.rejects(configureHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,route:'standard',provider_available:false,expected_route_digest:a.route}),/hybrid_unknown_confirmation_required/);
   const before=await loadHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor});assert.equal(before.unknown_calls,1);
   await configureHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,route:'standard',provider_available:false,expected_route_digest:a.route,confirm_unresolved_jev:true});
   const after=await loadHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor});
   assert.equal(after.unknown_calls,0);assert.equal(after.reserved_exposure_micro_usd,before.reserved_exposure_micro_usd);
   const released=(await client.query('SELECT status,settled_micro_usd,terminal_exposure_micro_usd,stop_reason FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0];
   assert.equal(released.status,'failed');assert.equal(released.settled_micro_usd,null);assert.equal(released.stop_reason,'claude_uncertain_explicit_release');
   await client.query('ROLLBACK TO SAVEPOINT citation_quality');continue;
  }
  let next:{run_id:string;stage:'claude'|'citation'}|null={run_id:initial.run_id,stage:'claude'};let stages=0;
  while(next){
   assert.ok(++stages<=4,'one confirmation, one verifier, at most one repair and one re-verification');
   const stage=next.stage,id=next.run_id,store=createStore(stage);
   const outcome=await runHybridMembershipTickV1({run_id:id,stage,store,jevPrice:0.042,jev,claude});
   assert.equal(outcome.status,'completed');
   const replay=await runHybridMembershipTickV1({run_id:id,stage,store,jevPrice:0.042,jev,claude});
   assert.deepEqual(replay.followup,outcome.followup,'successor admission replays exactly');
   if(stage==='claude'&&scenario!=='deterministic_error')assert.equal((await client.query('SELECT count(*)::int n FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0].n,0,'unverified agreement stays out of Signal');
   next=outcome.followup as typeof next;
  }
  if(scenario==='deterministic_error'){
    const row=(await client.query('SELECT verdict,error_code FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND concept_key=$2',[a.workspace,a.concept.concept_key])).rows[0];
    assert.equal(row.verdict,'error');assert.equal(row.error_code,'membership_json_invalid');assert.equal(claudeSends,1);assert.equal(verifySends,0);
    const {selectHybridClaudeInputsV1}=await import('../signal-hybrid-runs');
    const r=(await client.query('SELECT * FROM signal_labeling_runs WHERE id=$1',[initial.run_id])).rows[0];
    assert.equal((await selectHybridClaudeInputsV1(client,{...r,cursor_root_id:null})).length,0,'deterministic pair never recharges');
    await client.query('ROLLBACK TO SAVEPOINT citation_quality');continue;
  }
  const expected=scenario==='supported'?1:2;assert.equal(claudeSends,expected);assert.equal(verifySends,expected);
  const decision=(await client.query('SELECT * FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0];
  assert.equal(decision.verdict,scenario==='repair_unsupported'?'review_required':'belongs');assert.equal(decision.citation.length,1);assert.ok(decision.citation_call_id);
  const current=(await client.query('SELECT verdict,updated_at FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND concept_key=$2',[a.workspace,a.concept.concept_key])).rows[0];
  assert.equal(current.verdict,decision.verdict);assert.deepEqual(current.updated_at,decision.updated_at);
  assert.equal((await client.query(hybridMembershipDrainerSqlV1)).rows.filter(r=>[initial.run_id].includes(r.id)).length,0);
  console.log(JSON.stringify({gate:'h1_pg_citation_quality',scenario,claudeSends,verifySends,verdict:decision.verdict}));
  await client.query('ROLLBACK TO SAVEPOINT citation_quality');
 }
 }finally{if(oldPrice===undefined)delete process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;else process.env.NOISIA_JEV_INPUT_USD_PER_MTOK=oldPrice;}
}
