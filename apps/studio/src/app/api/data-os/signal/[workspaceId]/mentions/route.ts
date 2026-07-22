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
    const metricKey = searchParams.get("metric_key")?.trim();
    if (!metricKey) throw new SignalBackendContractError("invalid_filter", "metric_key is required.", { field: "metric_key" });
    const limit = Number(searchParams.get("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SignalBackendContractError("invalid_filter", "limit must be between 1 and 100.", { field: "limit" });
    }
    const filter = parseSignalApiFilterV1(searchParams, loaded.workspace.timezone);
    const payload = await loadSignalMentionsV1({
      workspace: loaded.workspace,
      filter,
      metricKey,
      cursor: searchParams.get("cursor"),
      limit,
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
