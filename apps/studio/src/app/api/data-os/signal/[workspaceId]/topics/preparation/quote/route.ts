import { loadSignalWorkspaceContextForTopics } from "../../_lib";
import { quoteWorkspaceTopicPrototypesForActorV1 } from "@/lib/data-os/workspace-topic-prototypes";
import { prototypeFailedResponse, prototypeResponseHeaders } from "../_response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try { return Response.json(await quoteWorkspaceTopicPrototypesForActorV1({
    workspaceId: loaded.workspace.id, actorUserId: loaded.session.appUser.id }), { headers: prototypeResponseHeaders }); }
  catch (error) { return prototypeFailedResponse(error); }
}
