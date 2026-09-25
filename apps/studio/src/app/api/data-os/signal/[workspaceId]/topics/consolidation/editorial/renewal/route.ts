import { quoteSignalTopicEditorialRenewalV1, renewSignalTopicEditorialExecutionV1 } from "@noisia/db";
import { editorialCap, editorialKey, editorialQuote, editorialUuid } from "@/lib/data-os/workspace-topic-editorial-contract";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey, topicError, topicResponse } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams;
  const executionId = query.get("execution_id");
  if (!editorialUuid(executionId) || [...query.keys()].some(key => key !== "execution_id" || query.getAll(key).length !== 1))
    return topicResponse({ error: "topic_editorial_renewal_request_invalid" }, 422);
  try {
    return topicResponse(await quoteSignalTopicEditorialRenewalV1({ database: pool, workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id, execution_id: executionId }));
  } catch (error) { return topicError(error, "topic_editorial_renewal_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!editorialKey(idempotencyKey)) return topicResponse({ error: "idempotency_key_required" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return topicResponse({ error: "topic_editorial_renewal_request_invalid" }, 422); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return topicResponse({ error: "topic_editorial_renewal_request_invalid" }, 422);
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join() !== ["execution_id", "quote_reference", "confirmed_cap_micro_usd"].sort().join()
    || !editorialUuid(value.execution_id) || !editorialQuote(value.quote_reference) || !editorialCap(value.confirmed_cap_micro_usd))
    return topicResponse({ error: "topic_editorial_renewal_request_invalid" }, 422);
  try {
    return topicResponse(await renewSignalTopicEditorialExecutionV1({ database: pool, workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id, execution_id: value.execution_id,
      idempotency_key: idempotencyKey, quote_reference: value.quote_reference,
      confirmed_cap_micro_usd: value.confirmed_cap_micro_usd }), 202);
  } catch (error) { return topicError(error, "topic_editorial_renewal_rejected"); }
}
