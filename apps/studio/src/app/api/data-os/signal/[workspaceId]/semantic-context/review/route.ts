import {
  loadSignalSemanticContextReviewPageProductV1,
  parseSignalSemanticContextReviewFiltersV1
} from "@/lib/data-os/signal-semantic-context-review";

import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  semanticContextError,
  semanticContextResponse
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const params = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if ("response" in loaded) return loaded.response;
  const url = new URL(request.url);
  try {
    return semanticContextResponse(await loadSignalSemanticContextReviewPageProductV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser,
      filters: parseSignalSemanticContextReviewFiltersV1(url.searchParams)
    }));
  } catch (error) {
    return semanticContextError(error, "semantic_context_review_unavailable");
  }
}
