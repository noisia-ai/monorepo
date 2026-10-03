import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../_lib";
import {
  loadWorkspaceTopicComputationForActorV1,
  loadWorkspaceTopicComputationResultsForActorV1,
  requestWorkspaceTopicComputationForActorV1
} from "@/lib/data-os/signal-workspace-topic-computation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams;
  const allowed = new Set(["idempotency_key", "execution_id", "term_key", "cursor"]);
  if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length > 1)
    || query.has("execution_id") !== query.has("term_key") || query.has("cursor") && !query.has("execution_id")
    || query.has("execution_id") && query.has("idempotency_key")) return topicResponse({ error: "workspace_topic_request_invalid" }, 422);
  try {
    const access = { workspaceId, actorUserId: loaded.session.appUser.id };
    if (query.has("execution_id")) return topicResponse(await loadWorkspaceTopicComputationResultsForActorV1({ ...access,
      executionId: query.get("execution_id")!, termKey: query.get("term_key")!, cursor: query.get("cursor") ?? undefined }));
    const key = query.get("idempotency_key");
    if (key !== null && !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) return topicResponse({ error: "workspace_topic_request_invalid" }, 422);
    return topicResponse(await loadWorkspaceTopicComputationForActorV1({ ...access, idempotencyKey: key ?? undefined }));
  } catch (error) { return topicError(error, "workspace_topic_status_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) return topicResponse({ error: "idempotency_key_required" }, 400);
  let body: unknown;
  try { body = await request.json(); }
  catch { return topicResponse({ error: "workspace_topic_request_invalid" }, 422); }
  try {
    return topicResponse(await requestWorkspaceTopicComputationForActorV1({ workspaceId,
      actorUserId: loaded.session.appUser.id, idempotencyKey: key, body }), 202);
  } catch (error) { return topicError(error, "workspace_topic_request_rejected"); }
}
