import type { Job } from "bullmq";
import { z } from "zod";

import {
  applySignalSemanticResolutionResultBatchV2,
  loadSignalSemanticResolutionBatchV1,
  loadSignalSemanticResolutionChildRuntimeV2,
  loadSignalSemanticResolutionGovernedContextV1,
  SignalSemanticResolutionContractError,
  type SignalSemanticResolutionAppliedResultV2
} from "@noisia/db";
import type {
  SignalSemanticResolutionChildJobDataV2,
  SignalSemanticResolutionDecisionV1
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  mapSignalSemanticResolutionSingleOutputV1,
  signalSemanticResolutionMentionIdFromCustomIdV1,
  signalSemanticResolutionSingleOutputSchemaV1
} from "./signal-semantic-resolution-contract";
import {
  cancelSignalSemanticResolutionMessageBatchV1,
  createSignalSemanticResolutionMessageBatchV1,
  getSignalSemanticResolutionMessageBatchV1,
  loadSignalSemanticResolutionMessageBatchResultsV1,
  parseSignalSemanticResolutionBatchMessageTextV1,
  signalSemanticResolutionBatchErrorCodeV1,
  signalSemanticResolutionBatchUsageV2,
  type AnthropicMessageBatchV1,
  type AnthropicBatchResultV1
} from "./signal-semantic-resolution-message-batch";

const PROVIDER_POLL_INTERVAL_MS = 15_000;
const EXECUTION_LEASE_SECONDS = 900;
const APPLICATION_CHUNK_SIZE = 1_000;

export async function signalSemanticResolutionChildJob(
  job: Job<SignalSemanticResolutionChildJobDataV2>
) {
  const data = validateJobData(job.data);
  const claimed = await pool.query<{ lease_token: string }>(`
    SELECT claim_signal_semantic_resolution_child_execution_v1(
      $1::uuid,$2::uuid,$3
    )::text AS lease_token
  `, [data.outbox_id,data.child_batch_id,EXECUTION_LEASE_SECONDS]);
  const leaseToken = claimed.rows[0]?.lease_token;
  if (!leaseToken) throw new Error("semantic_resolution_child_lease_missing");
  try {
    let runtime = await loadSignalSemanticResolutionChildRuntimeV2(pool,data);
    if (!["queued","running","applying"].includes(runtime.run_status)) {
      throw new Error("semantic_resolution_parent_not_running");
    }
    assertNotCanceled(runtime.cancellation_requested_at);
    await pool.query(`
      SELECT reserve_signal_semantic_resolution_child_budget_v1($1::uuid,$2::uuid)
    `, [data.child_batch_id,leaseToken]);
    const governedContext = await loadSignalSemanticResolutionGovernedContextV1(pool,data.workspace_id);
    const mentions = await loadSignalSemanticResolutionBatchV1(pool,{
      run_id:data.run_id,
      child_batch_id:data.child_batch_id,
      limit:runtime.item_count
    });
    let batch: AnthropicMessageBatchV1;
    if (runtime.provider_batch_id) {
      batch = await getSignalSemanticResolutionMessageBatchV1(runtime.provider_batch_id);
    } else {
      if (runtime.provider_batch_status === "submitting") {
        throw new Error("semantic_resolution_provider_submission_ambiguous");
      }
      const reserved = await pool.query(`
        UPDATE signal_semantic_resolution_child_batches
        SET provider_batch_status='submitting',updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='provider'
          AND provider_batch_id IS NULL AND provider_batch_status='not_submitted'
      `,[data.child_batch_id,leaseToken]);
      if (reserved.rowCount!==1) throw new Error("semantic_resolution_provider_submission_changed");
      runtime = await loadSignalSemanticResolutionChildRuntimeV2(pool,data);
      assertNotCanceled(runtime.cancellation_requested_at);
      batch = await createSignalSemanticResolutionMessageBatchV1({
        model:runtime.model_version,governedContext,mentions
      });
      const attached = await pool.query(`
        UPDATE signal_semantic_resolution_child_batches
        SET provider_batch_id=$3,provider_batch_status=$4,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='provider'
          AND provider_batch_status='submitting' AND provider_batch_id IS NULL
      `,[data.child_batch_id,leaseToken,batch.id,batch.processing_status]);
      if(attached.rowCount!==1)throw new Error("semantic_resolution_provider_attachment_changed");
    }
    while(batch.processing_status!=="ended"){
      const live=await loadSignalSemanticResolutionChildRuntimeV2(pool,data);
      if(live.cancellation_requested_at && batch.processing_status==="in_progress"){
        batch=await cancelSignalSemanticResolutionMessageBatchV1(batch.id);
        await pool.query(`UPDATE signal_semantic_resolution_child_batches
          SET provider_batch_status='canceling',updated_at=now()
          WHERE id=$1::uuid AND lease_token=$2::uuid AND status='provider'
            AND provider_batch_id=$3`,[data.child_batch_id,leaseToken,batch.id]);
      }
      await heartbeat(data.child_batch_id,leaseToken,"provider");
      await job.updateProgress({
        phase:"provider",processed:providerProcessed(batch),total:runtime.item_count,
        child_batch_ordinal:runtime.child_ordinal
      });
      await delay(PROVIDER_POLL_INTERVAL_MS);
      batch=await getSignalSemanticResolutionMessageBatchV1(batch.id);
      await pool.query(`
        UPDATE signal_semantic_resolution_child_batches
        SET provider_batch_status=$3,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='provider'
          AND provider_batch_id=$4
      `,[data.child_batch_id,leaseToken,batch.processing_status,batch.id]);
    }
    await loadSignalSemanticResolutionChildRuntimeV2(pool,data);
    await heartbeat(data.child_batch_id,leaseToken,"applying");
    const results=await loadSignalSemanticResolutionMessageBatchResultsV1(batch);
    const totals={input:0,output:0,costMicroUsd:0n};
    for(let offset=0;offset<results.length;offset+=APPLICATION_CHUNK_SIZE){
      const chunk=results.slice(offset,offset+APPLICATION_CHUNK_SIZE)
        .map((result)=>mapProviderResult({result,governedContext,totals}));
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        await applySignalSemanticResolutionResultBatchV2(client,{
          run_id:data.run_id,child_batch_id:data.child_batch_id,
          reviewer_user_id:runtime.requested_by_user_id,model_version:runtime.model_version,
          results:chunk
        });
        await client.query("COMMIT");
      }catch(error){
        await client.query("ROLLBACK").catch(()=>undefined);
        throw error;
      }finally{client.release();}
      await heartbeat(data.child_batch_id,leaseToken,"applying");
      await job.updateProgress({phase:"applying",processed:Math.min(offset+chunk.length,results.length),total:runtime.item_count});
    }
    await pool.query(`
      UPDATE signal_semantic_resolution_run_items SET status='failed',
        error_code='semantic_resolution_provider_result_missing',completed_at=now(),updated_at=now()
      WHERE child_batch_id=$1::uuid AND status IN ('pending','processing')
    `,[data.child_batch_id]);
    await pool.query(`
      SELECT settle_signal_semantic_resolution_child_budget_v1(
        $1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::bigint
      )
    `,[data.child_batch_id,leaseToken,totals.input,totals.output,totals.costMicroUsd.toString()]);
    const completed=await pool.query<{status:string}>(`
      SELECT complete_signal_semantic_resolution_child_v1(
        $1::uuid,$2::uuid,$3::uuid
      ) AS status
    `,[data.outbox_id,data.child_batch_id,leaseToken]);
    return {run_id:data.run_id,child_batch_id:data.child_batch_id,status:completed.rows[0]?.status??"unknown"};
  }catch(error){
    const isLastAttempt=job.attemptsMade+1>=Number(job.opts.attempts??1);
    const terminal=isLastAttempt || error instanceof SignalSemanticResolutionContractError
      || safeError(error).includes("submission_ambiguous")
      || safeError(error).includes("hard cap");
    if(terminal){
      await pool.query(`SELECT fail_signal_semantic_resolution_child_v1(
        $1::uuid,$2::uuid,$3::uuid,$4
      )`,[data.outbox_id,data.child_batch_id,leaseToken,safeError(error)]).catch(()=>undefined);
    }else{
      await pool.query(`SELECT retry_signal_semantic_resolution_child_execution_v1(
        $1::uuid,$2::uuid,$3
      )`,[data.child_batch_id,leaseToken,safeError(error)]).catch(()=>undefined);
    }
    throw error;
  }
}

function assertNotCanceled(cancellationRequestedAt:string|null){
  if(cancellationRequestedAt){
    throw new SignalSemanticResolutionContractError(
      "forbidden_state","Semantic resolution was canceled before provider dispatch."
    );
  }
}

function mapProviderResult(args:{
  result:AnthropicBatchResultV1;
  governedContext:Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>;
  totals:{input:number;output:number;costMicroUsd:bigint};
}):SignalSemanticResolutionAppliedResultV2{
  const mentionId=signalSemanticResolutionMentionIdFromCustomIdV1(args.result.custom_id);
  if(args.result.result.type==="succeeded"){
    const usage=signalSemanticResolutionBatchUsageV2(args.result.result);
    const output=signalSemanticResolutionSingleOutputSchemaV1.parse(
      parseSignalSemanticResolutionBatchMessageTextV1(args.result.result)
    );
    const decision:SignalSemanticResolutionDecisionV1=mapSignalSemanticResolutionSingleOutputV1({
      mentionId,output,governedContext:args.governedContext
    });
    args.totals.input+=usage.input_tokens;
    args.totals.output+=usage.output_tokens;
    args.totals.costMicroUsd+=BigInt(usage.cost_micro_usd);
    return {
      provider_custom_id:args.result.custom_id,mention_id:mentionId,result_status:"succeeded",
      decision,classifications:decision.classifications.map((classification)=>{
        if(classification.scope==="unattributed")return {
          ...classification,entity_type:"unattributed" as const,entity_label:null
        };
        const identity=args.governedContext.identities.find((candidate)=>(
          candidate.scope===classification.scope && candidate.entity_id===classification.entity_id
        ));
        if(!identity)throw new Error("semantic_resolution_result_entity_not_governed");
        return {...classification,entity_type:classification.scope==="primary_brand"
          ? "brand" as const:classification.scope,entity_label:identity.entity_label};
      }),input_tokens:usage.input_tokens,output_tokens:usage.output_tokens,
      cache_creation_input_tokens:usage.cache_creation_input_tokens,
      cache_read_input_tokens:usage.cache_read_input_tokens,cost_usd:usage.cost_usd,
      error_code:null
    };
  }
  const code=signalSemanticResolutionBatchErrorCodeV1(args.result.result);
  return {provider_custom_id:args.result.custom_id,mention_id:mentionId,
    result_status:args.result.result.type,decision:null,classifications:[],input_tokens:0,
    output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0,
    cost_usd:"0.000000",error_code:code};
}

async function heartbeat(childBatchId:string,leaseToken:string,status:"provider"|"applying"){
  await pool.query(`SELECT heartbeat_signal_semantic_resolution_child_v1(
    $1::uuid,$2::uuid,$3,$4
  )`,[childBatchId,leaseToken,status,EXECUTION_LEASE_SECONDS]);
}

function validateJobData(value:SignalSemanticResolutionChildJobDataV2){
  const schema=z.object({
    outbox_id:z.string().uuid(),run_id:z.string().uuid(),child_batch_id:z.string().uuid(),workspace_id:z.string().uuid()
  }).strict();
  return schema.parse(value);
}

function providerProcessed(batch:AnthropicMessageBatchV1){
  return batch.request_counts.succeeded+batch.request_counts.errored
    +batch.request_counts.canceled+batch.request_counts.expired;
}

function safeError(error:unknown){return(error instanceof Error?error.message:"semantic_resolution_child_failed").slice(0,120);}
function delay(milliseconds:number){return new Promise<void>((resolve)=>setTimeout(resolve,milliseconds));}
