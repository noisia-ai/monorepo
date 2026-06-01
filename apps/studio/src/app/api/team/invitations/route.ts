import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { invitations, organizations, users } from "@noisia/db";
import { db } from "@/lib/db";
import { canManageTeam, displayRole } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { createInvitationSchema } from "@/lib/validation/team";
import { listPendingInvitations } from "@/lib/data/team";
import { renderInvitationEmail, sendEmail } from "@/lib/email";
import { absoluteAppUrl } from "@/lib/url/origin";

const INVITATION_TTL_DAYS = 14;

export async function GET() {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageTeam(session.appUser.primaryRole)) return forbidden();

  return Response.json({ data: await listPendingInvitations() });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageTeam(session.appUser.primaryRole)) return forbidden();

  const parsed = createInvitationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const { email, primary_role, organization_id } = parsed.data;
  const isInternal = primary_role === "noisia_admin" || primary_role === "analyst";
  const organizationId = isInternal ? null : organization_id ?? null;

  // ¿Ya es un usuario activo? Entonces no se invita, se edita.
  const [already] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  if (already) {
    return Response.json(
      { error: "already_member", message: "Ese correo ya es un usuario. Edita su rol desde la lista." },
      { status: 409 }
    );
  }

  // Validar la organización si aplica.
  let organizationName: string | null = null;
  if (organizationId) {
    const [org] = await db
      .select({ id: organizations.id, displayName: organizations.displayName, legalName: organizations.legalName })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) {
      return Response.json({ error: "invalid_organization", message: "Organización no encontrada." }, { status: 422 });
    }

    organizationName = org.displayName ?? org.legalName ?? null;
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  let invitation;
  try {
    [invitation] = await db
      .insert(invitations)
      .values({
        email,
        primaryRole: primary_role,
        organizationId,
        status: "pending",
        token,
        invitedByUserId: session.appUser.id,
        expiresAt
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: "already_invited", message: "Ya hay una invitación pendiente para ese correo." },
        { status: 409 }
      );
    }
    throw err;
  }

  // Envío de correo best-effort: la invitación ya quedó creada.
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Noisia Studio";
  const loginUrl = absoluteAppUrl(
    request,
    `/api/auth/login?post_login_redirect_url=${encodeURIComponent("/auth/continue")}`
  );
  const { html, text } = renderInvitationEmail({
    appName,
    loginUrl,
    roleLabel: displayRole(primary_role),
    organizationName
  });
  const emailResult = await sendEmail({ to: email, subject: `Te invitaron a ${appName}`, html, text });

  return Response.json(
    {
      data: invitation,
      email_sent: emailResult.ok,
      email_error: emailResult.ok ? null : emailResult.error
    },
    { status: 201 }
  );
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
