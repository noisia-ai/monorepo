import { z } from "zod";

import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../_lib/load";
import { loadWorkspaceSemanticResolutionPreflight } from "@/lib/data-os/signal-semantic-resolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  hard_cap_usd: z.string().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/)
}).strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if ("response" in loaded) return loaded.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ hard_cap_usd: url.searchParams.get("hard_cap_usd") });
  if (!parsed.success) {
    return Response.json({
      error: "semantic_resolution_hard_cap_required",
      message: "Choose an explicit hard cap before calculating the semantic resolution preflight."
    }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const preflight = await loadWorkspaceSemanticResolutionPreflight({
      workspaceId: loaded.workspace.id,
      hardCapUsd: parsed.data.hard_cap_usd
    });
    return Response.json(preflight, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return Response.json({
      error: "semantic_resolution_preflight_unavailable",
      message: error instanceof Error ? error.message : "Semantic resolution preflight is unavailable."
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
