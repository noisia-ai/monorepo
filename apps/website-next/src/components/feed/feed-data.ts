import "server-only";
import { getTranslations } from "next-intl/server";
import { getStories } from "@/content/stories";
import { collections } from "@/content/stories/collections";
import { getStudies, studyStoryIds } from "@/content/studies";
import type { FeedCollection, FeedStory } from "./types";

/** Report and study links are stored with their Spanish path; English readers get the /en twin. */
function localizeReportHref(href: string | undefined, locale: string) {
  if (!href || href === "/insights") return undefined;
  if (locale === "en" && href.startsWith("/insights/reportes/")) return `/en/insights/reports/${href.slice("/insights/reportes/".length)}`;
  if (locale === "en" && href.startsWith("/insights/estudios/")) return `/en/insights/studies/${href.slice("/insights/estudios/".length)}`;
  return href;
}

/** Pieces loaded with a study join that study's tab in the feed, and link to its page. */
async function studyOfPiece(): Promise<Map<string, string>> {
  const byPiece = new Map<string, string>();
  for (const study of await getStudies()) for (const id of await studyStoryIds(study.id)) byPiece.set(id, study.id);
  return byPiece;
}

export async function getFeedStories(locale: string): Promise<FeedStory[]> {
  const t = await getTranslations({ locale, namespace: "industries" });
  const studyOf = await studyOfPiece();
  return (await getStories()).map((story) => ({
    id: story.id,
    industry: story.industry,
    kind: story.kind,
    collection: story.collection ?? studyOf.get(story.id),
    market: story.market,
    method: story.method,
    sources: story.sources,
    period: story.period,
    reportHref: localizeReportHref(story.report ?? (studyOf.has(story.id) ? `/insights/estudios/${studyOf.get(story.id)}` : undefined), locale),
    tag: `${t(story.industry)} · ${story.market}`,
    content: locale === "en" ? story.en : story.es
  }));
}

/** Collections that have at least one story loaded: studies first (newest first), then the listed ones. */
export async function getFeedCollections(stories: FeedStory[], locale: string): Promise<FeedCollection[]> {
  const lang = locale === "en" ? "en" : "es";
  const fromStudies = (await getStudies())
    .filter((study) => stories.some((story) => story.collection === study.id))
    .map((study) => ({ id: study.id, name: study.summary[lang].title, demo: false }));
  const listed = collections
    .filter((collection) => stories.some((story) => story.collection === collection.id))
    .map((collection) => ({ id: collection.id, name: (locale === "en" ? collection.en : collection.es).name, demo: Boolean(collection.demo) }));
  return [...fromStudies, ...listed];
}
