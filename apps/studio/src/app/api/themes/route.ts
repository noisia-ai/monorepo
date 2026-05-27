import { themes } from "@noisia/db";
import { db } from "@/lib/db";
import { canAccessStudio, canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { listThemesForUser } from "@/lib/data/themes";
import { createThemeSchema } from "@/lib/validation/brand";

export async function GET(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    return forbidden();
  }

  const url = new URL(request.url);
  const result = await listThemesForUser(session.appUser, {
    organization: url.searchParams.get("organization_id") ?? url.searchParams.get("organization") ?? undefined,
    industry: url.searchParams.get("industry") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 50)
  });

  return Response.json(result);
}

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) {
    return forbidden();
  }

  const parsed = createThemeSchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const [theme] = await db
    .insert(themes)
    .values({
      organizationId: parsed.data.organization_id,
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description,
      industryFocus: parsed.data.industry_focus,
      geoFocus: parsed.data.geo_focus,
      status: parsed.data.status,
      isPublic: parsed.data.is_public
    })
    .returning();

  return Response.json({ data: theme }, { status: 201 });
}
