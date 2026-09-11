import {currentTopicDefinitionCasV1} from './signal-topic-definition-cas.fixture';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {workspaceProjectionFixtureV1} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as store from '../signal-workspace-incremental-projection';
import * as selection from '../signal-workspace-topic-selection';
import * as classification from '../signal-workspace-classification';
import * as serving from '../signal-workspace-topics-serving';
import * as projection from '../signal-workspace-topic-projection';
import {updateSignalTopicStoreV1,setSignalTopicLifecycleStoreV1} from '../signal-topic-catalog';
import {resolveSignalWorkspaceIncrementalBindingsV1,signalWorkspaceIncrementalDigestV1 as digest} from '@noisia/query-engine';
import {signalWorkspaceIncrementalDerivationJobV1,workspaceIncrementalDerivationStoresV1} from '../../../services/workers/src/workers/signal-workspace-incremental-derivation';
import {signalWorkspaceIncrementalProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-incremental-projection';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('incremental binding and native projection preserve paid lineage, current evidence, selection and full denominator',{skip:!enabled,timeout:120_000},async()=>{
 const done=new Error('local incremental projection gate complete'),clusterIds=[randomUUID(),randomUUID()] as const;let passed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'],
  cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async checkpoint=>{
   const f=await incrementalProjectionFixtureV1(checkpoint,clusterIds),{database,query,access}=f;
   const rollback=async(work:()=>Promise<void>)=>{await query('BEGIN');try{await work();}finally{await query('ROLLBACK');}};
   const engineBefore=(await query('SELECT to_jsonb(engine) body FROM signal_topic_catalog_executions engine WHERE id=ANY($1::uuid[]) ORDER BY id',[[checkpoint.lease.execution_id,f.lease.execution_id]])).rows;
   const moneyBefore=(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows;
   const input=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...access}),topic=input.topics[0]!.definition;
   const selected=await selection.selectSignalWorkspaceTopicV1({...access,idempotency_key:randomUUID(),term_key:topic.term_key,selected:true,
    expected_selection_revision:0,expected_definition_revision:topic.definition_revision,expected_definition_digest:topic.definition_digest,generation_id:f.old.generation_id});
   const before=await store.loadSignalWorkspaceAnalysisUpdateV1(access);assert.equal(before?.has_pending_work,true);assert.equal(before?.serving?.generation_id,f.old.generation_id);
   assert.equal(await store.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);assert.equal(await store.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0);
   const dispatch=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection'",[f.lease.execution_id])).rows[0]!;
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection'",[f.lease.execution_id]);
   const scope={...access,execution_id:f.lease.execution_id,worker_job_id:dispatch.worker_job_id};
   const source=await store.readSignalWorkspaceIncrementalProjectionDerivationV1(scope);assert.equal(source.completed_projection,null);
   const history=await store.readSignalWorkspaceIncrementalProjectionProposalsV1({...scope,derivation_digest:source.derivation_digest});assert.equal(history.items.length,1);
   const read={...scope,derivation_digest:source.derivation_digest};
   await assert.rejects(store.readSignalWorkspaceIncrementalProjectionDerivationV1({...scope,actor_user_id:randomUUID()}),/forbidden/u);
   await assert.rejects(store.readSignalWorkspaceIncrementalProjectionDerivationV1({...scope,workspace_id:randomUUID()}),/forbidden/u);
   await assert.rejects(store.readSignalWorkspaceIncrementalProjectionDerivationV1({...scope,worker_job_id:'wrong-job'}),/source_unavailable/u);
   const resolved=resolveSignalWorkspaceIncrementalBindingsV1({workspace_id:access.workspace_id,components:f.components,topics:input.topics,
    proposals:history.items.map(ref=>({...ref,body:f.bodies.get(ref.storage_key)!}))});
   const summary={binding_digest:resolved.binding_digest,editorial_cut_digest:resolved.editorial_cut_digest,interpretation_coverage:resolved.interpretation_coverage,
    discovery_coverage:{state:'pending_cohort_close' as const,pending_roots:1}};
   const bindingArtifact=f.artifact(f.lease,`incremental-bindings-${source.derivation_digest.slice(7)}.jsonl`,'engine_output',resolved.bindings.map(row=>JSON.stringify(row)+'\n').join(''));
   const units=f.components.flatMap(component=>component.units.map(unit=>({component_key:component.component_key,...unit})));
   await rollback(async()=>{
    await store.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...read,units:units.slice(0,1)});
    await assert.rejects(store.completeSignalWorkspaceIncrementalProjectionBindingsV1({...read,artifact:bindingArtifact,summary}),/census_incomplete/u);
   });
   await rollback(async()=>{
    await assert.rejects(store.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...read,units:[{...units[0]!,component_key:digest('foreign-origin')}]}),/census_invalid/u);
    await store.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...read,units});
    await assert.rejects(store.persistSignalWorkspaceIncrementalProjectionBindingsPageV1({...read,artifact:bindingArtifact,summary,
     bindings:[{...resolved.bindings[0]!,proposal:{...resolved.bindings[0]!.proposal,call_id:randomUUID()}}]}),/binding_invalid/u);
   });
   await rollback(async()=>{
    await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[access.workspace_id]);
    await assert.rejects(store.readSignalWorkspaceIncrementalProjectionDerivationV1(scope),/source_unavailable/u);
    assert.equal((await store.loadSignalWorkspaceAnalysisUpdateV1(access))?.has_pending_work,false);
   });
   await rollback(async()=>{
    await assert.rejects(query(`SELECT * FROM transition_signal_tagging_model_v1($1::uuid,$2::uuid,'retired',NULL,clock_timestamp(),$3,$4::uuid,$5,$5)`,
     [access.workspace_id,f.lease.snapshot.numeric_descriptor!.parent.model_version_id,digest('retired locally'),access.actor_user_id,digest(randomUUID())]),/lifecycle transition is invalid/u);
   });
   await rollback(async()=>{
    await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);
    await assert.rejects(store.readSignalWorkspaceIncrementalProjectionDerivationV1(scope),/source_unavailable/u);
   });
   const logged=<T,U>(fn:(arg:T)=>Promise<U>)=>async(arg:T):Promise<U>=>{try{return await fn(arg);}catch(error){console.error(error);throw error;}};
   const stores={...workspaceIncrementalDerivationStoresV1,units:logged(store.persistSignalWorkspaceIncrementalProjectionUnitsPageV1),bindings:logged(store.persistSignalWorkspaceIncrementalProjectionBindingsPageV1),finish:logged(store.completeSignalWorkspaceIncrementalProjectionBindingsV1)};
   const result=await signalWorkspaceIncrementalDerivationJobV1({id:dispatch.worker_job_id,data:scope,updateProgress:async()=>{}},{database,storage:f.storage,stores});
   assert.ok(result.generation_id);assert.equal((await signalWorkspaceIncrementalDerivationJobV1({id:dispatch.worker_job_id,data:scope,updateProgress:async()=>{}},{database,storage:f.storage})).generation_id,result.generation_id);
   const classJob=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[result.projection_execution_id])).rows[0]!;
   // A lost root-page ACK commits once. Only a confirmed transport code is
   // automatically retried; permanent errors and the eighth delivery stop.
   const pageStores={claim:store.claimSignalWorkspaceIncrementalProjectionV1,heartbeat:classification.heartbeatSignalWorkspaceClassificationV1,
    readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,
    commitPage:async(args:Parameters<typeof classification.commitSignalWorkspaceClassificationPageV1>[0])=>{
     const result=await classification.commitSignalWorkspaceClassificationPageV1(args);
     if(args.outcomes.length)throw Object.assign(new Error('Explicit local lost ACK'),{code:'ECONNRESET'});return result;},
    finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
   await assert.rejects(signalWorkspaceIncrementalProjectionJobV1({id:classJob.worker_job_id,data:{execution_id:result.projection_execution_id},updateProgress:async()=>{}},
    {database,storage:f.storage,stores:pageStores}),/transport_unavailable/u);
   assert.equal((await store.loadSignalWorkspaceAnalysisUpdateV1(access))?.has_pending_work,true);
   const committed=(await query('SELECT to_jsonb(item) body FROM signal_classification_generation_items item WHERE generation_id=$1::uuid ORDER BY id',[result.generation_id])).rows;
   await query("UPDATE signal_topic_catalog_executions SET updated_at=clock_timestamp()-interval '16 seconds' WHERE id=$1::uuid",[result.projection_execution_id]);
   await rollback(async()=>{
    await query("UPDATE signal_topic_catalog_executions SET error_code='workspace_incremental_projection_binding_invalid' WHERE id=$1::uuid",[result.projection_execution_id]);
    assert.equal((await projection.scheduleSignalWorkspaceTopicProjectionsV1({database})).requeued,0);
    assert.equal((await store.loadSignalWorkspaceAnalysisUpdateV1(access))?.has_pending_work,false);
   });
   await rollback(async()=>{
    await query('UPDATE signal_topic_catalog_executions SET dispatch_generation=8 WHERE id=$1::uuid',[result.projection_execution_id]);
    assert.equal((await projection.scheduleSignalWorkspaceTopicProjectionsV1({database})).requeued,0);
    assert.equal((await store.loadSignalWorkspaceAnalysisUpdateV1(access))?.has_pending_work,false);
   });
   assert.equal((await projection.scheduleSignalWorkspaceTopicProjectionsV1({database})).requeued,1);
   const retryJob=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[result.projection_execution_id])).rows[0]!.worker_job_id;
   await signalWorkspaceIncrementalProjectionJobV1({id:retryJob,data:{execution_id:result.projection_execution_id},updateProgress:async()=>{}},{database,storage:f.storage});
   assert.deepEqual((await query('SELECT to_jsonb(item) body FROM signal_classification_generation_items item WHERE generation_id=$1::uuid ORDER BY id',[result.generation_id])).rows,committed);

   const after=await store.loadSignalWorkspaceAnalysisUpdateV1(access);assert.equal(after?.has_pending_work,false);assert.equal(after?.projection?.is_current,true);
   assert.equal(after?.serving?.generation_id,result.generation_id);assert.equal(after?.serving?.interpretation_coverage?.interpreted_unit_count,1);assert.equal(after?.serving?.interpretation_coverage?.expected_unit_count,2);
   assert.equal(after?.serving?.discovery_coverage?.pending_roots,1);
   const assignments=(await query('SELECT membership_basis,disposition,membership_metadata FROM signal_classification_assignments WHERE generation_id=$1::uuid',[result.generation_id])).rows;
   assert.equal(assignments.length,3);assert.ok(assignments.every(row=>row.disposition==='pending'&&row.membership_metadata.contract_version==='workspace-computed-incremental-membership-v1'));
   const items=(await query('SELECT outcome_metadata FROM signal_classification_generation_items WHERE generation_id=$1::uuid',[result.generation_id])).rows;
   assert.equal(items.length,3);assert.ok(items.every(row=>row.outcome_metadata.has_unresolved_topics));
   const selectionAfter=await selection.loadSignalWorkspaceTopicSelectionV1(access);assert.equal(selectionAfter.revision,selected.revision);
   const overview=await serving.loadSignalWorkspaceTopicsOverviewV1(access);assert.equal(overview?.generation_id,result.generation_id);
   assert.equal(await store.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0);
   assert.deepEqual((await query('SELECT to_jsonb(engine) body FROM signal_topic_catalog_executions engine WHERE id=ANY($1::uuid[]) ORDER BY id',[[checkpoint.lease.execution_id,f.lease.execution_id]])).rows,engineBefore);
   assert.deepEqual((await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,moneyBefore);
   await rollback(async()=>{
    await assert.rejects(query("UPDATE analysis_artifacts SET metadata='{}'::jsonb WHERE id=$1::uuid",[result.binding_artifact_id]),/immutable/u);
   });
   await rollback(async()=>{
    await assert.rejects(query('DELETE FROM analysis_artifacts WHERE id=$1::uuid',[result.binding_artifact_id]),/immutable/u);
   });
   // Isolate this trigger's OLD/NEW routing without disabling any real guard.
   await query('CREATE TEMP TABLE incremental_trigger_probe (LIKE analysis_artifacts INCLUDING DEFAULTS) ON COMMIT DROP');
   await query('INSERT INTO incremental_trigger_probe SELECT * FROM analysis_artifacts WHERE id=$1::uuid',[result.binding_artifact_id]);
   const unrelated=randomUUID();await query("INSERT INTO incremental_trigger_probe(id,artifact_key,artifact_type,content) VALUES($1::uuid,'unrelated','fixture','{}'::jsonb)",[unrelated]);
   await query('CREATE TRIGGER incremental_probe BEFORE UPDATE OR DELETE ON incremental_trigger_probe FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_binding_v1()');
   await rollback(async()=>{await assert.rejects(query("UPDATE incremental_trigger_probe SET metadata='{}'::jsonb WHERE id=$1::uuid",[result.binding_artifact_id]),/history_immutable/u);});
   await rollback(async()=>{await assert.rejects(query('DELETE FROM incremental_trigger_probe WHERE id=$1::uuid',[result.binding_artifact_id]),/history_immutable/u);});
   assert.equal((await query('DELETE FROM incremental_trigger_probe WHERE id=$1::uuid RETURNING id',[unrelated])).rowCount,1);
   await rollback(async()=>{
    const before=(await query('SELECT to_jsonb(e) body FROM signal_topic_catalog_executions e WHERE workspace_id=$1 ORDER BY id',[access.workspace_id])).rows;
    await updateSignalTopicStoreV1({pool:database,...access,term_key:topic.term_key,idempotency_key:randomUUID(),input:{...(await currentTopicDefinitionCasV1({pool:database,...access,term_key:topic.term_key})),label:'Renamed incremental Topic'}});
    const renamed=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...access});
    const renamedTopic=renamed.topics.find(row=>row.definition.term_key===topic.term_key)!.definition;
    assert.equal(renamedTopic.definition_digest,topic.definition_digest);assert.equal(renamedTopic.definition_revision,topic.definition_revision+1);
    const served=await serving.loadSignalWorkspaceTopicsOverviewV1(access);assert.equal(served?.is_current,true);
    assert.equal(served?.terms.find(row=>row.term_key===topic.term_key)?.mention_count,3);
    assert.equal(served?.terms.find(row=>row.term_key===topic.term_key)?.label,topic.label);
    assert.equal(await store.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0,'working rename does not create a derived generation');
    await setSignalTopicLifecycleStoreV1({pool:database,...access,term_key:topic.term_key,lifecycle:'archived',idempotency_key:randomUUID(),...(await currentTopicDefinitionCasV1({pool:database,...access,term_key:topic.term_key}))});
    assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(access)).items[topic.term_key]?.selected,true,'working archive does not deselect served A');
    assert.equal((await serving.loadSignalWorkspaceTopicsOverviewV1(access))?.is_current,true);
    assert.equal(await store.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0);
    assert.deepEqual((await query('SELECT to_jsonb(e) body FROM signal_topic_catalog_executions e WHERE workspace_id=$1 ORDER BY id',[access.workspace_id])).rows,before);
   });
   passed=true;throw done;
  }}),error=>{if(error!==done)console.error(error);return error===done;});assert.equal(passed,true);
});
