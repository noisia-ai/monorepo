import {
  parseSignalAnalyticsQueryParamsV1,
  signalServingScopeIdentityHashV1
} from "@noisia/query-engine";
import { after } from "next/server";

import { loadSignalWorkspaceModuleContext } from "@/app/api/data-os/_lib/load";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import { loadSignalBrandMonitoringV1 } from "@/lib/signal-v2/brand-monitoring";
import { scheduleSignalBrandMonitoringShadowV1 } from "@/lib/data-os/signal-operational-module-shadow";
import {
  resolveSignalClientEvidenceServingScopeV1
} from "@/lib/data-os/signal-module-serving-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const routeStarted = performance.now();
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "brand-monitoring", request);
  if ("response" in loaded) return loaded.response;
  try {
    const params = new URL(request.url).searchParams;
    if (!params.has("timezone")) params.set("timezone", loaded.workspace.timezone);
    const { filter, comparison } = parseSignalAnalyticsQueryParamsV1(params);
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    const evidence = servingScope
      ? await resolveSignalClientEvidenceServingScopeV1({
          workspace: loaded.workspace,
          filter,
          viewKey: loaded.servingScope.view_key
        })
      : null;
    const evidenceServingScope = evidence?.servingScope ?? null;
    const payload = await loadSignalBrandMonitoringV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      ...(servingScope
        ? { evidenceReadScope: evidence?.readScope ?? null }
        : {}),
      filter,
      comparison,
      isInternalUser: loaded.isInternalUser
    });
    const shadow = await scheduleSignalBrandMonitoringShadowV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      servingScope: loaded.servingScope,
      filter,
      requester: loaded.session.appUser,
      comparison
    }, after);
    const responsePayload = servingScope
      ? {
          ...payload,
          serving_scope: servingScope,
          evidence_serving_scope: evidenceServingScope
        }
      : payload;
    const response = signalJsonResponse(request, responsePayload, {
      etagSeed: JSON.stringify([
        servingScope ? signalServingScopeIdentityHashV1(servingScope) : null,
        evidenceServingScope
          ? signalServingScopeIdentityHashV1(evidenceServingScope)
          : null,
        payload.filter,
        payload.volume,
        payload.sentiment,
        payload.platforms,
        payload.topics,
        payload.narratives,
        payload.freshness
      ]),
      state: payload.freshness.state
    });
    response.headers.set(
      "Server-Timing",
      `signal-visible;dur=${Math.round(performance.now() - routeStarted)}, `
        + `signal-shadow-outbox;dur=${shadow.outbox_duration_ms}`
        + (shadow.persistence_state === "failed" ? ';desc="persistence_failed"' : "")
    );
    return response;
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
