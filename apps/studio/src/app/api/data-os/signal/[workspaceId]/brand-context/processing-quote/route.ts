import { loadSignalWorkspaceContextForTopics } from "../../topics/_lib";
import { createClientBrandContextProcessingQuoteGetV1 } from "@/lib/data-os/client-brand-context-processing-quote-route";
import { loadClientBrandContextProcessingQuoteForActorV1 } from "@/lib/data-os/signal-brand-context-processing-quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createClientBrandContextProcessingQuoteGetV1({
  loadWorkspaceContext: loadSignalWorkspaceContextForTopics,
  loadQuote: loadClientBrandContextProcessingQuoteForActorV1,
  logError: error => console.error("[signal-brand-context-processing-quote] read unavailable", {
    name: error instanceof Error ? error.name : "UnknownError"
  })
});
