import { loadSignalWorkspaceModuleContext } from "@/app/api/data-os/_lib/load";
import {
  signalServingScopeIdentityHashV1,
  signalTopicsNarrativesOverviewContentHashV1
} from "@noisia/query-engine";
import { after } from "next/server";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTopicsNarrativesOverviewV1,
  signalTaxonomyComparisonRangeV1
} from "@/lib/data-os/signal-topics-narratives-serving";
import { scheduleSignalTopicsNarrativesShadowV1 } from "@/lib/data-os/signal-operational-module-shadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const routeStarted = performance.now();
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "topics-narratives", request);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const filter = parseSignalApiFilterV1(
      searchParams,
      loaded.workspace.timezone
    );
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const comparisonRange = signalTaxonomyComparisonRangeV1(searchParams);
    const payload = await loadSignalTopicsNarrativesOverviewV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      comparisonRange,
      isInternalUser: loaded.isInternalUser
    });
    const shadow = await scheduleSignalTopicsNarrativesShadowV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      servingScope: loaded.servingScope,
      filter,
      requester: loaded.session.appUser,
      comparisonRange
    }, after);
    const response = signalJsonResponse(request, servingScope
      ? { ...payload, serving_scope: servingScope }
      : payload, {
      etagSeed: `${servingScope ? signalServingScopeIdentityHashV1(servingScope) : "legacy"}:${signalTopicsNarrativesOverviewContentHashV1(payload)}`,
      state: payload.state
    });
    response.headers.set(
      "Server-Timing",
      `signal-visible;dur=${Math.round(performance.now() - routeStarted)}, `
        + `signal-shadow-outbox;dur=${shadow.outbox_duration_ms}`
        + (shadow.persistence_state === "failed" ? ';desc="persistence_failed"' : "")
    );
    return response;
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
