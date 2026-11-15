import { llmsFullTxt } from "@/lib/seo/llms";

export const dynamic = "force-static";

// The full text of the key pages in English and Spanish, generated from the content files.
export async function GET() {
  return new Response(await llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
