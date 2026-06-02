import { organizations } from "@noisia/db";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createOrganizationSchema } from "@/lib/validation/team";

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const parsed = createOrganizationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const [created] = await db
      .insert(organizations)
      .values({
        slug: parsed.data.slug,
        legalName: parsed.data.legal_name,
        displayName: emptyToNull(parsed.data.display_name),
        hqCountry: parsed.data.hq_country,
        industryPrimary: emptyToNull(parsed.data.industry_primary),
        isHolding: false,
        status: parsed.data.status,
        notes: emptyToNull(parsed.data.notes)
      })
      .returning();

    return Response.json({ data: created }, { status: 201 });
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

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
