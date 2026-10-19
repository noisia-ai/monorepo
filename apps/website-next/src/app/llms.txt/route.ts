import { llmsTxt } from "@/lib/seo/llms";

export const dynamic = "force-static";

// A plain-text map of the site for search and answer engines (llmstxt.org convention).
export function GET() {
  return new Response(llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
