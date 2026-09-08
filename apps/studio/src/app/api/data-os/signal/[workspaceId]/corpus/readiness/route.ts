import { loadSignalWorkspaceContextForTopics } from "../../topics/_lib";
import {
  loadWorkspaceCorpusReadinessForActorV1,
  WorkspaceCorpusReadinessError
} from "@/lib/data-os/workspace-corpus-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const result = await loadWorkspaceCorpusReadinessForActorV1({
      workspaceId: loaded.workspace.id,
      actorUserId: loaded.session.appUser.id
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof WorkspaceCorpusReadinessError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    return Response.json({ error: "corpus_readiness_unavailable" }, { status: 503, headers });
  }
}
