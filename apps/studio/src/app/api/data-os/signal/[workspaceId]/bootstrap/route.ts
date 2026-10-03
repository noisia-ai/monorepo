import { loadSignalWorkspaceModuleContext } from "../../../_lib/load";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  loadSignalBootstrapV1,
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
    const payload = await loadSignalBootstrapV1(
      loaded.workspace,
      loaded.isInternalUser,
      loaded.readScope
    );
    const filter = payload.coverage.date_from && payload.coverage.date_through
      ? {
          contract_version: "signal-backend-v1" as const,
          date_range: {
            start: payload.coverage.date_from,
            end: payload.coverage.date_through
          },
          timezone: loaded.workspace.timezone,
          granularity: "day" as const,
          dimensions: {}
        }
      : null;
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const etagSeed = JSON.stringify([payload.data_freshness, payload.metric_groups]);
    return signalJsonResponse(request, servingScope
      ? { ...payload, serving_scope: servingScope }
      : payload, {
      etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
