import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import * as engine from '../signal-workspace-engine';
import * as numeric from '../signal-workspace-engine-incremental';
import { loadSignalWorkspaceAnalysisUpdateV1 } from '../signal-workspace-incremental-projection';
import { workspaceProjectionFixtureV1 } from './signal-workspace-topic-projection.fixture';
import { incrementalProjectionFixtureV1 } from './signal-workspace-incremental-projection.fixture';
import { runSignalWorkspaceIncrementalJobV1 } from '../../../services/workers/src/workers/signal-workspace-engine-incremental';

const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
test('numeric retry preserves exact checkpoints, scope, accepted receipts and zero-cost authority', {skip:!enabled,timeout:120_000},async()=>{
 const done=new Error('numeric recovery gate complete');let passed=false;
 const clusterIds=[randomUUID(),randomUUID()] as const;
 await assert.rejects(workspaceProjectionFixtureV1({cluster_ids:clusterIds,
  migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'],
  model_configuration:{fixture:true,versions:{python:'local-numeric-recovery'}},onCheckpoint:async f=>{
   const {database,query,access}=f;
   const rollback=async(work:()=>Promise<void>)=>{await query('BEGIN');try{await work();}finally{await query('ROLLBACK');}};
   const state=async(id:string)=>(await query('SELECT * FROM signal_topic_catalog_executions WHERE id=$1::uuid',[id])).rows[0]!;
   const claim=async(id:string)=>{
    const outbox=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[id])).rows[0]!;
    const lease=await engine.claimSignalWorkspaceEngineV1({database,execution_id:id,worker_job_id:outbox.worker_job_id});assert.ok(lease);return lease;
   };
   const recoverPartial=async(lease:engine.SignalWorkspaceEngineLeaseV1,artifact_id:string,kind:'input'|'index')=>{
    await engine.failSignalWorkspaceEngineV1({database,lease,error_code:'workspace_engine_incremental_transport_unavailable'});
    const current=await loadSignalWorkspaceAnalysisUpdateV1(access);assert.equal(current?.numeric.retry_available,true);
    await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:lease.execution_id,idempotency_key:randomUUID()});
    const resumed=await claim(lease.execution_id),saved=await numeric.readSignalWorkspaceIncrementalCheckpointV1({database,lease:resumed});
    assert.equal((kind==='input'?saved.input_artifact:saved.output_index_artifact)?.artifact_id,artifact_id);
    assert.equal(saved.numeric_checkpoint,null);assert.deepEqual(resumed.snapshot.numeric_descriptor,lease.snapshot.numeric_descriptor);
    return resumed;
   };
   await incrementalProjectionFixtureV1(f,clusterIds,{
    onInputCheckpoint:({lease,artifact_id})=>recoverPartial(lease,artifact_id,'input'),
    onOutputIndex:({lease,artifact_id})=>recoverPartial(lease,artifact_id,'index'),
    onNumericCheckpoint:async({lease,checkpoint})=>{
     const id=lease.execution_id;
     const parentBefore=(await query('SELECT to_jsonb(e) body FROM signal_topic_catalog_executions e WHERE id=$1::uuid',[f.lease.execution_id])).rows;
     const moneyBefore=(await query('SELECT to_jsonb(c) body FROM engine_cost_events c WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows;
     const artifactsBefore=(await query('SELECT to_jsonb(a) body FROM analysis_artifacts a WHERE engine_execution_id=ANY($1::uuid[]) ORDER BY id',[[id,f.lease.execution_id]])).rows;
     const selectionBefore=(await query('SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid',[access.workspace_id])).rows;
     await engine.failSignalWorkspaceEngineV1({database,lease,error_code:'workspace_engine_incremental_transport_unavailable'});
     const before=await state(id),key=randomUUID();let changed=false,lost=false;
     const wrapped=Object.assign(Object.create(database) as Pool,{connect:async()=>{
      const client=await database.connect(),scoped=Object.create(client) as PoolClient;
      scoped.query=(async(sql:string,params?:unknown[])=>{
       if(lost&&sql==='ROLLBACK')return{rows:[],rowCount:0};
       const result=await client.query(sql,params);
       if(sql.includes("SET status='queued'"))changed=true;
       if(sql==='COMMIT'&&changed&&!lost){lost=true;throw Object.assign(new Error('lost numeric retry ACK'),{code:'ECONNRESET'});}
       return result;
      }) as PoolClient['query'];scoped.release=()=>client.release();return scoped;
     }});
     await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,database:wrapped,execution_id:id.toUpperCase(),idempotency_key:key}),/lost numeric retry ACK/u);
     assert.equal(lost,true);
     assert.equal((await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id.toUpperCase(),idempotency_key:key})).replayed,true);
     const accepted=await loadSignalWorkspaceAnalysisUpdateV1({...access,idempotency_key:key});
     assert.deepEqual(accepted?.request_numeric,{action:'retry_numeric',execution_id:id,idempotency_key:key});
     assert.equal(accepted?.has_pending_work,true);assert.equal(accepted?.numeric.retry_available,false);
     assert.equal((await state(id)).dispatch_generation,before.dispatch_generation+1);
     let resumed=await claim(id);
     assert.deepEqual((await numeric.readSignalWorkspaceIncrementalCheckpointV1({database,lease:resumed})).numeric_checkpoint,checkpoint);
     await engine.failSignalWorkspaceEngineV1({database,lease:resumed,error_code:'workspace_engine_storage_unavailable'});
     const failed=await state(id);
     assert.equal((await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:key})).replayed,true);
     assert.equal((await state(id)).status,'failed');assert.equal((await state(id)).dispatch_generation,failed.dispatch_generation);
     for(const error of ['workspace_engine_worker_failed','workspace_engine_process_failed','workspace_engine_incremental_history_changed','workspace_engine_incremental_parent_runtime_missing','workspace_engine_storage_verification_failed'])await rollback(async()=>{
      await query('UPDATE signal_topic_catalog_executions SET error_code=$2 WHERE id=$1::uuid',[id,error]);
      assert.equal((await loadSignalWorkspaceAnalysisUpdateV1(access))?.numeric.retry_available,false);
      await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:randomUUID()}),/incremental_retry_unavailable/u);
     });
     await assert.rejects(engine.retrySignalWorkspaceEngineV1({...access,execution_id:id,idempotency_key:randomUUID()}),/incremental_retry_unavailable/u);
     await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:f.lease.execution_id,idempotency_key:randomUUID()}),/incremental_retry_unavailable/u);
     await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,actor_user_id:randomUUID(),execution_id:id,idempotency_key:randomUUID()}),/forbidden/u);
     await rollback(async()=>{
      await query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[access.actor_user_id]);
      await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:randomUUID()}),/forbidden/u);
     });
     await rollback(async()=>{
      await assert.rejects(query("UPDATE analysis_artifacts SET created_at=(SELECT created_at+interval '1 second' FROM signal_topic_catalog_executions WHERE id=$1::uuid) WHERE id=$2::uuid",[id,f.proposals[0]!.artifact_id]),/immutable/u);
     });
     await rollback(async()=>{
      await query("UPDATE data_sources SET status='inactive' WHERE workspace_id=$1::uuid",[access.workspace_id]);
      assert.equal((await query('SELECT signal_workspace_incremental_projection_history_current_v1($1::uuid) valid',[id])).rows[0]!.valid,false);
      assert.equal((await loadSignalWorkspaceAnalysisUpdateV1(access))?.numeric.retry_available,false);
      await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:randomUUID()}),/inputs_stale|incremental_retry_unavailable/u);
     });
     await rollback(async()=>{
      await query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[access.workspace_id]);
      const stale=await loadSignalWorkspaceAnalysisUpdateV1({...access,idempotency_key:key});
      assert.equal(stale?.numeric.is_current,false);assert.equal(stale?.numeric.retry_available,false);assert.equal(stale?.request_numeric?.execution_id,id);
      assert.equal((await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:key})).replayed,true);
      await assert.rejects(numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:randomUUID()}),/inputs_stale/u);
     });
     const finishKey=randomUUID();await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:finishKey});resumed=await claim(id);
     const noIO=async()=>{throw Error('checkpoint recovery attempted IO');};
     await runSignalWorkspaceIncrementalJobV1({database,lease:resumed,job:{id:'local-checkpoint-finish',data:{execution_id:id},updateProgress:async()=>{}}},
      {storage:{put:noIO,get:noIO},process:noIO});
     const ready=await state(id);assert.equal(ready.status,'ready');assert.deepEqual(ready.result_summary.numeric_checkpoint,checkpoint);
     assert.deepEqual(ready.input_snapshot,before.input_snapshot);
     assert.equal((await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:finishKey})).replayed,true);
     await numeric.retrySignalWorkspaceNumericUpdateV1({...access,execution_id:id,idempotency_key:randomUUID()});
     assert.equal((await state(id)).dispatch_generation,ready.dispatch_generation);assert.equal((await state(id)).status,'ready');
     assert.equal((await loadSignalWorkspaceAnalysisUpdateV1(access))?.numeric.retry_available,false);
     assert.deepEqual((await query('SELECT to_jsonb(e) body FROM signal_topic_catalog_executions e WHERE id=$1::uuid',[f.lease.execution_id])).rows,parentBefore);
     assert.deepEqual((await query('SELECT to_jsonb(c) body FROM engine_cost_events c WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows,moneyBefore);
     assert.deepEqual((await query('SELECT to_jsonb(a) body FROM analysis_artifacts a WHERE engine_execution_id=ANY($1::uuid[]) ORDER BY id',[[id,f.lease.execution_id]])).rows,artifactsBefore);
     assert.deepEqual((await query('SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid',[access.workspace_id])).rows,selectionBefore);
     passed=true;throw done;
    },
   });
  },
 }),error=>error===done);assert.equal(passed,true);
});
