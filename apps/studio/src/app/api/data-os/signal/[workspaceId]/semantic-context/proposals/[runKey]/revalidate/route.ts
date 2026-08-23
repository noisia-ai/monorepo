import { revalidateSignalSemanticContextPaidResponseProductV1 } from
  "@/lib/data-os/signal-semantic-context-pack";
import { parseSignalSemanticContextProposalRevalidationRequestV1 } from
  "@/lib/data-os/signal-semantic-context-proposal-api";
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
  let body: ReturnType<typeof parseSignalSemanticContextProposalRevalidationRequestV1>;
  try { body = parseSignalSemanticContextProposalRevalidationRequestV1(await request.json()); }
  catch {
    return semanticContextResponse({ error: "invalid_semantic_context_revalidation",
      message: "Revalidation requires explicit confirmation and accepts no authority overrides." }, 422);
  }
  try {
    return semanticContextResponse(await revalidateSignalSemanticContextPaidResponseProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey, runKey,
      confirmation: body.confirmation
    }));
  } catch (error) {
    return semanticContextError(error, "semantic_context_paid_response_revalidation_rejected");
  }
}
