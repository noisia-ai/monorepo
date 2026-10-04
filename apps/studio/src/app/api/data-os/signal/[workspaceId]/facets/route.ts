import { loadSignalWorkspaceContextForTopics } from "../topics/_lib";
import {
  loadMentionFacetsStatusForActorV1,
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
  if (new URL(request.url).searchParams.get("view") !== "labeling")
    return getServingFacets(request, context);
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  try {
    return Response.json(
      await loadMentionFacetsStatusForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
      }),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
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
