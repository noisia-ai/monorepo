import { loadSignalWorkspaceModuleContext } from "@/app/api/data-os/_lib/load";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse,
  signalWorstResponseStateV1
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyLineageV1,
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
    const filter = parseSignalApiFilterV1(
      new URL(request.url).searchParams,
      loaded.workspace.timezone
    );
    const payload = await loadSignalTaxonomyLineageV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      kind: signalTaxonomyKindV1(kind),
      termKey,
      isInternalUser: loaded.isInternalUser
    });
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const etagSeed = JSON.stringify([
        payload.filters_hash,
        payload.materializations,
        payload.source_summary
      ]);
    const response = signalJsonResponse(request, servingScope
      ? { ...payload, serving_scope: servingScope }
      : payload, {
      etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
      state: signalWorstResponseStateV1(
        payload.materializations.map((item) => item.state)
      )
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
