import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../_lib";
import { AtomicGroupMembersError, loadWorkspaceTopicAtomicGroupMembersV1 } from "@/lib/data-os/workspace-topic-atomic-members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !["numeric_execution_id", "group_key", "cursor"].includes(key)
    || params.getAll(key).length !== 1) || !params.has("numeric_execution_id") || !params.has("group_key")
    || params.toString().length > 400)
    return topicResponse({ error: "topic_atomic_members_request_invalid" }, 422);
  try {
    return topicResponse(await loadWorkspaceTopicAtomicGroupMembersV1({ workspaceId,
      actorUserId: loaded.session.appUser.id, numericExecutionId: params.get("numeric_execution_id") ?? "",
      groupKey: params.get("group_key") ?? "", cursor: params.get("cursor") }));
  } catch (error) {
    if (error instanceof AtomicGroupMembersError) return topicResponse({ error: error.code }, error.status);
    return topicError(error, "topic_atomic_members_unavailable");
  }
}
