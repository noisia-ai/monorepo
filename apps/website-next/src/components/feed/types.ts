import type { Industry, StoryLocale } from "@/content/stories/schema";

/** A story already resolved to one locale, ready to cross the server/client boundary. */
export type FeedStory = {
  id: string;
  industry: Industry;
  kind: "editorial" | "example";
  market: string;
  method?: string;
  sources: string[];
  period?: string;
  reportHref?: string;
  tag: string;
  content: StoryLocale;
};
