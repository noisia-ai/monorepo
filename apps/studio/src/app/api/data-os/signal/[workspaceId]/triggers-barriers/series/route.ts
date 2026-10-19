import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  loadSignalTriggersBarriersCutV2,
  loadSignalTriggersBarriersSeriesV2
} from "@/lib/data-os/signal-triggers-barriers-serving";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const legacyStudy = searchParams.get("study")?.trim();
    const cut = await loadSignalTriggersBarriersCutV2({
      workspace: loaded.workspace,
      studyCorpusId: legacyStudy && legacyStudy !== "triggers-barriers"
        ? legacyStudy
        : undefined
    });
    if (!cut) return Response.json({
      error: "not_available",
      message: "No current Triggers & Barriers release is available for this workspace report."
    }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const findingId = searchParams.get("finding")?.trim() || null;
    const payload = await loadSignalTriggersBarriersSeriesV2({
      cut,
      findingId,
      dateFrom: searchParams.get("start"),
      dateTo: searchParams.get("end")
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        cut.analysis_id,
        findingId,
        searchParams.get("start"),
        searchParams.get("end"),
        payload.records
      ]),
      state: payload.records.length > 0 ? "fresh" : "not_available"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
