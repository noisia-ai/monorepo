export type SignalTopicLocalization = {
  original_language: string;
  original: { name: string; definition: string };
  en: { name: string; definition: string };
  es: { name: string; definition: string };
};

/** Translation changes presentation while retaining the corpus text for reference. */
export function localizedSignalTopic<T extends { label: string; definition: string; localization?: SignalTopicLocalization }>(
  term: T, locale: string,
): T {
  const version = term.localization?.[locale.toLowerCase().startsWith("es") ? "es" : "en"];
  return version ? { ...term, label: version.name, definition: version.definition } : term;
}
