import { loadSignalSemanticContextProposalRunProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { loadSignalWorkspaceContextForSemanticContextManagement,
  semanticContextError, semanticContextResponse } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request,
  context: { params: Promise<{ workspaceId: string; runKey: string }> }) {
  const { workspaceId, runKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  try { return semanticContextResponse(await loadSignalSemanticContextProposalRunProductV1({
    workspace: loaded.workspace, actor: loaded.session.appUser, runKey })); }
  catch (error) { return semanticContextError(error, "semantic_context_proposal_status_unavailable"); }
}
