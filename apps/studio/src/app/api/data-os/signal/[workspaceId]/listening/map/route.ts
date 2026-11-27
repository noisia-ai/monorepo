import { readSignalListeningMapV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The topic map of the last finished discovery cycle: themes, topics and volumes. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (new URL(request.url).search) return topicResponse({ error: "listening_request_invalid" }, 422);
  try {
    return topicResponse(await readSignalListeningMapV1({ database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id }));
  } catch (error) { return topicError(error, "listening_map_unavailable"); }
}
