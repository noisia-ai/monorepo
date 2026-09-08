import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey } from "../_lib";
import { loadWorkspaceTopicPrototypesForActorV1, requestWorkspaceTopicPrototypesForActorV1,
  validateWorkspaceTopicPrototypeRequestV1 } from "@/lib/data-os/workspace-topic-prototypes";
import { prototypeFailedResponse, prototypeResponseHeaders } from "./_response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = new URL(request.url).searchParams.get("idempotency_key") ?? undefined;
  if (key !== undefined && !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) {
    return Response.json({ error: "workspace_embedding_idempotency_key_required" }, { status: 400, headers: prototypeResponseHeaders });
  }
  try { return Response.json(await loadWorkspaceTopicPrototypesForActorV1({ workspaceId: loaded.workspace.id,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key }), { headers: prototypeResponseHeaders }); }
  catch (error) { return prototypeFailedResponse(error); }
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) return Response.json({ error: "workspace_embedding_idempotency_key_required" }, { status: 400, headers: prototypeResponseHeaders });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!validateWorkspaceTopicPrototypeRequestV1(body)) return Response.json({ error: "workspace_embedding_request_invalid" }, { status: 422, headers: prototypeResponseHeaders });
  try { return Response.json(await requestWorkspaceTopicPrototypesForActorV1({ workspaceId: loaded.workspace.id,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key, body }), { status: 202, headers: prototypeResponseHeaders }); }
  catch (error) { return prototypeFailedResponse(error); }
}
