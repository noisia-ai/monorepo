import { eq } from "drizzle-orm";
import { brandSeeds, competitors } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { db } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const names = uniqueStrings(Array.isArray(body?.competitors) ? body.competitors : []);

  if (names.length === 0) {
    return Response.json(
      { error: "validation_error", message: "Agrega al menos un competidor." },
      { status: 422 }
    );
  }

  const created = await db.transaction(async (tx) => {
    const rows = [];
    for (const [index, name] of names.entries()) {
      const [seed] = await tx
        .insert(brandSeeds)
        .values({
          canonicalName: name,
          aliases: [],
          detectionPatterns: [name],
          vertical: brand.industry,
          subVertical: brand.industrySub,
          country: brand.countries?.[0] ?? "MX",
          active: true
        })
        .onConflictDoUpdate({
          target: brandSeeds.canonicalName,
          set: {
            vertical: brand.industry,
            subVertical: brand.industrySub,
            active: true
          }
        })
        .returning({ id: brandSeeds.id });

      if (!seed) continue;
      const [competitor] = await tx
        .insert(competitors)
        .values({
          brandId: brand.id,
          competitorBrandSeedId: seed.id,
          priority: brand.competitors.length + index + 1,
          notes: "Created from Brand OS editor."
        })
        .onConflictDoNothing()
        .returning({ id: competitors.id });

      if (competitor) rows.push(competitor);
    }
    return rows;
  });

  return Response.json({ data: { created_count: created.length } }, { status: 201 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const deleted = await db
    .delete(competitors)
    .where(eq(competitors.brandId, brand.id))
    .returning({ id: competitors.id });

  return Response.json({ data: { deleted_count: deleted.length } });
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().replace(/\s+/g, " ").slice(0, 240))
        .filter((value) => value.length >= 2 && value.length <= 240)
    )
  ).slice(0, 40);
}
