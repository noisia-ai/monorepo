import { editSignalTopicConsolidationConceptV1, SignalTopicConsolidationContractError } from "@noisia/db";

import { pool } from "@/lib/db";

import { loadSignalWorkspaceContextForTopics, topicError, topicResponse } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join(",") !== "concept_key,definition,expected_revision_digest,expected_revision_id,label")
      return topicResponse({ error: "topic_consolidation_edition_invalid" }, 422);
    const input = body as Record<string, unknown>;
    if (Object.values(input).some(value => typeof value !== "string"))
      return topicResponse({ error: "topic_consolidation_edition_invalid" }, 422);
    const result = await editSignalTopicConsolidationConceptV1({ database: pool, workspace_id: workspaceId,
      actor_user_id: loaded.session.appUser.id, expected_revision_id: input.expected_revision_id as string,
      expected_revision_digest: input.expected_revision_digest as string, concept_key: input.concept_key as string,
      label: input.label as string, definition: input.definition as string });
    return topicResponse(result);
  } catch (error) {
    if (error instanceof SignalTopicConsolidationContractError) {
      const status = error.code === "topic_consolidation_forbidden" ? 403
        : error.code === "topic_consolidation_edition_invalid" ? 422 : 409;
      return topicResponse({ error: error.code }, status);
    }
    return topicError(error, "topic_consolidation_edition_unavailable");
  }
}
