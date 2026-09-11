import {
  SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,
  type SignalSemanticContextReconciliationReasonV1
} from "@/lib/data-os/signal-semantic-context-pack";
import {
  ensureBrandContextPreparationForWorkspaceV1,
  loadBrandContextPreparationForWorkspaceV1
} from "@/lib/data-os/signal-brand-context-preparation";
import { reconcileSignalBrandOsForBrandMutationV1 } from "@/lib/data-os/signal-governance-control-plane";
import { refreshAutomaticBrandContextKnowledgeV1 } from "@/lib/data-os/brand-automatic-knowledge-server";
import { brandContextPreparationIntentSchema } from "@/lib/validation/brand";
import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  requireIdempotencyKey,
  semanticContextError,
  semanticContextResponse
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request,
  context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = new URL(request.url).searchParams.get("idempotency_key") ?? undefined;
  try {
    return semanticContextResponse({ preparation: await loadBrandContextPreparationForWorkspaceV1({
      workspaceId,
      actor: loaded.session.appUser,
      idempotencyKey
    }) });
  } catch (error) {
    return semanticContextError(error, "brand_context_preparation_load_rejected");
  }
}

export async function POST(request: Request,
  context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return semanticContextResponse({ error: "idempotency_key_required",
    message: "Idempotency-Key is required." }, 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((field) => !["reason", "preparation", "expected_generation_key"].includes(field))
      || typeof (body as { reason?: unknown }).reason !== "string"
      || !SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS.includes(
        (body as { reason: SignalSemanticContextReconciliationReasonV1 }).reason)) {
    return semanticContextResponse({ error: "invalid_semantic_context_reconciliation",
      message: "A supported reconciliation reason is required." }, 422);
  }
  const parsedPreparation = brandContextPreparationIntentSchema.safeParse(
    (body as { preparation?: unknown }).preparation
  );
  if (!parsedPreparation.success || parsedPreparation.data.idempotency_key !== idempotencyKey) {
    return semanticContextResponse({
      error: "invalid_brand_context_preparation",
      message: "Preparation must match the request idempotency key."
    }, 422);
  }
  const reason = (body as { reason: SignalSemanticContextReconciliationReasonV1 }).reason;
  const rawExpectedGenerationKey = (body as { expected_generation_key?: unknown }).expected_generation_key;
  const expectedGenerationKey = typeof rawExpectedGenerationKey === "string"
      && /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u.test(rawExpectedGenerationKey)
      && rawExpectedGenerationKey.length <= 160
    ? rawExpectedGenerationKey : null;
  if (reason === "terminal_provider_run" ? !expectedGenerationKey : rawExpectedGenerationKey !== undefined) {
    return semanticContextResponse({
      error: "invalid_brand_context_terminal_recovery",
      message: "Terminal recovery must identify the current generation."
    }, 422);
  }
  if (reason === "terminal_provider_run"
      && (parsedPreparation.data.quote_digest || parsedPreparation.data.confirmation)) {
    return semanticContextResponse({
      error: "brand_context_terminal_recovery_admission_forbidden",
      message: "Terminal recovery cannot authorize provider spend."
    }, 422);
  }
  try {
    if (reason !== "terminal_provider_run") {
      if (loaded.workspace.subject.type !== "brand") {
        return semanticContextResponse({
          error: "brand_workspace_required",
          message: "Brand Context preparation requires a brand workspace."
        }, 422);
      }
      // Brand/competitor writes commit before their projection hook runs so a
      // temporary projection outage never makes the user's save ambiguous.
      // Rebuild or verify that projection here before accepting fresh provider
      // authority; otherwise a retry could mix a stale profile with live fields.
      await refreshAutomaticBrandContextKnowledgeV1(loaded.workspace.subject.id);
      await reconcileSignalBrandOsForBrandMutationV1({
        brandId: loaded.workspace.subject.id,
        actor: loaded.session.appUser,
        idempotencyKey: `semantic-context-prepare:${idempotencyKey}`
      });
    }
    return semanticContextResponse(await ensureBrandContextPreparationForWorkspaceV1({
      workspaceId,
      actor: loaded.session.appUser,
      preparation: parsedPreparation.data,
      reconciliationReason: reason === "terminal_provider_run" ? reason : undefined,
      expectedGenerationKey: reason === "terminal_provider_run" ? expectedGenerationKey! : undefined
    }));
  } catch (error) {
    return semanticContextError(error, "brand_context_preparation_rejected");
  }
}
