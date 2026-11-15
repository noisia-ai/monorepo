import { llmsTxt } from "@/lib/seo/llms";

export const dynamic = "force-static";

// A plain-text map of the site for search and answer engines (llmstxt.org convention).
export async function GET() {
  return new Response(await llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
