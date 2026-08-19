import { SignalBackendContractError, canonicalSignalDimension } from "@noisia/query-engine";

import { loadSignalWorkspaceModuleContext } from "../../../_lib/load";
import {
  loadSignalBreakdownV1,
  parseSignalApiFilterV1,
  requireFreshSignalResult,
  signalBackendErrorResponse,
  signalMaterializationResultResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "brand-monitoring", request);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const metricKey = searchParams.get("metric_key")?.trim();
    if (!metricKey) throw new SignalBackendContractError("invalid_filter", "metric_key is required.", { field: "metric_key" });
    const metricVersion = Number(searchParams.get("metric_version") ?? "1");
    if (!Number.isInteger(metricVersion) || metricVersion < 1) {
      throw new SignalBackendContractError("invalid_filter", "metric_version must be a positive integer.", { field: "metric_version" });
    }
    const dimension = canonicalSignalDimension(searchParams.get("dimension") ?? searchParams.get("breakdown_dimension"));
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const result = await loadSignalBreakdownV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      filter,
      metricKey,
      metricVersion,
      dimension,
      isInternalUser: loaded.isInternalUser
    });
    const responseResult = requireFreshSignalResult(
      result,
      searchParams.get("require_fresh") === "true"
    );
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      && responseResult.status !== "missing"
      ? await loaded.finalizeServingScope(filter)
      : null;
    return signalMaterializationResultResponse(
      request,
      responseResult,
      { servingScope }
    );
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
