import { retrySignalSemanticContextProposalRunProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { parseSignalSemanticContextProposalRetryRequestV1 } from "@/lib/data-os/signal-semantic-context-proposal-api";
import { loadSignalWorkspaceContextForSemanticContextManagement, requireIdempotencyKey,
  semanticContextError, semanticContextResponse } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request,
  context: { params: Promise<{ workspaceId: string; runKey: string }> }) {
  const { workspaceId, runKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  try { parseSignalSemanticContextProposalRetryRequestV1(await request.json()); }
  catch {
    return semanticContextResponse({ error: "invalid_semantic_context_retry",
      message: "Retry does not accept authority or provider overrides." }, 422);
  }
  try { return semanticContextResponse(await retrySignalSemanticContextProposalRunProductV1({
    workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, runKey }), 202); }
  catch (error) { return semanticContextError(error, "semantic_context_proposal_retry_rejected"); }
}
