import {
  loadSignalTbStrategicRunStatus,
  requestSignalTbStrategicRunCancel
} from "@/lib/data-os/signal-strategic-consumption";
import { signalBackendErrorResponse } from "@/lib/data-os/signal-workspace-serving";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; analysisId: string }> }
) {
  const { workspaceId, analysisId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const status = await loadSignalTbStrategicRunStatus({
      workspaceId: loaded.workspace.id,
      analysisId
    });
    if (!status) return Response.json({ error: "strategic_run_not_found" }, {
      status: 404, headers: { "Cache-Control": "private, no-store" }
    });
    return Response.json({
      contract_version: "signal-strategic-run-status-v1",
      ...status
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; analysisId: string }> }
) {
  const { workspaceId, analysisId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const status = await requestSignalTbStrategicRunCancel({
      workspaceId: loaded.workspace.id,
      analysisId,
      actorUserId: loaded.session.appUser.id
    });
    return Response.json({
      contract_version: "signal-strategic-run-status-v1",
      status: status ?? "cancel_requested"
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if ((error as { code?: string }).code === "42501") {
      return Response.json({ error: "strategic_run_not_found" }, {
        status: 404, headers: { "Cache-Control": "private, no-store" }
      });
    }
    return signalBackendErrorResponse(error);
  }
}
