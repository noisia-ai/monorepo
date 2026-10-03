import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../_lib";
import { EditorialOutcomeReadError, editorialOutcomePageLimitV2,
  loadWorkspaceTopicEditorialOutcomesPageV2 } from "@/lib/data-os/workspace-topic-editorial-outcomes-v2";
import { AtomicCensusReadError } from "@/lib/data-os/workspace-topic-atomic-census";
import { editorialUuid } from "@/lib/data-os/workspace-topic-editorial-contract";
import { performance } from "node:perf_hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const routeStarted = performance.now();
  const timings: Array<{ name: string; durationMs: number }> = [];
  const addTiming = (name: string, durationMs: number) => timings.push({ name, durationMs });
  const withTimings = (response: Response) => {
    addTiming("request", performance.now() - routeStarted);
    response.headers.set("Server-Timing", timings.map(item =>
      `${item.name};dur=${Math.max(0, item.durationMs).toFixed(1)}`).join(", "));
    return response;
  };
  const { workspaceId } = await context.params;
  const accessStarted = performance.now();
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  addTiming("workspace_access", performance.now() - accessStarted);
  if ("response" in loaded) return withTimings(loaded.response
    ?? topicResponse({ error: "topic_editorial_outcomes_context_unavailable" }, 503));
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !["numeric_execution_id", "execution_id", "offset", "limit"].includes(key) || params.getAll(key).length !== 1)
    || !params.has("numeric_execution_id") || !params.has("execution_id") || params.toString().length > 400
    || !editorialUuid(params.get("numeric_execution_id")) || !editorialUuid(params.get("execution_id")))
    return withTimings(topicResponse({ error: "topic_editorial_outcomes_request_invalid" }, 422));
  const offset = params.get("offset") ?? "0", limit = params.get("limit") ?? String(editorialOutcomePageLimitV2);
  if (!/^(0|[1-9][0-9]{0,4})$/u.test(offset) || !/^[1-9][0-9]{0,1}$/u.test(limit)
    || Number(limit) !== editorialOutcomePageLimitV2 || Number(offset) % editorialOutcomePageLimitV2 !== 0)
    return withTimings(topicResponse({ error: "topic_editorial_outcomes_request_invalid" }, 422));
  try {
    const body = await loadWorkspaceTopicEditorialOutcomesPageV2({ workspaceId,
      actorUserId: loaded.session.appUser.id, numericExecutionId: params.get("numeric_execution_id")!,
      editorialExecutionId: params.get("execution_id")!,
      offset: Number(offset), limit: Number(limit), onPhaseTiming: addTiming });
    return withTimings(topicResponse(body));
  } catch (error) {
    if (error instanceof EditorialOutcomeReadError || error instanceof AtomicCensusReadError)
      return withTimings(topicResponse({ error: error.code }, error.status));
    return withTimings(topicError(error, "topic_editorial_outcomes_unavailable"));
  }
}
