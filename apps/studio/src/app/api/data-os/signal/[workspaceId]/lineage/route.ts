import { loadSignalWorkspaceContext } from "../../../_lib/load";
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
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const payload = await loadSignalLineageV1({
      workspace: loaded.workspace,
      filter,
      metricKey: searchParams.get("metric_key"),
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: `${payload.filters_hash}:${JSON.stringify(payload.materializations)}`,
      state: payload.materializations.some((item) => item.state === "stale") ? "stale" : "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
