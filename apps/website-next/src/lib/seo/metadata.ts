import "server-only";
import type { Metadata } from "next";
import { HREFLANG, IS_UAT, OG_LOCALE, ORG_NAME, absoluteUrl, toLang, type Lang } from "./config";
import { seoPage, type SeoPage } from "./pages";

/** URL of the generated Open Graph image of a page (see src/app/og). Ends in .png so the locale middleware skips it. */
export function ogImageUrl(page: SeoPage, lang: Lang): string {
  const path = page[lang].path;
  const rest = lang === "en" ? path.replace(/^\/en/, "") : path;
  return absoluteUrl(`/og/${lang}${rest === "/" || rest === "" ? "/index" : rest}.png`);
}

/** hreflang map for a page: both languages plus x-default pointing to Spanish. */
export function languageAlternates(page: SeoPage): Record<string, string> {
  return {
    [HREFLANG.es]: absoluteUrl(page.es.path),
    [HREFLANG.en]: absoluteUrl(page.en.path),
    "x-default": absoluteUrl(page.es.path)
  };
}

/** robots for a page: staging never indexes; noindex pages still let crawlers follow links. */
export function robotsFor(page?: Pick<SeoPage, "noindex">): Metadata["robots"] {
  if (IS_UAT) return { index: false, follow: false };
  if (page?.noindex) return { index: false, follow: true };
  return undefined;
}

/**
 * Full metadata of a registered page: title, description, self canonical, hreflang alternates,
 * Open Graph and Twitter card. `id` is the page's Spanish path.
 */
export function pageMetadata(id: string, locale: string): Metadata {
  const page = seoPage(id);
  if (!page) return { robots: robotsFor() ?? { index: false, follow: true } };
  const lang = toLang(locale);
  const copy = page[lang];
  const other: Lang = lang === "en" ? "es" : "en";
  const url = absoluteUrl(copy.path);
  const image = { url: ogImageUrl(page, lang), width: 1200, height: 630, alt: copy.headline };
  const isArticle = page.kind === "report" || page.kind === "story" || page.kind === "compare";
  return {
    // A title that already names Noisia skips the " · Noisia" template instead of repeating it.
    title: page.absoluteTitle || /\bNoisia\b/.test(copy.title) ? { absolute: copy.title } : copy.title,
    description: copy.description,
    alternates: { canonical: url, languages: languageAlternates(page) },
    openGraph: {
      type: isArticle ? "article" : "website",
      siteName: ORG_NAME,
      title: copy.title,
      description: copy.description,
      url,
      locale: OG_LOCALE[lang],
      alternateLocale: [OG_LOCALE[other]],
      images: [image],
      ...(isArticle ? { modifiedTime: page.lastModified } : {})
    },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description, images: [image.url] },
    robots: robotsFor(page)
  };
}
