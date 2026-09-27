import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../../_lib";
import { loadWorkspaceTopicEditorialForActorV1, requestWorkspaceTopicEditorialForActorV1 } from "@/lib/data-os/signal-topic-editorial-control";
import { authorizeWorkspaceTopicEditorialBatchV2ForActor, loadWorkspaceTopicEditorialBatchStatusV2ForActor,
  quoteWorkspaceTopicEditorialBatchV2ForActor, completeWorkspaceTopicEditorialBatchV2ForActor } from "@/lib/data-os/signal-topic-editorial-batch-control-v2";
import { editorialUuid, parseWorkspaceTopicEditorialCommandV1 } from "@/lib/data-os/workspace-topic-editorial-contract";
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
    const view=await loadWorkspaceTopicEditorialForActorV1({workspaceId,actorUserId:loaded.session.appUser.id,numericExecutionId});
    if(!withQuote)return topicResponse(view);
    // A non-quiescent legacy owner cannot be replaced by V2. Keep its truthful
    // progress visible instead of composing a quote over an incompatible view.
    if(view.execution)return topicResponse(view);
    if(process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED!=="true"
      ||process.env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED!=="true")
      return topicResponse({...view,status:"runtime_unavailable",can_quote:false,quote:null});
    const quote=await quoteWorkspaceTopicEditorialBatchV2ForActor({workspaceId,actorUserId:loaded.session.appUser.id,numericExecutionId});
    return topicResponse({...view,status:quote.status as typeof view.status,can_quote:quote.status==="ready_to_authorize",quote:quote.quote});
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
    return topicResponse(await requestWorkspaceTopicEditorialForActorV1({workspaceId,actorUserId:loaded.session.appUser.id,idempotencyKey,body}),202);
  }
  catch (error) { return topicError(error, "topic_editorial_request_rejected"); }
}
