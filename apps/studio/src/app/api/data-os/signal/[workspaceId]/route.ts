import { loadSignalWorkspaceContext } from "../../_lib/load";
import { loadSignalWorkspaceHomeV1 } from "@/lib/data-os/signal-workspace-home";
import {
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
    const payload = await loadSignalWorkspaceHomeV1(
      loaded.workspace,
      loaded.isInternalUser
    );
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.filters_hash,
        payload.state,
        payload.metric_groups,
        payload.strategic.current
      ]),
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
