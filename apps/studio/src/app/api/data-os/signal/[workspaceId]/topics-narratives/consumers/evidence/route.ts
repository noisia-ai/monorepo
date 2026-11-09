import { loadMassLabelingConsumerEvidenceV1 } from "@noisia/db";
import { nativeTopicsQueryV1 } from "@/lib/data-os/signal-workspace-topics-native";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const params = new URL(request.url).searchParams;
  const choice = params.get("choice");
  if (params.getAll("choice").length !== 1 || choice !== "trigger" && choice !== "barrier"
    || !params.get("scope_digest") || !/^[1-9]\d{0,2}$/u.test(params.get("limit") ?? "30"))
    return topicResponse({ error: "consumer_evidence_request_invalid" }, 422);
  const nativeParams = new URLSearchParams(params); nativeParams.delete("choice");
  try {
    const filters = nativeTopicsQueryV1(nativeParams);
    return topicResponse(await loadMassLabelingConsumerEvidenceV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, timezone: loaded.workspace.timezone,
      ...filters, choice, limit: Math.min(50, Math.max(1, Number(params.get("limit") ?? "30"))),
      ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
      expected_scope_digest: params.get("scope_digest")! }));
  } catch (error) { return topicError(error, "consumer_evidence_unavailable"); }
}
