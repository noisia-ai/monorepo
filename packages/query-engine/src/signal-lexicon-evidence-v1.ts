/**
 * Free evidence for the category lexicon: which words of the corpus are worth
 * suggesting. Function words are left out by language, and what remains is
 * ordered by lift: how much more often a word appears in the posts that show
 * the category than in the comparable posts as a whole. This module is pure.
 */
const WORDS = {
  pt: "a ao aos aquela aquelas aquele aqueles aqui as assim ate com como da das de dela delas dele deles depois do dos e ela elas ele eles em entre era essa essas esse esses esta estas este estes eu foi foram ha isso isto ja la mais mas me mesmo meu meus minha minhas muito na nas nao nem no nos nossa nossas nosso nossos num numa o os ou para pela pelas pelo pelos por porque pra pro quando que quem se sem ser seu seus so sua suas tambem te tem ter todos tu tudo um uma umas uns vai voce voces vou",
  es: "a al algo ante aqui asi aun aunque cada como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese esos esta estas este estos fue ha hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nuestra nuestro o otra otro para pero poco por porque que quien se sin sobre solo son su sus tambien te tiene todo todos tu tus un una unas unos usted ustedes ya yo",
  en: "a about after again all also am an and any are as at be because been before being between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves",
} as const;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("pt-BR").trim().replace(/\s+/gu, " ");
/** Without accents, so `não` and `nao` are the same function word. */
const fold = (value: string) => normalize(value).normalize("NFD").replace(/\p{M}/gu, "");
const SETS = Object.fromEntries(Object.entries(WORDS).map(([language, list]) => [language, new Set(list.split(" "))])) as Record<string, Set<string>>;
/** A corpus whose language is unknown or not listed is filtered with every list. */
const ANY = new Set(Object.values(SETS).flatMap(set => [...set]));
const stopwords = (language: string | null) => SETS[language?.toLowerCase().split(/[-_]/u)[0] ?? ""] ?? ANY;

export function signalLexiconStopwordsV1(language: string | null): readonly string[] {
  return [...stopwords(language)].sort();
}
/** A word or a pair of words made of letters and digits, with no function word in it. */
export function signalLexiconTermAllowedV1(term: string, language: string | null): boolean {
  const normalized = normalize(term), tokens = normalized.split(" "), stop = stopwords(language);
  return normalized.length >= 2 && normalized.length <= 200 && tokens.length <= 2
    && tokens.every(token => /^[\p{L}\p{N}]+$/u.test(token) && /\p{L}/u.test(token) && !stop.has(fold(token)));
}

export type SignalLexiconEvidenceCountsV1 = { term: string; foreground_roots: number; background_roots: number };
export type SignalLexiconSuggestionV1<T extends SignalLexiconEvidenceCountsV1 = SignalLexiconEvidenceCountsV1> = T & { lift: number };
/**
 * Orders candidate terms by lift. The background contains the foreground, and
 * every count is distinct posts, never occurrences. Half a post of smoothing
 * keeps the ratio bounded when a word is rare.
 */
export function rankSignalLexiconEvidenceV1<T extends SignalLexiconEvidenceCountsV1>(args: { foreground_size: number; background_size: number; language: string | null;
  items: readonly T[]; existing_terms?: readonly string[]; minimum_roots?: number; limit?: number }): Array<SignalLexiconSuggestionV1<T>> {
  const minimum = args.minimum_roots ?? 3, limit = args.limit ?? 100;
  const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!whole(args.foreground_size) || !whole(args.background_size) || args.foreground_size > args.background_size || !Number.isSafeInteger(minimum) || minimum < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("lexicon_evidence_invalid");
  if (!args.foreground_size) return [];
  const existing = new Set((args.existing_terms ?? []).map(fold)), seen = new Set<string>(), result: Array<SignalLexiconSuggestionV1<T>> = [];
  for (const item of args.items) {
    if (!whole(item.foreground_roots) || !whole(item.background_roots) || item.foreground_roots > item.background_roots
      || item.foreground_roots > args.foreground_size || item.background_roots > args.background_size) throw new Error("lexicon_evidence_invalid");
    const term = normalize(item.term);
    // Spellings that differ only in accents are one suggestion: the first given wins.
    if (seen.has(fold(term)) || item.foreground_roots < minimum || existing.has(fold(term)) || !signalLexiconTermAllowedV1(term, args.language)) continue;
    seen.add(fold(term));
    result.push({ ...item, term, lift: ((item.foreground_roots + 0.5) / (args.foreground_size + 1)) / ((item.background_roots + 0.5) / (args.background_size + 1)) });
  }
  return result.sort((left, right) => right.lift - left.lift || right.foreground_roots - left.foreground_roots || left.term.localeCompare(right.term, "en")).slice(0, limit);
}
