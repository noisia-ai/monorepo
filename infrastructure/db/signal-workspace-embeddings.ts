import type {Pool} from "pg";
import type {SignalWorkspaceEmbeddingProfileV1} from "@noisia/query-engine";
export type {SignalWorkspaceEmbeddingProfileV1} from "@noisia/query-engine";

export type SignalWorkspaceEmbeddingsDatabaseV1=Pick<Pool,"query"|"connect">;
export type SignalWorkspaceEmbeddingsQueryableV1={query<Row extends Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:Row[]}>};
export class SignalWorkspaceEmbeddingsError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);this.name="SignalWorkspaceEmbeddingsError";}
}
export type SignalWorkspaceEmbeddingInputContractV1="corpus"|"topic_prototypes";
export type SignalWorkspaceCorpusEmbeddingCursorV1={asset_sha256:string;chunk_index:number}|null;
export type SignalWorkspacePrototypeEmbeddingCursorV1={input_sha256:string}|null;
export type SignalWorkspaceEmbeddingCursorV1=SignalWorkspaceCorpusEmbeddingCursorV1|SignalWorkspacePrototypeEmbeddingCursorV1;
/** Ephemeral per-Worker cache, never persisted, serialized into a lease, or shared globally. */
export type SignalWorkspaceEmbeddingTextCacheV1={entry?:{workspace_id:string;asset_sha256:string;chunk_policy_version:string;text:string}};
export type SignalWorkspaceEmbeddingCountsV1={
 eligible_roots:number;completed_roots:number;partial_roots:number;pending_roots:number;
 total_chunk_references:number;processed_chunk_references:number;
 total_asset_chunks:number;processed_asset_chunks:number;cache_hits:number;embedded_unique_chunks:number;
};
export type SignalWorkspaceEmbeddingRunV1={
 id:string;preparation_run_id:string;input_revision:number;status:"queued"|"running"|"completed"|"failed"|"stale"|"outcome_unknown"|"canceled";
 counts:SignalWorkspaceEmbeddingCountsV1;hard_cap_micro_usd:number;estimated_upper_micro_usd:number;
 reserved_micro_usd:number;settled_micro_usd:number;unknown_reserved_micro_usd:number;observed_exception_micro_usd:number;
 error_code:string|null;retryable:boolean;created_at:string;updated_at:string;completed_at:string|null;
};
export type SignalWorkspaceEmbeddingsStatusV1={contract_version:"signal-workspace-embeddings-v1";workspace_id:string;observed_at:string;
 active_run:SignalWorkspaceEmbeddingRunV1|null;latest_run:SignalWorkspaceEmbeddingRunV1|null;latest_completed:SignalWorkspaceEmbeddingRunV1|null;
 request_run:SignalWorkspaceEmbeddingRunV1|null;is_current:boolean;
};
export type SignalWorkspaceEmbeddingsQuoteV1={contract_version:"signal-workspace-embeddings-quote-v1";workspace_id:string;preparation_run_id:string;input_revision:number;
 profile:SignalWorkspaceEmbeddingProfileV1;quote_digest:string;eligible_roots:number;total_chunk_references:number;total_asset_chunks:number;
 cached_asset_chunks:number;missing_asset_chunks:number;full_text_bytes:number;tokens_upper:number;
 estimated_upper_micro_usd:number;policy_valid_until:string|null;observed_at:string;
 resume_run_id:string|null;required_cap_micro_usd:number|null;
};
export type SignalWorkspaceEmbeddingLeaseV1={run_id:string;workspace_id:string;execution_token:string;profile:SignalWorkspaceEmbeddingProfileV1}&(
 {input_contract?:"corpus";cursor:SignalWorkspaceCorpusEmbeddingCursorV1}|{input_contract:"topic_prototypes";cursor:SignalWorkspacePrototypeEmbeddingCursorV1});
export type SignalWorkspaceEmbeddingDispatchV1={run_id:string;workspace_id:string;worker_job_id:string;dispatch_token:string};
export type SignalWorkspaceCorpusEmbeddingBatchV1={
 input_contract?:"corpus";cursor:SignalWorkspaceCorpusEmbeddingCursorV1;next_cursor:SignalWorkspaceCorpusEmbeddingCursorV1;done:boolean;batch_digest:string;
 items:Array<{asset_sha256:string;chunk_index:number;chunk_sha256:string;root_count:number;asset_chunk_count:number;cached:boolean}>;
 inputs:Array<{chunk_sha256:string;text:string}>;tokens_upper:number;reserved_micro_usd:number;
};
export type SignalWorkspacePrototypeEmbeddingBatchV1={
 input_contract:"topic_prototypes";cursor:SignalWorkspacePrototypeEmbeddingCursorV1;next_cursor:SignalWorkspacePrototypeEmbeddingCursorV1;done:boolean;batch_digest:string;
 items:Array<{input_sha256:string;chunk_sha256:string;alias_count:number;cached:boolean}>;
 inputs:Array<{chunk_sha256:string;text:string}>;tokens_upper:number;reserved_micro_usd:number;
};
export type SignalWorkspaceEmbeddingBatchV1=SignalWorkspaceCorpusEmbeddingBatchV1|SignalWorkspacePrototypeEmbeddingBatchV1;
export type SignalWorkspaceEmbeddingCallV1={call_id:string;attempt_token:string;state:"reserved"|"response_persisted"|"settled";
 response_body:string|null;response_http_status:number|null;provider_request_id:string|null};
export type SignalWorkspaceEmbeddingRawResponseV1={body:string;http_status:number;provider_request_id:string|null};
export type SignalWorkspaceEmbeddingValidatedResponseV1={vectors:Array<{chunk_sha256:string;embedding:number[]}>;total_tokens:number;provider_request_id:string|null};

import type {PoolClient} from "pg";
import {createHash,randomUUID} from "node:crypto";
import {assertSignalWorkspaceEmbeddingProfileV1,boundSignalWorkspaceEmbeddingInputTokensV1,
 signalWorkspaceEmbeddingCostMicroUsdV1,signalWorkspaceEmbeddingDigestV1,validateSignalWorkspaceEmbeddingInputsV1} from "@noisia/query-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {SignalWorkspaceTopicComputationError} from "./signal-workspace-topic-computation";
import {loadSignalWorkspaceTopicPrototypePlanV1} from "./signal-workspace-topic-prototype-inputs";
import {SignalTopicCatalogError} from "./signal-topic-catalog";
import type {SignalWorkspaceTopicPrototypeCountsV1} from "./signal-workspace-topic-prototypes-types";
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceEmbeddingsError(code,status);};
const sha=(text:string)=>`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;
const same=(a:unknown,b:unknown)=>signalWorkspaceEmbeddingDigestV1(a)===signalWorkspaceEmbeddingDigestV1(b);
async function transaction<T>(database:SignalWorkspaceEmbeddingsDatabaseV1,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await database.connect();try{await client.query("BEGIN");await client.query("SET LOCAL TIME ZONE 'UTC'");const result=await work(client);await client.query("COMMIT");return result;}
 catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
type Run={id:string;workspace_id:string;preparation_run_id:string|null;actor_user_id:string;status:string;profile:SignalWorkspaceEmbeddingProfileV1;
 input_contract:SignalWorkspaceEmbeddingInputContractV1;taxonomy_profile_id:string|null;topic_input_digest:string|null;cursor_input_sha256:string|null;
 input_revision:string|null;current_revision:string|null;policy_live:boolean;preparation_complete:boolean;execution_live:boolean;execution_token:string|null;
 worker_job_id:string;cursor_asset_sha256:string|null;cursor_chunk_index:number|null;
 counts:SignalWorkspaceEmbeddingCountsV1|SignalWorkspaceTopicPrototypeCountsV1;observed_exception_micro_usd:string};
function corpusCursor(run:Run):SignalWorkspaceCorpusEmbeddingCursorV1{return run.cursor_asset_sha256===null?null:{asset_sha256:run.cursor_asset_sha256,chunk_index:run.cursor_chunk_index!};}
function prototypeCursor(run:Run):SignalWorkspacePrototypeEmbeddingCursorV1{return run.cursor_input_sha256===null?null:{input_sha256:run.cursor_input_sha256};}
function cursor(run:Run):SignalWorkspaceEmbeddingCursorV1{return run.input_contract==="topic_prototypes"?prototypeCursor(run):corpusCursor(run);}
function leaseView(run:Run,token:string):SignalWorkspaceEmbeddingLeaseV1{
 const common={run_id:run.id,workspace_id:run.workspace_id,execution_token:token,profile:run.profile};
 return run.input_contract==="topic_prototypes"?{...common,input_contract:"topic_prototypes",cursor:prototypeCursor(run)}
  :{...common,input_contract:"corpus",cursor:corpusCursor(run)};
}
async function lockRun(client:PoolClient,id:string):Promise<Run>{
 const scope=(await client.query<{workspace_id:string;input_contract:SignalWorkspaceEmbeddingInputContractV1}>("SELECT workspace_id,input_contract FROM signal_workspace_embedding_runs WHERE id=$1::uuid",[id])).rows[0];
 if(!scope)return fail("workspace_embedding_not_found",404);
 if(scope.input_contract==="corpus")await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE",[scope.workspace_id]);
 else if(scope.input_contract==="topic_prototypes")await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${scope.workspace_id}:topic`]);
 else return fail("workspace_embedding_input_contract_invalid");
 const run=(await client.query<Run>(`SELECT run.id,run.workspace_id,run.preparation_run_id,run.actor_user_id,run.status,run.profile,
  run.input_contract,run.taxonomy_profile_id,run.topic_input_digest,run.cursor_input_sha256,
  run.execution_token,run.worker_job_id,run.cursor_asset_sha256,run.cursor_chunk_index,run.counts,run.observed_exception_micro_usd,
  run.input_revision::text,state.input_revision::text current_revision,
  (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp()) policy_live,
  prep.status='completed' preparation_complete,run.execution_expires_at>clock_timestamp() execution_live
  FROM signal_workspace_embedding_runs run LEFT JOIN signal_corpus_preparation_input_state state USING(workspace_id)
  LEFT JOIN signal_corpus_preparation_runs prep ON prep.id=run.preparation_run_id AND prep.workspace_id=run.workspace_id
  WHERE run.id=$1::uuid FOR UPDATE OF run`,[id])).rows[0];if(!run)return fail("workspace_embedding_not_found",404);
 assertSignalWorkspaceEmbeddingProfileV1(run.profile);return run;
}
async function inputsCurrent(client:PoolClient,run:Run):Promise<boolean>{
 if(!run.policy_live)return false;
 if(run.input_contract==="corpus")return run.input_revision===run.current_revision&&run.preparation_complete;
 try{const plan=await loadSignalWorkspaceTopicPrototypePlanV1({queryable:client,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id});
  return plan.taxonomy_profile_id===run.taxonomy_profile_id&&plan.plan_digest===run.topic_input_digest;}
 catch(error){if(error instanceof SignalTopicCatalogError&&["brand_context_source_stale","brand_context_semantic_context_required"].includes(error.code))return false;
  if(error instanceof SignalWorkspaceTopicComputationError&&["workspace_topic_catalog_empty","workspace_topic_catalog_required"].includes(error.code))return false;throw error;}
}
async function requireLease(client:PoolClient,lease:SignalWorkspaceEmbeddingLeaseV1):Promise<Run>{
 const run=await lockRun(client,lease.run_id);
 if(run.workspace_id!==lease.workspace_id||run.input_contract!==(lease.input_contract??"corpus")||run.status!=="running"||run.execution_token!==lease.execution_token||!run.execution_live)return fail("workspace_embedding_lease_lost");
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id})).can_execute_topics)return fail("workspace_embedding_forbidden",403);
 if(!await inputsCurrent(client,run))return fail("workspace_embedding_inputs_changed");
 if(Number(run.observed_exception_micro_usd)>0)return fail("workspace_embedding_budget_violation");
 if(!same(cursor(run),lease.cursor))return fail("workspace_embedding_checkpoint_conflict");
 await client.query("UPDATE signal_workspace_embedding_runs SET execution_expires_at=clock_timestamp()+interval '120 seconds' WHERE id=$1::uuid",[run.id]);return run;
}
export async function claimSignalWorkspaceEmbeddingRunV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;run_id:string;worker_job_id:string}):Promise<SignalWorkspaceEmbeddingLeaseV1|null>{
 return transaction(args.database,async client=>{const run=await lockRun(client,args.run_id);
  if(run.worker_job_id!==args.worker_job_id||!["queued","running"].includes(run.status)||run.status==="running"&&run.execution_live)return null;
  const allowed=(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id})).can_execute_topics;
  const stale=allowed?!await inputsCurrent(client,run):false;
  if(!allowed||stale){await client.query(`UPDATE signal_workspace_embedding_runs SET status=$2,error_code=$3,execution_token=NULL,execution_expires_at=NULL,
   updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,stale?"stale":"failed",stale?"workspace_embedding_inputs_changed":"workspace_embedding_forbidden"]);return null;}
  const token=randomUUID();await client.query(`UPDATE signal_workspace_embedding_runs SET status='running',execution_token=$2::uuid,
   execution_expires_at=clock_timestamp()+interval '120 seconds',dispatch_status='dispatched',dispatch_token=NULL,dispatch_expires_at=NULL,
   dispatch_attempts=0,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,token]);return leaseView(run,token);
 });
}
type ChunkRow={asset_sha256:string;chunk_index:number;chunk_sha256:string;start:number;end:number;root_count:string;asset_chunk_count:number;cached:boolean;asset_bytes:number};
async function chunkRows(client:PoolClient,run:Run):Promise<ChunkRow[]>{
 return (await client.query<ChunkRow>(`WITH assets AS (
  SELECT asset_sha256,count(*)::text root_count FROM signal_corpus_preparation_items
  WHERE run_id=$1::uuid AND disposition='eligible' AND ($2::text IS NULL OR asset_sha256>=$2)
  GROUP BY asset_sha256 ORDER BY asset_sha256 LIMIT 129
 ) SELECT item.asset_sha256,(chunk.ordinality-1)::int chunk_index,chunk.value->>'sha256' chunk_sha256,
   (chunk.value->>'start')::int start,(chunk.value->>'end')::int "end",item.root_count,
   jsonb_array_length(asset.chunks->'chunks') asset_chunk_count,octet_length(asset.full_text) asset_bytes,(cache.chunk_sha256 IS NOT NULL) cached
 FROM assets item JOIN signal_corpus_text_assets asset ON asset.workspace_id=$4::uuid AND asset.text_sha256=item.asset_sha256
   AND asset.chunk_policy_version=$5 CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
 LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$4::uuid AND cache.config_digest=$6 AND cache.chunk_sha256=chunk.value->>'sha256'
 WHERE ($2::text IS NULL OR (item.asset_sha256,chunk.ordinality-1)>($2,$3::int))
 ORDER BY item.asset_sha256,chunk.ordinality LIMIT 128`,[run.preparation_run_id,run.cursor_asset_sha256,run.cursor_chunk_index,run.workspace_id,run.profile.chunk_policy_version,run.profile.config_digest])).rows;
}
async function readCorpusBatch(client:PoolClient,run:Run,textCache?:SignalWorkspaceEmbeddingTextCacheV1):Promise<SignalWorkspaceCorpusEmbeddingBatchV1>{
 const candidates=await chunkRows(client,run),rows:ChunkRow[]=[];let bodyBytes=0,clipped=false;
 const assetKeys=new Set<string>();
 for(const row of candidates){
  if(!row.cached&&!assetKeys.has(row.asset_sha256)){
   if(bodyBytes>0&&bodyBytes+row.asset_bytes>6*1024*1024){clipped=true;break;}
   bodyBytes+=row.asset_bytes;assetKeys.add(row.asset_sha256);
  }
  rows.push(row);
 }
 const cached=textCache?.entry;
 const usable=cached&&cached.workspace_id===run.workspace_id&&cached.chunk_policy_version===run.profile.chunk_policy_version&&assetKeys.has(cached.asset_sha256);
 const fetchKeys=[...assetKeys].filter(key=>!usable||key!==cached.asset_sha256);
 const bodies=fetchKeys.length?(await client.query<{text_sha256:string;full_text:string}>(`SELECT text_sha256,full_text FROM signal_corpus_text_assets
  WHERE workspace_id=$1::uuid AND chunk_policy_version=$2 AND text_sha256=ANY($3::text[])`,[run.workspace_id,run.profile.chunk_policy_version,fetchKeys])).rows:[];
 if(usable)bodies.push({text_sha256:cached.asset_sha256,full_text:cached.text});
 const byAsset=new Map(bodies.map(body=>[body.text_sha256,body.full_text]));
 const lastAsset=[...assetKeys].at(-1),lastBody=lastAsset?byAsset.get(lastAsset):undefined;
 if(textCache){textCache.entry=lastAsset&&lastBody!==undefined&&Buffer.byteLength(lastBody,"utf8")<=16*1024*1024
  ?{workspace_id:run.workspace_id,asset_sha256:lastAsset,chunk_policy_version:run.profile.chunk_policy_version,text:lastBody}:undefined;}
 const inputs:SignalWorkspaceCorpusEmbeddingBatchV1["inputs"]=[],items:SignalWorkspaceCorpusEmbeddingBatchV1["items"]=[];
 const seen=new Set<string>();let tokens=0;
 for(const row of rows){
  if(!row.cached&&!seen.has(row.chunk_sha256)){
   const part=byAsset.get(row.asset_sha256)?.slice(row.start,row.end);if(part===undefined||sha(part)!==row.chunk_sha256)return fail("workspace_embedding_input_identity_mismatch");
   const bound=boundSignalWorkspaceEmbeddingInputTokensV1(part);if(tokens+bound>120000){clipped=true;break;}
   inputs.push({chunk_sha256:row.chunk_sha256,text:part});seen.add(row.chunk_sha256);tokens+=bound;
  }
  items.push({asset_sha256:row.asset_sha256,chunk_index:row.chunk_index,chunk_sha256:row.chunk_sha256,root_count:Number(row.root_count),asset_chunk_count:row.asset_chunk_count,cached:row.cached});
 }
 const last=items.at(-1),next=last?{asset_sha256:last.asset_sha256,chunk_index:last.chunk_index}:corpusCursor(run);
 const identity={cursor:corpusCursor(run),next_cursor:next,items:items.map(({cached:_cached,...item})=>item)};
 return{...identity,items,done:!clipped&&candidates.length<128,batch_digest:signalWorkspaceEmbeddingDigestV1(identity),inputs,tokens_upper:tokens,reserved_micro_usd:signalWorkspaceEmbeddingCostMicroUsdV1(tokens)};
}
async function verifyCorpusBatch(client:PoolClient,run:Run,batch:SignalWorkspaceCorpusEmbeddingBatchV1):Promise<SignalWorkspaceCorpusEmbeddingBatchV1>{
 if(batch.items.length===0||batch.items.length>128||!same(batch.cursor,cursor(run)))return fail("workspace_embedding_checkpoint_conflict");
 const rows=(await chunkRows(client,run)).slice(0,batch.items.length);
 const items=rows.map(row=>({asset_sha256:row.asset_sha256,chunk_index:row.chunk_index,chunk_sha256:row.chunk_sha256,root_count:Number(row.root_count),asset_chunk_count:row.asset_chunk_count,cached:row.cached}));
 if(!same(items,batch.items))return fail("workspace_embedding_checkpoint_conflict");
 const last=items.at(-1)!;const next={asset_sha256:last.asset_sha256,chunk_index:last.chunk_index};
 const identity={cursor:cursor(run),next_cursor:next,items:items.map(({cached:_cached,...item})=>item)};
 if(!same(next,batch.next_cursor)||signalWorkspaceEmbeddingDigestV1(identity)!==batch.batch_digest)return fail("workspace_embedding_checkpoint_conflict");
 const expected=[...new Set(items.filter(item=>!item.cached).map(item=>item.chunk_sha256))];
 if(!same(expected,batch.inputs.map(input=>input.chunk_sha256)))return fail("workspace_embedding_input_identity_mismatch");
 const tokens=expected.length?validateSignalWorkspaceEmbeddingInputsV1(batch.inputs):0;
 if(tokens!==batch.tokens_upper||signalWorkspaceEmbeddingCostMicroUsdV1(tokens)!==batch.reserved_micro_usd)return fail("workspace_embedding_input_identity_mismatch");
 return batch;
}
type PrototypeRow={input_sha256:string;alias_count:string;cached:boolean;text:string|null};
async function prototypeRows(client:PoolClient,run:Run,includeText:boolean):Promise<PrototypeRow[]>{
 return (await client.query<PrototypeRow>(`WITH aliases AS MATERIALIZED (
  SELECT input.text_sha256,count(*)::text alias_count FROM signal_workspace_embedding_runs run,
   jsonb_to_recordset(run.topic_input_snapshot->'inputs') input(input_digest text,text_sha256 text)
  WHERE run.id=$1::uuid AND input.text_sha256>COALESCE($2,'') GROUP BY input.text_sha256
  ORDER BY input.text_sha256 LIMIT 128
 ) SELECT aliases.text_sha256 input_sha256,aliases.alias_count,(cache.chunk_sha256 IS NOT NULL) cached,
  CASE WHEN $5::boolean AND cache.chunk_sha256 IS NULL THEN run.topic_input_snapshot->'texts'->>aliases.text_sha256 ELSE NULL END text
 FROM aliases JOIN signal_workspace_embedding_runs run ON run.id=$1::uuid
 LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$3::uuid AND cache.config_digest=$4
  AND cache.chunk_sha256=aliases.text_sha256 ORDER BY aliases.text_sha256`,
 [run.id,run.cursor_input_sha256,run.workspace_id,run.profile.config_digest,includeText])).rows;
}
async function readPrototypeBatch(client:PoolClient,run:Run):Promise<SignalWorkspacePrototypeEmbeddingBatchV1>{
 const rows=await prototypeRows(client,run,true),items:SignalWorkspacePrototypeEmbeddingBatchV1["items"]=[],inputs:SignalWorkspacePrototypeEmbeddingBatchV1["inputs"]=[];
 let tokens=0,clipped=false;
 for(const row of rows){
  if(!row.cached){if(row.text===null||sha(row.text)!==row.input_sha256)return fail("workspace_embedding_input_identity_mismatch");
   const bound=boundSignalWorkspaceEmbeddingInputTokensV1(row.text);if(tokens+bound>120000){clipped=true;break;}
   inputs.push({chunk_sha256:row.input_sha256,text:row.text});tokens+=bound;}
  items.push({input_sha256:row.input_sha256,chunk_sha256:row.input_sha256,alias_count:Number(row.alias_count),cached:row.cached});
 }
 const last=items.at(-1),next=last?{input_sha256:last.input_sha256}:prototypeCursor(run);
 const identity={input_contract:"topic_prototypes" as const,cursor:prototypeCursor(run),next_cursor:next,items:items.map(({cached:_cached,...item})=>item)};
 return{...identity,items,inputs,done:!clipped&&rows.length<128,batch_digest:signalWorkspaceEmbeddingDigestV1(identity),tokens_upper:tokens,reserved_micro_usd:signalWorkspaceEmbeddingCostMicroUsdV1(tokens)};
}
async function verifyPrototypeBatch(client:PoolClient,run:Run,batch:SignalWorkspacePrototypeEmbeddingBatchV1):Promise<SignalWorkspacePrototypeEmbeddingBatchV1>{
 if(batch.items.length===0||batch.items.length>128||!same(batch.cursor,prototypeCursor(run)))return fail("workspace_embedding_checkpoint_conflict");
 const rows=(await prototypeRows(client,run,false)).slice(0,batch.items.length);
 const items=rows.map(row=>({input_sha256:row.input_sha256,chunk_sha256:row.input_sha256,alias_count:Number(row.alias_count),cached:row.cached}));
 if(!same(items,batch.items))return fail("workspace_embedding_checkpoint_conflict");
 const next={input_sha256:items.at(-1)!.input_sha256};
 const identity={input_contract:"topic_prototypes" as const,cursor:prototypeCursor(run),next_cursor:next,items:items.map(({cached:_cached,...item})=>item)};
 if(!same(next,batch.next_cursor)||signalWorkspaceEmbeddingDigestV1(identity)!==batch.batch_digest)return fail("workspace_embedding_checkpoint_conflict");
 const keys=items.filter(item=>!item.cached).map(item=>item.chunk_sha256);
 if(!same(keys,batch.inputs.map(input=>input.chunk_sha256)))return fail("workspace_embedding_input_identity_mismatch");
 const tokens=keys.length?validateSignalWorkspaceEmbeddingInputsV1(batch.inputs):0;
 if(tokens!==batch.tokens_upper||signalWorkspaceEmbeddingCostMicroUsdV1(tokens)!==batch.reserved_micro_usd)return fail("workspace_embedding_input_identity_mismatch");
 return batch;
}
async function verifyBatch(client:PoolClient,run:Run,batch:SignalWorkspaceEmbeddingBatchV1):Promise<SignalWorkspaceEmbeddingBatchV1>{
 if(run.input_contract==="topic_prototypes")return batch.input_contract==="topic_prototypes"?verifyPrototypeBatch(client,run,batch):fail("workspace_embedding_input_contract_invalid");
 return batch.input_contract!=="topic_prototypes"?verifyCorpusBatch(client,run,batch):fail("workspace_embedding_input_contract_invalid");
}
export async function readSignalWorkspaceEmbeddingBatchV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1;text_cache?:SignalWorkspaceEmbeddingTextCacheV1}):Promise<SignalWorkspaceEmbeddingBatchV1>{
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
  return run.input_contract==="topic_prototypes"?readPrototypeBatch(client,run):readCorpusBatch(client,run,args.text_cache);});
}
type CallRow={id:string;run_id:string;workspace_id:string;attempt_token:string;status:string;input_keys:string[];batch:Omit<SignalWorkspaceEmbeddingBatchV1,"inputs">;
 response_body_private:string|null;http_status:number|null;provider_request_id:string|null;reserved_micro_usd:string;observed_tokens:string|null;settled_micro_usd:string|null;tokens_upper:string};
function callView(call:CallRow):SignalWorkspaceEmbeddingCallV1{
 if(!["reserved","response_persisted","settled"].includes(call.status))return fail("workspace_embedding_outcome_unknown");
 return{call_id:call.id,attempt_token:call.attempt_token,state:call.status as SignalWorkspaceEmbeddingCallV1["state"],response_body:call.response_body_private,
  response_http_status:call.http_status,provider_request_id:call.provider_request_id};
}
async function getCall(client:PoolClient,id:string,token:string):Promise<CallRow>{
 const call=(await client.query<CallRow>("SELECT * FROM signal_workspace_embedding_calls WHERE id=$1::uuid AND attempt_token=$2::uuid FOR UPDATE",[id,token])).rows[0];
 if(!call)return fail("workspace_embedding_call_conflict");return call;
}
export async function reserveSignalWorkspaceEmbeddingCallV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1;batch:SignalWorkspaceEmbeddingBatchV1}):Promise<SignalWorkspaceEmbeddingCallV1|null>{
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
  const batch=await verifyBatch(client,run,args.batch);
  if(batch.inputs.length===0)return null;
  const prior=(await client.query<CallRow>(`SELECT * FROM signal_workspace_embedding_calls WHERE run_id=$1::uuid AND batch_digest=$2
   AND status<>'definitely_not_sent' ORDER BY reserved_at DESC,id DESC LIMIT 1 FOR UPDATE`,[run.id,batch.batch_digest])).rows[0];if(prior)return callView(prior);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`workspace-embedding:${run.workspace_id}:${run.profile.config_digest}`]);
  const keys=batch.inputs.map(input=>input.chunk_sha256);
  const overlap=(await client.query<{status:string}>(`SELECT status FROM signal_workspace_embedding_calls WHERE workspace_id=$1::uuid AND config_digest=$2
   AND input_keys && $3::text[] AND status<>'definitely_not_sent' LIMIT 1`,[run.workspace_id,run.profile.config_digest,keys])).rows[0];
  if(overlap)return fail(overlap.status==="settled"?"workspace_embedding_prior_response_unusable":"workspace_embedding_outcome_unknown");
  const {inputs:_inputs,...metadata}=batch;
  const requestDigest=signalWorkspaceEmbeddingDigestV1({profile:run.profile,input_keys:keys});
  const inserted=(await client.query<CallRow>(`INSERT INTO signal_workspace_embedding_calls(workspace_id,run_id,config_digest,batch_digest,request_digest,input_keys,batch,tokens_upper,reserved_micro_usd)
   VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::text[],$7::jsonb,$8,$9) RETURNING *`,[run.workspace_id,run.id,run.profile.config_digest,batch.batch_digest,requestDigest,keys,JSON.stringify(metadata),batch.tokens_upper,batch.reserved_micro_usd])).rows[0]!;
  return callView(inserted);
 });
}
export async function markSignalWorkspaceEmbeddingCallSentV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1;call_id:string;attempt_token:string}){
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);const call=await getCall(client,args.call_id,args.attempt_token);
  if(call.run_id!==run.id||call.status!=="reserved")return fail("workspace_embedding_call_conflict");
  try { await client.query("UPDATE signal_workspace_embedding_calls SET status='in_flight',sent_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid",[call.id]); }
  catch(error){
   // This exact trigger denial is before the send CAS. Other DB/commit failures remain uncertain.
   if(error instanceof Error&&'code' in error&&error.code==='23514'&&error.message==='brand_context_admission_expired')
    return fail("workspace_embedding_definitely_not_sent");
   throw error;
  }
 });
}
export async function persistSignalWorkspaceEmbeddingResponseV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;call_id:string;attempt_token:string;response:SignalWorkspaceEmbeddingRawResponseV1}){
 // A response to an already-sent request is evidence even if authorization or the execution lease changed.
 return transaction(args.database,async client=>{const scope=(await client.query<{run_id:string}>("SELECT run_id FROM signal_workspace_embedding_calls WHERE id=$1::uuid",[args.call_id])).rows[0];
  if(!scope)return fail("workspace_embedding_call_conflict");await lockRun(client,scope.run_id);const call=await getCall(client,args.call_id,args.attempt_token);
  if(call.response_body_private!==null){if(call.response_body_private!==args.response.body||call.http_status!==args.response.http_status)return fail("workspace_embedding_response_conflict");return;}
  if(!["in_flight","outcome_unknown"].includes(call.status))return fail("workspace_embedding_call_conflict");
  await client.query(`UPDATE signal_workspace_embedding_calls SET status='response_persisted',response_body_private=$2,response_digest=$3,http_status=$4,
   provider_request_id=$5,response_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[call.id,args.response.body,sha(args.response.body),args.response.http_status,args.response.provider_request_id]);
 });
}

async function settleCall(client:PoolClient,call:CallRow,tokens:number):Promise<boolean>{
 if(!Number.isSafeInteger(tokens)||tokens<=0)return fail("workspace_embedding_invalid_usage");
 const amount=signalWorkspaceEmbeddingCostMicroUsdV1(tokens);
 if(call.status==="settled"){
  if(Number(call.observed_tokens)!==tokens||Number(call.settled_micro_usd)!==amount)return fail("workspace_embedding_response_conflict");return true;
 }
 if(call.status!=="response_persisted")return fail("workspace_embedding_call_conflict");
 if(tokens>Number(call.tokens_upper)||amount>Number(call.reserved_micro_usd)){
  await client.query(`UPDATE signal_workspace_embedding_calls SET status='outcome_unknown',observed_tokens=$2,observed_micro_usd=$3,
   error_code='workspace_embedding_budget_violation',updated_at=clock_timestamp() WHERE id=$1::uuid`,[call.id,tokens,amount]);
  await client.query("UPDATE signal_workspace_embedding_runs SET status='outcome_unknown',error_code='workspace_embedding_budget_violation',execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid",[call.run_id]);return false;
 }
 await client.query(`UPDATE signal_workspace_embedding_calls SET status='settled',observed_tokens=$2,observed_micro_usd=$3,
  settled_micro_usd=$3,settled_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[call.id,tokens,amount]);return true;
}
function validateStoredVectors(call:CallRow,validated:SignalWorkspaceEmbeddingValidatedResponseV1){
 if(call.response_body_private===null||call.http_status===null||call.http_status<200||call.http_status>=300)return fail("workspace_embedding_invalid_response");
 let raw:Record<string,unknown>;try{raw=JSON.parse(call.response_body_private) as Record<string,unknown>;}catch{return fail("workspace_embedding_invalid_response");}
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||(raw.model!==undefined&&raw.model!=="voyage-4-large"))return fail("workspace_embedding_invalid_response");
 const data=raw.data;if(!Array.isArray(data)||data.length!==call.input_keys.length||validated.vectors.length!==call.input_keys.length)return fail("workspace_embedding_invalid_response");
 const usage=raw.usage as {total_tokens?:unknown}|undefined;
 if(usage?.total_tokens!==validated.total_tokens)return fail("workspace_embedding_invalid_usage");
 const byKey=new Map(validated.vectors.map(value=>[value.chunk_sha256,value.embedding]));
 if(byKey.size!==call.input_keys.length)return fail("workspace_embedding_invalid_response");
 const indices=new Set<number>();
 for(const item of data){
  const row=item as {index?:unknown;embedding?:unknown};
  if(typeof row.index!=="number"||!Number.isInteger(row.index)||row.index<0||row.index>=call.input_keys.length||indices.has(row.index)||!Array.isArray(row.embedding))return fail("workspace_embedding_invalid_response");
  indices.add(row.index);const rawVector=row.embedding as unknown[];const expected=byKey.get(call.input_keys[row.index]!);
  if(!expected||expected.length!==1024||row.embedding.length!==1024||!expected.some(value=>Math.fround(value)!==0)
   ||expected.some((value,i)=>!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value!==rawVector[i]))return fail("workspace_embedding_invalid_response");
 }
}
async function projectPrototypeAliases(client:PoolClient,run:Run,keys:string[]){
 await client.query(`INSERT INTO signal_topic_definition_embeddings(workspace_id,definition_digest,embedding_model,provider,embedding,
  embedding_config_digest,input_text_sha256,source_embedding_call_id)
 SELECT run.workspace_id,input.input_digest,run.profile->>'model',run.profile->>'provider',cache.embedding,
  run.config_digest,input.text_sha256,cache.call_id FROM signal_workspace_embedding_runs run,
  jsonb_to_recordset(run.topic_input_snapshot->'inputs') input(input_digest text,text_sha256 text)
 JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$2::uuid AND cache.config_digest=$3 AND cache.chunk_sha256=input.text_sha256
 WHERE run.id=$1::uuid AND run.input_contract='topic_prototypes' AND input.text_sha256=ANY($4::text[])
 ON CONFLICT DO NOTHING`,[run.id,run.workspace_id,run.profile.config_digest,keys]);
}
async function prototypeCoverage(client:PoolClient,run:Run):Promise<Pick<SignalWorkspaceTopicPrototypeCountsV1,"completed_topics"|"partial_topics"|"pending_topics"|"processed_input_references">>{
 const row=(await client.query<{completed_topics:number;partial_topics:number;pending_topics:number;processed_input_references:string}>(`
 WITH input_state AS MATERIALIZED (
  SELECT input.input_digest,(prototype.id IS NOT NULL AND cache.chunk_sha256 IS NOT NULL AND prototype.embedding=cache.embedding) covered
  FROM signal_workspace_embedding_runs run CROSS JOIN LATERAL
   jsonb_to_recordset(run.topic_input_snapshot->'inputs') input(input_digest text,text_sha256 text)
  LEFT JOIN signal_topic_definition_embeddings prototype ON prototype.workspace_id=run.workspace_id
   AND prototype.embedding_config_digest=run.config_digest AND prototype.definition_digest=input.input_digest
   AND prototype.input_text_sha256=input.text_sha256 AND prototype.provider=run.profile->>'provider' AND prototype.embedding_model=run.profile->>'model'
  LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=run.workspace_id AND cache.config_digest=run.config_digest AND cache.chunk_sha256=input.text_sha256
  WHERE run.id=$1::uuid
 ), topic_state AS (
  SELECT topic->>'taxonomy_term_id' topic_id,count(*) expected,count(*) FILTER(WHERE input.covered) covered
  FROM signal_workspace_embedding_runs run CROSS JOIN LATERAL jsonb_array_elements(run.topic_input_snapshot->'topics') topic
  CROSS JOIN LATERAL jsonb_array_elements_text(topic->'input_digests') reference(input_digest)
  LEFT JOIN input_state input ON input.input_digest=reference.input_digest WHERE run.id=$1::uuid GROUP BY topic->>'taxonomy_term_id'
 ) SELECT count(*) FILTER(WHERE expected=covered)::int completed_topics,
  count(*) FILTER(WHERE covered>0 AND covered<expected)::int partial_topics,
  count(*) FILTER(WHERE covered=0)::int pending_topics,(COALESCE(sum(covered),0) + (SELECT count(*) FROM signal_workspace_embedding_runs run,
    jsonb_array_elements(COALESCE(run.topic_input_snapshot->'context_inputs','[]'::jsonb)) context
    JOIN input_state input ON input.input_digest=context->>'input_digest' AND input.covered
    WHERE run.id=$1::uuid))::text processed_input_references FROM topic_state`,[run.id])).rows[0]!;
 return{...row,processed_input_references:Number(row.processed_input_references)};
}
export async function commitSignalWorkspaceEmbeddingBatchV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1;
 batch:SignalWorkspaceEmbeddingBatchV1;call_id:string|null;attempt_token?:string;validated?:SignalWorkspaceEmbeddingValidatedResponseV1}):Promise<SignalWorkspaceEmbeddingLeaseV1>{
 // Settle a response before a freshness rejection. Rolling back a stale checkpoint
 // must not erase the receipt or its already-observed provider cost.
 if(args.call_id){
  const settled=await transaction(args.database,async client=>{await lockRun(client,args.lease.run_id);const call=await getCall(client,args.call_id!,args.attempt_token??"");
   if(call.run_id!==args.lease.run_id||call.workspace_id!==args.lease.workspace_id||!args.validated)return fail("workspace_embedding_call_conflict");
   validateStoredVectors(call,args.validated);return settleCall(client,call,args.validated.total_tokens);
  });if(!settled)return fail("workspace_embedding_budget_violation");
 }
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
  const batch=await verifyBatch(client,run,args.batch);
  if(batch.inputs.length>0&&!args.call_id)return fail("workspace_embedding_page_incomplete");
  let inserted=0;
  if(args.call_id){const call=await getCall(client,args.call_id,args.attempt_token??"");
   if(call.run_id!==run.id||call.status!=="settled"||call.batch.batch_digest!==batch.batch_digest||!args.validated)return fail("workspace_embedding_call_conflict");
   validateStoredVectors(call,args.validated);
   const values=args.validated.vectors.map(value=>({chunk_sha256:value.chunk_sha256,response_index:call.input_keys.indexOf(value.chunk_sha256),embedding:`[${value.embedding.join(",")}]`}));
   const result=await client.query(`INSERT INTO signal_workspace_chunk_embeddings(workspace_id,config_digest,chunk_sha256,call_id,response_index,embedding)
    SELECT $1::uuid,$2,value.chunk_sha256,$3::uuid,value.response_index,value.embedding::vector
    FROM jsonb_to_recordset($4::jsonb) value(chunk_sha256 text,response_index int,embedding text) ON CONFLICT DO NOTHING`,
    [run.workspace_id,run.profile.config_digest,call.id,JSON.stringify(values)]);inserted=result.rowCount??0;
  }
  const keys=[...new Set(batch.items.map(item=>item.chunk_sha256))];
  const covered=(await client.query<{count:string}>("SELECT count(*)::text FROM signal_workspace_chunk_embeddings WHERE workspace_id=$1::uuid AND config_digest=$2 AND chunk_sha256=ANY($3::text[])",[run.workspace_id,run.profile.config_digest,keys])).rows[0]!;
  if(Number(covered.count)!==keys.length)return fail("workspace_embedding_page_incomplete");
  if(batch.input_contract==="topic_prototypes"){
   await projectPrototypeAliases(client,run,keys);
   const counts={...run.counts as SignalWorkspaceTopicPrototypeCountsV1,...await prototypeCoverage(client,run)};
   counts.processed_unique_inputs+=batch.items.length;counts.cache_hits+=batch.items.length-inserted;counts.embedded_unique_inputs+=inserted;
   await client.query(`UPDATE signal_workspace_embedding_runs SET counts=$2::jsonb,cursor_input_sha256=$3,
    execution_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1::uuid`,
   [run.id,JSON.stringify(counts),batch.next_cursor?.input_sha256??null]);
   return{run_id:args.lease.run_id,workspace_id:args.lease.workspace_id,execution_token:args.lease.execution_token,
    profile:args.lease.profile,input_contract:"topic_prototypes",cursor:batch.next_cursor} as SignalWorkspaceEmbeddingLeaseV1;
  }
  const counts={...run.counts as SignalWorkspaceEmbeddingCountsV1};
  counts.processed_asset_chunks+=batch.items.length;counts.processed_chunk_references+=batch.items.reduce((sum,item)=>sum+item.root_count,0);
  counts.completed_roots+=batch.items.filter(item=>item.chunk_index===item.asset_chunk_count-1).reduce((sum,item)=>sum+item.root_count,0);
  const last=batch.items.at(-1);counts.partial_roots=last&&last.chunk_index<last.asset_chunk_count-1?last.root_count:0;
  counts.pending_roots=counts.eligible_roots-counts.completed_roots-counts.partial_roots;
  counts.cache_hits+=batch.items.length-inserted;counts.embedded_unique_chunks+=inserted;
  await client.query(`UPDATE signal_workspace_embedding_runs SET counts=$2::jsonb,cursor_asset_sha256=$3,cursor_chunk_index=$4,
   execution_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1::uuid`,
   [run.id,JSON.stringify(counts),batch.next_cursor?.asset_sha256??null,batch.next_cursor?.chunk_index??null]);
  return{run_id:args.lease.run_id,workspace_id:args.lease.workspace_id,execution_token:args.lease.execution_token,
   profile:args.lease.profile,input_contract:"corpus",cursor:batch.next_cursor} as SignalWorkspaceEmbeddingLeaseV1;
 });
}
export async function finishSignalWorkspaceEmbeddingsV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1}):Promise<{status:"completed"}>{
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
  if(run.input_contract==="topic_prototypes"){
   const counts=run.counts as SignalWorkspaceTopicPrototypeCountsV1,coverage=await prototypeCoverage(client,run);
   if(counts.completed_topics!==counts.total_topics||counts.processed_unique_inputs!==counts.total_unique_inputs
    ||counts.processed_input_references!==counts.total_input_references||coverage.completed_topics!==counts.total_topics
    ||coverage.processed_input_references!==counts.total_input_references||(await prototypeRows(client,run,false)).length)
    return fail("workspace_embedding_page_incomplete");
  }else{
   const counts=run.counts as SignalWorkspaceEmbeddingCountsV1;
   if(counts.completed_roots!==counts.eligible_roots||counts.processed_asset_chunks!==counts.total_asset_chunks
    ||counts.processed_chunk_references!==counts.total_chunk_references)return fail("workspace_embedding_page_incomplete");
   const missing=(await client.query<{missing:boolean}>(`SELECT EXISTS(SELECT 1 FROM
   (SELECT DISTINCT asset_sha256 FROM signal_corpus_preparation_items WHERE run_id=$1::uuid AND disposition='eligible') item
   JOIN signal_corpus_text_assets asset ON asset.workspace_id=$2::uuid AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=$3
   CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') chunk
   LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$2::uuid AND cache.config_digest=$4 AND cache.chunk_sha256=chunk->>'sha256'
   WHERE cache.chunk_sha256 IS NULL) missing`,[run.preparation_run_id,run.workspace_id,run.profile.chunk_policy_version,run.profile.config_digest])).rows[0]!.missing;
   if(missing)return fail("workspace_embedding_page_incomplete");
  }
  await client.query(`UPDATE signal_workspace_embedding_runs SET status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=NULL,
   execution_token=NULL,execution_expires_at=NULL,dispatch_status='dispatched',dispatch_token=NULL,dispatch_expires_at=NULL,dispatch_attempts=0 WHERE id=$1::uuid`,[run.id]);return{status:"completed"};
 });
}
export async function failSignalWorkspaceEmbeddingCallV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;lease:SignalWorkspaceEmbeddingLeaseV1;
 call_id?:string;attempt_token?:string;outcome:"definitely_not_sent"|"outcome_unknown"|"known_response_invalid"|"local_failure";error_code:string;total_tokens?:number}){
 return transaction(args.database,async client=>{const run=await lockRun(client,args.lease.run_id);
  if(run.workspace_id!==args.lease.workspace_id)return fail("workspace_embedding_call_conflict");
  const error=/^workspace_embedding_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:"workspace_embedding_worker_failed";
  let unknown=false;
  if(args.call_id){const call=await getCall(client,args.call_id,args.attempt_token??"");if(call.run_id!==run.id)return fail("workspace_embedding_call_conflict");
   if(args.outcome==="known_response_invalid"&&call.status==="response_persisted"){
    let observed:unknown;try{observed=JSON.parse(call.response_body_private??"").usage?.total_tokens;}catch{observed=undefined;}
    if(Number.isSafeInteger(args.total_tokens)&&args.total_tokens!>0&&observed===args.total_tokens)unknown=!(await settleCall(client,call,args.total_tokens!));
    else{unknown=true;await client.query("UPDATE signal_workspace_embedding_calls SET status='outcome_unknown',error_code=$2,updated_at=clock_timestamp() WHERE id=$1::uuid",[call.id,error]);}
   }else if((args.outcome==="definitely_not_sent"&&["reserved","in_flight"].includes(call.status))
    ||args.outcome==="local_failure"&&call.status==="reserved"){
    await client.query("UPDATE signal_workspace_embedding_calls SET status='definitely_not_sent',error_code=$2,updated_at=clock_timestamp() WHERE id=$1::uuid",[call.id,error]);
   }else if(["in_flight","outcome_unknown"].includes(call.status)||args.outcome==="outcome_unknown"&&call.status!=="settled"){
    unknown=true;await client.query("UPDATE signal_workspace_embedding_calls SET status='outcome_unknown',error_code=$2,updated_at=clock_timestamp() WHERE id=$1::uuid",[call.id,error]);
   }else if(args.outcome==="definitely_not_sent"&&call.status==="reserved"){
    await client.query("UPDATE signal_workspace_embedding_calls SET status='definitely_not_sent',error_code=$2,updated_at=clock_timestamp() WHERE id=$1::uuid",[call.id,error]);
   }
  }
  // A stale Worker can append its physical call evidence; only its own current lease may change the run lifecycle.
  if(run.status==="running"&&run.execution_token===args.lease.execution_token){
   await client.query(`UPDATE signal_workspace_embedding_runs SET status=$2,error_code=$3,execution_token=NULL,execution_expires_at=NULL,
    updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,unknown?"outcome_unknown":error==="workspace_embedding_inputs_changed"?"stale":"failed",error]);
  }
 });
}

export async function claimSignalWorkspaceEmbeddingsDispatchV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;limit?:number}):Promise<SignalWorkspaceEmbeddingDispatchV1[]>{
 return transaction(args.database,async client=>(await client.query<SignalWorkspaceEmbeddingDispatchV1>(`WITH selected AS (
  SELECT id FROM signal_workspace_embedding_runs WHERE status IN('queued','running') AND available_at<=clock_timestamp()
   AND (dispatch_status='pending' OR dispatch_status='dispatching' AND dispatch_expires_at<clock_timestamp())
  ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
 ) UPDATE signal_workspace_embedding_runs run SET dispatch_status='dispatching',dispatch_token=gen_random_uuid(),dispatch_attempts=dispatch_attempts+1,
  dispatch_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() FROM selected WHERE run.id=selected.id
  RETURNING run.id run_id,run.workspace_id,run.worker_job_id,run.dispatch_token`,[Math.max(1,Math.min(32,args.limit??8))])).rows);
}
export async function acknowledgeSignalWorkspaceEmbeddingsDispatchV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;run_id:string;dispatch_token:string}){
 await args.database.query(`UPDATE signal_workspace_embedding_runs SET dispatch_status='dispatched',dispatch_token=NULL,dispatch_expires_at=NULL,
  dispatch_attempts=0,updated_at=clock_timestamp() WHERE id=$1::uuid AND dispatch_token=$2::uuid AND dispatch_status='dispatching' AND status IN('queued','running')`,[args.run_id,args.dispatch_token]);
}
export async function failSignalWorkspaceEmbeddingsDispatchV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;run_id:string;dispatch_token:string}){
 await args.database.query(`UPDATE signal_workspace_embedding_runs SET dispatch_status='pending',dispatch_token=NULL,dispatch_expires_at=NULL,
  status=CASE WHEN dispatch_attempts>=8 THEN 'failed' ELSE status END,error_code='workspace_embedding_queue_unavailable',
  available_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(dispatch_attempts,6))::integer)),updated_at=clock_timestamp()
  WHERE id=$1::uuid AND dispatch_token=$2::uuid AND dispatch_status='dispatching' AND status IN('queued','running')`,[args.run_id,args.dispatch_token]);
}
export async function scheduleSignalWorkspaceEmbeddingsV1(args:{database:SignalWorkspaceEmbeddingsDatabaseV1;limit?:number}):Promise<number>{
 // Only recover already-authorized runs. A newer import never inherits a spent cap.
 // An unresolved physical request becomes unknown, retaining its reservation.
 const expired=(await args.database.query<{id:string}>(`SELECT id FROM signal_workspace_embedding_runs WHERE status='running'
  AND execution_expires_at<clock_timestamp() ORDER BY updated_at,id LIMIT $1`,[Math.max(1,Math.min(32,args.limit??8))])).rows;
 for(const target of expired)await transaction(args.database,async client=>{const run=await lockRun(client,target.id);if(run.status!=="running"||run.execution_live)return;
  const unresolved=(await client.query<{id:string}>("SELECT id FROM signal_workspace_embedding_calls WHERE run_id=$1::uuid AND status IN('in_flight','outcome_unknown') FOR UPDATE",[run.id])).rows;
  if(unresolved.length){await client.query("UPDATE signal_workspace_embedding_calls SET status='outcome_unknown',error_code='workspace_embedding_outcome_unknown',updated_at=clock_timestamp() WHERE run_id=$1::uuid AND status='in_flight'",[run.id]);
   await client.query("UPDATE signal_workspace_embedding_runs SET status='outcome_unknown',error_code='workspace_embedding_outcome_unknown',execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid",[run.id]);return;}
  await client.query(`UPDATE signal_workspace_embedding_runs SET status='queued',dispatch_status='pending',dispatch_generation=dispatch_generation+1,
   worker_job_id='workspace-embeddings-'||id::text||'-'||(dispatch_generation+1)::text,execution_token=NULL,execution_expires_at=NULL,
   dispatch_token=NULL,dispatch_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id]);
 });
 const pending=await args.database.query(`UPDATE signal_workspace_embedding_runs SET dispatch_status='pending',updated_at=clock_timestamp()
  WHERE status='queued' AND dispatch_status='dispatched' AND updated_at<clock_timestamp()-interval '30 seconds'`);
 return expired.length+(pending.rowCount??0);
}
