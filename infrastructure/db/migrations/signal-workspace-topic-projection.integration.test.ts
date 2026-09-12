import {currentTopicDefinitionCasV1} from './signal-topic-definition-cas.fixture';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {updateSignalTopicStoreV1,setSignalTopicLifecycleStoreV1} from '../signal-topic-catalog';
import {workspaceProjectionFixtureV1,fixtureSha} from './signal-workspace-topic-projection.fixture';
import * as projection from '../signal-workspace-topic-projection';
import * as classification from '../signal-workspace-classification';
import * as selection from '../signal-workspace-topic-selection';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';
import {drainSignalTopicClassificationOutboxV1} from '../../../services/workers/src/workers/signal-topic-classification-outbox';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
const pageMigrations=['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql',
 '0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'];
test('native projection retains all chunks, pending multilabel membership, durable dispatch/replay and explicit CAS selection', {skip:!enabled,timeout:90_000},async()=>{
 const f=await workspaceProjectionFixtureV1({migrations:pageMigrations});try{
  const start={...f.access,engine_execution_id:f.engine_execution_id,idempotency_key:`workspace-projection:${f.engine_execution_id}`};
  let request=await projection.requestSignalWorkspaceTopicProjectionV1(start);
  assert.equal((await projection.requestSignalWorkspaceTopicProjectionV1(start)).replayed,true);
  const queued=(await f.query('SELECT execution_id,worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid',[request.execution_id])).rows;
  assert.equal(queued.length,1);
  let dispatched:string|null=null;
  const drained=await drainSignalTopicClassificationOutboxV1({database:f.database,queue:{getJob:async()=>null,add:async(name)=>{dispatched=name;}},schedule:async()=>({requeued:0})});
  assert.ok(drained.dispatched>=1);assert.equal(dispatched,projection.SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1);
  await f.query("UPDATE signal_topic_classification_outbox SET updated_at=clock_timestamp()-interval '31 seconds' WHERE execution_id=$1::uuid",[request.execution_id]);
  assert.equal((await projection.scheduleSignalWorkspaceTopicProjectionsV1({database:f.database})).requeued,1);
  assert.equal((await projection.requestSignalWorkspaceTopicProjectionV1(start)).worker_job_id,request.worker_job_id,'lost queued Redis job reuses its durable ID');
  await f.query('BEGIN');try{
   await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[f.workspace_id]);
   assert.equal(await projection.claimSignalWorkspaceTopicProjectionV1({database:f.database,execution_id:request.execution_id,worker_job_id:request.worker_job_id}),null);
   assert.equal((await f.query('SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid',[request.execution_id])).rows[0]!.status,'failed');
   assert.equal((await f.query('SELECT status FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid',[request.execution_id])).rows[0]!.status,'completed');
  }finally{await f.query('ROLLBACK');}
  assert.ok(await projection.claimSignalWorkspaceTopicProjectionV1({database:f.database,execution_id:request.execution_id,worker_job_id:request.worker_job_id}));
  await f.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[request.execution_id]);
  assert.equal((await projection.scheduleSignalWorkspaceTopicProjectionsV1({database:f.database})).requeued,1);
  const previousJob=request.worker_job_id;request=await projection.requestSignalWorkspaceTopicProjectionV1(start);assert.notEqual(request.worker_job_id,previousJob,'expired running lease receives a new delivery generation');
  let guarded=false;
  const stores={claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
   readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
   readPage:classification.readSignalWorkspaceClassificationPageV1,
   readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,commitPage:async(args:Parameters<typeof classification.commitSignalWorkspaceClassificationPageV1>[0])=>{
    if(!guarded&&args.outcomes[0]?.decisions.length){guarded=true;const changed=structuredClone(args.outcomes);changed[0]!.decisions[0]!.membership_metadata!.unit_keys=['open:wrong_cluster'];
     await assert.rejects(classification.commitSignalWorkspaceClassificationPageV1({...args,outcomes:changed}),/workspace_projection_membership_invalid/u);}
    return classification.commitSignalWorkspaceClassificationPageV1(args);},finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
  const options={database:f.database,stores,storage:{put:async()=>{throw Error('unexpected storage upload');},get:async(args:{stored:{storage_key:string};destination:string})=>{
   const body=f.bodies.get(args.stored.storage_key);assert.notEqual(body,undefined);await writeFile(args.destination,body!);}}};
  const job={id:request.worker_job_id,data:{execution_id:request.execution_id},updateProgress:async()=>{}};
  await signalWorkspaceTopicProjectionJobV1(job,options);
  assert.deepEqual(await signalWorkspaceTopicProjectionJobV1(job,options),{execution_id:request.execution_id,replayed:true});
  const status=await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access);
  assert.equal(status.latest_complete?.generation_id,request.generation_id);assert.equal(status.latest_complete?.is_current,true);
  assert.equal(status.latest_complete?.processed_roots,3);assert.equal(status.latest_complete?.processed_chunks,133);
  const rows=(await f.query(`SELECT term.term_key,assignment.canonical_root_id root_id,assignment.membership_basis,assignment.disposition
   FROM signal_classification_assignments assignment JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id WHERE generation_id=$1::uuid`,[request.generation_id])).rows;
  assert.equal(rows.length,6);assert.ok(rows.every(row=>row.membership_basis==='computed_cluster'&&row.disposition==='pending'));
  const input=await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access});const topic=input.topics[0]!.definition;
  await f.query('BEGIN');
  const select={...f.access,term_key:topic.term_key,selected:true,expected_selection_revision:0,expected_definition_revision:topic.definition_revision,
   expected_definition_digest:topic.definition_digest,generation_id:request.generation_id,idempotency_key:randomUUID()};
  const selected=await selection.selectSignalWorkspaceTopicV1(select);assert.equal(selected.revision,1);assert.equal(selected.selection.selected,true);
  assert.equal((await selection.selectSignalWorkspaceTopicV1(select)).replayed,true);
  assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1({...f.access,idempotency_key:select.idempotency_key})).request_receipt?.operation_id,selected.operation_id);
  await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,idempotency_key:randomUUID()}),/revision_conflict/u);
  await f.query('BEGIN');try{
   await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[f.workspace_id]);
   assert.equal((await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access)).latest_complete?.is_current,false);
   await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,expected_selection_revision:1,idempotency_key:randomUUID()}),/projection_stale/u);
   const unselected=await selection.selectSignalWorkspaceTopicV1({...select,selected:false,expected_selection_revision:1,idempotency_key:randomUUID()});assert.equal(unselected.selection.selected,false);
  }finally{await f.query('ROLLBACK');}
  await f.query('ROLLBACK');
  await f.query('BEGIN');
  const {assertSignalWorkspaceTopicsServingV1}=await import('../signal-workspace-topics-serving.assertions');
  await assertSignalWorkspaceTopicsServingV1({...f.access,generation_id:request.generation_id,expected_memberships:input.topics.map(item=>({term_key:item.definition.term_key,root_ids:f.roots.map(row=>row.root_id)}))});
  await f.query('ROLLBACK');
  // A name-only catalog copy preserves semantic bindings and selection.
  await selection.selectSignalWorkspaceTopicV1(select);
  const next=await projection.requestSignalWorkspaceTopicProjectionV1({...start,idempotency_key:randomUUID()});
  await signalWorkspaceTopicProjectionJobV1({id:next.worker_job_id,data:{execution_id:next.execution_id},updateProgress:async()=>{}},options);
  assert.equal((await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access)).latest_complete?.generation_id,next.generation_id);
  assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(f.access)).items[topic.term_key]?.generation_id,request.generation_id,'selection retains its original receipt');
  const {loadSignalWorkspaceTopicsOverviewV1}=await import('../signal-workspace-topics-serving');
  assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.terms.find(row=>row.term_key===topic.term_key)?.mention_count,3,'new compatible generation refreshes the existing selection');
  const renamed=await updateSignalTopicStoreV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key,idempotency_key:randomUUID(),
   input:{...(await currentTopicDefinitionCasV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key})),label:'Renamed locally'}});
  assert.equal((await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access)).latest_complete?.is_current,true);
  const renamedTopic=renamed.topics.find(row=>row.term_key===topic.term_key)!;
  assert.equal(renamedTopic.definition_digest,topic.definition_digest);
  await selection.selectSignalWorkspaceTopicV1({...select,generation_id:next.generation_id,expected_selection_revision:1,
   expected_definition_revision:renamedTopic.definition_revision,expected_definition_digest:renamedTopic.definition_digest,idempotency_key:randomUUID()});
  assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.terms.find(row=>row.term_key===topic.term_key)?.label,'Renamed locally');
  await setSignalTopicLifecycleStoreV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key,lifecycle:'archived',idempotency_key:randomUUID(),...(await currentTopicDefinitionCasV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key}))});
  const archived=await selection.loadSignalWorkspaceTopicSelectionV1(f.access);assert.equal(archived.items[topic.term_key]?.selected,false);
  await setSignalTopicLifecycleStoreV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key,lifecycle:'draft',idempotency_key:randomUUID(),...(await currentTopicDefinitionCasV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,term_key:topic.term_key}))});
  assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1(f.access)).items[topic.term_key]?.selected,false);
 }finally{await f.cleanup();}
});

test('zero-group analysis projects complete abstention without a fake Topic or model', {skip:!enabled,timeout:90_000},async()=>{
 const f=await workspaceProjectionFixtureV1({empty:true,migrations:pageMigrations});try{
  const request=await projection.requestSignalWorkspaceTopicProjectionV1({...f.access,engine_execution_id:f.engine_execution_id,idempotency_key:`workspace-projection:${f.engine_execution_id}`});
  const stores={claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
   readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
   readPage:classification.readSignalWorkspaceClassificationPageV1,
   readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,commitPage:classification.commitSignalWorkspaceClassificationPageV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
  await signalWorkspaceTopicProjectionJobV1({id:request.worker_job_id,data:{execution_id:request.execution_id},updateProgress:async()=>{}},{database:f.database,stores,
   storage:{put:async()=>{throw Error('unexpected storage upload');},get:async(args:{stored:{storage_key:string};destination:string})=>{
    const body=f.bodies.get(args.stored.storage_key);assert.notEqual(body,undefined);await writeFile(args.destination,body!);}}});
  const status=(await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access)).latest_complete;
  assert.equal(status?.is_current,true);assert.equal(status?.denominator,3);assert.equal(status?.processed_roots,3);assert.equal(status?.processed_chunks,133);assert.equal(status?.model_version_id,null);
  assert.deepEqual((await f.query('SELECT resolution_state,count(*)::int n FROM signal_classification_generation_items WHERE generation_id=$1::uuid GROUP BY resolution_state',[request.generation_id])).rows,[{resolution_state:'abstained',n:3}]);
  assert.equal((await f.query('SELECT 1 FROM signal_classification_assignments WHERE generation_id=$1::uuid',[request.generation_id])).rows.length,0);
  assert.equal((await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access})).topics.length,0);
 }finally{await f.cleanup();}
});

test('projection pages preserve a human correction, cross a 128-chunk boundary and finalize exact root-writer receipts', {skip:!enabled,timeout:90_000},async()=>{
 const f=await workspaceProjectionFixtureV1({migrations:pageMigrations});try{
  const first=await projection.requestSignalWorkspaceTopicProjectionV1({...f.access,engine_execution_id:f.engine_execution_id,idempotency_key:`workspace-projection:${f.engine_execution_id}`});
  const claimed=await projection.claimSignalWorkspaceTopicProjectionV1({database:f.database,execution_id:first.execution_id,worker_job_id:first.worker_job_id});assert.ok(claimed);
  const initial=await classification.readSignalWorkspaceClassificationPageV1({database:f.database,lease:claimed.lease});
  assert.equal(initial.items.length,3);assert.ok(initial.items.some(item=>item.root.expected_chunks>128));
  const root=initial.items[0]!.root,topic=(await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access})).topics[0]!.definition,operationId=randomUUID();
  await f.query(`INSERT INTO signal_topic_membership_operations(id,workspace_id,actor_user_id,execution_id,term_key,canonical_root_id,disposition,
   definition_revision,idempotency_key,request_digest,origin_input_contract,root_fingerprint,definition_digest,context_digest)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,'belongs',$7,$1,$8,'workspace-topic-classification-v1',$9,$10,$11)`,
  [operationId,f.workspace_id,f.actor_user_id,first.execution_id,topic.term_key,root.root_id,topic.definition_revision,fixtureSha(operationId),root.fingerprint,topic.definition_digest,claimed.lease.identity.context_digest]);
  await f.query(`INSERT INTO signal_topic_membership_overrides(workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,
   origin_input_contract,root_fingerprint,definition_digest,context_digest,correction_operation_id)
   SELECT workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,origin_input_contract,root_fingerprint,
    definition_digest,context_digest,id FROM signal_topic_membership_operations WHERE id=$1::uuid`,[operationId]);
  await classification.failSignalWorkspaceClassificationV1({database:f.database,lease:claimed.lease,error_code:'workspace_classification_worker_failed'});
  const request=await projection.requestSignalWorkspaceTopicProjectionV1({...f.access,engine_execution_id:f.engine_execution_id,idempotency_key:randomUUID()});
  let pages=0,chunkPages=0,checked=false;
  const normalized=async()=> (await f.query(`SELECT item.canonical_root_id,item.item_digest,item.outcome_metadata,
   (SELECT jsonb_agg(to_jsonb(assignment)-ARRAY['id','generation_item_id','operation_id','created_at'] ORDER BY taxonomy_term_id)
    FROM signal_classification_assignments assignment WHERE assignment.generation_item_id=item.id) assignments,
   (SELECT jsonb_build_object('request_digest',operation.request_digest,'idempotency_key',operation.idempotency_key,'status',operation.status,'result',operation.result-'generation_item_id')
    FROM signal_classification_operations operation WHERE operation.workspace_id=item.workspace_id AND operation.operation_kind='append-results'
     AND operation.result->>'generation_item_id'=item.id::text) operation
   FROM signal_classification_generation_items item WHERE item.generation_id=$1::uuid ORDER BY item.canonical_root_id`,[request.generation_id])).rows;
  // Exercise the actual SQL prefix budget with deliberately conservative metadata
  // estimates. No Topic/decision is truncated, and no authorization query is mocked.
  const budgetDatabase=(oversizedIndex:number)=>Object.assign(Object.create(f.database) as typeof f.database,{connect:async()=>{
   const client=await f.database.connect(),bounded=Object.create(client) as typeof client;
   bounded.query=(async(sql:string,params?:unknown[])=>{
    if(sql.includes('WITH requested AS MATERIALIZED')){
     const values=[...params!],requested=JSON.parse(String(values[4])) as Array<{root_bytes:number}>;
     requested[oversizedIndex]!.root_bytes=8*1024*1024;values[4]=JSON.stringify(requested);
     return client.query(sql,values);
    }
    return client.query(sql,params);
   }) as typeof client.query;return bounded;
  }});
  const stores={claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
   readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
   readPage:classification.readSignalWorkspaceClassificationPageV1,
   readChunksPage:async(args:Parameters<typeof classification.readSignalWorkspaceClassificationChunksPageV1>[0])=>{
    const page=await classification.readSignalWorkspaceClassificationChunksPageV1(args);chunkPages++;assert.ok(page.items.length<=128);return page;
   },commitPage:async(args:Parameters<typeof classification.commitSignalWorkspaceClassificationPageV1>[0])=>{
    pages++;assert.equal(args.outcomes.length,3);
    const human=args.outcomes.flatMap(item=>item.decisions).find(item=>item.correction_operation_id===operationId);assert.ok(human);
    assert.equal(human.resolution_method,'human');assert.equal(human.disposition,'approved');assert.equal(human.decided_by_user_id,f.actor_user_id);
    const prefix=await classification.readSignalWorkspaceClassificationPageV1({...args,database:budgetDatabase(1)});
    assert.equal(prefix.items.length,1);assert.equal(prefix.done,false);assert.equal(prefix.items[0]!.corrections.length,1);
    await assert.rejects(classification.readSignalWorkspaceClassificationPageV1({...args,database:budgetDatabase(0)}),/page_capacity_exceeded/u);
    await assert.rejects(classification.commitSignalWorkspaceClassificationPageV1({...args,database:budgetDatabase(1)}),/page_capacity_exceeded/u);
    const missing=structuredClone(args.outcomes);missing[0]!.decisions=missing[0]!.decisions.filter(item=>item.correction_operation_id!==operationId);
    await assert.rejects(classification.commitSignalWorkspaceClassificationPageV1({...args,outcomes:missing}),/correction_missing/u);
    assert.equal((await normalized()).length,0,'capacity/correction rejection writes no partial page');
    let oracle:Awaited<ReturnType<typeof normalized>>;
    await f.query('BEGIN');try{
     let lease=args.lease;for(const outcome of args.outcomes)lease=await classification.commitSignalWorkspaceClassificationRootV1({...args,lease,outcome});
     oracle=await normalized();
    }finally{await f.query('ROLLBACK');}
    const result=await classification.commitSignalWorkspaceClassificationPageV1(args);
    assert.deepEqual(await normalized(),oracle!);checked=true;return result;
   },finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
  const options={database:f.database,stores,storage:{put:async()=>{throw Error('unexpected upload');},get:async({stored,destination}:{stored:{storage_key:string};destination:string})=>{
   const body=f.bodies.get(stored.storage_key);assert.notEqual(body,undefined);await writeFile(destination,body!);
  }}};
  const job={id:request.worker_job_id,data:{execution_id:request.execution_id},updateProgress:async()=>{}};
  await signalWorkspaceTopicProjectionJobV1(job,options);assert.equal(checked,true);assert.equal(pages,1);assert.equal(chunkPages,2);
  assert.deepEqual(await signalWorkspaceTopicProjectionJobV1(job,options),{execution_id:request.execution_id,replayed:true});
  const status=(await projection.loadSignalWorkspaceTopicProjectionStatusV1(f.access)).latest_complete;
  assert.equal(status?.generation_id,request.generation_id);assert.equal(status?.is_current,true);assert.equal(status?.denominator,3);assert.equal(status?.processed_chunks,133);
  const assignments=(await f.query(`SELECT membership_basis,disposition,count(*)::int n FROM signal_classification_assignments
   WHERE generation_id=$1::uuid GROUP BY membership_basis,disposition ORDER BY membership_basis`,[request.generation_id])).rows;
  assert.deepEqual(assignments,[{membership_basis:'computed_cluster',disposition:'pending',n:5},{membership_basis:'decision',disposition:'approved',n:1}]);
 }finally{await f.cleanup();}
});
