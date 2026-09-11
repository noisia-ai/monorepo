import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { brandKnowledgeSources, brandSeeds, brands, competitors as competitorRelations, organizations, signalRefreshPolicies, signalWorkspaces, studyCorpora } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { syncClientBrandAccessForMovedBrand } from "@/lib/auth/org-sync";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { buildAutomaticBrandContextText } from "@/lib/data-os/brand-automatic-knowledge";
import {
  beginBrandContextDomainMutationV1,
  BrandContextDomainMutationError,
  completeBrandContextDomainMutationV1,
  requireBrandContextDomainMutationKeyV1
} from "@/lib/data-os/brand-context-domain-mutation";
import { resolveBrandDeleteDisposition } from "@/lib/data-os/brand-lifecycle";
import { reconcileAndEnsureBrandContextAfterCommittedMutationV1 } from "@/lib/data-os/signal-brand-context-preparation";
import { db } from "@/lib/db";
import { updateBrandSchema } from "@/lib/validation/brand";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const current = await getBrandDetailForUser(session.appUser, id);

  if (!current) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const parsed = updateBrandSchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return validationError(parsed.error);
  }
  let idempotencyKey: string;
  try {
    idempotencyKey = requireBrandContextDomainMutationKeyV1(request, parsed.data.preparation);
  } catch (error) {
    return brandContextDomainMutationErrorResponse(error);
  }
  const mutationInput = {
    brand_id: current.id,
    organization_id: parsed.data.organization_id,
    slug: parsed.data.slug,
    name: parsed.data.name,
    display_name: parsed.data.display_name ?? null,
    industry: parsed.data.industry ?? null,
    industry_sub: parsed.data.industry_sub ?? null,
    countries: parsed.data.countries,
    description: parsed.data.description ?? null,
    brand_seed_handles: parsed.data.brand_seed_handles,
    timezone: parsed.data.timezone,
    status: parsed.data.status
  };

  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, parsed.data.organization_id))
    .limit(1);

  if (!organization) {
    return Response.json({ error: "invalid_organization", message: "Organización no encontrada." }, { status: 422 });
  }

  try {
    const mutation = await db.transaction(async (tx) => {
      const [workspace] = await tx.select({ id: signalWorkspaces.id }).from(signalWorkspaces)
        .where(eq(signalWorkspaces.brandId, current.id)).limit(1);
      if (!workspace) throw new Error("Signal workspace not found for brand mutation.");
      const operation = await beginBrandContextDomainMutationV1<typeof brands.$inferSelect>({
        tx,
        workspaceId: workspace.id,
        actorUserId: session.appUser.id,
        action: "update-brand-context",
        idempotencyKey,
        input: mutationInput
      });
      if (operation.replay) return { row: operation.replay, replayed: true };
      const [row] = await tx
        .update(brands)
        .set({
          organizationId: parsed.data.organization_id,
          slug: parsed.data.slug,
          name: parsed.data.name,
          displayName: parsed.data.display_name,
          industry: parsed.data.industry,
          industrySub: parsed.data.industry_sub,
          countries: parsed.data.countries,
          description: parsed.data.description,
          brandSeedHandles: parsed.data.brand_seed_handles,
          status: parsed.data.status,
          updatedAt: new Date()
        })
        .where(eq(brands.id, current.id))
        .returning();

      if (!row) throw new Error("Brand mutation did not update a row.");

      if (current.organizationId !== parsed.data.organization_id) {
        await tx
          .update(brandKnowledgeSources)
          .set({
            organizationId: parsed.data.organization_id,
            updatedAt: new Date()
          })
          .where(and(eq(brandKnowledgeSources.brandId, current.id), isNull(brandKnowledgeSources.studyCorpusId)));
      }

      await tx
        .update(signalWorkspaces)
        .set({
          organizationId: parsed.data.organization_id,
          slug: parsed.data.slug,
          timezone: parsed.data.timezone,
          status: parsed.data.status,
          updatedAt: new Date()
        })
        .where(eq(signalWorkspaces.brandId, current.id));
      await tx
        .update(signalRefreshPolicies)
        .set({ timezone: parsed.data.timezone, updatedAt: new Date() })
        .where(eq(signalRefreshPolicies.workspaceId, sql`(SELECT id FROM signal_workspaces WHERE brand_id=${current.id})`));

      const automaticSources = await tx
        .select({ id: brandKnowledgeSources.id, extractedPayload: brandKnowledgeSources.extractedPayload })
        .from(brandKnowledgeSources)
        .where(and(
          eq(brandKnowledgeSources.brandId, current.id),
          isNull(brandKnowledgeSources.studyCorpusId),
          eq(brandKnowledgeSources.sourceKind, "brand_os_context"),
          sql`${brandKnowledgeSources.extractedPayload}->>'source'='automatic_brand_os'`
        ));
      if (automaticSources.length > 0) {
        const competitorRows = await tx
          .select({ name: brandSeeds.canonicalName })
          .from(competitorRelations)
          .innerJoin(brandSeeds, eq(brandSeeds.id, competitorRelations.competitorBrandSeedId))
          .where(and(eq(competitorRelations.brandId, current.id), eq(competitorRelations.status, "current")));
        for (const source of automaticSources) {
          const existingPayload = asObject(source.extractedPayload);
          const confirmedContext = typeof existingPayload.confirmed_additional_context === "string"
            ? existingPayload.confirmed_additional_context : null;
          const rawText = buildAutomaticBrandContextText({
            name: parsed.data.display_name || parsed.data.name,
            description: parsed.data.description,
            industry: parsed.data.industry,
            industrySub: parsed.data.industry_sub,
            countries: parsed.data.countries,
            aliases: parsed.data.brand_seed_handles,
            competitors: competitorRows.map((competitor) => competitor.name),
            notes: confirmedContext
          });
          await tx.update(brandKnowledgeSources).set({
            organizationId: parsed.data.organization_id,
            rawText,
            extractedPayload: {
              ...existingPayload,
              summary: rawText.slice(0, 1200),
              source: "automatic_brand_os",
              confirmed_additional_context: confirmedContext
            },
            status: "processed",
            errorMessage: null,
            updatedAt: new Date()
          }).where(and(eq(brandKnowledgeSources.id, source.id), eq(brandKnowledgeSources.brandId, current.id),
            isNull(brandKnowledgeSources.studyCorpusId)));
        }
      }

      if (current.organizationId !== parsed.data.organization_id) {
        await syncClientBrandAccessForMovedBrand({
          brandId: current.id,
          organizationId: parsed.data.organization_id
        }, tx);
      }

      await completeBrandContextDomainMutationV1({
        tx,
        workspaceId: workspace.id,
        operationId: operation.operationId,
        result: row
      });
      return { row, replayed: false };
    });

    const preparation = await reconcileAndEnsureBrandContextAfterCommittedMutationV1({
      brandId: current.id,
      actor: session.appUser,
      preparation: parsed.data.preparation,
      fallbackIdempotencyKey: `${idempotencyKey}:prepare`,
      reconciliationIdempotencyKey: `${idempotencyKey}:brand-os`,
      enabled: mutation.row.status === "active"
    });

    return Response.json({ data: mutation.row, replayed: mutation.replayed, brand_context_preparation: preparation });
  } catch (err) {
    if (err instanceof BrandContextDomainMutationError) return brandContextDomainMutationErrorResponse(err);
    if (isUniqueViolation(err)) {
      return Response.json(
        {
          error: "duplicate_brand",
          message: "Ya existe una marca con ese slug. Cambia el slug o abre la marca existente."
        },
        { status: 409 }
      );
    }
    throw err;
  }
}

function brandContextDomainMutationErrorResponse(error: unknown) {
  const required = error instanceof BrandContextDomainMutationError && error.code === "idempotency_key_required";
  return Response.json({
    error: required ? "idempotency_key_required" : "idempotency_conflict",
    message: required
      ? "Idempotency-Key is required and must match the preparation."
      : "Idempotency-Key was reused with incompatible brand input."
  }, { status: required ? 400 : 409 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const current = await getBrandDetailForUser(session.appUser, id);

  if (!current) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const url = new URL(_request.url);
  const permanent = url.searchParams.get("permanent") === "true";
  const [[corporaCount], [workspaceCount]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` })
      .from(studyCorpora)
      .where(eq(studyCorpora.brandId, current.id)),
    db.select({ total: sql<number>`count(*)::int` })
      .from(signalWorkspaces)
      .where(eq(signalWorkspaces.brandId, current.id))
  ]);
  const disposition = resolveBrandDeleteDisposition({
    permanent,
    status: current.status,
    corporaCount: corporaCount?.total ?? 0,
    workspaceCount: workspaceCount?.total ?? 0
  });

  if (disposition === "workspace_owned_blocked") {
    return Response.json(
      {
        error: "workspace_owned_delete_not_supported",
        message: "Esta marca conserva data, snapshots y releases del workspace. Sólo puede archivarse hasta contar con un proceso explícito de retención."
      },
      { status: 409 }
    );
  }
  if (disposition === "archive_required") {
    return Response.json(
      {
        error: "archive_required",
        message: "Archiva la marca antes de borrarla permanentemente."
      },
      { status: 422 }
    );
  }
  if (disposition === "archive") {
    const [updated] = await db
      .update(brands)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(brands.id, current.id), ne(brands.status, "archived")))
      .returning({ id: brands.id, status: brands.status });

    return Response.json({
      data: updated ?? { id: current.id, status: "archived" },
      mode: "archived",
      message: "La marca conserva data o historial asociado; se archivó sin borrar el workspace."
    });
  }

  await permanentlyDeleteBrand(current.id);
  return Response.json({
    data: { id: current.id, deleted: true },
    mode: permanent ? "permanent" : "deleted"
  });
}

async function permanentlyDeleteBrand(brandId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM published_outputs
      WHERE brand_id = ${brandId}
         OR study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM tb_analyses
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM mentions
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM import_batches
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM corpus_entities
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM query_iterations
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM cleanup_actions
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM corpus_snapshots
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM brand_knowledge_sources
      WHERE brand_id = ${brandId}
         OR study_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`
      DELETE FROM memory_brand
      WHERE brand_id = ${brandId}
         OR source_corpus_id IN (SELECT id FROM study_corpora WHERE brand_id = ${brandId})
    `);
    await tx.execute(sql`DELETE FROM study_corpora WHERE brand_id = ${brandId}`);
    await tx.execute(sql`DELETE FROM user_brand_access WHERE brand_id = ${brandId}`);
    await tx.execute(sql`DELETE FROM competitors WHERE brand_id = ${brandId}`);
    await tx.execute(sql`DELETE FROM brands WHERE id = ${brandId}`);
  });
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
