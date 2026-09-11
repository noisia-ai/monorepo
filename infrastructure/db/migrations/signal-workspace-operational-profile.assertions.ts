import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {workspaceProjectionFixtureBodyV1} from './signal-workspace-topic-projection.fixture';
import * as fullProjection from '../signal-workspace-topic-projection';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {ensureSignalBrandContextPreparationV1,quoteSignalBrandContextPreparationV1,advanceSignalBrandContextPreparationsV1,type SignalBrandContextPreparationRuntimeV1} from '../signal-brand-context-preparation';
import {prepareSignalSemanticContextProposalInputV1,processSignalSemanticContextProposalRunV1} from '../signal-semantic-context-proposal';
import {loadSignalWorkspaceTopicPrototypesV1} from '../signal-workspace-topic-prototypes-management';
import {BRAND_CONTEXT_SYNTHETIC_INTAKE_V1,BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1,createBrandContextSyntheticSemanticProviderV1,createBrandContextSyntheticVoyageProviderV1,executeBrandContextSyntheticPrototypeRunV1} from './signal-brand-context.synthetic.fixture';
import type {BrandContextSyntheticSaveBindingsV1} from './signal-brand-context.integration.assertions';
import {syntheticClientWorkspaceFixtureV1} from './signal-client-workspace-entry.synthetic.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import {loadSignalTopicCatalogStoreV1,updateSignalTopicStoreV1,setSignalTopicLifecycleStoreV1} from '../signal-topic-catalog';
import * as engine from '../signal-workspace-engine';
import * as numericEngine from '../signal-workspace-engine-incremental';
import * as selection from '../signal-workspace-topic-selection';
import {loadSignalWorkspaceTopicsOverviewV1} from '../signal-workspace-topics-serving';
import * as projection from '../signal-workspace-incremental-projection';
import {loadSignalWorkspaceIncrementalEditorialAdmissionV1} from '../signal-workspace-incremental-editorial';
import * as classification from '../signal-workspace-classification';
import {signalWorkspaceIncrementalDerivationJobV1} from '../../../services/workers/src/workers/signal-workspace-incremental-derivation';
import {signalWorkspaceIncrementalProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-incremental-projection';

async function completeSyntheticRecomputeV1(args:{database:Pool;scoped:PoolClient;query:PoolClient['query'];
 scope:{database:Pool;workspace_id:string;actor_user_id:string};embedding_run_id:string;clusterIds:readonly[string,string];
 interpretation_definitions?:Readonly<Record<string,string>>;retire_materialized?:boolean}){
 const {database,scoped,query,scope,embedding_run_id,clusterIds}=args;
 const full=await workspaceProjectionFixtureBodyV1({database,scoped,query,workspace_id:scope.workspace_id,actor_user_id:scope.actor_user_id,
  embedding_run_id,cleanup:async()=>{}},{preserve_catalog:true,cluster_ids:clusterIds,interpretation_definitions:args.interpretation_definitions,
  onMaterialized:async profile=>{if(args.retire_materialized)await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE id=$1",[profile]);}});
 const next=await fullProjection.requestSignalWorkspaceTopicProjectionV1({...scope,engine_execution_id:full.engine_execution_id,idempotency_key:`workspace-projection:${full.engine_execution_id}`});
 const storage={get:async({stored,destination}:{stored:{storage_key:string};destination:string})=>{
  const body=full.bodies.get(stored.storage_key);assert.ok(body);await writeFile(destination,body);},
  put:async({execution_id,file,sha256,size_bytes,media_type}:{execution_id:string;file:string;sha256:string;size_bytes:number;media_type:string})=>{
   const storage_key=`workspace-engine/${scope.workspace_id}/${execution_id}/${basename(file)}`;full.bodies.set(storage_key,await readFile(file,'utf8'));return{storage_key,sha256,size_bytes,media_type};}};
 await signalWorkspaceTopicProjectionJobV1({id:next.worker_job_id,data:{execution_id:next.execution_id},updateProgress:async()=>{}},{database,storage,stores:{claim:fullProjection.claimSignalWorkspaceTopicProjectionV1,heartbeat:fullProjection.heartbeatSignalWorkspaceTopicProjectionV1,
  readTopics:fullProjection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:fullProjection.readSignalWorkspaceTopicProjectionProposalsV1,
  readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,
  commitPage:classification.commitSignalWorkspaceClassificationPageV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1}});
 return{full,next};
}

/** One new composed gate. Real creation/publication/receipts and SQL guards;
 * invented text, vectors and numerical artifacts; no sockets or providers here. */
export async function assertWorkspaceOperationalProfileJourneyV1(args:{database:Pool;scoped:PoolClient;runtime:SignalBrandContextPreparationRuntimeV1;saves:BrandContextSyntheticSaveBindingsV1}){
 const {database,scoped,runtime,saves}=args,organization_id=randomUUID(),actor_user_id=randomUUID();
 const query:PoolClient['query']=scoped.query.bind(scoped);
 await query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Synthetic operational profile organization','active')",[organization_id,`operational-${organization_id}`]);
 await query("INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES($1,$2,'Synthetic operational actor','noisia_internal','noisia_admin',$3,'active')",[actor_user_id,`${actor_user_id}@example.test`,organization_id]);
 const created=await saves.createBrand({...args,actor_user_id,organization_id,intake:{...BRAND_CONTEXT_SYNTHETIC_INTAKE_V1,slug:`operational-${randomUUID()}`}});
 const scope={database,workspace_id:created.workspace_id,actor_user_id};
 await saves.saveKnowledge({...args,...created,actor_user_id,organization_id,title:'Synthetic operational knowledge',raw_text:BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1,idempotency_key:randomUUID()});
 const quote=quoteSignalBrandContextPreparationV1({actor_user_id,runtime});
 const prepared=await ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:randomUUID(),primary_locale:'es-MX',admission:{quote_digest:quote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
 const advance=()=>advanceSignalBrandContextPreparationsV1({...scope,runtime,limit:10});
 await advance();
 const semanticInput=await prepareSignalSemanticContextProposalInputV1({queryable:database,workspace:{id:scope.workspace_id,organization_id,brand_id:created.brand_id},generation_key:prepared.generation_key});
 const semantic=createBrandContextSyntheticSemanticProviderV1({input:semanticInput.input,prompt:semanticInput.prompt,model:runtime.semantic.model,revision:'initial'});
 const semanticRun=(await query('SELECT id FROM signal_semantic_context_proposal_runs WHERE generation_id=$1::uuid',[prepared.generation_id])).rows[0]!;
 assert.equal((await processSignalSemanticContextProposalRunV1({pool:database,run_id:semanticRun.id,provider:semantic.provider})).status,'completed');
 await advance();
 const prototypes=await loadSignalWorkspaceTopicPrototypesV1(scope);assert.ok(prototypes.active_run);
 const voyage=createBrandContextSyntheticVoyageProviderV1();
 await executeBrandContextSyntheticPrototypeRunV1({database,run_id:prototypes.active_run.id,provider:voyage.provider});await advance();
 const identity={...created,organization_id,actor_user_id};
 const clusterIds=[randomUUID(),randomUUID()] as const,done=new Error('operational profile fixture complete');
 let completed=false,workingB='',operationalA='',topicKey='';
 const updatedInterpretations:Record<string,string>={};
 const totals=async()=>(await query(`SELECT (SELECT count(*)::int FROM signal_topic_catalog_executions WHERE workspace_id=$1) executions,
  (SELECT count(*)::int FROM signal_topic_classification_outbox WHERE workspace_id=$1) outbox,
  (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM engine_cost_events c WHERE workspace_id=$1) costs`,[scope.workspace_id])).rows[0];
 try{await syntheticClientWorkspaceFixtureV1({database,scoped,query,cleanup:async()=>{}},{identity,projection:{cluster_ids:clusterIds,
  model_configuration:{fixture:true,versions:{python:'synthetic-operational-profile'}},onCheckpoint:async checkpoint=>{
   const numeric=await incrementalProjectionFixtureV1(checkpoint,clusterIds,{migrations_applied:true,onParentMaterialized:async profile=>{
    await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE id=$1",[profile]);
   },onParentProjection:async parent=>{
    operationalA=parent.catalog_profile_id;
    await query("UPDATE signal_taxonomy_profiles SET status='draft' WHERE id=$1",[operationalA]);
    const input=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...scope,taxonomy_profile_id:operationalA});
    const topic=input.topics[0]!.definition;topicKey=topic.term_key;
    await selection.selectSignalWorkspaceTopicV1({...scope,term_key:topicKey,selected:true,idempotency_key:randomUUID(),expected_selection_revision:0,
     expected_definition_revision:topic.definition_revision,expected_definition_digest:topic.definition_digest,generation_id:parent.generation_id});
    const before=await totals(),key=randomUUID();
    const changed=await updateSignalTopicStoreV1({pool:database,...scope,term_key:topicKey,idempotency_key:key,input:{expected_definition_revision:topic.definition_revision,
     expected_definition_digest:topic.definition_digest,definition:topic.definition+' Synthetic pending definition.'}});
    workingB=changed.profile!.id;assert.notEqual(workingB,operationalA);
    await query("UPDATE signal_taxonomy_profiles SET status='retired' WHERE id=$1",[operationalA]);
    assert.deepEqual(await totals(),before,'editing a draft creates no engine, outbox or cost');
    assert.equal((await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:scope.workspace_id})).profile?.id,workingB);
    assert.equal((await engine.loadSignalWorkspaceEngineInputIdentityV1({queryable:database,...scope,taxonomy_profile_id:checkpoint.lease.snapshot.taxonomy_profile_id})).catalog_digest,checkpoint.lease.snapshot.catalog_digest);
    assert.equal((await query('SELECT signal_workspace_incremental_operational_profile_v1($1) profile',[checkpoint.lease.execution_id])).rows[0]?.profile,operationalA);
    const served=await loadSignalWorkspaceTopicsOverviewV1(scope);assert.ok(served);
    assert.equal(served.generation_id,parent.generation_id);assert.equal(served.is_current,true);
    const servedTopic=served.terms.find(row=>row.term_key===topicKey);assert.ok(servedTopic);
    assert.equal(servedTopic.definition,topic.definition);assert.equal(servedTopic.label,topic.label);
    // Saving an archive/restore changes only the working definition. The actual
    // application of an archive is a separate, completed projection below.
    await query('BEGIN');try{
     const stateBefore=await selection.loadSignalWorkspaceTopicSelectionV1(scope);
     const topicB=changed.topics.find(row=>row.term_key===topicKey)!;
     const archiveArgs={pool:database,...scope,term_key:topicKey,lifecycle:'archived' as const,idempotency_key:randomUUID(),
      expected_definition_revision:topicB.definition_revision,expected_definition_digest:topicB.definition_digest};
     const archived=await setSignalTopicLifecycleStoreV1(archiveArgs),archivedTopic=archived.topics.find(row=>row.term_key===topicKey)!;
     assert.equal(archivedTopic.lifecycle,'archived');
     const preserved=await selection.loadSignalWorkspaceTopicSelectionV1(scope);
     assert.equal(preserved.revision,stateBefore.revision);assert.deepEqual(preserved.items,stateBefore.items,'pending archive preserves A selection');
     const archiveView=await loadSignalWorkspaceTopicsOverviewV1(scope);assert.equal(archiveView?.is_current,true);assert.equal(archiveView?.generation_id,parent.generation_id);
     assert.equal(archiveView?.terms.find(row=>row.term_key===topicKey)?.definition,topic.definition);
     assert.equal((await setSignalTopicLifecycleStoreV1(archiveArgs)).profile?.id,archived.profile?.id,'archive exact replay');
     assert.deepEqual(await totals(),before,'working archive and replay create no execution, outbox or cost');
     await assert.rejects(setSignalTopicLifecycleStoreV1({...archiveArgs,lifecycle:'draft',idempotency_key:randomUUID()}),{code:'topic_revision_conflict'});
     // Apply the archived catalog through the real full-fit/projection stores and
     // fake numerical/provider receipts, never by marking a generation ready.
     const applied=await completeSyntheticRecomputeV1({database,scoped,query,scope,embedding_run_id:checkpoint.lease.snapshot.embedding_run_id,clusterIds});
     const tombstone=await selection.loadSignalWorkspaceTopicSelectionV1(scope);
     assert.equal(tombstone.revision,stateBefore.revision+1);assert.equal(tombstone.items[topicKey]?.selected,false);
     const appliedView=await loadSignalWorkspaceTopicsOverviewV1(scope);assert.equal(appliedView?.generation_id,applied.next.generation_id);
     assert.equal(appliedView?.is_current,true);assert.equal(appliedView?.terms.some(row=>row.term_key===topicKey),false);
     await fullProjection.requestSignalWorkspaceTopicProjectionV1({...scope,engine_execution_id:applied.full.engine_execution_id,idempotency_key:`workspace-projection:${applied.full.engine_execution_id}`});
     assert.equal(await fullProjection.claimSignalWorkspaceTopicProjectionV1({database,execution_id:applied.next.execution_id,worker_job_id:applied.next.worker_job_id}),null);
     assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(scope)).revision,tombstone.revision,'ready replay clears only once');
     const current=(await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:scope.workspace_id})).topics.find(row=>row.term_key===topicKey)!;
     const restoreArgs={pool:database,...scope,term_key:topicKey,lifecycle:'draft' as const,idempotency_key:randomUUID(),
      expected_definition_revision:current.definition_revision,expected_definition_digest:current.definition_digest};
     const restored=await setSignalTopicLifecycleStoreV1(restoreArgs),restoredTopic=restored.topics.find(row=>row.term_key===topicKey)!;
     assert.equal(restoredTopic.lifecycle,'draft');assert.equal((await setSignalTopicLifecycleStoreV1(restoreArgs)).profile?.id,restored.profile?.id);
     await assert.rejects(updateSignalTopicStoreV1({pool:database,...scope,term_key:topicKey,idempotency_key:randomUUID(),input:{
      expected_definition_revision:archivedTopic.definition_revision,expected_definition_digest:archivedTopic.definition_digest,definition:'Stale restore must not change this definition.'}}),{code:'topic_revision_conflict'});
     const meaning=await updateSignalTopicStoreV1({pool:database,...scope,term_key:topicKey,idempotency_key:randomUUID(),input:{
      expected_definition_revision:restoredTopic.definition_revision,expected_definition_digest:restoredTopic.definition_digest,definition:restoredTopic.definition+' Restored working revision.'}});
     const afterRestore=await selection.loadSignalWorkspaceTopicSelectionV1(scope);assert.deepEqual(afterRestore.items,tombstone.items);assert.equal(afterRestore.revision,tombstone.revision);
     assert.equal((await loadSignalWorkspaceTopicsOverviewV1(scope))?.terms.some(row=>row.term_key===topicKey),false,'restore never resurrects a prior opt-in');
     const meaningTopic=meaning.topics.find(row=>row.term_key===topicKey)!;assert.ok(meaningTopic.source);
     const restoredApplied=await completeSyntheticRecomputeV1({database,scoped,query,scope,embedding_run_id:checkpoint.lease.snapshot.embedding_run_id,clusterIds,
      interpretation_definitions:{[meaningTopic.source.candidate_key]:meaningTopic.definition}});
     assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(scope)).items[topicKey]?.selected,false,'computing a restored topic still requires explicit selection');
     const restoredInput=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...scope,taxonomy_profile_id:restoredApplied.full.materialization.output_catalog_profile_id});
     const restoredDefinition=restoredInput.topics.find(row=>row.definition.term_key===topicKey)!.definition;
     await selection.selectSignalWorkspaceTopicV1({...scope,term_key:topicKey,selected:true,idempotency_key:randomUUID(),expected_selection_revision:tombstone.revision,
      expected_definition_revision:restoredDefinition.definition_revision,expected_definition_digest:restoredDefinition.definition_digest,generation_id:restoredApplied.next.generation_id});
     const explicitlySelected=await selection.loadSignalWorkspaceTopicSelectionV1(scope);
     // Invoke the actual completion trigger with a copy of the older execution;
     // real generations stay immutable. This is a controlled stale-delivery probe,
     // not a claim of a simultaneous two-connection race.
     await query('CREATE TEMP TABLE operational_late_ready_probe (LIKE signal_topic_catalog_executions INCLUDING DEFAULTS) ON COMMIT DROP');
     await query('INSERT INTO operational_late_ready_probe SELECT * FROM signal_topic_catalog_executions WHERE id=$1',[applied.next.execution_id]);
     await query("UPDATE operational_late_ready_probe SET status='running'");
     await query('CREATE TRIGGER operational_late_ready AFTER UPDATE OF status ON operational_late_ready_probe FOR EACH ROW EXECUTE FUNCTION clear_applied_archived_signal_topic_selections_v1()');
     await query("UPDATE operational_late_ready_probe SET status='ready'");
     const afterLate=await selection.loadSignalWorkspaceTopicSelectionV1(scope);assert.deepEqual(afterLate.items,explicitlySelected.items);assert.equal(afterLate.revision,explicitlySelected.revision);

    }finally{await query('ROLLBACK');}
    assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(scope)).items[topicKey]?.selected,true,'the isolated archive branch restores its test baseline');
    const deselected=await selection.selectSignalWorkspaceTopicV1({...scope,term_key:topicKey,selected:false,idempotency_key:randomUUID(),
     expected_selection_revision:served.selection_revision,expected_definition_revision:topic.definition_revision,
     expected_definition_digest:topic.definition_digest,generation_id:parent.generation_id});
    assert.equal(deselected.selection.selected,false);
    await engine.heartbeatSignalWorkspaceEngineV1({database,lease:checkpoint.lease,phase:'interpreting'});
    await query('BEGIN');
    try{
     const currentB=await engine.loadSignalWorkspaceEnginePreflightV1(scope);
     const branchB=await engine.beginSignalWorkspaceEngineV1({...scope,idempotency_key:randomUUID(),embedding_run_id:checkpoint.lease.snapshot.embedding_run_id,
      expected_context_digest:currentB.expected_context_digest,expected_catalog_digest:currentB.expected_catalog_digest,claude_cap_micro_usd:0,engine_config:checkpoint.lease.snapshot.engine_config});
     assert.equal((await query('SELECT taxonomy_profile_id FROM signal_topic_catalog_executions WHERE id=$1',[branchB.execution_id])).rows[0]?.taxonomy_profile_id,workingB);
     const historical=await numericEngine.beginSignalWorkspaceIncrementalEngineV1({...scope,idempotency_key:randomUUID(),parent_execution_id:checkpoint.lease.execution_id,
      embedding_run_id:checkpoint.lease.snapshot.embedding_run_id,expected_context_digest:checkpoint.lease.snapshot.context_digest,
      expected_catalog_digest:checkpoint.lease.snapshot.catalog_digest,engine_config:checkpoint.lease.snapshot.engine_config,close_requested:false});
     assert.equal((await query('SELECT taxonomy_profile_id FROM signal_topic_catalog_executions WHERE id=$1',[historical.execution_id])).rows[0]?.taxonomy_profile_id,checkpoint.lease.snapshot.taxonomy_profile_id);
    }finally{await query('ROLLBACK');}
    const edited=changed.topics.find(row=>row.term_key===topicKey)!;assert.ok(edited.source);
    updatedInterpretations[edited.source.candidate_key]=edited.definition;
    await assert.rejects(selection.selectSignalWorkspaceTopicV1({...scope,term_key:topicKey,selected:true,idempotency_key:randomUUID(),expected_selection_revision:deselected.revision,
     expected_definition_revision:edited.definition_revision,expected_definition_digest:edited.definition_digest,generation_id:parent.generation_id}),{code:'workspace_topic_selection_definition_changed'});
   }});
   assert.equal(numeric.lease.snapshot.taxonomy_profile_id,checkpoint.lease.snapshot.taxonomy_profile_id);
   assert.notEqual(numeric.lease.snapshot.taxonomy_profile_id,workingB);
   assert.equal(await projection.scheduleSignalWorkspaceIncrementalProjectionsV1({database}),1);
   const dispatch=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1 AND dispatch_kind='incremental_projection'",[numeric.lease.execution_id])).rows[0]!;
   await query("UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp() WHERE execution_id=$1 AND dispatch_kind='incremental_projection'",[numeric.lease.execution_id]);
   const source=await projection.readSignalWorkspaceIncrementalProjectionDerivationV1({...scope,execution_id:numeric.lease.execution_id,worker_job_id:dispatch.worker_job_id});
   assert.equal(source.catalog_profile_id,operationalA);
   await signalWorkspaceIncrementalDerivationJobV1({id:dispatch.worker_job_id,data:{execution_id:numeric.lease.execution_id,workspace_id:scope.workspace_id,actor_user_id},updateProgress:async()=>{}},{database,storage:numeric.storage});
   const projected=(await query("SELECT id FROM signal_topic_catalog_executions WHERE source_execution_id=$1 AND input_contract='workspace-topic-classification-v1'",[numeric.lease.execution_id])).rows[0];
   // The derivation's queued classification references the numeric owner via its sealed source.
   const execution=projected??(await query("SELECT id FROM signal_topic_catalog_executions WHERE input_snapshot->'source_projection'->>'engine_execution_id'=$1 AND input_contract='workspace-topic-classification-v1' ORDER BY created_at DESC,id DESC LIMIT 1",[numeric.lease.execution_id])).rows[0];assert.ok(execution);
   const job=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1 AND dispatch_kind='execution'",[execution.id])).rows[0]!;
   await signalWorkspaceIncrementalProjectionJobV1({id:job.worker_job_id,data:{execution_id:execution.id},updateProgress:async()=>{}},{database,storage:numeric.storage});
   assert.equal((await query('SELECT status,taxonomy_profile_id FROM signal_topic_catalog_executions WHERE id=$1',[execution.id])).rows[0]?.status,'ready');
   assert.equal((await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:scope.workspace_id})).profile?.id,workingB);
   const editorial=await loadSignalWorkspaceIncrementalEditorialAdmissionV1({...scope,numeric_execution_id:numeric.lease.execution_id});
   assert.equal(editorial.is_current,true,'pending working B does not invalidate editorial source A');
   assert.equal((await query('SELECT signal_workspace_incremental_operational_profile_v1($1) profile',[randomUUID()])).rows[0]?.profile,null,'unknown execution cannot use working B');
   const {full,next}=await completeSyntheticRecomputeV1({database,scoped,query,scope,embedding_run_id:checkpoint.lease.snapshot.embedding_run_id,
    clusterIds,interpretation_definitions:updatedInterpretations,retire_materialized:true});
   assert.equal((await query('SELECT taxonomy_profile_id FROM signal_topic_catalog_executions WHERE id=$1',[full.engine_execution_id])).rows[0]?.taxonomy_profile_id,workingB);
   const ready=await classification.loadSignalWorkspaceClassificationInputV1({queryable:database,...scope,taxonomy_profile_id:full.materialization.output_catalog_profile_id});
   const readyTopic=ready.topics.find(row=>row.definition.term_key===topicKey)!.definition;
   await selection.selectSignalWorkspaceTopicV1({...scope,term_key:topicKey,selected:true,idempotency_key:randomUUID(),
    expected_selection_revision:(await selection.loadSignalWorkspaceTopicSelectionV1(scope)).revision,
    expected_definition_revision:readyTopic.definition_revision,expected_definition_digest:readyTopic.definition_digest,generation_id:next.generation_id});
   assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(scope)).items[topicKey]?.generation_id,next.generation_id);
   assert.equal(semantic.calls.length,1,'Topic work must not resend semantic preparation');
   completed=true;throw done;
  }}});}catch(error){if(error!==done)throw error;}
 assert.equal(completed,true);
 return{brand_context_published:true,working_edit_without_side_effects:true,inflight_A_usable:true,incremental_uses_A:true,working_B_preserved:true,
  late_archived_generation_preserves_new_selection:true,working_archive_preserves_A_selection:true,applied_archive_clears_once:true,restore_does_not_resurrect_selection:true,archive_restore_meaning_cas:true,editorial_A_current_while_B_pending:true,missing_operational_profile_no_fallback:true,serving_A_current_while_B_pending:true,deselect_A_while_B_pending:true,retired_materialization_checkpoint_valid:true,explicit_recompute_admitted_B:true,recompute_B_completed:true,semantic_simulated_calls:semantic.calls.length,real_provider_transports:0};
}
