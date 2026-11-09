import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "@noisia/db";
import { labelingStudySettingsInputSchemaV1 } from "@/lib/data-os/signal-labeling-settings";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (new URL(request.url).search) return topicResponse({ error: "study_policy_request_invalid" }, 422);
  try {
    return topicResponse(await getMassLabelingStudyPolicyV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id }));
  } catch (error) { return topicError(error, "study_policy_unavailable"); }
}

export async function PUT(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const input = labelingStudySettingsInputSchemaV1.parse(await request.json());
    return topicResponse(await updateMassLabelingStudyPolicyV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, ...input }));
  } catch (error) { return topicError(error, "study_policy_update_rejected"); }
}
