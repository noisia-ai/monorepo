import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey } from "../../topics/_lib";
import { loadWorkspaceCorpusEmbeddingsForActorV1, requestWorkspaceCorpusEmbeddingsForActorV1,
  validateWorkspaceCorpusEmbeddingRequestV1 } from "@/lib/data-os/workspace-corpus-embeddings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { embeddingFailedResponse, embeddingResponseHeaders } from "./_response";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = new URL(request.url).searchParams.get("idempotency_key") ?? undefined;
  if (key !== undefined && !/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) {
    return Response.json({ error: "workspace_embedding_idempotency_key_required" }, { status: 400, headers: embeddingResponseHeaders });
  }
  try { return Response.json(await loadWorkspaceCorpusEmbeddingsForActorV1({ workspaceId: loaded.workspace.id,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key }), { headers: embeddingResponseHeaders }); }
  catch (error) { return embeddingFailedResponse(error); }
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = requireIdempotencyKey(request);
  if (!key) return Response.json({ error: "workspace_embedding_idempotency_key_required" }, { status: 400, headers: embeddingResponseHeaders });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!validateWorkspaceCorpusEmbeddingRequestV1(body)) return Response.json({ error: "workspace_embedding_request_invalid" }, { status: 422, headers: embeddingResponseHeaders });
  try { return Response.json(await requestWorkspaceCorpusEmbeddingsForActorV1({ workspaceId: loaded.workspace.id,
    actorUserId: loaded.session.appUser.id, idempotencyKey: key, body }), { status: 202, headers: embeddingResponseHeaders }); }
  catch (error) { return embeddingFailedResponse(error); }
}
