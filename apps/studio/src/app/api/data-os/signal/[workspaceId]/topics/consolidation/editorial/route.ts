import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../../_lib";
import { loadWorkspaceTopicEditorialForActorV1, requestWorkspaceTopicEditorialForActorV1 } from "@/lib/data-os/signal-topic-editorial-control";
import { authorizeWorkspaceTopicEditorialBatchV2ForActor, loadWorkspaceTopicEditorialBatchStatusV2ForActor,
  completeWorkspaceTopicEditorialBatchV2ForActor, canSupersedeFailedLegacyEditorialWithBatchV2ForActor,
  retryWorkspaceTopicEditorialPreparationV2ForActor } from "@/lib/data-os/signal-topic-editorial-batch-control-v2";
import { editorialUuid, parseWorkspaceTopicEditorialCommandV1 } from "@/lib/data-os/workspace-topic-editorial-contract";
import { enqueueSignalTopicEditorialStartV2, loadSignalTopicEditorialStartV2 } from "@noisia/db";
import { pool } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams, numericExecutionId = query.get("numeric_execution_id");
  if (!editorialUuid(numericExecutionId) || [...query.keys()].some(key => !["numeric_execution_id", "quote"].includes(key) || query.getAll(key).length !== 1)
    || query.has("quote") && query.get("quote") !== "1") return topicResponse({ error: "topic_editorial_request_invalid" }, 422);
  try {
    const withQuote=query.get("quote")==="1";
    const v2=await loadWorkspaceTopicEditorialBatchStatusV2ForActor({workspaceId,actorUserId:loaded.session.appUser.id,numericExecutionId});
    if(v2)return topicResponse(v2);
    const start=await loadSignalTopicEditorialStartV2({database:pool,workspace_id:workspaceId,
      actor_user_id:loaded.session.appUser.id,numeric_execution_id:numericExecutionId});
    if(start){
      const failed=start.status==="failed";
      return topicResponse({contract_version:"workspace-topic-editorial-view-v1",workspace_id:workspaceId,
        numeric_execution_id:numericExecutionId,status:failed?"start_failed":"preparing",can_quote:failed,
        can_retry:false,can_complete:false,activation:"not_activated",quote:null,execution:null,
        ...(failed?{start_error_code:start.error_code??"topic_editorial_start_technical_error"}:{})});
    }
    const view=await loadWorkspaceTopicEditorialForActorV1({workspaceId,actorUserId:loaded.session.appUser.id,numericExecutionId});
    // V1 retry remains available for legacy semantics, but a failed/quiescent
    // owner can instead become V2's explicit predecessor. SQL repeats this
    // exact transition fence during admission and preserves compatible receipts.
    const predecessorEligible=view.execution?.status==="failed"
      ?await canSupersedeFailedLegacyEditorialWithBatchV2ForActor({workspaceId,actorUserId:loaded.session.appUser.id,numericExecutionId})
      :false;
    if(view.execution&&!predecessorEligible)return topicResponse(view);
    const base=predecessorEligible?{...view,status:"not_requested" as const,can_quote:true,can_retry:false,can_complete:false,
      quote:null,execution:null,replaces_failed_v1:true as const}:view;
    if(!withQuote)return topicResponse(base);
    if(process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED!=="true"
      ||process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED!=="true")
      return topicResponse({...base,status:"runtime_unavailable",can_quote:false,quote:null});
    // A quote for every group is now produced in the durable Worker start.
    // The legacy query parameter must not perform the same heavy work in GET.
    return topicResponse(base);
  }
  catch (error) { return topicError(error, "topic_editorial_status_unavailable"); }
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return topicResponse({ error: "idempotency_key_required" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return topicResponse({ error: "topic_editorial_request_invalid" }, 422); }
  try {
    const command=parseWorkspaceTopicEditorialCommandV1(body);
    if(command?.action==="start_editorial"){
      if(process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED!=="true"
        ||process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED!=="true")
        return topicResponse({error:"topic_editorial_runtime_unavailable"},503);
      const start=await enqueueSignalTopicEditorialStartV2({database:pool,workspace_id:workspaceId,
        actor_user_id:loaded.session.appUser.id,numeric_execution_id:command.numeric_execution_id,
        idempotency_key:idempotencyKey});
      return topicResponse({contract_version:"workspace-topic-editorial-start-receipt-v2",workspace_id:workspaceId,
        numeric_execution_id:command.numeric_execution_id,action:"start_editorial",start_id:start.start_id,
        execution_id:start.execution_id,idempotency_key:idempotencyKey,replayed:start.replayed,
        activation:"not_activated"},202);
    }
    if(command?.action==="authorize_editorial"){
      return topicResponse(await authorizeWorkspaceTopicEditorialBatchV2ForActor({workspaceId,
        actorUserId:loaded.session.appUser.id,numericExecutionId:command.numeric_execution_id,
        idempotencyKey,quoteReference:command.quote_reference,confirmedMaximumMicroUsd:command.confirmed_maximum_micro_usd,
        runtimeEnabled:process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED==="true"
          &&process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED==="true"}),202);
    }
    if(command?.action==="complete_catalog"){
      const v2=await completeWorkspaceTopicEditorialBatchV2ForActor({workspaceId,actorUserId:loaded.session.appUser.id,
        numericExecutionId:command.numeric_execution_id,executionId:command.execution_id,idempotencyKey});
      if(v2)return topicResponse(v2,202);
    }
    if(command?.action==="retry_editorial"){
      const v2=await retryWorkspaceTopicEditorialPreparationV2ForActor({workspaceId,actorUserId:loaded.session.appUser.id,
        numericExecutionId:command.numeric_execution_id,executionId:command.execution_id,idempotencyKey});
      if(v2)return topicResponse(v2,202);
    }
    return topicResponse(await requestWorkspaceTopicEditorialForActorV1({workspaceId,actorUserId:loaded.session.appUser.id,idempotencyKey,body}),202);
  }
  catch (error) { return topicError(error, "topic_editorial_request_rejected"); }
}
