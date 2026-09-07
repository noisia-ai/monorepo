import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  requireIdempotencyKey,
  semanticContextError,
  semanticContextResponse
} from "../semantic-context/_lib";
import {
  adoptSignalTopicProductV1,
  createSignalTopicProductV1,
  loadSignalTopicsManagementProductV1
} from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return semanticContextResponse(await loadSignalTopicsManagementProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser
    }));
  } catch (error) {
    return semanticContextError(error, "topic_catalog_unavailable");
  }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  let body: { action?: unknown; input?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return semanticContextResponse({ error: "topic_request_invalid", message: "The topic request is invalid." }, 422); }
  try {
    if (body.action === "create") return semanticContextResponse(await createSignalTopicProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, input: body.input
    }), 201);
    if (body.action === "adopt") return semanticContextResponse(await adoptSignalTopicProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, input: body.input
    }), 201);
    return semanticContextResponse({ error: "topic_action_invalid", message: "The topic action is invalid." }, 422);
  } catch (error) {
    return semanticContextError(error, "topic_mutation_rejected");
  }
}
