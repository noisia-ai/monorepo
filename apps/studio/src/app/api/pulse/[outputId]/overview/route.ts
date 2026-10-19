import { loadPulseApiContext } from "../../_lib/load";
import { buildPulseOverviewResponse, pulseApiFiltersFromSearchParams } from "@/lib/signal-pulse/pulse-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadPulseApiContext(outputId);
  if ("response" in loaded) return loaded.response;
  const filters = pulseApiFiltersFromSearchParams(new URL(request.url).searchParams);

  return Response.json(buildPulseOverviewResponse({
    output: loaded.output,
    payload: loaded.payload,
    visibility: loaded.visibility,
    filters
  }));
}
