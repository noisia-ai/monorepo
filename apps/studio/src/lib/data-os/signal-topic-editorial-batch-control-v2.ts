import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalTopicConsolidationEditorialInputV1,
  replaySignalTopicEditorialBatchV2,
  materializeSignalTopicEditorialBatchV2,
  quoteSignalTopicEditorialChunkedAdmissionV3,requestSignalTopicEditorialChunkedAdmissionV3,
  replaySignalTopicEditorialChunkedAdmissionV3,
  retrySignalTopicEditorialBatchPreparationV2, SignalTopicEditorialStoreError } from "@noisia/db";
import { editorialCap, editorialKey, editorialUuid } from "./workspace-topic-editorial-contract";
import { withTopicEditorialStartPhase } from "./signal-topic-editorial-start-observability";

type Args={database?:Pick<Pool,"connect">;workspaceId:string;actorUserId:string;numericExecutionId:string};
function fail(code:string,status=409):never{throw new SignalTopicEditorialStoreError(code,status);}
function deadlineFromQuote(reference:string):number{
  const match=/^v2\.([0-9]{10})\.[a-f0-9]{64}$/u.exec(reference);
  if(!match)fail("topic_editorial_quote_expired");
  return Number(match[1]);
}
export function resolveWorkspaceTopicEditorialBatchStatusV2(input:{materialized:boolean;preparation_failed:boolean;technical_errors:number;
  ambiguous_micro_usd:string;pending:number;recovering:number;batch_states:Record<string,number>;contract_version:string}){
  const ambiguous=BigInt(input.ambiguous_micro_usd)>0n;
  const complete=input.materialized&&input.pending===0&&input.recovering===0&&input.technical_errors===0&&!ambiguous;
  if(complete)return "completed" as const;
  if(input.preparation_failed||ambiguous)return "failed" as const;
  if(input.pending>0||input.recovering>0){
    const states=Object.keys(input.batch_states);
    return states.length===0||(input.batch_states.prepared??0)>0&&states.length===1?"queued" as const:"running" as const;
  }
  if(input.technical_errors>0)return "failed" as const;
  return input.contract_version==='signal-topic-editorial-admission-header-v3'?"consolidation_pending" as const:"review_ready" as const;
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
  const quote=await quoteSignalTopicEditorialChunkedAdmissionV3({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,plan,deadline});
  if(quote.status!=="ready_to_authorize")return {status:quote.status,quote:null};
  if(!quote.quote_reference||!quote.quote_expires_at||(quote.maximum_micro_usd!==null&&!editorialCap(quote.maximum_micro_usd)))fail("topic_editorial_quote_expired");
  return {status:"ready_to_authorize",quote:{reference:quote.quote_reference,expires_at:quote.quote_expires_at,
    maximum_micro_usd:quote.maximum_micro_usd,group_count:quote.expected_group_count,
    screening_count:quote.expected_group_count,global_count:0 as const}};
}
/** Starts under the workspace's already approved policy. The signed policy quote
 * remains an internal, short-lived admission seal; it is never a separate UI gate. */
export async function startWorkspaceTopicEditorialBatchV2ForActor(args:Args&{idempotencyKey:string;runtimeEnabled?:boolean}){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid)
    ||!editorialKey(args.idempotencyKey))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool;
  const requestFingerprint=createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0,12);

  // Recover a committed start from the existing idempotency ledger before
  // reading current source/policy. This preserves same-key recovery after a
  // lost HTTP response or later source drift.
  const {prior}=await withTopicEditorialStartPhase("idempotency_lookup",async()=>{
    const client=await database.connect();
    let existing:{quote_reference:string;hard_cap_micro_usd:string|null;contract_version:string}|undefined;
    try{
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL search_path=public,extensions,pg_temp");
      const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
      if(!caps.can_view)fail("processing_forbidden",403);
      const row=(await client.query<{quote_reference:string;hard_cap_micro_usd:string|null;contract_version:string}>(`SELECT e.quote_reference,e.hard_cap_micro_usd::text,e.plan->>'contract_version' contract_version
        FROM signal_topic_editorial_request_keys k
        JOIN signal_topic_editorial_executions e ON e.workspace_id=k.workspace_id AND e.id=k.execution_id
        JOIN signal_topic_consolidation_executions n ON n.workspace_id=e.workspace_id
          AND n.consolidation_run_id=e.numeric_run_id AND n.id=$4::uuid
        WHERE k.workspace_id=$1::uuid AND k.actor_user_id=$2::uuid AND k.idempotency_key=$3
          AND e.plan->>'contract_version' IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,
      [args.workspaceId,args.actorUserId,args.idempotencyKey,args.numericExecutionId])).rows[0];
      if(row)existing=row;
      const keyExists=(await client.query(`SELECT 1 FROM signal_topic_editorial_request_keys
        WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3`,
      [args.workspaceId,args.actorUserId,args.idempotencyKey])).rowCount===1;
      if(keyExists&&!row)fail("processing_idempotency_conflict",409);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
    return {prior:existing};
  },{request_fingerprint:requestFingerprint});
  if(prior){
    const replay=await withTopicEditorialStartPhase<{replayed:boolean;execution_id?:string}>("replay_admission",()=>prior.contract_version==='signal-topic-editorial-admission-header-v3'
      ?replaySignalTopicEditorialChunkedAdmissionV3({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
        numeric_execution_id:args.numericExecutionId,idempotency_key:args.idempotencyKey,quote_reference:prior.quote_reference,
        confirmed_cap_micro_usd:prior.hard_cap_micro_usd})
      :replaySignalTopicEditorialBatchV2({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
      numeric_execution_id:args.numericExecutionId,idempotency_key:args.idempotencyKey,quote_reference:prior.quote_reference,
      confirmed_cap_micro_usd:prior.hard_cap_micro_usd}),{request_fingerprint:requestFingerprint});
    if(!replay.replayed||!replay.execution_id)fail("topic_editorial_v2_replay_unavailable");
    return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
      numeric_execution_id:args.numericExecutionId,action:"start_editorial" as const,execution_id:replay.execution_id,
      idempotency_key:args.idempotencyKey,replayed:true,activation:"not_activated" as const};
  }
  if(args.runtimeEnabled===false)fail("topic_editorial_runtime_unavailable",503);
  const source=await withTopicEditorialStartPhase("validate_source",()=>prepared(args),{request_fingerprint:requestFingerprint});
  const input=await withTopicEditorialStartPhase("load_editorial_input",()=>loadSignalTopicConsolidationEditorialInputV1({database,
    workspace_id:args.workspaceId,actor_user_id:args.actorUserId,numeric_run_id:source.run_id}),{request_fingerprint:requestFingerprint});
  const {buildSignalTopicEditorialBatchPlanFromPreparedInputV2}=await import("@noisia/query-engine");
  const plan=await withTopicEditorialStartPhase("build_batch_plan",async()=>buildSignalTopicEditorialBatchPlanFromPreparedInputV2({
    input,run_id:source.run_id}),{request_fingerprint:requestFingerprint,group_count:input.groups.length});
  const quote=await withTopicEditorialStartPhase("quote_policy",()=>quoteSignalTopicEditorialChunkedAdmissionV3({database,
    workspace_id:args.workspaceId,actor_user_id:args.actorUserId,plan,deadline:Math.floor(Date.now()/1000)+240}),
    {request_fingerprint:requestFingerprint,group_count:plan.expected_group_count,request_count:plan.requests.length});
  if(quote.status!=="ready_to_authorize")fail(quote.status,quote.status==="access_required"?403:409);
  if(!quote.quote_reference||(quote.maximum_micro_usd!==null&&!editorialCap(quote.maximum_micro_usd)))fail("topic_editorial_policy_limit_unavailable");
  const latest=await database.connect();let previous:string|null=null;
  try{
    const row=await withTopicEditorialStartPhase("find_previous_execution",async()=>
      (await latest.query<{id:string|null}>(`SELECT id::text FROM signal_topic_editorial_executions
        WHERE workspace_id=$1 AND numeric_run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspaceId,source.run_id])).rows[0],
      {request_fingerprint:requestFingerprint});
    previous=row?.id??null;
  }finally{latest.release();}
  const result=await withTopicEditorialStartPhase("durable_admission",()=>requestSignalTopicEditorialChunkedAdmissionV3({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
    plan,idempotency_key:args.idempotencyKey,quote_reference:quote.quote_reference!,
      previous_execution_id:previous??undefined}),{request_fingerprint:requestFingerprint,group_count:plan.expected_group_count,request_count:plan.requests.length});
  // Admission already owns the immutable request plan. Reuse and provider-manifest
  // preparation run through the replay-safe Worker drainer so this HTTP request
  // returns a durable receipt instead of doing the full corpus synchronously.
  return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
    numeric_execution_id:args.numericExecutionId,action:"start_editorial" as const,execution_id:result.execution_id,
    idempotency_key:args.idempotencyKey,replayed:result.replayed,activation:"not_activated" as const};
}
export async function loadWorkspaceTopicEditorialBatchStatusV2ForActor(args:Args){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool,client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view)fail("processing_forbidden",403);
    const row=(await client.query<{execution_id:string;status:string;owner_stage:string;contract_version:string;expected:number;done:number;reused_results:number;maximum:string|null;confirmed:string;reserved:string;ambiguous:string;materialized:boolean;
      topic:number;narrative:number;noise:number;insufficient:number;technical:number;pending:number;recovering:number;batch_states:Record<string,number>;error_codes:string[]}>(`
      WITH numeric AS (
        SELECT consolidation_run_id FROM signal_topic_consolidation_executions
        WHERE workspace_id=$1 AND id=$2 AND status='ready'
      ), latest AS (
        SELECT e.* FROM signal_topic_editorial_executions e,numeric n
        WHERE e.workspace_id=$1 AND e.numeric_run_id=n.consolidation_run_id
          AND e.plan->>'contract_version' IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1
      ), requests AS (
        SELECT r.id,r.request_digest,e.id execution_id,e.status execution_status,o.stage owner_stage,o.send_not_after
        FROM latest e JOIN signal_topic_editorial_requests r ON r.execution_id=e.id
        JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id
      ), call_attempts AS (
        SELECT c.request_id,count(*)::integer attempt_count FROM latest e
        JOIN signal_topic_editorial_calls c ON c.execution_id=e.id AND c.transport_version=2
        GROUP BY c.request_id
      ), latest_items AS (
        -- Read every provider result for this execution once. The old correlated
        -- WHERE item.request_id=request.id lookup could repeatedly scan the
        -- large items table because its leading key is batch_id, not request_id.
        SELECT DISTINCT ON(i.request_id) i.request_id,i.validation,i.outcome,c.status call_status,
          COALESCE(i.validation->>'code',c.error_code) error_code,b.state batch_state,b.error_code batch_error,
          c.response_body_private::jsonb response_body,COALESCE(attempts.attempt_count,0) attempt_count
        FROM latest e JOIN signal_topic_editorial_provider_batches_v2 b ON b.execution_id=e.id
        JOIN signal_topic_editorial_batch_items_v2 i ON i.batch_id=b.id
        JOIN signal_topic_editorial_calls c ON c.id=i.call_id
        LEFT JOIN call_attempts attempts ON attempts.request_id=i.request_id
        ORDER BY i.request_id,b.created_at DESC,b.id DESC
      ), unit_outcomes AS (
        SELECT r.id,r.request_digest,
          reused.request_id IS NOT NULL reused,reused.decision->>'disposition' reused_disposition,
          item.validation,item.outcome,item.call_status,item.error_code item_error,
          item.batch_state,item.batch_error,
          -- This counts requests whose exact grammar failure remains eligible for
          -- the existing retry path. The Worker schedules them only after the full
          -- ended Batch is imported and its state becomes applied.
          COALESCE(r.owner_stage='screening' AND r.execution_status IN('queued','running')
            AND item.batch_state IN('ended','applied') AND item.call_status='settled' AND reused.request_id IS NULL
            AND item.outcome='errored' AND item.validation->>'status'='invalid_message'
            AND item.validation->>'code'='topic_editorial_v2_provider_errored'
            AND item.response_body->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%'
            AND item.attempt_count<5 AND clock_timestamp()+interval '3 minutes'<r.send_not_after,false) grammar_recovering,
          COALESCE(reused.request_id IS NOT NULL OR item.validation->>'status' IN('accepted','invalid_message')
            OR item.outcome IN('errored','canceled','expired','submission_rejected')
            OR item.call_status='settled' AND item.validation IS NULL,false) terminal
        FROM requests r
        LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
        LEFT JOIN latest_items item ON item.request_id=r.id
      ), batches AS (
        SELECT state,count(*)::integer n FROM signal_topic_editorial_provider_batches_v2 b,latest e
        WHERE b.execution_id=e.id GROUP BY state
      ), progress AS (
        SELECT count(*)::integer expected,
          count(*) FILTER(WHERE NOT grammar_recovering AND terminal)::integer done,
          count(*) FILTER(WHERE reused)::integer reused_results,
          count(*) FILTER(WHERE (reused OR validation->>'status'='accepted')
            AND COALESCE(reused_disposition,validation->'decision'->>'disposition')='topic')::integer topic,
          count(*) FILTER(WHERE (reused OR validation->>'status'='accepted')
            AND COALESCE(reused_disposition,validation->'decision'->>'disposition')='narrative')::integer narrative,
          count(*) FILTER(WHERE (reused OR validation->>'status'='accepted')
            AND COALESCE(reused_disposition,validation->'decision'->>'disposition')='noise')::integer noise,
          count(*) FILTER(WHERE (reused OR validation->>'status'='accepted')
            AND COALESCE(reused_disposition,validation->'decision'->>'disposition')='unresolved')::integer insufficient,
          count(*) FILTER(WHERE grammar_recovering)::integer recovering,
          count(*) FILTER(WHERE NOT reused AND NOT grammar_recovering AND
            COALESCE(validation->>'status'='invalid_message' OR outcome IN('errored','canceled','expired','submission_rejected')
              OR call_status='settled' AND validation IS NULL,false))::integer technical,
          -- pending and recovering are disjoint unresolved buckets. Treat
          -- unknown/null join state as pending so all expected requests remain
          -- represented and the public partition stays exhaustive.
          count(*) FILTER(WHERE NOT reused AND NOT grammar_recovering AND NOT terminal)::integer pending,
          array_remove(ARRAY(SELECT DISTINCT code FROM (
            SELECT item_error code FROM unit_outcomes WHERE item_error IS NOT NULL AND NOT grammar_recovering
            UNION SELECT batch_error FROM unit_outcomes WHERE batch_error IS NOT NULL AND NOT grammar_recovering
          ) errors ORDER BY code),'') error_codes
        FROM unit_outcomes
      ), costs AS (
        SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'),0)::text confirmed,
          COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)))
            FILTER(WHERE c.status IN('reserved','in_flight','response_persisted')),0)::text reserved,
          COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)))
            FILTER(WHERE c.status='outcome_unknown'),0)::text ambiguous
        FROM latest e LEFT JOIN signal_topic_editorial_calls c ON c.execution_id=e.id
      )
      SELECT e.id::text execution_id,e.status,o.stage owner_stage,e.plan->>'contract_version' contract_version,
        EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions r WHERE r.consolidation_run_id=e.numeric_run_id
          AND r.workspace_id=e.workspace_id AND r.status='validated' AND r.created_by_user_id=e.actor_user_id AND r.created_at>=e.created_at) materialized,
        p.expected,p.done,p.reused_results,p.topic,p.narrative,p.noise,p.insufficient,p.technical,p.pending,p.recovering,
        COALESCE((SELECT jsonb_object_agg(state,n) FROM batches),'{}'::jsonb) batch_states,
        CASE WHEN o.stage='preparation_failed' THEN array_append(p.error_codes,'topic_editorial_batch_preparation_failed') ELSE p.error_codes END error_codes,
        e.hard_cap_micro_usd::text maximum,
        costs.confirmed,costs.reserved,costs.ambiguous
      FROM latest e JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id
      CROSS JOIN progress p CROSS JOIN costs`,[args.workspaceId,args.numericExecutionId])).rows[0];
    await client.query("COMMIT");
    if(!row)return null;
    const preparationFailed=row.owner_stage==="preparation_failed";
    const status=resolveWorkspaceTopicEditorialBatchStatusV2({materialized:row.materialized,preparation_failed:preparationFailed,
      technical_errors:row.technical,ambiguous_micro_usd:row.ambiguous,pending:row.pending,recovering:row.recovering,
      batch_states:row.batch_states,contract_version:row.contract_version});
    return {contract_version:"workspace-topic-editorial-view-v1" as const,workspace_id:args.workspaceId,
      numeric_execution_id:args.numericExecutionId,status,
      can_quote:false,can_retry:caps.can_request_processing&&preparationFailed&&BigInt(row.ambiguous)===0n,
      can_complete:caps.can_request_processing&&status==="review_ready",activation:"not_activated" as const,quote:null,
      execution:{execution_id:row.execution_id,status,
        completed_screening_count:row.done,expected_screening_count:row.expected,maximum_micro_usd:row.maximum,
        confirmed_micro_usd:row.confirmed,reserved_micro_usd:row.reserved,ambiguous_micro_usd:row.ambiguous},
      batch_progress:{topics:row.topic,narratives:row.narrative,noise:row.noise,insufficient_evidence:row.insufficient,
        technical_errors:row.technical,pending:row.pending,recovering:row.recovering,reused_results:row.reused_results,
        batch_states:row.batch_states,error_codes:row.error_codes}};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

/** Retries only a durable local-preparation failure on the same V2 execution.
 * The RPC repeats actor, source, owner-stage and idempotency fences atomically. */
export async function retryWorkspaceTopicEditorialPreparationV2ForActor(args:Args&{executionId:string;idempotencyKey:string}){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId,args.executionId].every(editorialUuid)
    ||!editorialKey(args.idempotencyKey))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool,client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view)fail("processing_forbidden",403);
    const row=(await client.query<{stage:string}>(`SELECT o.stage FROM signal_topic_editorial_executions e
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      JOIN signal_topic_consolidation_executions n ON n.workspace_id=e.workspace_id AND n.consolidation_run_id=e.numeric_run_id
      WHERE e.workspace_id=$1::uuid AND e.id=$2::uuid AND n.id=$3::uuid
        AND e.plan->>'contract_version' IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,
    [args.workspaceId,args.executionId,args.numericExecutionId])).rows[0];
    await client.query("COMMIT");
    if(row?.stage!=="preparation_failed")return null;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
  const result=await retrySignalTopicEditorialBatchPreparationV2({database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,execution_id:args.executionId,idempotency_key:args.idempotencyKey});
  return {contract_version:"workspace-topic-editorial-receipt-v1" as const,workspace_id:args.workspaceId,
    numeric_execution_id:args.numericExecutionId,action:"retry_editorial" as const,execution_id:result.execution_id,
    idempotency_key:args.idempotencyKey,replayed:result.replayed,activation:"not_activated" as const};
}
/** Allows a failed legacy owner to move forward only when its durable work is
 * quiescent. The V2 admission SQL repeats this fence under lock; this read is
 * solely for choosing the truthful UI path and never grants provider authority. */
export async function canSupersedeFailedLegacyEditorialWithBatchV2ForActor(args:Args){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool,client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspaceId,actor_user_id:args.actorUserId});
    if(!caps.can_view||!caps.can_request_processing)return false;
    const row=(await client.query<{eligible:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM signal_topic_consolidation_executions n
      JOIN signal_topic_consolidation_runs r ON r.id=n.consolidation_run_id AND r.workspace_id=n.workspace_id
      JOIN signal_topic_editorial_executions e ON e.numeric_run_id=r.id AND e.workspace_id=n.workspace_id
      WHERE n.workspace_id=$1::uuid AND n.id=$2::uuid AND n.status='ready'
        AND e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v1' AND e.status='failed'
        AND e.execution_token IS NULL
        AND e.id=(SELECT candidate.id FROM signal_topic_editorial_executions candidate
          WHERE candidate.workspace_id=e.workspace_id AND candidate.numeric_run_id=e.numeric_run_id
          ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id
          AND c.status NOT IN('settled','definitely_not_sent'))
        AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_outbox o WHERE o.execution_id=e.id
          AND o.status IN('queued','dispatching'))
    ) eligible`,[args.workspaceId,args.numericExecutionId])).rows[0];
    await client.query("COMMIT");
    return row?.eligible===true;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
export async function authorizeWorkspaceTopicEditorialBatchV2ForActor(args:Args&{quoteReference:string;confirmedMaximumMicroUsd:string|null;
  idempotencyKey:string;runtimeEnabled?:boolean}){
  if(![args.workspaceId,args.actorUserId,args.numericExecutionId].every(editorialUuid)
    ||!editorialKey(args.idempotencyKey)||(args.confirmedMaximumMicroUsd!==null&&!editorialCap(args.confirmedMaximumMicroUsd)))fail("topic_editorial_request_invalid",422);
  const database=args.database??(await import("@/lib/db")).pool;
  const replay=await replaySignalTopicEditorialBatchV2({database,workspace_id:args.workspaceId,actor_user_id:args.actorUserId,
    numeric_execution_id:args.numericExecutionId,idempotency_key:args.idempotencyKey,quote_reference:args.quoteReference,
    confirmed_cap_micro_usd:args.confirmedMaximumMicroUsd});
  if(replay.replayed){
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
  const quote=await quoteSignalTopicEditorialChunkedAdmissionV3({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,plan,deadline});
  if(quote.status!=="ready_to_authorize"||quote.quote_reference!==args.quoteReference
    ||quote.maximum_micro_usd!==args.confirmedMaximumMicroUsd)fail("topic_editorial_quote_expired");
  const latest=await source.database.connect();let previous:string|null=null;
  try{
    const row=(await latest.query<{id:string|null}>(`SELECT id::text FROM signal_topic_editorial_executions
      WHERE workspace_id=$1 AND numeric_run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspaceId,source.run_id])).rows[0];
    previous=row?.id??null;
  }finally{latest.release();}
  const result=await requestSignalTopicEditorialChunkedAdmissionV3({database:source.database,workspace_id:args.workspaceId,
    actor_user_id:args.actorUserId,plan,idempotency_key:args.idempotencyKey,quote_reference:args.quoteReference,
    previous_execution_id:previous});
  // Compatible-result reuse and manifest preparation are handled by the same
  // asynchronous Worker path as the current self-service start command.
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
    const row=(await client.query<{run_id:string;is_v2:boolean}>(`SELECT r.id::text run_id,
      e.plan->>'contract_version' IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3') is_v2
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
