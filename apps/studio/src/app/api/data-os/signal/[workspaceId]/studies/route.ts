import { readSignalStudiesV1, requestSignalStudyV1 } from "@noisia/db";
import { isSignalListeningEnabled } from "@/lib/data-os/signal-listening-api";
import { studyCreateInputSchemaV1 } from "@/lib/data-os/signal-study-api";
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

/** The studies of the brand, newest first, without their full result. */
export async function GET(_request: Request, context: Context) {
  const resolved = await access(context);
  if ("response" in resolved) return resolved.response;
  try {
    const result = await readSignalStudiesV1(resolved.access);
    // `latest` tells the page to keep reading while a study is still working.
    return topicResponse({ ...result, latest: result.studies.find(study => study.status === "queued" || study.status === "running") ?? null });
  }
  catch (error) { return topicError(error, "studies_unavailable"); }
}

/** Creates a study with a spending cap. It runs on its own from there. */
export async function POST(request: Request, context: Context) {
  const resolved = await access(context);
  if ("response" in resolved) return resolved.response;
  try {
    const input = studyCreateInputSchemaV1.parse(await request.json());
    return topicResponse({ contract_version: "signal-study-created-v1", ...await requestSignalStudyV1({ ...resolved.access, ...input }) }, 202);
  } catch (error) { return topicError(error, "study_rejected"); }
}
