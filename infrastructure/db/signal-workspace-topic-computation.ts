import type {Pool} from "pg";
import type {SignalTopicDefinitionV1,SignalWorkspaceEmbeddingProfileV1,SignalWorkspaceTopicInputsV1,SignalWorkspaceTopicSearchProfileV1,
 SignalWorkspaceSearchTopicV1,SignalWorkspaceTopicPrototypeV1,SignalWorkspaceTopicSearchCandidateV1} from "@noisia/query-engine";

export type SignalWorkspaceTopicDatabaseV1=Pick<Pool,"query"|"connect">;
export type SignalWorkspaceTopicQueryableV1={query<Row extends Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:Row[]}>};
export class SignalWorkspaceTopicComputationError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);this.name="SignalWorkspaceTopicComputationError";}
}
export type SignalWorkspaceTopicLeaseV1={execution_id:string;workspace_id:string;execution_token:string;cursor_root_id:string|null;input_digest:string};
export type SignalWorkspaceTopicRootV1={root_id:string;asset_sha256:string;fingerprint:string;expected_chunks:number;
 root_metadata:Record<string,unknown>;scopes:string[];semantic_scope_available:boolean};
export type SignalWorkspaceTopicRootPageV1={items:SignalWorkspaceTopicRootV1[];done:boolean};
export type SignalWorkspaceTopicChunkPageV1={root_id:string;asset_sha256:string;expected_chunks:number;after_chunk_index:number|null;
 items:Array<{chunk_index:number;start:number;end:number;chunk_sha256:string;text:string;vector:number[]}>;done:boolean;next_chunk_index:number|null};
export type SignalWorkspaceTopicTextCacheV1={entry?:{workspace_id:string;asset_sha256:string;text:string}};
export type SignalWorkspaceTopicDefinitionSnapshotV1={taxonomy_term_id:string;definition:SignalTopicDefinitionV1;
 compiled:Omit<SignalWorkspaceTopicInputsV1,"inputs">&{inputs:Array<Omit<SignalWorkspaceTopicInputsV1["inputs"][number],"text">>}};
export type SignalWorkspaceTopicSnapshotV1={contract_version:"workspace-topic-computation-v1";embedding_profile:SignalWorkspaceEmbeddingProfileV1;
 context_digest:string;definition_digest:string;correction_digest:string;algorithm_profile:SignalWorkspaceTopicSearchProfileV1;
 topics:SignalWorkspaceTopicDefinitionSnapshotV1[];texts:Record<string,string>};

import type {PoolClient} from "pg";
import {createHash,randomUUID} from "node:crypto";
import {assertSignalWorkspaceEmbeddingProfileV1,assertSignalWorkspaceTopicSearchProfileV1,
 compileSignalWorkspaceTopicInputsV1,signalTopicDefinitionSchemaV1,signalWorkspaceEmbeddingDigestV1,
 SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from "@noisia/query-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {loadSignalTopicInheritedContextStoreV1} from "./signal-topic-catalog";
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceTopicComputationError(code,status);};
const sha=(text:string)=>`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;
const natural=(value:unknown):number=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)return fail("workspace_topic_count_invalid",503);return n;};
const pageLimit=(value:number|undefined,maximum:number)=>{const n=value??maximum;if(!Number.isSafeInteger(n)||n<1||n>maximum)return fail("workspace_topic_page_invalid",422);return n;};
async function transaction<T>(database:SignalWorkspaceTopicDatabaseV1,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await database.connect();try{await client.query("BEGIN");await client.query("SET LOCAL TIME ZONE 'UTC'");const result=await work(client);await client.query("COMMIT");return result;}
 catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
type Run={id:string;workspace_id:string;actor_user_id:string;taxonomy_profile_id:string;embedding_run_id:string;preparation_run_id:string;
 input_digest:string;input_revision:string;current_revision:string;embedding_config_digest:string;status:string;execution_token:string|null;
 cursor_root_id:string|null;execution_live:boolean;policy_live:boolean;embedding_complete:boolean;preparation_complete:boolean;
 denominator:number;expected_chunks:string;processed_roots:number;processed_chunks:string;worker_job_id:string;
 embedding_profile:SignalWorkspaceEmbeddingProfileV1;algorithm_profile:SignalWorkspaceTopicSearchProfileV1;
 context_digest:string;definition_digest:string;correction_digest:string};
async function authorize(queryable:SignalWorkspaceTopicQueryableV1,workspace_id:string,actor_user_id:string){
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable,workspace_id,actor_user_id})).can_execute_topics)return fail("workspace_topic_forbidden",403);
}
async function lockRun(client:PoolClient,id:string):Promise<Run>{
 const scope=(await client.query<{workspace_id:string}>("SELECT workspace_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND input_contract='workspace-topic-computation-v1'",[id])).rows[0];
 if(!scope)return fail("workspace_topic_execution_not_found",404);
 await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE",[scope.workspace_id]);
 const row=(await client.query<Run>(`SELECT execution.id,execution.workspace_id,execution.actor_user_id,execution.taxonomy_profile_id,
  execution.embedding_run_id,execution.preparation_run_id,execution.input_digest,execution.input_revision::text,state.input_revision::text current_revision,
  execution.embedding_config_digest,execution.status,execution.execution_token,execution.cursor_root_id,execution.execution_expires_at>clock_timestamp() execution_live,
  (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) policy_live,
  embedding.status='completed' embedding_complete,prep.status='completed' preparation_complete,execution.denominator,
  execution.expected_chunks::text,execution.processed_roots,execution.processed_chunks::text,outbox.worker_job_id,
  execution.input_snapshot->'embedding_profile' embedding_profile,execution.input_snapshot->'algorithm_profile' algorithm_profile,
  execution.input_snapshot->>'context_digest' context_digest,execution.definition_digest,
  execution.input_snapshot->>'correction_digest' correction_digest
 FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
 JOIN signal_workspace_embedding_runs embedding ON embedding.id=execution.embedding_run_id AND embedding.workspace_id=execution.workspace_id AND embedding.input_contract='corpus'
 JOIN signal_corpus_preparation_runs prep ON prep.id=execution.preparation_run_id AND prep.workspace_id=execution.workspace_id
 JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id
 WHERE execution.id=$1::uuid FOR UPDATE OF execution`,[id])).rows[0];
 if(!row)return fail("workspace_topic_execution_not_found",404);
 assertSignalWorkspaceEmbeddingProfileV1(row.embedding_profile);assertSignalWorkspaceTopicSearchProfileV1(row.algorithm_profile);return row;
}
function leaseView(run:Run,token:string):SignalWorkspaceTopicLeaseV1{return{execution_id:run.id,workspace_id:run.workspace_id,
 execution_token:token,cursor_root_id:run.cursor_root_id,input_digest:run.input_digest};}
function checkCurrent(run:Run){if(run.input_revision!==run.current_revision||!run.policy_live||!run.embedding_complete||!run.preparation_complete)return fail("workspace_topic_inputs_changed");}
async function requireLease(client:PoolClient,lease:SignalWorkspaceTopicLeaseV1){
 const run=await lockRun(client,lease.execution_id);
 if(run.workspace_id!==lease.workspace_id||run.input_digest!==lease.input_digest||run.execution_token!==lease.execution_token
  ||run.status!=="running"||!run.execution_live||run.cursor_root_id!==lease.cursor_root_id)return fail("workspace_topic_lease_lost");
 await authorize(client,run.workspace_id,run.actor_user_id);checkCurrent(run);
 await client.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()+interval '120 seconds',heartbeat_at=clock_timestamp() WHERE id=$1::uuid",[run.id]);
 return run;
}
async function contextSnapshot(client:SignalWorkspaceTopicQueryableV1,workspace:string,profileId?:string){
 const profile=(await client.query<{id:string;taxonomy_id:string}>(`SELECT id,taxonomy_id FROM signal_taxonomy_profiles
  WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','activating','active')
   AND metadata->>'contract_version'='signal-topic-catalog-v1' AND ($2::uuid IS NULL OR id=$2::uuid)
  ORDER BY version DESC LIMIT 1`,[workspace,profileId??null])).rows[0];
 if(!profile)return fail("workspace_topic_catalog_required");
 const context=await loadSignalTopicInheritedContextStoreV1({queryable:client,workspace_id:workspace,complete_context:true});
 const rows=(await client.query<{id:string;metadata:unknown;status:string}>("SELECT id,metadata,status FROM taxonomy_terms WHERE taxonomy_id=$1::uuid ORDER BY term_key",[profile.taxonomy_id])).rows;
 const topics=rows.map(row=>{const metadata=row.metadata as{topic?:unknown};const definition=signalTopicDefinitionSchemaV1.parse(metadata?.topic);
  return{taxonomy_term_id:row.id,definition};}).filter(row=>row.definition.lifecycle!=="archived");
 const correction=(await client.query<{digest:string}>("SELECT signal_topic_membership_override_digest_v1($1::uuid,$2::uuid) digest",[workspace,profile.id])).rows[0]!.digest;
 return{profile,context,topics,correction_digest:correction,definition_digest:signalWorkspaceEmbeddingDigestV1({
  topics:topics.map(topic=>({id:topic.taxonomy_term_id,digest:topic.definition.definition_digest})),context_digest:context.context_digest})};
}
async function verifyContext(client:PoolClient,run:Run){
 const current=await contextSnapshot(client,run.workspace_id,run.taxonomy_profile_id);
 if(current.context.context_digest!==run.context_digest||current.definition_digest!==run.definition_digest||current.correction_digest!==run.correction_digest)
  return fail("workspace_topic_context_changed");
 const latest=(await client.query<{id:string}>(`SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic'
  AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1`,[run.workspace_id])).rows[0];
 if(latest?.id!==run.taxonomy_profile_id)return fail("workspace_topic_context_changed");
}
export async function claimSignalWorkspaceTopicComputationV1(args:{database:SignalWorkspaceTopicDatabaseV1;execution_id:string;worker_job_id:string}):Promise<SignalWorkspaceTopicLeaseV1|null>{
 return transaction(args.database,async client=>{const run=await lockRun(client,args.execution_id);
  if(run.worker_job_id!==args.worker_job_id||!["queued","running"].includes(run.status)||run.status==="running"&&run.execution_live)return null;
  try{await authorize(client,run.workspace_id,run.actor_user_id);checkCurrent(run);await verifyContext(client,run);}
  catch(error){if(!(error instanceof SignalWorkspaceTopicComputationError))throw error;
   await client.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,completed_at=clock_timestamp(),
    execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,error.code]);
   await client.query("UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE execution_id=$1::uuid",[run.id]);return null;}
  const token=randomUUID();await client.query(`UPDATE signal_topic_catalog_executions SET status='running',error_code=NULL,
   execution_token=$2::uuid,execution_expires_at=clock_timestamp()+interval '120 seconds',started_at=COALESCE(started_at,clock_timestamp()),
   completed_at=NULL,heartbeat_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,token]);
  await client.query("UPDATE signal_topic_classification_outbox SET status='dispatched',completed_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE execution_id=$1::uuid",[run.id]);
  return leaseView(run,token);
 });
}
async function rootRows(client:PoolClient,run:Run,limit:number,rootId?:string):Promise<SignalWorkspaceTopicRootV1[]>{
 const rows=(await client.query<{root_id:string;asset_sha256:string;fingerprint:string;root_metadata:Record<string,unknown>;expected_chunks:number;scopes:string[]}>(`
  SELECT item.root_id,item.asset_sha256,item.fingerprint,item.root_metadata,jsonb_array_length(asset.chunks->'chunks') expected_chunks,
   ARRAY(SELECT DISTINCT assertion->>'scope' FROM jsonb_array_elements(item.provenance) path,
    jsonb_array_elements(path->'semantic_assertions') assertion WHERE path->>'authorized'='true'
    AND assertion->>'scope' IN('primary_brand','competitor','category') ORDER BY assertion->>'scope') scopes
  FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
   AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
  WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible'
   AND ($3::uuid IS NULL OR item.root_id>$3::uuid) AND ($4::uuid IS NULL OR item.root_id=$4::uuid)
  ORDER BY item.root_id LIMIT $5`,[run.preparation_run_id,run.workspace_id,run.cursor_root_id,rootId??null,limit])).rows;
 return rows.map(row=>({...row,expected_chunks:natural(row.expected_chunks),semantic_scope_available:row.scopes.length>0}));
}
export async function readSignalWorkspaceTopicRootPageV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;limit?:number}):Promise<SignalWorkspaceTopicRootPageV1>{
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease),limit=pageLimit(args.limit,100);
  const roots=await rootRows(client,run,limit+1);return{items:roots.slice(0,limit),done:roots.length<=limit};});
}
export async function readSignalWorkspaceTopicRootChunksV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;
 root_id:string;after_chunk_index:number|null;limit?:number;text_cache?:SignalWorkspaceTopicTextCacheV1}):Promise<SignalWorkspaceTopicChunkPageV1>{
 const limit=pageLimit(args.limit,128);if(args.after_chunk_index!==null&&!Number.isSafeInteger(args.after_chunk_index)||args.after_chunk_index!==null&&args.after_chunk_index<0)return fail("workspace_topic_chunk_cursor_invalid",422);
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease),root=(await rootRows(client,run,1,args.root_id))[0];
  if(!root)return fail("workspace_topic_root_unavailable",404);
  const rows=(await client.query<{chunk_index:number;start:number;end:number;chunk_sha256:string;vector:string|null}>(`
   SELECT (chunk.ordinality-1)::int chunk_index,(chunk.value->>'start')::int start,(chunk.value->>'end')::int "end",
    chunk.value->>'sha256' chunk_sha256,cache.embedding::text vector
   FROM signal_corpus_text_assets asset CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
   LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=asset.workspace_id
    AND cache.config_digest=$4 AND cache.chunk_sha256=chunk.value->>'sha256'
   WHERE asset.workspace_id=$1::uuid AND asset.text_sha256=$2 AND asset.chunk_policy_version=$3
    AND chunk.ordinality-1>COALESCE($5::int,-1) ORDER BY chunk.ordinality LIMIT $6`,
   [run.workspace_id,root.asset_sha256,run.embedding_profile.chunk_policy_version,run.embedding_config_digest,args.after_chunk_index,limit])).rows;
  const cached=args.text_cache?.entry;
  let text=cached?.workspace_id===run.workspace_id&&cached.asset_sha256===root.asset_sha256?cached.text:undefined;
  if(text===undefined){text=(await client.query<{full_text:string}>("SELECT full_text FROM signal_corpus_text_assets WHERE workspace_id=$1::uuid AND text_sha256=$2 AND chunk_policy_version=$3",
    [run.workspace_id,root.asset_sha256,run.embedding_profile.chunk_policy_version])).rows[0]?.full_text;
   if(text===undefined||sha(text)!==root.asset_sha256)return fail("workspace_topic_asset_invalid");
   if(args.text_cache)args.text_cache.entry=Buffer.byteLength(text,"utf8")<=16*1024*1024?{workspace_id:run.workspace_id,asset_sha256:root.asset_sha256,text}:undefined;
  }
  const items=rows.map(row=>{if(row.vector===null)return fail("workspace_topic_corpus_embeddings_incomplete");
   const part=text!.slice(row.start,row.end);if(sha(part)!==row.chunk_sha256)return fail("workspace_topic_asset_invalid");
   const vector=JSON.parse(row.vector) as number[];if(vector.length!==1024||vector.some(value=>!Number.isFinite(value)))return fail("workspace_topic_vector_invalid");
   return{...row,text:part,vector};});
  const next=items.at(-1)?.chunk_index??args.after_chunk_index;
  return{root_id:root.root_id,asset_sha256:root.asset_sha256,expected_chunks:root.expected_chunks,after_chunk_index:args.after_chunk_index,
   items,next_chunk_index:next,done:next!==null&&next+1===root.expected_chunks};
 });
}

async function snapshot(client:SignalWorkspaceTopicQueryableV1,workspace:string,profile:SignalWorkspaceEmbeddingProfileV1,allowEmpty=false){
 const current=await contextSnapshot(client,workspace),texts:Record<string,string>={};
 const topics=current.topics.map(topic=>{
  const compiled=compileSignalWorkspaceTopicInputsV1({topic:topic.definition,
   context:{...current.context.embedding_contexts[topic.definition.scope],context_refs:current.context.context_refs},profile});
  return{...topic,compiled:{...compiled,inputs:compiled.inputs.map(({text,...input})=>{texts[input.text_sha256]=text;return input;})}};
 });
 if(topics.length===0&&!allowEmpty)return fail("workspace_topic_catalog_empty");
 return{profile_id:current.profile.id,input:{contract_version:"workspace-topic-computation-v1" as const,
  embedding_profile:profile,context_digest:current.context.context_digest,definition_digest:current.definition_digest,
  correction_digest:current.correction_digest,algorithm_profile:SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1,topics,texts}};
}
async function missingPrototypes(client:PoolClient,workspace:string,input:SignalWorkspaceTopicSnapshotV1){
 const inputs=input.topics.flatMap(topic=>topic.compiled.inputs.map(item=>({input_digest:item.input_digest,text_sha256:item.text_sha256})));
 return natural((await client.query<{missing:string}>(`SELECT count(*)::text missing FROM jsonb_to_recordset($2::jsonb) expected(input_digest text,text_sha256 text)
 LEFT JOIN signal_topic_definition_embeddings cache ON cache.workspace_id=$1::uuid AND cache.definition_digest=expected.input_digest
  AND cache.embedding_config_digest=$3 AND cache.input_text_sha256=expected.text_sha256 AND cache.embedding_model=$4 AND cache.provider=$5
 WHERE cache.id IS NULL`,[workspace,JSON.stringify(inputs),input.embedding_profile.config_digest,input.embedding_profile.model,input.embedding_profile.provider])).rows[0]!.missing);
}
/** Server-only preparation of the exact immutable definition/context inputs. No vectors or provider calls. */
export async function loadSignalWorkspaceTopicInputSnapshotV1(args:{database:SignalWorkspaceTopicDatabaseV1;workspace_id:string;actor_user_id:string}){
 return transaction(args.database,client=>loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({...args,queryable:client}));
}
/** Caller owns transaction/snapshot consistency. This read never creates a run or another pool. */
export async function loadSignalWorkspaceTopicInputSnapshotWithQueryableV1(args:{queryable:SignalWorkspaceTopicQueryableV1;workspace_id:string;actor_user_id:string;allow_empty?:boolean}){
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:args.queryable,
  workspace_id:args.workspace_id,actor_user_id:args.actor_user_id})).can_view)return fail("workspace_topic_forbidden",403);
 return snapshot(args.queryable,args.workspace_id,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,args.allow_empty);
}
export async function requestSignalWorkspaceTopicComputationV1(args:{database:SignalWorkspaceTopicDatabaseV1;workspace_id:string;actor_user_id:string;
 idempotency_key:string;embedding_run_id:string;algorithm_profile?:SignalWorkspaceTopicSearchProfileV1}):Promise<{execution_id:string;replayed:boolean}>{
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail("workspace_topic_idempotency_key_invalid",422);
 const algorithm=args.algorithm_profile??SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1;assertSignalWorkspaceTopicSearchProfileV1(algorithm);
 const requestDigest=signalWorkspaceEmbeddingDigestV1({embedding_run_id:args.embedding_run_id,algorithm_profile:algorithm});
 return transaction(args.database,async client=>{
  await authorize(client,args.workspace_id,args.actor_user_id);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${args.workspace_id}:topic`]);
  const prior=(await client.query<{id:string;actor_user_id:string;request_digest:string;input_contract:string}>(`SELECT id,actor_user_id,request_digest,input_contract
   FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.actor_user_id!==args.actor_user_id||prior.request_digest!==requestDigest||prior.input_contract!=="workspace-topic-computation-v1")return fail("workspace_topic_idempotency_conflict");
   return{execution_id:prior.id,replayed:true};}
  await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE",[args.workspace_id]);
  const embedded=(await client.query<{id:string;preparation_run_id:string;input_revision:string;profile:SignalWorkspaceEmbeddingProfileV1;counts:{eligible_roots:number;completed_roots:number;total_chunk_references:number;processed_chunk_references:number};
   policy_valid_until:string|null}>(`SELECT run.id,run.preparation_run_id,run.input_revision::text,run.profile,run.counts,
    to_char(run.policy_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') policy_valid_until
   FROM signal_workspace_embedding_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
   JOIN signal_corpus_preparation_runs prep ON prep.id=run.preparation_run_id AND prep.workspace_id=run.workspace_id
   WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid AND run.input_contract='corpus' AND run.status='completed' AND prep.status='completed'
    AND run.input_revision=state.input_revision AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())`,
   [args.embedding_run_id,args.workspace_id])).rows[0];
  if(!embedded)return fail("workspace_topic_complete_embeddings_required");assertSignalWorkspaceEmbeddingProfileV1(embedded.profile);
  if(embedded.counts.completed_roots!==embedded.counts.eligible_roots||embedded.counts.processed_chunk_references!==embedded.counts.total_chunk_references)return fail("workspace_topic_corpus_embeddings_incomplete");
  const built=await snapshot(client,args.workspace_id,embedded.profile);
  if(await missingPrototypes(client,args.workspace_id,built.input)>0)return fail("workspace_topic_prototypes_required");
  const active=(await client.query("SELECT id FROM signal_topic_catalog_executions WHERE taxonomy_profile_id=$1::uuid AND status IN('queued','running')",[built.profile_id])).rows[0];
  if(active)return fail("workspace_topic_execution_active");
  const id=randomUUID(),job=`workspace-topic-${id}-1`;
  const populationDigest=signalWorkspaceEmbeddingDigestV1({preparation_run_id:embedded.preparation_run_id,
   input_revision:embedded.input_revision,eligible_roots:embedded.counts.eligible_roots,total_chunk_references:embedded.counts.total_chunk_references});
  await client.query(`INSERT INTO signal_topic_catalog_executions(id,workspace_id,taxonomy_profile_id,study_corpus_id,actor_user_id,intent,
   idempotency_key,request_digest,population_digest,watermark_digest,identity_catalog_digest,definition_digest,denominator,
   embedding_model,input_contract,embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,input_snapshot,input_digest,policy_valid_until,expected_chunks)
   VALUES($1::uuid,$2::uuid,$3::uuid,NULL,$4::uuid,'search',$5,$6,$7,$8,$7,$9,$10,$11,'workspace-topic-computation-v1',
   $12::uuid,$13::uuid,$14,$15,$16::jsonb,'sha256:'||encode(sha256(convert_to($16::jsonb::text,'UTF8')),'hex'),$17::timestamptz,$18)`,
   [id,args.workspace_id,built.profile_id,args.actor_user_id,args.idempotency_key,requestDigest,populationDigest,
    signalWorkspaceEmbeddingDigestV1({input_revision:embedded.input_revision,embedding_run_id:embedded.id}),built.input.definition_digest,
    embedded.counts.eligible_roots,embedded.profile.model,embedded.id,embedded.preparation_run_id,embedded.input_revision,
    embedded.profile.config_digest,JSON.stringify(built.input),embedded.policy_valid_until,embedded.counts.total_chunk_references]);
  await client.query("INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)",[id,args.workspace_id,job]);
  return{execution_id:id,replayed:false};
 });
}
export async function readSignalWorkspaceTopicDefinitionsV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;after_term_key:string|null;limit?:number})
 :Promise<{items:SignalWorkspaceSearchTopicV1[];done:boolean;next_term_key:string|null}>{
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease),limit=pageLimit(args.limit,32);
  const topics=(await client.query<SignalWorkspaceSearchTopicV1>(`SELECT topic->>'taxonomy_term_id' taxonomy_term_id,
   topic->'definition'->>'term_key' term_key,topic->'definition'->>'scope' scope,
   topic->'definition'->>'definition_digest' definition_digest,topic->'compiled'->>'compiler_digest' compiler_digest,
   jsonb_array_length(topic->'compiled'->'inputs') prototype_count,
   (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg('["'||(input->>'input_digest')||'","'||(input->>'role')||'"]'||E'\n',''
     ORDER BY (input->>'input_digest') COLLATE "C"),''),'UTF8')),'hex') FROM jsonb_array_elements(topic->'compiled'->'inputs') input) prototype_digest
   FROM signal_topic_catalog_executions execution,
   LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic WHERE execution.id=$1::uuid
    AND ($2::text IS NULL OR (topic->'definition'->>'term_key') COLLATE "C">$2 COLLATE "C")
   ORDER BY (topic->'definition'->>'term_key') COLLATE "C" LIMIT $3`,[run.id,args.after_term_key,limit+1])).rows;
  return{items:topics.slice(0,limit),done:topics.length<=limit,next_term_key:topics.slice(0,limit).at(-1)?.term_key??args.after_term_key};
 });
}
export type SignalWorkspaceTopicPrototypeCursorV1={term_key:string;input_digest:string}|null;
export async function readSignalWorkspaceTopicPrototypesV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;term_keys:string[];
 after:SignalWorkspaceTopicPrototypeCursorV1;limit?:number}):Promise<{items:SignalWorkspaceTopicPrototypeV1[];done:boolean;next_cursor:SignalWorkspaceTopicPrototypeCursorV1}>{
 const limit=pageLimit(args.limit,128);if(args.term_keys.length<1||args.term_keys.length>32||new Set(args.term_keys).size!==args.term_keys.length)return fail("workspace_topic_page_invalid",422);
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
  const rows=(await client.query<{term_key:string;role:SignalWorkspaceTopicPrototypeV1["role"];input_digest:string;embedding_config_digest:string;vector:string|null}>(`
   WITH inputs AS (SELECT topic->'definition'->>'term_key' term_key,input FROM signal_topic_catalog_executions execution,
    LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic,
    LATERAL jsonb_array_elements(topic->'compiled'->'inputs') input
    WHERE execution.id=$1::uuid AND topic->'definition'->>'term_key'=ANY($2::text[]))
   SELECT inputs.term_key,input->>'role' role,input->>'input_digest' input_digest,$3::text embedding_config_digest,cache.embedding::text vector
   FROM inputs LEFT JOIN signal_topic_definition_embeddings cache ON cache.workspace_id=$4::uuid
    AND cache.definition_digest=input->>'input_digest' AND cache.input_text_sha256=input->>'text_sha256'
    AND cache.embedding_config_digest=$3 AND cache.embedding_model=$5 AND cache.provider=$6
   WHERE $7::text IS NULL OR (inputs.term_key COLLATE "C",(input->>'input_digest') COLLATE "C")>($7 COLLATE "C",$8 COLLATE "C")
   ORDER BY inputs.term_key COLLATE "C",(input->>'input_digest') COLLATE "C" LIMIT $9`,
   [run.id,args.term_keys,run.embedding_config_digest,run.workspace_id,run.embedding_profile.model,run.embedding_profile.provider,
    args.after?.term_key??null,args.after?.input_digest??null,limit+1])).rows;
  const items=rows.slice(0,limit).map(row=>{if(row.vector===null)return fail("workspace_topic_prototypes_required");
   const vector=JSON.parse(row.vector) as number[];if(vector.length!==1024||vector.some(value=>!Number.isFinite(value)))return fail("workspace_topic_vector_invalid");return{...row,vector};});
  const last=items.at(-1);return{items,done:rows.length<=limit,next_cursor:last?{term_key:last.term_key,input_digest:last.input_digest}:args.after};
 });
}

export type SignalWorkspaceTopicRootResultV1={candidates:SignalWorkspaceTopicSearchCandidateV1[];evaluated_topic_count:number;
 retained_candidate_count:number;omitted_candidate_count:number;candidate_limit:32;quality:"uncalibrated";approval_policy:"none";
 result_kind:"retrieval_shortlist";processed_chunks:number;root_fingerprint:string;semantic_scope_available:boolean};
export async function commitSignalWorkspaceTopicRootV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;root_id:string;
 result:SignalWorkspaceTopicRootResultV1}):Promise<SignalWorkspaceTopicLeaseV1>{
 const resultDigest=signalWorkspaceEmbeddingDigestV1(args.result);
 return transaction(args.database,async client=>{
  const existingRun=await lockRun(client,args.lease.execution_id);
  if(existingRun.workspace_id!==args.lease.workspace_id||existingRun.input_digest!==args.lease.input_digest
   ||existingRun.execution_token!==args.lease.execution_token||existingRun.status!=="running"||!existingRun.execution_live)return fail("workspace_topic_lease_lost");
  await authorize(client,existingRun.workspace_id,existingRun.actor_user_id);checkCurrent(existingRun);
  const existing=(await client.query<{item_digest:string}>("SELECT item_digest FROM signal_topic_classification_items WHERE execution_id=$1::uuid AND canonical_root_id=$2::uuid",[existingRun.id,args.root_id])).rows[0];
  if(existing){if(existing.item_digest!==resultDigest)return fail("workspace_topic_result_conflict");return leaseView(existingRun,args.lease.execution_token);}
  const run=await requireLease(client,args.lease),root=(await rootRows(client,run,1))[0];
  if(!root||root.root_id!==args.root_id)return fail("workspace_topic_checkpoint_invalid");
  const result=args.result;
  const compatibleCount=natural((await client.query<{count:string}>(`SELECT count(*)::text count FROM signal_topic_catalog_executions execution,
   LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic WHERE execution.id=$1::uuid
   AND ($2::boolean=false OR topic->'definition'->>'scope'=ANY($3::text[]))`,[run.id,root.semantic_scope_available,root.scopes])).rows[0]!.count);
  if(result.quality!=="uncalibrated"||result.approval_policy!=="none"||result.result_kind!=="retrieval_shortlist"||result.candidate_limit!==32
   ||result.root_fingerprint!==root.fingerprint||result.semantic_scope_available!==root.semantic_scope_available
   ||result.processed_chunks!==root.expected_chunks||result.evaluated_topic_count!==compatibleCount
   ||result.retained_candidate_count!==Math.min(32,compatibleCount)||result.candidates.length!==result.retained_candidate_count
   ||result.omitted_candidate_count!==compatibleCount-result.retained_candidate_count)return fail("workspace_topic_result_invalid");
  const coverage=(await client.query<{digest:string}>(`SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
   '['||(chunk.ordinality-1)::text||','||(chunk.value->>'start')||','||(chunk.value->>'end')||',"'||(chunk.value->>'sha256')||'"]'||E'\n',
   '' ORDER BY chunk.ordinality),''),'UTF8')),'hex') digest FROM signal_corpus_text_assets asset,
   LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
   WHERE asset.workspace_id=$1::uuid AND asset.text_sha256=$2 AND asset.chunk_policy_version=$3`,
   [run.workspace_id,root.asset_sha256,run.embedding_profile.chunk_policy_version])).rows[0]!.digest;
  const checks=(await client.query<{taxonomy_term_id:string;term_key:string;scope:string;definition_digest:string;compiler_digest:string;best_valid:boolean}>(`
   SELECT topic->>'taxonomy_term_id' taxonomy_term_id,topic->'definition'->>'term_key' term_key,topic->'definition'->>'scope' scope,
    topic->'definition'->>'definition_digest' definition_digest,topic->'compiled'->>'compiler_digest' compiler_digest,
    ((asset.chunks->'chunks'->(candidate->'evidence'->'best_chunk'->>'chunk_index')::int->>'sha256')=candidate->'evidence'->'best_chunk'->>'chunk_sha256'
     AND (asset.chunks->'chunks'->(candidate->'evidence'->'best_chunk'->>'chunk_index')::int->>'start')=candidate->'evidence'->'best_chunk'->>'start'
     AND (asset.chunks->'chunks'->(candidate->'evidence'->'best_chunk'->>'chunk_index')::int->>'end')=candidate->'evidence'->'best_chunk'->>'end'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(topic->'compiled'->'inputs') input WHERE input->>'role'='topic_positive'
      AND input->>'input_digest'=candidate->'evidence'->'best_chunk'->>'positive_input_digest')
     AND (candidate->'evidence'->'best_chunk'->>'negative_input_digest' IS NULL OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(topic->'compiled'->'inputs') input WHERE input->>'role'='topic_negative'
       AND input->>'input_digest'=candidate->'evidence'->'best_chunk'->>'negative_input_digest'))) best_valid
   FROM signal_topic_catalog_executions execution CROSS JOIN LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic
   JOIN jsonb_array_elements($2::jsonb) candidate ON candidate->>'taxonomy_term_id'=topic->>'taxonomy_term_id'
    AND candidate->>'term_key'=topic->'definition'->>'term_key'
   JOIN signal_corpus_text_assets asset ON asset.workspace_id=execution.workspace_id AND asset.text_sha256=$3 AND asset.chunk_policy_version=$4
   WHERE execution.id=$1::uuid AND ($5::boolean=false OR topic->'definition'->>'scope'=ANY($6::text[]))`,
   [run.id,JSON.stringify(result.candidates),root.asset_sha256,run.embedding_profile.chunk_policy_version,root.semantic_scope_available,root.scopes])).rows;
  const seen=new Set<string>();
  for(const candidate of result.candidates){
   const topic=checks.find(topic=>topic.taxonomy_term_id===candidate.taxonomy_term_id&&topic.term_key===candidate.term_key);
   const evidence=candidate.evidence;
   if(!topic||topic.best_valid!==true||seen.has(candidate.term_key)||candidate.scope!==topic.scope||candidate.disposition!=="doubt"||candidate.method!=="semantic"
    ||candidate.lexical_match!==false||candidate.excluded_by_rule!==false||candidate.excluded_by_negative!==false
    ||!Number.isFinite(candidate.semantic_score)||candidate.semantic_score< -1||candidate.semantic_score>1
    ||candidate.negative_semantic_score!==null&&(!Number.isFinite(candidate.negative_semantic_score)||candidate.negative_semantic_score< -1||candidate.negative_semantic_score>1)
    ||evidence.contract_version!=="signal-workspace-topic-search-v1"||evidence.scoring_policy!=="chunk-local-contrast-ranking-v1"
    ||evidence.quality!=="uncalibrated"||evidence.approval_policy!=="none"||evidence.embedding_config_digest!==run.embedding_config_digest
    ||evidence.asset_sha256!==root.asset_sha256||evidence.evaluated_chunk_count!==root.expected_chunks||evidence.evaluated_chunks_digest!==coverage
    ||evidence.definition_digest!==topic.definition_digest||evidence.compiler_digest!==topic.compiler_digest
    ||evidence.positive_score!==candidate.semantic_score||evidence.negative_score!==candidate.negative_semantic_score
    ||evidence.ranking_score!==evidence.positive_score-Math.max(evidence.negative_score??0,0)
    ||candidate.evidence_digest!==signalWorkspaceEmbeddingDigestV1(evidence))return fail("workspace_topic_evidence_invalid");
   seen.add(candidate.term_key);
  }
  const evidence={contract_version:"workspace-topic-computation-v1",embedding_config_digest:run.embedding_config_digest,
   asset_sha256:root.asset_sha256,expected_chunks:root.expected_chunks,processed_chunks:result.processed_chunks,
   evaluated_topic_count:result.evaluated_topic_count,retained_candidate_count:result.retained_candidate_count,omitted_candidate_count:result.omitted_candidate_count,
   candidate_limit:32,quality:result.quality,approval_policy:result.approval_policy,result_kind:result.result_kind,
   semantic_scope_available:root.semantic_scope_available,scope_status:root.semantic_scope_available?"asserted":"unknown",
   root_fingerprint:root.fingerprint,chunk_coverage_digest:coverage,
   retrieval_limitation:compatibleCount===0?"no_scope_compatible_interests":null,discovery_state:"pending_discovery"};
  await client.query(`INSERT INTO signal_topic_classification_items(execution_id,workspace_id,canonical_root_id,resolution_state,best_score,item_digest,computation_evidence)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb)`,[run.id,run.workspace_id,root.root_id,result.candidates.length?"doubt":"not_relevant",
    result.candidates[0]?.semantic_score??null,resultDigest,JSON.stringify(evidence)]);
  if(result.candidates.length)await client.query(`INSERT INTO signal_topic_classification_suggestions(execution_id,workspace_id,canonical_root_id,taxonomy_term_id,
   term_key,disposition,method,semantic_score,negative_semantic_score,lexical_match,excluded_by_rule,excluded_by_negative,evidence_digest,lineage_digest,computation_evidence)
   SELECT $1::uuid,$2::uuid,$3::uuid,item.taxonomy_term_id,item.term_key,'doubt','semantic',item.semantic_score,item.negative_semantic_score,false,false,false,
    item.evidence_digest,$4,item.evidence FROM jsonb_to_recordset($5::jsonb) item(taxonomy_term_id uuid,term_key text,semantic_score numeric,
     negative_semantic_score numeric,evidence_digest text,evidence jsonb)`,[run.id,run.workspace_id,root.root_id,
      signalWorkspaceEmbeddingDigestV1({input_digest:run.input_digest,root_fingerprint:root.fingerprint,result_digest:resultDigest}),JSON.stringify(result.candidates)]);
  await client.query(`UPDATE signal_topic_catalog_executions SET cursor_root_id=$2::uuid,processed_roots=processed_roots+1,
   processed_chunks=processed_chunks+$3,progress=CASE WHEN denominator=0 THEN 100 ELSE least(99,((processed_roots+1)*100.0/denominator)::int) END,
   execution_expires_at=clock_timestamp()+interval '120 seconds',heartbeat_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,root.root_id,root.expected_chunks]);
  return{...args.lease,cursor_root_id:root.root_id};
 });
}
export async function finishSignalWorkspaceTopicComputationV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1}){
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);await verifyContext(client,run);
  if(run.processed_roots!==run.denominator||natural(run.processed_chunks)!==natural(run.expected_chunks)||(await rootRows(client,run,1)).length)return fail("workspace_topic_coverage_incomplete");
  const summary=(await client.query<{roots:string;chunks:string;bad:string;evaluated:string;retained:string;omitted:string}>(`SELECT count(*)::text roots,
   COALESCE(sum((computation_evidence->>'processed_chunks')::bigint),0)::text chunks,
   COALESCE(sum((computation_evidence->>'evaluated_topic_count')::bigint),0)::text evaluated,
   COALESCE(sum((computation_evidence->>'retained_candidate_count')::bigint),0)::text retained,
   COALESCE(sum((computation_evidence->>'omitted_candidate_count')::bigint),0)::text omitted,
   count(*) FILTER(WHERE resolution_state NOT IN('doubt','not_relevant') OR computation_evidence->>'quality'<>'uncalibrated')::text bad
   FROM signal_topic_classification_items WHERE execution_id=$1::uuid`,[run.id])).rows[0]!;
  if(natural(summary.roots)!==run.denominator||natural(summary.chunks)!==natural(run.expected_chunks)||natural(summary.bad)!==0)return fail("workspace_topic_coverage_incomplete");
  await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,completed_at=clock_timestamp(),
   execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp(),result_summary=$2::jsonb WHERE id=$1::uuid`,[run.id,
    JSON.stringify({contract_version:"workspace-topic-computation-v1",result_kind:"retrieval_shortlist",quality:"uncalibrated",approval_policy:"none",
     eligible_roots:run.denominator,processed_roots:run.processed_roots,expected_chunks:natural(run.expected_chunks),processed_chunks:natural(run.processed_chunks),
     evaluated_topic_count:natural(summary.evaluated),retained_candidate_count:natural(summary.retained),omitted_candidate_count:natural(summary.omitted),input_digest:run.input_digest})]);
  await client.query("UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid",[run.id]);
  return{status:"ready" as const,execution_id:run.id};
 });
}
export async function failSignalWorkspaceTopicComputationV1(args:{database:SignalWorkspaceTopicDatabaseV1;lease:SignalWorkspaceTopicLeaseV1;error_code:string}){
 const code=/^workspace_topic_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:"workspace_topic_worker_failed";
 return transaction(args.database,async client=>{
  const updated=await client.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$4,completed_at=clock_timestamp(),
   execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
   WHERE id=$1::uuid AND workspace_id=$2::uuid AND execution_token=$3::uuid AND status='running' RETURNING id`,
   [args.lease.execution_id,args.lease.workspace_id,args.lease.execution_token,code]);
  if(updated.rowCount)await client.query("UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid",[args.lease.execution_id]);
 });
}
export async function scheduleSignalWorkspaceTopicComputationsV1(args:{database:SignalWorkspaceTopicDatabaseV1;limit?:number}):Promise<{requeued:number}>{
 return transaction(args.database,async client=>{const rows=(await client.query<{id:string;status:string;input_contract:string;dispatch_generation:number;worker_job_id:string}>(`
  SELECT execution.id,execution.status,execution.input_contract,execution.dispatch_generation,outbox.worker_job_id FROM signal_topic_catalog_executions execution
  JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id
  WHERE execution.input_contract IN('workspace-topic-computation-v1','workspace-topic-engine-v1') AND ((execution.status='running' AND execution.execution_expires_at<=clock_timestamp())
   OR (execution.status='queued' AND outbox.status='dispatched' AND outbox.updated_at<clock_timestamp()-interval '30 seconds'))
  ORDER BY execution.updated_at,execution.id FOR UPDATE OF execution SKIP LOCKED LIMIT $1`,[pageLimit(args.limit,20)])).rows;
  for(const row of rows){const generation=row.dispatch_generation+(row.status==="running"?1:0);
   await client.query(`UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,execution_token=NULL,
    execution_expires_at=NULL,dispatch_generation=$2,
    result_summary=CASE WHEN input_contract='workspace-topic-engine-v1' THEN result_summary||'{"phase":"queued"}'::jsonb ELSE result_summary END,
    updated_at=clock_timestamp() WHERE id=$1::uuid`,[row.id,generation]);
   await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
    lease_token=NULL,lease_expires_at=NULL,completed_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid`,
    [row.id,row.status==="running"?`${row.input_contract==='workspace-topic-engine-v1'?'workspace-engine':'workspace-topic'}-${row.id}-${generation}`:row.worker_job_id]);
  }return{requeued:rows.length};
 });
}
export async function retrySignalWorkspaceTopicComputationV1(args:{database:SignalWorkspaceTopicDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string}){
 return transaction(args.database,async client=>{const run=await lockRun(client,args.execution_id);
  if(run.workspace_id!==args.workspace_id)return fail("workspace_topic_execution_not_found",404);
  await authorize(client,args.workspace_id,args.actor_user_id);
  if(run.actor_user_id!==args.actor_user_id)return fail("workspace_topic_retry_actor_mismatch",403);
  checkCurrent(run);await verifyContext(client,run);
  if(run.status==="queued"||run.status==="running"||run.status==="ready")return{execution_id:run.id,replayed:true};
  if(run.status!=="failed")return fail("workspace_topic_retry_unavailable");
  const error=(await client.query<{error_code:string}>("SELECT error_code FROM signal_topic_catalog_executions WHERE id=$1::uuid",[run.id])).rows[0]!.error_code;
  if(!["workspace_topic_worker_failed","workspace_topic_queue_unavailable","topic_queue_unavailable"].includes(error))return fail("workspace_topic_retry_unavailable");
  const generation=(await client.query<{dispatch_generation:number}>(`UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,
   execution_token=NULL,execution_expires_at=NULL,dispatch_generation=dispatch_generation+1,updated_at=clock_timestamp()
   WHERE id=$1::uuid RETURNING dispatch_generation`,[run.id])).rows[0]!.dispatch_generation;
  await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
   lease_token=NULL,lease_expires_at=NULL,completed_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid`,
   [run.id,`workspace-topic-${run.id}-${generation}`]);return{execution_id:run.id,replayed:false};
 });
}
