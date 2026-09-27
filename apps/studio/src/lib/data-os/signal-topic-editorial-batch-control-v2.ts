import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalTopicConsolidationEditorialInputV1, quoteSignalTopicEditorialBatchV2,
  requestSignalTopicEditorialBatchV2, replaySignalTopicEditorialBatchV2, SignalTopicEditorialStoreError } from "@noisia/db";
import { editorialCap, editorialKey, editorialUuid } from "./workspace-topic-editorial-contract";

type Args={database?:Pick<Pool,"connect">;workspaceId:string;actorUserId:string;numericExecutionId:string};
function fail(code:string,status=409):never{throw new SignalTopicEditorialStoreError(code,status);}
function deadlineFromQuote(reference:string):number{
  const match=/^v2\.([0-9]{10})\.[a-f0-9]{64}$/u.exec(reference);
  if(!match)fail("topic_editorial_quote_expired");
  return Number(match[1]);
}
async function prepared(args:Args){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool;
  const client=await database.connect();
  let runId:string|null=null;
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view)fail("processing_forbidden",403);
    if(!caps.can_request_processing)fail("processing_forbidden",403);
    const row=(await client.query<{run_id:string;workspace_id:string}>(`SELECT r.id::text run_id,r.workspace_id::text
      FROM signal_topic_consolidation_executions e JOIN signal_topic_consolidation_runs r
        ON r.id=e.consolidation_run_id AND r.workspace_id=e.workspace_id
      WHERE e.workspace_id=$1 AND e.id=$2 AND e.status='ready'`,[args.workspaceId,args.numericExecutionId])).rows[0];
    if(!row||row.workspace_id!==args.workspaceId)fail("topic_editorial_source_stale");
    runId=row.run_id;
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
  return {database,run_id:runId!};
}
export async function quoteWorkspaceTopicEditorialBatchV2ForActor(args:Args){
  const source=await prepared(args),input=await loadSignalTopicConsolidationEditorialInputV1({database:source.database,
    workspace_id:args.workspaceId,actor_user_id:args.actorUserId,numeric_run_id:source.run_id});
  const deadline=Math.floor(Date.now()/1000)+240;
  const {buildSignalTopicEditorialBatchPlanFromPreparedInputV2}=await import("@noisia/query-engine");
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:source.run_id});
  const quote=await quoteSignalTopicEditorialBatchV2({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,run_id:source.run_id,plan,deadline});
  if(quote.status!=="ready_to_authorize")return {status:quote.status,quote:null};
  if(!quote.quote_reference||!quote.quote_expires_at||!editorialCap(quote.maximum_micro_usd))fail("topic_editorial_quote_expired");
  return {status:"ready_to_authorize",quote:{reference:quote.quote_reference,expires_at:quote.quote_expires_at,
    maximum_micro_usd:quote.maximum_micro_usd,group_count:quote.expected_group_count,
    screening_count:quote.expected_group_count,global_count:1 as const}};
}
export async function loadWorkspaceTopicEditorialBatchStatusV2ForActor(args:Args){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool,client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view)fail("processing_forbidden",403);
    const row=(await client.query<{execution_id:string;status:string;expected:number;done:number;maximum:string;confirmed:string;reserved:string;ambiguous:string}>(`
      WITH numeric AS (
        SELECT consolidation_run_id FROM signal_topic_consolidation_executions
        WHERE workspace_id=$1 AND id=$2 AND status='ready'
      ), latest AS (
        SELECT e.* FROM signal_topic_editorial_executions e,numeric n
        WHERE e.workspace_id=$1 AND e.numeric_run_id=n.consolidation_run_id
          AND e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2'
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1
      )
      SELECT e.id::text execution_id,e.status,jsonb_array_length(e.plan->'requests') expected,
        count(i.request_id) FILTER(WHERE i.validation IS NOT NULL)::integer done,e.hard_cap_micro_usd::text maximum,
        COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'),0)::text confirmed,
        COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status IN('reserved','in_flight','response_persisted')),0)::text reserved,
        COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status='outcome_unknown'),0)::text ambiguous
      FROM latest e LEFT JOIN signal_topic_editorial_provider_batches_v2 b ON b.execution_id=e.id
      LEFT JOIN signal_topic_editorial_batch_items_v2 i ON i.batch_id=b.id
      LEFT JOIN signal_topic_editorial_calls c ON c.id=i.call_id
      GROUP BY e.id,e.status,e.plan,e.hard_cap_micro_usd`,[args.workspaceId,args.numericExecutionId])).rows[0];
    await client.query("COMMIT");
    if(!row)return null;
    return {contract_version:"workspace-topic-editorial-view-v1" as const,workspace_id:args.workspaceId,
      numeric_execution_id:args.numericExecutionId,status:row.status as "queued"|"running"|"failed"|"review_ready"|"completed",
      can_quote:false,can_retry:false,can_complete:false,activation:"not_activated" as const,quote:null,
      execution:{execution_id:row.execution_id,status:row.status as "queued"|"running"|"failed"|"review_ready"|"completed",
        completed_screening_count:row.done,expected_screening_count:row.expected,maximum_micro_usd:row.maximum,
        confirmed_micro_usd:row.confirmed,reserved_micro_usd:row.reserved,ambiguous_micro_usd:row.ambiguous}};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
export async function authorizeWorkspaceTopicEditorialBatchV2ForActor(args:Args&{quoteReference:string;confirmedMaximumMicroUsd:string;
  idempotencyKey:string;runtimeEnabled?:boolean}){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid)
    ||!editorialKey(args.idempotencyKey)||!editorialCap(args.confirmedMaximumMicroUsd))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool;
  const replay=await replaySignalTopicEditorialBatchV2({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
    numeric_execution_id:args.numericExecutionId,idempotency_key:args.idempotencyKey,quote_reference:args.quoteReference,
    confirmed_cap_micro_usd:args.confirmedMaximumMicroUsd});
  if(replay.replayed)return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
    numeric_execution_id:args.numericExecutionId,action:"authorize_editorial" as const,execution_id:replay.execution_id!,
    idempotency_key:args.idempotencyKey,replayed:true,activation:"not_activated" as const};
  if(args.runtimeEnabled===false)fail("topic_editorial_runtime_unavailable",503);
  const deadline=deadlineFromQuote(args.quoteReference),source=await prepared(args);
  const input=await loadSignalTopicConsolidationEditorialInputV1({database:source.database,
    workspace_id:args.workspaceId,actor_user_id:args.actorUserId,numeric_run_id:source.run_id});
  const {buildSignalTopicEditorialBatchPlanFromPreparedInputV2}=await import("@noisia/query-engine");
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:source.run_id});
  const quote=await quoteSignalTopicEditorialBatchV2({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,run_id:source.run_id,plan,deadline});
  if(quote.status!=="ready_to_authorize"||quote.quote_reference!==args.quoteReference
    ||quote.maximum_micro_usd!==args.confirmedMaximumMicroUsd)fail("topic_editorial_quote_expired");
  const latest=await source.database.connect();let previous:string|null=null;
  try{
    const row=(await latest.query<{id:string|null}>(`SELECT id::text FROM signal_topic_editorial_executions
      WHERE workspace_id=$1 AND numeric_run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspaceId,source.run_id])).rows[0];
    previous=row?.id??null;
  }finally{latest.release();}
  const result=await requestSignalTopicEditorialBatchV2({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,run_id:source.run_id,input,idempotency_key:args.idempotencyKey,quote_reference:args.quoteReference,
    previous_execution_id:previous});
  return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
    numeric_execution_id:args.numericExecutionId,action:"authorize_editorial" as const,execution_id:result.execution_id,
    idempotency_key:args.idempotencyKey,replayed:result.replayed,activation:"not_activated" as const};
}
