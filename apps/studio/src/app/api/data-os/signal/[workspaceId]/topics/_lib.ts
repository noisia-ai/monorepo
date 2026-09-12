import { ZodError } from "zod";

import { canViewClientOutputs } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { isSignalWorkspaceApiEnabled } from "@/lib/data-os/serving";
import { loadSignalWorkspaceContextWithDependencies,
  type SignalWorkspaceSession } from "@/lib/data-os/signal-workspace-context";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";

/** Resolve tenant access first. Each product operation then checks its specific DB capability. */
export function loadSignalWorkspaceContextForTopics(workspaceId: string) {
  return loadSignalWorkspaceContextWithDependencies(workspaceId, {
    getSession: getAuthenticatedAppUser as () => Promise<SignalWorkspaceSession | null>,
    isEnabled: isSignalWorkspaceApiEnabled,
    canView: canViewClientOutputs,
    resolveWorkspace: resolveSignalWorkspaceForUser
  });
}

export function requireIdempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return key.length >= 8 && key.length <= 200 ? key : null;
}

export function topicResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function topicError(error: unknown, fallback: string) {
  if (error instanceof ZodError || error instanceof SyntaxError) return topicResponse({
    error: "topic_request_invalid", message: "Check the Topic fields and try again."
  }, 422);
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const status = "status" in error && typeof error.status === "number" ? error.status : 409;
    const messages: Record<string, string> = {
      topic_catalog_forbidden: "You do not have permission for this Topics action in this brand.",
      topic_processing_permissions_required: "This action updates existing results and requires processing permission.",
      topic_candidate_scope_required: "Select whether this Topic concerns the brand, competitors, or category.",
      topic_revision_conflict: "This Topic changed. Refresh before saving again.",
      topic_catalog_idempotency_conflict: "This request key was already used for a different change.",
      topic_mentions_required: "Import mentions before starting a Topics search.",
      topic_population_not_available: "Import and prepare mentions before starting a Topics search.",
      topic_catalog_busy: "A Topics update is running. Wait for it to finish before editing.",
      topic_consolidation_request_invalid: "Refresh Topics and try the preparation again.",
      topic_consolidation_quote_stale: "The preparation quote expired. Refresh Topics to receive a current quote.",
      topic_consolidation_preflight_blocked: "Topics preparation is not available for the current analysis.",
      topic_consolidation_existing_execution: "This analysis already has a Topics preparation.",
      topic_consolidation_source_stale: "The analysis changed. Refresh Topics before preparing it."
    };
    return topicResponse({ error: error.code,
      message: messages[error.code] ?? "This Topics action could not be completed. Refresh and try again." }, status);
  }
  console.error(`[signal-topics] ${fallback}`, { name: error instanceof Error ? error.name : "UnknownError" });
  return topicResponse({ error: fallback, message: "Topics is temporarily unavailable." }, 503);
}
