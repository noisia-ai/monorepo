import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../_lib";
import { AtomicCensusReadError, loadWorkspaceTopicAtomicCensusPageV1 } from "@/lib/data-os/workspace-topic-atomic-census";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !["numeric_execution_id", "page", "q"].includes(key) || params.getAll(key).length !== 1)
    || !params.has("numeric_execution_id") || params.toString().length > 300)
    return topicResponse({ error: "topic_atomic_census_request_invalid" }, 422);
  const page = params.get("page") ?? "1";
  if (!/^[1-9][0-9]{0,2}$/u.test(page)) return topicResponse({ error: "topic_atomic_census_request_invalid" }, 422);
  try {
    return topicResponse(await loadWorkspaceTopicAtomicCensusPageV1({ workspaceId, actorUserId: loaded.session.appUser.id,
      numericExecutionId: params.get("numeric_execution_id") ?? "", page: Number(page), query: params.get("q") ?? "" }));
  } catch (error) {
    if (error instanceof AtomicCensusReadError) return topicResponse({ error: error.code }, error.status);
    return topicError(error, "topic_atomic_census_unavailable");
  }
}
