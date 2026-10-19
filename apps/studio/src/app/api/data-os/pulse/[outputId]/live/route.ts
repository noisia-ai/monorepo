import { loadDataOsPulseContext } from "../../../_lib/load";
import { getPulseLiveData } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await context.params;
  const loaded = await loadDataOsPulseContext(outputId);
  if ("response" in loaded) return loaded.response;

  return Response.json(await getPulseLiveData(loaded.output.id, loaded.output.studyCorpusId, { visibility: loaded.visibility }));
}
