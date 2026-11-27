import { promoteSignalStudyMotivesV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { studyPromotionInputSchemaV1 } from "@/lib/data-os/signal-study-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The explicit bridge to the report: carries the chosen motives of a finished study into the brand's defined topics. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; studyId: string }> }) {
  const { workspaceId, studyId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const input = studyPromotionInputSchemaV1.parse(await request.json());
    return topicResponse({ contract_version: "signal-study-promotion-v1", ...await promoteSignalStudyMotivesV1({ database: pool, workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id, study_id: studyId, motive_keys: input.motive_keys }) });
  } catch (error) { return topicError(error, "study_promotion_rejected"); }
}
