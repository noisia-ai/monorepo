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
  const capValue = request.headers.get("X-Noisia-Embedding-Cost-Cap-Micro-Usd");
  if (capValue !== null && !/^[1-9][0-9]*$/u.test(capValue)) {
    return topicResponse({ error: "topic_embedding_hard_cap_invalid",
      message: "The embedding cost cap is invalid." }, 422);
  }
  const embeddingCostCapMicroUsd = capValue === null ? undefined : Number(capValue);
  if (embeddingCostCapMicroUsd !== undefined
    && (!Number.isSafeInteger(embeddingCostCapMicroUsd) || embeddingCostCapMicroUsd > 1_000_000)) {
    return topicResponse({ error: "topic_embedding_hard_cap_invalid",
      message: "The embedding cost cap is invalid." }, 422);
  }
  try {
    return topicResponse(await updateSignalTopicProductV1({ workspace: loaded.workspace,
      actor: loaded.session.appUser, idempotencyKey, termKey, input: await request.json(),
      embeddingCostCapMicroUsd }));
  } catch (error) {
    return topicError(error, "topic_update_rejected");
  }
}
