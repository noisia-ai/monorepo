import { and, eq, isNull } from "drizzle-orm";

import { brands, organizations, userBrandAccess } from "@noisia/db";
import { db } from "@/lib/db";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/api/responses";

export async function GET() {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  const { appUser, kindeUser, kindeOrganization, kindeRoles } = session;

  const accessibleBrands =
    appUser.userType === "noisia_internal"
      ? await db
          .select({
            id: brands.id,
            slug: brands.slug,
            name: brands.name,
            organizationId: brands.organizationId,
            accessLevel: brands.status
          })
          .from(brands)
      : await db
          .select({
            id: brands.id,
            slug: brands.slug,
            name: brands.name,
            organizationId: brands.organizationId,
            accessLevel: userBrandAccess.accessLevel
          })
          .from(userBrandAccess)
          .innerJoin(brands, eq(brands.id, userBrandAccess.brandId))
          .where(and(eq(userBrandAccess.userId, appUser.id), isNull(userBrandAccess.revokedAt)));

  const normalizedAccessibleBrands = accessibleBrands.map((brand) => ({
    ...brand,
    accessLevel: appUser.userType === "noisia_internal" ? "admin" : brand.accessLevel
  }));

  const [organization] = appUser.organizationId
    ? await db
        .select({
          id: organizations.id,
          slug: organizations.slug,
          displayName: organizations.displayName,
          legalName: organizations.legalName
        })
        .from(organizations)
        .where(eq(organizations.id, appUser.organizationId))
        .limit(1)
    : [null];

  return Response.json({
    data: {
      user: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        userType: appUser.userType,
        primaryRole: appUser.primaryRole,
        status: appUser.status
      },
      kinde: {
        id: kindeUser.id,
        organization: kindeOrganization,
        roles: kindeRoles
      },
      organization,
      accessible_brands: normalizedAccessibleBrands
    }
  });
}
