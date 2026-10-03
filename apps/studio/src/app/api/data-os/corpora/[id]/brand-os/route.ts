import { loadDataOsCorpusContext } from "../../../_lib/load";
import { getDataOsBrandOs } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  return Response.json(await getDataOsBrandOs(loaded.corpus.id));
}
