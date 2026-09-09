import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workspaceProjectionFixtureV1} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as delivery from '../signal-workspace-incremental-projection';
import * as classification from '../signal-workspace-classification';
import {updateSignalTopicStoreV1} from '../signal-topic-catalog';
import {signalWorkspaceIncrementalDerivationJobV1,workspaceIncrementalDerivationStoresV1} from '../../../services/workers/src/workers/signal-workspace-incremental-derivation';
import {signalWorkspaceIncrementalProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-incremental-projection';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('explicit incremental delivery recovery preserves ready numeric evidence, exact binding and committed projection prefix',{skip:!enabled,timeout:120_000},async()=>{
 const done=new Error('local delivery recovery complete'),clusters=[randomUUID(),randomUUID()] as const;let passed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'],
  cluster_ids:clusters,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async checkpoint=>{
   const f=await incrementalProjectionFixtureV1(checkpoint,clusters),{access,database,query}=f,execution_id=f.lease.execution_id;
   const args={...access,execution_id},retry=()=>delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,idempotency_key:randomUUID()});
   const rollback=async(work:()=>Promise<void>)=>{await query('BEGIN');try{await work();}finally{await query('ROLLBACK');}};
   const engines=()=>query("SELECT to_jsonb(e)-'engine_request_keys' body FROM signal_topic_catalog_executions e WHERE id=ANY($1::uuid[]) ORDER BY id",[[checkpoint.lease.execution_id,execution_id]]);
   const money=()=>query('SELECT to_jsonb(c) body FROM engine_cost_events c WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id]);
   const selections=()=>query('SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid',[access.workspace_id]);
   const beforeEngine=(await engines()).rows,beforeMoney=(await money()).rows,beforeSelection=(await selections()).rows;
   await assert.rejects(retry(),/delivery_unavailable/u,'no first dispatch when rollout producer has not run');
   assert.equal(await delivery.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);
   const dispatchRow=async()=>(await query("SELECT * FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection'",[execution_id])).rows[0]!;
   const dispatch=await dispatchRow(),scope={...args,worker_job_id:dispatch.worker_job_id};
   const derive=async(stores=workspaceIncrementalDerivationStoresV1)=>signalWorkspaceIncrementalDerivationJobV1({id:dispatch.worker_job_id,data:scope,updateProgress:async()=>{}},{database,storage:f.storage,stores});
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched' WHERE id=$1::uuid",[dispatch.id]);
   await assert.rejects(derive({...workspaceIncrementalDerivationStoresV1,units:async input=>{
    await delivery.persistSignalWorkspaceIncrementalProjectionUnitsPageV1(input);throw Object.assign(new Error('lost units ACK'),{code:'ECONNRESET'});
   }}),/transport_unavailable/u);
   const censusBefore=(await query("SELECT to_jsonb(a) body FROM analysis_artifacts a WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-unit-census-v1' ORDER BY id",[execution_id])).rows;
   assert.equal(censusBefore.length,2);
   await query("UPDATE signal_topic_classification_outbox SET status='dead_letter',attempt_count=8 WHERE id=$1::uuid",[dispatch.id]);
   const available=await delivery.loadSignalWorkspaceAnalysisUpdateV1(access);
   assert.equal(available?.delivery.retry_available,true);assert.equal(available?.delivery.phase,'derivation');assert.equal(available?.has_pending_work,false);
   await rollback(async()=>{await query("UPDATE signal_topic_classification_outbox SET error_code='workspace_incremental_projection_binding_invalid' WHERE id=$1::uuid",[dispatch.id]);
    assert.equal((await delivery.loadSignalWorkspaceAnalysisUpdateV1(access))?.delivery.retry_available,false);await assert.rejects(retry(),/delivery_unavailable/u);
    assert.equal(await delivery.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0);});
   await assert.rejects(delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,actor_user_id:randomUUID(),idempotency_key:randomUUID()}),/forbidden/u);
   await rollback(async()=>{await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);await assert.rejects(retry(),/source_unavailable/u);});
   await rollback(async()=>{await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[access.workspace_id]);await assert.rejects(retry(),/source_unavailable/u);});
   await rollback(async()=>{const topic=(await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...access})).topics[0]!.definition;
    await updateSignalTopicStoreV1({pool:database,...access,term_key:topic.term_key,idempotency_key:randomUUID(),input:{expected_definition_revision:topic.definition_revision,label:'Changed after exhausted dispatch'}});
    await assert.rejects(retry(),/inputs_changed/u);});
   const key=randomUUID();let lost=false,committed=false;
   const ackDatabase=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();return Object.assign(Object.create(client),{
    query:async(sql:string,params?:unknown[])=>{if(sql==='ROLLBACK'&&committed){committed=false;return{rows:[],rowCount:0};}const result=await query(sql,params);if(sql==='COMMIT'&&!lost){lost=true;committed=true;throw Object.assign(new Error('accepted retry ACK lost'),{code:'ECONNRESET'});}return result;}
   });}});
   await assert.rejects(delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,database:ackDatabase,execution_id:execution_id.toUpperCase(),idempotency_key:key}),/ACK lost/u);
   assert.equal((await delivery.loadSignalWorkspaceAnalysisUpdateV1({...access,idempotency_key:key}))?.request_delivery?.execution_id,execution_id);
   const first=await delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,execution_id:execution_id.toUpperCase(),idempotency_key:key});
   assert.equal(first.replayed,true);assert.equal(first.worker_job_id,dispatch.worker_job_id);
   const acceptedDispatch=await dispatchRow();assert.equal(acceptedDispatch.attempt_count,0);assert.equal(acceptedDispatch.status,'pending');
   await assert.rejects(delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,execution_id:checkpoint.lease.execution_id,idempotency_key:key}),/idempotency_conflict/u);
   await rollback(async()=>{await query("UPDATE signal_topic_classification_outbox SET status='failed',error_code='workspace_incremental_projection_transport_unavailable' WHERE id=$1::uuid",[dispatch.id]);
    const failed=await dispatchRow();assert.equal((await delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,idempotency_key:key})).replayed,true);assert.deepEqual(await dispatchRow(),failed);});
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched' WHERE id=$1::uuid",[dispatch.id]);
   // Finished binding ACK loss leaves a valid queued projection; recovery must
   // choose it, never create another binding or rerun numeric computation.
   await assert.rejects(derive({...workspaceIncrementalDerivationStoresV1,finish:async input=>{
    await delivery.completeSignalWorkspaceIncrementalProjectionBindingsV1(input);throw Object.assign(new Error('lost binding finish ACK'),{code:'ECONNRESET'});
   }}),/transport_unavailable/u);
   assert.deepEqual((await query("SELECT to_jsonb(a) body FROM analysis_artifacts a WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-unit-census-v1' ORDER BY id",[execution_id])).rows,censusBefore);
   const queued=await retry();assert.equal(queued.phase,'projection');assert.equal(queued.replayed,true);
   const projectionId=queued.projection_execution_id!,generation=queued.generation_id!;
   const classState=async()=>(await query('SELECT * FROM signal_topic_catalog_executions WHERE id=$1::uuid',[projectionId])).rows[0]!;
   await rollback(async()=>{const failDb=Object.assign(Object.create(database),{connect:async()=>{const c=await database.connect();return Object.assign(Object.create(c),{query:async(sql:string,params?:unknown[])=>{
    if(sql.includes("SELECT input_snapshot->'source_projection' source"))throw Object.assign(new Error('claim read disconnect'),{code:'ECONNRESET'});return query(sql,params);
   }});}});
    await assert.rejects(delivery.claimSignalWorkspaceIncrementalProjectionV1({database:failDb,execution_id:projectionId,worker_job_id:queued.worker_job_id}),/disconnect/u);
    assert.equal((await classState()).error_code,'workspace_classification_transport_unavailable');});
   const stores={claim:delivery.claimSignalWorkspaceIncrementalProjectionV1,heartbeat:classification.heartbeatSignalWorkspaceClassificationV1,
    readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,
    commitPage:async(input:Parameters<typeof classification.commitSignalWorkspaceClassificationPageV1>[0])=>{
     await classification.commitSignalWorkspaceClassificationPageV1(input);throw Object.assign(new Error('lost root ACK'),{code:'ECONNRESET'});
    },finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
   await assert.rejects(signalWorkspaceIncrementalProjectionJobV1({id:queued.worker_job_id,data:{execution_id:projectionId},updateProgress:async()=>{}},{database,storage:f.storage,stores}),/transport_unavailable/u);
   await query('UPDATE signal_topic_catalog_executions SET dispatch_generation=8 WHERE id=$1::uuid',[projectionId]);
   const failed=await classState(),itemsBefore=(await query('SELECT to_jsonb(i) body FROM signal_classification_generation_items i WHERE generation_id=$1::uuid ORDER BY id',[generation])).rows;
   assert.equal(failed.processed_roots,3);assert.equal(itemsBefore.length,3);
   assert.equal((await delivery.loadSignalWorkspaceAnalysisUpdateV1(access))?.delivery.retry_available,true);
   await rollback(async()=>{await query("UPDATE signal_topic_catalog_executions SET error_code='workspace_classification_worker_failed' WHERE id=$1::uuid",[projectionId]);await assert.rejects(retry(),/delivery_unavailable/u);});
   const resumed=await retry();assert.equal(resumed.phase,'projection');assert.equal(resumed.projection_execution_id,projectionId);assert.equal(resumed.generation_id,generation);assert.equal(resumed.replayed,false);
   assert.equal((await classState()).cursor_root_id,failed.cursor_root_id);assert.equal((await classState()).dispatch_generation,9);
   await signalWorkspaceIncrementalProjectionJobV1({id:resumed.worker_job_id,data:{execution_id:projectionId},updateProgress:async()=>{}},{database,storage:f.storage});
   assert.equal((await classState()).status,'ready');assert.deepEqual((await query('SELECT to_jsonb(i) body FROM signal_classification_generation_items i WHERE generation_id=$1::uuid ORDER BY id',[generation])).rows,itemsBefore);
   const readyBefore=await classState();assert.equal((await retry()).replayed,true);assert.deepEqual(await classState(),readyBefore);
   await rollback(async()=>{await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);
    assert.equal((await delivery.loadSignalWorkspaceAnalysisUpdateV1({...access,idempotency_key:key}))?.request_delivery?.execution_id,execution_id);
    assert.equal((await delivery.retrySignalWorkspaceIncrementalDeliveryV1({...args,idempotency_key:key})).replayed,true);await assert.rejects(retry(),/source_unavailable/u);});
   assert.deepEqual((await engines()).rows,beforeEngine);assert.deepEqual((await money()).rows,beforeMoney);assert.deepEqual((await selections()).rows,beforeSelection);
   passed=true;throw done;
  }}),error=>{if(error!==done)console.error(error);return error===done;});assert.equal(passed,true);
});
