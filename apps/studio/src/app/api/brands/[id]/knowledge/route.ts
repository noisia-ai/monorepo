import { and, desc, eq, isNull } from "drizzle-orm";
import { brandKnowledgeSources } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { clientBrandCreationDecisionV1 } from "@/lib/auth/client-brand-self-service";
import { loadClientBrandContextAccessV1, lockClientBrandContextAccessV1 } from "@/lib/auth/client-brand-self-service-server";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { BRAND_KNOWLEDGE_SOURCE_MAX_CHARS } from "@/lib/data-os/brand-automatic-knowledge";
import { reconcileAndEnsureBrandContextAfterCommittedMutationV1 } from "@/lib/data-os/signal-brand-context-preparation";
import { db } from "@/lib/db";
import { brandContextPreparationIntentSchema } from "@/lib/validation/brand";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  const internal = canCreateBrandOrTheme(session.appUser.primaryRole);
  const client = clientBrandCreationDecisionV1(session.appUser);
  if (!internal && !client.allowed) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }
  if (client.allowed && !await loadClientBrandContextAccessV1(session.appUser, brand.id)) {
    return Response.json({ error: "not_found", message: "Brand not found or not accessible." }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(brandKnowledgeSources)
    .where(and(eq(brandKnowledgeSources.brandId, brand.id), isNull(brandKnowledgeSources.studyCorpusId)))
    .orderBy(desc(brandKnowledgeSources.createdAt));

  return Response.json({ data: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  const internal = canCreateBrandOrTheme(session.appUser.primaryRole);
  const client = clientBrandCreationDecisionV1(session.appUser);
  if (!internal && !client.allowed) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }
  if (client.allowed && !await loadClientBrandContextAccessV1(session.appUser, brand.id)) {
    return Response.json({ error: "not_found", message: "Brand not found or not accessible." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  const title = cleanText(body?.title);
  const rawText = cleanText(body?.raw_text);
  const sourceKind = cleanText(body?.source_kind) || "brand_brief";
  const mutationId = request.headers.get("Idempotency-Key")?.trim() ?? "";

  if (!title || title.length > 180 || !rawText || rawText.length > BRAND_KNOWLEDGE_SOURCE_MAX_CHARS || sourceKind.length > 80) {
    return Response.json(
      { error: "validation_error", message: "El título y el contenido son obligatorios; el contenido admite hasta 200,000 caracteres." },
      { status: 422 }
    );
  }
  if (!UUID_PATTERN.test(mutationId)) {
    return Response.json({ error: "idempotency_key_required", message: "La solicitud requiere una clave idempotente válida." }, { status: 400 });
  }
  if (parsedPreparation.data && parsedPreparation.data.idempotency_key !== mutationId) {
    return Response.json({ error: "idempotency_key_mismatch",
      message: "La preparación debe usar la misma clave que la fuente." }, { status: 422 });
  }

  const { inserted, row } = await db.transaction(async (tx) => {
    if (client.allowed && !await lockClientBrandContextAccessV1(tx, session.appUser, brand.id)) {
      throw new ClientBrandContextAuthorityChanged();
    }
    const [created] = await tx
      .insert(brandKnowledgeSources)
      .values({
        id: mutationId,
        organizationId: brand.organizationId,
        brandId: brand.id,
        studyCorpusId: null,
        sourceKind,
        title,
        rawText,
        extractedPayload: {
          summary: rawText.slice(0, 1200),
          source: "manual_editor",
          recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
        },
        status: "processed",
        createdByUserId: session.appUser.id
      })
      .onConflictDoNothing()
      .returning();
    const [resolved] = created ? [created] : await tx.select().from(brandKnowledgeSources)
      .where(and(eq(brandKnowledgeSources.id, mutationId), eq(brandKnowledgeSources.brandId, brand.id),
        isNull(brandKnowledgeSources.studyCorpusId))).limit(1);
    return { inserted: created, row: resolved };
  }).catch((error) => {
    if (error instanceof ClientBrandContextAuthorityChanged) return { inserted: undefined, row: undefined };
    throw error;
  });
  if (client.allowed && !row) {
    return Response.json({ error: "not_found", message: "Brand not found or not accessible." }, { status: 404 });
  }
  if (!row || row.title !== title || row.rawText !== rawText || row.sourceKind !== sourceKind
      || row.organizationId !== brand.organizationId || row.createdByUserId !== session.appUser.id) {
    return Response.json({ error: "idempotency_conflict", message: "La clave idempotente ya corresponde a otra fuente." }, { status: 409 });
  }

  const preparationIntent = client.allowed ? { idempotency_key: mutationId } : parsedPreparation.data;
  const preparation = row
    ? await reconcileAndEnsureBrandContextAfterCommittedMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      preparation: preparationIntent,
      fallbackIdempotencyKey: `brand-context-knowledge-create:${brand.id}:${row.id}`,
      reconciliationIdempotencyKey: `knowledge-create:${brand.id}:${row.id}`
    })
    : null;

  return Response.json({ data: row, replayed: !inserted, brand_context_preparation: preparation }, { status: 201 });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
class ClientBrandContextAuthorityChanged extends Error {}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
