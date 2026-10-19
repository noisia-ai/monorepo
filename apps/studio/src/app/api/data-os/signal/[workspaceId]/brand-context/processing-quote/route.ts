import { loadSignalWorkspaceContextForTopics } from "../../topics/_lib";
import { createClientBrandContextProcessingPostV1,
  createClientBrandContextProcessingQuoteGetV1 } from "@/lib/data-os/client-brand-context-processing-quote-route";
import { loadClientBrandContextProcessingViewForActorV1,
  startClientBrandContextProcessingForActorV1 } from "@/lib/data-os/signal-brand-context-processing-quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getBrandContextProcessingQuote = createClientBrandContextProcessingQuoteGetV1({
  loadWorkspaceContext: loadSignalWorkspaceContextForTopics,
  loadQuote: loadClientBrandContextProcessingViewForActorV1,
  logError: error => console.error("[signal-brand-context-processing-quote] read unavailable", {
    name: error instanceof Error ? error.name : "UnknownError"
  })
});
const startBrandContextProcessing = createClientBrandContextProcessingPostV1({
  loadWorkspaceContext: loadSignalWorkspaceContextForTopics,
  start: startClientBrandContextProcessingForActorV1,
  logError: error => console.error("[signal-brand-context-processing] request unavailable", {
    name: error instanceof Error ? error.name : "UnknownError",
    code: error instanceof Error && "code" in error ? error.code : undefined
  })
});

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return getBrandContextProcessingQuote(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return startBrandContextProcessing(request, context);
}
