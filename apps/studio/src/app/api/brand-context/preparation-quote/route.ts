import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { quoteBrandContextPreparationForActorV1 } from "@/lib/data-os/signal-brand-context-preparation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();
  return Response.json(await quoteBrandContextPreparationForActorV1(session.appUser));
}
