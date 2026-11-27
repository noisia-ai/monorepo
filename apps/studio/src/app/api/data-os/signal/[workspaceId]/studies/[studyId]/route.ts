import { readSignalStudiesV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One study with its directional result. */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; studyId: string }> }) {
  const { workspaceId, studyId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(studyId)) return topicResponse({ error: "study_request_invalid" }, 422);
  try {
    const result = await readSignalStudiesV1({ database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, study_id: studyId });
    return result.studies.length ? topicResponse(result) : topicResponse({ error: "study_unavailable" }, 404);
  } catch (error) { return topicError(error, "study_unavailable"); }
}
