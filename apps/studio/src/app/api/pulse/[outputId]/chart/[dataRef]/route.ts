import { loadPulseApiContext } from "../../../_lib/load";
import { buildPulseChartResponse } from "@/lib/signal-pulse/pulse-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ outputId: string; dataRef: string }> }) {
  const { outputId, dataRef } = await context.params;
  const loaded = await loadPulseApiContext(outputId);
  if ("response" in loaded) return loaded.response;

  const chart = buildPulseChartResponse({
    payload: loaded.payload,
    dataRef
  });
  if (!chart) {
    return Response.json({ error: "not_found", message: "Chart aggregate not found in this Pulse." }, { status: 404 });
  }

  return Response.json(chart);
}
