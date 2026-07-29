import { SignalBackendContractError } from "@noisia/query-engine";

import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  loadSignalMentionsV1,
  parseSignalApiFilterV1,
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
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
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const payload = await loadSignalMentionsV1({
      workspace: loaded.workspace,
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
    return signalJsonResponse(request, payload, {
      etagSeed: `${payload.filters_hash}:${payload.page.next_cursor ?? "last"}:${payload.records.map((record) => record.subject_id).join(",")}`,
      state: "fresh"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
