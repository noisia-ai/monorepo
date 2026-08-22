import {
  reconcileSignalSemanticContextGenerationProductV1,
  SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,
  type SignalSemanticContextReconciliationReasonV1
} from "@/lib/data-os/signal-semantic-context-pack";
import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  requireIdempotencyKey,
  semanticContextError,
  semanticContextResponse
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request,
  context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((field) => field !== "reason")
      || typeof (body as { reason?: unknown }).reason !== "string"
      || !SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS.includes(
        (body as { reason: SignalSemanticContextReconciliationReasonV1 }).reason)) {
    return semanticContextResponse({ error: "invalid_semantic_context_reconciliation",
      message: "A supported reconciliation reason is required." }, 422);
  }
  try {
    return semanticContextResponse(await reconcileSignalSemanticContextGenerationProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey,
      reason: (body as { reason: SignalSemanticContextReconciliationReasonV1 }).reason
    }));
  } catch (error) {
    return semanticContextError(error, "semantic_context_reconciliation_rejected");
  }
}
