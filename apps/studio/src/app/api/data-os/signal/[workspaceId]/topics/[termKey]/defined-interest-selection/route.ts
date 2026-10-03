import { loadDefinedInterestSelectionProductV1, mutateDefinedInterestSelectionProductV1,
  parseDefinedInterestSelectionCommandV1 } from
  "@/lib/data-os/signal-defined-interest-selection";
import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = new URL(request.url).searchParams.get("idempotency_key") ?? undefined;
  if (key !== undefined && (key.length < 8 || key.length > 200)) return topicResponse({ error: "defined_interest_selection_request_invalid" }, 422);
  try { return topicResponse(await loadDefinedInterestSelectionProductV1({ workspace_id: workspaceId,
    actor_user_id: loaded.session.appUser.id }, termKey, key)); }
  catch (error) { return topicError(error, "defined_interest_selection_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key) return topicResponse({ error: "defined_interest_selection_request_invalid" }, 422);
  try {
    const command = parseDefinedInterestSelectionCommandV1(await request.json(), termKey);
    return topicResponse(await mutateDefinedInterestSelectionProductV1({ workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id }, command, key));
  } catch (error) { return topicError(error, "defined_interest_selection_rejected"); }
}
