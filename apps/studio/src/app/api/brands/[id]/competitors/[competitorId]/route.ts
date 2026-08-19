import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { reconcileSignalBrandOsForBrandMutationV1 } from "@/lib/data-os/signal-governance-control-plane";
import { retireSignalCompetitorsV1 } from "@/lib/data-os/signal-competitor-lifecycle";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; competitorId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();
  if(session.appUser.userType!=="noisia_internal")return forbidden();

  const { id, competitorId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  if(idempotencyKey.length<8||idempotencyKey.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  const retired=await retireSignalCompetitorsV1({brandId:brand.id,actor:session.appUser,
    idempotencyKey,competitorIds:[competitorId],evidence:"Brand OS competitor retirement"});
  if(retired.retired_count===0)return Response.json({error:"not_found",message:"Competitor not found for this brand."},{status:404});

  if (session.appUser.userType === "noisia_internal") {
    await reconcileSignalBrandOsForBrandMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      idempotencyKey: `${idempotencyKey}:brand-os`
    });
  }

  return Response.json({ data: retired });
}
