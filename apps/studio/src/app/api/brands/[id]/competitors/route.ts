import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { reconcileSignalBrandOsForBrandMutationV1 } from "@/lib/data-os/signal-governance-control-plane";
import { createOrReactivateSignalCompetitorsV1,retireSignalCompetitorsV1 } from "@/lib/data-os/signal-competitor-lifecycle";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();
  if (session.appUser.userType!=="noisia_internal") return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const names = uniqueStrings(Array.isArray(body?.competitors) ? body.competitors : []);

  if (names.length === 0) {
    return Response.json(
      { error: "validation_error", message: "Agrega al menos un competidor." },
      { status: 422 }
    );
  }

  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  if(idempotencyKey.length<8||idempotencyKey.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  const result=await createOrReactivateSignalCompetitorsV1({brandId:brand.id,actor:session.appUser,
    idempotencyKey,names,vertical:brand.industry,subVertical:brand.industrySub,
    country:brand.countries?.[0]??"MX"});

  if (session.appUser.userType === "noisia_internal") {
    await reconcileSignalBrandOsForBrandMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      idempotencyKey: `${idempotencyKey}:brand-os`
    });
  }

  return Response.json({ data: result }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();
  if (session.appUser.userType!=="noisia_internal") return forbidden();

  const { id } = await context.params;
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
    idempotencyKey,competitorIds:null,evidence:"Brand OS bulk retirement"});

  if (session.appUser.userType === "noisia_internal") {
    await reconcileSignalBrandOsForBrandMutationV1({
      brandId: brand.id,
      actor: session.appUser,
      idempotencyKey: `${idempotencyKey}:brand-os`
    });
  }

  return Response.json({ data: retired });
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().replace(/\s+/g, " ").slice(0, 240))
        .filter((value) => value.length >= 2 && value.length <= 240)
    )
  ).slice(0, 40);
}
