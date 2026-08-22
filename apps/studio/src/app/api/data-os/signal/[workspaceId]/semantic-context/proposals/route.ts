import {
  startSignalSemanticContextProposalRunProductV1
} from "@/lib/data-os/signal-semantic-context-pack";
import { parseSignalSemanticContextProposalStartRequestV1 } from "@/lib/data-os/signal-semantic-context-proposal-api";
import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  requireIdempotencyKey,
  semanticContextError,
  semanticContextResponse
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  let body: ReturnType<typeof parseSignalSemanticContextProposalStartRequestV1>;
  try { body = parseSignalSemanticContextProposalStartRequestV1(await request.json()); }
  catch { return semanticContextResponse({ error: "invalid_semantic_context_proposal_command",
    message: "The proposal generation command is invalid." }, 422); }
  try {
    const result = await startSignalSemanticContextProposalRunProductV1({ workspace: loaded.workspace,
      actor: loaded.session.appUser, idempotencyKey, generationKey: body.generation_key,
      preflightDigest: body.preflight_digest, confirmation: body.confirmation,
      hardCapMicroUsd: body.hard_cap_micro_usd });
    return semanticContextResponse(result, 202);
  } catch (error) { return semanticContextError(error, "semantic_context_proposal_start_rejected"); }
}
