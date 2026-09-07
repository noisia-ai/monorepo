import { signalTopicCommandSchemaV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceContextForSemanticContextManagement,
  semanticContextError, semanticContextResponse } from "../../../semantic-context/_lib";
import { loadSignalTopicsManagementProductV1, setSignalTopicLifecycleProductV1,
  startSignalTopicCatalogExecutionProductV1 } from "@/lib/data-os/signal-topics-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; termKey: string }> }) {
  const { workspaceId, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  let command;
  try { command = signalTopicCommandSchemaV1.parse(await request.json()); }
  catch { return semanticContextResponse({ error: "topic_command_invalid", message: "The topic command is invalid." }, 422); }
  try {
    const latest = await loadSignalTopicsManagementProductV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser
    });
    if (!latest.topics.some((topic) => topic.term_key === termKey)) {
      return semanticContextResponse({ error: "topic_not_found", message: "The topic is not available." }, 404);
    }
    if (command.action === "archive" || command.action === "restore") {
      return semanticContextResponse(await setSignalTopicLifecycleProductV1({
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
    return semanticContextResponse(await startSignalTopicCatalogExecutionProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser,
      idempotencyKey: command.idempotency_key, intent,
      publishWhenReady,
      embeddingCostCapMicroUsd: command.embedding_cost_cap_micro_usd
    }), 202);
  } catch (error) {
    return semanticContextError(error, "topic_command_rejected");
  }
}
