import "server-only";
import { getTranslations } from "next-intl/server";
import { getStories } from "@/content/stories";
import type { FeedStory } from "./types";

export async function getFeedStories(locale: string): Promise<FeedStory[]> {
  const t = await getTranslations({ locale, namespace: "industries" });
  return getStories().map((story) => ({
    id: story.id,
    industry: story.industry,
    kind: story.kind,
    market: story.market,
    method: story.method,
    sources: story.sources,
    period: story.period,
    reportHref: story.report && story.report !== "/insights" ? story.report : undefined,
    tag: `${t(story.industry)} · ${story.market}`,
    content: locale === "en" ? story.en : story.es
  }));
}
