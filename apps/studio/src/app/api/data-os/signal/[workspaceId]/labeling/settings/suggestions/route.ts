import { dismissMassLabelingLexiconSuggestionV1, loadMassLabelingLexiconSuggestionsV1 } from "@noisia/db";
import { z } from "zod";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dismissal = z.object({ expected_revision: z.number().int().nonnegative(), term: z.string().min(1).max(200) }).strict();

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (new URL(request.url).search) return topicResponse({ error: "lexicon_suggestion_invalid" }, 422);
  try {
    return topicResponse(await loadMassLabelingLexiconSuggestionsV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id }));
  } catch (error) { return topicError(error, "lexicon_suggestions_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return topicResponse(await dismissMassLabelingLexiconSuggestionV1({ database: pool,
      workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id, ...dismissal.parse(await request.json()) }));
  } catch (error) { return topicError(error, "lexicon_suggestion_dismissal_rejected"); }
}
