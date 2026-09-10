import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {workspaceProjectionFixtureV1} from './signal-workspace-topic-projection.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import * as projection from '../index';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationUniverseDigestV1 as unitDigest,
  signalWorkspaceInterpretationReferenceIdV1 as refId,buildSignalWorkspaceInterpretationBatchV1 as buildBatch,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet} from '@noisia/query-engine';
import {runWorkspaceIncrementalEditorialConsumerV1 as consume,type WorkspaceIncrementalEditorialConsumerOptionsV1 as Options} from '../../../services/workers/src/workers/signal-workspace-incremental-editorial-consumer';
import {sendWorkspaceInterpretationV1} from '../../../services/workers/src/providers/workspace-interpretation';

import {beginAndEnqueueSignalWorkspaceIncrementalEditorialV1 as admit,renewAndEnqueueSignalWorkspaceIncrementalEditorialV1 as renew} from '../signal-workspace-incremental-editorial-admission-queue';
import {readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1 as renewalView} from '../signal-workspace-incremental-editorial-renewal';
import {assertIncrementalEditorialRenewalV1} from './signal-workspace-incremental-editorial-renewal.assertions';
import {signalWorkspaceIncrementalDerivationJobV1 as derive} from '../../../services/workers/src/workers/signal-workspace-incremental-derivation';
import {signalWorkspaceIncrementalProjectionJobV1 as project} from '../../../services/workers/src/workers/signal-workspace-incremental-projection';
import {loadSignalTopicCatalogStoreV1} from '../signal-topic-catalog';

const enabled=process.env.NOISIA_INCREMENTAL_EDITORIAL_RENEWAL_PG_APPROVED==='true';
const sha=(body:string|Uint8Array)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
test('same-owner renewal resumes only unpaid units and delivers the verified catalog with no repeated sends',{
  skip:!enabled,timeout:120_000,
},async()=>{
  const done=new Error('renewal local composition complete'),clusterIds=[randomUUID(),randomUUID()] as const;
  const scratch=await mkdtemp(join(tmpdir(),'noisia-editorial-consumer-pg-'));let completed=false;
  try{await assert.rejects(workspaceProjectionFixtureV1({
    migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql',
      '0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
    cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
      const f=await incrementalProjectionFixtureV1(base,[clusterIds[0],randomUUID()],{emerging_component:true,migrations_applied:true,editorial_evidence:true,emerging_units:9}),{query,database,access}=f;
      for(const file of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql','0150_signal_workspace_incremental_editorial_preparation.sql','0151_signal_workspace_incremental_editorial_serving.sql','0152_signal_workspace_incremental_editorial_renewal.sql'])
        await query(await readFile(new URL('./'+file,import.meta.url),'utf8'));
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
      const initial=await derive({id:derivationScope.worker_job_id,data:derivationScope,updateProgress:async()=>{}},{database,storage:f.storage});
      assert.ok(initial.projection_execution_id);
      const initialJob=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[initial.projection_execution_id])).rows[0];
      await project({id:initialJob.worker_job_id,data:{execution_id:initial.projection_execution_id},updateProgress:async()=>{}},{database,storage:f.storage});
      // Explicit synthetic numerical memberships, complete census; no fit/model/provider.
      const units:projection.SignalWorkspaceIncrementalEditorialEvidenceUnitV1[]=f.components.flatMap(component=>component.units.map(unit=>{
        const members=f.memberships.filter(row=>row.unit_key===unit.unit_key);
        return {...unit,component_key:component.component_key,model_origin:component.model_origin,lane:component.lane,
          status:component.model_origin.execution_id===f.lease.execution_id?'evidence_ready' as const:'legacy_full_fit' as const,
          root_count:new Set(members.map(row=>row.root_id)).size,chunk_count:members.length,cluster_digest:digest(members)};
      })).sort((a,b)=>a.unit_key<b.unit_key?-1:1);
      const targets=units.filter(unit=>unit.status==='evidence_ready');assert.equal(targets.length,9);
      const groups=targets.map(unit=>{
        const members=f.memberships.filter(row=>row.unit_key===unit.unit_key),seen=new Set<string>();
        const representatives=members.filter(member=>{if(seen.has(member.root_id))return false;seen.add(member.root_id);return true;}).map((member,index)=>{
          const chunk=f.chunks.find(row=>row.root_id===member.root_id&&row.chunk_index===member.chunk_index)!;
          const ref={root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};
          return {...ref,ref_id:refId(ref),text:chunk.text,strength:0.8,selection_reason:index===1?'low_affiliation_boundary' as const:'high_affiliation' as const};
        });
        return {cluster_id:unit.unit_key,lane:unit.lane,cluster_digest:unit.cluster_digest,root_count:unit.root_count,chunk_count:unit.chunk_count,
          terms:['Explicit local current evidence'],representatives:representatives.filter(row=>row.selection_reason==='high_affiliation').concat(representatives.filter(row=>row.selection_reason==='low_affiliation_boundary'))};
      });
      const stream=groups.map((cluster,index)=>JSON.stringify({contract_version:'workspace-incremental-editorial-evidence-unit-v1',unit:targets[index],cluster})+'\n').join('');
      const candidate=f.output.artifacts.find(row=>row.file==='candidate-groups.json')!;
      const body={contract_version:'workspace-incremental-editorial-evidence-stream-v1' as const,numeric_execution_id:f.lease.execution_id,numeric_checkpoint_digest:f.checkpoint.checkpoint_digest,
        numeric_manifest_sha256:sha(JSON.stringify(f.output)),population_digest:f.output.population_digest,representative_selection_policy:'distinct-roots-affiliation-boundary-v1' as const,
        census:{roots:f.roots.length,chunks:f.chunks.length,memberships:f.output.counts.memberships,pending_roots:1,pending_occurrences:f.output.counts.pending_occurrences,
          expected_unit_count:units.length,expected_unit_digest:unitDigest(units.map(unit=>unit.unit_key)),population_digest:f.output.population_digest},
        numeric_component_order:f.components.map(component=>component.component_key),origins:[{execution_id:f.lease.execution_id,manifest_sha256:sha(JSON.stringify(f.output)),candidate_sha256:candidate.sha256}],units,
        target_unit_digest:unitDigest(targets.map(unit=>unit.unit_key)),target_binding_digest:digest(targets.map(({component_key,local_label,unit_key,birth_membership_digest,model_origin})=>({component_key,unit:{local_label,unit_key,birth_membership_digest},model_origin}))),
        stream:{contract_version:'workspace-incremental-editorial-evidence-jsonl-v1' as const,rows:targets.length,bytes:Buffer.byteLength(stream),sha256:sha(stream)}};
      const evidence={...body,evidence_digest:digest(body)},stored={storage_key:`workspace-engine/${access.workspace_id}/${f.lease.execution_id}/editorial/${digest(body).slice(7)}.jsonl`,sha256:sha(stream),size_bytes:Buffer.byteLength(stream),media_type:'application/x-ndjson'};
      const scope={...access,numeric_execution_id:f.lease.execution_id};
      const evidencePlan=await projection.persistSignalWorkspaceIncrementalEditorialEvidenceV1({...scope,evidence,stored});
      const preview=await projection.loadSignalWorkspaceIncrementalEditorialAdmissionV1(scope);assert.ok(preview.target_unit_digest);
      const initialDeadline=(await query("SELECT to_char((clock_timestamp()+interval '3 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') value")).rows[0].value as string;
      const admitted=await admit({...scope,provider_available:true,expected_evidence_plan_artifact_id:evidencePlan.artifact_id,
        expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,expected_target_unit_digest:preview.target_unit_digest,
        expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),cap_micro_usd:2_000_000,admission_not_after:initialDeadline});
      assert.ok(admitted.dispatch);const job=admitted.dispatch,ownerScope={...access,execution_id:job.execution_id};
      const files=new Map([[stored.storage_key,Buffer.from(stream)]]),sentUnits:string[]=[],acks:string[]=[];
      let sends=0,checkpoints=0,expire=true,storageReads=0,storageWrites=0;
      const storage:NonNullable<Options['storage']>={
        put:async args=>{storageWrites++;const bytes=await readFile(args.file);assert.equal(sha(bytes),args.sha256);assert.equal(bytes.length,args.size_bytes);
          const storage_key=`workspace-engine/${args.workspace_id}/${args.execution_id}/${args.sha256.slice(7)}`;
          if(files.has(storage_key))assert.deepEqual(files.get(storage_key),bytes);files.set(storage_key,bytes);
          return{storage_key,sha256:args.sha256,size_bytes:bytes.length,media_type:args.media_type};},
        get:async args=>{storageReads++;assert.ok(args.stored.storage_key.startsWith(`workspace-engine/${args.workspace_id}/${args.execution_id}/`));
          const bytes=files.get(args.stored.storage_key);assert.ok(bytes);assert.equal(sha(bytes),args.stored.sha256);assert.equal(bytes.length,args.stored.size_bytes);
          await writeFile(args.destination,bytes,{flag:'wx',mode:0o600});},
      };
      let oldLease:projection.SignalWorkspaceIncrementalEditorialLeaseV1|undefined;
      const stores:NonNullable<Options['stores']>={
        claim:async args=>{const result=await projection.claimSignalWorkspaceIncrementalEditorialV1(args);if(!('completed' in result)&&!oldLease)oldLease=result;return result;},
        heartbeat:projection.heartbeatSignalWorkspaceIncrementalEditorialV1,context:projection.readSignalWorkspaceIncrementalEditorialContextV1,
        units:projection.readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1,plan:projection.readSignalWorkspaceIncrementalEditorialRequestPlanV1,
        requests:projection.readSignalWorkspaceIncrementalEditorialRequestsV1,checkpoints:projection.readSignalWorkspaceIncrementalEditorialCheckpointsV1,
        persistPlan:projection.persistSignalWorkspaceIncrementalEditorialRequestPlanV1,repair:projection.persistSignalWorkspaceIncrementalEditorialRepairV1,
        checkpoint:async args=>{const result=await projection.persistSignalWorkspaceIncrementalEditorialCheckpointV1(args);checkpoints++;
          if(expire){expire=false;await query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM $1::timestamptz-clock_timestamp()))+0.02)',[initialDeadline]);}
          else if(!acks.includes('checkpoint')){acks.push('checkpoint');throw Object.assign(Error('local checkpoint ACK loss'),{code:'ECONNRESET'});}return result;},
        finish:async args=>{const result=await projection.finishSignalWorkspaceIncrementalEditorialV1(args);if(!acks.includes('finish')){acks.push('finish');throw Object.assign(Error('local finish ACK loss'),{code:'ECONNRESET'});}return result;},
        fail:projection.failSignalWorkspaceIncrementalEditorialV1,
      };
      const options:Options={database,...job,stores,storage,storage_root:scratch,api_key:'explicit-local-fake-key',provider_enabled:true,
        send:async args=>sendWorkspaceInterpretationV1({...args,fetch_impl:async()=>{sends++;sentUnits.push(...args.batch.clusters.map(row=>row.cluster_id));
          assert.equal((await query("SELECT count(*)::int count FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state='in_flight'",[job.execution_id])).rows[0].count,1);
          const output={interpretations:args.batch.clusters.map(cluster=>({cluster_id:cluster.cluster_id,cluster_digest:cluster.cluster_digest,status:'coherent',
            name:`Local topic ${targets.findIndex(unit=>unit.unit_key===cluster.cluster_id)+1}`,definition:'Explicit local current evidence for one numerical unit.',inclusion:[],exclusion:[],citations:['r1']}))};
          return new Response(JSON.stringify({model:args.batch.configuration.model,type:'message',role:'assistant',stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:10},
            content:[{type:'text',text:JSON.stringify(output)}]}),{status:200});}}),
      };
      const dispatch=async()=>query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[job.execution_id]);
      await dispatch();
      await assert.rejects(consume(options),/workspace_engine_interpretation_daily_authority_expired/u);
      assert.equal(sends,1);assert.equal(checkpoints,1);assert.equal(sentUnits.length,4);
      const calls=async()=>(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[job.execution_id])).rows;
      const artifacts=async()=>(await query('SELECT to_jsonb(artifact) body FROM analysis_artifacts artifact WHERE engine_execution_id=$1::uuid ORDER BY id',[job.execution_id])).rows;
      const paid=await calls(),priorArtifacts=await artifacts();assert.equal(paid.length,1);assert.equal(paid[0].body.call_state,'settled');
      const identity=(await query('SELECT input_snapshot,input_digest FROM signal_topic_catalog_executions WHERE id=$1::uuid',[job.execution_id])).rows[0];
      const renewal=await renewalView(database,ownerScope);assert.ok(renewal?.can_renew);assert.equal(renewal.run_cap_micro_usd,2_000_000);
      const renewArgs={...ownerScope,expected_admission_operation_id:admitted.receipt.operation_id,idempotency_key:randomUUID(),
        grant_cap_micro_usd:renewal.maximum_grant_micro_usd,admission_not_after:renewal.maximum_admission_not_after};
      await assertIncrementalEditorialRenewalV1({database,query,access,execution_id:job.execution_id,worker_job_id:job.worker_job_id,
        receipt:admitted.receipt,renewArgs,setupPendingCall:async(retry_of_call_id?:string)=>{
          await dispatch();const lease=await projection.claimSignalWorkspaceIncrementalEditorialV1({database,...job});assert.ok(!('completed' in lease));
          const header=await projection.readSignalWorkspaceIncrementalEditorialRequestPlanV1({database,lease});assert.ok(header);
          const rows=await projection.readSignalWorkspaceIncrementalEditorialRequestsV1({database,lease});const request=rows[1]!.request;
          const bytes=files.get(header.stored.storage_key)!.subarray(request.offset,request.offset+request.size_bytes);assert.equal(sha(bytes),request.sha256);
          const storedBatch=JSON.parse(bytes.toString()).batch;
          assert.equal(digest(lease.config.call_configuration),digest(sonnet));
          const batch=buildBatch(storedBatch.context,storedBatch.clusters,sonnet);
          assert.equal(digest(batch),digest(storedBatch));assert.equal(batch.request_digest,request.request_digest);
          const call=await projection.reserveSignalWorkspaceEngineInterpretationV1({...ownerScope,execution_token:lease.execution_token,
            admission_operation_id:lease.interpretation_admission.operation_id,idempotency_key:retry_of_call_id?`${batch.batch_key}:retry:${retry_of_call_id}`:batch.batch_key,request_digest:batch.request_digest,
            ...(retry_of_call_id?{retry_of_call_id}:{}),
            configuration:lease.config.call_configuration,reserved_micro_usd:batch.reserved_micro_usd,
            budget_timezone:lease.config.budget_timezone,daily_cap_micro_usd:lease.config.daily_cap_micro_usd});
          assert.equal(call.state,'reserved');return{lease,call};
        }});
      const state=async()=>(await query(`SELECT
        (SELECT jsonb_agg(to_jsonb(run) ORDER BY id) FROM signal_topic_catalog_executions run WHERE workspace_id=$1::uuid) engines,
        (SELECT jsonb_agg(to_jsonb(artifact) ORDER BY id) FROM analysis_artifacts artifact WHERE workspace_id=$1::uuid) artifacts,
        (SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM signal_classification_operations operation WHERE workspace_id=$1::uuid) operations,
        (SELECT jsonb_agg(to_jsonb(dispatch) ORDER BY id) FROM signal_topic_classification_outbox dispatch WHERE workspace_id=$1::uuid) dispatches,
        (SELECT jsonb_agg(to_jsonb(call) ORDER BY id) FROM engine_cost_events call WHERE workspace_id=$1::uuid) calls`,[access.workspace_id])).rows[0];
      const unavailable=await state();await assert.rejects(renew({...renewArgs,provider_available:false}),/workspace_analysis_interpretation_unavailable/u);
      assert.deepEqual(await state(),unavailable,'provider-off renewal rolls back grant, rearm and all money');
      const lost=Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();let committed=false;
        return Object.assign(Object.create(client),{release:()=>client.release(),query:async(text:string,values?:unknown[])=>{
          if(committed&&text==='ROLLBACK')return{rows:[],rowCount:0};const result=await client.query(text,values);
          if(text==='COMMIT'){committed=true;throw Object.assign(Error('local renewal COMMIT ACK loss'),{code:'ECONNRESET'});}return result;}});}});
      await assert.rejects(renew({...renewArgs,database:lost,provider_available:true}),/local renewal COMMIT ACK loss/u);
      const renewed=await renew({...renewArgs,provider_available:false});assert.equal(renewed.replayed,true);assert.equal(renewed.execution_id,job.execution_id);
      assert.equal(renewed.receipt.prior_admission_operation_id,admitted.receipt.operation_id);assert.notEqual(renewed.receipt.operation_id,admitted.receipt.operation_id);
      assert.equal(renewed.receipt.run_cap_micro_usd,admitted.receipt.run_cap_micro_usd);assert.equal(renewed.receipt.configuration_digest,admitted.receipt.configuration_digest);
      const accepted=await state();assert.deepEqual(await renew({...renewArgs,provider_available:false}),renewed);assert.deepEqual(await state(),accepted);
      assert.deepEqual(await calls(),paid);assert.deepEqual(await artifacts(),priorArtifacts);
      assert.deepEqual((await query('SELECT input_snapshot,input_digest FROM signal_topic_catalog_executions WHERE id=$1::uuid',[job.execution_id])).rows[0],identity);
      assert.ok(oldLease);await assert.rejects(projection.heartbeatSignalWorkspaceIncrementalEditorialV1({database,lease:oldLease}),/lease_conflict/u);
      await dispatch();assert.equal((await consume(options)).completed,true);
      assert.equal(sends,3);assert.equal(checkpoints,3);assert.equal(sentUnits.length,9);assert.equal(new Set(sentUnits).size,9);
      const finalCalls=await calls();assert.equal(finalCalls.length,3);
      assert.deepEqual(finalCalls.find(row=>row.body.id===paid[0].body.id),paid[0]);
      for(const row of finalCalls.filter(row=>row.body.id!==paid[0].body.id)){
        assert.equal(row.body.call_state,'settled');assert.equal(row.body.metadata.interpretation_admission.operation_id,renewed.receipt.operation_id);
      }
      for(const artifact of priorArtifacts)assert.deepEqual((await artifacts()).find(row=>row.body.id===artifact.body.id),artifact);
      const io=[storageReads,storageWrites];assert.equal((await consume({...options,provider_enabled:false,send:async()=>assert.fail('ready replay must not send')})).replayed,true);
      assert.deepEqual([storageReads,storageWrites],io);
      const finished=await state();assert.deepEqual(await renew({...renewArgs,provider_available:false}),renewed);assert.deepEqual(await state(),finished);
      assert.deepEqual(await baseline(),before);assert.equal((await query('SELECT signal_workspace_incremental_editorial_paid_v1($1::uuid) paid',[job.execution_id])).rows[0].paid,true);

      // Continue through the existing catalog and numerical projection Workers.
      for(const [key,value] of files)f.bodies.set(key,value.toString('utf8'));
      assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);
      const dispatchProjection=async()=>{const row=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[f.lease.execution_id])).rows[0];
        return{...access,execution_id:f.lease.execution_id,worker_job_id:row.worker_job_id};};
      let delivery=await dispatchProjection();
      const catalogStage=await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage});
      assert.ok('phase' in catalogStage);assert.equal(catalogStage.phase,'catalog');
      assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);delivery=await dispatchProjection();
      const derived=await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage});assert.ok(derived.projection_execution_id);assert.ok(derived.generation_id);
      const classification=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[derived.projection_execution_id])).rows[0];
      await project({id:classification.worker_job_id,data:{execution_id:derived.projection_execution_id},updateProgress:async()=>{}},{database,storage:f.storage});
      const catalog=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
      const added=catalog.topics.filter(topic=>targets.some(unit=>unit.unit_key===topic.source?.candidate_key));assert.equal(added.length,9);
      const selection=await projection.loadSignalWorkspaceTopicSelectionV1(access);
      for(const topic of added){assert.equal(topic.lifecycle,'draft');assert.equal(topic.source!.run_key,`workspace-engine:${job.execution_id}`);assert.equal(selection.items[topic.term_key]?.selected??false,false);}
      const expectedMemberships=new Set(f.memberships.map(row=>`${row.root_id}:${row.unit_key}`)).size;
      const counts=(await query("SELECT count(DISTINCT item.canonical_root_id)::int roots,count(assignment.id)::int memberships,count(*) FILTER(WHERE assignment.disposition='approved')::int approved FROM signal_classification_generation_items item LEFT JOIN signal_classification_assignments assignment ON assignment.generation_item_id=item.id WHERE item.generation_id=$1::uuid",[derived.generation_id])).rows[0];
      assert.deepEqual(counts,{roots:3,memberships:expectedMemberships,approved:0});
      assert.deepEqual(await calls(),finalCalls);assert.deepEqual(await baseline(),before);assert.equal(sends,3);
      completed=true;throw done;
    }}),error=>{if(error!==done)console.error(error);return error===done;});
  }finally{await rm(scratch,{recursive:true,force:true});}
  assert.equal(completed,true);
});
