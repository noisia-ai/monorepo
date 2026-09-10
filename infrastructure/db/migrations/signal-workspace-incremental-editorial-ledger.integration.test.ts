import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {workspaceProjectionFixtureV1,fixtureSha as sha} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as projection from '../signal-workspace-incremental-projection';import * as editorial from '../signal-workspace-incremental-editorial';
import * as engine from '../signal-workspace-engine';import * as runtime from '../signal-workspace-incremental-editorial-execution';import * as money from '../signal-workspace-engine-interpretation';
import * as ui from '../signal-workspace-incremental-editorial-status';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet,buildSignalWorkspaceInterpretationBatchV1 as buildBatch,buildSignalWorkspaceInterpretationRepairBatchV1 as buildRepair,signalWorkspaceInterpretationReferenceIdV1 as refId,type SignalWorkspaceInterpretationV1} from '@noisia/query-engine';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('incremental editorial sealed requests use the unique monetary ledger, retain receipts and finish without fitting or providers',{skip:!enabled,timeout:120000},async()=>{
 const done=new Error('incremental editorial local gate complete'),clusterIds=[randomUUID(),randomUUID()] as const;let completed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
  cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
   const f=await incrementalProjectionFixtureV1(base,clusterIds,{emerging_component:true,migrations_applied:true}),{query,database,access}=f;
   await query(await readFile(new URL('./0148_signal_workspace_incremental_editorial.sql',import.meta.url),'utf8'));
   await query(await readFile(new URL('./0149_signal_workspace_incremental_editorial_ledger.sql',import.meta.url),'utf8'));
   await query(await readFile(new URL('./0151_signal_workspace_incremental_editorial_serving.sql',import.meta.url),'utf8'));
   const scope={...access,numeric_execution_id:f.lease.execution_id};
   const rollback=async(work:()=>Promise<void>)=>{await query('BEGIN');try{await work();}finally{await query('ROLLBACK');}};
   const baseline=async()=>({artifacts:(await query("SELECT to_jsonb(artifact) body FROM analysis_artifacts artifact WHERE engine_execution_id=ANY($1::uuid[]) AND metadata->>'contract_version' IS DISTINCT FROM 'workspace-incremental-unit-census-v1' ORDER BY id",[[base.lease.execution_id,f.lease.execution_id]])).rows,engine:(await query('SELECT to_jsonb(run) body FROM signal_topic_catalog_executions run WHERE id=ANY($1::uuid[]) ORDER BY id',[[base.lease.execution_id,f.lease.execution_id]])).rows,
    calls:(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
    workspace:(await query('SELECT to_jsonb(workspace) body FROM signal_workspaces workspace WHERE id=$1::uuid',[access.workspace_id])).rows,
    models:(await query('SELECT to_jsonb(model) body FROM tagging_model_versions model WHERE id=ANY($1::uuid[]) ORDER BY id',[[f.checkpoint.model_version_id,f.lease.snapshot.numeric_descriptor!.parent.model_version_id].filter(Boolean)])).rows});
   const original=await baseline();assert.ok(original.models.length>0);
   assert.equal((await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope)).can_authorize,false);
   await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database});
   const outbox=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[f.lease.execution_id])).rows[0]!;
   const derivationScope={...access,execution_id:f.lease.execution_id,worker_job_id:outbox.worker_job_id};
   const derivation=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1(derivationScope);
   await projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...derivationScope,derivation_digest:derivation.derivation_digest,
    units:f.components.flatMap(component=>component.units.map(unit=>({...unit,component_key:component.component_key})))});
   const units:editorial.SignalWorkspaceIncrementalEditorialEvidenceUnitV1[]=f.components.flatMap(component=>component.units.map(unit=>({...unit,
    component_key:component.component_key,model_origin:component.model_origin,lane:component.lane,
    status:component.model_origin.execution_id!==f.lease.execution_id?'legacy_full_fit' as const:unit.local_label===1?'no_current_members' as const:'evidence_ready' as const,
    root_count:unit.local_label===1?0:f.roots.length,chunk_count:unit.local_label===1?0:f.chunks.length,cluster_digest:sha(`local current census ${unit.unit_key}`)}))).sort((a,b)=>a.unit_key<b.unit_key?-1:1);
   const targets=units.filter(unit=>unit.status==='evidence_ready'),streamBody='Explicit local unit-evidence bytes; provider disabled.\n';
   const descriptor={contract_version:'workspace-incremental-editorial-evidence-stream-v1' as const,numeric_execution_id:f.lease.execution_id,numeric_checkpoint_digest:f.checkpoint.checkpoint_digest,
    numeric_manifest_sha256:sha(JSON.stringify(f.output)),population_digest:f.output.population_digest,representative_selection_policy:'distinct-roots-affiliation-boundary-v1' as const,
    census:{roots:f.roots.length,chunks:f.chunks.length,memberships:f.output.counts.memberships,pending_roots:1,pending_occurrences:f.output.counts.pending_occurrences,
     expected_unit_count:units.length,expected_unit_digest:unitDigest(units.map(unit=>unit.unit_key)),population_digest:f.output.population_digest},
    numeric_component_order:f.components.map(component=>component.component_key),origins:[{execution_id:f.lease.execution_id,manifest_sha256:sha(JSON.stringify(f.output)),candidate_sha256:sha('[]')}],units,
    target_unit_digest:unitDigest(targets.map(unit=>unit.unit_key)),target_binding_digest:digest(targets.map(({component_key,local_label,unit_key,birth_membership_digest,model_origin})=>({component_key,unit:{local_label,unit_key,birth_membership_digest},model_origin}))),
    stream:{contract_version:'workspace-incremental-editorial-evidence-jsonl-v1' as const,rows:targets.length,bytes:Buffer.byteLength(streamBody),sha256:sha(streamBody)}};
   const evidence={...descriptor,evidence_digest:digest(descriptor)};
   const stored={storage_key:`workspace-engine/${access.workspace_id}/${f.lease.execution_id}/editorial/${evidence.evidence_digest.slice(7)}.jsonl`,sha256:sha(streamBody),size_bytes:Buffer.byteLength(streamBody),media_type:'application/octet-stream'};

   const plan=await editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored});
   const preview=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope);assert.ok(preview.target_unit_digest);
   const admissionArgs={...scope,expected_evidence_plan_artifact_id:plan.artifact_id,expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,expected_target_unit_digest:preview.target_unit_digest,expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),cap_micro_usd:2000000,admission_not_after:preview.maximum_admission_not_after};
   await rollback(async()=>{const deadline=(await query("SELECT clock_timestamp()+interval '600 milliseconds' deadline")).rows[0]!.deadline as Date;
    const short=await editorial.beginSignalWorkspaceIncrementalEditorialV1({...admissionArgs,admission_not_after:deadline.toISOString()});
    const dispatch=await runtime.enqueueSignalWorkspaceIncrementalEditorialV1({...access,execution_id:short.execution_id});
    await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[short.execution_id]);
    const shortLease=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...dispatch,database});assert.ok(!('completed' in shortLease));
    await query("SELECT pg_sleep(GREATEST(0,extract(epoch from $1::timestamptz-clock_timestamp()))+0.02)",[deadline]);
    await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...access,execution_id:short.execution_id,idempotency_key:randomUUID(),request_digest:sha('expired admission'),configuration:sonnet,reserved_micro_usd:100,budget_timezone:short.receipt.budget_timezone,daily_cap_micro_usd:short.receipt.daily_cap_micro_usd,execution_token:shortLease.execution_token,admission_operation_id:short.receipt.operation_id}),/daily_authority_expired/u);
    assert.equal((await query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[short.execution_id])).rows[0]!.n,0);
   });
   const admitted=await editorial.beginSignalWorkspaceIncrementalEditorialV1(admissionArgs);
   const runScope={...access,execution_id:admitted.execution_id};
   const inert=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope);
   assert.equal(inert?.status,'queued');assert.equal(inert.has_pending_work,false);assert.equal(inert.dispatch,null);
   const queued=await runtime.enqueueSignalWorkspaceIncrementalEditorialV1(runScope);
   assert.equal((await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope))?.has_pending_work,true);
   assert.equal((await runtime.enqueueSignalWorkspaceIncrementalEditorialV1(runScope)).worker_job_id,queued.worker_job_id);
   const exhaustDispatch=async()=>{await query(`WITH dead AS(UPDATE signal_topic_classification_outbox SET status='dead_letter',attempt_count=8,error_code='workspace_incremental_editorial_transport_unavailable',lease_token=NULL,lease_expires_at=NULL WHERE execution_id=$1::uuid AND dispatch_kind='execution' RETURNING execution_id,error_code) UPDATE signal_topic_catalog_executions execution SET status='failed',error_code=dead.error_code,completed_at=clock_timestamp() FROM dead WHERE execution.id=dead.execution_id AND execution.status='queued'`,[admitted.execution_id]);};
   await rollback(async()=>{await assert.rejects(query("UPDATE signal_topic_catalog_executions SET status='failed',error_code='workspace_incremental_editorial_transport_unavailable' WHERE id=$1::uuid",[admitted.execution_id]),/transition_invalid/u);});
   await exhaustDispatch();assert.equal((await query("SELECT result_summary->>'worker_job_id' job,status FROM signal_topic_catalog_executions WHERE id=$1::uuid",[admitted.execution_id])).rows[0]!.job,null);
   assert.equal((await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope))?.can_retry,true);
   await rollback(async()=>{
    const retry={...runScope,expected_worker_job_id:queued.worker_job_id,idempotency_key:randomUUID(),provider_available:true};
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,provider_available:false}),/provider_unavailable/u);
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,actor_user_id:randomUUID()}),/forbidden/u);
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,expected_worker_job_id:'wrong-job'}),/retry_unavailable/u);
    const rejectReceipt=Object.assign(Object.create(database),{connect:async()=>{const c=await database.connect(),wrapped=Object.create(c);wrapped.release=()=>{};
     wrapped.query=async(sql:string,values?:unknown[])=>{if(sql.includes('SET result_summary=jsonb_set'))throw Error('local retry receipt rejected');return c.query(sql,values);};return wrapped;}});
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,database:rejectReceipt}),/local retry receipt rejected/u);
    const afterRejected=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1({...runScope,idempotency_key:retry.idempotency_key});
    assert.equal(afterRejected?.status,'failed');assert.equal(afterRejected.dispatch?.status,'dead_letter');assert.equal(afterRejected.request,null);
    let lost=false;const lostRetryAck=Object.assign(Object.create(database),{connect:async()=>{const c=await database.connect(),wrapped=Object.create(c);let committed=false;wrapped.release=()=>{};
     wrapped.query=async(sql:string,values?:unknown[])=>{if(sql==='ROLLBACK'&&committed)return{rows:[],rowCount:0};const result=await c.query(sql,values);
      if(sql==='COMMIT'){committed=true;lost=true;throw Error('local retry ACK lost');}return result;};return wrapped;}});
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,database:lostRetryAck}),/local retry ACK lost/u);assert.equal(lost,true);
    await exhaustDispatch();
    const replayed=await ui.retrySignalWorkspaceIncrementalEditorialV1(retry);assert.equal(replayed.replayed,true);assert.equal(replayed.receipt.retry_count,1);
    const acknowledged=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1({...access,idempotency_key:retry.idempotency_key,execution_id:randomUUID()});
    assert.equal(acknowledged?.execution_id,admitted.execution_id);assert.equal(acknowledged.status,'failed');assert.deepEqual(acknowledged.request?.receipt,replayed.receipt);
    await assert.rejects(ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,expected_worker_job_id:'different-job'}),/idempotency_conflict/u);
    await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);
    const historical=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1({...access,idempotency_key:retry.idempotency_key});
    assert.equal(historical?.is_current,false);assert.deepEqual(historical.request?.receipt,replayed.receipt);assert.equal(historical.can_retry,false);
    assert.equal((await ui.retrySignalWorkspaceIncrementalEditorialV1({...retry,provider_available:false})).replayed,true);
    assert.equal((await query("SELECT (result_summary->>'delivery_retry_count')::int n FROM signal_topic_catalog_executions WHERE id=$1::uuid",[admitted.execution_id])).rows[0]!.n,1);
   });
   assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:queued.worker_job_id})).requeued,true);
   assert.equal((await query('SELECT attempt_count FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid',[admitted.execution_id])).rows[0]!.attempt_count,0);
   assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:queued.worker_job_id})).requeued,false);
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[admitted.execution_id]);
   const claimed=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in claimed));let lease=claimed;
   await assert.rejects(engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:lease.worker_job_id}),/not_found/u);
   const context=await runtime.readSignalWorkspaceIncrementalEditorialContextV1({database,lease});
   const allUnits=await runtime.readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1({database,lease});assert.deepEqual(allUnits,evidence.units);assert.deepEqual(await runtime.readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1({database,lease:{...lease,evidence_plan_artifact_id:randomUUID()}}),evidence.units);
   const chunk=f.chunks[0]!,identity={root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};
   const group={cluster_id:targets[0]!.unit_key,lane:targets[0]!.lane,cluster_digest:targets[0]!.cluster_digest,root_count:targets[0]!.root_count,chunk_count:targets[0]!.chunk_count,terms:['local evidence'],representatives:[{...identity,text:chunk.text,strength:0.9,selection_reason:'high_affiliation' as const,ref_id:refId(identity)}]};
   const batch=buildBatch(context.context,[group],sonnet),jsonl=JSON.stringify({contract_version:'workspace-incremental-editorial-batch-v1',index:0,batch})+'\n';
   const request={index:0,batch_key:batch.batch_key,request_digest:batch.request_digest,unit_keys:[group.cluster_id],reserved_micro_usd:batch.reserved_micro_usd,offset:0,size_bytes:Buffer.byteLength(jsonl),sha256:sha(jsonl)};
   const unsigned={contract_version:'workspace-incremental-editorial-batch-plan-v1' as const,workspace_id:access.workspace_id,editorial_execution_id:lease.execution_id,numeric_execution_id:lease.numeric_execution_id,evidence_digest:evidence.evidence_digest,target_unit_digest:evidence.target_unit_digest,target_binding_digest:evidence.target_binding_digest,context_digest:context.context.context_digest,configuration_digest:digest(sonnet),units:1,batches:1,requests:[request],stream:{bytes:Buffer.byteLength(jsonl),sha256:sha(jsonl)}};
   const requestPlan={...unsigned,plan_digest:digest(unsigned)},batchStored={storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/batches.jsonl`,sha256:sha(jsonl),size_bytes:Buffer.byteLength(jsonl),media_type:'application/octet-stream'};
   const reserve={...runScope,idempotency_key:batch.batch_key,request_digest:batch.request_digest,configuration:sonnet,reserved_micro_usd:batch.reserved_micro_usd,budget_timezone:admitted.receipt.budget_timezone,daily_cap_micro_usd:admitted.receipt.daily_cap_micro_usd,execution_token:lease.execution_token,admission_operation_id:admitted.receipt.operation_id};
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1(reserve),/request_not_admitted/u);
   await assert.rejects(runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:{...requestPlan,requests:[]},stored:batchStored}),/invalid/u);
   const bad={...unsigned,requests:[{...request,unit_keys:['guided:foreign']}]};await assert.rejects(runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:{...bad,plan_digest:digest(bad)},stored:batchStored}),/invalid/u);
   await rollback(async()=>{const extra={...request,index:99,request_digest:sha('extra request'),batch_key:'interpretation:'+sha('extra request').slice(7)};
    const authority=sha(`${lease.input_digest}:${lease.execution_id}`);
    await query(`INSERT INTO analysis_artifacts(workspace_id,engine_execution_id,artifact_key,artifact_type,title,content,metadata,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest) VALUES($1::uuid,$2::uuid,'editorial-request-99','engine_output','Unpublished request negative',$3::jsonb,$4::jsonb,'topic_discovery',$5,$5)`,[access.workspace_id,lease.execution_id,JSON.stringify({contract_version:'workspace-engine-private-artifact-v1',...batchStored}),JSON.stringify({contract_version:'workspace-incremental-editorial-request-v1',plan_digest:sha('other plan'),request:extra}),authority]);
    await assert.rejects(runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:requestPlan,stored:batchStored}),/request_plan_invalid/u);
    await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:randomUUID(),request_digest:extra.request_digest}),/request_not_admitted/u);
   });
   let lost=false;const lostAck=Object.assign(Object.create(database),{connect:async()=>{const c=await database.connect(),wrapped=Object.create(c);let committed=false;wrapped.release=()=>{};wrapped.query=async(sql:string,values?:unknown[])=>{if(sql==='ROLLBACK'&&committed)return{rows:[],rowCount:0};const result=await c.query(sql,values);if(sql==='COMMIT'){committed=true;lost=true;throw Object.assign(Error('local lost ACK'),{code:'ECONNRESET'});}return result;};return wrapped;}});
   await assert.rejects(runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database:lostAck,lease,plan:requestPlan,stored:batchStored}),/local lost ACK/u);assert.equal(lost,true);
   await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_incremental_editorial_transport_unavailable'});
   assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id})).requeued,true);
   assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id})).requeued,false);
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[lease.execution_id]);
   const resumed=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in resumed));lease=resumed;reserve.execution_token=lease.execution_token;
   const acceptedPlan=await runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:requestPlan,stored:batchStored});assert.ok(acceptedPlan.artifact_id);
   for(const code of ['workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable'])await rollback(async()=>{await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:code});assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id})).requeued,true);});
   await rollback(async()=>{await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_engine_interpretation_receipt_recovery_required'});await assert.rejects(runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id}),/retry_unavailable/u);});
   await rollback(async()=>{await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_incremental_editorial_worker_failed'});await assert.rejects(runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id}),/retry_unavailable/u);});
   await rollback(async()=>{let retryLease=lease;const count=(await query("SELECT COALESCE((result_summary->>'delivery_retry_count')::int,0) n FROM signal_topic_catalog_executions WHERE id=$1::uuid",[lease.execution_id])).rows[0]!.n;for(let n=count;n<8;n++){
    await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease:retryLease,error_code:'workspace_incremental_editorial_transport_unavailable'});
    await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id});
    await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[lease.execution_id]);
    const next=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in next));retryLease=next;
   }await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease:retryLease,error_code:'workspace_incremental_editorial_transport_unavailable'});await assert.rejects(runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id}),/retry_unavailable/u);});
   assert.equal((await runtime.persistSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease,plan:requestPlan,stored:batchStored})).replayed,true);
   assert.equal((await runtime.readSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease}))?.plan.plan_digest,requestPlan.plan_digest);
   assert.deepEqual((await runtime.readSignalWorkspaceIncrementalEditorialRequestsV1({database,lease})).map(row=>row.request),requestPlan.requests);
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:randomUUID(),request_digest:sha('unplanned')}),/request_not_admitted/u);
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:randomUUID(),reserved_micro_usd:reserve.reserved_micro_usd+1}),/request_not_admitted/u);
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,execution_id:f.lease.execution_id}),/fit_required|forbidden|admission_changed/u);
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,configuration:{...sonnet,model:'claude-opus-5'}}),/config_mismatch/u);
   const originalCall=await money.reserveSignalWorkspaceEngineInterpretationV1(reserve);assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(reserve)).call_id,originalCall.call_id);
   await rollback(async()=>{await money.failSignalWorkspaceEngineInterpretationV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,outcome:'definitely_not_sent',error_code:'workspace_engine_interpretation_transport_failed'});
    const next=await money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:randomUUID(),retry_of_call_id:originalCall.call_id});assert.notEqual(next.call_id,originalCall.call_id);assert.equal(next.request_digest,originalCall.request_digest);});
   await rollback(async()=>{await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,execution_token:lease.execution_token});
    await money.failSignalWorkspaceEngineInterpretationV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_outcome_unknown'});
    await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_incremental_editorial_transport_unavailable'});
    const uncertain=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope);assert.equal(uncertain?.has_unresolved_call,true);assert.equal(uncertain.can_retry,false);
    await assert.rejects(runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id}),/retry_unavailable/u);
   });
   await rollback(async()=>{
    const terminalize=async(call:money.SignalWorkspaceEngineInterpretationCallV1,token:string)=>{
     await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:token});
     const sent=(await query('SELECT sent_at FROM engine_cost_events WHERE id=$1::uuid',[call.call_id])).rows[0]!.sent_at as Date;
     await money.failSignalWorkspaceEngineInterpretationV1({database,call_id:call.call_id,attempt_token:call.attempt_token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_outcome_unknown'});
     const live={...lease,execution_token:token};await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease:live,error_code:'workspace_incremental_editorial_transport_unavailable'});
     return money.reconcileSignalWorkspaceEngineTerminalV1({...runScope,call_id:call.call_id,attempt_token:call.attempt_token,expected_request_digest:call.request_digest,verifier_user_id:access.actor_user_id,terminal:{source:'anthropic_console',provider_request_id:'req_local_'+call.call_id.replaceAll('-',''),provider_model:sonnet.model,started_at:sent.toISOString(),ended_at:sent.toISOString(),http_status:499,reason:'client_disconnected',usage:{input_tokens:1000,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},evidence:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/private-proof-${call.call_id}`,sha256:sha('explicit local fake console evidence'),size_bytes:40}}});
    };
    const terminal=await terminalize(originalCall,lease.execution_token);assert.equal(terminal.state,'terminal_confirmed');assert.equal(terminal.settled_micro_usd,null);assert.equal(terminal.response,null);
    await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id});
    await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[lease.execution_id]);
    const nextLease=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in nextLease));
    const successor=await money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,execution_token:nextLease.execution_token,idempotency_key:randomUUID(),retry_of_call_id:originalCall.call_id});
    const budget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...runScope});assert.equal(budget.terminal_reserved_micro_usd,originalCall.reserved_micro_usd);assert.equal(budget.reserved_micro_usd,2*originalCall.reserved_micro_usd);
    await terminalize(successor,nextLease.execution_token);
    await assert.rejects(runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id}),/retry_unavailable/u);
   });
   assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,execution_token:lease.execution_token})).send_authorized,true);
   const invalidBody=JSON.stringify({interpretations:[{citations:['x']}]});const originalResponse={storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/response-original.json`,sha256:sha(invalidBody),size_bytes:Buffer.byteLength(invalidBody),http_status:200,provider_request_id:'local-fake-http-original',complete:true};
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,response:originalResponse});
   await rollback(async()=>{await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_engine_interpretation_receipt_recovery_required'});assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id})).requeued,true);});
   const usage={input_tokens:1000,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0};await money.settleSignalWorkspaceEngineInterpretationV1({database,call_id:originalCall.call_id,attempt_token:originalCall.attempt_token,usage});
   await rollback(async()=>{const before=(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows;
    await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_incremental_editorial_transport_unavailable'});
    await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id});
    await exhaustDispatch();assert.equal((await query('SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0]!.status,'failed');
    assert.equal((await runtime.requeueSignalWorkspaceIncrementalEditorialV1({...runScope,worker_job_id:lease.worker_job_id})).requeued,true);
    assert.deepEqual((await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows,before);
   });
   const repair=buildRepair(batch,{source_call_id:originalCall.call_id,source_response_sha256:originalResponse.sha256,diagnostic:'output_invalid'});const repairBytes=JSON.stringify(repair),repairStored={...batchStored,storage_key:batchStored.storage_key+'.repair',sha256:sha(repairBytes),size_bytes:Buffer.byteLength(repairBytes)};
   const repairReserve={...reserve,idempotency_key:repair.batch_key,request_digest:repair.request_digest,reserved_micro_usd:repair.reserved_micro_usd,editorial_repair:repair.editorial_repair};
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1(repairReserve),/request_not_admitted|unmaterialized settled source/u);
   await runtime.persistSignalWorkspaceIncrementalEditorialRepairV1({database,lease,original:batch,batch:repair,stored:repairStored});
   const repairCall=await money.reserveSignalWorkspaceEngineInterpretationV1(repairReserve);
   assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:repairCall.call_id,attempt_token:repairCall.attempt_token,execution_token:lease.execution_token})).send_authorized,true);
   // Revoke after a proven send: receipt/settlement/checkpoint remain recoverable.
   await editorial.revokeSignalWorkspaceIncrementalEditorialV1({...runScope,expected_admission_operation_id:admitted.receipt.operation_id,idempotency_key:randomUUID()});
   const interpretations:SignalWorkspaceInterpretationV1[]=[{cluster_id:group.cluster_id,cluster_digest:group.cluster_digest,status:'coherent',name:'Local evidence',definition:'A bounded local fixture interpretation.',inclusion:[{text:'Current evidence',citations:[group.representatives[0]!.ref_id]}],exclusion:[],citations:[group.representatives[0]!.ref_id]}];
   const responseBody=JSON.stringify({interpretations});const repairResponse={...originalResponse,storage_key:originalResponse.storage_key+'.repair',sha256:sha(responseBody),size_bytes:Buffer.byteLength(responseBody),provider_request_id:'local-fake-http-repair'};
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({database,call_id:repairCall.call_id,attempt_token:repairCall.attempt_token,response:repairResponse});
   const settled=await money.settleSignalWorkspaceEngineInterpretationV1({database,call_id:repairCall.call_id,attempt_token:repairCall.attempt_token,usage});assert.equal(settled.settled_micro_usd,3150);
   assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(repairReserve)).call_id,repairCall.call_id);
   const outputBody=JSON.stringify({contract_version:'workspace-incremental-editorial-result-v1',context:repair.context,clusters:repair.clusters,interpretations,editorial_repair:repair.editorial_repair});
   const checkpointStored={...batchStored,storage_key:batchStored.storage_key+'.checkpoint',sha256:sha(outputBody),size_bytes:Buffer.byteLength(outputBody)};
   const checkpoint=await runtime.persistSignalWorkspaceIncrementalEditorialCheckpointV1({database,lease,batch:repair,interpretations,call_id:repairCall.call_id,response_sha256:repairResponse.sha256,stored:checkpointStored});
   assert.equal((await runtime.persistSignalWorkspaceIncrementalEditorialCheckpointV1({database,lease,batch:repair,interpretations,call_id:repairCall.call_id,response_sha256:repairResponse.sha256,stored:checkpointStored})).replayed,true);
   assert.equal((await runtime.readSignalWorkspaceIncrementalEditorialCheckpointsV1({database,lease}))[0]?.artifact_id,checkpoint.artifact_id);
   await rollback(async()=>{
    const callsBefore=(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows;
    await runtime.failSignalWorkspaceIncrementalEditorialV1({database,lease,error_code:'workspace_incremental_editorial_transport_unavailable'});
    const recorded=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope);
    assert.equal(recorded?.requires_authorization,true);assert.equal(recorded.can_retry,true);assert.equal(recorded.interpreted_units,recorded.expected_units);
    assert.equal(recorded.recorded_recovery_available,true);
    const recovered=await ui.retrySignalWorkspaceIncrementalEditorialV1({...runScope,expected_worker_job_id:lease.worker_job_id,idempotency_key:randomUUID(),provider_available:false});
    assert.equal(recovered.replayed,false);
    await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[lease.execution_id]);
    const finishLease=await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database});assert.ok(!('completed' in finishLease));
    assert.equal((await runtime.finishSignalWorkspaceIncrementalEditorialV1({database,lease:finishLease})).ready,true);
    assert.deepEqual((await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows,callsBefore);
   });
   assert.equal((await runtime.finishSignalWorkspaceIncrementalEditorialV1({database,lease})).ready,true);
   assert.equal((await runtime.finishSignalWorkspaceIncrementalEditorialV1({database,lease})).replayed,true);
   const delivered=await ui.loadSignalWorkspaceIncrementalEditorialStatusV1(runScope);
   assert.equal(delivered?.status,'ready');assert.equal(delivered.expected_units,1);assert.equal(delivered.interpreted_units,1);
   assert.equal(delivered.has_pending_work,false);assert.equal(delivered.can_retry,false);assert.equal(delivered.requires_authorization,true);
   assert.deepEqual(delivered.costs,{confirmed_micro_usd:6300,reserved_micro_usd:0,terminal_reserved_micro_usd:0});
   assert.deepEqual(await runtime.claimSignalWorkspaceIncrementalEditorialV1({...queued,database}),{completed:true,execution_id:lease.execution_id,worker_job_id:lease.worker_job_id});
   const after=await baseline();assert.deepEqual(after.engine,original.engine);assert.deepEqual(after.models,original.models);assert.deepEqual(after.workspace,original.workspace);assert.deepEqual(after.artifacts,original.artifacts);
   assert.equal(after.calls.length-original.calls.length,2);assert.equal((await query('SELECT sum(settled_micro_usd)::int total FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[lease.execution_id])).rows[0]!.total,6300);
   await rollback(async()=>{await assert.rejects(query("UPDATE analysis_artifacts SET metadata=metadata||'{\"contract_version\":\"escape\"}'::jsonb WHERE id=$1::uuid",[checkpoint.artifact_id]),/immutable/u);});
   completed=true;throw done;
  }}),error=>error===done);
 assert.equal(completed,true);
});
