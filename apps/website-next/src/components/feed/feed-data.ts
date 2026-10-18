import "server-only";
import { getTranslations } from "next-intl/server";
import { getStories } from "@/content/stories";
import { collections } from "@/content/stories/collections";
import type { FeedCollection, FeedStory } from "./types";

/** Report links are stored with their Spanish path; English readers get the /en/insights/reports twin. */
function localizeReportHref(href: string | undefined, locale: string) {
  if (!href || href === "/insights") return undefined;
  if (locale === "en" && href.startsWith("/insights/reportes/")) return `/en/insights/reports/${href.slice("/insights/reportes/".length)}`;
  return href;
}

export async function getFeedStories(locale: string): Promise<FeedStory[]> {
  const t = await getTranslations({ locale, namespace: "industries" });
  return getStories().map((story) => ({
    id: story.id,
    industry: story.industry,
    kind: story.kind,
    collection: story.collection,
    market: story.market,
    method: story.method,
    sources: story.sources,
    period: story.period,
    reportHref: localizeReportHref(story.report, locale),
    tag: `${t(story.industry)} · ${story.market}`,
    content: locale === "en" ? story.en : story.es
  }));
}

/** Collections that have at least one story loaded, newest first as listed. */
export function getFeedCollections(stories: FeedStory[], locale: string): FeedCollection[] {
  return collections
    .filter((collection) => stories.some((story) => story.collection === collection.id))
    .map((collection) => ({ id: collection.id, name: (locale === "en" ? collection.en : collection.es).name, demo: Boolean(collection.demo) }));
}
