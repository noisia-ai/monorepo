import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  loadSignalTriggersBarriersOverviewV2
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
    const studyCorpusId = legacyStudy && legacyStudy !== "triggers-barriers"
      ? legacyStudy
      : undefined;
    const payload = await loadSignalTriggersBarriersOverviewV2({
      workspace: loaded.workspace,
      studyCorpusId,
      dateFrom: searchParams.get("start"),
      dateTo: searchParams.get("end"),
      preferredFindingId: searchParams.get("finding")
    });
    if (!payload) return notAvailable();
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.cut.analysis_id,
        payload.cut.snapshot_id,
        payload.filter.date_range,
        payload.initial_finding?.finding_id,
        payload.findings.map((finding) => [finding.finding_id, finding.frequency_mentions])
      ]),
      state: "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

function notAvailable() {
  return Response.json({
    error: "not_available",
    message: "No current Triggers & Barriers release is available for this workspace report."
  }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
