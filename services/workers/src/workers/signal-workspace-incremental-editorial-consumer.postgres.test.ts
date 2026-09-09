import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {workspaceProjectionFixtureV1} from '../../../../infrastructure/db/migrations/signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from '../../../../infrastructure/db/migrations/signal-workspace-incremental-projection.fixture';
import * as projection from '@noisia/db';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest,
  signalWorkspaceInterpretationReferenceIdV1 as refId} from '@noisia/query-engine';
import {runWorkspaceIncrementalEditorialConsumerV1 as consume,type WorkspaceIncrementalEditorialConsumerOptionsV1 as Options} from './signal-workspace-incremental-editorial-consumer';
import {sendWorkspaceInterpretationV1} from '../providers/workspace-interpretation';

const enabled=process.env.NOISIA_INCREMENTAL_EDITORIAL_CONSUMER_PG_APPROVED==='true';
const sha=(body:string|Uint8Array)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
test('real PG admission and ledger compose with the file consumer, exact plan and lost commit acknowledgements',{
  skip:!enabled,timeout:120_000,
},async()=>{
  const done=new Error('consumer local composition complete'),clusterIds=[randomUUID(),randomUUID()] as const;
  const scratch=await mkdtemp(join(tmpdir(),'noisia-editorial-consumer-pg-'));let completed=false;
  try{await assert.rejects(workspaceProjectionFixtureV1({
    migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql',
      '0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
    cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
      const f=await incrementalProjectionFixtureV1(base,clusterIds,{emerging_component:true,migrations_applied:true}),{query,database,access}=f;
      for(const file of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql'])
        await query(await readFile(new URL('../../../../infrastructure/db/migrations/'+file,import.meta.url),'utf8'));
      const baseline=async()=>({
        parents:(await query('SELECT to_jsonb(run) body FROM signal_topic_catalog_executions run WHERE id=ANY($1::uuid[]) ORDER BY id',[[base.lease.execution_id,f.lease.execution_id]])).rows,
        models:(await query('SELECT to_jsonb(model) body FROM tagging_model_versions model WHERE id=ANY($1::uuid[]) ORDER BY id',[[f.checkpoint.model_version_id,f.lease.snapshot.numeric_descriptor!.parent.model_version_id].filter(Boolean)])).rows,
        workspace:(await query('SELECT to_jsonb(workspace) body FROM signal_workspaces workspace WHERE id=$1::uuid',[access.workspace_id])).rows,
      });
      const before=await baseline();
      await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database});
      const outbox=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[f.lease.execution_id])).rows[0]!;
      const derivationScope={...access,execution_id:f.lease.execution_id,worker_job_id:outbox.worker_job_id};
      const derivation=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1(derivationScope);
      await projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...derivationScope,derivation_digest:derivation.derivation_digest,
        units:f.components.flatMap(component=>component.units.map(unit=>({...unit,component_key:component.component_key})))});
      const units:projection.SignalWorkspaceIncrementalEditorialEvidenceUnitV1[]=f.components.flatMap(component=>component.units.map(unit=>({...unit,
        component_key:component.component_key,model_origin:component.model_origin,lane:component.lane,
        status:component.model_origin.execution_id!==f.lease.execution_id?'legacy_full_fit' as const:unit.local_label===1?'no_current_members' as const:'evidence_ready' as const,
        root_count:unit.local_label===1?0:f.roots.length,chunk_count:unit.local_label===1?0:f.chunks.length,cluster_digest:sha(`local current census ${unit.unit_key}`)}))).sort((a,b)=>a.unit_key<b.unit_key?-1:1);
      const targets=units.filter(unit=>unit.status==='evidence_ready');assert.equal(targets.length,1);
      const chunk=f.chunks[0]!,reference={root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};
      const groups=targets.map(unit=>({cluster_id:unit.unit_key,lane:unit.lane,cluster_digest:unit.cluster_digest,root_count:unit.root_count,chunk_count:unit.chunk_count,
        terms:['local evidence'],representatives:[{...reference,text:chunk.text,strength:0.9,selection_reason:'high_affiliation' as const,ref_id:refId(reference)}]}));
      const stream=groups.map((cluster,index)=>JSON.stringify({contract_version:'workspace-incremental-editorial-evidence-unit-v1',unit:targets[index],cluster})+'\n').join('');
      const body={contract_version:'workspace-incremental-editorial-evidence-stream-v1' as const,numeric_execution_id:f.lease.execution_id,numeric_checkpoint_digest:f.checkpoint.checkpoint_digest,
        numeric_manifest_sha256:sha(JSON.stringify(f.output)),population_digest:f.output.population_digest,representative_selection_policy:'distinct-roots-affiliation-boundary-v1' as const,
        census:{roots:f.roots.length,chunks:f.chunks.length,memberships:f.output.counts.memberships,pending_roots:1,pending_occurrences:f.output.counts.pending_occurrences,
          expected_unit_count:units.length,expected_unit_digest:unitDigest(units.map(unit=>unit.unit_key)),population_digest:f.output.population_digest},
        numeric_component_order:f.components.map(component=>component.component_key),origins:[{execution_id:f.lease.execution_id,manifest_sha256:sha(JSON.stringify(f.output)),candidate_sha256:sha('[]')}],units,
        target_unit_digest:unitDigest(targets.map(unit=>unit.unit_key)),target_binding_digest:digest(targets.map(({component_key,local_label,unit_key,birth_membership_digest,model_origin})=>({component_key,unit:{local_label,unit_key,birth_membership_digest},model_origin}))),
        stream:{contract_version:'workspace-incremental-editorial-evidence-jsonl-v1' as const,rows:targets.length,bytes:Buffer.byteLength(stream),sha256:sha(stream)}};
      const evidence={...body,evidence_digest:digest(body)};
      const stored={storage_key:`workspace-engine/${access.workspace_id}/${f.lease.execution_id}/editorial/${evidence.evidence_digest.slice(7)}.jsonl`,sha256:sha(stream),size_bytes:Buffer.byteLength(stream),media_type:'application/x-ndjson'};
      const scope={...access,numeric_execution_id:f.lease.execution_id};
      const plan=await projection.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored});
      const preview=await projection.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope);
      assert.ok(preview.maximum_admission_not_after);
      assert.ok(preview.target_unit_digest);
      const admission=await projection.beginSignalWorkspaceIncrementalEditorialV1({...scope,expected_evidence_plan_artifact_id:plan.artifact_id,
        expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,expected_target_unit_digest:preview.target_unit_digest,
        expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),cap_micro_usd:2_000_000,admission_not_after:preview.maximum_admission_not_after});
      const job=await projection.enqueueSignalWorkspaceIncrementalEditorialV1({...access,execution_id:admission.execution_id});
      await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[job.execution_id]);
      const files=new Map([[stored.storage_key,Buffer.from(stream)]]),acks:string[]=[];let sends=0;
      const storage:NonNullable<Options['storage']>={
        put:async args=>{const bytes=await readFile(args.file);assert.equal(sha(bytes),args.sha256);assert.equal(bytes.length,args.size_bytes);
          const storage_key=`workspace-engine/${args.workspace_id}/${args.execution_id}/${args.sha256.slice(7)}`;
          if(files.has(storage_key))assert.deepEqual(files.get(storage_key),bytes);files.set(storage_key,bytes);
          return{storage_key,sha256:args.sha256,size_bytes:bytes.length,media_type:args.media_type};},
        get:async args=>{assert.ok(args.stored.storage_key.startsWith(`workspace-engine/${args.workspace_id}/${args.execution_id}/`));
          const bytes=files.get(args.stored.storage_key);assert.ok(bytes);assert.equal(sha(bytes),args.stored.sha256);await writeFile(args.destination,bytes,{flag:'wx',mode:0o600});},
      };
      const stores:NonNullable<Options['stores']>={
        claim:projection.claimSignalWorkspaceIncrementalEditorialV1,heartbeat:projection.heartbeatSignalWorkspaceIncrementalEditorialV1,
        context:projection.readSignalWorkspaceIncrementalEditorialContextV1,units:projection.readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1,
        plan:projection.readSignalWorkspaceIncrementalEditorialRequestPlanV1,requests:projection.readSignalWorkspaceIncrementalEditorialRequestsV1,
        checkpoints:projection.readSignalWorkspaceIncrementalEditorialCheckpointsV1,repair:projection.persistSignalWorkspaceIncrementalEditorialRepairV1,
        persistPlan:async args=>{const result=await projection.persistSignalWorkspaceIncrementalEditorialRequestPlanV1(args);if(!acks.includes('plan')){acks.push('plan');throw new Error('simulated plan commit acknowledgement loss');}return result;},
        checkpoint:async args=>{const result=await projection.persistSignalWorkspaceIncrementalEditorialCheckpointV1(args);if(!acks.includes('checkpoint')){acks.push('checkpoint');throw new Error('simulated checkpoint commit acknowledgement loss');}return result;},
        finish:async args=>{const result=await projection.finishSignalWorkspaceIncrementalEditorialV1(args);if(!acks.includes('finish')){acks.push('finish');throw new Error('simulated finish commit acknowledgement loss');}return result;},
        fail:projection.failSignalWorkspaceIncrementalEditorialV1,
      };
      const options:Options={database,...job,stores,storage,storage_root:scratch,api_key:'explicit-local-fake-key',provider_enabled:true,
        send:async args=>sendWorkspaceInterpretationV1({...args,fetch_impl:async()=>{sends++;
          const ledger=(await query('SELECT call_state FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[job.execution_id])).rows;
          assert.equal(ledger.length,1);assert.equal(ledger[0].call_state,'in_flight');
          const output={interpretations:args.batch.clusters.map(cluster=>({cluster_id:cluster.cluster_id,cluster_digest:cluster.cluster_digest,status:'coherent',
            name:'Local current evidence',definition:'A bounded local fixture interpretation.',inclusion:[],exclusion:[],citations:['r1']}))};
          return new Response(JSON.stringify({model:args.batch.configuration.model,type:'message',role:'assistant',stop_reason:'end_turn',
            usage:{input_tokens:100,output_tokens:10},content:[{type:'text',text:JSON.stringify(output)}]}),{status:200});}}),
      };
      // A real settled raw receipt remains recoverable after revocation. The
      // grant changes between claim and context read, not through a fake lease.
      await query('BEGIN');
      try {
        const paidStores:NonNullable<Options['stores']>={...stores,
          persistPlan:projection.persistSignalWorkspaceIncrementalEditorialRequestPlanV1,
          checkpoint:async()=>{throw new Error('workspace_incremental_editorial_transport_unavailable');},
          finish:projection.finishSignalWorkspaceIncrementalEditorialV1};
        await assert.rejects(consume({...options,stores:paidStores}),/workspace_incremental_editorial_transport_unavailable/u);
        assert.equal(sends,1);
        const paid=(await query("SELECT id,call_state,metadata->'interpretation_admission' admission FROM engine_cost_events WHERE catalog_execution_id=$1::uuid",[job.execution_id])).rows;
        assert.equal(paid.length,1);assert.equal(paid[0].call_state,'settled');
        await projection.requeueSignalWorkspaceIncrementalEditorialV1({...access,execution_id:job.execution_id,worker_job_id:job.worker_job_id});
        await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[job.execution_id]);
        const recoveredStores:NonNullable<Options['stores']>={...paidStores,
          claim:async args=>{const lease=await projection.claimSignalWorkspaceIncrementalEditorialV1(args);assert.ok(!('completed' in lease));
            await projection.revokeSignalWorkspaceIncrementalEditorialV1({...access,execution_id:job.execution_id,
              expected_admission_operation_id:admission.receipt.operation_id,idempotency_key:randomUUID()});return lease;},
          checkpoint:projection.persistSignalWorkspaceIncrementalEditorialCheckpointV1};
        assert.equal((await consume({...options,stores:recoveredStores,provider_enabled:false,
          send:async()=>assert.fail('paid raw recovery after revocation must not send')})).completed,true);
        assert.deepEqual((await query("SELECT id,call_state,metadata->'interpretation_admission' admission FROM engine_cost_events WHERE catalog_execution_id=$1::uuid",[job.execution_id])).rows,paid);
        assert.equal(sends,1);
      } finally {await query('ROLLBACK');}
      sends=0;acks.length=0;
      assert.equal((await consume(options)).completed,true);assert.equal(sends,1);assert.deepEqual(acks,['plan','checkpoint','finish']);
      const execution=(await query('SELECT status,result_summary FROM signal_topic_catalog_executions WHERE id=$1::uuid',[job.execution_id])).rows[0];
      assert.equal(execution.status,'ready');assert.equal(execution.result_summary.editorial_complete,true);assert.equal(execution.result_summary.analysis_complete,false);
      const calls=(await query('SELECT call_state,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[job.execution_id])).rows;
      assert.equal(calls.length,1);assert.equal(calls[0].call_state,'settled');assert.ok(Number(calls[0].settled_micro_usd)>0);
      assert.deepEqual(await consume({...options,storage:undefined,provider_enabled:false,send:async()=>assert.fail('ready retry must not send')}),{execution_id:job.execution_id,completed:true,replayed:true});
      assert.deepEqual(await baseline(),before);assert.equal(sends,1);
      completed=true;throw done;
    }}),error=>error===done);
  }finally{await rm(scratch,{recursive:true,force:true});}
  assert.equal(completed,true);
});
