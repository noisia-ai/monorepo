import { eq } from "drizzle-orm";

import { users } from "@noisia/db";
import { db } from "@/lib/db";
import { getUserType, isInternalRole } from "@/lib/auth/roles";
import { revokeAllClientBrandAccess, revokeClientBrandAccessOutsideOrganization } from "@/lib/auth/org-sync";

type TeamAccessTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared product mutation for team role changes and authenticated access recovery. */
export async function applyTeamUserAccessChange(
  tx: TeamAccessTransaction,
  current: { id: string; organizationId: string | null },
  next: { primaryRole: string; organizationId: string | null; status?: string }
) {
  const [row] = await tx.update(users).set({
    primaryRole: next.primaryRole,
    userType: getUserType(next.primaryRole),
    organizationId: next.organizationId,
    ...(next.status ? { status: next.status } : {})
  }).where(eq(users.id, current.id)).returning({
    id: users.id,
    email: users.email,
    primaryRole: users.primaryRole,
    userType: users.userType,
    organizationId: users.organizationId,
    status: users.status
  });
  if (!row) return null;

  if (current.organizationId !== next.organizationId || isInternalRole(next.primaryRole) || row.status === "suspended") {
    await revokeAllClientBrandAccess(row.id, tx);
  } else {
    await revokeClientBrandAccessOutsideOrganization({
      userId: row.id,
      organizationId: next.organizationId
    }, tx);
  }
  return row;
}
