import { eq } from "drizzle-orm";
import { brands } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
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

  try {
    const [updated] = await db
      .update(brands)
      .set({
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

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
