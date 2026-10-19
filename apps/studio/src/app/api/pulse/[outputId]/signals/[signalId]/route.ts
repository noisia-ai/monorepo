import { loadPulseApiContext } from "../../../_lib/load";
import { buildPulseSignalsResponse, pulseApiFiltersFromSearchParams } from "@/lib/signal-pulse/pulse-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string; signalId: string }> }) {
  const { outputId, signalId } = await context.params;
  const loaded = await loadPulseApiContext(outputId);
  if ("response" in loaded) return loaded.response;
  const filters = pulseApiFiltersFromSearchParams(new URL(request.url).searchParams);

  const result = buildPulseSignalsResponse({
    payload: loaded.payload,
    visibility: loaded.visibility,
    signalId,
    filters
  });
  if (!result) {
    return Response.json({ error: "not_found", message: "Signal not found in this Pulse." }, { status: 404 });
  }

  return Response.json(result);
}
