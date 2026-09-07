import { loadSignalWorkspaceContextForSemanticContextManagement,
  semanticContextError, semanticContextResponse } from "../../../../semantic-context/_lib";
import { loadSignalTopicExecutionResultsProductV1 } from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; executionId: string }> }) {
  const { workspaceId, executionId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const search = new URL(request.url).searchParams;
  const stateValue = search.get("state");
  const state = stateValue === "relevant" || stateValue === "doubt" || stateValue === "excluded" ? stateValue : null;
  try {
    return semanticContextResponse(await loadSignalTopicExecutionResultsProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, executionId,
      termKey: search.get("term_key"), state, limit: Number(search.get("limit") ?? 40)
    }));
  } catch (error) {
    return semanticContextError(error, "topic_results_unavailable");
  }
}
