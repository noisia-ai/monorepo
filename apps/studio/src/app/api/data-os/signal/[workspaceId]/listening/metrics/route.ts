import { readSignalListeningQuestionMetricsV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Distribution, cross with topics and monthly trend of one question with options. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const question = new URL(request.url).searchParams.get("question") ?? "";
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(question)) return topicResponse({ error: "listening_question_invalid" }, 422);
  try {
    return topicResponse({ contract_version: "signal-listening-metrics-v1", ...await readSignalListeningQuestionMetricsV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, question_key: question }) });
  } catch (error) { return topicError(error, "listening_metrics_unavailable"); }
}
