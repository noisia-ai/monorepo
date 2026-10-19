import { loadDataOsCorpusContext } from "../../../_lib/load";
import { listDataOsTags, parseDataOsTagFilters } from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  const searchParams = new URL(request.url).searchParams;
  return Response.json(await listDataOsTags(loaded.corpus.id, parseDataOsTagFilters(searchParams)));
}
