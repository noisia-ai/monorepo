import {
  parseSignalAnalyticsQueryParamsV1,
  signalServingScopeIdentityHashV1,
  SignalBackendContractError
} from "@noisia/query-engine";
import { after } from "next/server";

import { loadSignalWorkspaceModuleContext } from "../../../_lib/load";
import {
  loadSignalMentionByIdV1,
  loadSignalMentionsV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import { scheduleSignalMentionsShadowV1 } from "@/lib/data-os/signal-operational-module-shadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const routeStarted = performance.now();
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "mentions", request);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const metricKey = searchParams.get("metric_key")?.trim() || undefined;
    const limit = Number(searchParams.get("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SignalBackendContractError("invalid_filter", "limit must be between 1 and 100.", { field: "limit" });
    }
    const offset = Number(searchParams.get("offset") ?? "0");
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      throw new SignalBackendContractError(
        "invalid_filter",
        "offset must be between 0 and 100000.",
        { field: "offset" }
      );
    }
    const sortField = searchParams.get("sort") ?? "published";
    if (!["published", "platform", "conversation_role", "engagement"].includes(sortField)) {
      throw new SignalBackendContractError("invalid_filter", "sort is not supported.", { field: "sort" });
    }
    const sortDirection = searchParams.get("direction") ?? "desc";
    if (!["asc", "desc"].includes(sortDirection)) {
      throw new SignalBackendContractError(
        "invalid_filter",
        "direction must be asc or desc.",
        { field: "direction" }
      );
    }
    const focusedMentionId = searchParams.get("mention")?.trim();
    searchParams.delete("mention");
    if (!searchParams.has("timezone")) searchParams.set("timezone", loaded.workspace.timezone);
    const { filter, comparison } = parseSignalAnalyticsQueryParamsV1(searchParams);
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    if (focusedMentionId) {
      const record = await loadSignalMentionByIdV1({
        workspace: loaded.workspace,
        readScope: loaded.readScope,
        filter,
        mentionId: focusedMentionId,
        isInternalUser: loaded.isInternalUser
      });
      if (!record) {
        return Response.json(
          { error: "not_found", message: "Mention was not found in this workspace population." },
          { status: 404 }
        );
      }
      const response = signalJsonResponse(request, {
        record,
        filter,
        comparison,
        ...(servingScope ? { serving_scope: servingScope } : {})
      }, {
        etagSeed: `${servingScope ? signalServingScopeIdentityHashV1(servingScope) : "legacy"}:${record.subject_id}:${record.occurred_at}`,
        state: "fresh"
      });
      response.headers.set(
        "Server-Timing",
        `signal-visible;dur=${Math.round(performance.now() - routeStarted)}`
      );
      return response;
    }
    const payload = await loadSignalMentionsV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      ...(servingScope ? { servingScope } : {}),
      filter,
      ...(metricKey ? { metricKey } : {}),
      cursor: searchParams.get("cursor"),
      limit,
      offset,
      sort: {
        field: sortField as "published" | "platform" | "conversation_role" | "engagement",
        direction: sortDirection as "asc" | "desc"
      },
      isInternalUser: loaded.isInternalUser
    });
    const shadow = await scheduleSignalMentionsShadowV1({
      workspace: loaded.workspace,
      readScope: loaded.readScope,
      servingScope: loaded.servingScope,
      filter,
      requester: loaded.session.appUser,
      request: {
        ...(metricKey ? { metricKey } : {}),
        cursor: searchParams.get("cursor"),
        limit,
        offset,
        sort: {
          field: sortField as "published" | "platform" | "conversation_role" | "engagement",
          direction: sortDirection as "asc" | "desc"
        }
      }
    }, after);
    const response = signalJsonResponse(request, {
      ...payload,
      filter,
      comparison,
      ...(servingScope ? { serving_scope: servingScope } : {})
    }, {
      etagSeed: `${servingScope ? signalServingScopeIdentityHashV1(servingScope) : "legacy"}:${payload.filters_hash}:${payload.page.next_cursor ?? "last"}:${payload.records.map((record) => record.subject_id).join(",")}`,
      state: "fresh"
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
