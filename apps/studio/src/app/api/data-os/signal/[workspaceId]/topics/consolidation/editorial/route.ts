import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../../_lib";
import { loadWorkspaceTopicEditorialForActorV1, requestWorkspaceTopicEditorialForActorV1 } from "@/lib/data-os/signal-topic-editorial-control";
import { editorialUuid } from "@/lib/data-os/workspace-topic-editorial-contract";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams, numericExecutionId = query.get("numeric_execution_id");
  if (!editorialUuid(numericExecutionId) || [...query.keys()].some(key => !["numeric_execution_id", "quote"].includes(key) || query.getAll(key).length !== 1)
    || query.has("quote") && query.get("quote") !== "1") return topicResponse({ error: "topic_editorial_request_invalid" }, 422);
  try { return topicResponse(await loadWorkspaceTopicEditorialForActorV1({ workspaceId, actorUserId: loaded.session.appUser.id,
    numericExecutionId, withQuote: query.get("quote") === "1" })); }
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
  try { return topicResponse(await requestWorkspaceTopicEditorialForActorV1({ workspaceId, actorUserId: loaded.session.appUser.id, idempotencyKey, body }), 202); }
  catch (error) { return topicError(error, "topic_editorial_request_rejected"); }
}
