import { eq, sql } from "drizzle-orm";

import { brands, invitations, organizations, themes, users } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageTeam } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateOrganizationSchema } from "@/lib/validation/team";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canManageTeam(session.appUser.primaryRole)) return forbidden();

  const { id } = await params;
  const parsed = updateOrganizationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const [current] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!current) {
    return Response.json({ error: "not_found", message: "Organización no encontrada." }, { status: 404 });
  }

  try {
    const [updated] = await db
      .update(organizations)
      .set({
        ...(parsed.data.slug ? { slug: parsed.data.slug } : {}),
        ...(parsed.data.legal_name ? { legalName: parsed.data.legal_name } : {}),
        ...(parsed.data.display_name !== undefined ? { displayName: emptyToNull(parsed.data.display_name) } : {}),
        ...(parsed.data.hq_country ? { hqCountry: parsed.data.hq_country } : {}),
        ...(parsed.data.industry_primary !== undefined ? { industryPrimary: emptyToNull(parsed.data.industry_primary) } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.notes !== undefined ? { notes: emptyToNull(parsed.data.notes) } : {}),
        updatedAt: new Date()
      })
      .where(eq(organizations.id, id))
      .returning();

    return Response.json({ data: updated });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: "duplicate_organization", message: "Ya existe una organización con ese slug." },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canManageTeam(session.appUser.primaryRole)) return forbidden();

  const { id } = await params;
  const blockers = await getOrganizationDeleteBlockers(id);

  if (!blockers.exists) {
    return Response.json({ error: "not_found", message: "Organización no encontrada." }, { status: 404 });
  }

  const totalBlockers =
    blockers.users + blockers.pendingInvitations + blockers.brands + blockers.themes;

  if (totalBlockers > 0) {
    return Response.json(
      {
        error: "organization_not_empty",
        message: "Mueve o elimina usuarios, invitaciones, marcas y themes antes de borrar esta organización.",
        blockers
      },
      { status: 409 }
    );
  }

  await db.delete(organizations).where(eq(organizations.id, id));

  return Response.json({ data: { id, deleted: true } });
}

async function getOrganizationDeleteBlockers(id: string) {
  const [row] = await db
    .select({
      exists: sql<boolean>`count(${organizations.id}) > 0`,
      users: sql<number>`count(distinct ${users.id})::int`,
      pendingInvitations: sql<number>`count(distinct ${invitations.id}) filter (where ${invitations.status} = 'pending')::int`,
      brands: sql<number>`count(distinct ${brands.id})::int`,
      themes: sql<number>`count(distinct ${themes.id})::int`
    })
    .from(organizations)
    .leftJoin(users, eq(users.organizationId, organizations.id))
    .leftJoin(invitations, eq(invitations.organizationId, organizations.id))
    .leftJoin(brands, eq(brands.organizationId, organizations.id))
    .leftJoin(themes, eq(themes.organizationId, organizations.id))
    .where(eq(organizations.id, id));

  return {
    exists: Boolean(row?.exists),
    users: Number(row?.users ?? 0),
    pendingInvitations: Number(row?.pendingInvitations ?? 0),
    brands: Number(row?.brands ?? 0),
    themes: Number(row?.themes ?? 0)
  };
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
