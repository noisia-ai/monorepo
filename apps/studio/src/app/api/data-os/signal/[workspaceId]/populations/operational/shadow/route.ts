import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { loadWorkspacePopulationShadowComparison } from "@/lib/data-os/signal-workspace-population";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const payload = await loadWorkspacePopulationShadowComparison(loaded.workspace);
  return Response.json(payload, {
    headers: { "Cache-Control": "private, no-store" }
  });
}
