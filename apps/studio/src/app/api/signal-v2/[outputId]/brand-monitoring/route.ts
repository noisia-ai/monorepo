import { parseSignalAnalyticsQueryParamsV1 } from "@noisia/query-engine";

import { unauthorized } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  resolveLegacyOutputSignalWorkspaceForUser
} from "@/lib/data-os/signal-workspace";
import { loadSignalBrandMonitoringV1 } from "@/lib/signal-v2/brand-monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const workspace = await resolveLegacyOutputSignalWorkspaceForUser(session.appUser, outputId);
  if (!workspace) {
    return Response.json(
      { error: "workspace_not_found", message: "Signal workspace is not mapped to this output." },
      { status: 404 }
    );
  }

  try {
    const params = new URL(request.url).searchParams;
    if (!params.has("timezone")) params.set("timezone", workspace.timezone);
    const { filter, comparison } = parseSignalAnalyticsQueryParamsV1(params);
    const payload = await loadSignalBrandMonitoringV1({
      workspace,
      filter,
      comparison,
      isInternalUser: session.appUser.userType === "noisia_internal"
    });
    return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json(
      {
        error: "brand_monitoring_failed",
        message: error instanceof Error ? error.message : "Unable to load Brand Monitoring."
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
