import { loadSignalWorkspaceModuleContext } from "../../_lib/load";
import { loadSignalWorkspaceHomeV1 } from "@/lib/data-os/signal-workspace-home";
import {
  finalizeSignalModuleServingScopeV1,
  resolveSignalModuleServingScopeV1
} from "@/lib/data-os/signal-module-serving-scope";
import { signalServingScopeIdentityHashV1 } from "@noisia/query-engine";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "brand-monitoring", request);
  if ("response" in loaded) return loaded.response;
  try {
    const topicsNarrativesScope = await resolveSignalModuleServingScopeV1(
      loaded.workspace,
      "topics-narratives",
      { viewKey: loaded.servingScope.view_key }
    );
    const payload = await loadSignalWorkspaceHomeV1(
      loaded.workspace,
      loaded.isInternalUser,
      loaded.readScope,
      { topicsNarrativesReadScope: topicsNarrativesScope.readScope }
    );
    const servingScopes = payload.default_filter
      && loaded.servingScope.rollout_mode === "governed"
      ? {
          brand_monitoring: await loaded.finalizeServingScope(payload.default_filter),
          topics_narratives: await finalizeSignalModuleServingScopeV1({
            scope: topicsNarrativesScope,
            filter: payload.default_filter
          })
        }
      : null;
    return signalJsonResponse(request, servingScopes
      ? { ...payload, serving_scopes: servingScopes }
      : payload, {
      etagSeed: JSON.stringify([
        servingScopes
          ? Object.values(servingScopes).map(signalServingScopeIdentityHashV1)
          : null,
        payload.filters_hash,
        payload.state,
        payload.metric_groups,
        payload.topics_narratives,
        payload.strategic.current
      ]),
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
