import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {workspaceProjectionFixtureV1,fixtureSha as sha} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as projection from '../signal-workspace-incremental-projection';import * as editorial from '../signal-workspace-incremental-editorial';
import * as engine from '../signal-workspace-engine';import * as money from '../signal-workspace-engine-interpretation';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet} from '@noisia/query-engine';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('incremental editorial admission seals evidence, exclusive emerging ownership and independent Sonnet permission without dispatch or calls',{skip:!enabled,timeout:120000},async()=>{
 const done=new Error('incremental editorial local gate complete'),clusterIds=[randomUUID(),randomUUID()] as const;let completed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
  cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
   const f=await incrementalProjectionFixtureV1(base,clusterIds,{emerging_component:true,migrations_applied:true}),{query,database,access}=f;
   await query(await readFile(new URL('./0148_signal_workspace_incremental_editorial.sql',import.meta.url),'utf8'));
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
   const rejectedPlan=async(mutate:(copy:editorial.SignalWorkspaceIncrementalEditorialEvidenceV1)=>void)=>{
    const copy=structuredClone(evidence);mutate(copy);const {evidence_digest:_seal,...body}=copy;copy.evidence_digest=digest(body);
    await assert.rejects(editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence:copy,stored}),/invalid|incomplete/u);
   };
   await rejectedPlan(copy=>{copy.units.pop();});
   await rejectedPlan(copy=>{copy.numeric_component_order.reverse();});
   await rejectedPlan(copy=>{copy.census.expected_unit_digest=sha('wrong universe');});
   await rejectedPlan(copy=>{copy.census.memberships++;});
   await rejectedPlan(copy=>{copy.census.pending_occurrences++;});
   await rejectedPlan(copy=>{copy.census.pending_roots=copy.census.roots+1;});
   await rejectedPlan(copy=>{copy.units[0]!.root_count=0.5;});
   await rejectedPlan(copy=>{copy.units[0]!.local_label='0' as unknown as number;});
   await rejectedPlan(copy=>{copy.origins[0]!.execution_id=randomUUID();});
   await rejectedPlan(copy=>{copy.units.find(unit=>unit.status==='no_current_members')!.status='evidence_ready';});
   await rejectedPlan(copy=>{copy.units.find(unit=>unit.status==='evidence_ready')!.status='editorial_claimed';});
   await rejectedPlan(copy=>{copy.units.find(unit=>unit.status==='evidence_ready')!.status='already_interpreted';});
   await rejectedPlan(copy=>{copy.units[0]!.model_origin={...copy.units[0]!.model_origin,execution_id:randomUUID()};});
   await assert.rejects(editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored:{...stored,sha256:sha('wrong bytes')}}),/invalid/u);
   await assert.rejects(editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,actor_user_id:randomUUID(),evidence,stored}),/forbidden/u);
   await rollback(async()=>{await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[access.workspace_id]);
    await assert.rejects(editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored}),/source_stale/u);});
   const plan=await editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored});
   assert.equal((await editorial.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored})).artifact_id,plan.artifact_id);
   const preview=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope);assert.equal(preview.expected_units,3);assert.equal(preview.target_units,1);assert.equal(preview.legacy_units,1);assert.equal(preview.can_authorize,true);assert.equal(preview.adapter_available,false);
   assert.ok(preview.target_unit_digest);assert.ok(preview.target_binding_digest);
   const begin={...scope,expected_evidence_plan_artifact_id:plan.artifact_id,expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,expected_target_unit_digest:preview.target_unit_digest,
    expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),cap_micro_usd:1000,admission_not_after:preview.maximum_admission_not_after};
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,actor_user_id:randomUUID()}),/forbidden/u);
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,expected_numeric_checkpoint_digest:sha('changed')}),/source_changed/u);
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,cap_micro_usd:preview.maximum_grant_micro_usd+1}),/cap_or_deadline/u);
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,admission_not_after:'2000-01-01T00:00:00.000Z'}),/cap_or_deadline/u);
   const rejectedReceipt=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();const wrapped=Object.create(client);
    wrapped.query=async(sql:string,parameters?:unknown[])=>{if(sql.includes('INSERT INTO signal_classification_operations'))throw Error('local forced receipt rejection');return client.query(sql,parameters);};wrapped.release=()=>{};return wrapped;}});
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,database:rejectedReceipt}),/local forced receipt rejection/u);
   assert.equal((await query("SELECT count(*)::int n FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-incremental-editorial-v1'",[access.workspace_id])).rows[0]!.n,0);
   assert.equal((await query("SELECT count(*)::int n FROM analysis_artifacts WHERE workspace_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'",[access.workspace_id])).rows[0]!.n,0);
   let ackLost=false;
   const lostAck=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();const wrapped=Object.create(client);let committed=false;
    wrapped.query=async(sql:string,parameters?:unknown[])=>{if(sql==='ROLLBACK'&&committed)return{rows:[],rowCount:0};const result=await client.query(sql,parameters);
     if(sql==='COMMIT'){committed=true;ackLost=true;throw Object.assign(Error('local ACK lost after receipt commit'),{code:'ECONNRESET'});}return result;};wrapped.release=()=>{};return wrapped;}});
   // Controlled interleaving at the budget lock: another request accepts
   // the identical key after the first lookup. This models the ordering without
   // claiming independent connections inside the rollback fixture.
   let intercepted=false;
   const interleaved=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();const wrapped=Object.create(client);
    wrapped.query=async(sql:string,parameters?:unknown[])=>{if(!intercepted&&sql.includes('pg_advisory_xact_lock')&&String(parameters?.[0]).startsWith('workspace-interpretation-budget:')){
      intercepted=true;await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,database:lostAck}),/local ACK lost after receipt commit/u);
     }return client.query(sql,parameters);};wrapped.release=()=>{};return wrapped;}});
   const admitted=await editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,database:interleaved,numeric_execution_id:begin.numeric_execution_id.toUpperCase()});
   assert.equal(intercepted,true);assert.equal(ackLost,true);assert.equal(admitted.replayed,true);

   assert.notEqual(admitted.execution_id,f.lease.execution_id);assert.equal(admitted.receipt.grant_cap_micro_usd,1000);assert.equal(admitted.receipt.target_binding_digest,descriptor.target_binding_digest);
   assert.equal((await editorial.beginSignalWorkspaceIncrementalEditorialV1(begin)).execution_id,admitted.execution_id);
   const accepted=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...scope,idempotency_key:begin.idempotency_key});assert.equal(accepted.request?.receipt.operation_id,admitted.receipt.operation_id);assert.equal(accepted.operation?.can_revoke,true);
   assert.equal(accepted.can_authorize,false);assert.equal(accepted.claimed_units,1);
   const claims=(await query("SELECT metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'",[admitted.execution_id])).rows;
   assert.equal(claims.length,1);assert.equal(claims[0]!.metadata.unit.unit_key,targets[0]!.unit_key);assert.equal(claims[0]!.metadata.model_origin.execution_id,f.lease.execution_id);
   assert.equal(claims[0]!.metadata.owner_execution_id,admitted.execution_id);assert.equal((await query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid',[admitted.execution_id])).rows[0]!.n,0);
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,idempotency_key:randomUUID()}),/already_owned/u);
   await assert.rejects(editorial.beginSignalWorkspaceIncrementalEditorialV1({...begin,cap_micro_usd:1001}),/idempotency_conflict/u);
   await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({database,workspace_id:access.workspace_id,actor_user_id:access.actor_user_id,
    execution_id:admitted.execution_id,idempotency_key:randomUUID(),request_digest:sha('forbidden fullfit path'),configuration:sonnet,reserved_micro_usd:100,
    budget_timezone:admitted.receipt.budget_timezone,daily_cap_micro_usd:admitted.receipt.daily_cap_micro_usd,execution_token:randomUUID(),admission_operation_id:admitted.receipt.operation_id}),/workspace_engine_interpretation_forbidden$/u);
   await rollback(async()=>{await assert.rejects(query("UPDATE analysis_artifacts SET metadata=metadata||'{\"contract_version\":\"escape\"}'::jsonb WHERE id=$1::uuid",[plan.artifact_id]),/immutable/u);});
   await assert.rejects(engine.claimSignalWorkspaceEngineV1({database,execution_id:admitted.execution_id,worker_job_id:'no-full-fit-route'}),/not_found/u);
   await rollback(async()=>{await assert.rejects(query("UPDATE signal_topic_catalog_executions SET status='running',execution_token=$2::uuid WHERE id=$1::uuid",[admitted.execution_id,randomUUID()]),/history_immutable/u);});
   await rollback(async()=>{await assert.rejects(query("INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,'must-not-dispatch')",[admitted.execution_id,access.workspace_id]),/adapter_required/u);});
   await rollback(async()=>{await assert.rejects(query("UPDATE analysis_artifacts SET metadata=metadata||'{\"contract_version\":\"escape\"}'::jsonb WHERE engine_execution_id=$1::uuid",[admitted.execution_id]),/immutable/u);});
   await rollback(async()=>{await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);
    const stale=await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1({...scope,idempotency_key:begin.idempotency_key});assert.equal(stale.is_current,false);assert.equal(stale.request?.receipt.execution_id,admitted.execution_id);assert.equal(stale.operation?.can_revoke,true);
    assert.equal((await editorial.beginSignalWorkspaceIncrementalEditorialV1(begin)).replayed,true);
    const revoked=await editorial.revokeSignalWorkspaceIncrementalEditorialV1({...access,execution_id:admitted.execution_id,expected_admission_operation_id:admitted.receipt.operation_id,idempotency_key:randomUUID()});assert.equal(revoked.receipt.action,'revoke_interpretation');
   });
   const revoke={...access,execution_id:admitted.execution_id,expected_admission_operation_id:admitted.receipt.operation_id,idempotency_key:randomUUID()};
   const revoked=await editorial.revokeSignalWorkspaceIncrementalEditorialV1(revoke);assert.equal(revoked.receipt.grant_cap_micro_usd,0);assert.equal((await editorial.revokeSignalWorkspaceIncrementalEditorialV1(revoke)).replayed,true);
   assert.equal((await editorial.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope)).operation?.requires_authorization,true);
   assert.deepEqual(await baseline(),original);assert.equal((await query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[admitted.execution_id])).rows[0]!.n,0);
   console.log(JSON.stringify({result:'PASS',roots:f.roots.length,chunks:f.chunks.length,bank_units:units.length,ready_targets:1,legacy_without_claim:1,no_current_members_without_claim:1,provider_calls:0,numeric_parent_money_models_selection:'unchanged'}));
   completed=true;throw done;
  }}),error=>{if(error!==done)console.error(error);return error===done;});assert.equal(completed,true);
});
