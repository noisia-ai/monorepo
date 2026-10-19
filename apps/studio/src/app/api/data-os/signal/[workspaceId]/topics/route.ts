import {
  loadSignalWorkspaceContextForTopics,
  requireIdempotencyKey,
  topicError,
  topicResponse
} from "./_lib";
import {
  adoptSignalTopicProductV1,
  createSignalTopicProductV1,
  loadSignalTopicsManagementProductV1
} from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return topicResponse(await loadSignalTopicsManagementProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser
    }));
  } catch (error) {
    return topicError(error, "topic_catalog_unavailable");
  }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return topicResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  let body: { action?: unknown; input?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return topicResponse({ error: "topic_request_invalid", message: "The topic request is invalid." }, 422); }
  try {
    if (body.action === "create") return topicResponse(await createSignalTopicProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, input: body.input
    }), 201);
    if (body.action === "adopt") return topicResponse(await adoptSignalTopicProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, input: body.input
    }), 201);
    return topicResponse({ error: "topic_action_invalid", message: "The topic action is invalid." }, 422);
  } catch (error) {
    return topicError(error, "topic_mutation_rejected");
  }
}
