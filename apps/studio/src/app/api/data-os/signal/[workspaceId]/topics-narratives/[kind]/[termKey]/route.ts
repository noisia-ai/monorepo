import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyTermDetailV1,
  signalTaxonomyComparisonRangeV1,
  signalTaxonomyKindV1
} from "@/lib/data-os/signal-topics-narratives-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      kind: string;
      termKey: string;
    }>;
  }
) {
  const { workspaceId, kind, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const payload = await loadSignalTaxonomyTermDetailV1({
      workspace: loaded.workspace,
      filter: parseSignalApiFilterV1(
        searchParams,
        loaded.workspace.timezone
      ),
      comparisonRange: signalTaxonomyComparisonRangeV1(searchParams),
      kind: signalTaxonomyKindV1(kind),
      termKey,
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.filters_hash,
        payload.term.mention_count,
        payload.term.comparison_mention_count,
        payload.series
      ]),
      state: payload.state
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
