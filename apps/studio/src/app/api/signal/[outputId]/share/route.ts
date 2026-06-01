import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { brands, invitations, organizations, users } from "@noisia/db";
import { db } from "@/lib/db";
import { unauthorized, validationError } from "@/lib/api/responses";
import { authContinuePath } from "@/lib/auth/redirects";
import { displayRole, getUserType, normalizeRole } from "@/lib/auth/roles";
import { syncClientBrandAccessForOrganization } from "@/lib/auth/org-sync";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { renderSignalShareEmail, sendEmail } from "@/lib/email";
import { adaptTbSignalPayload } from "@/lib/signal/adapters/tb";
import { absoluteAppUrl } from "@/lib/url/origin";

const INVITATION_TTL_DAYS = 14;

const shareSignalSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  lang: z.enum(["en", "es"]).optional()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ outputId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const parsed = shareSignalSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const { outputId } = await params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Reporte no encontrado." }, { status: 404 });
  }
  if (!output.brandId) {
    return Response.json({ error: "not_shareable", message: "Este reporte no está asociado a una marca." }, { status: 422 });
  }

  const [brand] = await db
    .select({
      id: brands.id,
      organizationId: brands.organizationId,
      organizationName: organizations.displayName,
      organizationLegalName: organizations.legalName
    })
    .from(brands)
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(brands.id, output.brandId))
    .limit(1);

  if (!brand) {
    return Response.json({ error: "brand_not_found", message: "No encontramos la organización del reporte." }, { status: 422 });
  }

  const email = parsed.data.email;
  const lang = parsed.data.lang ?? "es";
  const role = "client_viewer";
  const roleLabel = displayRole(role);
  const reportPath = `/signal/${outputId}/deck?lang=${lang}`;
  const reportUrl = absoluteAppUrl(request, reportPath);
  const loginUrl = absoluteAppUrl(
    request,
    `/api/auth/login?post_login_redirect_url=${encodeURIComponent(authContinuePath(reportPath))}`
  );

  const inviteResult = await createOrResolveShareInvite({
    email,
    role,
    organizationId: brand.organizationId,
    invitedByUserId: session.appUser.id
  });

  if (!inviteResult.ok) {
    return Response.json({ error: inviteResult.error, message: inviteResult.message }, { status: inviteResult.status });
  }

  const emailResult = await sendShareEmailBestEffort({
    email,
    output,
    reportUrl,
    loginUrl,
    roleLabel
  });

  return Response.json(
    {
      data: {
        email,
        invitation_status: inviteResult.statusLabel,
        role,
        organization_id: brand.organizationId,
        organization_name: brand.organizationName ?? brand.organizationLegalName,
        report_url: reportUrl,
        login_url: loginUrl
      },
      email_sent: emailResult.ok,
      email_error: emailResult.ok ? null : emailResult.error
    },
    { status: inviteResult.created ? 201 : 200 }
  );
}

async function createOrResolveShareInvite(args: {
  email: string;
  role: "client_viewer";
  organizationId: string;
  invitedByUserId: string;
}): Promise<
  | { ok: true; created: boolean; statusLabel: "invited" | "already_invited" | "already_member" }
  | { ok: false; status: number; error: string; message: string }
> {
  const [existingUser] = await db
    .select({
      id: users.id,
      primaryRole: users.primaryRole,
      organizationId: users.organizationId,
      status: users.status
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, args.email))
    .limit(1);

  if (existingUser) {
    const role = normalizeRole(existingUser.primaryRole) ?? args.role;
    const userType = getUserType(role);
    if (existingUser.status === "suspended") {
      return { ok: false, status: 409, error: "user_suspended", message: "Ese usuario está suspendido." };
    }
    if (userType === "client" && !existingUser.organizationId) {
      await db
        .update(users)
        .set({ primaryRole: role, organizationId: args.organizationId })
        .where(eq(users.id, existingUser.id));
      await syncClientBrandAccessForOrganization({
        userId: existingUser.id,
        role,
        organizationId: args.organizationId
      });
      return { ok: true, created: false, statusLabel: "already_member" };
    }
    if (userType === "client" && existingUser.organizationId !== args.organizationId) {
      return {
        ok: false,
        status: 409,
        error: "different_organization",
        message: "Ese correo ya pertenece a otra organización en Noisia."
      };
    }

    await syncClientBrandAccessForOrganization({
      userId: existingUser.id,
      role,
      organizationId: userType === "client" ? existingUser.organizationId : args.organizationId
    });
    return { ok: true, created: false, statusLabel: "already_member" };
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await db
      .insert(invitations)
      .values({
        email: args.email,
        primaryRole: args.role,
        organizationId: args.organizationId,
        status: "pending",
        token,
        invitedByUserId: args.invitedByUserId,
        expiresAt
      });
    return { ok: true, created: true, statusLabel: "invited" };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const [pending] = await db
      .select({
        id: invitations.id,
        primaryRole: invitations.primaryRole,
        organizationId: invitations.organizationId
      })
      .from(invitations)
      .where(
        and(
          eq(sql`lower(${invitations.email})`, args.email),
          eq(invitations.status, "pending"),
          sql`(${invitations.expiresAt} IS NULL OR ${invitations.expiresAt} > now())`
        )
      )
      .limit(1);

    if (pending?.organizationId === args.organizationId && normalizeRole(pending.primaryRole) === args.role) {
      return { ok: true, created: false, statusLabel: "already_invited" };
    }

    const pendingRole = normalizeRole(pending?.primaryRole);
    if (pending?.id && pendingRole && getUserType(pendingRole) === "client") {
      await db
        .update(invitations)
        .set({
          primaryRole: args.role,
          organizationId: args.organizationId,
          token: randomBytes(24).toString("hex"),
          invitedByUserId: args.invitedByUserId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
          updatedAt: new Date()
        })
        .where(eq(invitations.id, pending.id));
      return { ok: true, created: false, statusLabel: "already_invited" };
    }

    return {
      ok: false,
      status: 409,
      error: "already_invited_elsewhere",
      message: "Ya existe una invitación pendiente para ese correo."
    };
  }
}

async function sendShareEmailBestEffort(args: {
  email: string;
  output: NonNullable<Awaited<ReturnType<typeof getSignalOutputForUser>>>;
  reportUrl: string;
  loginUrl: string;
  roleLabel: string;
}) {
  try {
    const vm = adaptTbSignalPayload(args.output.payload);
    const brandLabel = args.output.brandName ?? args.output.brandFallbackName ?? vm.report.brand_name;
    const methodologyName = args.output.methodologyName ?? vm.report.methodology_name;
    const reportTitle = args.output.headline ?? args.output.title ?? vm.report.headline;
    const executiveRead = truncate(
      vm.knowledgeImpact?.business_question_answer || vm.report.summary || args.output.summary || "El reporte ya está disponible para revisión.",
      520
    );
    const highlights = vm.findings
      .slice()
      .sort((a, b) => b.composite_score - a.composite_score)
      .slice(0, 4)
      .map((finding) => finding.finding_name)
      .filter(Boolean);
    const opportunities = vm.strategicOpportunities
      .slice(0, 3)
      .map((opportunity) => opportunity.title || opportunity.what_to_do)
      .filter(Boolean);

    const { html, text } = renderSignalShareEmail({
      brandLabel,
      methodologyName,
      reportTitle,
      businessQuestion: vm.report.business_question,
      executiveRead,
      highlights,
      opportunities,
      reportUrl: args.reportUrl,
      loginUrl: args.loginUrl,
      roleLabel: args.roleLabel
    });

    return sendEmail({
      to: args.email,
      subject: `${brandLabel}: reporte Noisia listo para revisar`,
      html,
      text
    });
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "No pudimos preparar el correo del reporte."
    };
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function truncate(value: string, max: number) {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
