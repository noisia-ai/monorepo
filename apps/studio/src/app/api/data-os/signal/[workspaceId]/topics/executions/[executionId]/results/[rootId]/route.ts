import { loadSignalWorkspaceContextForSemanticContextManagement, requireIdempotencyKey,
  semanticContextError, semanticContextResponse } from "../../../../../semantic-context/_lib";
import { correctSignalTopicMembershipProductV1 } from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{
  workspaceId: string; executionId: string; rootId: string;
}> }) {
  const { workspaceId, executionId, rootId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  const url = new URL(request.url);
  const termKey = url.searchParams.get("term_key") ?? "";
  try {
    return semanticContextResponse(await correctSignalTopicMembershipProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey,
      executionId, rootId, termKey, input: await request.json()
    }));
  } catch (error) {
    return semanticContextError(error, "topic_correction_rejected");
  }
}
