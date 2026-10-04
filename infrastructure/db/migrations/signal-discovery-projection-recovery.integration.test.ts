import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import type {Pool} from 'pg';
import * as projection from '../signal-workspace-topic-projection';
import * as classification from '../signal-workspace-classification';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';

const enabled=process.env.NOISIA_MFP_DISCOVERY_PROJECTION_PG_TEST==='true';
test('real discovery artifacts recover full-corpus projection, fence post-claim relevance and preserve outside human correction',{skip:!enabled,timeout:600_000},async()=>{
 // Same private host/DNS/PostgreSQL identity guard as the corpus harness.
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:Pool=await openDatabase(),raw=await pool.connect();
 try{
  await raw.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  if(!(await raw.query("SELECT to_regprocedure('signal_workspace_discovery_population_current_v1(uuid)') IS NOT NULL present")).rows[0].present)
   await raw.query(await readFile(new URL('./0240_signal_discovery_projection_population.sql',import.meta.url),'utf8'));
  // Parse the actual completion-route SELECT against PG, without requesting
  // materialization or touching the paid editorial execution.
  const route=await readFile(new URL('../../../apps/studio/src/lib/data-os/signal-topic-editorial-batch-control-v2.ts',import.meta.url),'utf8');
  const completionQuery=route.slice(route.indexOf('export async function completeWorkspaceTopicEditorialBatchV2ForActor')).match(/`(SELECT r\.id::text run_id,[\s\S]*?)`/u)?.[1];
  assert.ok(completionQuery);await raw.query(completionQuery,[randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
  const identity=JSON.parse(await readFile('/app/.data/dev-corpus/voyage-real/.data/dev-corpus/identity.json','utf8')) as {workspace_id:string;internal_user_id:string};
  const owner=(await raw.query(`SELECT p.id,p.actor_user_id,p.generation_id,p.input_snapshot->'source_projection'->>'engine_execution_id' engine_id,
    outbox.worker_job_id,e.input_snapshot->'discovery_population'->'root_ids' selected,e.preparation_run_id
   FROM signal_topic_catalog_executions p JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=p.id AND outbox.dispatch_kind='execution'
   JOIN signal_topic_catalog_executions e ON e.id::text=p.input_snapshot->'source_projection'->>'engine_execution_id'
   WHERE p.workspace_id=$1 AND p.status='failed' AND p.error_code='workspace_classification_projection_integrity_invalid'
    AND p.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-projection-v1'
    AND jsonb_typeof(e.input_snapshot->'discovery_population')='object' ORDER BY p.created_at DESC LIMIT 1`,[identity.workspace_id])).rows[0];
  assert.ok(owner,'requires an actual failed native projection; never creates or repeats fit/provider work');
  let serial=0;const stack:string[]=[];
  const query=async(sql:string,values?:unknown[])=>{
   if(sql.startsWith('BEGIN')){const name=`projection_${++serial}`;stack.push(name);return raw.query(`SAVEPOINT ${name}`);}
   if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
   if(sql==='ROLLBACK'){const name=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${name}`);return raw.query(`RELEASE SAVEPOINT ${name}`);}
   return raw.query(sql,values);
  };
  const client=Object.assign(Object.create(raw),{query,release(){}});
  const database=Object.assign(Object.create(pool),{query,connect:async()=>client}) as Pool;
  const counts=(await raw.query(`SELECT count(*)::int roots,sum(jsonb_array_length(a.chunks->'chunks'))::int chunks
   FROM signal_corpus_preparation_items i JOIN signal_corpus_text_assets a ON a.workspace_id=i.workspace_id AND a.text_sha256=i.asset_sha256
    AND a.chunk_policy_version=i.chunk_policy_version WHERE i.run_id=$1 AND i.disposition='eligible'`,[owner.preparation_run_id])).rows[0];
  const before=(await raw.query("SELECT count(*)::int n,COALESCE(sum(settled_micro_usd),0)::text cost FROM engine_cost_events WHERE workspace_id=$1",[identity.workspace_id])).rows[0];
  const storage=createWorkspaceEngineStorageV1();
  const selected=new Set<string>(owner.selected);
  const stores={claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
   readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
   readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,
   commitPage:classification.commitSignalWorkspaceClassificationPageV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1};
  const makeUnrelated=async()=>{
   await raw.query('UPDATE signal_mention_facet_overrides SET superseded_at=clock_timestamp() WHERE workspace_id=$1 AND root_id=$2 AND dimension IN(\'entities\',\'unrelated_reason\') AND superseded_at IS NULL',[identity.workspace_id,owner.selected[0]]);
   await raw.query(`INSERT INTO signal_mention_facet_overrides(workspace_id,root_id,dimension,value,actor_user_id) VALUES
    ($1,$2,'entities','{"value":[],"abstained":false,"confidence":"high"}',$3),($1,$2,'unrelated_reason','"off_topic"',$3)`,[identity.workspace_id,owner.selected[0],identity.internal_user_id]);
   assert.equal((await raw.query('SELECT relevance FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND root_id=$2',[identity.workspace_id,owner.selected[0]])).rows[0].relevance,'unrelated');
   assert.equal((await raw.query('SELECT signal_workspace_discovery_population_current_v1($1) current',[owner.engine_id])).rows[0].current,false);
  };
  for(const human of [false,true]){
   await raw.query('SAVEPOINT scenario');
   await classification.retrySignalWorkspaceClassificationV1({database,execution_id:owner.id,actor_user_id:owner.actor_user_id});
   let request={execution_id:owner.id,worker_job_id:owner.worker_job_id,generation_id:owner.generation_id},humanRoot:string|null=null;
   if(human){
    const claimed=await projection.claimSignalWorkspaceTopicProjectionV1({database,...request});assert.ok(claimed);
    const outside=(await raw.query(`SELECT root_id,fingerprint FROM signal_corpus_preparation_items WHERE run_id=$1 AND disposition='eligible' AND NOT root_id=ANY($2::uuid[]) ORDER BY root_id LIMIT 1`,[owner.preparation_run_id,owner.selected])).rows[0];assert.ok(outside);humanRoot=outside.root_id;
    const topic=(await projection.readSignalWorkspaceTopicProjectionTopicsV1({database,lease:claimed.lease,after_term_key:null,limit:1})).items[0]!;
    const operation=randomUUID(),sha=`sha256:${createHash('sha256').update(operation).digest('hex')}`;
    // Explicit synthetic human operation, using the existing origin/fingerprint/
    // definition/context guards. It is visible only within the physical rollback.
    await raw.query(`INSERT INTO signal_topic_membership_operations(id,workspace_id,actor_user_id,execution_id,term_key,canonical_root_id,disposition,
     definition_revision,idempotency_key,request_digest,origin_input_contract,root_fingerprint,definition_digest,context_digest)
     VALUES($1,$2,$3,$4,$5,$6,'belongs',$7,$1,$8,'workspace-topic-classification-v1',$9,$10,$11)`,
    [operation,identity.workspace_id,identity.internal_user_id,owner.id,topic.term_key,humanRoot,topic.definition_revision,sha,outside.fingerprint,topic.definition_digest,claimed.lease.identity.context_digest]);
    await raw.query(`INSERT INTO signal_topic_membership_overrides(workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,
     origin_input_contract,root_fingerprint,definition_digest,context_digest,correction_operation_id)
     SELECT workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,origin_input_contract,root_fingerprint,
      definition_digest,context_digest,id FROM signal_topic_membership_operations WHERE id=$1`,[operation]);
    await classification.failSignalWorkspaceClassificationV1({database,lease:claimed.lease,error_code:'workspace_classification_worker_failed'});
    request=await projection.requestSignalWorkspaceTopicProjectionV1({database,workspace_id:identity.workspace_id,actor_user_id:owner.actor_user_id,
     engine_execution_id:owner.engine_id,idempotency_key:randomUUID()});
   }
   let checked=false;const pageDurations:number[]=[];const scenarioStarted=Date.now();
   await signalWorkspaceTopicProjectionJobV1({id:request.worker_job_id,data:{execution_id:request.execution_id},updateProgress:async()=>{}},
    {database,storage:{...storage,put:async()=>{throw new Error('projection must never upload');}},stores:{...stores,
     commitPage:async args=>{
      if(!checked){checked=true;await raw.query('SAVEPOINT relevance_change');try{
       await makeUnrelated();
       assert.equal((await raw.query('SELECT signal_workspace_projection_source_current_v1(g) current FROM signal_classification_generations g WHERE id=$1',[request.generation_id])).rows[0].current,false);
       await assert.rejects(classification.commitSignalWorkspaceClassificationPageV1(args),/inputs_changed/);
      }finally{await raw.query('ROLLBACK TO SAVEPOINT relevance_change');await raw.query('RELEASE SAVEPOINT relevance_change');}}
      const started=Date.now();const committed=await classification.commitSignalWorkspaceClassificationPageV1(args);
      pageDurations.push(Date.now()-started);return committed;
     }}});
   const completed=(await raw.query('SELECT status,denominator,processed_roots,processed_chunks::int FROM signal_topic_catalog_executions WHERE id=$1',[request.execution_id])).rows[0];
   assert.equal(completed.status,'ready');assert.equal(completed.denominator,counts.roots);assert.equal(completed.processed_roots,counts.roots);assert.equal(completed.processed_chunks,counts.chunks);
   const outside=(await raw.query(`SELECT i.canonical_root_id,i.outcome_metadata->>'reason_code' reason_code,a.resolution_method,a.membership_basis FROM signal_classification_generation_items i
    LEFT JOIN signal_classification_assignments a ON a.generation_item_id=i.id WHERE i.generation_id=$1 AND NOT i.canonical_root_id=ANY($2::uuid[])`,[request.generation_id,owner.selected])).rows;
   assert.equal(new Set(outside.map(r=>r.canonical_root_id)).size,counts.roots-selected.size);
   assert.ok(outside.every(r=>r.reason_code==='computed_cluster_outside_discovery_population'&&(!r.membership_basis||r.resolution_method==='human'&&r.membership_basis==='decision')));
   if(human)assert.ok(outside.some(r=>r.canonical_root_id===humanRoot&&r.resolution_method==='human'));
   const servingStarted=Date.now();
   assert.equal((await raw.query('SELECT signal_workspace_projection_source_current_v1(g) current FROM signal_classification_generations g WHERE id=$1',[request.generation_id])).rows[0].current,true);
   const servingMilliseconds=Date.now()-servingStarted;
   await raw.query('SAVEPOINT serving_change');await makeUnrelated();
   assert.equal((await raw.query('SELECT signal_workspace_projection_source_current_v1(g) current FROM signal_classification_generations g WHERE id=$1',[request.generation_id])).rows[0].current,false);
   await raw.query('ROLLBACK TO SAVEPOINT serving_change');await raw.query('RELEASE SAVEPOINT serving_change');
   assert.deepEqual((await raw.query("SELECT count(*)::int n,COALESCE(sum(settled_micro_usd),0)::text cost FROM engine_cost_events WHERE workspace_id=$1",[identity.workspace_id])).rows[0],before);
   console.info(JSON.stringify({synthetic_human:human,eligible_roots:counts.roots,sealed_roots:selected.size,outside_roots:counts.roots-selected.size,scenario_ms:Date.now()-scenarioStarted,page_ms:pageDurations,serving_source_ms:servingMilliseconds}));
   await raw.query('SET CONSTRAINTS ALL IMMEDIATE');await raw.query('ROLLBACK TO SAVEPOINT scenario');await raw.query('RELEASE SAVEPOINT scenario');
  }
 }finally{await raw.query('ROLLBACK');raw.release();await pool.end();}
});
