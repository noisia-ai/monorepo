import { applySignalListeningHumanEditV1 } from "@noisia/db";
import { isSignalListeningEnabled, listeningMapEditSchemaV1 } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A person corrects the reviewed map: takes a mention out of a topic, moves it, or folds a topic into another. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    // The retry key of the mutation hook is accepted and not needed: corrections are appended, and the latest one wins.
    const edit = listeningMapEditSchemaV1.parse(await request.json());
    return topicResponse({ contract_version: "signal-listening-map-edit-v1", ...await applySignalListeningHumanEditV1({ database: pool, workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id, edit }) });
  } catch (error) { return topicError(error, "listening_edit_rejected"); }
}
