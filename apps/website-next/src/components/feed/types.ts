import type { Industry, StoryKind, StoryLocale } from "@/content/stories/schema";

/** A story already resolved to one locale, ready to cross the server/client boundary. */
export type FeedStory = {
  id: string;
  industry: Industry;
  kind: StoryKind;
  collection?: string;
  market: string;
  method?: string;
  sources: string[];
  period?: string;
  reportHref?: string;
  tag: string;
  content: StoryLocale;
};

/** A feed tab that shows only the stories of one report or study. */
export type FeedCollection = { id: string; name: string; demo: boolean };
