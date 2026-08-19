import {
  parseSignalAnalyticsQueryParamsV1,
  SignalBackendContractError
} from "@noisia/query-engine";

import { loadSignalWorkspaceContextForStrategicReview } from "../../../_lib/load";
import {
  loadSignalWorkspaceCanonicalMentionByIdV1,
  loadSignalWorkspaceCanonicalMentionsV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalAdminMentionOperatorFacetsV1,
  loadSignalAdminMentionOperatorSummariesV1,
  loadSignalAdminMentionOperatorV1,
  parseSignalAdminMentionOperatorFiltersV1,
  resolveSignalAdminMentionOperatorFilterIdsV1
} from "@/lib/data-os/signal-admin-mention-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const searchParams = new URL(request.url).searchParams;
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
    const operatorFilter = parseSignalAdminMentionOperatorFiltersV1(searchParams);
    if (!searchParams.has("timezone")) searchParams.set("timezone", loaded.workspace.timezone);
    const { filter, comparison } = parseSignalAnalyticsQueryParamsV1(searchParams);
    if (focusedMentionId) {
      const record = await loadSignalWorkspaceCanonicalMentionByIdV1({
        workspace: loaded.workspace,
        filter,
        mentionId: focusedMentionId,
        isInternalUser: loaded.isInternalUser
      });
      if (!record) {
        return Response.json(
          { error: "not_found", message: "Mention was not found in this workspace." },
          { status: 404 }
        );
      }
      const operator = await loadSignalAdminMentionOperatorV1({
        workspaceId: loaded.workspace.id,
        mentionId: focusedMentionId
      });
      if (!operator) {
        return Response.json(
          { error: "not_found", message: "Canonical mention was not found in this workspace." },
          { status: 404 }
        );
      }
      return signalJsonResponse(request, { record, operator, filter, comparison }, {
        etagSeed: `admin:${record.subject_id}:${record.occurred_at}:${JSON.stringify(operator)}`,
        state: "fresh"
      });
    }
    const facetsPromise = loadSignalAdminMentionOperatorFacetsV1({ workspaceId: loaded.workspace.id });
    const operatorMentionIds = operatorFilter.active
      ? await resolveSignalAdminMentionOperatorFilterIdsV1({
          workspaceId: loaded.workspace.id,
          filters: operatorFilter.filters
        })
      : undefined;
    const payload = await loadSignalWorkspaceCanonicalMentionsV1({
      workspace: loaded.workspace,
      filter,
      ...(operatorMentionIds ? { subjectIds: operatorMentionIds } : {}),
      cursorScopeHash: operatorFilter.digest,
      cursor: searchParams.get("cursor"),
      limit,
      offset,
      sort: {
        field: sortField as "published" | "platform" | "conversation_role" | "engagement",
        direction: sortDirection as "asc" | "desc"
      },
      isInternalUser: loaded.isInternalUser
    });
    const [operatorSummaries, operatorFacets] = await Promise.all([
      loadSignalAdminMentionOperatorSummariesV1({
        workspaceId: loaded.workspace.id,
        mentionIds: payload.records.map((record) => record.subject_id)
      }),
      facetsPromise
    ]);
    const records = payload.records.map((record) => ({
      ...record,
      operator_summary: operatorSummaries.get(record.subject_id) ?? emptyOperatorSummary()
    }));
    return signalJsonResponse(request, {
      ...payload,
      records,
      operator_filters: operatorFilter.filters,
      operator_facets: operatorFacets,
      filter,
      comparison
    }, {
      etagSeed: `admin:${payload.filters_hash}:${payload.page.next_cursor ?? "last"}:${operatorFilter.digest}:${JSON.stringify(operatorFacets.facets)}:${JSON.stringify(records.map((record) => record.operator_summary))}`,
      state: "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

function emptyOperatorSummary() {
  return {
    inclusion_status: "pending",
    exclusion_reason: null,
    quality_score: null,
    quality_flags: [],
    resolution_state: "unresolved",
    review_status: "unresolved",
    eligibility_status: "unresolved",
    current_assertion_count: 0,
    latest_governance: null,
    provenance: { source_count: 0, import_count: 0, study_count: 0, source_names: [] }
  };
}
