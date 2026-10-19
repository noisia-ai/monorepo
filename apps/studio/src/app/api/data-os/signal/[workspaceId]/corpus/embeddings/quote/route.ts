import { loadSignalWorkspaceContextForTopics } from "../../../topics/_lib";
import { quoteWorkspaceCorpusEmbeddingsForActorV1 } from "@/lib/data-os/workspace-corpus-embeddings";
import { embeddingFailedResponse, embeddingResponseHeaders } from "../_response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try { return Response.json(await quoteWorkspaceCorpusEmbeddingsForActorV1({
    workspaceId: loaded.workspace.id, actorUserId: loaded.session.appUser.id }), { headers: embeddingResponseHeaders }); }
  catch (error) { return embeddingFailedResponse(error); }
}
