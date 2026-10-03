import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey,
  topicError, topicResponse } from "../_lib";
import { updateSignalTopicProductV1 } from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return topicResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  try {
    return topicResponse(await updateSignalTopicProductV1({ workspace: loaded.workspace,
      actor: loaded.session.appUser, idempotencyKey, termKey, input: await request.json() }));
  } catch (error) {
    return topicError(error, "topic_update_rejected");
  }
}
