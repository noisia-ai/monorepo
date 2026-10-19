import { loadDataOsPulseContext } from "../../../_lib/load";
import { listPulseLiveMetrics, parsePulseLiveMetricFilters } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadDataOsPulseContext(outputId);
  if ("response" in loaded) return loaded.response;

  const searchParams = new URL(request.url).searchParams;
  return Response.json(await listPulseLiveMetrics(loaded.output.studyCorpusId, parsePulseLiveMetricFilters(searchParams)));
}
