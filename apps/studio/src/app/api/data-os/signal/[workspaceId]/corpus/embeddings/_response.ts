import { SignalWorkspaceEmbeddingsError, WorkspaceCorpusEmbeddingsError } from "@/lib/data-os/workspace-corpus-embeddings";
export const embeddingResponseHeaders = { "Cache-Control": "private, no-store" };
export function embeddingFailedResponse(error: unknown) {
  if (error instanceof SignalWorkspaceEmbeddingsError || error instanceof WorkspaceCorpusEmbeddingsError) {
    return Response.json({ error: error.code }, { status: error.status, headers: embeddingResponseHeaders });
  }
  return Response.json({ error: "workspace_embedding_unavailable" }, { status: 503, headers: embeddingResponseHeaders });
}
