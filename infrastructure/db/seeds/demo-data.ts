import { eq, inArray } from "drizzle-orm";

import { db } from "./client.js";
import { brands, brandSeeds, competitors, methodologies, organizations, studyCorpora } from "../schema/index.js";

export async function seedDemoData() {
  const [noisiaOrg] = await db
    .insert(organizations)
    .values({
      slug: "noisia-internal",
      legalName: "Noisia AI",
      displayName: "Noisia Internal",
      hqCountry: "MX",
      industryPrimary: "research_intelligence",
      isHolding: false,
      status: "active"
    })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: {
        legalName: "Noisia AI",
        displayName: "Noisia Internal",
        status: "active",
        updatedAt: new Date()
      }
    })
    .returning();

  const [clientOrg] = await db
    .insert(organizations)
    .values({
      slug: "seguros-el-potosi-demo",
      legalName: "Seguros El Potosi",
      displayName: "Seguros El Potosi",
      hqCountry: "MX",
      industryPrimary: "seguros",
      isHolding: false,
      status: "active",
      notes: "Demo organization for MVP Triggers & Barriers."
    })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: {
        legalName: "Seguros El Potosi",
        displayName: "Seguros El Potosi",
        industryPrimary: "seguros",
        status: "active",
        updatedAt: new Date()
      }
    })
    .returning();

  if (!clientOrg) {
    throw new Error("Could not seed Seguros El Potosi organization.");
  }

  const [brand] = await db
    .insert(brands)
    .values({
      organizationId: clientOrg.id,
      slug: "seguros-el-potosi",
      name: "Seguros El Potosi",
      displayName: "Seguros El Potosi",
      industry: "seguros",
      industrySub: "seguros_generales",
      countries: ["MX"],
      brandSeedHandles: ["Seguros El Potosi", "Seguros El Potosí", "@SegurosElPotosi"],
      status: "active"
    })
    .onConflictDoUpdate({
      target: brands.slug,
      set: {
        organizationId: clientOrg.id,
        name: "Seguros El Potosi",
        displayName: "Seguros El Potosi",
        industry: "seguros",
        industrySub: "seguros_generales",
        countries: ["MX"],
        brandSeedHandles: ["Seguros El Potosi", "Seguros El Potosí", "@SegurosElPotosi"],
        status: "active",
        updatedAt: new Date()
      }
    })
    .returning();

  const competitorSeeds = await db
    .select()
    .from(brandSeeds)
    .where(inArray(brandSeeds.canonicalName, ["AXA México", "GNP Seguros", "Qualitas"]));

  if (brand) {
    for (const [index, seed] of competitorSeeds.entries()) {
      await db
        .insert(competitors)
        .values({
          brandId: brand.id,
          competitorBrandSeedId: seed.id,
          priority: index + 1,
          notes: "Demo competitor seeded for insurance T&B validation."
        })
        .onConflictDoNothing();
    }

    const [tb] = await db
      .select()
      .from(methodologies)
      .where(eq(methodologies.slug, "triggers-barriers"))
      .limit(1);

    if (tb) {
      await db
        .insert(studyCorpora)
        .values({
          name: "Seguros El Potosi · Triggers & Barriers",
          brandId: brand.id,
          methodologyId: tb.id,
          methodologyVersionAtCreation: tb.version,
          businessQuestion:
            "¿Qué motiva y qué frena la compra y uso de seguros en la categoría de Seguros El Potosi?",
          decisionToInform: "Priorizar mensajes, barreras y oportunidades para equipos de marca.",
          audienceSegment: "Compradores y usuarios de seguros en México",
          geoFocus: ["MX"],
          targetWindowMonths: 12,
          status: "draft",
          currentPipelineVersion: "mvp-f1"
        })
        .onConflictDoNothing();
    }
  }

  return {
    organizations: [noisiaOrg?.slug, clientOrg.slug].filter(Boolean),
    brand: brand?.slug,
    competitors: competitorSeeds.length
  };
}
