import { loadDataOsPulseContext } from "../../../_lib/load";
import { listPulseLiveCorpus, parsePulseLiveCorpusFilters } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadDataOsPulseContext(outputId, { requiredVisibility: "showCorpus", scope: "corpus" });
  if ("response" in loaded) return loaded.response;

  const searchParams = new URL(request.url).searchParams;
  return Response.json(await listPulseLiveCorpus(loaded.output.studyCorpusId, parsePulseLiveCorpusFilters(searchParams)));
}
