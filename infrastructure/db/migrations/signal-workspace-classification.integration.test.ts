import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { signalWorkspaceClassificationReuseKeyV1, signalTopicDefinitionDigestV1, type SignalWorkspaceClassificationIdentityV1,
 type SignalWorkspaceClassificationOutcomeV1 } from "@noisia/query-engine";
import * as core from "../signal-workspace-classification";

const enabled=process.env.NOISIA_WORKSPACE_CLASSIFICATION_TEST_APPROVED==="true";
const sha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;
/** Reuses an explicitly selected prepared local fixture. Every mutation, new
 * generation and correction is rolled back; no provider or migration runner. */
async function fixture(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55439");
 assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();
 await client.query("BEGIN");await client.query("SET LOCAL search_path=public,extensions,pg_temp");
 const stack:string[]=[];let serial=0;
 const query=async(sql:string,values?:unknown[])=>{if(sql.startsWith("BEGIN")){const key=`classification_${++serial}`;stack.push(key);return client.query(`SAVEPOINT ${key}`);}
  if(sql==="COMMIT")return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const key=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${key}`);return client.query(`RELEASE SAVEPOINT ${key}`);}
  return client.query(sql,values);};
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient["query"];scoped.release=()=>{};
 const database=Object.assign(Object.create(pool) as Pool,{query:query as Pool["query"],connect:async()=>scoped});
 const workspace_id=process.env.NOISIA_WORKSPACE_CLASSIFICATION_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_WORKSPACE_CLASSIFICATION_TEST_ACTOR_ID!,
  embedding_run_id=process.env.NOISIA_WORKSPACE_CLASSIFICATION_TEST_EMBEDDING_ID!;
 assert.ok(workspace_id&&actor_user_id&&embedding_run_id);
 const access={database,workspace_id,actor_user_id};
 const input=()=>core.loadSignalWorkspaceClassificationInputV1({queryable:database,workspace_id,actor_user_id});
 const identity=async():Promise<SignalWorkspaceClassificationIdentityV1>=>{const current=await input();return{
  contract_version:"signal-workspace-classification-v1",workspace_id,engine_key:"local-ledger-fixture",engine_version:1,
  engine_artifact_digest:sha("fixture-unvalidated-engine"),decision_policy_digest:sha("fixture-no-automatic-authority"),
  embedding_config_digest:current.embedding_config_digest,catalog_digest:current.catalog_digest,
  compiler_digest:current.compiler_digest,context_digest:current.context_digest};};
 const begin=async()=>core.beginSignalWorkspaceClassificationV1({...access,embedding_run_id,identity:await identity(),idempotency_key:randomUUID()});
 const claim=async(run:Awaited<ReturnType<typeof begin>>)=>{const lease=await core.claimSignalWorkspaceClassificationV1({database,...run});assert.ok(lease);return lease;};
 const rootPage=(lease:core.SignalWorkspaceClassificationLeaseV1)=>core.readSignalWorkspaceClassificationRootPageV1({database,lease,limit:100});
 const rejected=async(sql:string,params:unknown[],pattern:RegExp)=>{await query("BEGIN");try{await assert.rejects(query(sql,params),pattern);}finally{await query("ROLLBACK");}};
 const cleanup=async()=>{await client.query("ROLLBACK");client.release();await pool.end();};
 return{database,query,workspace_id,actor_user_id,access,input,identity,begin,claim,rootPage,rejected,cleanup};
}
function outcome(lease:core.SignalWorkspaceClassificationLeaseV1,root:core.SignalWorkspaceClassificationRootV1,
 decisions:SignalWorkspaceClassificationOutcomeV1["decisions"]=[],error=false):SignalWorkspaceClassificationOutcomeV1{
 const identity={root_id:root.root_id,fingerprint:root.fingerprint,correction_digest:root.correction_digest};
 return{contract_version:"signal-workspace-classification-v1",root:identity,reuse_key:signalWorkspaceClassificationReuseKeyV1(lease.identity,identity),
  resolution_state:error?"error":"pending",has_unresolved_topics:true,reason_code:"fixture-unresolved",technical_error_code:error?"fixture-engine-failed":null,
  evidence_digest:sha("fixture-evidence"),coverage:{expected_chunks:root.expected_chunks,processed_chunks:error?0:root.expected_chunks,
  chunk_coverage_digest:root.chunk_coverage_digest},decisions};
}

test("native sparse multilabel preserves correction authority, partial errors, complete lineage and currentness",{skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  const seed=await f.begin(),seedLease=await f.claim(seed),roots=(await f.rootPage(seedLease)).items;
  assert.equal(roots.length,3,"dedicated tiny local fixture");const first=roots[0]!,topics=(await f.input()).topics.slice(0,2);assert.equal(topics.length,2);
  const decisions:SignalWorkspaceClassificationOutcomeV1["decisions"]=[];
  for(const [i,topic] of topics.entries()){
   const op=randomUUID(),disposition=i===0?"belongs":"excluded";
   await f.query(`INSERT INTO signal_topic_membership_operations(id,workspace_id,actor_user_id,execution_id,term_key,canonical_root_id,disposition,
    definition_revision,idempotency_key,request_digest,origin_input_contract,root_fingerprint,definition_digest,context_digest)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,'workspace-topic-classification-v1',$11,$12,$13)`,
   [op,f.workspace_id,f.actor_user_id,seed.execution_id,topic.definition.term_key,first.root_id,disposition,topic.definition.definition_revision,randomUUID(),sha(op),
    first.fingerprint,topic.definition.definition_digest,seedLease.identity.context_digest]);
   await f.query(`INSERT INTO signal_topic_membership_overrides(workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,
    origin_input_contract,root_fingerprint,definition_digest,context_digest,correction_operation_id)
    VALUES($1::uuid,$2,$3::uuid,$4,$5,$6::uuid,'workspace-topic-classification-v1',$7,$8,$9,$10::uuid)
    ON CONFLICT(workspace_id,term_key,canonical_root_id) DO UPDATE SET disposition=EXCLUDED.disposition,definition_revision=EXCLUDED.definition_revision,
     actor_user_id=EXCLUDED.actor_user_id,origin_input_contract=EXCLUDED.origin_input_contract,root_fingerprint=EXCLUDED.root_fingerprint,
     definition_digest=EXCLUDED.definition_digest,context_digest=EXCLUDED.context_digest,correction_operation_id=EXCLUDED.correction_operation_id`,
   [f.workspace_id,topic.definition.term_key,first.root_id,disposition,topic.definition.definition_revision,f.actor_user_id,first.fingerprint,
    topic.definition.definition_digest,seedLease.identity.context_digest,op]);
   decisions.push({taxonomy_term_id:topic.taxonomy_term_id,term_key:topic.definition.term_key,definition_revision:topic.definition.definition_revision,
    definition_digest:topic.definition.definition_digest,disposition:i===0?"approved":"rejected",resolution_method:"human",model_version_id:null,
    labeling_function_version_id:null,approval_policy_id:null,decided_by_user_id:f.actor_user_id,correction_operation_id:op,score:null,
    evidence_digest:sha(op),lineage_digest:sha(`original-${op}`)});
  }
  await core.failSignalWorkspaceClassificationV1({database:f.database,lease:seedLease,error_code:"workspace_classification_worker_failed"});
  const firstRun=await f.begin();let lease=await f.claim(firstRun);const currentRoots=(await f.rootPage(lease)).items;
  await assert.rejects(core.commitSignalWorkspaceClassificationRootV1({database:f.database,lease,outcome:outcome(lease,currentRoots[0]!)}),/correction_missing/u);
  for(const root of currentRoots)lease=await core.commitSignalWorkspaceClassificationRootV1({database:f.database,lease,
   outcome:outcome(lease,root,root.root_id===first.root_id?[...decisions].reverse():[])});
  await f.rejected("SELECT * FROM finalize_signal_classification_generation_v1($1::uuid,$2::uuid,$3::uuid,$4,$5)",
   [f.workspace_id,firstRun.generation_id,f.actor_user_id,sha("legacy-finalize-key"),sha("legacy-finalize-body")],/finalization authority is invalid/u);
  const finished=await core.finishSignalWorkspaceClassificationV1({database:f.database,lease});assert.equal(finished.complete_usable,true);
  const summary=(await f.query(`SELECT item.resolution_state,array_agg(assignment.disposition ORDER BY assignment.disposition) dispositions
   FROM signal_classification_generation_items item JOIN signal_classification_assignments assignment ON assignment.generation_item_id=item.id
   WHERE item.generation_id=$1::uuid GROUP BY item.resolution_state`,[firstRun.generation_id])).rows[0];
  assert.deepEqual(summary,{resolution_state:"pending",dispositions:["approved","rejected"]});
  const copy=await f.begin();const before=await core.loadSignalWorkspaceClassificationStatusV1(f.access);
  assert.equal(before.latest_complete?.generation_id,firstRun.generation_id);assert.equal(before.latest_complete?.is_current,true);
  lease=await f.claim(copy);for(const root of (await f.rootPage(lease)).items){assert.ok(root.reuse_item_id);lease=await core.copySignalWorkspaceClassificationRootV1({database:f.database,lease,root_id:root.root_id,source_item_id:root.reuse_item_id});}
  await core.finishSignalWorkspaceClassificationV1({database:f.database,lease});
  const copied=(await f.query(`SELECT count(*)::int count,bool_and(assignment.decided_by_user_id=source.decided_by_user_id
   AND assignment.correction_operation_id=source.correction_operation_id AND assignment.lineage_digest=source.lineage_digest) preserved
   FROM signal_classification_assignments assignment JOIN signal_classification_assignments source ON source.id=assignment.source_assignment_id
   WHERE assignment.generation_id=$1::uuid`,[copy.generation_id])).rows[0];assert.deepEqual(copied,{count:2,preserved:true});
  const partial=await f.begin();lease=await f.claim(partial);for(const root of (await f.rootPage(lease)).items)
   lease=await core.commitSignalWorkspaceClassificationRootV1({database:f.database,lease,outcome:outcome(lease,root,
    root.root_id===first.root_id?decisions:[],root.root_id===first.root_id)});
  const partialResult=await core.finishSignalWorkspaceClassificationV1({database:f.database,lease});assert.equal(partialResult.complete_usable,false);
  const status=await core.loadSignalWorkspaceClassificationStatusV1(f.access);assert.equal(status.latest_run?.generation_id,partial.generation_id);
  assert.equal(status.latest_complete?.generation_id,copy.generation_id);assert.equal(status.latest_complete?.is_current,true);
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_classification_assignments WHERE generation_id=$1::uuid",[partial.generation_id])).rows[0].count,2);
  const viewer=randomUUID(),brand=(await f.query("SELECT brand_id,organization_id FROM signal_workspaces WHERE id=$1::uuid",[f.workspace_id])).rows[0];
  await f.query("INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES($1::uuid,$2,'client','client_viewer',$3::uuid,'active')",[viewer,`${viewer}@example.test`,brand.organization_id]);
  await f.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1::uuid,$2::uuid,'read')",[viewer,brand.brand_id]);
  assert.equal((await core.loadSignalWorkspaceClassificationStatusV1({...f.access,actor_user_id:viewer})).latest_complete?.is_current,true);
  await assert.rejects(core.beginSignalWorkspaceClassificationV1({...f.access,actor_user_id:viewer,embedding_run_id:process.env.NOISIA_WORKSPACE_CLASSIFICATION_TEST_EMBEDDING_ID!,
   identity:await f.identity(),idempotency_key:randomUUID()}),/forbidden/u);
  await f.query("BEGIN");
  await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.actor_user_id]);
  assert.equal((await core.loadSignalWorkspaceClassificationStatusV1({...f.access,actor_user_id:viewer})).latest_complete?.is_current,false);
  await f.query("ROLLBACK");
  const events=(await f.query("SELECT count(*)::int count FROM signal_classification_events event JOIN signal_classification_operations op ON op.id=event.operation_id WHERE op.result->>'generation_id'=$1 OR op.result->>'generation_item_id' IN(SELECT id::text FROM signal_classification_generation_items WHERE generation_id=$1::uuid)",[copy.generation_id])).rows[0].count;
  assert.equal(events,5,"create, three atomic roots, finalize");
  await f.query("UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid",[f.workspace_id]);
  assert.equal((await core.loadSignalWorkspaceClassificationStatusV1({...f.access,actor_user_id:viewer})).latest_complete?.is_current,false);
  assert.equal((await core.loadSignalWorkspaceClassificationStatusV1(f.access)).latest_complete?.generation_id,copy.generation_id);
 }finally{await f.cleanup();}
});

test("native zero-assignment copy rejects a different semantic identity even with unchanged root text",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  const first=await f.begin();let lease=await f.claim(first);for(const root of (await f.rootPage(lease)).items)
   lease=await core.commitSignalWorkspaceClassificationRootV1({database:f.database,lease,outcome:outcome(lease,root)});
  await core.finishSignalWorkspaceClassificationV1({database:f.database,lease});
  await f.query("UPDATE brands SET description=COALESCE(description,'')||' Additional changed fixture context.' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid)",[f.workspace_id]);
  const next=await f.begin(),nextLease=await f.claim(next);assert.notEqual(nextLease.identity.context_digest,lease.identity.context_digest);
  assert.ok((await f.rootPage(nextLease)).items.every(root=>root.reuse_item_id===null));
  const source=(await f.query("SELECT id FROM signal_classification_generation_items WHERE generation_id=$1::uuid ORDER BY canonical_root_id LIMIT 1",[first.generation_id])).rows[0].id;
  await f.rejected(`INSERT INTO signal_classification_generation_items(workspace_id,generation_id,canonical_root_id,resolution_state,technical_error_code,item_digest,
   root_fingerprint,correction_digest,reuse_key,outcome_metadata,source_generation_item_id)
   SELECT workspace_id,$1::uuid,canonical_root_id,resolution_state,technical_error_code,item_digest,root_fingerprint,correction_digest,reuse_key,outcome_metadata,id
   FROM signal_classification_generation_items WHERE id=$2::uuid`,[next.generation_id,source],/copy_identity_invalid/u);
  assert.equal((await core.loadSignalWorkspaceClassificationStatusV1(f.access)).latest_complete?.is_current,false);
  await f.query(`UPDATE taxonomy_terms SET metadata=jsonb_set(metadata,'{topic,lifecycle}','"archived"')
   WHERE taxonomy_id=(SELECT taxonomy_id FROM signal_taxonomy_profiles WHERE id=$1::uuid)`,[(await f.input()).taxonomy_profile_id]);
  const empty=await core.loadSignalWorkspaceClassificationStatusV1(f.access);
  assert.equal(empty.latest_complete?.generation_id,first.generation_id);assert.equal(empty.latest_complete?.is_current,false);
 }finally{await f.cleanup();}
});


test("native ledger accepts and copies more than one thousand actual memberships without top-k truncation",{skip:!enabled,timeout:120_000},async()=>{
 const f=await fixture();try{
  const current=await f.input(),base=current.topics[0]!.definition;
  const topicRows=Array.from({length:1001},(_,i)=>{const definition={...base,term_key:`wide_fixture_${i.toString().padStart(4,"0")}`,label:`Fixture ${i}`,
   definition:`Synthetic independent membership ${i}`,definition_revision:1};definition.definition_digest=signalTopicDefinitionDigestV1(definition);
   return{id:randomUUID(),definition};});
  await f.query(`INSERT INTO taxonomy_terms(id,taxonomy_id,term_key,label,metadata,status)
   SELECT row.id,profile.taxonomy_id,row.definition->>'term_key',row.definition->>'label',jsonb_build_object('topic',row.definition),'candidate'
   FROM jsonb_to_recordset($1::jsonb) row(id uuid,definition jsonb) CROSS JOIN signal_taxonomy_profiles profile WHERE profile.id=$2::uuid`,
  [JSON.stringify(topicRows),current.taxonomy_profile_id]);
  const seed=await f.begin(),seedLease=await f.claim(seed),first=(await f.rootPage(seedLease)).items[0]!;
  const values=topicRows.map(row=>({...row,operation_id:randomUUID()}));
  await f.query(`INSERT INTO signal_topic_membership_operations(id,workspace_id,actor_user_id,execution_id,term_key,canonical_root_id,disposition,
   definition_revision,idempotency_key,request_digest,origin_input_contract,root_fingerprint,definition_digest,context_digest)
   SELECT row.operation_id,$1::uuid,$2::uuid,$3::uuid,row.definition->>'term_key',$4::uuid,'belongs',1,row.operation_id::text,$5,
    'workspace-topic-classification-v1',$6,row.definition->>'definition_digest',$7
   FROM jsonb_to_recordset($8::jsonb) row(operation_id uuid,definition jsonb)`,
  [f.workspace_id,f.actor_user_id,seed.execution_id,first.root_id,sha("wide-corrections"),first.fingerprint,seedLease.identity.context_digest,JSON.stringify(values)]);
  await f.query(`INSERT INTO signal_topic_membership_overrides(workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,
   origin_input_contract,root_fingerprint,definition_digest,context_digest,correction_operation_id)
   SELECT workspace_id,term_key,canonical_root_id,disposition,definition_revision,actor_user_id,origin_input_contract,root_fingerprint,definition_digest,context_digest,id
   FROM signal_topic_membership_operations WHERE execution_id=$1::uuid`,[seed.execution_id]);
  await core.failSignalWorkspaceClassificationV1({database:f.database,lease:seedLease,error_code:"workspace_classification_worker_failed"});
  const run=await f.begin();let lease=await f.claim(run);const all=(await f.rootPage(lease)).items;
  const decisions:SignalWorkspaceClassificationOutcomeV1["decisions"]=values.map<SignalWorkspaceClassificationOutcomeV1["decisions"][number]>(row=>({taxonomy_term_id:row.id,term_key:row.definition.term_key,
   definition_revision:1,definition_digest:row.definition.definition_digest,disposition:"approved",resolution_method:"human",model_version_id:null,
   labeling_function_version_id:null,approval_policy_id:null,decided_by_user_id:f.actor_user_id,correction_operation_id:row.operation_id,
   score:null,evidence_digest:sha(row.operation_id),lineage_digest:sha(`wide-${row.operation_id}`)})).reverse();
  for(const root of all)lease=await core.commitSignalWorkspaceClassificationRootV1({database:f.database,lease,
   outcome:outcome(lease,root,root.root_id===first.root_id?decisions:[])});
  await core.finishSignalWorkspaceClassificationV1({database:f.database,lease});
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_classification_assignments WHERE generation_id=$1::uuid",[run.generation_id])).rows[0].count,1001);
  const next=await f.begin(),nextLease=await f.claim(next),copyRoot=(await f.rootPage(nextLease)).items[0]!;assert.ok(copyRoot.reuse_item_id);
  await core.copySignalWorkspaceClassificationRootV1({database:f.database,lease:nextLease,root_id:copyRoot.root_id,source_item_id:copyRoot.reuse_item_id});
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_classification_assignments WHERE generation_id=$1::uuid AND source_assignment_id IS NOT NULL",[next.generation_id])).rows[0].count,1001);
 }finally{await f.cleanup();}
});
