import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';
import {signalWorkspaceEngineProgressJobV1} from '../../../services/workers/src/workers/signal-workspace-engine-progress';
import {drainSignalTopicClassificationOutboxV1} from '../../../services/workers/src/workers/signal-topic-classification-outbox';
import * as money from '../signal-workspace-engine-interpretation';
import {workspaceProjectionFixtureV1,fixtureSha,type WorkspaceProjectionCheckpointFixtureV1} from './signal-workspace-topic-projection.fixture';
import * as progress from '../signal-workspace-engine-progress';
import * as engine from '../signal-workspace-engine';
import * as classification from '../signal-workspace-classification';
import * as projection from '../signal-workspace-topic-projection';
import * as selection from '../signal-workspace-topic-selection';
import {createSignalTopicStoreV1,updateSignalTopicStoreV1,setSignalTopicLifecycleStoreV1} from '../signal-topic-catalog';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
const projectionStores={claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
 readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
 readCorrections:classification.readSignalWorkspaceClassificationCorrectionsV1,readRoots:classification.readSignalWorkspaceClassificationRootPageV1,
 readChunks:classification.readSignalWorkspaceClassificationChunkPageV1,copyRoot:classification.copySignalWorkspaceClassificationRootV1,
 commitRoot:classification.commitSignalWorkspaceClassificationRootV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
async function deriveEditedCatalog(f:Pick<WorkspaceProjectionCheckpointFixtureV1,'database'|'query'|'access'|'bodies'>&{execution_id:string}){
 const {database,query,access,bodies}=f,scope={...access,execution_id:f.execution_id};
 const current=await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope);assert.equal(current.needs_materialization,true);
 assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(access)).latest_run?.materialization_pending,true);
 const before=(await query('SELECT to_jsonb(execution) body FROM signal_topic_catalog_executions execution WHERE id=$1::uuid',[f.execution_id])).rows[0]!.body;
 const costs=(await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[f.execution_id])).rows;
 assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),1);
 await query("UPDATE signal_topic_classification_outbox SET available_at=transaction_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[f.execution_id]);
 let jobId='';
 await drainSignalTopicClassificationOutboxV1({database,schedule:async()=>({requeued:0}),queue:{getJob:async()=>null,add:async(name,payload,options)=>{
  assert.equal(name,progress.SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1);assert.equal((payload as typeof scope).execution_id,f.execution_id);jobId=String(options.jobId);
 }}});assert.ok(jobId);
 const storage={get:async({stored,destination}:{stored:{storage_key:string};destination:string})=>{const body=bodies.get(stored.storage_key);assert.notEqual(body,undefined);await writeFile(destination,body!);},
  put:async({file,sha256,size_bytes,media_type}:{file:string;sha256:string;size_bytes:number;media_type:string})=>{
   const {basename}=await import('node:path');const body=await readFile(file,'utf8');assert.equal(fixtureSha(body),sha256);
   const storage_key=`workspace-engine/${access.workspace_id}/${f.execution_id}/${basename(file)}`;bodies.set(storage_key,body);return{storage_key,sha256,size_bytes,media_type};}};
 await signalWorkspaceEngineProgressJobV1({id:jobId,data:scope,updateProgress:async()=>{}},{database,storage});
 const status=await engine.loadSignalWorkspaceEngineStatusV1(access),receipt=status.latest_run!.materialization_progress!;assert.ok(receipt);
 assert.equal(receipt.interpreted_unit_count,current.coverage.unit_count);assert.equal(status.latest_run!.materialization_pending,false);
 const dispatch=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[receipt.projection_execution_id])).rows[0]!;
 await signalWorkspaceTopicProjectionJobV1({id:dispatch.worker_job_id,data:{execution_id:receipt.projection_execution_id},updateProgress:async()=>{}},
  {database,stores:projectionStores,storage});
 assert.equal((await projection.loadSignalWorkspaceTopicProjectionStatusV1(access)).latest_complete?.generation_id,receipt.generation_id);
 assert.equal((await projection.loadSignalWorkspaceTopicProjectionStatusV1(access)).latest_complete?.is_current,true);
 assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0,'the materializer-created profile does not create a self-loop');
 assert.equal((await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope)).needs_materialization,false);
 if(before.status==='ready')assert.deepEqual((await query('SELECT to_jsonb(execution) body FROM signal_topic_catalog_executions execution WHERE id=$1::uuid',[f.execution_id])).rows[0]!.body,before,'ready engine and its full checkpoint stay immutable');
 assert.deepEqual((await query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[f.execution_id])).rows,costs);
 return receipt;
}

test('progressive paid checkpoints preserve catalog edits and engine authority, coalesce dispatch and converge to the full main catalog', {skip:!enabled,timeout:90_000},async()=>{
 let firstTerm='',firstKey='',firstGeneration='',lastProgressGeneration='';
 const f=await workspaceProjectionFixtureV1({migrations:['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql',
  '0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'],onCheckpoint:async checkpoint=>{
  const {database,query,access,lease,proposals,bodies}=checkpoint;
  const scope={...access,execution_id:lease.execution_id};
  const baseline=(await query('SELECT status,execution_token,input_snapshot,error_code FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0];
  const budget=(await query('SELECT id,call_state,reserved_micro_usd,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows;
  const beforeDispatch=await engine.loadSignalWorkspaceEngineStatusV1(access);
  assert.equal(beforeDispatch.latest_run?.materialization_pending,true,'paid coverage is pending before the scheduler inserts any outbox');
  assert.equal(beforeDispatch.latest_run?.materialization_retry_available,false);
  if(proposals.length===1)await assert.rejects(progress.retrySignalWorkspaceEngineProgressV1({...scope,idempotency_key:randomUUID()}),/retry_unavailable/u);
  assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),1);
  assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0,'concurrent scheduler replay coalesces pending dispatch');
  assert.deepEqual((await query('SELECT dispatch_kind FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid ORDER BY dispatch_kind',[lease.execution_id])).rows,[{dispatch_kind:'engine_progress'},{dispatch_kind:'execution'}]);
  const source=await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope);assert.equal(source.coverage.unit_count,proposals.length);assert.equal(source.expected_coverage.unit_count,2);assert.equal(source.needs_materialization,true);
  const page=await progress.readSignalWorkspaceEngineMaterializationCheckpointsV1({...scope,expected_coverage:source.coverage,limit:1});assert.equal(page.items.length,1);assert.equal(page.done,proposals.length===1);
  await assert.rejects(progress.readSignalWorkspaceEngineMaterializationSourceV1({...scope,workspace_id:randomUUID()}),/forbidden/u);
  async function* packets(){yield*proposals;}
  const args={...scope,expected_coverage:source.coverage,expected_catalog_profile_id:source.catalog_profile_id,proposals:packets()};
  let materialized=await progress.materializeSignalWorkspaceEngineTopicsProgressV1(args);
  assert.equal(materialized.interpreted_unit_count,proposals.length);assert.equal(materialized.interpretation_complete,proposals.length===2);
  if(proposals.length===1){
   firstTerm=materialized.mapping[0]!.term_key;firstKey=materialized.mapping[0]!.unit_key;
   // An operator edit between catalog creation and receipt persistence is a real
   // compare-and-swap failure. Recovery merges that edit into the next version.
   await updateSignalTopicStoreV1({pool:database,workspace_id:access.workspace_id,actor_user_id:access.actor_user_id,term_key:firstTerm,idempotency_key:randomUUID(),
    input:{expected_definition_revision:1,label:'Operator name preserved'}});
  }
  const makeArtifact=(value:typeof materialized)=>{const {replayed:_replayed,mapping,...metadata}=value;
   const body=JSON.stringify({...metadata,mapping}),key=`materialization-progress-${value.output_catalog_profile_id}.json`,storage_key=`workspace-engine/${access.workspace_id}/${lease.execution_id}/${key}`;
   bodies.set(storage_key,body);return{artifact_key:key,artifact_type:'engine_proposals' as const,title:'Paid checkpoint progress',storage_key,sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),media_type:'application/json',metadata};};
  if(proposals.length===1){
   await assert.rejects(progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:source.coverage,artifact:makeArtifact(materialized)}),/catalog_changed/u);
   const latest=await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope);
   materialized=await progress.materializeSignalWorkspaceEngineTopicsProgressV1({...args,expected_catalog_profile_id:latest.catalog_profile_id,proposals:packets()});
   await assert.rejects(progress.materializeSignalWorkspaceEngineTopicsProgressV1({...args,proposals:packets()}),/catalog_changed/u);
  }
  const replay=await progress.materializeSignalWorkspaceEngineTopicsProgressV1({...args,expected_catalog_profile_id:materialized.output_catalog_profile_id,proposals:packets()});assert.equal(replay.replayed,true);assert.equal(replay.output_catalog_profile_id,materialized.output_catalog_profile_id);
  const artifact=makeArtifact(materialized);
  if(proposals.length===1){
   await query('BEGIN');try{
    // Lost dispatch + changed input interest: quarantine the observed old job even
    // when its catalog profile differs, so it cannot occupy the scheduler head.
    await query("UPDATE signal_topic_classification_outbox SET status='dispatched',updated_at=clock_timestamp()-interval '181 seconds' WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id]);
    await createSignalTopicStoreV1({pool:database,...access,idempotency_key:randomUUID(),input:{label:'New input interest',definition:'A changed monitoring scope.',
     scope:'primary_brand',discovery_guidance:true,inclusion:[],exclusion:[],positive_examples:[],negative_examples:[]}});
    assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0);
    assert.deepEqual((await query("SELECT status,attempt_count,error_code FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id])).rows[0],
     {status:'dead_letter',attempt_count:8,error_code:'workspace_engine_progress_inputs_stale'});
    assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0,'quarantined stale coverage is excluded before the candidate limit');
   }finally{await query('ROLLBACK');}
   // A failed editorial run and an unrelated unknown paid call do not become
   // 'ready' or settled just because earlier validated units can be derived.
   await query('BEGIN');try{
    const configuration=lease.snapshot.interpretation_config!.call_configuration;
    const unknown=await money.reserveSignalWorkspaceEngineInterpretationV1({...scope,idempotency_key:randomUUID(),request_digest:fixtureSha('unresolved later batch'),configuration,
     reserved_micro_usd:1000,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:30_000_000,execution_token:lease.execution_token});
    const token={database,call_id:unknown.call_id,attempt_token:unknown.attempt_token};
    await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
    await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_transport_unknown'});
    await engine.failSignalWorkspaceEngineV1({database,lease,error_code:'workspace_engine_interpretation_daily_authority_expired'});
    const before=await money.loadSignalWorkspaceEngineInterpretationBudgetV1(scope);
    await progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:source.coverage,artifact});
    assert.deepEqual(await money.loadSignalWorkspaceEngineInterpretationBudgetV1(scope),before);
    const failed=(await query('SELECT status,error_code,execution_token FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0];
    assert.deepEqual(failed,{status:'failed',error_code:'workspace_engine_interpretation_daily_authority_expired',execution_token:null});
    assert.equal((await query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[unknown.call_id])).rows[0]!.call_state,'outcome_unknown');
   }finally{await query('ROLLBACK');}
   await query('BEGIN');try{
    const currentJob=`workspace-progress-${lease.execution_id}-${materialized.output_catalog_profile_id}-${source.coverage.unit_digest.slice(7)}`;
    await query("UPDATE signal_topic_classification_outbox SET status='dead_letter',attempt_count=8,worker_job_id=$2,available_at=clock_timestamp()-interval '1 second' WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id,currentJob]);
    assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0,'same coverage cannot restart an exhausted dispatch');
    const exhausted=await engine.loadSignalWorkspaceEngineStatusV1(access);
    assert.equal(exhausted.latest_run?.materialization_pending,false);assert.equal(exhausted.latest_run?.materialization_retry_available,true);
    assert.equal(exhausted.latest_run?.materialization_error_code,'workspace_engine_progress_dispatch_exhausted');
    const key=randomUUID(),retried=await progress.retrySignalWorkspaceEngineProgressV1({...scope,idempotency_key:key});
    assert.equal(retried.replayed,false);assert.equal((await progress.retrySignalWorkspaceEngineProgressV1({...scope,idempotency_key:key})).replayed,true);
    assert.equal((await engine.loadSignalWorkspaceEngineStatusV1({...access,idempotency_key:key})).request_run?.execution_id,lease.execution_id);
    await assert.rejects(progress.retrySignalWorkspaceEngineProgressV1({...scope,idempotency_key:(await query('SELECT idempotency_key FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0]!.idempotency_key}),/idempotency_conflict/u);
    await query("UPDATE signal_topic_classification_outbox SET status='dead_letter',attempt_count=8,available_at=transaction_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id]);
    await engine.failSignalWorkspaceEngineV1({database,lease,error_code:'workspace_engine_worker_failed'});
    await engine.retrySignalWorkspaceEngineV1({...scope,idempotency_key:randomUUID()});
    await query("UPDATE signal_topic_classification_outbox SET status='failed',completed_at=NULL WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id]);
    await drainSignalTopicClassificationOutboxV1({database,schedule:async()=>({requeued:0}),queue:{getJob:async()=>null,add:async()=>{}}});
    assert.equal((await query('SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0]!.status,'queued','progress dead-letter cannot fail the source engine');
   }finally{await query('ROLLBACK');}
   await assert.rejects(progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:{unit_count:2,unit_digest:fixtureSha('new coverage')},artifact}),/coverage_changed/u);
  }
  if(proposals.length===2){
   // Savepoint-backed harness fixes now() at outer BEGIN; make the already
   // scheduled delivery due at that same clock before exercising the real drainer.
   await query("UPDATE signal_topic_classification_outbox SET available_at=transaction_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id]);
   let delivered:{execution_id:string;workspace_id:string;actor_user_id:string}|null=null,jobId='';
   const drained=await drainSignalTopicClassificationOutboxV1({database,schedule:async()=>({requeued:0}),queue:{getJob:async()=>null,
    add:async(name,payload,options)=>{assert.equal(name,progress.SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1);delivered=payload as typeof scope;jobId=String(options.jobId);}}});
   assert.equal(drained.dispatched,1);assert.ok(delivered);
   await progress.heartbeatSignalWorkspaceEngineProgressDispatchV1({...scope,worker_job_id:jobId});
   await assert.rejects(progress.heartbeatSignalWorkspaceEngineProgressDispatchV1({...scope,worker_job_id:'foreign-job'}),/dispatch_lost/u);
   await query('BEGIN');try{
    await query("UPDATE signal_topic_classification_outbox SET status='dispatching',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id]);
    await progress.heartbeatSignalWorkspaceEngineProgressDispatchV1({...scope,worker_job_id:jobId});
   }finally{await query('ROLLBACK');}
   const storage={get:async({stored,destination}:{stored:{storage_key:string};destination:string})=>{const body=bodies.get(stored.storage_key);assert.notEqual(body,undefined);await writeFile(destination,body!);},
    put:async({file,sha256,size_bytes,media_type}:{file:string;sha256:string;size_bytes:number;media_type:string})=>{
     const {readFile}=await import('node:fs/promises'),{basename}=await import('node:path');const body=await readFile(file,'utf8');assert.equal(fixtureSha(body),sha256);
     const storage_key=`workspace-engine/${access.workspace_id}/${lease.execution_id}/${basename(file)}`;bodies.set(storage_key,body);return{storage_key,sha256,size_bytes,media_type};}};
   const job={id:jobId,data:delivered,updateProgress:async()=>{}};
   await signalWorkspaceEngineProgressJobV1(job,{database,storage});
   assert.equal((await signalWorkspaceEngineProgressJobV1(job,{database,storage})).replayed,true,'progress Worker replay uses the committed artifact without redoing derivation');
  }
  const persisted=await progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:source.coverage,artifact});
  assert.equal((await progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:source.coverage,artifact})).replayed,true);
  if(proposals.length===1)firstGeneration=persisted.generation_id;else lastProgressGeneration=persisted.generation_id;
  for(const patch of [{interpreted_unit_count:99},{interpretation_complete:!materialized.interpretation_complete},{expected_interpretation_units_digest:fixtureSha('forged universe')}]){
   await query('BEGIN');try{
    await assert.rejects(query(`INSERT INTO analysis_artifacts(workspace_id,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest,
     artifact_key,artifact_type,title,content,metadata,review_status,engine_execution_id)
     SELECT workspace_id,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest,artifact_key,artifact_type,title,content,
      metadata||$2::jsonb,review_status,engine_execution_id FROM analysis_artifacts WHERE id=$1::uuid`,[persisted.artifact_id,JSON.stringify(patch)]),/Progress materialization evidence is invalid/u);
   }finally{await query('ROLLBACK');}
  }
  await query('BEGIN');try{
   await assert.rejects(query(`UPDATE signal_topic_catalog_executions SET result_summary=jsonb_set(result_summary,'{materialization_progress,generation_id}',to_jsonb($2::text)) WHERE id=$1::uuid`,[lease.execution_id,randomUUID()]),/Progress checkpoint must reference/u);
  }finally{await query('ROLLBACK');}
  const generation=(await query('SELECT denominator,input_snapshot,embedding_run_id FROM signal_classification_generations WHERE id=$1::uuid',[persisted.generation_id])).rows[0]!;
  assert.equal(generation.denominator,3);assert.equal(generation.input_snapshot.source_projection.interpretation_coverage.complete,proposals.length===2);
  assert.equal(generation.input_snapshot.source_projection.interpretation_coverage.interpreted_unit_count,proposals.length);
  assert.equal((await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope)).needs_materialization,false);
  assert.equal(await progress.scheduleSignalWorkspaceEngineProgressV1({database}),0);
  const dispatch=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='engine_progress'",[lease.execution_id])).rows[0]!;
  await progress.completeSignalWorkspaceEngineProgressDispatchV1({...scope,worker_job_id:dispatch.worker_job_id});
  assert.deepEqual((await query('SELECT status,execution_token,input_snapshot,error_code FROM signal_topic_catalog_executions WHERE id=$1::uuid',[lease.execution_id])).rows[0],baseline);
  assert.deepEqual((await query('SELECT id,call_state,reserved_micro_usd,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1::uuid ORDER BY id',[lease.execution_id])).rows,budget);
  if(proposals.length===1)assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(access)).revision,0,'derivation never selects a Topic');
  const projectionDispatch=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[persisted.projection_execution_id])).rows[0]!;
  await signalWorkspaceTopicProjectionJobV1({id:projectionDispatch.worker_job_id,data:{execution_id:persisted.projection_execution_id},updateProgress:async()=>{}},{database,
   stores:{claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
    readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
    readCorrections:classification.readSignalWorkspaceClassificationCorrectionsV1,readRoots:classification.readSignalWorkspaceClassificationRootPageV1,
    readChunks:classification.readSignalWorkspaceClassificationChunkPageV1,copyRoot:classification.copySignalWorkspaceClassificationRootV1,
    commitRoot:classification.commitSignalWorkspaceClassificationRootV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1},
   storage:{put:async()=>{throw Error('projection cannot upload');},get:async({stored,destination})=>{const body=bodies.get(stored.storage_key);assert.notEqual(body,undefined);await writeFile(destination,body!);}}});
  const projected=(await projection.loadSignalWorkspaceTopicProjectionStatusV1(access)).latest_complete;
  assert.equal(projected?.generation_id,persisted.generation_id);assert.equal(projected?.is_current,true);assert.equal(projected?.denominator,3);assert.equal(projected?.processed_chunks,133);
  const grouped=(await query(`SELECT resolution_state,outcome_metadata->>'has_unresolved_topics' unresolved,count(*)::int n
   FROM signal_classification_generation_items WHERE generation_id=$1::uuid GROUP BY resolution_state,outcome_metadata->>'has_unresolved_topics'`,[persisted.generation_id])).rows;
  assert.equal(grouped.reduce((sum,row)=>sum+row.n,0),3);assert.ok(grouped.every(row=>row.unresolved===(proposals.length===1?'true':'false')));
  assert.deepEqual((await query("SELECT membership_basis,disposition,count(*)::int n FROM signal_classification_assignments WHERE generation_id=$1::uuid GROUP BY membership_basis,disposition",[persisted.generation_id])).rows,[{membership_basis:'computed_cluster',disposition:'pending',n:3}]);
  if(proposals.length===1){const topic=(await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...access})).topics.find(row=>row.definition.term_key===firstTerm)!.definition;
   await selection.selectSignalWorkspaceTopicV1({...access,term_key:firstTerm,selected:true,expected_selection_revision:0,expected_definition_revision:topic.definition_revision,
    expected_definition_digest:topic.definition_digest,generation_id:persisted.generation_id,idempotency_key:randomUUID()});
   assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(access)).items[firstTerm]?.selected,true,'a real partial membership can be selected explicitly');
  }else assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(access)).items[firstTerm]?.selected,false,'progress never restores an archived selection');
  if(proposals.length===1){
   const input=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...access});assert.equal(input.topics[0]!.definition.label,'Operator name preserved');
   await setSignalTopicLifecycleStoreV1({pool:database,...access,term_key:firstTerm,lifecycle:'archived',idempotency_key:randomUUID()});
   const edited=await deriveEditedCatalog({...checkpoint,execution_id:lease.execution_id});
   assert.equal(edited.interpreted_unit_count,1);assert.equal(edited.interpretation_complete,false);assert.equal(edited.topic_count,0);
   assert.equal((await query('SELECT count(*)::int n FROM signal_classification_assignments WHERE generation_id=$1::uuid',[edited.generation_id])).rows[0]!.n,0);
   assert.equal((await query("SELECT count(*)::int n FROM signal_classification_generation_items WHERE generation_id=$1::uuid AND outcome_metadata->>'has_unresolved_topics'='true'",[edited.generation_id])).rows[0]!.n,3);
   assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(access)).items[firstTerm]?.selected,false);
   // The editorial engine still owns its original context/interests and lease.
   assert.equal((await engine.readSignalWorkspaceEngineInterpretationContextV1({database,lease})).context.context_digest,lease.snapshot.context_digest);
  }else{
   const terms=(await query('SELECT metadata->\'topic\' topic FROM taxonomy_terms WHERE taxonomy_id=(SELECT taxonomy_id FROM signal_taxonomy_profiles WHERE id=$1::uuid)',[materialized.output_catalog_profile_id])).rows;
   const prior=terms.find(row=>row.topic.term_key===firstTerm)!.topic;assert.equal(prior.label,'Operator name preserved');assert.equal(prior.lifecycle,'archived');
   assert.equal(materialized.mapping.find(row=>row.unit_key===firstKey)?.term_key,firstTerm,'coverage growth never changes an existing Topic identity');
  }
 }});
 try{
  assert.ok(firstGeneration&&lastProgressGeneration);
  assert.equal(f.materialization.topic_count,1);assert.equal(f.materialization.mapping.length,2);
  const status=await engine.loadSignalWorkspaceEngineStatusV1(f.access);assert.equal(status.latest_run?.status,'ready');assert.equal(status.latest_run?.is_current,true);
  const requested=await projection.requestSignalWorkspaceTopicProjectionV1({...f.access,engine_execution_id:f.engine_execution_id,idempotency_key:`workspace-projection:${f.engine_execution_id}`});
  assert.equal(requested.generation_id,lastProgressGeneration,'full promotion reuses the complete progressive projection');
  const finalInput=await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access});
  const finalTopic=finalInput.topics.find(row=>row.definition.term_key!==firstTerm)!.definition;
  await updateSignalTopicStoreV1({pool:f.database,...f.access,term_key:finalTopic.term_key,idempotency_key:randomUUID(),
   input:{expected_definition_revision:finalTopic.definition_revision,label:'Ready catalog operator rename'}});
  const readyEdited=await deriveEditedCatalog({...f,execution_id:f.engine_execution_id});
  assert.equal(readyEdited.interpretation_complete,true);assert.equal(readyEdited.interpreted_unit_count,2);
  assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_complete?.materialization_progress?.artifact_id,readyEdited.artifact_id);
  const renamed=(await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access})).topics.find(row=>row.definition.term_key===finalTopic.term_key)!.definition;
  assert.equal(renamed.label,'Ready catalog operator rename');
  await selection.selectSignalWorkspaceTopicV1({...f.access,term_key:renamed.term_key,selected:true,
   expected_selection_revision:(await selection.loadSignalWorkspaceTopicSelectionV1(f.access)).revision,expected_definition_revision:renamed.definition_revision,
   expected_definition_digest:renamed.definition_digest,generation_id:readyEdited.generation_id,idempotency_key:randomUUID()});
  assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(f.access)).items[renamed.term_key]?.selected,true);
  const generations=(await f.query(`SELECT generation.id,generation.denominator,count(DISTINCT item.id)::int roots,
   count(DISTINCT assignment.id)::int assignments,count(DISTINCT assignment.id) FILTER(WHERE assignment.disposition='approved')::int approved
   FROM signal_classification_generations generation LEFT JOIN signal_classification_generation_items item ON item.generation_id=generation.id
   LEFT JOIN signal_classification_assignments assignment ON assignment.generation_id=generation.id
   WHERE generation.id=ANY($1::uuid[]) GROUP BY generation.id,generation.denominator ORDER BY generation.id`,[[firstGeneration,lastProgressGeneration]])).rows;
  const accounting=(await f.query(`SELECT count(*)::int calls,sum(COALESCE(settled_micro_usd,0))::int confirmed_micro_usd,
   sum(CASE WHEN call_state NOT IN('settled','definitely_not_sent') THEN reserved_micro_usd ELSE 0 END)::int reserved_micro_usd
   FROM engine_cost_events WHERE catalog_execution_id=$1::uuid`,[f.engine_execution_id])).rows[0];
  await writeFile(new URL('../../../.data/workspace-engine-2026-09-08/progress-postgres-receipt.json',import.meta.url),JSON.stringify({
   contract_version:'workspace-progress-local-postgres-proof-v1',sql_sha256:fixtureSha(await readFile(new URL('./0144_signal_workspace_engine_progress.sql',import.meta.url),'utf8')),
   population:{roots:3,chunks:133,expected_units:2},progression:[1,2],generations,final_mapping_digest:f.materialization.mapping_digest,
   accounting,actual_provider_calls:0,numerical_fit_calls:0,private_storage:'in-memory transport',postgres:'outer rollback; scheduled availability aligned to outer transaction clock',
   result:'passed',proved:['scheduler/outbox/Worker materialization','full corpus partial projection','explicit partial selection','unknown reservation preserved','failed engine remains failed',
    'catalog edit CAS','stable term key and archived state','derived dead-letter isolation','same-coverage retry limit','heartbeat dispatch CAS','SQL coverage and checkpoint binding','final promotion idempotency','same paid coverage after archive','ready catalog rename reprojects without mutating engine','pending before outbox','explicit delivery retry receipt and replay','stale lost-dispatch quarantine with observed job CAS']},null,2)+'\n');
 }finally{await f.cleanup();}
});
