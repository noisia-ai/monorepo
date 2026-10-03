import { handleCorpusExplorerRequest } from "@/lib/live-intelligence/corpus-explorer-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ outputId: string }> }
) {
  return handleCorpusExplorerRequest(request, context, {
    requiredMethodologySlug: "signal-pulse",
    requiredKind: "signal_pulse",
    forcedLensSlug: "signal-pulse",
    canonicalMethodologySlug: "signal-pulse",
    notFoundMessage: "Signal Pulse output not found.",
    schemaMissingMessage: "Live corpus schema is not migrated yet; Signal Pulse can only show published evidence."
  });
}
