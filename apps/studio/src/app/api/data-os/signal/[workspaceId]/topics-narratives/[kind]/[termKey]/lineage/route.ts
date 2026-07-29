import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse,
  signalWorstResponseStateV1
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyLineageV1,
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
    const payload = await loadSignalTaxonomyLineageV1({
      workspace: loaded.workspace,
      filter: parseSignalApiFilterV1(
        new URL(request.url).searchParams,
        loaded.workspace.timezone
      ),
      kind: signalTaxonomyKindV1(kind),
      termKey,
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.filters_hash,
        payload.materializations,
        payload.source_summary
      ]),
      state: signalWorstResponseStateV1(
        payload.materializations.map((item) => item.state)
      )
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
