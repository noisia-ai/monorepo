import { and, eq, sql } from "drizzle-orm";

import { brands, userBrandAccess, users } from "@noisia/db";
import { db } from "@/lib/db";
import { brandAccessLevelForRole, isInternalRole, normalizeRole } from "@/lib/auth/roles";

export async function syncClientBrandAccessForOrganization(args: {
  userId: string;
  role: string;
  organizationId: string | null;
}) {
  const canonicalRole = normalizeRole(args.role);
  if (!canonicalRole || isInternalRole(canonicalRole) || !args.organizationId) return;

  const brandRows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.organizationId, args.organizationId), eq(brands.status, "active")));

  // TODO mejora-futura: reemplazar este grant por invitaciones con scope por marca.
  // Para MVP, un cliente dentro de la organizacion Kinde recibe acceso read/comment
  // a las marcas activas de esa organizacion en Noisia.
  const accessLevel = brandAccessLevelForRole(canonicalRole);

  for (const brand of brandRows) {
    await db
      .insert(userBrandAccess)
      .values({
        userId: args.userId,
        brandId: brand.id,
        accessLevel
      })
      .onConflictDoUpdate({
        target: [userBrandAccess.userId, userBrandAccess.brandId],
        set: {
          accessLevel,
          revokedAt: null
        }
      });
  }
}

export async function syncClientBrandAccessForMovedBrand(args: {
  brandId: string;
  organizationId: string;
}) {
  await db.execute(sql`
    UPDATE ${userBrandAccess}
    SET revoked_at = now()
    FROM ${users}
    WHERE ${userBrandAccess.userId} = ${users.id}
      AND ${userBrandAccess.brandId} = ${args.brandId}
      AND ${users.userType} = 'client'
      AND (${users.organizationId} IS NULL OR ${users.organizationId} <> ${args.organizationId})
  `);

  const clientRows = await db
    .select({
      id: users.id,
      primaryRole: users.primaryRole
    })
    .from(users)
    .where(and(eq(users.organizationId, args.organizationId), eq(users.userType, "client"), eq(users.status, "active")));

  for (const user of clientRows) {
    const accessLevel = brandAccessLevelForRole(user.primaryRole);
    await db
      .insert(userBrandAccess)
      .values({
        userId: user.id,
        brandId: args.brandId,
        accessLevel
      })
      .onConflictDoUpdate({
        target: [userBrandAccess.userId, userBrandAccess.brandId],
        set: {
          accessLevel,
          revokedAt: null
        }
      });
  }
}
