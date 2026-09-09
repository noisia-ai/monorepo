import { signalTopicCommandSchemaV1 } from "@noisia/query-engine";
import { z } from "zod";
import { loadNativeTopicSelectionV1, selectNativeTopicSignalV1 } from "@/lib/data-os/signal-workspace-topics-native";
import { loadSignalWorkspaceContextForTopics,
  topicError, topicResponse } from "../../_lib";
import { loadSignalTopicsManagementProductV1, setSignalTopicLifecycleProductV1,
  startSignalTopicCatalogExecutionProductV1 } from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const selectionSchema = z.object({ action: z.literal("select_signal"), selected: z.boolean(),
  expected_selection_revision: z.number().int().nonnegative(), expected_definition_revision: z.number().int().positive(),
  expected_definition_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/), generation_id: z.string().uuid().nullable(),
  idempotency_key: z.string().min(8).max(200) }).strict();

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  const key = new URL(request.url).searchParams.get("idempotency_key") ?? undefined;
  if (key !== undefined && (key.length < 8 || key.length > 200)) return topicResponse({ error: "topic_command_invalid" }, 422);
  try { return topicResponse(await loadNativeTopicSelectionV1({ workspace_id: workspaceId, actor_user_id: loaded.session.appUser.id }, termKey, key)); }
  catch (error) { return topicError(error, "topic_selection_unavailable"); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForTopics(workspaceId);
  if ("response" in loaded) return loaded.response;
  let command;
  try {
    const body = await request.json();
    if (body?.action === "select_signal") {
      const input = selectionSchema.parse(body);
      if (request.headers.get("Idempotency-Key") !== input.idempotency_key) return topicResponse({ error: "topic_command_invalid" }, 422);
      try {
        const selection = { selected: input.selected, expected_selection_revision: input.expected_selection_revision,
          expected_definition_revision: input.expected_definition_revision, expected_definition_digest: input.expected_definition_digest,
          generation_id: input.generation_id, idempotency_key: input.idempotency_key };
        return topicResponse(await selectNativeTopicSignalV1({ workspace_id: workspaceId,
          actor_user_id: loaded.session.appUser.id }, termKey, selection));
      } catch (error) { return topicError(error, "topic_selection_rejected"); }
    }
    command = signalTopicCommandSchemaV1.parse(body);
  }
  catch { return topicResponse({ error: "topic_command_invalid", message: "The topic command is invalid." }, 422); }
  try {
    const latest = await loadSignalTopicsManagementProductV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser
    });
    if (!latest.topics.some((topic) => topic.term_key === termKey)) {
      return topicResponse({ error: "topic_not_found", message: "The topic is not available." }, 404);
    }
    if (command.action === "archive" || command.action === "restore") {
      return topicResponse(await setSignalTopicLifecycleProductV1({
        workspace: loaded.workspace, actor: loaded.session.appUser,
        idempotencyKey: command.idempotency_key, termKey,
        lifecycle: command.action === "archive" ? "archived" : "draft"
      }));
    }
    const intent = command.action === "follow"
      || (command.action === "retry" && latest?.execution?.intent === "publish")
      ? "publish"
      : "search";
    const topic = latest.topics.find((item) => item.term_key === termKey)!;
    const retriesArchivedReplacement = command.action === "retry" && topic.lifecycle === "archived"
      && latest.active_profile_id !== null && latest.profile?.id !== latest.active_profile_id;
    const publishWhenReady = command.action === "retry" && intent === "search"
      ? latest.execution?.publish_when_ready === true || retriesArchivedReplacement
      : undefined;
    return topicResponse(await startSignalTopicCatalogExecutionProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser,
      idempotencyKey: command.idempotency_key, intent,
      publishWhenReady,
      embeddingCostCapMicroUsd: command.embedding_cost_cap_micro_usd
    }), 202);
  } catch (error) {
    return topicError(error, "topic_command_rejected");
  }
}
