import { brandKnowledgeSources, brands, brandSeeds, competitors, organizations } from "@noisia/db";
import { db } from "@/lib/db";
import { canAccessStudio, canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { listBrandsForUser } from "@/lib/data/brands";
import { createBrandSchema } from "@/lib/validation/brand";

export async function GET(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    return forbidden();
  }

  const url = new URL(request.url);
  const result = await listBrandsForUser(session.appUser, {
    organization: url.searchParams.get("organization_id") ?? url.searchParams.get("organization") ?? undefined,
    industry: url.searchParams.get("industry") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 50)
  });

  return Response.json(result);
}

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) {
    return forbidden();
  }

  const parsed = createBrandSchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const brand = await db.transaction(async (tx) => {
    let organizationId = parsed.data.organization_id;

    if (!organizationId && parsed.data.organization_name) {
      const orgName = parsed.data.organization_name.trim();
      const orgSlug = slugify(orgName);
      const [org] = await tx
        .insert(organizations)
        .values({
          slug: orgSlug,
          legalName: orgName,
          displayName: orgName,
          hqCountry: parsed.data.countries[0] ?? "MX",
          industryPrimary: parsed.data.industry,
          isHolding: false,
          status: "active"
        })
        .onConflictDoUpdate({
          target: organizations.slug,
          set: {
            displayName: orgName,
            industryPrimary: parsed.data.industry,
            status: "active",
            updatedAt: new Date()
          }
        })
        .returning({ id: organizations.id });

      if (!org) {
        throw new Error("Organization could not be created.");
      }

      organizationId = org.id;
    }

    if (!organizationId) {
      throw new Error("Organization could not be resolved.");
    }

    const [createdBrand] = await tx
      .insert(brands)
      .values({
        organizationId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        displayName: parsed.data.display_name,
        industry: parsed.data.industry,
        industrySub: parsed.data.industry_sub,
        countries: parsed.data.countries,
        description: parsed.data.description,
        brandSeedHandles: parsed.data.brand_seed_handles,
        status: parsed.data.status,
        primaryBrandManagerUserId: parsed.data.primary_brand_manager_user_id
      })
      .returning();

    if (!createdBrand) {
      throw new Error("Brand could not be created.");
    }

    for (const [index, competitorName] of uniqueStrings(parsed.data.competitors).entries()) {
      const [seed] = await tx
        .insert(brandSeeds)
        .values({
          canonicalName: competitorName,
          aliases: [],
          detectionPatterns: [competitorName],
          vertical: parsed.data.industry,
          subVertical: parsed.data.industry_sub,
          country: parsed.data.countries[0] ?? "MX",
          active: true
        })
        .onConflictDoUpdate({
          target: brandSeeds.canonicalName,
          set: {
            vertical: parsed.data.industry,
            subVertical: parsed.data.industry_sub,
            active: true
          }
        })
        .returning({ id: brandSeeds.id });

      if (!seed) continue;

      await tx
        .insert(competitors)
        .values({
          brandId: createdBrand.id,
          competitorBrandSeedId: seed.id,
          priority: index + 1,
          notes: "Created from Brand OS setup."
        })
        .onConflictDoNothing();
    }

    const notes = parsed.data.knowledge_notes?.trim();
    if (notes) {
      await tx.insert(brandKnowledgeSources).values({
        organizationId,
        brandId: createdBrand.id,
        sourceKind: "brand_brief",
        title: "Brand OS intake",
        rawText: notes,
        extractedPayload: {
          summary: notes.slice(0, 1200),
          source: "manual_intake",
          recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
        },
        status: "processed",
        createdByUserId: session.appUser.id
      });
    }

      return createdBrand;
    });

    return Response.json({ data: brand }, { status: 201 });
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

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "organizacion";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
