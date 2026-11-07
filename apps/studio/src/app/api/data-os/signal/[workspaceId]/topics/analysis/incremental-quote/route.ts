import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../_lib";
import { quoteWorkspaceIncrementalEditorialForActorV1 } from "@/lib/data-os/signal-workspace-analysis";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams, action = query.get("action"), runId = query.get("run_id");
  if (!["begin_incremental_editorial", "renew_incremental_editorial"].includes(action ?? "")
    || !runId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(runId)
    || [...query.keys()].some(key => !["action", "run_id"].includes(key) || query.getAll(key).length !== 1))
    return topicResponse({ error: "workspace_analysis_request_invalid" }, 422);
  try { return topicResponse(await quoteWorkspaceIncrementalEditorialForActorV1({ workspaceId,
    actorUserId: loaded.session.appUser.id, runId, action: action as "begin_incremental_editorial" | "renew_incremental_editorial" })); }
  catch (error) { return topicError(error, "workspace_incremental_editorial_quote_unavailable"); }
}
