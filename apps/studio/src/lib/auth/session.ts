import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { eq } from "drizzle-orm";

import { users } from "@noisia/db";
import { db } from "@/lib/db";
import {
  getUserType,
  isInternalRole,
  normalizeRole,
  pickPrimaryRole
} from "@/lib/auth/roles";
import {
  resolveOrganizationIdFromKinde,
  syncClientBrandAccessForOrganization
} from "@/lib/auth/org-sync";

export async function getAuthenticatedAppUser() {
  const session = getKindeServerSession();
  const isAuthenticated = await session.isAuthenticated();

  if (!isAuthenticated) {
    return null;
  }

  const kindeUser = await session.getUser();
  const kindeOrganization = await session.getOrganization();
  const kindeRoles = await session.getRoles();

  if (!kindeUser?.email) {
    throw new Error("Kinde user email is required.");
  }

  const [existingUser] = await db
    .select({
      primaryRole: users.primaryRole,
      organizationId: users.organizationId
    })
    .from(users)
    .where(eq(users.email, kindeUser.email))
    .limit(1);

  const kindePrimaryRole = pickPrimaryRole(kindeRoles, kindeUser.email);
  const existingPrimaryRole = normalizeRole(existingUser?.primaryRole);
  // TODO mejora-futura: cuando las invitaciones de Kinde sean la fuente de verdad,
  // eliminar este fallback que conserva roles internos ya creados en la BD.
  const primaryRole =
    kindePrimaryRole === "client_viewer" && existingPrimaryRole
      ? existingPrimaryRole
      : kindePrimaryRole;
  const userType = getUserType(primaryRole);
  const fullName = [kindeUser.given_name, kindeUser.family_name].filter(Boolean).join(" ") || null;
  const organizationId = isInternalRole(primaryRole)
    ? null
    : await resolveOrganizationIdFromKinde(kindeOrganization, primaryRole, existingUser?.organizationId);

  // TODO mejora-futura: reemplazar este upsert por un sync explicito con Kinde
  // webhooks/management API cuando tengamos invitaciones y organizaciones reales.
  const [appUser] = await db
    .insert(users)
    .values({
      email: kindeUser.email,
      fullName,
      userType,
      primaryRole,
      organizationId,
      status: "active"
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        fullName,
        userType,
        primaryRole,
        organizationId,
        status: "active",
        lastLoginAt: new Date()
      }
    })
    .returning();

  if (!appUser) {
    throw new Error("Could not resolve app user.");
  }

  await syncClientBrandAccessForOrganization({
    userId: appUser.id,
    role: primaryRole,
    organizationId: appUser.organizationId
  });

  return {
    appUser,
    kindeUser,
    kindeOrganization,
    kindeRoles
  };
}
