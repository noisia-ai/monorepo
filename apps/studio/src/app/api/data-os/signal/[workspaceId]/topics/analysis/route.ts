import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../_lib";
import { loadWorkspaceAnalysisForActorV1, requestWorkspaceAnalysisForActorV1 } from "@/lib/data-os/signal-workspace-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "idempotency_key" || query.getAll(key).length !== 1)) return topicResponse({ error: "workspace_analysis_request_invalid" }, 422);
  const key = query.get("idempotency_key");
  if (key !== null && !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) return topicResponse({ error: "workspace_analysis_request_invalid" }, 422);
  try { return topicResponse(await loadWorkspaceAnalysisForActorV1({ workspaceId,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key ?? undefined })); }
  catch (error) { return topicError(error, "workspace_analysis_status_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) return topicResponse({ error: "idempotency_key_required" }, 400);
  let body: unknown;
  try { body = await request.json(); }
  catch { return topicResponse({ error: "workspace_analysis_request_invalid" }, 422); }
  try { return topicResponse(await requestWorkspaceAnalysisForActorV1({ workspaceId,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key, body }), 202); }
  catch (error) { return topicError(error, "workspace_analysis_request_rejected"); }
}
