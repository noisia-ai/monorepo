import { loadSignalWorkspaceContextForTopics } from "../topics/_lib";
import {
  loadSignalProcessingPolicyForActorV1,
  SignalProcessingPolicyError
} from "@/lib/data-os/signal-processing-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const result = await loadSignalProcessingPolicyForActorV1({
      workspaceId: loaded.workspace.id,
      actorUserId: loaded.session.appUser.id
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof SignalProcessingPolicyError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    console.error("[signal-processing-policy] read unavailable", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return Response.json({ error: "processing_policy_unavailable" }, { status: 503, headers });
  }
}
