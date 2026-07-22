import { SignalBackendContractError } from "@noisia/query-engine";

import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  loadSignalSeriesV1,
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
    const metricKey = requiredMetricKey(searchParams);
    const metricVersion = metricVersionParam(searchParams);
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const result = await loadSignalSeriesV1({
      workspace: loaded.workspace,
      filter,
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

function requiredMetricKey(searchParams: URLSearchParams) {
  const value = searchParams.get("metric_key")?.trim();
  if (!value) throw new SignalBackendContractError("invalid_filter", "metric_key is required.", { field: "metric_key" });
  return value;
}

function metricVersionParam(searchParams: URLSearchParams) {
  const value = Number(searchParams.get("metric_version") ?? "1");
  if (!Number.isInteger(value) || value < 1) {
    throw new SignalBackendContractError("invalid_filter", "metric_version must be a positive integer.", { field: "metric_version" });
  }
  return value;
}
