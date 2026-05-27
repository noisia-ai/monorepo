import { and, eq } from "drizzle-orm";
import { competitors } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { db } from "@/lib/db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; competitorId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id, competitorId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const [deleted] = await db
    .delete(competitors)
    .where(and(eq(competitors.id, competitorId), eq(competitors.brandId, brand.id)))
    .returning({ id: competitors.id });

  if (!deleted) {
    return Response.json(
      { error: "not_found", message: "Competitor not found for this brand." },
      { status: 404 }
    );
  }

  return Response.json({ data: deleted });
}
