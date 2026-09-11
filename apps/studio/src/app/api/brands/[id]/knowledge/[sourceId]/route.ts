import { and, eq, isNull } from "drizzle-orm";
import { brandKnowledgeSources, signalWorkspaces } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { BRAND_KNOWLEDGE_SOURCE_MAX_CHARS } from "@/lib/data-os/brand-automatic-knowledge";
import {
  beginBrandContextDomainMutationV1,
  BrandContextDomainMutationError,
  completeBrandContextDomainMutationV1,
  requireBrandContextDomainMutationKeyV1
} from "@/lib/data-os/brand-context-domain-mutation";
import { reconcileAndEnsureBrandContextAfterCommittedMutationV1 } from "@/lib/data-os/signal-brand-context-preparation";
import { db } from "@/lib/db";
import { brandContextPreparationIntentSchema } from "@/lib/validation/brand";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id, sourceId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  let idempotencyKey: string;
  try {
    idempotencyKey = requireBrandContextDomainMutationKeyV1(request, parsedPreparation.data);
  } catch (error) {
    return domainMutationErrorResponse(error);
  }
  const title = cleanText(body?.title);
  const rawText = cleanText(body?.raw_text);
  const sourceKind = cleanText(body?.source_kind) || "brand_brief";

  if (!title || title.length > 180 || !rawText || rawText.length > BRAND_KNOWLEDGE_SOURCE_MAX_CHARS || sourceKind.length > 80) {
    return Response.json(
      { error: "validation_error", message: "El título y el contenido son obligatorios; el contenido admite hasta 200,000 caracteres." },
      { status: 422 }
    );
  }

  try {
    const mutation = await db.transaction(async (tx) => {
      const [workspace] = await tx.select({ id: signalWorkspaces.id }).from(signalWorkspaces)
        .where(eq(signalWorkspaces.brandId, brand.id)).limit(1);
      if (!workspace) throw new KnowledgeSourceNotFound();
      const operation = await beginBrandContextDomainMutationV1<typeof brandKnowledgeSources.$inferSelect>({
        tx,
        workspaceId: workspace.id,
        actorUserId: session.appUser.id,
        action: "update-brand-knowledge",
        idempotencyKey,
        input: { brand_id: brand.id, source_id: sourceId, title, raw_text: rawText, source_kind: sourceKind }
      });
      if (operation.replay) return { row: operation.replay, replayed: true };
      const [row] = await tx.update(brandKnowledgeSources).set({
        title,
        rawText,
        sourceKind,
        extractedPayload: {
          summary: rawText.slice(0, 1200),
          source: "manual_editor",
          recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
        },
        status: "processed",
        errorMessage: null,
        updatedAt: new Date()
      }).where(and(eq(brandKnowledgeSources.id, sourceId), eq(brandKnowledgeSources.brandId, brand.id),
        isNull(brandKnowledgeSources.studyCorpusId)))
        .returning();
      if (!row) throw new KnowledgeSourceNotFound();
      await completeBrandContextDomainMutationV1({
        tx,
        workspaceId: workspace.id,
        operationId: operation.operationId,
        result: row
      });
      return { row, replayed: false };
    });
    const preparation = await reconcileAndEnsureBrandContextAfterCommittedMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      preparation: parsedPreparation.data,
      fallbackIdempotencyKey: `${idempotencyKey}:prepare`,
      reconciliationIdempotencyKey: `${idempotencyKey}:brand-os`
    });
    return Response.json({ data: mutation.row, replayed: mutation.replayed, brand_context_preparation: preparation });
  } catch (error) {
    if (error instanceof KnowledgeSourceNotFound) return knowledgeSourceNotFound();
    if (error instanceof BrandContextDomainMutationError) return domainMutationErrorResponse(error);
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id, sourceId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  let idempotencyKey: string;
  try {
    idempotencyKey = requireBrandContextDomainMutationKeyV1(request, parsedPreparation.data);
  } catch (error) {
    return domainMutationErrorResponse(error);
  }
  try {
    const mutation = await db.transaction(async (tx) => {
      const [workspace] = await tx.select({ id: signalWorkspaces.id }).from(signalWorkspaces)
        .where(eq(signalWorkspaces.brandId, brand.id)).limit(1);
      if (!workspace) throw new KnowledgeSourceNotFound();
      const operation = await beginBrandContextDomainMutationV1<{ id: string }>({
        tx,
        workspaceId: workspace.id,
        actorUserId: session.appUser.id,
        action: "delete-brand-knowledge",
        idempotencyKey,
        input: { brand_id: brand.id, source_id: sourceId }
      });
      if (operation.replay) return { row: operation.replay, replayed: true };
      const [row] = await tx.delete(brandKnowledgeSources)
        .where(and(eq(brandKnowledgeSources.id, sourceId), eq(brandKnowledgeSources.brandId, brand.id),
          isNull(brandKnowledgeSources.studyCorpusId)))
        .returning({ id: brandKnowledgeSources.id });
      if (!row) throw new KnowledgeSourceNotFound();
      await completeBrandContextDomainMutationV1({
        tx,
        workspaceId: workspace.id,
        operationId: operation.operationId,
        result: row
      });
      return { row, replayed: false };
    });
    const preparation = await reconcileAndEnsureBrandContextAfterCommittedMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      preparation: parsedPreparation.data,
      fallbackIdempotencyKey: `${idempotencyKey}:prepare`,
      reconciliationIdempotencyKey: `${idempotencyKey}:brand-os`
    });
    return Response.json({ data: mutation.row, replayed: mutation.replayed, brand_context_preparation: preparation });
  } catch (error) {
    if (error instanceof KnowledgeSourceNotFound) return knowledgeSourceNotFound();
    if (error instanceof BrandContextDomainMutationError) return domainMutationErrorResponse(error);
    throw error;
  }
}

class KnowledgeSourceNotFound extends Error {}

function knowledgeSourceNotFound() {
  return Response.json(
    { error: "not_found", message: "Knowledge source not found for this brand." },
    { status: 404 }
  );
}

function domainMutationErrorResponse(error: unknown) {
  const required = error instanceof BrandContextDomainMutationError && error.code === "idempotency_key_required";
  return Response.json({
    error: required ? "idempotency_key_required" : "idempotency_conflict",
    message: required
      ? "Idempotency-Key is required and must match the preparation."
      : "Idempotency-Key was reused with incompatible knowledge input."
  }, { status: required ? 400 : 409 });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
