import { estimateSignalListeningV1, getSignalListeningStateV1, requestSignalListeningV1, saveSignalListeningQuestionsV1 } from "@noisia/db";
import { isSignalListeningEnabled, listeningRunInputSchemaV1, listeningSaveInputSchemaV1 } from "@/lib/data-os/signal-listening-api";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string }> };

async function access(context: Context) {
  const { workspaceId } = await context.params;
  if (!isSignalListeningEnabled()) return { response: topicResponse({ error: "listening_not_enabled" }, 404) } as const;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return { response: loaded.response } as const;
  return { access: { database: pool, workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id } } as const;
}

/** The effective configuration and the last run. With `?view=estimate`, what a pass
 * would ask now: that read scans the answer cache, so it is only made on request. */
export async function GET(request: Request, context: Context) {
  const resolved = await access(context);
  if ("response" in resolved) return resolved.response;
  const view = new URL(request.url).searchParams.get("view");
  if (view !== null && view !== "estimate") return topicResponse({ error: "listening_request_invalid" }, 422);
  try {
    return topicResponse(view === "estimate" ? await estimateSignalListeningV1(resolved.access) : await getSignalListeningStateV1(resolved.access));
  } catch (error) { return topicError(error, "listening_unavailable"); }
}

/** Saves the questions with options as a new revision. Asks nothing. */
export async function PUT(request: Request, context: Context) {
  const resolved = await access(context);
  if ("response" in resolved) return resolved.response;
  try {
    const input = listeningSaveInputSchemaV1.parse(await request.json());
    return topicResponse({ contract_version: "signal-listening-saved-v1", ...await saveSignalListeningQuestionsV1({ ...resolved.access, ...input }) });
  } catch (error) { return topicError(error, "listening_update_rejected"); }
}

/** Queues a pass with a spending cap. Only what is pending is asked. */
export async function POST(request: Request, context: Context) {
  const resolved = await access(context);
  if ("response" in resolved) return resolved.response;
  try {
    const input = listeningRunInputSchemaV1.parse(await request.json());
    return topicResponse({ contract_version: "signal-listening-run-v1", ...await requestSignalListeningV1({ ...resolved.access, ...input }) }, 202);
  } catch (error) { return topicError(error, "listening_run_rejected"); }
}
