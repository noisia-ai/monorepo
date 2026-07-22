import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  loadSignalBootstrapV1,
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
    const payload = await loadSignalBootstrapV1(loaded.workspace, loaded.isInternalUser);
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([payload.data_freshness, payload.metric_groups]),
      state: payload.data_freshness.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
