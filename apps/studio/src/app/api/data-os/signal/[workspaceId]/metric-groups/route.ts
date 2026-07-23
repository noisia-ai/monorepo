import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  loadSignalMetricGroupsV1,
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
    const filter = parseSignalApiFilterV1(new URL(request.url).searchParams, loaded.workspace.timezone);
    const payload = await loadSignalMetricGroupsV1({
      workspace: loaded.workspace,
      filter,
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: `${payload.filters_hash}:${JSON.stringify(payload.groups)}`,
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
