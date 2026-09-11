import { SignalTopicCatalogError, SignalWorkspaceEmbeddingsError, SignalWorkspaceTopicComputationError } from "@noisia/db";
import { WorkspaceCorpusEmbeddingsError } from "@/lib/data-os/workspace-corpus-embeddings";
export const prototypeResponseHeaders = { "Cache-Control": "private, no-store" };
export function prototypeFailedResponse(error: unknown) {
  if (error instanceof SignalWorkspaceEmbeddingsError || error instanceof SignalWorkspaceTopicComputationError
    || error instanceof WorkspaceCorpusEmbeddingsError || error instanceof SignalTopicCatalogError) {
    return Response.json({ error: error.code }, { status: error.status, headers: prototypeResponseHeaders });
  }
  return Response.json({ error: "workspace_embedding_unavailable" }, { status: 503, headers: prototypeResponseHeaders });
}
