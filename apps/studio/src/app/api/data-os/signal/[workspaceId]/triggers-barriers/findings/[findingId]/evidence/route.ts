import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  loadSignalTriggersBarriersCutV2,
  loadSignalTriggersBarriersEvidenceV2,
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
    const cut = await loadSignalTriggersBarriersCutV2({
      workspace: loaded.workspace,
      studyCorpusId: legacyStudy && legacyStudy !== "triggers-barriers"
        ? legacyStudy
        : undefined
    });
    if (!cut) return notAvailable();
    const finding = await loadSignalTriggersBarriersFindingV2({
      cut,
      findingId,
      dateFrom: searchParams.get("start"),
      dateTo: searchParams.get("end")
    });
    if (!finding) return notAvailable();
    const payload = await loadSignalTriggersBarriersEvidenceV2({
      cut,
      findingId,
      cursor: searchParams.get("cursor"),
      dateFrom: searchParams.get("start"),
      dateTo: searchParams.get("end"),
      limit: Number(searchParams.get("limit") ?? "20")
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        cut.analysis_id,
        findingId,
        searchParams.get("start"),
        searchParams.get("end"),
        payload.page.next_cursor,
        payload.records.map((record) => record.mention_id)
      ]),
      state: payload.page.next_cursor ? "partial" : "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

function notAvailable() {
  return Response.json({
    error: "not_available",
    message: "The requested finding is not part of this published cut."
  }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
