import { loadPulseApiContext } from "../../_lib/load";
import { buildPulseOverviewResponse } from "@/lib/signal-pulse/pulse-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadPulseApiContext(outputId);
  if ("response" in loaded) return loaded.response;

  return Response.json(buildPulseOverviewResponse({
    output: loaded.output,
    payload: loaded.payload,
    visibility: loaded.visibility
  }));
}
