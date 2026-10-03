import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {workspaceProjectionFixtureV1,fixtureSha as sha} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as preparation from '../signal-workspace-incremental-editorial-preparation';
import * as projection from '../signal-workspace-incremental-projection';import * as editorial from '../signal-workspace-incremental-editorial';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest} from '@noisia/query-engine';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('free evidence preparation accepts durable intents, CAS IO and exact receipts without changing numeric/cost authority',{skip:!enabled,timeout:120000},async()=>{
 const done=new Error('incremental editorial local gate complete'),clusterIds=[randomUUID(),randomUUID()] as const;let completed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
  cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
   const f=await incrementalProjectionFixtureV1(base,clusterIds,{emerging_component:true,migrations_applied:true}),{query,database,access}=f;
   for(const migration of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql','0150_signal_workspace_incremental_editorial_preparation.sql','0151_signal_workspace_incremental_editorial_serving.sql'])await query(await readFile(new URL(migration,import.meta.url),'utf8'));
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
   const state=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);assert.ok(state);assert.equal(state.can_prepare,true);assert.equal(state.preparation,null);
   const readOnly=await query("SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id]);assert.equal(readOnly.rows[0]!.n,0);
   const request={...scope,expected_source_digest:state.source_digest,idempotency_key:randomUUID()};
   await assert.rejects(preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,actor_user_id:randomUUID()}),/forbidden/u);
   await assert.rejects(preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,expected_source_digest:sha('wrong cut')}),/source_stale/u);
   const loseCommitAck=()=>Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();const wrapped=Object.create(client);let committed=false;
    wrapped.query=async(sql:string,parameters?:unknown[])=>{if(sql==='ROLLBACK'&&committed)return{rows:[],rowCount:0};const result=await client.query(sql,parameters);if(sql==='COMMIT'){committed=true;throw Object.assign(Error('local commit acknowledgement lost'),{code:'ECONNRESET'});}return result;};wrapped.release=()=>{};return wrapped;}});
   await assert.rejects(preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,database:loseCommitAck(),numeric_execution_id:request.numeric_execution_id.toUpperCase()}),/acknowledgement lost/u);
   const accepted=await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request);assert.equal(accepted.replayed,true);
   assert.equal(accepted.receipt.charge_micro_usd,0);assert.equal((await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request)).replayed,true);
   assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...access,idempotency_key:request.idempotency_key}))?.request?.receipt.operation_id,accepted.receipt.operation_id);
   await assert.rejects(preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,expected_source_digest:sha('other body')}),/idempotency_conflict/u);
   await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,idempotency_key:randomUUID()});
   assert.equal((await query("SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id])).rows[0]!.n,1);
   assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.has_pending_work,true);
   const recovered=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...access,numeric_execution_id:randomUUID(),idempotency_key:request.idempotency_key});
   assert.equal(recovered?.numeric_execution_id,f.lease.execution_id);assert.equal(recovered.request?.receipt.operation_id,accepted.receipt.operation_id);
   await rollback(async()=>{await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active')",[access.workspace_id]);
    const historical=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...access,numeric_execution_id:randomUUID(),idempotency_key:request.idempotency_key});
    assert.equal(historical?.request?.receipt.operation_id,accepted.receipt.operation_id);assert.equal(historical.is_current,false);assert.equal(historical.can_prepare,false);
    assert.equal((await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request)).replayed,true);
   });
   const emptyCatalog=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect(),wrapped=Object.create(client);
    wrapped.query=async(sql:string,params?:unknown[])=>{if(sql.includes('SELECT id,taxonomy_id FROM signal_taxonomy_profiles'))throw Error('workspace_topic_catalog_empty');return client.query(sql,params);};wrapped.release=()=>{};return wrapped;}});
   const emptyReceipt=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...access,database:emptyCatalog,numeric_execution_id:randomUUID(),idempotency_key:request.idempotency_key});
   assert.equal(emptyReceipt?.request?.receipt.operation_id,accepted.receipt.operation_id);assert.equal(emptyReceipt.is_current,false);
   await rollback(async()=>{await assert.rejects(query("UPDATE signal_topic_classification_outbox SET dispatch_kind='engine_progress',preparation_operation_id=NULL WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id]),/dispatch_invalid|Dispatch authority is immutable/u);});
   const job={...scope,worker_job_id:accepted.receipt.worker_job_id};
   await assert.rejects(preparation.claimSignalWorkspaceIncrementalEditorialPreparationV1(job),/lease_conflict/u);
   const dispatchToken=randomUUID();await query("UPDATE signal_topic_classification_outbox SET status='dispatching',attempt_count=1,lease_token=$2::uuid,lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id,dispatchToken]);
   const claimed=await preparation.claimSignalWorkspaceIncrementalEditorialPreparationV1(job);assert.equal(claimed.completed,false);if(claimed.completed)assert.fail('not expected');
   const read={database,lease:claimed.lease};
   await preparation.heartbeatSignalWorkspaceIncrementalEditorialPreparationV1(read);
   assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.preparation?.status,'running');
   await assert.rejects(preparation.claimSignalWorkspaceIncrementalEditorialPreparationV1(job),/lease_conflict/u);
   const context=await preparation.readSignalWorkspaceIncrementalEditorialPreparationContextV1(read);assert.equal(context.artifacts.length,6);assert.equal(context.checkpoint.checkpoint_digest,f.checkpoint.checkpoint_digest);
   const origins=await preparation.readSignalWorkspaceIncrementalEditorialPreparationOriginsV1(read);assert.ok(origins.items.some(o=>o.kind==='full_fit'));assert.ok(origins.items.some(o=>o.kind==='incremental'&&o.execution_id===f.lease.execution_id));
   const exclusions=(await preparation.readSignalWorkspaceIncrementalEditorialPreparationExclusionsV1(read)).items;
   assert.deepEqual(exclusions.map(row=>({unit_key:row.unit_key,reason:row.reason})),[{unit_key:f.components.find(component=>component.model_origin.execution_id!==f.lease.execution_id)!.units[0]!.unit_key,reason:'already_interpreted'}]);
   const all=[];let after:string|undefined;for(;;){const page=await preparation.readSignalWorkspaceIncrementalEditorialPreparationRootsV1({...read,after_root_id:after,limit:1});all.push(...page.items);after=page.next_cursor??undefined;if(page.done)break;}assert.equal(all.length,f.roots.length);
   const refs=f.chunks.slice(-2).map(chunk=>{const root=f.roots.find(r=>r.root_id===chunk.root_id)!;return{root_id:chunk.root_id,root_fingerprint:root.root_fingerprint,asset_sha256:root.asset_sha256,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};});
   assert.equal((await preparation.readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1({...read,references:refs})).length,2);
   await assert.rejects(preparation.readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1({...read,references:[{...refs[0]!,root_id:randomUUID()}]}),/fragment_invalid/u);
   await rollback(async()=>{await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[access.workspace_id]);
    await assert.rejects(preparation.readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1({...read,references:refs}),/source_stale/u);
    const historical=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...access,idempotency_key:request.idempotency_key});assert.equal(historical?.request?.receipt.operation_id,accepted.receipt.operation_id);assert.equal(historical?.can_prepare,false);
    assert.equal((await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request)).replayed,true);
   });
   // Dispatcher ACK may arrive after the Worker has begun; it cannot clear IO ownership.
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence' AND lease_token=$2::uuid",[f.lease.execution_id,dispatchToken]);
   await preparation.heartbeatSignalWorkspaceIncrementalEditorialPreparationV1(read);
   await rollback(async()=>{await query("UPDATE signal_topic_classification_outbox SET preparation_expires_at=clock_timestamp()-interval '1 second' WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id]);
    await assert.rejects(preparation.completeSignalWorkspaceIncrementalEditorialPreparationV1({...read,evidence,stored}),/lease_conflict/u);
    await preparation.recoverSignalWorkspaceIncrementalEditorialPreparationsV1({database});assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.preparation?.status,'pending');
    await assert.rejects(preparation.heartbeatSignalWorkspaceIncrementalEditorialPreparationV1(read),/lease_conflict/u);
   });
   await rollback(async()=>{await preparation.failSignalWorkspaceIncrementalEditorialPreparationV1({...read,error_code:'workspace_incremental_editorial_preparation_fragment_invalid'});
    assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.has_pending_work,false);
    await assert.rejects(preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,idempotency_key:randomUUID()}),/retry_unavailable/u);
   });
   await rollback(async()=>{await preparation.failSignalWorkspaceIncrementalEditorialPreparationV1({...read,error_code:'workspace_incremental_editorial_preparation_transport_unavailable'});
    await query("UPDATE signal_topic_classification_outbox SET attempt_count=8,status='dead_letter' WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[f.lease.execution_id]);
    const exhausted=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);assert.equal(exhausted?.can_prepare,true);assert.equal(exhausted?.has_pending_work,false);
    const retried=await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,idempotency_key:randomUUID()});assert.equal(retried.receipt.worker_job_id,accepted.receipt.worker_job_id);
    assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.preparation?.attempt_count,0);
   });
   // A complete plan plus outbox receipt commit as one unit. Lost ACK does not lose success.
   let lost=false;const lostAck=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();const wrapped=Object.create(client);let committed=false;
    wrapped.query=async(sql:string,parameters?:unknown[])=>{if(sql==='ROLLBACK'&&committed)return{rows:[],rowCount:0};const result=await client.query(sql,parameters);if(sql==='COMMIT'){committed=true;lost=true;throw Object.assign(Error('local commit acknowledgement lost'),{code:'ECONNRESET'});}return result;};wrapped.release=()=>{};return wrapped;}});
   await assert.rejects(preparation.completeSignalWorkspaceIncrementalEditorialPreparationV1({...read,database:lostAck,evidence,stored}),/acknowledgement lost/u);assert.equal(lost,true);
   const completedState=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);assert.equal(completedState?.preparation?.status,'ready');assert.ok(completedState?.preparation?.plan_artifact_id);
   assert.deepEqual(await preparation.claimSignalWorkspaceIncrementalEditorialPreparationV1(job),{completed:true,artifact_id:completedState.preparation.plan_artifact_id});
   assert.equal((await preparation.completeSignalWorkspaceIncrementalEditorialPreparationV1({...read,evidence,stored})).replayed,true);
   await preparation.failSignalWorkspaceIncrementalEditorialPreparationV1({...read,error_code:'workspace_incremental_editorial_preparation_transport_unavailable'});
   assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.preparation?.status,'ready');
   assert.equal((await query("SELECT count(*)::int n FROM analysis_artifacts WHERE workspace_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'",[access.workspace_id])).rows[0]!.n,0);
   assert.equal((await query("SELECT count(*)::int n FROM signal_classification_operations WHERE workspace_id=$1::uuid AND operation_kind='authorize-interpretation'",[access.workspace_id])).rows[0]!.n,0);
   assert.deepEqual(await baseline(),original);completed=true;throw done;
  }}),error=>{if(error!==done)throw error;return true;});
 assert.equal(completed,true);
});
