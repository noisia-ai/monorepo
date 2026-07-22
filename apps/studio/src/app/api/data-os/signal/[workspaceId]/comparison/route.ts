import { SignalBackendContractError } from "@noisia/query-engine";

import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  loadSignalComparisonV1,
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
    const comparisonStart = searchParams.get("comparison_start")?.trim();
    const comparisonEnd = searchParams.get("comparison_end")?.trim();
    if (!metricKey || !comparisonStart || !comparisonEnd) {
      throw new SignalBackendContractError("invalid_filter", "metric_key, comparison_start and comparison_end are required.");
    }
    const metricVersion = Number(searchParams.get("metric_version") ?? "1");
    if (!Number.isInteger(metricVersion) || metricVersion < 1) {
      throw new SignalBackendContractError("invalid_filter", "metric_version must be a positive integer.", { field: "metric_version" });
    }
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const result = await loadSignalComparisonV1({
      workspace: loaded.workspace,
      filter,
      comparisonRange: { start: comparisonStart, end: comparisonEnd },
      metricKey,
      metricVersion,
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
