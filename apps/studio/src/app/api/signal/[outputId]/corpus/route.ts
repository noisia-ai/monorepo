import { handleCorpusExplorerRequest } from "@/lib/live-intelligence/corpus-explorer-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ outputId: string }> }
) {
  return handleCorpusExplorerRequest(request, context);
}
