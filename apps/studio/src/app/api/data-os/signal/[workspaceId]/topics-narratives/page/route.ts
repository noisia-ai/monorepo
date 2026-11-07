import { allowImportedSignalFallbackV1 } from "@/lib/data-os/signal-imported-serving";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../topics/_lib";
import { loadNativeSignalTopicsPageV1 } from "@/lib/data-os/signal-workspace-topics-native";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const params = new URL(request.url).searchParams;
  if (params.get("view") !== "all_conversations") return topicResponse({ error: "workspace_topic_not_found" }, 404);
  const scoped = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in scoped) return scoped.response;
  try {
    const bundle = await loadNativeSignalTopicsPageV1({ workspace_id: workspaceId, actor_user_id: scoped.session.appUser.id,
      timezone: scoped.workspace.timezone, imported_fallback: allowImportedSignalFallbackV1(scoped.workspace) }, params);
    return bundle ? topicResponse(bundle) : topicResponse({ error: "workspace_topic_not_found" }, 404);
  } catch (error) { return topicError(error, "workspace_topics_unavailable"); }
}
