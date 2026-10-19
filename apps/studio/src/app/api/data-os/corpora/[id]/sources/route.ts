import { loadDataOsCorpusContext } from "../../../_lib/load";
import { listDataOsSources } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  return Response.json({
    corpus_id: loaded.corpus.id,
    sources: await listDataOsSources(loaded.corpus.id)
  });
}
