import { and, eq } from "drizzle-orm";
import {
  brandKnowledgeSources,
  brandOsBriefs,
  brandOsCompetitors,
  brandOsLinks,
  brandOsProfiles,
  brandOsSeedSets,
  brandOsSeedTerms,
  brands,
  brandSeeds,
  competitors,
  dataAssets,
  lineageEdges,
  organizations,
  signalPopulationDefinitions,
  signalRefreshPolicies,
  signalWorkspacePopulationPointers,
  signalWorkspaceReports,
  signalWorkspaces
} from "@noisia/db";
import { db } from "@/lib/db";
import { canAccessStudio, canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { listBrandsForUser } from "@/lib/data/brands";
import { buildBrandDataOsFieldSpecs, type BrandDataOsFieldSpecs } from "@/lib/data-os/field-specs";
import { signalBrandOsCanonicalSnapshotHashV1 } from "@/lib/data-os/signal-governance-control-plane";
import { createBrandSchema } from "@/lib/validation/brand";

type BrandIntakeTx = Pick<typeof db, "insert" | "select">;

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
    const created = await db.transaction(async (tx) => {
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

      const signalWorkspace = await initializeBrandSignalWorkspace(tx, {
        organizationId,
        brandId: createdBrand.id,
        brandSlug: createdBrand.slug,
        timezone: parsed.data.timezone,
        createdByUserId: session.appUser.id
      });

      const brandAliases = uniqueStrings(parsed.data.brand_seed_handles);
      const brandDetectionPatterns = uniqueStrings([
        parsed.data.name,
        parsed.data.display_name ?? "",
        parsed.data.slug,
        ...brandAliases
      ]);

      const [ownedBrandSeed] = await tx
        .insert(brandSeeds)
        .values({
          canonicalName: parsed.data.display_name || parsed.data.name,
          aliases: brandAliases,
          detectionPatterns: brandDetectionPatterns,
          vertical: parsed.data.industry,
          subVertical: parsed.data.industry_sub,
          country: parsed.data.countries[0] ?? "MX",
          notes: "Created from Brand OS setup as the canonical owned brand seed.",
          active: true
        })
        .onConflictDoUpdate({
          target: brandSeeds.canonicalName,
          set: {
            aliases: brandAliases,
            detectionPatterns: brandDetectionPatterns,
            vertical: parsed.data.industry,
            subVertical: parsed.data.industry_sub,
            active: true
          }
        })
        .returning({ id: brandSeeds.id });

      const competitorSeedRefs: Array<{ name: string; seedId: string; priority: number }> = [];

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
        competitorSeedRefs.push({ name: competitorName, seedId: seed.id, priority: index + 1 });

        await tx
          .insert(competitors)
          .values({
            brandId: createdBrand.id,
            competitorBrandSeedId: seed.id,
            priority: index + 1,
            notes: "Created from Brand OS setup.",
            status: "current",
            effectiveFrom: new Date(),
            updatedAt: new Date()
          })
          .onConflictDoNothing();
      }

      const brandFieldSpecs = buildBrandDataOsFieldSpecs({
        brandName: createdBrand.displayName || createdBrand.name,
        brandSlug: createdBrand.slug,
        industry: parsed.data.industry ?? null,
        industrySub: parsed.data.industry_sub ?? null,
        countries: parsed.data.countries,
        aliases: parsed.data.brand_seed_handles,
        competitors: competitorSeedRefs
      });
      const notes = parsed.data.knowledge_notes?.trim();
      let knowledgeSourceId: string | null = null;
      if (notes) {
        const [source] = await tx
          .insert(brandKnowledgeSources)
          .values({
            organizationId,
            brandId: createdBrand.id,
            sourceKind: "brand_brief",
            title: "Brand OS intake",
            rawText: notes,
            extractedPayload: {
              summary: notes.slice(0, 1200),
              source: "manual_intake",
              brand_field_specs: brandFieldSpecs,
              recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
            },
            status: "processed",
            createdByUserId: session.appUser.id
          })
          .returning({ id: brandKnowledgeSources.id });
        knowledgeSourceId = source?.id ?? null;
      }

      await initializeBrandDataOsIntake(tx, {
        organizationId,
        brandId: createdBrand.id,
        brandName: createdBrand.displayName || createdBrand.name,
        brandSlug: createdBrand.slug,
        ownedBrandSeedId: ownedBrandSeed?.id ?? null,
        knowledgeSourceId,
        industry: parsed.data.industry ?? null,
        industrySub: parsed.data.industry_sub ?? null,
        countries: parsed.data.countries,
        aliases: brandAliases,
        competitors: competitorSeedRefs,
        description: parsed.data.description ?? null,
        createdByUserId: session.appUser.id,
        snapshotHash: signalBrandOsCanonicalSnapshotHashV1({
          name: createdBrand.displayName || createdBrand.name,
          organization_id: organizationId,
          industry: parsed.data.industry ?? null,
          industry_sub: parsed.data.industry_sub ?? null,
          countries: parsed.data.countries,
          aliases: brandAliases,
          competitors: competitorSeedRefs.map((competitor) => ({
            name: competitor.name,
            seed_id: competitor.seedId
          })),
          knowledge_count: 0
        })
      });

      return { brand: createdBrand, signalWorkspace };
    });

    return Response.json({
      data: created.brand,
      signal_workspace: {
        id: created.signalWorkspace.id,
        slug: created.signalWorkspace.slug
      }
    }, { status: 201 });
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

async function initializeBrandSignalWorkspace(
  tx: BrandIntakeTx,
  args: {
    organizationId: string;
    brandId: string;
    brandSlug: string;
    createdByUserId: string;
    timezone: string;
  }
) {
  const [slugCollision] = await tx
    .select({ id: signalWorkspaces.id })
    .from(signalWorkspaces)
    .where(and(
      eq(signalWorkspaces.organizationId, args.organizationId),
      eq(signalWorkspaces.slug, args.brandSlug)
    ))
    .limit(1);
  const workspaceSlug = slugCollision
    ? `${args.brandSlug}-brand-${args.brandId.replaceAll("-", "").slice(0, 8)}`
    : args.brandSlug;
  const [inserted] = await tx
    .insert(signalWorkspaces)
    .values({
      organizationId: args.organizationId,
      brandId: args.brandId,
      slug: workspaceSlug,
      timezone: args.timezone,
      status: "active",
      metadata: {
        created_by: "brand-creation-v1",
        created_by_user_id: args.createdByUserId,
        ownership: "workspace"
      }
    })
    .onConflictDoNothing()
    .returning({ id: signalWorkspaces.id, slug: signalWorkspaces.slug });
  const [workspace] = inserted
    ? [inserted]
    : await tx
        .select({ id: signalWorkspaces.id, slug: signalWorkspaces.slug })
        .from(signalWorkspaces)
        .where(and(
          eq(signalWorkspaces.organizationId, args.organizationId),
          eq(signalWorkspaces.brandId, args.brandId)
        ))
        .limit(1);
  if (!workspace) throw new Error("Signal workspace could not be created for the brand.");

  const [population] = await tx
    .insert(signalPopulationDefinitions)
    .values({
      workspaceId: workspace.id,
      populationKey: "primary-brand-operational",
      version: 1,
      purpose: "operational",
      status: "active",
      acceptanceStatus: "included",
      allowedScopes: ["primary_brand"],
      definitionHash: "sha256:1de7744849ac9904272a695372976f1ef6c5d3ddd3abb5f5855e81d571c01854",
      createdByUserId: args.createdByUserId,
      activatedByUserId: args.createdByUserId,
      activatedAt: new Date()
    })
    .onConflictDoNothing()
    .returning({ id: signalPopulationDefinitions.id });
  const [resolvedPopulation] = population
    ? [population]
    : await tx
        .select({ id: signalPopulationDefinitions.id })
        .from(signalPopulationDefinitions)
        .where(and(
          eq(signalPopulationDefinitions.workspaceId, workspace.id),
          eq(signalPopulationDefinitions.populationKey, "primary-brand-operational"),
          eq(signalPopulationDefinitions.version, 1)
        ))
        .limit(1);
  if (!resolvedPopulation) throw new Error("Signal operational population could not be created.");

  await tx.insert(signalWorkspacePopulationPointers).values({
    workspaceId: workspace.id,
    purpose: "operational",
    populationId: resolvedPopulation.id,
    promotedByUserId: args.createdByUserId
  }).onConflictDoNothing();
  await tx.insert(signalWorkspaceReports).values({
    workspaceId: workspace.id,
    reportKey: "triggers-barriers",
    title: "Triggers & Barriers",
    reportType: "strategic",
    status: "active"
  }).onConflictDoNothing();
  await tx.insert(signalRefreshPolicies).values({
    workspaceId: workspace.id,
    sourceKey: "workspace-manual-ingestion",
    adapterKey: "manual_import",
    cadence: "manual",
    timezone: args.timezone,
    enabled: false,
    ownerUserId: args.createdByUserId,
    metadata: { created_by: "brand-creation-v1" }
  }).onConflictDoNothing();

  return workspace;
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

async function initializeBrandDataOsIntake(
  tx: BrandIntakeTx,
  args: {
    organizationId: string;
    brandId: string;
    brandName: string;
    brandSlug: string;
    ownedBrandSeedId: string | null;
    knowledgeSourceId: string | null;
    industry: string | null;
    industrySub: string | null;
    countries: string[];
    aliases: string[];
    competitors: Array<{ name: string; seedId: string; priority: number }>;
    description: string | null;
    createdByUserId: string;
    snapshotHash: string;
  }
) {
  const brandFieldSpecs = buildBrandDataOsFieldSpecs(args);
  const profileId = await upsertBrandOsProfile(tx, args, brandFieldSpecs);
  const intakeAssetId = await createBrandIntakeAsset(tx, args, brandFieldSpecs);
  const briefId = await createBrandOsBrief(tx, profileId, args, brandFieldSpecs);
  const seedSetId = await upsertBrandOsSeedSet(tx, profileId, args, brandFieldSpecs);

  await insertSeedTerms(tx, seedSetId, args, brandFieldSpecs);
  await insertBrandOsCompetitors(tx, profileId, args, brandFieldSpecs);

  await upsertBrandOsLink(tx, profileId, "brand_os_profile", profileId, "brand", args.brandId, "represents", args);
  await upsertBrandOsLink(tx, profileId, "brand_os_brief", briefId, "brand", args.brandId, "documents", args);
  await upsertBrandOsLink(tx, profileId, "brand_os_seed_set", seedSetId, "brand", args.brandId, "seeds", args);
  await upsertBrandOsLink(tx, profileId, "brand_os_brief", briefId, "brand_os_seed_set", seedSetId, "defines", args);
  if (args.ownedBrandSeedId) {
    await upsertBrandOsLink(tx, profileId, "brand_os_seed_set", seedSetId, "brand_seed", args.ownedBrandSeedId, "defines_owned_seed", args);
  }
  if (args.knowledgeSourceId) {
    await upsertBrandOsLink(tx, profileId, "brand_os_brief", briefId, "brand_knowledge_source", args.knowledgeSourceId, "sourced_from", args);
  }

  for (const competitor of args.competitors) {
    await upsertBrandOsLink(
      tx,
      profileId,
      "brand_os_seed_set",
      seedSetId,
      "brand_seed",
      competitor.seedId,
      "references_competitor_seed",
      args
    );
  }

  await upsertLineage(tx, "data_asset", intakeAssetId, "brand", args.brandId, "creates", args);
  await upsertLineage(tx, "data_asset", intakeAssetId, "brand_os_profile", profileId, "initializes", args);
  await upsertLineage(tx, "data_asset", intakeAssetId, "brand_os_brief", briefId, "materializes", args);
  await upsertLineage(tx, "data_asset", intakeAssetId, "brand_os_seed_set", seedSetId, "materializes", args);
  if (args.ownedBrandSeedId) {
    await upsertLineage(tx, "data_asset", intakeAssetId, "brand_seed", args.ownedBrandSeedId, "defines", args);
  }
  if (args.knowledgeSourceId) {
    await upsertLineage(tx, "brand_knowledge_source", args.knowledgeSourceId, "brand_os_brief", briefId, "feeds", args);
  }
}

async function upsertBrandOsProfile(tx: BrandIntakeTx, args: { organizationId: string; brandId: string; brandName: string; industry: string | null; industrySub: string | null; countries: string[]; aliases: string[]; createdByUserId: string; snapshotHash: string }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  const [created] = await tx
    .insert(brandOsProfiles)
    .values({
      organizationId: args.organizationId,
      brandId: args.brandId,
      name: `${args.brandName} Brand OS`,
      status: "active",
      version: 1,
      metadata: {
        source: "brand-creation-v1",
        snapshot_hash: args.snapshotHash,
        intake_version: "data_os_cut_1",
        industry: args.industry,
        industry_sub: splitList(args.industrySub),
        countries: args.countries,
        aliases: args.aliases,
        brand_field_specs: brandFieldSpecs,
        created_by_user_id: args.createdByUserId
      }
    })
    .onConflictDoNothing()
    .returning({ id: brandOsProfiles.id });

  if (created?.id) return created.id;

  const [existing] = await tx
    .select({ id: brandOsProfiles.id })
    .from(brandOsProfiles)
    .where(and(eq(brandOsProfiles.brandId, args.brandId), eq(brandOsProfiles.version, 1)))
    .limit(1);

  if (!existing?.id) throw new Error("Data OS Brand OS profile was not created.");
  return existing.id;
}

async function createBrandIntakeAsset(tx: BrandIntakeTx, args: { organizationId: string; brandId: string; brandName: string; brandSlug: string; industry: string | null; industrySub: string | null; countries: string[]; aliases: string[]; competitors: Array<{ name: string }>; description: string | null }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  const [asset] = await tx
    .insert(dataAssets)
    .values({
      organizationId: args.organizationId,
      brandId: args.brandId,
      assetKind: "brand_os_intake",
      layer: "intake",
      name: `${args.brandSlug}: Brand OS intake`,
      description: `Manual Brand OS intake for ${args.brandName}.`,
      ownerTeam: "studio",
      sensitivity: "internal",
      status: "active",
      storageRef: `db://brands/${args.brandId}`,
      rowCount: 1,
      metadata: {
        source: "new_brand_form",
        brand_name: args.brandName,
        industry: args.industry,
        industry_sub: splitList(args.industrySub),
        countries: args.countries,
        aliases: args.aliases,
        competitors: args.competitors.map((competitor) => competitor.name),
        brand_field_specs: brandFieldSpecs,
        description_present: Boolean(args.description)
      }
    })
    .returning({ id: dataAssets.id });

  if (!asset?.id) throw new Error("Data OS intake asset was not created.");
  return asset.id;
}

async function createBrandOsBrief(tx: BrandIntakeTx, profileId: string, args: { brandId: string; brandName: string; knowledgeSourceId: string | null; industry: string | null; industrySub: string | null; countries: string[]; aliases: string[]; competitors: Array<{ name: string }>; description: string | null }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  const [brief] = await tx
    .insert(brandOsBriefs)
    .values({
      brandOsProfileId: profileId,
      knowledgeSourceId: args.knowledgeSourceId ?? undefined,
      briefType: "brand_intake",
      title: `${args.brandName} Brand OS intake`,
      summary: args.description ?? `${args.brandName} identity and category intake.`,
      sourceKind: "new_brand_form",
      status: "active",
      metadata: {
        source: "new_brand_form",
        brand_id: args.brandId,
        industry: args.industry,
        industry_sub: splitList(args.industrySub),
        countries: args.countries,
        aliases: args.aliases,
        competitors: args.competitors.map((competitor) => competitor.name),
        brand_field_specs: brandFieldSpecs
      }
    })
    .returning({ id: brandOsBriefs.id });

  if (!brief?.id) throw new Error("Data OS Brand OS brief was not created.");
  return brief.id;
}

async function upsertBrandOsSeedSet(tx: BrandIntakeTx, profileId: string, args: { brandName: string; industry: string | null; industrySub: string | null; countries: string[] }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  const name = `${args.brandName} identity seeds`;
  const [created] = await tx
    .insert(brandOsSeedSets)
    .values({
      brandOsProfileId: profileId,
      name,
      seedSetType: "brand_identity",
      status: "active",
      metadata: {
        source: "new_brand_form",
        industry: args.industry,
        industry_sub: splitList(args.industrySub),
        countries: args.countries,
        brand_field_specs: brandFieldSpecs
      }
    })
    .onConflictDoNothing()
    .returning({ id: brandOsSeedSets.id });

  if (created?.id) return created.id;

  const [existing] = await tx
    .select({ id: brandOsSeedSets.id })
    .from(brandOsSeedSets)
    .where(
      and(
        eq(brandOsSeedSets.brandOsProfileId, profileId),
        eq(brandOsSeedSets.seedSetType, "brand_identity"),
        eq(brandOsSeedSets.name, name)
      )
    )
    .limit(1);

  if (!existing?.id) throw new Error("Data OS seed set was not created.");
  return existing.id;
}

async function insertSeedTerms(tx: BrandIntakeTx, seedSetId: string, args: { brandName: string; brandSlug: string; aliases: string[]; countries: string[]; industry: string | null; industrySub: string | null; competitors: Array<{ name: string; seedId: string }> }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  const terms: Array<{ term: string; termType: string; weight: string; brandSeedId?: string }> = [
    { term: args.brandName, termType: "brand_name", weight: "1" },
    { term: args.brandSlug, termType: "brand_slug", weight: "0.9" },
    ...args.aliases.map((term) => ({ term, termType: "alias", weight: "0.9" })),
    ...args.countries.map((term) => ({ term, termType: "country", weight: "0.6" })),
    ...(args.industry ? [{ term: args.industry, termType: "industry", weight: "0.7" }] : []),
    ...splitList(args.industrySub).map((term) => ({ term, termType: "subindustry", weight: "0.7" })),
    ...args.competitors.map((competitor) => ({ term: competitor.name, termType: "competitor", weight: "0.55", brandSeedId: competitor.seedId }))
  ];

  for (const item of terms) {
    const spec = brandFieldSpecs.seed_terms.find((seedTerm) => seedTerm.term.toLowerCase() === item.term.toLowerCase() && seedTerm.term_type === item.termType);
    await tx
      .insert(brandOsSeedTerms)
      .values({
        seedSetId,
        term: compact(item.term, 240),
        termType: item.termType,
        brandSeedId: item.brandSeedId,
        weight: item.weight,
        metadata: {
          source: "new_brand_form",
          data_os_entity: "brand_seed_term",
          catalog_role: spec?.catalog_role ?? "brand_os_seed",
          field_spec: spec ?? null
        }
      })
      .onConflictDoNothing();
  }
}

async function insertBrandOsCompetitors(tx: BrandIntakeTx, profileId: string, args: { competitors: Array<{ name: string; seedId: string; priority: number }> }, brandFieldSpecs: BrandDataOsFieldSpecs) {
  for (const competitor of args.competitors) {
    const spec = brandFieldSpecs.competitors.find((item) => item.name.toLowerCase() === competitor.name.toLowerCase());
    await tx
      .insert(brandOsCompetitors)
      .values({
        brandOsProfileId: profileId,
        competitorName: competitor.name,
        competitorBrandSeedId: competitor.seedId,
        role: "competitor",
        priority: competitor.priority,
        metadata: {
          source: "new_brand_form",
          data_os_entity: "competitor_seed",
          field_spec: spec ?? null
        }
      })
      .onConflictDoNothing();
  }
}

async function upsertBrandOsLink(
  tx: BrandIntakeTx,
  profileId: string,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  args: { createdByUserId: string }
) {
  await tx
    .insert(brandOsLinks)
    .values({
      brandOsProfileId: profileId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationType,
      metadata: { source: "new_brand_form", created_by_user_id: args.createdByUserId }
    })
    .onConflictDoNothing();
}

async function upsertLineage(
  tx: BrandIntakeTx,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  args: { createdByUserId: string }
) {
  await tx
    .insert(lineageEdges)
    .values({
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationType,
      metadata: { source: "new_brand_form", created_by_user_id: args.createdByUserId }
    })
    .onConflictDoNothing();
}

function splitList(value: string | null | undefined) {
  return (value ?? "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function compact(value: string, maxLength = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
