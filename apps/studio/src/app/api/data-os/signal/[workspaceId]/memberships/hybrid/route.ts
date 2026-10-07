import { z } from "zod";
import { configureHybridMembershipRouteV1, loadHybridMembershipRouteV1, loadHybridMembershipReviewQueueV1, SignalLabelingError } from "@noisia/db";
import { pool } from "@/lib/db";
import { loadSignalWorkspaceContextForTopics } from "../../topics/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ workspaceId: string }> };
const routeSchema = z.object({ route: z.enum(["standard", "hybrid_h1"]) }).strict();
const error = (cause: unknown) => Response.json({ error: cause instanceof SignalLabelingError ? cause.code : "hybrid_unavailable" },
  { status: cause instanceof SignalLabelingError ? cause.status : 503, headers });
export async function GET(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
  if ("response" in loaded) return loaded.response;
  const access = { database: pool, workspace_id: loaded.workspace.id, actor_user_id: loaded.session.appUser.id };
  try {
    const route = await loadHybridMembershipRouteV1(access);
    const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(new URL(request.url).searchParams.get("limit") ?? "50");
    if (!parsedLimit.success) return Response.json({ error: "hybrid_limit_invalid" }, { status: 400, headers });
    const reviews = route.route === "hybrid_h1" ? await loadHybridMembershipReviewQueueV1({ ...access,
      limit: parsedLimit.data }) : null;
    return Response.json({ contract_version: "mfp-hybrid-route-v1", ...route, reviews }, { headers });
  } catch (cause) { return error(cause); }
}
export async function PATCH(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics((await context.params).workspaceId);
  if ("response" in loaded) return loaded.response;
  const body = routeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "hybrid_route_invalid" }, { status: 400, headers });
  try {
    const result = await configureHybridMembershipRouteV1({ database: pool,
      workspace_id: loaded.workspace.id, actor_user_id: loaded.session.appUser.id,
      route: body.data.route,
      provider_available: process.env.NOISIA_MFP_HYBRID_LEDGER_READY === "true" &&
        process.env.NOISIA_MFP_HYBRID_ENABLED === "true" &&
        process.env.NOISIA_JEV_PROVIDER_ENABLED === "true" &&
        process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED === "true",
    });
    return Response.json({ contract_version: "mfp-hybrid-route-v1", ...result }, { headers });
  } catch (cause) { return error(cause); }
}
