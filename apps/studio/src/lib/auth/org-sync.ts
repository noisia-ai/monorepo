import { sql } from "drizzle-orm";

import { brands, userBrandAccess, users } from "@noisia/db";
import { db } from "@/lib/db";
import { isInternalRole, normalizeRole } from "@/lib/auth/roles";

type OrganizationSyncDatabase = Pick<typeof db, "execute">;

export async function syncClientBrandAccessForOrganization(args: {
  userId: string;
  role: string;
  organizationId: string | null;
}) {
  const canonicalRole = normalizeRole(args.role);
  if (!canonicalRole || isInternalRole(canonicalRole) || !args.organizationId) return;

  // Reconciliation may revoke stale tenant access, but it must never create,
  // restore, or widen a per-brand assignment.
  await revokeClientBrandAccessOutsideOrganization({
    userId: args.userId,
    organizationId: args.organizationId
  });
}

export async function revokeClientBrandAccessOutsideOrganization(args: {
  userId: string;
  organizationId: string | null;
}, database: OrganizationSyncDatabase = db) {
  await database.execute(sql`
    UPDATE ${userBrandAccess}
    SET revoked_at = COALESCE(revoked_at, now())
    FROM ${brands}
    WHERE ${userBrandAccess.brandId} = ${brands.id}
      AND ${userBrandAccess.userId} = ${args.userId}
      AND ${userBrandAccess.revokedAt} IS NULL
      AND (${args.organizationId}::uuid IS NULL OR ${brands.organizationId} <> ${args.organizationId}::uuid)
  `);
}

export async function revokeAllClientBrandAccess(
  userId: string,
  database: OrganizationSyncDatabase = db
) {
  await database.execute(sql`
    UPDATE ${userBrandAccess}
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE ${userBrandAccess.userId} = ${userId}
      AND ${userBrandAccess.revokedAt} IS NULL
  `);
}

export async function syncClientBrandAccessForMovedBrand(args: {
  brandId: string;
  organizationId: string;
}, database: OrganizationSyncDatabase = db) {
  await database.execute(sql`
    UPDATE ${userBrandAccess}
    SET revoked_at = now()
    FROM ${users}
    WHERE ${userBrandAccess.userId} = ${users.id}
      AND ${userBrandAccess.brandId} = ${args.brandId}
      AND ${users.userType} = 'client'
      AND (${users.organizationId} IS NULL OR ${users.organizationId} <> ${args.organizationId})
  `);

}
