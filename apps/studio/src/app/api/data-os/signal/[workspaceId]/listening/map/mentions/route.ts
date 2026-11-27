import { readSignalListeningTopicMentionsV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Some mentions of one topic of the reviewed map, so a person can read and correct them. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  if (!isSignalListeningEnabled()) return topicResponse({ error: "listening_not_enabled" }, 404);
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const query = new URL(request.url).searchParams, topic = query.get("topic"), level = query.get("level") ?? "confirmed";
  if (!topic || (level !== "confirmed" && level !== "probable") || [...query.keys()].some(name => !["topic", "level", "start", "end", "tz"].includes(name))) {
    return topicResponse({ error: "listening_request_invalid" }, 422);
  }
  try {
    return topicResponse(await readSignalListeningTopicMentionsV1({ database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, topic_key: topic, level,
      period: { date_from: query.get("start"), date_to: query.get("end"), timezone: query.get("tz") ?? "UTC" } }));
  } catch (error) { return topicError(error, "listening_mentions_unavailable"); }
}
