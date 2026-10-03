import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  loadSignalTriggersBarriersCutV2,
  loadSignalTriggersBarriersFindingV2
} from "@/lib/data-os/signal-triggers-barriers-serving";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; findingId: string }> }
) {
  const { workspaceId, findingId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const legacyStudy = searchParams.get("study")?.trim();
    const studyCorpusId = legacyStudy && legacyStudy !== "triggers-barriers"
      ? legacyStudy
      : undefined;
    const cut = await loadSignalTriggersBarriersCutV2({
      workspace: loaded.workspace,
      studyCorpusId
    });
    if (!cut) return notAvailable("cut");
    const payload = await loadSignalTriggersBarriersFindingV2({
      cut,
      findingId,
      dateFrom: searchParams.get("start"),
      dateTo: searchParams.get("end")
    });
    if (!payload) return notAvailable("finding");
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        cut.analysis_id,
        findingId,
        searchParams.get("start"),
        searchParams.get("end"),
        payload.frequency_mentions,
        payload.evidence_count,
        payload.platforms,
        payload.actions.map((action) => [action.action_id, action.priority_rank])
      ]),
      state: "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

function notAvailable(scope: "cut" | "finding") {
  return Response.json({
    error: "not_available",
    message: scope === "cut"
      ? "No current Triggers & Barriers release is available for this workspace report."
      : "The requested finding is not part of this published cut."
  }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
