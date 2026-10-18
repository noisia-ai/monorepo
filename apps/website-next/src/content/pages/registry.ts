import type { Localized, PageContent } from "./types";

/** An entry of a collection page (solutions, methods, comparisons) with per-locale slugs. */
export type Entry = { slug: { es: string; en: string }; page: Localized<PageContent>; summary: Localized<string> };

export function findEntry(entries: Entry[], locale: string, slug: string): Entry | undefined {
  const lang = locale === "en" ? "en" : "es";
  return entries.find((entry) => entry.slug[lang] === slug);
}

export function pick<T>(value: Localized<T>, locale: string): T {
  return locale === "en" ? value.en : value.es;
}
