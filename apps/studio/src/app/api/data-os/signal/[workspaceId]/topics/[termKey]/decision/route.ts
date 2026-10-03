import { loadDefinedInterestDecisionProductV1,
  startDefinedInterestDecisionSelfServiceV1 } from
  "@/lib/data-os/signal-defined-interest-decision";
import { loadSignalWorkspaceContextForTopics,
  requireIdempotencyKey, topicError, topicResponse } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request,
  context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try { return topicResponse(await loadDefinedInterestDecisionProductV1({
    workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, term_key: termKey })); }
  catch (error) { return topicError(error, "interest_decision_status_unavailable"); }
}

export async function POST(request: Request,
  context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key) return topicResponse({ error: "interest_decision_request_invalid" }, 422);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || body.action !== "classify_interest")
      return topicResponse({ error: "interest_decision_request_invalid" }, 422);
    return topicResponse(await startDefinedInterestDecisionSelfServiceV1({
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id,
      term_key: termKey }, key), 202);
  } catch (error) { return topicError(error, "interest_decision_start_rejected"); }
}
