/**
 * A collection gathers the stories that come out of one report or study, so the feed can
 * open a tab with only that work (for example /insights?coleccion=buen-fin-2026).
 * A story joins a collection through its `collection` field.
 */
export type Collection = {
  id: string;
  /** Invented content used to test the format; labelled as such and never published. */
  demo?: boolean;
  es: { name: string };
  en: { name: string };
};

// No collection is published yet; add one here when a study gets its own feed tab.
export const collections: Collection[] = [];
