import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../_lib";
import { EditorialOutcomeReadError, editorialOutcomePageLimitV2,
  loadWorkspaceTopicEditorialOutcomesPageV2 } from "@/lib/data-os/workspace-topic-editorial-outcomes-v2";
import { AtomicCensusReadError } from "@/lib/data-os/workspace-topic-atomic-census";
import { editorialUuid } from "@/lib/data-os/workspace-topic-editorial-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !["numeric_execution_id", "execution_id", "offset", "limit"].includes(key) || params.getAll(key).length !== 1)
    || !params.has("numeric_execution_id") || !params.has("execution_id") || params.toString().length > 400
    || !editorialUuid(params.get("numeric_execution_id")) || !editorialUuid(params.get("execution_id")))
    return topicResponse({ error: "topic_editorial_outcomes_request_invalid" }, 422);
  const offset = params.get("offset") ?? "0", limit = params.get("limit") ?? String(editorialOutcomePageLimitV2);
  if (!/^(0|[1-9][0-9]{0,4})$/u.test(offset) || !/^[1-9][0-9]{0,1}$/u.test(limit)
    || Number(limit) !== editorialOutcomePageLimitV2 || Number(offset) % editorialOutcomePageLimitV2 !== 0)
    return topicResponse({ error: "topic_editorial_outcomes_request_invalid" }, 422);
  try {
    return topicResponse(await loadWorkspaceTopicEditorialOutcomesPageV2({ workspaceId,
      actorUserId: loaded.session.appUser.id, numericExecutionId: params.get("numeric_execution_id")!,
      editorialExecutionId: params.get("execution_id")!,
      offset: Number(offset), limit: Number(limit) }));
  } catch (error) {
    if (error instanceof EditorialOutcomeReadError || error instanceof AtomicCensusReadError)
      return topicResponse({ error: error.code }, error.status);
    return topicError(error, "topic_editorial_outcomes_unavailable");
  }
}
