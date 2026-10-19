import {currentTopicDefinitionCasV1} from './signal-topic-definition-cas.fixture';
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import type {PoolClient,Pool} from "pg";
import {createSignalWorkspaceTopicSearchAccumulatorV1,createSignalWorkspaceTopicSearchShortlistV1} from "@noisia/query-engine";
import {correctSignalTopicMembershipStoreV1,createSignalTopicCatalogExecutionStoreV1,createSignalTopicStoreV1,
 loadSignalTopicCatalogStoreV1,loadSignalTopicExecutionResultsStoreV1,setSignalTopicLifecycleStoreV1,updateSignalTopicStoreV1} from "../signal-topic-catalog";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "../signal-workspace-capabilities";
import * as core from "../signal-workspace-topic-computation";
const enabled=process.env.NOISIA_WORKSPACE_TOPIC_TEST_APPROVED==="true";

test("UTF-16 evidence excerpts are exact and bounded even beyond the Worker text-cache limit",{skip:!enabled,timeout:60_000},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const database=new pg.Pool({connectionString:url.href,ssl:false,max:1});
 try{
  const source="á\r\nA😀B𐀀C\u{10FFFF}fin";
  const offsets=[0];let offset=0;for(const char of source){offset+=char.length;offsets.push(offset);}
  for(const start of offsets)for(const end of offsets.filter(value=>value>=start)){
   const actual=(await database.query("SELECT signal_topic_utf16_fragment_v1($1,$2,$3) AS fragment",[source,start,end])).rows[0].fragment;
   assert.equal(actual,source.slice(start,end));
  }
  for(const [start,end] of [[-1,2],[3,2],[5,6],[4,5],[source.length,source.length+1],[0,1401]]){
   await assert.rejects(database.query("SELECT signal_topic_utf16_fragment_v1($1,$2,$3)",[source,start,end]),(error:unknown)=>
    typeof error==="object"&&error!==null&&"code"in error&&error.code==="22023");
  }
  const prefixLength=17*1024*1024,tail="😀Evidence\r\n𐀀 "+"e\u0301".repeat(600),start=prefixLength+2,end=start+tail.length;
  // Build the large synthetic asset in SQL. Neither the fixture nor a full asset
  // is transferred to Node; its last bounded fragment and digest must be exact.
  const measured=performance.now();
  const row=(await database.query(`SELECT fragment,octet_length(fragment) AS bytes,
   encode(sha256(convert_to(fragment,'UTF8')),'hex') AS hash FROM
   (SELECT signal_topic_utf16_fragment_v1('𐀀'||repeat('x',$1)||$2,$3,$4) AS fragment) result`,[prefixLength,tail,start,end])).rows[0];
  assert.equal(row.fragment,tail);assert.equal(row.hash,createHash("sha256").update(tail).digest("hex"));
  assert.equal(row.bytes,Buffer.byteLength(tail));assert.ok(row.fragment.length<=1400);
  const metadata=(await database.query("SELECT provolatile,proisstrict,prosecdef,proparallel FROM pg_proc WHERE oid='signal_topic_utf16_fragment_v1(text,integer,integer)'::regprocedure")).rows[0];
  assert.deepEqual(metadata,{provolatile:"i",proisstrict:true,prosecdef:false,proparallel:"s"});
  console.log(JSON.stringify({utf16_excerpt_source_bytes:prefixLength+4+Buffer.byteLength(tail),returned_bytes:row.bytes,elapsed_ms:Math.round(performance.now()-measured),full_asset_returned:false}));
 }finally{await database.end();}
});

/** Isolated local fixture; every store transaction is a real savepoint inside an
 * outer rollback. No prepared text, cached vector, authority guard or SQL is mocked. */
async function fixture(options:{initialize?:boolean;workspace_id?:string;actor_user_id?:string}={}){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();await client.query("BEGIN");
 const stack:string[]=[];let serial=0;
 const query=async(sql:string,params?:unknown[])=>{
  if(sql==="BEGIN"){const name=`topic_test_${++serial}`;stack.push(name);return client.query(`SAVEPOINT ${name}`);}
  if(sql==="COMMIT")return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const name=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${name}`);return client.query(`RELEASE SAVEPOINT ${name}`);}
  return client.query(sql,params);
 };
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient["query"];scoped.release=()=>{};
 const database=Object.assign(Object.create(pool) as Pool,{query:query as Pool["query"],connect:async()=>scoped});
 const workspace_id=options.workspace_id??process.env.NOISIA_WORKSPACE_TOPIC_TEST_WORKSPACE_ID!,actor_user_id=options.actor_user_id??process.env.NOISIA_WORKSPACE_TOPIC_TEST_ACTOR_ID!;
 const scope={database,workspace_id,actor_user_id};
 const brand=(await query("SELECT brand_id FROM signal_workspaces WHERE id=$1::uuid",[workspace_id])).rows[0].brand_id;
 // The complete-context reader must retain a meaningful tail beyond legacy4000.
 if(options.initialize!==false){
  await query("UPDATE brands SET description=$2 WHERE id=$1::uuid",[brand,"Contexto ".repeat(900)+"CONTEXTO_COMPLETO_FINAL"]);
  await createSignalTopicStoreV1({pool:database,workspace_id,actor_user_id,idempotency_key:randomUUID(),input:{label:"Servicio documental",
   definition:"Conversaciones sobre servicio con evidencia explícita",scope:"primary_brand",inclusion:[],exclusion:[],positive_examples:[],negative_examples:[]}});
 }
 const built=await core.loadSignalWorkspaceTopicInputSnapshotV1(scope);
 const embedding_run_id=(await query("SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND status='completed' ORDER BY completed_at DESC LIMIT 1",[workspace_id])).rows[0].id as string;
 const ask=()=>core.requestSignalWorkspaceTopicComputationV1({...scope,idempotency_key:randomUUID(),embedding_run_id});
 const seed=async(legacy=false)=>{const inputs=built.input.topics.flatMap(topic=>topic.compiled.inputs);
  for(const item of inputs)await query(`INSERT INTO signal_topic_definition_embeddings(workspace_id,definition_digest,embedding_model,provider,embedding,embedding_config_digest,input_text_sha256)
   VALUES($1::uuid,$2,$3,$4,$5::vector,$6,$7)`,[workspace_id,item.input_digest,built.input.embedding_profile.model,built.input.embedding_profile.provider,
   `[${Array.from({length:1024},(_,i)=>i===0?1:0).join(",")}]`,legacy?null:built.input.embedding_profile.config_digest,legacy?null:item.text_sha256]);};
 const claim=async(execution_id:string)=>{const worker_job_id=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid",[execution_id])).rows[0].worker_job_id as string;
  const lease=await core.claimSignalWorkspaceTopicComputationV1({database,execution_id,worker_job_id});assert.ok(lease);return lease;};
 const begin=async()=>{await seed();const request=await ask();return claim(request.execution_id);};
 const cleanup=async()=>{await client.query("ROLLBACK");client.release();await pool.end();};
 return{scope,database,query,workspace_id,actor_user_id,brand,built,ask,seed,claim,begin,cleanup};
}
async function score(f:Awaited<ReturnType<typeof fixture>>,lease:core.SignalWorkspaceTopicLeaseV1){
 const root=(await core.readSignalWorkspaceTopicRootPageV1({database:f.database,lease,limit:1})).items[0]!;
 const topics=(await core.readSignalWorkspaceTopicDefinitionsV1({database:f.database,lease,after_term_key:null})).items;
 const accumulator=createSignalWorkspaceTopicSearchAccumulatorV1({asset_sha256:root.asset_sha256,expected_chunks:root.expected_chunks,topics});
 let after_chunk_index:number|null=null;
 for(;;){const page=await core.readSignalWorkspaceTopicRootChunksV1({database:f.database,lease,root_id:root.root_id,after_chunk_index,limit:1});
  accumulator.beginChunkPage(page.items);let after:core.SignalWorkspaceTopicPrototypeCursorV1=null;
  for(;;){const protos=await core.readSignalWorkspaceTopicPrototypesV1({database:f.database,lease,term_keys:topics.map(topic=>topic.term_key),after,limit:2});
   accumulator.addPrototypePage(protos.items);after=protos.next_cursor;if(protos.done)break;}
  accumulator.finishChunkPage();after_chunk_index=page.next_chunk_index;if(page.done)break;}
 const shortlist=createSignalWorkspaceTopicSearchShortlistV1();shortlist.addBlock(accumulator.finish());
 return{root,result:{...shortlist.finish(),processed_chunks:root.expected_chunks,root_fingerprint:root.fingerprint,semantic_scope_available:root.semantic_scope_available}};
}

test("workspace Topic input includes the complete context and legacy model-only prototypes cannot satisfy it",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{
  assert.ok(Object.values(f.built.input.texts).some(text=>text.includes("CONTEXTO_COMPLETO_FINAL")));
  await assert.rejects(f.ask(),/workspace_topic_prototypes_required/u);await f.seed(true);
  await assert.rejects(f.ask(),/workspace_topic_prototypes_required/u);
  assert.equal((await f.query("SELECT 1 FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1'",[f.workspace_id])).rowCount,0);
 }finally{await f.cleanup();}
});

test("native ready evidence never enters legacy readers/corrections and scoped editors can revise unapproved interests",{
 skip:!enabled||!process.env.NOISIA_WORKSPACE_TOPIC_TEST_READY_WORKSPACE_ID,timeout:60_000
},async()=>{
 const f=await fixture({initialize:false,workspace_id:process.env.NOISIA_WORKSPACE_TOPIC_TEST_READY_WORKSPACE_ID,
  actor_user_id:process.env.NOISIA_WORKSPACE_TOPIC_TEST_READY_ACTOR_ID});
 try{
  const ready=(await f.query(`SELECT id::text,idempotency_key,actor_user_id::text FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1' AND status='ready'
   ORDER BY completed_at DESC,id DESC LIMIT 1`,[f.workspace_id])).rows[0];assert.ok(ready);
  const suggestion=(await f.query(`SELECT canonical_root_id::text,term_key FROM signal_topic_classification_suggestions
   WHERE execution_id=$1::uuid LIMIT 1`,[ready.id])).rows[0];assert.ok(suggestion);
  const catalog=await loadSignalTopicCatalogStoreV1({queryable:f.database,workspace_id:f.workspace_id});
  assert.equal(catalog.active_profile_id,null);assert.equal(catalog.search_execution_id,null);
  const topic=catalog.topics.find(item=>item.term_key===suggestion.term_key)!;assert.ok(topic);
  assert.deepEqual((await loadSignalTopicExecutionResultsStoreV1({queryable:f.database,workspace_id:f.workspace_id,execution_id:ready.id})).items,[]);
  await assert.rejects(correctSignalTopicMembershipStoreV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,
   execution_id:ready.id,term_key:topic.term_key,canonical_root_id:suggestion.canonical_root_id,disposition:"belongs",
   expected_definition_revision:topic.definition_revision,idempotency_key:randomUUID()}),{code:"topic_result_not_found"});
  await assert.rejects(createSignalTopicCatalogExecutionStoreV1({pool:f.database,workspace_id:f.workspace_id,actor_user_id:ready.actor_user_id,
   intent:"search",idempotency_key:ready.idempotency_key}),{code:"topic_execution_idempotency_conflict"});
  const actor=randomUUID(),organization=(await f.query("SELECT organization_id::text FROM signal_workspaces WHERE id=$1::uuid",[f.workspace_id])).rows[0].organization_id;
  await f.query("INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES($1::uuid,$2,'client','client_admin',$3::uuid,'active')",
   [actor,`topic-editor-${actor}@example.test`,organization]);
  await f.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1::uuid,$2::uuid,'comment')",[actor,f.brand]);
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:f.database,workspace_id:f.workspace_id,actor_user_id:actor});
  assert.equal(caps.can_edit_topics,true);assert.equal(caps.can_execute_topics,false);
  const before=(await f.query("SELECT count(*)::int count FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid",[f.workspace_id])).rows[0].count;
  const args={pool:f.database,workspace_id:f.workspace_id,actor_user_id:actor,term_key:topic.term_key};
  const updated=await updateSignalTopicStoreV1({...args,idempotency_key:randomUUID(),input:{...(await currentTopicDefinitionCasV1({...args})),
   definition:topic.definition+" Revisión editorial posterior a búsqueda sin aprobar."}});
  assert.equal(updated.topics.find(item=>item.term_key===topic.term_key)!.definition_revision,topic.definition_revision+1);
  const archived=await setSignalTopicLifecycleStoreV1({...args,idempotency_key:randomUUID(),lifecycle:"archived",...(await currentTopicDefinitionCasV1({...args}))});
  assert.equal(archived.topics.find(item=>item.term_key===topic.term_key)!.status,"archived");
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid",[f.workspace_id])).rows[0].count,before);
  assert.equal((await f.query("SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid",[ready.id])).rows[0].status,"ready");
 }finally{await f.cleanup();}
});

test("workspace Topic pages retain exact coverage and root checkpoint replays atomically without approving assignments",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{const lease=await f.begin(),{root,result}=await score(f,lease);
  assert.equal(root.semantic_scope_available,false);assert.equal(result.candidates[0]!.disposition,"doubt");
  await assert.rejects(core.commitSignalWorkspaceTopicRootV1({database:f.database,lease,root_id:root.root_id,result:{...result,processed_chunks:result.processed_chunks+1}}),/workspace_topic_result_invalid/u);
  const next=await core.commitSignalWorkspaceTopicRootV1({database:f.database,lease,root_id:root.root_id,result});assert.equal(next.cursor_root_id,root.root_id);
  assert.deepEqual(await core.commitSignalWorkspaceTopicRootV1({database:f.database,lease,root_id:root.root_id,result}),next);
  await f.query("BEGIN");try{await assert.rejects(f.query(`INSERT INTO signal_topic_classification_suggestions
   SELECT (jsonb_populate_record(NULL::signal_topic_classification_suggestions,to_jsonb(item)||jsonb_build_object('disposition','relevant'))).*
   FROM signal_topic_classification_suggestions item WHERE execution_id=$1::uuid LIMIT 1`,[lease.execution_id]),/retrieval only/u);
  }finally{await f.query("ROLLBACK");}
  await assert.rejects(core.readSignalWorkspaceTopicRootPageV1({database:f.database,lease}),/workspace_topic_lease_lost/u);
  await assert.rejects(core.finishSignalWorkspaceTopicComputationV1({database:f.database,lease:next}),/workspace_topic_coverage_incomplete/u);
  assert.equal((await f.query("SELECT 1 FROM signal_topic_classification_items WHERE execution_id=$1::uuid",[lease.execution_id])).rowCount,1);
  assert.equal((await f.query("SELECT 1 FROM signal_classification_assignments WHERE workspace_id=$1::uuid",[f.workspace_id])).rowCount,0);
  await core.failSignalWorkspaceTopicComputationV1({database:f.database,lease:next,error_code:"workspace_topic_worker_failed"});
  const retry=await core.retrySignalWorkspaceTopicComputationV1({...f.scope,execution_id:lease.execution_id});assert.equal(retry.execution_id,lease.execution_id);
  const resumed=await f.claim(retry.execution_id);assert.equal(resumed.cursor_root_id,root.root_id);assert.notEqual(resumed.execution_token,next.execution_token);
 }finally{await f.cleanup();}
});

test("workspace Topic access, input drift and immutable seals reject false evidence and preserve staged coverage",{skip:!enabled,timeout:60_000},async()=>{
 const f=await fixture();try{const lease=await f.begin();
  await assert.rejects(core.readSignalWorkspaceTopicRootPageV1({database:f.database,lease:{...lease,workspace_id:randomUUID()}}),/workspace_topic_lease_lost/u);
  await f.query("BEGIN");try{await assert.rejects(f.query("UPDATE signal_topic_catalog_executions SET input_revision=input_revision+1 WHERE id=$1::uuid",[lease.execution_id]),/immutable/u);}finally{await f.query("ROLLBACK");}
  await f.query("BEGIN");try{await assert.rejects(f.query("UPDATE signal_topic_catalog_executions SET status='ready',completed_at=clock_timestamp() WHERE id=$1::uuid",[lease.execution_id]),/coverage is incomplete/u);}finally{await f.query("ROLLBACK");}
  await f.query("BEGIN");try{await f.query("UPDATE users SET status='suspended' WHERE id=$1::uuid",[f.actor_user_id]);
   await assert.rejects(core.readSignalWorkspaceTopicRootPageV1({database:f.database,lease}),/workspace_topic_forbidden/u);
  }finally{await f.query("ROLLBACK");}
  await f.query("BEGIN");try{await f.query("UPDATE data_sources SET status='inactive' WHERE workspace_id=$1::uuid",[f.workspace_id]);
   await assert.rejects(core.readSignalWorkspaceTopicRootPageV1({database:f.database,lease}),/workspace_topic_inputs_changed/u);
  }finally{await f.query("ROLLBACK");}
  await f.query("UPDATE brands SET description='Changed context' WHERE id=$1::uuid",[f.brand]);
  await assert.rejects(core.finishSignalWorkspaceTopicComputationV1({database:f.database,lease}),/workspace_topic_context_changed/u);
 }finally{await f.cleanup();}
});
