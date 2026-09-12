import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../_lib";
import { loadWorkspaceTopicConsolidationForActorV1,
  requestWorkspaceTopicConsolidationForActorV1 } from "@/lib/data-os/signal-topic-consolidation-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== "source_execution_id" || query.getAll(key).length !== 1))
    return topicResponse({ error: "topic_consolidation_request_invalid" }, 422);
  try { return topicResponse(await loadWorkspaceTopicConsolidationForActorV1({ workspaceId,
    actorUserId: loaded.session.appUser.id, sourceExecutionId: query.get("source_execution_id") ?? undefined })); }
  catch (error) { return topicError(error, "topic_consolidation_status_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return topicResponse({ error: "idempotency_key_required" }, 400);
  let body: unknown;
  try { body = await request.json(); }
  catch { return topicResponse({ error: "topic_consolidation_request_invalid" }, 422); }
  try { return topicResponse(await requestWorkspaceTopicConsolidationForActorV1({ workspaceId,
    actorUserId: loaded.session.appUser.id, idempotencyKey, body }), 202); }
  catch (error) { return topicError(error, "topic_consolidation_request_rejected"); }
}
