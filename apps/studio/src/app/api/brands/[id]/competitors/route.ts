import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { clientBrandCreationDecisionV1 } from "@/lib/auth/client-brand-self-service";
import { loadClientBrandContextAccessV1 } from "@/lib/auth/client-brand-self-service-server";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { refreshAutomaticBrandContextKnowledgeV1 } from "@/lib/data-os/brand-automatic-knowledge-server";
import { reconcileAndEnsureBrandContextAfterCommittedMutationV1 } from "@/lib/data-os/signal-brand-context-preparation";
import { createOrReactivateSignalCompetitorsV1,retireSignalCompetitorsV1 } from "@/lib/data-os/signal-competitor-lifecycle";
import { brandContextPreparationIntentSchema } from "@/lib/validation/brand";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  const internal = canCreateBrandOrTheme(session.appUser.primaryRole);
  const client = clientBrandCreationDecisionV1(session.appUser);
  if (!internal && !client.allowed) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }
  if (client.allowed && !await loadClientBrandContextAccessV1(session.appUser, brand.id)) {
    return Response.json({ error: "not_found", message: "Brand not found or not accessible." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  const names = uniqueStrings(Array.isArray(body?.competitors) ? body.competitors : []);

  if (names.length === 0) {
    return Response.json(
      { error: "validation_error", message: "Agrega al menos un competidor." },
      { status: 422 }
    );
  }

  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  if(idempotencyKey.length<8||idempotencyKey.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  if(parsedPreparation.data&&parsedPreparation.data.idempotency_key!==idempotencyKey)
    return Response.json({error:"idempotency_key_mismatch"},{status:422});
  const result=await createOrReactivateSignalCompetitorsV1({brandId:brand.id,actor:session.appUser,
    idempotencyKey,names,vertical:brand.industry,subVertical:brand.industrySub,
    country:brand.countries?.[0]??"MX"});

  const preparation = await prepareAfterCompetitorMutation({ brandId: brand.id,
    actor: session.appUser, preparation: client.allowed ? { idempotency_key: idempotencyKey } : parsedPreparation.data, idempotencyKey });

  return Response.json({ data: result, brand_context_preparation: preparation }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  const internal = canCreateBrandOrTheme(session.appUser.primaryRole);
  const client = clientBrandCreationDecisionV1(session.appUser);
  if (!internal && !client.allowed) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }
  if (client.allowed && !await loadClientBrandContextAccessV1(session.appUser, brand.id)) {
    return Response.json({ error: "not_found", message: "Brand not found or not accessible." }, { status: 404 });
  }

  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  if(idempotencyKey.length<8||idempotencyKey.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  const body = await request.json().catch(() => ({}));
  const parsedPreparation = brandContextPreparationIntentSchema.optional().safeParse(body?.preparation);
  if (!parsedPreparation.success) return validationError(parsedPreparation.error);
  if(parsedPreparation.data&&parsedPreparation.data.idempotency_key!==idempotencyKey)
    return Response.json({error:"idempotency_key_mismatch"},{status:422});
  const retired=await retireSignalCompetitorsV1({brandId:brand.id,actor:session.appUser,
    idempotencyKey,competitorIds:null,evidence:"Brand OS bulk retirement"});

  const preparation = await prepareAfterCompetitorMutation({ brandId: brand.id,
    actor: session.appUser, preparation: client.allowed ? { idempotency_key: idempotencyKey } : parsedPreparation.data, idempotencyKey });

  return Response.json({ data: retired, brand_context_preparation: preparation });
}

async function prepareAfterCompetitorMutation(args: {
  brandId: string; actor: Parameters<typeof reconcileAndEnsureBrandContextAfterCommittedMutationV1>[0]["actor"];
  preparation: Parameters<typeof reconcileAndEnsureBrandContextAfterCommittedMutationV1>[0]["preparation"];
  idempotencyKey: string;
}) {
  try {
    await refreshAutomaticBrandContextKnowledgeV1(args.brandId);
  } catch {
    return { preparation: null, advancement: [], error_code: "brand_context_knowledge_refresh_unavailable" };
  }
  return reconcileAndEnsureBrandContextAfterCommittedMutationV1({
    brandId: args.brandId, actor: args.actor, preparation: args.preparation,
    fallbackIdempotencyKey: `${args.idempotencyKey}:prepare`,
    reconciliationIdempotencyKey: `${args.idempotencyKey}:brand-os`
  });
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
