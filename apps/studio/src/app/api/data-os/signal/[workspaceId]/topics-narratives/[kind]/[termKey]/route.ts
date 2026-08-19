import { loadSignalWorkspaceModuleContext } from "@/app/api/data-os/_lib/load";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyTermDetailV1,
  signalTaxonomyComparisonRangeV1,
  signalTaxonomyKindV1
} from "@/lib/data-os/signal-topics-narratives-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      kind: string;
      termKey: string;
    }>;
  }
) {
  const routeStarted = performance.now();
  const { workspaceId, kind, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "topics-narratives", request);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const filter = parseSignalApiFilterV1(
      searchParams,
      loaded.workspace.timezone
    );
    const payload = await loadSignalTaxonomyTermDetailV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      comparisonRange: signalTaxonomyComparisonRangeV1(searchParams),
      kind: signalTaxonomyKindV1(kind),
      termKey,
      isInternalUser: loaded.isInternalUser
    });
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const etagSeed = JSON.stringify([
        payload.filters_hash,
        payload.term.mention_count,
        payload.term.comparison_mention_count,
        payload.series
      ]);
    const response = signalJsonResponse(request, servingScope
      ? { ...payload, serving_scope: servingScope }
      : payload, {
      etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
      state: payload.state
    });
    response.headers.set(
      "Server-Timing",
      `signal-visible;dur=${Math.round(performance.now() - routeStarted)}`
    );
    return response;
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
