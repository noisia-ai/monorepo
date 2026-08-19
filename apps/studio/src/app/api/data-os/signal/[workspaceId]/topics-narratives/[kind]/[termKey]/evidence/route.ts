import { loadSignalWorkspaceModuleContext } from "@/app/api/data-os/_lib/load";
import {
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyEvidenceV1,
  signalTaxonomyEvidenceServingTokensV1,
  signalTaxonomyKindV1
} from "@/lib/data-os/signal-topics-narratives-serving";
import {
  resolveSignalClientEvidenceServingScopeV1
} from "@/lib/data-os/signal-module-serving-scope";

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
  const routeStarted = performance.now();
  const { workspaceId, kind, termKey } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "topics-narratives", request);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const filter = parseSignalApiFilterV1(
      searchParams,
      loaded.workspace.timezone
    );
    const governed = loaded.servingScope.rollout_mode === "governed";
    const servingScope = governed
      ? await loaded.finalizeServingScope(filter)
      : null;
    const evidence = governed
      ? await resolveSignalClientEvidenceServingScopeV1({
          workspace: loaded.workspace,
          filter,
          viewKey: loaded.servingScope.view_key
        })
      : null;
    const evidenceServingScope = evidence?.servingScope ?? null;
    const taxonomyKind = signalTaxonomyKindV1(kind);
    const payload = await loadSignalTaxonomyEvidenceV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      ...(governed
        ? {
            evidenceReadScope: evidence?.readScope ?? null,
            evidenceServingScope
          }
        : {}),
      ...(servingScope ? { servingScope } : {}),
      filter,
      kind: taxonomyKind,
      termKey,
      cursor: searchParams.get("cursor"),
      limit: Number(searchParams.get("limit") ?? "50"),
      isInternalUser: loaded.isInternalUser
    });
    const servingTokens = servingScope
      ? signalTaxonomyEvidenceServingTokensV1({
          servingScope,
          evidenceServingScope,
          filter,
          kind: taxonomyKind,
          termKey
        })
      : null;
    const response = signalJsonResponse(request, servingScope
      ? {
          ...payload,
          serving_scope: servingScope,
          evidence_serving_scope: evidenceServingScope
        }
      : payload, {
      etagSeed: `${servingTokens?.etag_seed ?? "legacy"}:${JSON.stringify([
        payload.filters_hash,
        payload.page.next_cursor,
        payload.records.map((record) => record.mention_id),
        payload.evidence_access ?? null
      ])}`,
      state: "partial"
    });
    response.headers.set(
      "Server-Timing",
      `signal-visible;dur=${Math.round(performance.now() - routeStarted)}`
    );
    return response;
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
