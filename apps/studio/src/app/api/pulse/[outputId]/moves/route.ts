import { loadPulseApiContext } from "../../_lib/load";
import { buildPulseMovesResponse } from "@/lib/signal-pulse/pulse-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadPulseApiContext(outputId);
  if ("response" in loaded) return loaded.response;

  return Response.json(buildPulseMovesResponse({
    payload: loaded.payload,
    visibility: loaded.visibility
  }));
}
