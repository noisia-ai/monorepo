import { SignalBackendContractError, canonicalSignalDimension } from "@noisia/query-engine";

import { loadSignalWorkspaceContext } from "../../../_lib/load";
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
  const loaded = await loadSignalWorkspaceContext(workspaceId);
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
      filter,
      metricKey,
      metricVersion,
      dimension,
      isInternalUser: loaded.isInternalUser
    });
    return signalMaterializationResultResponse(
      request,
      requireFreshSignalResult(result, searchParams.get("require_fresh") === "true")
    );
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
