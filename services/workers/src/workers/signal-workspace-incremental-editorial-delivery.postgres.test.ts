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
import {signalWorkspaceIncrementalDerivationJobV1 as derive, workspaceIncrementalDerivationStoresV1} from './signal-workspace-incremental-derivation';
import {signalWorkspaceIncrementalProjectionJobV1 as project} from './signal-workspace-incremental-projection';
import {materializeSignalWorkspaceIncrementalEditorialTopicsV1 as materialize,loadSignalTopicCatalogStoreV1,updateSignalTopicStoreV1,setSignalTopicLifecycleStoreV1} from '../../../../infrastructure/db/signal-topic-catalog';
import {beginAndEnqueueSignalWorkspaceIncrementalEditorialV1 as admit} from '../../../../infrastructure/db/signal-workspace-incremental-editorial-admission-queue';
import {sendWorkspaceInterpretationV1} from '../providers/workspace-interpretation';

const enabled=process.env.NOISIA_INCREMENTAL_EDITORIAL_DELIVERY_PG_APPROVED==='true';
const sha=(body:string|Uint8Array)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
test('paid editorial outputs deliver Topics and current-root Signal without changing money or numeric history',{
  skip:!enabled,timeout:120_000,
},async()=>{
  const done=new Error('consumer local composition complete'),clusterIds=[randomUUID(),randomUUID()] as const;
  const scratch=await mkdtemp(join(tmpdir(),'noisia-editorial-consumer-pg-'));let completed=false;
  try{await assert.rejects(workspaceProjectionFixtureV1({
    migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql',
      '0144_signal_workspace_engine_progress.sql','0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql','0147_signal_workspace_interpretation_admission.sql'],
    cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'local-incremental-projection'}},onCheckpoint:async base=>{
      const f=await incrementalProjectionFixtureV1(base,[clusterIds[0],randomUUID()],{emerging_component:true,migrations_applied:true}),{query,database,access}=f;
      for(const file of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql','0151_signal_workspace_incremental_editorial_serving.sql'])
        await query(await readFile(new URL('../../../../infrastructure/db/migrations/'+file,import.meta.url),'utf8'));
      const baseline=async()=>({
        parents:(await query('SELECT to_jsonb(run) body FROM signal_topic_catalog_executions run WHERE id=ANY($1::uuid[]) ORDER BY id',[[base.lease.execution_id,f.lease.execution_id]])).rows,
        models:(await query('SELECT to_jsonb(model) body FROM tagging_model_versions model WHERE id=ANY($1::uuid[]) ORDER BY id',[[f.checkpoint.model_version_id,f.lease.snapshot.numeric_descriptor!.parent.model_version_id].filter(Boolean)])).rows,
        workspace:(await query('SELECT to_jsonb(workspace) body FROM signal_workspaces workspace WHERE id=$1::uuid',[access.workspace_id])).rows,
      });
      let before=await baseline();
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
      const priorCatalog=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
      const selectedTopic=priorCatalog.topics.find(topic=>topic.source?.candidate_key===f.components.find(component=>component.lane==='open')!.units[0]!.unit_key)!;
      const initialSelection=await projection.loadSignalWorkspaceTopicSelectionV1(access);
      await projection.selectSignalWorkspaceTopicV1({...access,term_key:selectedTopic.term_key,selected:true,expected_selection_revision:initialSelection.revision,
        expected_definition_revision:selectedTopic.definition_revision,expected_definition_digest:selectedTopic.definition_digest,generation_id:initial.generation_id!,idempotency_key:randomUUID()});
      const selected=await projection.loadSignalWorkspaceTopicSelectionV1(access);before=await baseline();
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
      const admissionArgs={...scope,provider_available:true,expected_evidence_plan_artifact_id:plan.artifact_id,
        expected_numeric_checkpoint_digest:preview.numeric_checkpoint_digest,expected_target_unit_digest:preview.target_unit_digest,
        expected_history_cut_digest:preview.history_cut_digest,idempotency_key:randomUUID(),cap_micro_usd:2_000_000,admission_not_after:preview.maximum_admission_not_after};
      const admissionInventory=async()=>(await query(`SELECT
        (SELECT count(*)::int FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-incremental-editorial-v1') owners,
        (SELECT count(*)::int FROM analysis_artifacts WHERE workspace_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1') claims,
        (SELECT count(*)::int FROM signal_classification_operations WHERE workspace_id=$1::uuid AND operation_kind='authorize-interpretation') grants,
        (SELECT count(*)::int FROM signal_topic_classification_outbox WHERE workspace_id=$1::uuid) outboxes`,[access.workspace_id])).rows[0];
      const admissionBefore=await admissionInventory();
      const admissionState=async()=>(await query(`SELECT
        (SELECT jsonb_agg(to_jsonb(run) ORDER BY id) FROM signal_topic_catalog_executions run WHERE workspace_id=$1::uuid) engines,
        (SELECT jsonb_agg(to_jsonb(artifact) ORDER BY id) FROM analysis_artifacts artifact WHERE workspace_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1') claims,
        (SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM signal_classification_operations operation WHERE workspace_id=$1::uuid AND operation_kind='authorize-interpretation') grants,
        (SELECT jsonb_agg(to_jsonb(dispatch) ORDER BY id) FROM signal_topic_classification_outbox dispatch WHERE workspace_id=$1::uuid) outboxes`,[access.workspace_id])).rows[0];
      const beforeUnavailable=await admissionState();
      await assert.rejects(admit({...admissionArgs,provider_available:false}),error=>error instanceof projection.SignalWorkspaceEngineError
        && error.code==='workspace_analysis_interpretation_unavailable'&&error.status===422);
      assert.deepEqual(await admissionState(),beforeUnavailable,'unavailable provider rolls back engines, claims, grants and outbox');
      const wrap=(mode:'reject-outbox'|'lost-ack')=>Object.assign(Object.create(database),{connect:async()=>{const client=await database.connect();let committed=false;
        return Object.assign(Object.create(client),{release:()=>client.release(),query:async(text:string,values?:unknown[])=>{
          if(committed&&text==='ROLLBACK')return{rows:[],rowCount:0};
          if(mode==='reject-outbox'&&/INSERT INTO signal_topic_classification_outbox/u.test(text))throw new Error('local dispatch INSERT rejected');
          const result=await client.query(text,values);if(mode==='lost-ack'&&text==='COMMIT'){committed=true;throw Object.assign(Error('local admission COMMIT ACK lost'),{code:'ECONNRESET'});}return result;
        }});}});
      await assert.rejects(admit({...admissionArgs,database:wrap('reject-outbox')}),/local dispatch INSERT rejected/u);
      assert.deepEqual(await admissionInventory(),admissionBefore,'owner, claims and grant roll back together');
      await assert.rejects(admit({...admissionArgs,database:wrap('lost-ack')}),/local admission COMMIT ACK lost/u);
      const admission=await admit({...admissionArgs,provider_available:false});assert.equal(admission.replayed,true);assert.ok(admission.dispatch);
      assert.deepEqual(await admissionInventory(),{owners:admissionBefore.owners+1,claims:admissionBefore.claims+1,grants:admissionBefore.grants+1,outboxes:admissionBefore.outboxes+1});
      const acceptedState=await admissionState();
      assert.deepEqual(await admit({...admissionArgs,provider_available:false}),admission);
      assert.deepEqual(await admissionState(),acceptedState,'provider-off accepted replay has no side effects');
      const job={...admission.dispatch,workspace_id:access.workspace_id,actor_user_id:access.actor_user_id};
      assert.equal((await query("SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[job.execution_id])).rows[0].n,1);
      await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid",[job.execution_id]);
      const files=new Map([[stored.storage_key,Buffer.from(stream)]]);let sends=0;
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
        persistPlan:projection.persistSignalWorkspaceIncrementalEditorialRequestPlanV1,
        checkpoint:async args=>{await projection.revokeSignalWorkspaceIncrementalEditorialV1({...access,execution_id:job.execution_id,expected_admission_operation_id:admission.receipt.operation_id,idempotency_key:randomUUID()});return projection.persistSignalWorkspaceIncrementalEditorialCheckpointV1(args);},
        finish:projection.finishSignalWorkspaceIncrementalEditorialV1,
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
      assert.equal((await consume(options)).completed,true);assert.equal(sends,1);
      const ownerOutbox=(await query('SELECT to_jsonb(dispatch) body FROM signal_topic_classification_outbox dispatch WHERE execution_id=$1::uuid',[job.execution_id])).rows;
      assert.deepEqual(await admit({...admissionArgs,provider_available:false}),admission);
      assert.deepEqual((await query('SELECT to_jsonb(dispatch) body FROM signal_topic_classification_outbox dispatch WHERE execution_id=$1::uuid',[job.execution_id])).rows,ownerOutbox,'admission replay after revoke/ready is inert');
      assert.equal((await query('SELECT signal_workspace_incremental_editorial_paid_v1($1::uuid) paid',[job.execution_id])).rows[0].paid,true);
      const calls=async()=>(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE workspace_id=$1::uuid ORDER BY id',[access.workspace_id])).rows;
      const paidCalls=await calls(),numericBefore=await baseline();
      const historical=(await query('SELECT signal_workspace_incremental_projection_editorial_digest_v1($1::uuid) digest',[f.lease.execution_id])).rows[0].digest;
      for(const [key,value] of files)f.bodies.set(key,value.toString('utf8'));
      assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);
      const dispatch=async()=>{const row=(await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection' RETURNING worker_job_id",[f.lease.execution_id])).rows[0];return{...access,execution_id:f.lease.execution_id,worker_job_id:row.worker_job_id};};
      let delivery=await dispatch();
      const activeDerivation=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1(delivery);
      await projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...delivery,derivation_digest:activeDerivation.derivation_digest,
        units:f.components.flatMap(component=>component.units.map(unit=>({...unit,component_key:component.component_key})))});
      const allProposals=(await projection.readSignalWorkspaceIncrementalProjectionProposalsV1({...delivery,derivation_digest:activeDerivation.derivation_digest})).items;
      const packets=async function*(corrupt=false){for(const ref of allProposals)yield{artifact_id:ref.artifact_id,body:f.bodies.get(ref.storage_key)!+(corrupt?'x':'')};};
      await assert.rejects(materialize({...delivery,derivation_digest:activeDerivation.derivation_digest,proposals:packets(true)}),/proposal_invalid/u);
      await assert.rejects(materialize({...delivery,derivation_digest:activeDerivation.derivation_digest,proposals:(async function*(){})()}),/proposal_missing/u);
      await assert.rejects(materialize({...delivery,actor_user_id:randomUUID(),derivation_digest:activeDerivation.derivation_digest,proposals:packets()}),/forbidden/u);
      const catalogBefore=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
      const originalProfile=catalogBefore.profile!.id;
      const receiptLost=new Error('local catalogue COMMIT ACK lost');let acknowledged=false;
      await assert.rejects(derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage,
        stores:{...workspaceIncrementalDerivationStoresV1,materialize:async args=>{await materialize(args);acknowledged=true;throw Object.assign(receiptLost,{code:'ECONNRESET'});}}}),/transport_unavailable/u);
      assert.equal(acknowledged,true);
      const catalog=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
      assert.notEqual(catalog.profile!.id,originalProfile);
      const added=catalog.topics.find(topic=>topic.source?.candidate_key===groupKey());assert.ok(added);
      function groupKey(){return targets[0]!.unit_key;}
      assert.equal(added.lifecycle,'draft');assert.equal(added.discovery_guidance,false);assert.equal(added.scope,'all_conversations');
      assert.equal(added.source!.run_key,`workspace-engine:${job.execution_id}`);
      assert.equal((await projection.loadSignalWorkspaceTopicSelectionV1(access)).items[added.term_key]?.selected??false,false);
      assert.deepEqual((await projection.loadSignalWorkspaceTopicSelectionV1(access)).items,selected.items,'catalog copy preserves explicit existing selection');
      const definitionOnly=(topic:typeof added)=>Object.fromEntries(Object.entries(topic).filter(([key])=>key!=='taxonomy_term_id'));
      for(const topic of catalogBefore.topics)assert.deepEqual(definitionOnly(catalog.topics.find(row=>row.term_key===topic.term_key)!),definitionOnly(topic));
      const receipts=(await query("SELECT result_summary FROM signal_topic_catalog_operations WHERE workspace_id=$1::uuid AND action='materialize_incremental'",[access.workspace_id])).rows;
      assert.equal(receipts.length,1);
      const update=await projection.loadSignalWorkspaceAnalysisUpdateV1(access);assert.equal(update!.catalog_receipt!.receipt_id,receipts[0].result_summary.receipt_id);assert.equal(update!.has_pending_work,true);
      // A stale delivery ID cannot commit against the new catalog. The scheduler
      // creates its distinct scoped stage even after an uncertain catalog ACK.
      await assert.rejects(projection.persistSignalWorkspaceIncrementalProjectionUnitsPageV1({...delivery,derivation_digest:derivation.derivation_digest,units:[{component_key:f.components[0]!.component_key,...f.components[0]!.units[0]!}]}),/source_unavailable|inputs_changed/u);
      assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),0,'transport backoff is retained');
      await query("UPDATE signal_topic_classification_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE execution_id=$1::uuid AND dispatch_kind='incremental_projection'",[f.lease.execution_id]);
      assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);
      const previousJob=delivery.worker_job_id;delivery=await dispatch();assert.notEqual(delivery.worker_job_id,previousJob);
      const result=await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage});
      assert.ok(result.projection_execution_id);assert.ok(result.generation_id);
      const bindings=(await query("SELECT metadata->'binding' binding FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-unit-binding-v1' AND metadata->'binding'->'proposal'->>'owner_execution_id'=$2",[f.lease.execution_id,job.execution_id])).rows;
      assert.equal(bindings.length,1);assert.equal(bindings[0].binding.model_origin.execution_id,f.lease.execution_id);
      assert.equal(bindings[0].binding.proposal.source.kind,'incremental_editorial');
      const classification=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[result.projection_execution_id])).rows[0];
      await project({id:classification.worker_job_id,data:{execution_id:result.projection_execution_id},updateProgress:async()=>{}},{database,storage:f.storage});
      const counts=(await query("SELECT count(DISTINCT item.canonical_root_id)::int roots,count(assignment.id)::int memberships,count(*) FILTER(WHERE assignment.disposition='approved')::int approved FROM signal_classification_generation_items item LEFT JOIN signal_classification_assignments assignment ON assignment.generation_item_id=item.id WHERE item.generation_id=$1::uuid",[result.generation_id])).rows[0];
      assert.equal(counts.roots,f.roots.length);assert.equal(counts.memberships,f.roots.length*2);assert.equal(counts.approved,0);
      const ready=await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:{get:async()=>assert.fail('ready downloaded'),put:async()=>assert.fail('ready uploaded')}});
      assert.equal(ready.generation_id,result.generation_id);assert.equal(ready.replayed,true);
      assert.equal((await query('SELECT signal_workspace_incremental_projection_editorial_digest_v1($1::uuid) digest',[f.lease.execution_id])).rows[0].digest,historical);
      assert.deepEqual(await calls(),paidCalls);assert.deepEqual(await baseline(),numericBefore);assert.deepEqual(numericBefore,before);assert.equal(sends,1);
      // Meaning edits and archives remain owned by the operator. Replaying the
      // paid catalog receipt cannot recreate its old profile or source text.
      await query('BEGIN');try{
        await updateSignalTopicStoreV1({pool:database,...access,term_key:added.term_key,idempotency_key:randomUUID(),input:{expected_definition_revision:added.definition_revision,definition:'A deliberately different operator meaning.'}});
        const edited=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
        assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);delivery=await dispatch();
        const remapped=await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage});assert.ok(remapped.projection_execution_id);
        assert.equal((await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id})).profile!.id,edited.profile!.id);
        const newJob=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[remapped.projection_execution_id])).rows[0];
        await project({id:newJob.worker_job_id,data:{execution_id:remapped.projection_execution_id},updateProgress:async()=>{}},{database,storage:f.storage});
        assert.equal((await query("SELECT count(*)::int n FROM signal_classification_assignments WHERE generation_id=$1::uuid AND membership_metadata->>'proposal_owner_execution_id'=$2",[remapped.generation_id,job.execution_id])).rows[0].n,0,'changed meaning never inherits the old numerical membership');
        await setSignalTopicLifecycleStoreV1({pool:database,...access,term_key:added.term_key,lifecycle:'archived',idempotency_key:randomUUID()});
        const archived=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});
        assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);delivery=await dispatch();
        await derive({id:delivery.worker_job_id,data:delivery,updateProgress:async()=>{}},{database,storage:f.storage});
        const after=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:access.workspace_id});assert.equal(after.profile!.id,archived.profile!.id);
        assert.equal(after.topics.find(topic=>topic.term_key===added.term_key)!.lifecycle,'archived');
        assert.equal((await query("SELECT count(*)::int n FROM signal_topic_catalog_operations WHERE workspace_id=$1::uuid AND action='materialize_incremental'",[access.workspace_id])).rows[0].n,1);
        assert.deepEqual(await calls(),paidCalls);assert.equal(sends,1);
      }finally{await query('ROLLBACK');}
      completed=true;throw done;
    }}),error=>{if(error!==done)console.error(error);return error===done;});
  }finally{await rm(scratch,{recursive:true,force:true});}
  assert.equal(completed,true);
});
