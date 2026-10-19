import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {workspaceProjectionFixtureV1,fixtureSha} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as preparation from '../signal-workspace-incremental-editorial-preparation';
import * as projection from '../signal-workspace-incremental-projection';
import * as editorial from '../signal-workspace-incremental-editorial';
import {beginAndEnqueueSignalWorkspaceIncrementalEditorialV1} from '../signal-workspace-incremental-editorial-admission-queue';
import {signalWorkspaceIncrementalEditorialEvidenceJobV1} from '../../../services/workers/src/workers/signal-workspace-incremental-editorial-evidence-job';
import type {WorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';

const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('free preparation Worker composes real PG authority, all origin streams and fragments into a durable evidence plan with zero-IO replay', {skip:!enabled,timeout:120000},async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('provider/network forbidden'));
 const done=new Error('composed free preparation complete'),clusterIds=[randomUUID(),randomUUID()] as const;let completed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
  cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
   const f=await incrementalProjectionFixtureV1(base,clusterIds,{emerging_component:true,migrations_applied:true,editorial_evidence:true}),{query,database,access}=f;
   for(const migration of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql','0150_signal_workspace_incremental_editorial_preparation.sql','0151_signal_workspace_incremental_editorial_serving.sql'])await query(await readFile(new URL(migration,import.meta.url),'utf8'));
   await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database});
   const numeric_execution_id=f.lease.execution_id;
   const derivationJob=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[numeric_execution_id])).rows[0]!;
   const derivationScope={...access,execution_id:numeric_execution_id,worker_job_id:derivationJob.worker_job_id};
   const derivation=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1(derivationScope);
   await projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...derivationScope,derivation_digest:derivation.derivation_digest,
    units:f.components.flatMap(component=>component.units.map(unit=>({...unit,component_key:component.component_key})))});
   const baseline=async()=>({
    engines:(await query('SELECT to_jsonb(run) body FROM signal_topic_catalog_executions run WHERE id=ANY($1::uuid[]) ORDER BY id',[[base.lease.execution_id,numeric_execution_id]])).rows,
    calls:(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,
    artifacts:(await query('SELECT to_jsonb(artifact) body FROM analysis_artifacts artifact WHERE engine_execution_id=ANY($1::uuid[]) ORDER BY id',[[base.lease.execution_id,numeric_execution_id]])).rows,
    selection:(await query('SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid',[access.workspace_id])).rows,
    grants:(await query("SELECT to_jsonb(operation) body FROM signal_classification_operations operation WHERE workspace_id=$1::uuid AND operation_kind='authorize-interpretation' ORDER BY id",[access.workspace_id])).rows,
   });
   const before=await baseline(),scope={...access,numeric_execution_id},state=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);assert.ok(state?.can_prepare);
   const accepted=await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...scope,expected_source_digest:state.source_digest,idempotency_key:randomUUID()});
   // The Worker can begin before the dispatch acknowledgement. These are real
   // DB stores; only object storage and the synthetic numeric fixture are local.
   await query("UPDATE signal_topic_classification_outbox SET status='dispatching',attempt_count=1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE execution_id=$1::uuid AND dispatch_kind='incremental_editorial_evidence'",[numeric_execution_id]);
   const io={get:0,put:0};const storage:WorkspaceEngineStorageV1={
    get:async args=>{assert.equal(args.workspace_id,access.workspace_id);assert.equal(args.execution_id,numeric_execution_id);assert.doesNotMatch(args.stored.storage_key,/\.(joblib|npy)$/u);io.get++;await f.storage.get(args);},
    put:async args=>{assert.equal(args.workspace_id,access.workspace_id);assert.equal(args.execution_id,numeric_execution_id);io.put++;
     const body=await readFile(args.file,'utf8');assert.equal(fixtureSha(body),args.sha256);assert.equal(Buffer.byteLength(body),args.size_bytes);
     const storage_key=`workspace-engine/${access.workspace_id}/${numeric_execution_id}/${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
     f.bodies.set(storage_key,body);return{storage_key,sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};},
   };
   const job={name:preparation.SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1,id:accepted.receipt.worker_job_id,
    data:{execution_id:numeric_execution_id,workspace_id:access.workspace_id,actor_user_id:access.actor_user_id},updateProgress:async()=>{}};
   const result=await signalWorkspaceIncrementalEditorialEvidenceJobV1(job,{database,storage});
   assert.ok(result.artifact_id);assert.deepEqual(io,{get:7,put:2});
   const ready=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);assert.equal(ready?.preparation?.status,'ready');assert.equal(ready.has_pending_work,false);
   assert.equal(ready.preparation.plan_artifact_id,result.artifact_id);
   const plan=(await query('SELECT content,metadata,engine_execution_id,workspace_incremental_editorial_plan_valid_v1(id) valid FROM analysis_artifacts WHERE id=$1::uuid',[result.artifact_id])).rows[0]!;
   assert.equal(plan.valid,true);assert.equal(plan.engine_execution_id,null);assert.equal(plan.metadata.numeric_execution_id,numeric_execution_id);
   assert.equal(plan.metadata.descriptor.census.roots,f.roots.length);assert.equal(plan.metadata.descriptor.census.chunks,f.chunks.length);
   assert.equal(plan.metadata.descriptor.census.expected_unit_count,2);assert.equal(plan.metadata.descriptor.stream.rows,1);
   const unitRows=(await query("SELECT metadata->'unit' unit FROM analysis_artifacts WHERE metadata->>'plan_artifact_id'=$1::text AND metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' ORDER BY metadata->'unit'->>'unit_key'",[result.artifact_id])).rows.map(row=>row.unit);
   assert.equal(unitRows.length,2);assert.deepEqual(unitRows.map(unit=>unit.status).sort(),['already_interpreted','evidence_ready']);
   const body=f.bodies.get(plan.content.storage_key);assert.ok(body);const lines=body.trim().split('\n');assert.equal(lines.length,1);
   const line=JSON.parse(lines[0]!);assert.equal(line.cluster.root_count,f.roots.length);assert.equal(line.cluster.chunk_count,f.chunks.length);
   assert.equal(line.unit.model_origin.execution_id,numeric_execution_id);assert.ok(line.cluster.representatives.length>0);
   const replay=await signalWorkspaceIncrementalEditorialEvidenceJobV1(job,{database,storage:{get:async()=>assert.fail('replay download'),put:async()=>assert.fail('replay upload')}});
   assert.equal(replay.artifact_id,result.artifact_id);assert.equal(replay.replayed,true);
   assert.deepEqual(await baseline(),before);assert.deepEqual(io,{get:7,put:2});
   assert.equal((await query("SELECT count(*)::int n FROM analysis_artifacts WHERE workspace_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'",[access.workspace_id])).rows[0]!.n,0);
   t.diagnostic(JSON.stringify({roots:f.roots.length,chunks:f.chunks.length,units:unitRows.length,evidence_rows:lines.length,downloads:io.get,uploads:io.put,replay_io:0}));
   await t.test('begin/revoke receipts remain actor-scoped before fallback/current/catalog lookups',async()=>{
    await query('BEGIN');try{
     const preview=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(access);assert.ok(preview?.can_authorize);
     const key=randomUUID();const acceptedGrant=await beginAndEnqueueSignalWorkspaceIncrementalEditorialV1({...scope,
      expected_evidence_plan_artifact_id:preview.evidence_plan_artifact_id!,expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,
      expected_target_unit_digest:preview.target_unit_digest!,expected_history_cut_digest:preview.history_cut_digest,
      idempotency_key:key,cap_micro_usd:Math.min(100000,preview.maximum_grant_micro_usd),
      admission_not_after:new Date(Date.parse(preview.maximum_admission_not_after)-1000).toISOString(),provider_available:true});
     const readGrant=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,numeric_execution_id:randomUUID(),idempotency_key:key});
     assert.deepEqual(readGrant.request?.receipt,acceptedGrant.receipt);assert.equal(readGrant.operation?.execution_id,acceptedGrant.execution_id);
     await assert.rejects(editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,actor_user_id:randomUUID(),idempotency_key:key}),/forbidden/u);
     await assert.rejects(editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,workspace_id:randomUUID(),idempotency_key:key}),/forbidden/u);
     // Role downgrade retains read access, never spending/revocation authority.
     await query('BEGIN');try{
      await query("UPDATE users SET primary_role='analyst' WHERE id=$1::uuid",[access.actor_user_id]);
      const reader=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,idempotency_key:key});
      assert.deepEqual(reader?.request?.receipt,acceptedGrant.receipt);assert.equal(reader.can_authorize,false);assert.equal(reader.operation?.can_revoke,false);
     }finally{await query('ROLLBACK');}
     await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active')",[access.workspace_id]);
     const oldGrant=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,numeric_execution_id:randomUUID(),idempotency_key:key});
     assert.deepEqual(oldGrant.request?.receipt,acceptedGrant.receipt);assert.equal(oldGrant.is_current,false);assert.equal(oldGrant.can_authorize,false);
     assert.equal(oldGrant.operation?.can_revoke,true,'revocation remains available when the source is stale');
     const revokeKey=randomUUID(),revoked=await editorial.revokeSignalWorkspaceIncrementalEditorialV1({...access,execution_id:acceptedGrant.execution_id,
      expected_admission_operation_id:acceptedGrant.receipt.operation_id,idempotency_key:revokeKey});
     const stop=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,numeric_execution_id:randomUUID(),idempotency_key:revokeKey});
     assert.deepEqual(stop.request?.receipt,revoked.receipt);assert.equal(stop.numeric_execution_id,numeric_execution_id);assert.equal(stop.is_current,false);
     assert.equal(stop.operation?.execution_id,acceptedGrant.execution_id);assert.equal(stop.operation?.can_revoke,false);
     const original=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,idempotency_key:key});
     assert.deepEqual(original?.request?.receipt,acceptedGrant.receipt);assert.deepEqual(original.operation?.receipt,revoked.receipt);
     const readBefore=await baseline();await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...access,idempotency_key:key});
     assert.deepEqual(await baseline(),readBefore,'GET does not change source, calls, grants or selection');
    }finally{await query('ROLLBACK');}
    assert.deepEqual(await baseline(),before);
   });
   completed=true;throw done;
  }}),error=>{if(error!==done)throw error;return true;});
 assert.equal(completed,true);
});
