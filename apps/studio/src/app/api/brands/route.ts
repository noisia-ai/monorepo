import { canAccessStudio } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { listBrandsForUser } from "@/lib/data/brands";
import { createBrandForActorV1 } from "@/lib/data-os/brand-creation-service";

export async function GET(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    return forbidden();
  }

  const url = new URL(request.url);
  const result = await listBrandsForUser(session.appUser, {
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
  if (!session) return unauthorized();
  return createBrandForActorV1(request, session.appUser);
}
