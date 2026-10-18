/**
 * Inner pages are data: an ordered list of blocks rendered by src/components/blocks.
 * Copy lives in src/content/pages/*.ts as { es: PageContent, en: PageContent }.
 */
export type Block =
  | { type: "text"; title?: string; paragraphs: string[] }
  | { type: "cards"; title?: string; lead?: string; items: { name: string; text: string }[] }
  | { type: "steps"; title?: string; lead?: string; items: { name: string; text: string }[] }
  | { type: "table"; title?: string; lead?: string; headers: string[]; rows: string[][]; highlightColumn?: number }
  | { type: "quote"; text: string; source?: string }
  | { type: "faq"; title?: string; items: { q: string; a: string }[] }
  | { type: "callout"; title: string; text: string }
  | { type: "links"; title?: string; items: { label: string; text?: string; href: string }[] }
  | { type: "cta"; title: string; text?: string; label: string; href: string }
  | { type: "motion"; name: "sources-hub"; title?: string; lead?: string; copy: { center: string; sources: string[]; owned: string } }
  | {
      type: "motion";
      name: "one-conversation";
      title?: string;
      lead?: string;
      copy: {
        views: [{ tab: string; caption: string }, { tab: string; caption: string }, { tab: string; caption: string }, { tab: string; caption: string }];
        topics: [string, string, string, string, string];
        brands: [string, string, string];
        framework: string;
        nodes: [string, string, string];
      };
    };

export type PageContent = {
  /** <title> and H1 can differ: the H1 speaks to the reader, the title to search. */
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead?: string;
  blocks: Block[];
};

export type Localized<T> = { es: T; en: T };
