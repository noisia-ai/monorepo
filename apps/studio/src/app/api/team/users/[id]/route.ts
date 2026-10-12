import { eq } from "drizzle-orm";

import { organizations, users } from "@noisia/db";
import { db } from "@/lib/db";
import { canManageTeam, isInternalRole } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { applyTeamUserAccessChange } from "@/lib/auth/team-access";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { updateUserSchema } from "@/lib/validation/team";

// Cambiar rol / organización / estado (activo|suspendido) de un usuario.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageTeam(session.appUser.primaryRole)) return forbidden();

  const { id } = await params;
  const parsed = updateUserSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  // No te puedes bloquear a ti mismo (suspender o quitarte el rol de admin).
  const isSelf = id === session.appUser.id;
  if (isSelf && (parsed.data.status === "suspended" || (parsed.data.primary_role && parsed.data.primary_role !== "noisia_admin"))) {
    return Response.json(
      { error: "self_lockout", message: "No puedes suspenderte ni quitarte tu propio rol de admin." },
      { status: 422 }
    );
  }

  const [target] = await db
    .select({
      id: users.id,
      primaryRole: users.primaryRole,
      organizationId: users.organizationId
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) {
    return Response.json({ error: "not_found", message: "Usuario no encontrado." }, { status: 404 });
  }

  const nextRole = parsed.data.primary_role ?? target.primaryRole;
  const nextInternal = isInternalRole(nextRole);

  // La organización: internos -> null; clientes -> la enviada (o la que ya tenían).
  let nextOrganizationId: string | null;
  if (nextInternal) {
    nextOrganizationId = null;
  } else if (parsed.data.organization_id !== undefined) {
    nextOrganizationId = parsed.data.organization_id;
  } else {
    nextOrganizationId = target.organizationId;
  }

  if (!nextInternal && !nextOrganizationId) {
    return Response.json(
      { error: "organization_required", message: "Los roles de cliente requieren una organización." },
      { status: 422 }
    );
  }

  if (nextOrganizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, nextOrganizationId))
      .limit(1);
    if (!org) {
      return Response.json({ error: "invalid_organization", message: "Organización no encontrada." }, { status: 422 });
    }
  }

  const updated = await db.transaction((tx) => applyTeamUserAccessChange(tx, target, {
    primaryRole: nextRole,
    organizationId: nextOrganizationId,
    status: parsed.data.status
  }));

  return Response.json({ data: updated });
}
