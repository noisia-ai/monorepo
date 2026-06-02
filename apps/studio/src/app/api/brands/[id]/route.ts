import { and, eq, ne, sql } from "drizzle-orm";
import { brandKnowledgeSources, brands, organizations, studyCorpora } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { syncClientBrandAccessForMovedBrand } from "@/lib/auth/org-sync";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
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

  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, parsed.data.organization_id))
    .limit(1);

  if (!organization) {
    return Response.json({ error: "invalid_organization", message: "Organización no encontrada." }, { status: 422 });
  }

  try {
    const updated = await db.transaction(async (tx) => {
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

      if (!row) return null;

      if (current.organizationId !== parsed.data.organization_id) {
        await tx
          .update(brandKnowledgeSources)
          .set({
            organizationId: parsed.data.organization_id,
            updatedAt: new Date()
          })
          .where(eq(brandKnowledgeSources.brandId, current.id));
      }

      return row;
    });

    if (current.organizationId !== parsed.data.organization_id) {
      await syncClientBrandAccessForMovedBrand({
        brandId: current.id,
        organizationId: parsed.data.organization_id
      });
    }

    return Response.json({ data: updated });
  } catch (err) {
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

  if (permanent) {
    if (current.status !== "archived") {
      return Response.json(
        {
          error: "archive_required",
          message: "Archiva la marca antes de borrarla permanentemente."
        },
        { status: 422 }
      );
    }

    await permanentlyDeleteBrand(current.id);
    return Response.json({ data: { id: current.id, deleted: true }, mode: "permanent" });
  }

  const [corporaCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(studyCorpora)
    .where(eq(studyCorpora.brandId, current.id));

  if ((corporaCount?.total ?? 0) > 0) {
    const [updated] = await db
      .update(brands)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(brands.id, current.id), ne(brands.status, "archived")))
      .returning({ id: brands.id, status: brands.status });

    return Response.json({
      data: updated ?? { id: current.id, status: "archived" },
      mode: "archived",
      message: "La marca tiene corpora asociados; se archivó para conservar el historial."
    });
  }

  await permanentlyDeleteBrand(current.id);

  return Response.json({ data: { id: current.id, deleted: true }, mode: "deleted" });
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
