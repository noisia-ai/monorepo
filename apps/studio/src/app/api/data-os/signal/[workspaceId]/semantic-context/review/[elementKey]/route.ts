import { loadSignalSemanticContextReviewDetailProductV1 } from "@/lib/data-os/signal-semantic-context-review";

import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  semanticContextError,
  semanticContextResponse
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: {
  params: Promise<{ workspaceId: string; elementKey: string }>;
}) {
  const params = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return semanticContextResponse(await loadSignalSemanticContextReviewDetailProductV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser,
      elementKey: params.elementKey
    }));
  } catch (error) {
    return semanticContextError(error, "semantic_context_review_detail_unavailable");
  }
}
