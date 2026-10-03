import {
  parseSignalAnalyticsQueryParamsV1,
  SignalBackendContractError
} from "@noisia/query-engine";

import { unauthorized } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  loadSignalMentionsV1,
  signalBackendErrorResponse
} from "@/lib/data-os/signal-workspace-serving";
import { resolveLegacyOutputSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { resolveSignalOperationalReadScopeV1 } from "@/lib/data-os/signal-operational-read-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json(
      { error: "not_found", message: "Signal output not found." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const workspace = await resolveLegacyOutputSignalWorkspaceForUser(session.appUser, outputId);
  if (!workspace) {
    return Response.json(
      { error: "workspace_not_found", message: "Signal workspace is not mapped to this output." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const params = new URL(request.url).searchParams;
    if (!params.has("timezone")) params.set("timezone", workspace.timezone);
    const { filter, comparison } = parseSignalAnalyticsQueryParamsV1(params);
    const limit = Number(params.get("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SignalBackendContractError("invalid_filter", "limit must be an integer between 1 and 100.", {
        field: "limit"
      });
    }
    const offset = Number(params.get("offset") ?? "0");
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      throw new SignalBackendContractError("invalid_filter", "offset must be an integer between 0 and 100000.", {
        field: "offset"
      });
    }
    const sortField = params.get("sort") ?? "published";
    if (!["published", "platform", "conversation_role", "engagement"].includes(sortField)) {
      throw new SignalBackendContractError("invalid_filter", "sort is not supported.", {
        field: "sort"
      });
    }
    const sortDirection = params.get("direction") ?? "desc";
    if (!["asc", "desc"].includes(sortDirection)) {
      throw new SignalBackendContractError("invalid_filter", "direction must be asc or desc.", {
        field: "direction"
      });
    }
    const readScope = await resolveSignalOperationalReadScopeV1(workspace, { mode: "legacy" });
    const payload = await loadSignalMentionsV1({
      workspace,
      readScope,
      filter,
      cursor: params.get("cursor"),
      limit,
      offset,
      sort: {
        field: sortField as "published" | "platform" | "conversation_role" | "engagement",
        direction: sortDirection as "asc" | "desc"
      },
      isInternalUser: session.appUser.userType === "noisia_internal"
    });
    return Response.json(
      { ...payload, filter, comparison },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}
