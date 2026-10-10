import { loadSignalWorkspaceContextForTopics } from "../topics/_lib";
import {
  loadMentionFacetsAvailabilityV1,
  loadMentionFacetsStatusForActorV1,
  loadMentionFacetBrowserForActorV1,
  overrideMentionFacetsForActorV1,
  requestMentionFacetsForActorV1,
  confirmMentionFacetsForActorV1,
  SignalLabelingError,
} from "@/lib/data-os/signal-mention-facets";
import { z } from "zod";
import { loadSignalWorkspaceModuleContext } from "../../../_lib/load";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  loadSignalFacetsV1,
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse,
} from "@/lib/data-os/signal-workspace-serving";

async function getServingFacets(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(
    workspaceId,
    "brand-monitoring",
    request,
  );
  if ("response" in loaded) return loaded.response;
  try {
    const filter = parseSignalApiFilterV1(
      new URL(request.url).searchParams,
      loaded.workspace.timezone,
    );
    const payload = await loadSignalFacetsV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      isInternalUser: loaded.isInternalUser,
    });
    const servingScope =
      loaded.servingScope.rollout_mode === "governed"
        ? await loaded.finalizeServingScope(filter)
        : null;
    const etagSeed = `${payload.filters_hash}:${JSON.stringify(payload.facets)}`;
    return signalJsonResponse(
      request,
      servingScope ? { ...payload, serving_scope: servingScope } : payload,
      {
        etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
        state: "fresh",
      },
    );
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const requestSchema = z
  .object({
    idempotency_key: z.string(),
    budget_micro_usd: z.number().int().nonnegative().nullable().optional(),
    cap_micro_usd: z.number().int().nonnegative().nullable().optional(),
    full_recalculation: z.boolean().optional(),
  })
  .strict();
function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "facets_forbidden") return Response.json({error:"facets_forbidden"},{status:403,headers});
  return Response.json(
    {
      error:
        error instanceof SignalLabelingError
          ? error.code
          : "facets_unavailable",
    },
    {
      status: error instanceof SignalLabelingError ? error.status : 503,
      headers,
    },
  );
}
export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  if (!["labeling", "mentions"].includes(new URL(request.url).searchParams.get("view") ?? ""))
    return getServingFacets(request, context);
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  try {
    const query = new URL(request.url).searchParams;
    if (query.get("view") === "mentions") {
      const parsed = z.object({ dimension: z.enum(["status","relevance","entities","salience","voice","act","spam_or_bot","language","asunto"]).optional(),
        value:z.string().max(200).optional(),root_id:z.string().uuid().optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).optional()
      }).safeParse(Object.fromEntries([...query].filter(([key]) => key !== "view")));
      if (!parsed.success) return Response.json({error:"facets_filter_invalid"},{status:400,headers});
      return Response.json(await loadMentionFacetBrowserForActorV1({workspace_id:loaded.workspace.id,
        actor_user_id:loaded.session.appUser.id,...parsed.data}, request.signal),{headers});
    }
    const status = await loadMentionFacetsStatusForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
      }, request.signal);
    const availability = await loadMentionFacetsAvailabilityV1(loaded.workspace.id);
    return Response.json({...status, ...availability}, {headers});
  } catch (error) { return errorResponse(error); }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  const raw = await request.json().catch(() => null);
  const confirmation = z
    .object({
      confirm_run_id: z.string().uuid(),
      entity_context_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    })
    .strict()
    .safeParse(raw);
  if (confirmation.success) {
    try {
      return Response.json(
        await confirmMentionFacetsForActorV1({
          workspace_id: loaded.workspace.id,
          actor_user_id: loaded.session.appUser.id,
          run_id: confirmation.data.confirm_run_id,
          entity_context_digest: confirmation.data.entity_context_digest,
        }),
        { headers },
      );
    } catch (error) {
      return errorResponse(error);
    }
  }
  const body = requestSchema.safeParse(raw);
  if (!body.success)
    return Response.json(
      { error: "facets_request_invalid" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await requestMentionFacetsForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
        ...body.data,
      }),
      { status: 202, headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: {params:Promise<{workspaceId:string}>}) {
  const loaded = await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
  if ("response" in loaded) return loaded.response;
  const body = z.object({overrides:z.array(z.object({root_id:z.string().uuid(),
    dimension:z.enum(["entities","unrelated_reason","voice","act","spam_or_bot","language","asunto"]),value:z.unknown()}).strict()).min(1).max(500)}).strict()
    .safeParse(await request.json().catch(()=>null));
  if (!body.success) return Response.json({error:"facets_override_invalid"},{status:400,headers});
  try { return Response.json(await overrideMentionFacetsForActorV1({workspace_id:loaded.workspace.id,
    actor_user_id:loaded.session.appUser.id,overrides:body.data.overrides.map(p=>({...p,value:p.value}))}),{headers}); }
  catch(error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "facets_forbidden") return Response.json({error:code},{status:403,headers});
    if (["facets_override_invalid","facets_override_contradiction","unknown_entity_id","entity_kind_mismatch","duplicate_entity_id","language_required"].includes(code)
      || error instanceof z.ZodError) return Response.json({error:"facets_override_invalid"},{status:422,headers});
    return errorResponse(error);
  }
}
