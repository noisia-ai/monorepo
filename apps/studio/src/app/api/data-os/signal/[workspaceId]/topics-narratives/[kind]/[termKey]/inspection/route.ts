import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../../topics/_lib";
import { loadNativeSignalTopicReadBundleV1 } from "@/lib/data-os/signal-workspace-topics-native";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; kind: string; termKey: string }> }) {
  const { workspaceId, kind, termKey } = await context.params;
  const params = new URL(request.url).searchParams;
  if (params.get("view") !== "all_conversations" || kind !== "topic" && kind !== "narrative")
    return topicResponse({ error: "workspace_topic_not_found" }, 404);
  const scoped = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in scoped) return scoped.response;
  try {
    return topicResponse(await loadNativeSignalTopicReadBundleV1({ workspace_id: workspaceId,
      actor_user_id: scoped.session.appUser.id, timezone: scoped.workspace.timezone }, termKey, params, kind));
  } catch (error) { return topicError(error, "workspace_topic_inspection_unavailable"); }
}
