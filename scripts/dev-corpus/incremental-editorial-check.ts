/** Real admission/ledger with simulated numerical bytes, under the caller's physical rollback. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import * as editorial from '../../infrastructure/db/signal-workspace-incremental-editorial';
import * as runtime from '../../infrastructure/db/signal-workspace-incremental-editorial-execution';
import * as renewal from '../../infrastructure/db/signal-workspace-incremental-editorial-renewal';
import {renewAndEnqueueSignalWorkspaceIncrementalEditorialV1} from '../../infrastructure/db/signal-workspace-incremental-editorial-admission-queue';
import * as money from '../../infrastructure/db/signal-workspace-engine-interpretation';
import * as projection from '../../infrastructure/db/signal-workspace-incremental-projection';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest,
 SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet,buildSignalWorkspaceInterpretationBatchV1 as buildBatch,
 signalWorkspaceInterpretationReferenceIdV1 as refId} from '../../packages/query-engine/src/index';
import {createMfpSyntheticNumericCheckpointV1} from './incremental-editorial-fixture';
const sha=(s:string)=>`sha256:${createHash('sha256').update(s).digest('hex')}`;
export async function checkMfpIncrementalEditorialV1(args:Parameters<typeof createMfpSyntheticNumericCheckpointV1>[0]&{
 query:(sql:string,values?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>;
 report:(phase:string)=>void;cap:number|null;policy_id:string;actor_user_id:string;
}){
 const {database,query,report}=args,access={database,workspace_id:args.lease.workspace_id,actor_user_id:args.actor_user_id};
 report('simulated_numeric_checkpoint');const f=await createMfpSyntheticNumericCheckpointV1(args);
 const scope={...access,numeric_execution_id:f.lease.execution_id};
 await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database});
 const dispatch=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[f.lease.execution_id])).rows[0]!;
 const derivationScope={...access,execution_id:f.lease.execution_id,worker_job_id:String(dispatch.worker_job_id)};
 const derivation=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1(derivationScope);
 await projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...derivationScope,derivation_digest:derivation.derivation_digest,
  units:f.components.flatMap(component=>component.units.map(unit=>({...unit,component_key:component.component_key})))});
 const units:editorial.SignalWorkspaceIncrementalEditorialEvidenceUnitV1[]=f.components.flatMap(component=>component.units.map(unit=>({...unit,
  component_key:component.component_key,model_origin:component.model_origin,lane:component.lane,status:'evidence_ready' as const,
  root_count:f.roots.length,chunk_count:f.chunks.length,cluster_digest:sha(`simulated unit census ${unit.unit_key}`)})));
 const chunk=f.chunks[0]!,identity={root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};
 const groups=units.map(unit=>({cluster_id:unit.unit_key,lane:unit.lane,cluster_digest:unit.cluster_digest,root_count:unit.root_count,chunk_count:unit.chunk_count,
  terms:['simulated rollback evidence'],representatives:[{...identity,text:chunk.text,strength:0.9,selection_reason:'high_affiliation' as const,ref_id:refId(identity)}]}));
 const stream=groups.map((cluster,i)=>JSON.stringify({contract_version:'workspace-incremental-editorial-evidence-unit-v1',unit:units[i],cluster})+'\n').join('');
 const body={contract_version:'workspace-incremental-editorial-evidence-stream-v1' as const,numeric_execution_id:f.lease.execution_id,numeric_checkpoint_digest:f.checkpoint.checkpoint_digest,
  numeric_manifest_sha256:sha(JSON.stringify(f.output)),population_digest:f.output.population_digest,representative_selection_policy:'distinct-roots-affiliation-boundary-v1' as const,
  census:{roots:f.roots.length,chunks:f.chunks.length,memberships:f.output.counts.memberships,pending_roots:1,pending_occurrences:f.output.counts.pending_occurrences,
   expected_unit_count:units.length,expected_unit_digest:unitDigest(units.map(unit=>unit.unit_key)),population_digest:f.output.population_digest},
  numeric_component_order:f.components.map(component=>component.component_key),origins:[{execution_id:f.lease.execution_id,manifest_sha256:sha(JSON.stringify(f.output)),candidate_sha256:f.output.artifacts.find(row=>row.file==='candidate-groups.json')!.sha256}],units,
  target_unit_digest:unitDigest(units.map(unit=>unit.unit_key)),target_binding_digest:digest(units.map(({component_key,local_label,unit_key,birth_membership_digest,model_origin})=>({component_key,unit:{local_label,unit_key,birth_membership_digest},model_origin}))),
  stream:{contract_version:'workspace-incremental-editorial-evidence-jsonl-v1' as const,rows:units.length,bytes:Buffer.byteLength(stream),sha256:sha(stream)}};
 const evidence={...body,evidence_digest:digest(body)},stored={storage_key:`workspace-engine/${access.workspace_id}/${f.lease.execution_id}/editorial/${digest(body).slice(7)}.jsonl`,sha256:sha(stream),size_bytes:Buffer.byteLength(stream),media_type:'application/octet-stream'};
 report('editorial_admission');
 const plan=await editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored});
 const preview=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope);assert.equal(preview.can_authorize,true);assert.ok(preview.target_unit_digest);
 const begin={...scope,expected_evidence_plan_artifact_id:plan.artifact_id,expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,
  expected_target_unit_digest:preview.target_unit_digest,expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),
  cap_micro_usd:args.cap,admission_not_after:preview.maximum_admission_not_after};
 const admitted=await editorial.beginSignalWorkspaceIncrementalEditorialV1(begin);assert.equal(admitted.receipt.grant_cap_micro_usd,args.cap);
 assert.deepEqual(await editorial.beginSignalWorkspaceIncrementalEditorialV1(begin),{...admitted,replayed:true});
 const queued=await runtime.enqueueSignalWorkspaceIncrementalEditorialV1({...access,execution_id:admitted.execution_id});
 await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1",[admitted.execution_id]);
 const lease=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in lease));
 const context=await runtime.readSignalWorkspaceIncrementalEditorialContextV1({database,lease});
 const batch=buildBatch(context.context,groups,sonnet),jsonl=JSON.stringify({contract_version:'workspace-incremental-editorial-batch-v1',index:0,batch})+'\n';
 const request={index:0,batch_key:batch.batch_key,request_digest:batch.request_digest,unit_keys:groups.map(g=>g.cluster_id),reserved_micro_usd:batch.reserved_micro_usd,offset:0,size_bytes:Buffer.byteLength(jsonl),sha256:sha(jsonl)};
 const unsigned={contract_version:'workspace-incremental-editorial-batch-plan-v1' as const,workspace_id:access.workspace_id,editorial_execution_id:lease.execution_id,numeric_execution_id:lease.numeric_execution_id,
  evidence_digest:evidence.evidence_digest,target_unit_digest:evidence.target_unit_digest,target_binding_digest:evidence.target_binding_digest,context_digest:context.context.context_digest,
  configuration_digest:digest(sonnet),units:units.length,batches:1,requests:[request],stream:{bytes:Buffer.byteLength(jsonl),sha256:sha(jsonl)}};
 await runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:{...unsigned,plan_digest:digest(unsigned)},stored:{
  storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/batches.jsonl`,sha256:sha(jsonl),size_bytes:Buffer.byteLength(jsonl),media_type:'application/octet-stream'}});
 const reserve={...access,execution_id:lease.execution_id,idempotency_key:batch.batch_key,request_digest:batch.request_digest,configuration:sonnet,
  reserved_micro_usd:batch.reserved_micro_usd,budget_timezone:admitted.receipt.budget_timezone,daily_cap_micro_usd:admitted.receipt.daily_cap_micro_usd,
  execution_token:lease.execution_token,admission_operation_id:admitted.receipt.operation_id};
 report('editorial_reserve_and_revocation');
 const call=await money.reserveSignalWorkspaceEngineInterpretationV1(reserve);
 assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(reserve)).call_id,call.call_id);
 // Exercise the actual SQL capacity function with a prior-day reservation stamp.
 // No row, clock or admission history is rewritten; transport below uses the real current day.
 report('editorial_prior_day_capacity');
 const priorDay=()=>query(`SELECT signal_processing_capacity_pre0160_v1(e.workspace_id,e.actor_user_id,e.id,e.processing_admission_id,
  ARRAY['topic_interpretation'],'anthropic',$2,$3::jsonb,(e.input_snapshot->>'claude_cap_micro_usd')::bigint,
  'interpretation',$4::uuid,$5::bigint,clock_timestamp()-interval '1 day') FROM signal_topic_catalog_executions e WHERE e.id=$1`,
  [lease.execution_id,sonnet.model,JSON.stringify(sonnet),call.call_id,batch.reserved_micro_usd]);
 if(admitted.receipt.daily_cap_micro_usd===null)await priorDay();
 else{await query('SAVEPOINT prior_day');await assert.rejects(priorDay,/processing_budget_date_expired/);
  await query('ROLLBACK TO SAVEPOINT prior_day');await query('RELEASE SAVEPOINT prior_day');}

 await query('SAVEPOINT authority_revoked');
 await query("UPDATE users SET status='inactive' WHERE id=$1",[access.actor_user_id]);
 await assert.rejects(money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token}),/forbidden/);
 await query('ROLLBACK TO SAVEPOINT authority_revoked');await query('RELEASE SAVEPOINT authority_revoked');
 await query('SAVEPOINT send_simulated');
 assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token})).send_authorized,true);
 assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token})).send_authorized,false);
 await query('ROLLBACK TO SAVEPOINT send_simulated');await query('RELEASE SAVEPOINT send_simulated');
 report('editorial_renewal');
 const revoked=await editorial.revokeSignalWorkspaceIncrementalEditorialV1({...access,execution_id:lease.execution_id,idempotency_key:randomUUID(),expected_admission_operation_id:admitted.receipt.operation_id});
 await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_engine_interpretation_admission_revoked'});
 const renewView=await renewal.readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(database,{...access,execution_id:lease.execution_id});assert.ok(renewView?.can_renew);
 const renewed=await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({...access,execution_id:lease.execution_id,
  expected_admission_operation_id:revoked.receipt.operation_id,idempotency_key:randomUUID(),grant_cap_micro_usd:args.cap,
  admission_not_after:renewView.maximum_admission_not_after,provider_available:true});
 assert.equal(renewed.receipt.grant_cap_micro_usd,args.cap);assert.equal(renewed.receipt.prior_admission_operation_id,revoked.receipt.operation_id);
 assert.equal((await query("SELECT call_state FROM engine_cost_events WHERE id=$1",[call.call_id])).rows[0]?.call_state,'definitely_not_sent');
 report('editorial_contract_passed');
}
