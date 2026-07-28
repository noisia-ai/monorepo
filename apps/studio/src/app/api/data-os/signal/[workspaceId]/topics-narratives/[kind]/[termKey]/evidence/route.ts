import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyEvidenceV1,
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
    const payload = await loadSignalTaxonomyEvidenceV1({
      workspace: loaded.workspace,
      filter: parseSignalApiFilterV1(
        searchParams,
        loaded.workspace.timezone
      ),
      kind: signalTaxonomyKindV1(kind),
      termKey,
      cursor: searchParams.get("cursor"),
      limit: Number(searchParams.get("limit") ?? "50"),
      isInternalUser: loaded.isInternalUser
    });
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify([
        payload.filters_hash,
        payload.page.next_cursor,
        payload.records.map((record) => record.mention_id)
      ]),
      state: "partial"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
