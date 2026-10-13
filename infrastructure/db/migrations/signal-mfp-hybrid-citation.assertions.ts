import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { ConceptForJudgeV1 } from '@noisia/query-engine';
import { requestHybridMembershipStageV1, configureHybridMembershipRouteV1,loadHybridMembershipRouteV1 } from '../signal-hybrid-membership';
import { createHybridMembershipStageStoreV1 } from '../signal-hybrid-runs';
import { runHybridMembershipTickV1,hybridMembershipDrainerSqlV1 } from '../../../services/workers/src/workers/signal-hybrid-membership';
import type { createAnthropicMessageBatchesClient } from '../../../services/workers/src/providers/anthropic-message-batches';
import {hybridSettledWindowResultsSqlV1} from '../signal-hybrid-window-results';

/** Real migrated schema, normal admission/reserve/store/ledger; only provider HTTP and private storage are simulated. */
export async function verifyHybridCitationQualityV1(a:{client:PoolClient;database:Pool;workspace:string;actor:string;route:string;jevRun:string;concept:ConceptForJudgeV1}) {
 const {client}=a,oldPrice=process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;process.env.NOISIA_JEV_INPUT_USD_PER_MTOK='0.042';
 try{
 for(const scenario of ['supported','mixed_window_error','cached_jev_supported','cached_jev_rejected','repair_supported','repair_unsupported','deterministic_error','explicit_unknown_release','verifier_http_error','verifier_invalid_noul'] as const){
  await client.query('SAVEPOINT citation_quality');
  await client.query("UPDATE signal_labeling_calls SET results_applied=true,results='[]' WHERE run_id=$1 AND status='failed'",[a.jevRun]);
  const raw=new Map<string,string>();
 const createStore=(stage:'claude'|'citation')=>createHybridMembershipStageStoreV1(stage,{database:a.database,
   storeRaw:async r=>{raw.set(r.call_id,r.raw_text);return r.call_id;},loadRaw:async r=>raw.get(r.storage_key)!});
  let claudeSends=0,verifySends=0;const submittedWindows:string[][]=[];
  let requests:Array<{custom_id:string;params:{messages:Array<{content:string}>}}>=[];
  const batch={id:'msgbatch_citation_fixture',processing_status:'ended',created_at:new Date().toISOString()};
  const claude={create:async(items:typeof requests)=>{claudeSends++;requests=items;
    submittedWindows.push(items.map(item=>JSON.parse(item.params.messages[0]!.content).roots[0].spans[0].span_id));return batch;},get:async()=>batch,
   list:async()=>({data:[batch],has_more:false,last_id:batch.id}),results:async function*(){for(const request of requests){
    const span=JSON.parse(request.params.messages[0]!.content).roots[0].spans[0].span_id;
    const item={custom_id:request.custom_id,result:{type:'succeeded',message:{id:'synthetic_citation',type:'message',role:'assistant',model:'claude-sonnet-5-5',stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text:scenario==='deterministic_error'||scenario==='mixed_window_error'&&request===requests[0]?'invalid JSON':JSON.stringify({contract_version:'concept-membership-judge-v1',roots:[{root_ordinal:0,memberships:[{concept_key:a.concept.concept_key,verdict:scenario==='cached_jev_rejected'?'not_belongs':'belongs',span_ids:[span],rationale:'The cited sentence establishes the decisive activity.'}]}]})}]}}};yield{item,rawText:JSON.stringify(item)};
   }}} as unknown as ReturnType<typeof createAnthropicMessageBatchesClient>;
  const technical=scenario==='verifier_http_error'||scenario==='verifier_invalid_noul';
  const jev={evaluate:async()=>{verifySends++;if(scenario==='verifier_http_error')return {http_status:429,latency_ms:1,body:JSON.stringify({error:'overloaded'})};
   if(scenario==='verifier_invalid_noul')return {http_status:200,latency_ms:1,body:JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},answers:{support:{type:'noul',noul:2}}})};return {http_status:200,latency_ms:1,body:JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},answers:{support:{type:'noul',noul:scenario==='supported'||scenario==='mixed_window_error'||scenario==='cached_jev_supported'||scenario==='repair_supported'&&verifySends===2?0.9:0.1}}})};}};
  const initial=await requestHybridMembershipStageV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,stage:'claude',route_digest:a.route,idempotency_key:`citation-${randomUUID()}`,provider_available:true});
  const cached=scenario==='cached_jev_supported'||scenario==='cached_jev_rejected';
  let sourceCalls:unknown[]=[];
  if(cached){
   // Keep a current admission anchor, but put the paid JEV provenance on an older compatible route.
   await client.query(`UPDATE signal_labeling_runs SET membership_snapshot=jsonb_set(membership_snapshot,'{route_digest}',to_jsonb($2::text)) WHERE id=$1`,[a.jevRun,'sha256:'+'d'.repeat(64)]);
   sourceCalls=(await client.query('SELECT to_jsonb(call) snapshot FROM signal_labeling_calls call WHERE run_id=$1 ORDER BY id',[a.jevRun])).rows;
  }
  const admitted=(await client.query('SELECT estimated_micro_usd,membership_snapshot FROM signal_labeling_runs WHERE id=$1',[initial.run_id])).rows[0];
  assert.ok(admitted.membership_snapshot.pipeline_estimate?.citation_initial_micro_usd>0,
   'initial admission includes verification in its pipeline estimate');
  assert.ok(admitted.membership_snapshot.pipeline_estimate?.claude_repair_micro_usd>0,
   'initial admission includes the bounded citation repair');
  assert.ok(admitted.membership_snapshot.pipeline_estimate?.citation_final_micro_usd>0);
  assert.equal(Number(admitted.estimated_micro_usd),admitted.membership_snapshot.pipeline_estimate.total_micro_usd);
  if(scenario==='explicit_unknown_release'){
   const store=createStore('claude'),run=(await store.claim(initial.run_id))!;
   const {membershipCallProposalV1}=await import('../../../services/workers/src/workers/signal-concept-membership-batch');
   const inputs=await store.inputs(run),calls=await store.reserve(run,[membershipCallProposalV1(run,inputs)]);
   await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);await store.fail(run,'labeling_outcome_unknown');await store.release(run);
   await client.query('SAVEPOINT response_requires_reconciliation');
   await client.query("UPDATE signal_labeling_calls SET raw_storage_key='private/response-already-stored',raw_sha256=$2,raw_size_bytes=2 WHERE id=$1",[calls[0]!.id,'sha256:'+'a'.repeat(64)]);
   const retained=(await client.query('SELECT * FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0];
   await assert.rejects(configureHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,route:'standard',provider_available:false,expected_route_digest:a.route,confirm_unresolved_jev:true}),/hybrid_response_reconciliation_required/);
   assert.deepEqual((await client.query('SELECT * FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0],retained,
    'known returned response cannot be erased by explicit uncertainty release');
   await client.query('ROLLBACK TO SAVEPOINT response_requires_reconciliation');
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
   const stage:'claude'|'citation'=next.stage,id=next.run_id,store=createStore(stage);
   const outcome=await runHybridMembershipTickV1({run_id:id,stage,store,jevPrice:0.042,jev,claude});
   assert.equal(outcome.status,technical&&stage==='citation'?'failed':'completed');
   const replay=await runHybridMembershipTickV1({run_id:id,stage,store,jevPrice:0.042,jev,claude});
   assert.deepEqual(replay.followup,outcome.followup,'successor admission replays exactly');
   if(stage==='claude'&&scenario!=='deterministic_error'&&scenario!=='cached_jev_rejected')assert.equal((await client.query('SELECT count(*)::int n FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0].n,0,'unverified agreement stays out of Signal');
   next=outcome.followup as typeof next;
  }
  if(cached)assert.deepEqual((await client.query('SELECT to_jsonb(call) snapshot FROM signal_labeling_calls call WHERE run_id=$1 ORDER BY id',[a.jevRun])).rows,sourceCalls,
   'fresh Claude and verification reuse the original paid JEV receipt without creating or rewriting its calls');
  if(scenario==='cached_jev_rejected'){
   assert.equal(claudeSends,1);assert.equal(verifySends,0);
   const decision=(await client.query('SELECT verdict,jev_call_id FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0];
   assert.equal(decision.verdict,'review_required');assert.ok(decision.jev_call_id);
   console.log(JSON.stringify({gate:'h1_pg_cached_jev_confirmation',scenario,claudeSends,verifySends,verdict:decision.verdict}));
   await client.query('ROLLBACK TO SAVEPOINT citation_quality');continue;
  }
  if(technical){
   assert.equal(claudeSends,1);assert.equal(verifySends,1,'technical failure never authorizes a paid Claude repair');
   assert.equal((await client.query('SELECT count(*)::int n FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0].n,0,'technical failure is outside the semantic cache');
   const call=(await client.query(`SELECT * FROM signal_labeling_calls WHERE run_id IN
    (SELECT id FROM signal_labeling_runs WHERE membership_snapshot->>'source_run_id'=$1)`,[initial.run_id])).rows[0];
   assert.equal(call.results[0].claude.verdict,'error');assert.equal(call.results[0].claude.verification,undefined);
   const current=(await client.query('SELECT verdict,error_code,updated_at FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3',[a.workspace,call.inputs[0].root_id,a.concept.concept_key])).rows[0];
   assert.equal(current.verdict,'error');assert.ok(current.error_code);assert.deepEqual(current.updated_at,call.updated_at);
   const {selectHybridClaudeInputsV1}=await import('../signal-hybrid-runs');
   const initialRun=(await client.query(`SELECT run.*,version.identity FROM signal_labeling_runs run
    JOIN signal_labeler_versions version ON version.id=run.labeler_version_id WHERE run.id=$1`,[initial.run_id])).rows[0];
   assert.equal((await selectHybridClaudeInputsV1(client,{...initialRun,cursor_root_id:null})).length,0,
    'a technical verifier failure never re-admits an already settled Claude confirmation');
   for(let retry=1;retry<=2;retry++){
    const receipt=await requestHybridMembershipStageV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,
     stage:'citation',route_digest:a.route,source_run_id:initial.run_id,idempotency_key:`technical-${randomUUID()}`,provider_available:true});
    const outcome=await runHybridMembershipTickV1({run_id:receipt.run_id,stage:'citation',store:createStore('citation'),jevPrice:0.042,jev,claude});
    assert.equal(outcome.status,'failed');assert.equal(outcome.followup,null);
   }
   const final=await requestHybridMembershipStageV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,
    stage:'citation',route_digest:a.route,source_run_id:initial.run_id,idempotency_key:`exhausted-${randomUUID()}`,provider_available:true});
   await runHybridMembershipTickV1({run_id:final.run_id,stage:'citation',store:createStore('citation'),jevPrice:0.042,jev,claude});
   assert.equal(verifySends,3,'explicit technical retry is bounded to three verifier attempts');assert.equal(claudeSends,1);
   const exhausted=(await client.query('SELECT verdict,error_code FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows;
   assert.deepEqual(exhausted,[{verdict:'error',error_code:'hybrid_attempts_exhausted'}],
    'three verifier failures write an explicit final technical pair state');
   const visibleFinal=(await client.query('SELECT verdict,error_code FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND root_id=$2 AND concept_key=$3',[a.workspace,call.inputs[0].root_id,a.concept.concept_key])).rows[0];
   assert.deepEqual(visibleFinal,exhausted[0]);
   console.log(JSON.stringify({gate:'h1_pg_verifier_technical_error',scenario,claudeSends,verifySends,verdict:current.verdict}));
   await client.query('ROLLBACK TO SAVEPOINT citation_quality');continue;
  }
  if(scenario==='deterministic_error'){
    const decision=(await client.query('SELECT root_id FROM signal_hybrid_membership_decisions WHERE workspace_id=$1 AND concept_key=$2',[a.workspace,a.concept.concept_key])).rows[0];
    assert.ok(decision?.root_id,'deterministic failure has a persisted pair receipt');
    const row=(await client.query('SELECT verdict,error_code FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND concept_key=$2 AND root_id=$3',[a.workspace,a.concept.concept_key,decision.root_id])).rows[0];
    assert.equal(row.verdict,'error');assert.equal(row.error_code,'membership_json_invalid');assert.equal(claudeSends,1);assert.equal(verifySends,0);
    const {selectHybridClaudeInputsV1}=await import('../signal-hybrid-runs');
    const r=(await client.query('SELECT * FROM signal_labeling_runs WHERE id=$1',[initial.run_id])).rows[0];
    assert.equal((await selectHybridClaudeInputsV1(client,{...r,cursor_root_id:null})).length,0,'deterministic pair never recharges');
    await client.query('ROLLBACK TO SAVEPOINT citation_quality');continue;
  }
  const expected=scenario==='supported'||scenario==='mixed_window_error'||scenario==='cached_jev_supported'?1:2;assert.equal(claudeSends,expected);assert.equal(verifySends,expected);
  if(expected===2){assert.equal(submittedWindows[1]?.length,1,'citation repair sends only the rejected window');
   assert.ok(submittedWindows[0]?.includes(submittedWindows[1]![0]!), 'repair keeps the original absolute span');}
  const windows=(await client.query(`SELECT input,result FROM signal_labeling_calls call
   CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
   CROSS JOIN LATERAL jsonb_array_elements(call.results) result WHERE call.run_id=$1 AND call.status='settled' AND call.results_applied`,[initial.run_id])).rows;
  assert.ok(windows.length>=3,'long root is covered by multiple settled windows');
  assert.equal(windows.length,windows[0].input.citation_window.count);
  const w=windows[0].input;
  assert.equal((await client.query('SELECT signal_hybrid_pair_attempts_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) n',
   [a.workspace,a.route,'claude',w.root_id,w.root_fingerprint,a.concept.concept_key,a.concept.definition_digest,w.entity_context_digest,w.effective_entities_digest])).rows[0].n,expected,
   'independent windows count once per window, preserving the attempt bound');
  assert.ok(windows.some(row=>(row.result.claude.citations?.[0]?.start??-1)>10000),'late window preserves absolute offsets');
  if(scenario==='supported'){
   await client.query('SAVEPOINT window_input_correspondence');
   const windowCalls=(await client.query('SELECT * FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id',[initial.run_id])).rows;
   const merged=windowCalls.slice(0,2);
   await client.query('UPDATE signal_labeling_calls SET inputs=$2::jsonb,results=$3::jsonb WHERE id=$1',
    [merged[0].id,JSON.stringify(merged.flatMap(c=>c.inputs)),JSON.stringify(merged.flatMap(c=>c.results))]);
   await client.query('UPDATE signal_labeling_calls SET results_applied=false WHERE id=$1',[merged[1].id]);
   const paired=(await client.query(hybridSettledWindowResultsSqlV1,[initial.run_id])).rows;
   assert.equal(paired.length,windows.length,'two windows in one call do not produce an N×N input join');
   for(const row of paired)assert.deepEqual(row.input.citation_window,row.result.citation_window,
    'every raw result keeps its exact index/start/end/count input window');
   await client.query('ROLLBACK TO SAVEPOINT window_input_correspondence');
  }
  const decision=(await client.query('SELECT * FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0];
  assert.equal(decision.verdict,scenario==='repair_unsupported'?'review_required':'belongs');assert.equal(decision.citation.length,1);assert.ok(decision.citation_call_id);
  const current=(await client.query('SELECT verdict,updated_at FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND concept_key=$2 AND root_id=$3',[a.workspace,a.concept.concept_key,decision.root_id])).rows[0];
  assert.equal(current.verdict,decision.verdict);assert.deepEqual(current.updated_at,decision.updated_at);
  assert.equal((await client.query(hybridMembershipDrainerSqlV1)).rows.filter(r=>[initial.run_id].includes(r.id)).length,0);
  console.log(JSON.stringify({gate:'h1_pg_citation_quality',scenario,claudeSends,verifySends,verdict:decision.verdict}));
  await client.query('ROLLBACK TO SAVEPOINT citation_quality');
 }
 await client.query('SAVEPOINT bounded_jev_retry');
 await client.query("UPDATE signal_labeling_calls SET results_applied=true,results='[]' WHERE run_id=$1 AND status='failed'",[a.jevRun]);
 await client.query(`UPDATE signal_labeling_calls SET results=(SELECT jsonb_agg(result || jsonb_build_object('jev',
   jsonb_build_object('verdict','error','probability',NULL,'citation',NULL),'error_code','jev_http_429'))
   FROM jsonb_array_elements(results) result) WHERE run_id=$1 AND status='settled'`,[a.jevRun]);
 let retrySends=0;
 const raw=new Map<string,string>(),store=createHybridMembershipStageStoreV1('jev',{database:a.database,
  storeRaw:async r=>{raw.set(r.call_id,r.raw_text);return r.call_id;},loadRaw:async r=>raw.get(r.storage_key)!});
 for(let attempt=2;attempt<=3;attempt++){
  const receipt=await requestHybridMembershipStageV1({database:a.database,workspace_id:a.workspace,actor_user_id:a.actor,
   stage:'jev',route_digest:a.route,idempotency_key:`bounded-${randomUUID()}`,provider_available:true});
  const outcome=await runHybridMembershipTickV1({run_id:receipt.run_id,stage:'jev',store,jevPrice:0.042,
   jev:{evaluate:async()=>{retrySends++;return {http_status:429,latency_ms:1,body:JSON.stringify({error:'synthetic_overload'})};}}});
  assert.equal(outcome.status,'failed');
  assert.equal((await client.query('SELECT count(*)::int n FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0].n,attempt===3?1:0);
 }
 assert.equal(retrySends,2,'the seeded first attempt and two real worker attempts exhaust the pair');
 const exhausted=(await client.query('SELECT root_id,verdict,error_code FROM signal_hybrid_membership_decisions WHERE workspace_id=$1',[a.workspace])).rows[0];
 assert.equal(exhausted.verdict,'error');assert.equal(exhausted.error_code,'hybrid_attempts_exhausted');
 const {hybridH1JevAdmissionPopulationSqlV1}=await import('../signal-hybrid-admission-population');
 assert.equal((await client.query(hybridH1JevAdmissionPopulationSqlV1,[a.workspace,a.route])).rows[0].pairs,0,'exhausted JEV pair is absent from admission');
 const {selectMembershipInputsV1}=await import('../signal-concept-memberships');
 const prior=(await client.query('SELECT * FROM signal_labeling_runs WHERE id=$1',[a.jevRun])).rows[0];
 assert.equal((await selectMembershipInputsV1(client,{...prior,id:randomUUID(),cursor_root_id:null},true)).length,0,'exhausted JEV pair is absent from dispatch');
 console.log(JSON.stringify({gate:'h1_pg_bounded_jev_retry',seeded_attempts:1,worker_sends:retrySends,max_attempts:3}));
 await client.query('ROLLBACK TO SAVEPOINT bounded_jev_retry');
 }finally{if(oldPrice===undefined)delete process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;else process.env.NOISIA_JEV_INPUT_USD_PER_MTOK=oldPrice;}
}
