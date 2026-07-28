import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTopicsNarrativesOverviewV1,
  signalTaxonomyComparisonRangeV1
} from "@/lib/data-os/signal-topics-narratives-serving";

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
    const filter = parseSignalApiFilterV1(
      searchParams,
      loaded.workspace.timezone
    );
    const payload = await loadSignalTopicsNarrativesOverviewV1({
      workspace: loaded.workspace,
      filter,
      comparisonRange: signalTaxonomyComparisonRangeV1(searchParams),
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.filters_hash,
        payload.comparison_filters_hash,
        payload.topics.data_watermark_hashes,
        payload.narratives.data_watermark_hashes,
        payload.profiles.map((profile) => [profile.kind, profile.version])
      ]),
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
