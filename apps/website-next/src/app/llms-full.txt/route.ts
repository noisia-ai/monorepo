import { llmsFullTxt } from "@/lib/seo/llms";

export const dynamic = "force-static";

// The full text of the key pages in English and Spanish, generated from the content files.
export function GET() {
  return new Response(llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
