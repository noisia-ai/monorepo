import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalTopicConsolidationEditorialInputV1, quoteSignalTopicEditorialBatchV2,
  requestSignalTopicEditorialBatchV2, replaySignalTopicEditorialBatchV2, prepareAllSignalTopicEditorialBatchV2,
  materializeSignalTopicEditorialBatchV2, reuseCompatibleSignalTopicEditorialPaidResultsV2, SignalTopicEditorialStoreError } from "@noisia/db";
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
    const row=(await client.query<{execution_id:string;status:string;expected:number;done:number;maximum:string;confirmed:string;reserved:string;ambiguous:string;materialized:boolean;
      topic:number;narrative:number;noise:number;insufficient:number;technical:number;pending:number;batch_states:Record<string,number>;error_codes:string[]}>(`
      WITH numeric AS (
        SELECT consolidation_run_id FROM signal_topic_consolidation_executions
        WHERE workspace_id=$1 AND id=$2 AND status='ready'
      ), latest AS (
        SELECT e.* FROM signal_topic_editorial_executions e,numeric n
        WHERE e.workspace_id=$1 AND e.numeric_run_id=n.consolidation_run_id
          AND e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2'
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1
      ), unit_outcomes AS (
        SELECT r.id,r.request_digest,
          reused.request_id IS NOT NULL reused,reused.decision->>'disposition' reused_disposition,
          item.validation,item.outcome,item.call_status,item.error_code item_error,
          item.batch_state,item.batch_error
        FROM latest e JOIN signal_topic_editorial_requests r ON r.execution_id=e.id
        LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
        LEFT JOIN LATERAL (
          SELECT i.validation,i.outcome,c.status call_status,b.state batch_state,
            COALESCE(i.validation->>'code',c.error_code) error_code,b.error_code batch_error
          FROM signal_topic_editorial_batch_items_v2 i
          JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
          JOIN signal_topic_editorial_calls c ON c.id=i.call_id
          WHERE i.request_id=r.id ORDER BY b.created_at DESC,b.id DESC LIMIT 1
        ) item ON true
      ), batches AS (
        SELECT state,count(*)::integer n FROM signal_topic_editorial_provider_batches_v2 b,latest e
        WHERE b.execution_id=e.id GROUP BY state
      )
      SELECT e.id::text execution_id,e.status,jsonb_array_length(e.plan->'requests') expected,
        EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions r WHERE r.consolidation_run_id=e.numeric_run_id
          AND r.workspace_id=e.workspace_id AND r.status='validated' AND r.created_by_user_id=e.actor_user_id AND r.created_at>=e.created_at) materialized,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE u.reused OR u.validation->>'status'='accepted'
          OR u.validation->>'status'='invalid_message' OR u.outcome IN('errored','canceled','expired','submission_rejected')
          OR u.call_status='settled' AND u.validation IS NULL) done,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE (u.reused OR u.validation->>'status'='accepted')
          AND COALESCE(u.reused_disposition,u.validation->'decision'->>'disposition')='topic') topic,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE (u.reused OR u.validation->>'status'='accepted')
          AND COALESCE(u.reused_disposition,u.validation->'decision'->>'disposition')='narrative') narrative,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE (u.reused OR u.validation->>'status'='accepted')
          AND COALESCE(u.reused_disposition,u.validation->'decision'->>'disposition')='noise') noise,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE (u.reused OR u.validation->>'status'='accepted')
          AND COALESCE(u.reused_disposition,u.validation->'decision'->>'disposition')='unresolved') insufficient,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE NOT u.reused AND
          (u.validation->>'status'='invalid_message' OR u.outcome IN('errored','canceled','expired','submission_rejected')
            OR u.call_status='settled' AND u.validation IS NULL)) technical,
        (SELECT count(*)::integer FROM unit_outcomes u WHERE NOT u.reused
          AND NOT (u.validation->>'status'='accepted' OR u.validation->>'status'='invalid_message'
            OR u.outcome IN('errored','canceled','expired','submission_rejected')
            OR u.call_status='settled' AND u.validation IS NULL)) pending,
        COALESCE((SELECT jsonb_object_agg(state,n) FROM batches),'{}'::jsonb) batch_states,
        COALESCE((SELECT array_agg(DISTINCT code ORDER BY code) FROM (
          SELECT item_error code FROM unit_outcomes WHERE item_error IS NOT NULL
          UNION SELECT batch_error FROM unit_outcomes WHERE batch_error IS NOT NULL
        ) errors),'{}'::text[]) error_codes,
        e.hard_cap_micro_usd::text maximum,
        COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'),0)::text confirmed,
        COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status IN('reserved','in_flight','response_persisted')),0)::text reserved,
        COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status='outcome_unknown'),0)::text ambiguous
      FROM latest e LEFT JOIN signal_topic_editorial_provider_batches_v2 b ON b.execution_id=e.id
      LEFT JOIN signal_topic_editorial_batch_items_v2 i ON i.batch_id=b.id
      LEFT JOIN signal_topic_editorial_calls c ON c.id=i.call_id
      -- latest is a CTE, so PostgreSQL cannot use the base table's primary-key
      -- functional dependency for correlated fields referenced by EXISTS.
      GROUP BY e.id,e.workspace_id,e.numeric_run_id,e.actor_user_id,e.created_at,
        e.status,e.plan,e.hard_cap_micro_usd`,[args.workspaceId,args.numericExecutionId])).rows[0];
    await client.query("COMMIT");
    if(!row)return null;
    const status=row.materialized?"completed":row.technical>0||BigInt(row.ambiguous)>0n?"failed":row.pending>0
      ? Object.keys(row.batch_states).length===0||(row.batch_states.prepared??0)>0&&Object.keys(row.batch_states).length===1?"queued":"running":"review_ready";
    return {contract_version:"workspace-topic-editorial-view-v1" as const,workspace_id:args.workspaceId,
      numeric_execution_id:args.numericExecutionId,status,
      can_quote:false,can_retry:false,can_complete:caps.can_request_processing&&status==="review_ready",activation:"not_activated" as const,quote:null,
      execution:{execution_id:row.execution_id,status,
        completed_screening_count:row.done,expected_screening_count:row.expected,maximum_micro_usd:row.maximum,
        confirmed_micro_usd:row.confirmed,reserved_micro_usd:row.reserved,ambiguous_micro_usd:row.ambiguous},
      batch_progress:{topics:row.topic,narratives:row.narrative,noise:row.noise,insufficient_evidence:row.insufficient,
        technical_errors:row.technical,pending:row.pending,batch_states:row.batch_states,error_codes:row.error_codes}};
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
  if(replay.replayed){
    await reuseCompatibleSignalTopicEditorialPaidResultsV2({database,execution_id:replay.execution_id!});
    await prepareAllSignalTopicEditorialBatchV2({database,execution_id:replay.execution_id!});
    return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
      numeric_execution_id:args.numericExecutionId,action:"authorize_editorial" as const,execution_id:replay.execution_id!,
      idempotency_key:args.idempotencyKey,replayed:true,activation:"not_activated" as const};
  }
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
  // The durable V2 plan includes every source group. Compatible prior paid
  // decisions are copied first; only still-unresolved group requests enter the
  // provider manifest, so a replay never recharges a compatible receipt.
  await reuseCompatibleSignalTopicEditorialPaidResultsV2({database:source.database,execution_id:result.execution_id});
  await prepareAllSignalTopicEditorialBatchV2({database:source.database,execution_id:result.execution_id});
  return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
    numeric_execution_id:args.numericExecutionId,action:"authorize_editorial" as const,execution_id:result.execution_id,
    idempotency_key:args.idempotencyKey,replayed:result.replayed,activation:"not_activated" as const};
}
export async function completeWorkspaceTopicEditorialBatchV2ForActor(args:Args&{executionId:string;idempotencyKey:string}){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId,args.executionId].every(editorialUuid)||!editorialKey(args.idempotencyKey))
    fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool,client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view)fail("processing_forbidden",403);
    const row=(await client.query<{run_id:string;is_v2:boolean}>(`SELECT r.consolidation_run_id::text run_id,
      e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2' is_v2
      FROM signal_topic_consolidation_executions n JOIN signal_topic_consolidation_runs r
        ON r.id=n.consolidation_run_id AND r.workspace_id=n.workspace_id
      JOIN signal_topic_editorial_executions e ON e.numeric_run_id=r.id AND e.workspace_id=n.workspace_id
      WHERE n.workspace_id=$1::uuid AND n.id=$2::uuid AND e.id=$3::uuid AND e.actor_user_id=$4::uuid`,
    [args.workspaceId,args.numericExecutionId,args.executionId,args.actorUserId])).rows[0];
    await client.query("COMMIT");
    if(!row?.is_v2)return null;
    const result=await materializeSignalTopicEditorialBatchV2({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
      numeric_execution_id:row.run_id,execution_id:args.executionId});
    if(result.technical_error_count>0||result.revision===null)fail("topic_editorial_v2_catalog_technical_errors");
    return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
      action:"complete_catalog" as const,numeric_execution_id:args.numericExecutionId,execution_id:args.executionId,
      idempotency_key:args.idempotencyKey,replayed:result.replayed,activation:"not_activated" as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
