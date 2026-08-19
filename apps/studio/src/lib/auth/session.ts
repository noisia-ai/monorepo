import { and, eq, sql } from "drizzle-orm";

import { invitations, users } from "@noisia/db";
import { db } from "@/lib/db";
import {
  bootstrapRoleForEmail,
  getUserType,
  isInternalRole,
  normalizeRole
} from "@/lib/auth/roles";
import { isLocalAuthOverrideEnabled } from "@/lib/auth/local-auth";
import { syncClientBrandAccessForOrganization } from "@/lib/auth/org-sync";

export async function getAuthenticatedAppUser() {
  const localSession = await getLocalAuthenticatedAppUser();
  if (localSession) return localSession;

  const { getKindeServerSession } = await import("@kinde-oss/kinde-auth-nextjs/server");
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

  const email = kindeUser.email;
  const [existingUser] = await db
    .select({
      primaryRole: users.primaryRole,
      organizationId: users.organizationId
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // En el PRIMER login (sin fila previa) buscamos una invitación pendiente para
  // adoptar el rol y la organización que el admin asignó desde Studio. Si no hay
  // invitación, sembramos un rol por defecto según el dominio del correo.
  const invitation = existingUser
    ? null
    : await consumePendingInvitation(email);

  // AuthZ = nuestra DB. Kinde sólo autentica (identidad). De aquí en adelante el
  // rol y la organización se administran desde Studio, no desde el token de Kinde.
  const existingRole = normalizeRole(existingUser?.primaryRole);
  const invitedRole = normalizeRole(invitation?.primaryRole);
  const primaryRole = existingRole ?? invitedRole ?? bootstrapRoleForEmail(email);
  const userType = getUserType(primaryRole);
  const fullName = [kindeUser.given_name, kindeUser.family_name].filter(Boolean).join(" ") || null;
  const organizationId = isInternalRole(primaryRole)
    ? null
    : existingUser?.organizationId ?? invitation?.organizationId ?? null;

  const [appUser] = await db
    .insert(users)
    .values({
      email,
      fullName,
      userType,
      primaryRole,
      organizationId,
      status: "active",
      invitedByUserId: invitation?.invitedByUserId ?? null
    })
    .onConflictDoUpdate({
      target: users.email,
      // No sobrescribimos primaryRole ni organizationId aquí: son fuente de verdad
      // de nuestra DB. El status conserva 'suspended' si el admin dio de baja a la
      // persona (un login de Kinde no la reactiva); cualquier otro estado pasa a 'active'.
      set: {
        fullName,
        status: sql`CASE WHEN ${users.status} = 'suspended' THEN 'suspended' ELSE 'active' END`,
        lastLoginAt: new Date()
      }
    })
    .returning();

  if (!appUser) {
    throw new Error("Could not resolve app user.");
  }

  // Marca la invitación como aceptada (best-effort; no bloquea el login).
  if (invitation?.id) {
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: appUser.id, updatedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
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

async function getLocalAuthenticatedAppUser() {
  if (!isLocalAuthOverrideEnabled()) return null;
  const email = process.env.NOISIA_LOCAL_AUTH_EMAIL?.trim().toLowerCase();
  if (!email) return null;

  const [appUser] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (!appUser) {
    throw new Error(`NOISIA_LOCAL_AUTH_EMAIL does not match an existing local user: ${email}`);
  }

  return {
    appUser,
    kindeUser: {
      id: `local:${appUser.id}`,
      email: appUser.email,
      given_name: appUser.fullName?.split(" ")[0] ?? "Local",
      family_name: appUser.fullName?.split(" ").slice(1).join(" ") || "User"
    },
    kindeOrganization: null,
    kindeRoles: [{ key: appUser.primaryRole, name: appUser.primaryRole }]
  };
}

/** Busca una invitación pendiente y no vencida para ese correo (case-insensitive). */
async function consumePendingInvitation(email: string) {
  const [invitation] = await db
    .select({
      id: invitations.id,
      primaryRole: invitations.primaryRole,
      organizationId: invitations.organizationId,
      invitedByUserId: invitations.invitedByUserId
    })
    .from(invitations)
    .where(
      and(
        eq(sql`lower(${invitations.email})`, email.toLowerCase()),
        eq(invitations.status, "pending"),
        sql`(${invitations.expiresAt} IS NULL OR ${invitations.expiresAt} > now())`
      )
    )
    .limit(1);

  return invitation ?? null;
}
