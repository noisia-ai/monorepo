import type { MetadataRoute } from "next";
import { IS_UAT, absoluteUrl } from "@/lib/seo/config";
import { languageAlternates } from "@/lib/seo/metadata";
import { seoPages } from "@/lib/seo/pages";

/**
 * Every indexable page in both languages, each with its hreflang alternates. Built from the same
 * registry as the page metadata, so a page that exists has an entry and a noindex page (feed
 * examples, /render) never does. Staging publishes an empty sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (IS_UAT) return [];
  return seoPages()
    .filter((page) => !page.noindex)
    .flatMap((page) => {
      const languages = languageAlternates(page);
      const priority = page.kind === "home" ? 1 : page.parent === "/" ? 0.8 : 0.6;
      return (["es", "en"] as const).map((lang) => ({
        url: absoluteUrl(page[lang].path),
        lastModified: page.lastModified,
        changeFrequency: page.kind === "home" || page.id === "/insights" ? ("weekly" as const) : ("monthly" as const),
        priority,
        alternates: { languages }
      }));
    });
}
