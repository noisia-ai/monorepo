import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import {markSignalWorkspaceEngineInterpretationSentV1 as markSent,failSignalWorkspaceEngineInterpretationV1 as failCall,reconcileSignalWorkspaceEngineTerminalV1 as reconcile,type SignalWorkspaceEngineInterpretationCallV1} from '../signal-workspace-engine-interpretation';
import {failSignalWorkspaceIncrementalEditorialV1 as failOwner,type SignalWorkspaceIncrementalEditorialLeaseV1} from '../signal-workspace-incremental-editorial-execution';
import {renewAndEnqueueSignalWorkspaceIncrementalEditorialV1} from '../signal-workspace-incremental-editorial-admission-queue';
import {readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1,type SignalWorkspaceIncrementalEditorialRenewArgsV1} from '../signal-workspace-incremental-editorial-renewal';
import {revokeSignalWorkspaceIncrementalEditorialV1 as revoke,loadSignalWorkspaceIncrementalEditorialAdmissionV1,type SignalWorkspaceIncrementalEditorialReceiptV1} from '../signal-workspace-incremental-editorial';
import type {SignalWorkspaceEngineDatabaseV1} from '../signal-workspace-engine';

type Args={database:SignalWorkspaceEngineDatabaseV1;query:Awaited<ReturnType<typeof incrementalProjectionFixtureV1>>['query'];access:{workspace_id:string;actor_user_id:string};
 execution_id:string;worker_job_id:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1;
 renewArgs:SignalWorkspaceIncrementalEditorialRenewArgsV1;setupPendingCall:(retry_of_call_id?:string)=>Promise<{lease:SignalWorkspaceIncrementalEditorialLeaseV1;call:SignalWorkspaceEngineInterpretationCallV1}>};
/** Run inside the shared real PG fixture, from a failed/expired owner with paid output. */
export async function assertIncrementalEditorialRenewalV1(args:Args){
 const {query,database,access,execution_id,renewArgs}=args,c=database;
 const scoped={...access,execution_id};
 const baseline=async()=>({
  owners:(await query('SELECT to_jsonb(e) body FROM signal_topic_catalog_executions e WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
  calls:(await query('SELECT to_jsonb(c) body FROM engine_cost_events c WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
  operations:(await query('SELECT to_jsonb(o) body FROM signal_classification_operations o WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
  artifacts:(await query('SELECT to_jsonb(a) body FROM analysis_artifacts a WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
  dispatch:(await query('SELECT to_jsonb(d) body FROM signal_topic_classification_outbox d WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
  selection:(await query('SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid',[access.workspace_id])).rows,
 });
 const before=await baseline();
 const preview=await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,scoped);assert.ok(preview?.can_renew);
 assert.equal(preview.expected_admission_operation_id,args.receipt.operation_id);assert.equal(preview.budget_actor_user_id,args.receipt.budget_actor_user_id);
 assert.ok(preview.maximum_grant_micro_usd>0&&preview.maximum_grant_micro_usd<=preview.run_cap_micro_usd-preview.confirmed_micro_usd);
 const reject=async(input:Partial<SignalWorkspaceIncrementalEditorialRenewArgsV1>,error:RegExp,provider=true)=>{
  await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...renewArgs,...input,idempotency_key:randomUUID(),provider_available:provider}),error);
  assert.deepEqual(await baseline(),before);
 };
 await reject({actor_user_id:randomUUID()},/forbidden/u);
 await reject({workspace_id:randomUUID()},/forbidden/u);
 await reject({execution_id:args.receipt.numeric_execution_id},/not_found/u);
 await reject({expected_admission_operation_id:randomUUID()},/admission_changed/u);
 await reject({grant_cap_micro_usd:0},/request_invalid/u);
 await reject({grant_cap_micro_usd:1.5},/request_invalid/u);
 await reject({grant_cap_micro_usd:preview.maximum_grant_micro_usd+1},/cap_or_deadline_invalid/u);
 await reject({admission_not_after:new Date(Date.parse(preview.maximum_admission_not_after)+1).toISOString()},/cap_or_deadline_invalid/u);
 await reject({},/interpretation_unavailable/u,false);
 const rollback=async(work:()=>Promise<void>)=>{await query('BEGIN');try{await work();}finally{await query('ROLLBACK');}assert.deepEqual(await baseline(),before);};
 await rollback(async()=>{
  await query("UPDATE signal_topic_catalog_executions SET error_code='workspace_incremental_editorial_worker_failed' WHERE id=$1::uuid",[execution_id]);
  assert.equal((await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,scoped))?.can_renew,false);
  await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...renewArgs,idempotency_key:randomUUID(),provider_available:true}),/renewal_unavailable/u);
 });
 await rollback(async()=>{
  await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active')",[access.workspace_id]);
  assert.equal((await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,scoped))?.can_renew,false);
  await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...renewArgs,idempotency_key:randomUUID(),provider_available:true}),/renewal_unavailable/u);
 });
 await rollback(async()=>{
  const input={...renewArgs,execution_id:execution_id.toUpperCase(),expected_admission_operation_id:renewArgs.expected_admission_operation_id.toUpperCase(),idempotency_key:randomUUID(),provider_available:true};
  const accepted=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1(input);assert.equal(accepted.execution_id,execution_id);assert.equal(accepted.replayed,false);
  assert.equal(accepted.receipt.prior_admission_operation_id,args.receipt.operation_id);
  const after=await baseline();const replay=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...input,provider_available:false});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,accepted.receipt);assert.deepEqual(await baseline(),after);
  const historical=await loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,database,idempotency_key:input.idempotency_key});
  assert.deepEqual(historical?.request?.receipt,accepted.receipt);
  await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...input,grant_cap_micro_usd:input.grant_cap_micro_usd+1}),/idempotency_conflict/u);
  assert.deepEqual(await baseline(),after);
  await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active')",[access.workspace_id]);
  const stale=await loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,database,numeric_execution_id:randomUUID(),idempotency_key:input.idempotency_key});
  assert.deepEqual(stale?.request?.receipt,accepted.receipt);assert.equal(stale?.is_current,false);
  const inert=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...input,provider_available:false});assert.deepEqual(inert.receipt,accepted.receipt);assert.equal(inert.replayed,true);
 });

 for(const callState of ['reserved','in_flight','outcome_unknown','terminal_confirmed'] as const)await rollback(async()=>{
  const first=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...renewArgs,idempotency_key:randomUUID(),provider_available:true});
  const {lease,call}=await args.setupPendingCall();assert.equal(call.state,'reserved');
  if(callState!=='reserved'){
   assert.equal((await markSent({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token})).send_authorized,true);
   if(callState==='outcome_unknown'||callState==='terminal_confirmed')await failCall({database,call_id:call.call_id,attempt_token:call.attempt_token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_transport_unknown'});
  }
  const revoked=await revoke({...access,database,execution_id,idempotency_key:randomUUID(),expected_admission_operation_id:first.receipt.operation_id});
  await failOwner({database,lease,error_code:'workspace_engine_interpretation_admission_revoked'});
  const terminalize=async(target:SignalWorkspaceEngineInterpretationCallV1)=>{
   const row=(await query('SELECT sent_at,call_configuration FROM engine_cost_events WHERE id=$1::uuid',[target.call_id])).rows[0];
   const proof='explicit local fake console evidence';
   return reconcile({database,...scoped,call_id:target.call_id,attempt_token:target.attempt_token,expected_request_digest:target.request_digest,
    verifier_user_id:access.actor_user_id,terminal:{source:'anthropic_console',provider_request_id:'req_local_'+target.call_id.replaceAll('-',''),provider_model:row.call_configuration.model,
    started_at:new Date(row.sent_at).toISOString(),ended_at:new Date(row.sent_at).toISOString(),http_status:499,reason:'client_disconnected',
    usage:{input_tokens:1000,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},
    evidence:{storage_key:`workspace-engine/${access.workspace_id}/${execution_id}/local-proof-${target.call_id}`,sha256:'sha256:'+createHash('sha256').update(proof).digest('hex'),size_bytes:Buffer.byteLength(proof)}}});
  };
  if(callState==='terminal_confirmed')assert.equal((await terminalize(call)).state,'terminal_confirmed');
  const prior=await baseline(),view=await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,scoped);assert.ok(view);
  const next={...renewArgs,idempotency_key:randomUUID(),expected_admission_operation_id:revoked.receipt.operation_id,grant_cap_micro_usd:view.maximum_grant_micro_usd,provider_available:true};
  if(callState==='in_flight'||callState==='outcome_unknown'){
   assert.equal(view.can_renew,false);assert.equal(view.blocked_reason,'workspace_incremental_editorial_renewal_uncertain');
   await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1(next),/renewal_unavailable/u);assert.deepEqual(await baseline(),prior);return;
  }
  assert.equal(view.can_renew,true);
  await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...next,provider_available:false}),/interpretation_unavailable/u);
  assert.deepEqual(await baseline(),prior,'provider-off rolls back reserved retirement as well as permission and queue');
  const renewed=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1(next);assert.equal(renewed.receipt.prior_admission_operation_id,revoked.receipt.operation_id);
  if(callState==='terminal_confirmed'){
   const terminal=prior.calls.find(row=>row.body.id===call.call_id)!;
   assert.deepEqual((await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE id=$1::uuid',[call.call_id])).rows[0],terminal);
   assert.equal(view.terminal_reserved_micro_usd,call.reserved_micro_usd);
   assert.ok(view.maximum_grant_micro_usd<=view.run_cap_micro_usd-view.confirmed_micro_usd-call.reserved_micro_usd);
   const successor=await args.setupPendingCall(call.call_id);
   assert.equal((await markSent({database,call_id:successor.call.call_id,attempt_token:successor.call.attempt_token,execution_token:successor.lease.execution_token})).send_authorized,true);
   await failCall({database,call_id:successor.call.call_id,attempt_token:successor.call.attempt_token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_transport_unknown'});
   const stopped=await revoke({...access,database,execution_id,idempotency_key:randomUUID(),expected_admission_operation_id:renewed.receipt.operation_id});
   await failOwner({database,lease:successor.lease,error_code:'workspace_engine_interpretation_admission_revoked'});await terminalize(successor.call);
   const exhausted=await baseline();assert.equal((await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,scoped))?.can_renew,false);
   await assert.rejects(renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...next,idempotency_key:randomUUID(),expected_admission_operation_id:stopped.receipt.operation_id}),/renewal_unavailable/u);
   assert.deepEqual(await baseline(),exhausted);return;
  }
  const retired=(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE id=$1::uuid',[call.call_id])).rows[0].body;
  const original=prior.calls.find(row=>row.body.id===call.call_id)!.body;
  assert.equal(retired.call_state,'definitely_not_sent');assert.equal(retired.sent_at,null);
  for(const field of ['reserved_micro_usd','request_seal','request_digest','metadata','attempt_token','budget_date','budget_timezone'])assert.deepEqual(retired[field],original[field]);
  assert.deepEqual((await markSent({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token})).send_authorized,false);
  const fresh=await args.setupPendingCall(call.call_id);
  await assert.rejects(markSent({database,call_id:fresh.call.call_id,attempt_token:fresh.call.attempt_token,execution_token:lease.execution_token}),/lease_conflict/u);
  const reserved=(await query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[fresh.call.call_id])).rows[0];assert.equal(reserved.call_state,'reserved');
 });
 return{historical_replay:true,provider_false_atomic:true,reserved_retirement:true,old_lease_fenced:true,uncertain_rejected:true,terminal_reserve_retained:true,terminal_successor_bounded:true};
}
