import { continueMassLabelingV1, enableMassLabelingProductV2, loadMassLabelingProductStatusV2, requestMassLabelingProductV2,
  retryMassLabelingProductV2, signalWorkspaceFeatureEnabledV1 } from "@noisia/db";
import { pool } from "@/lib/db";
import { studyLabelingProviderAvailableV2, studyLabelingRequestSchemaV2 } from "@/lib/data-os/signal-study-labeling-request";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (new URL(request.url).search) return topicResponse({ error: "mass_labeling_request_invalid" }, 422);
  try {
    const [status, enabled] = await Promise.all([
      loadMassLabelingProductStatusV2({ database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id }),
      signalWorkspaceFeatureEnabledV1({ queryable: pool, workspace_id: workspaceId, feature: "mass_labeling" })
    ]);
    return topicResponse({ ...status, enabled });
  } catch (error) { return topicError(error, "mass_labeling_status_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const body = studyLabelingRequestSchemaV2.parse(await request.json());
    const access = { database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id };
    if (!await signalWorkspaceFeatureEnabledV1({ queryable: pool, workspace_id: workspaceId, feature: "mass_labeling" }))
      return topicResponse({ error: "mass_labeling_not_enabled" }, 409);
    if (body.action === "start") {
      await enableMassLabelingProductV2({ ...access, cap_micro_usd: body.cap_micro_usd });
      await requestMassLabelingProductV2({ ...access, map_id: body.map_id, idempotency_key: body.idempotency_key,
        cap_micro_usd: body.cap_micro_usd, provider_available: studyLabelingProviderAvailableV2() });
    } else if (body.action === "continue") await continueMassLabelingV1({ ...access, run_id: body.run_id });
    else await retryMassLabelingProductV2({ ...access, run_id: body.run_id });
    return topicResponse(await loadMassLabelingProductStatusV2(access), 202);
  } catch (error) { return topicError(error, "mass_labeling_request_rejected"); }
}
