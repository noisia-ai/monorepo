/** Language filters and root-level lift for free, methodology-independent lexicon evidence. */
const words = {
  pt: 'a ao aos aquela aquelas aquele aqueles aqui as assim ate com como da das de dela delas dele deles depois do dos e ela elas ele eles em entre era essa essas esse esses esta estas este estes eu foi foram ha isso isto ja la mais mas me mesmo meu meus minha minhas muito na nas nao nem no nos nossa nossas nosso nossos num numa o os ou para pela pelas pelo pelos por porque pra pro quando que quem se sem ser seu seus so sua suas tambem te tem ter todos tu tudo um uma umas uns vai voce voces vou',
  es: 'a al algo ante aqui asi aun aunque cada como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese esos esta estas este estos fue ha hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nuestra nuestro o otra otro para pero poco por porque que quien se sin sobre solo son su sus tambien te tiene todo todos tu tus un una unas unos usted ustedes ya yo',
  en: 'a about after again all also am an and any are as at be because been before being between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves',
} as const;

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('pt-BR').trim();
const fold = (value: string) => normalize(value).normalize('NFD').replace(/\p{M}/gu, '');
const sets = Object.fromEntries(Object.entries(words).map(([key, value]) => [key, new Set(value.split(' '))])) as Record<string, Set<string>>;
const unknown = new Set(Object.values(sets).flatMap(set => [...set]));
const stopSet = (language: string | null) => sets[language?.toLowerCase().split(/[-_]/u)[0] ?? ''] ?? unknown;

export function signalLexiconStopwordsV1(language: string | null): readonly string[] {
  return [...stopSet(language)].sort();
}

export function signalLexiconTermAllowedV1(term: string, language: string | null): boolean {
  const normalized = normalize(term), tokens = normalized.split(' ');
  const stop = stopSet(language);
  return normalized.length >= 2 && normalized.length <= 200 && tokens.length <= 2
    && tokens.every(token => /^[\p{L}\p{N}]+$/u.test(token) && /\p{L}/u.test(token) && !stop.has(fold(token)));
}

export type SignalLexiconEvidenceCountsV1 = {
  term: string; language: string | null; foreground_roots: number; background_roots: number;
};
export type SignalLexiconSuggestionV1 = SignalLexiconEvidenceCountsV1 & { lift: number };

/** Background contains the foreground. Each count is DISTINCT canonical roots,
 * never tokens. Half-root smoothing bounds the ratio for small populations. */
export function rankSignalLexiconEvidenceV1(args: {
  foreground_size: number; background_size: number; items: readonly SignalLexiconEvidenceCountsV1[];
  existing_terms?: readonly string[]; minimum_roots?: number; limit?: number;
}): SignalLexiconSuggestionV1[] {
  const minimum = args.minimum_roots ?? 3, limit = args.limit ?? 100;
  if (![args.foreground_size, args.background_size].every(value => Number.isSafeInteger(value) && value >= 0)
    || args.foreground_size > args.background_size || !Number.isSafeInteger(minimum) || minimum < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('lexicon_evidence_invalid');
  const seen = new Set<string>(), excluded = new Set((args.existing_terms ?? []).map(normalize));
  const result: SignalLexiconSuggestionV1[] = [];
  for (const item of args.items) {
    const term = normalize(item.term), identity = JSON.stringify([term, item.language]);
    if (seen.has(identity) || ![item.foreground_roots, item.background_roots].every(value => Number.isSafeInteger(value) && value >= 0)
      || item.foreground_roots > item.background_roots || item.foreground_roots > args.foreground_size
      || item.background_roots > args.background_size) throw Error('lexicon_evidence_invalid');
    seen.add(identity);
    if (!args.foreground_size || !args.background_size || item.foreground_roots < minimum || excluded.has(term)
      || !signalLexiconTermAllowedV1(term, item.language)) continue;
    const lift = ((item.foreground_roots + .5) / (args.foreground_size + 1))
      / ((item.background_roots + .5) / (args.background_size + 1));
    result.push({ ...item, term, lift });
  }
  return result.sort((a, b) => b.lift - a.lift || b.foreground_roots - a.foreground_roots
    || a.term.localeCompare(b.term, 'en') || (a.language ?? '').localeCompare(b.language ?? '', 'en')).slice(0, limit);
}
