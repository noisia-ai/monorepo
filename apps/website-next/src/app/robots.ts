import type { MetadataRoute } from "next";
import { IS_UAT, SITE_URL } from "@/lib/seo/config";

/** Search and answer engines named explicitly so the site's stance on them is unambiguous. */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "Applebot-Extended"
];

// /render draws story frames for video export; /api is the workshop form endpoint.
const DISALLOW = ["/render/", "/en/render/", "/api/"];

export default function robots(): MetadataRoute.Robots {
  if (IS_UAT) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      // A crawler with its own group ignores the * group, so the disallows are repeated here.
      { userAgent: AI_CRAWLERS, allow: "/", disallow: DISALLOW }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
