import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { refreshAutomaticBrandContextKnowledgeV1 } from "@/lib/data-os/brand-automatic-knowledge-server";
import { reconcileAndEnsureBrandContextAfterCommittedMutationV1 } from "@/lib/data-os/signal-brand-context-preparation";
import { retireSignalCompetitorsV1 } from "@/lib/data-os/signal-competitor-lifecycle";
import { brandContextPreparationIntentSchema } from "@/lib/validation/brand";

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
  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  if(parsedPreparation.data&&parsedPreparation.data.idempotency_key!==idempotencyKey)
    return Response.json({error:"idempotency_key_mismatch"},{status:422});
  const retired=await retireSignalCompetitorsV1({brandId:brand.id,actor:session.appUser,
    idempotencyKey,competitorIds:[competitorId],evidence:"Brand OS competitor retirement"});
  if(retired.retired_count===0)return Response.json({error:"not_found",message:"Competitor not found for this brand."},{status:404});

  let preparation;
  try {
    await refreshAutomaticBrandContextKnowledgeV1(brand.id);
    preparation = await reconcileAndEnsureBrandContextAfterCommittedMutationV1({
      brandId: brand.id, actor: session.appUser, preparation: parsedPreparation.data,
      fallbackIdempotencyKey: `${idempotencyKey}:prepare`,
      reconciliationIdempotencyKey: `${idempotencyKey}:brand-os`
    });
  } catch {
    preparation = { preparation: null, advancement: [], error_code: "brand_context_knowledge_refresh_unavailable" };
  }

  return Response.json({ data: retired, brand_context_preparation: preparation });
}
