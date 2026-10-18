import type { Metadata } from "next";
import type { PageContent } from "@/content/pages/types";

/** Metadata for an inner page with its ES/EN alternates. Paths are given without the /en prefix. */
export function pageMetadata(page: PageContent, locale: string, paths: { es: string; en: string }): Metadata {
  const canonical = locale === "en" ? `/en${paths.en}` : paths.es;
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical, languages: { es: paths.es, en: `/en${paths.en}` } },
    openGraph: { title: page.metaTitle, description: page.metaDescription }
  };
}
