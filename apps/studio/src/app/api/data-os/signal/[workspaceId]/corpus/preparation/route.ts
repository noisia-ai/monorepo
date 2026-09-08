import { loadSignalWorkspaceContextForTopics, requireIdempotencyKey } from "../../topics/_lib";
import {
  loadWorkspaceCorpusPreparationForActorV1,
  requestWorkspaceCorpusPreparationForActorV1,
  validateCorpusPreparationRequestV1,
  SignalWorkspaceCorpusPreparationError,
  WorkspaceCorpusPreparationError
} from "@/lib/data-os/workspace-corpus-preparation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ workspaceId: string }> };

function failed(error: unknown) {
  if (error instanceof WorkspaceCorpusPreparationError || error instanceof SignalWorkspaceCorpusPreparationError) {
    return Response.json({ error: error.code }, { status: error.status, headers });
  }
  // Database or queue errors must never disclose texts, source metadata or credentials.
  return Response.json({ error: "corpus_preparation_unavailable" }, { status: 503, headers });
}

export async function GET(_request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return Response.json(await loadWorkspaceCorpusPreparationForActorV1({
      workspaceId: loaded.workspace.id, actorUserId: loaded.session.appUser.id
    }), { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return Response.json({ error: "idempotency_key_required" }, { status: 400, headers });
  try {
    if (!validateCorpusPreparationRequestV1(await request.json())) {
      return Response.json({ error: "corpus_preparation_request_invalid" }, { status: 422, headers });
    }
  } catch { return Response.json({ error: "corpus_preparation_request_invalid" }, { status: 422, headers }); }
  try {
    const result = await requestWorkspaceCorpusPreparationForActorV1({
      workspaceId: loaded.workspace.id, actorUserId: loaded.session.appUser.id, idempotencyKey
    });
    return Response.json(result, { status: 202, headers });
  } catch (error) { return failed(error); }
}
