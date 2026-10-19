import { loadSignalWorkspaceModuleContext } from "../../../_lib/load";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  loadSignalLineageV1,
  parseSignalApiFilterV1,
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
    const searchParams = new URL(request.url).searchParams;
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const payload = await loadSignalLineageV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      metricKey: searchParams.get("metric_key"),
      isInternalUser: loaded.isInternalUser
    });
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const etagSeed = `${payload.filters_hash}:${JSON.stringify(payload.materializations)}`;
    return signalJsonResponse(request, servingScope
      ? { ...payload, serving_scope: servingScope }
      : payload, {
      etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
      state: payload.materializations.some((item) => item.state === "stale") ? "stale" : "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
