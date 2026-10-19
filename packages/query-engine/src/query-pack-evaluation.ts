export const QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE = 10;
export const QUERY_PACK_IMPORTED_SAMPLE_SIZE = 100;
export const QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE = 25;
export const QUERY_PACK_EVALUATOR_PIPELINE_VERSION = "query-pack-evaluator-v9-imported-evidence";

export const QUERY_PACK_READY_THRESHOLDS = {
  quality: 7,
  density: 7,
  noise: 3
} as const;

export type QueryPackRelevance = "relevant" | "partial" | "noise";

export type QueryPackMention = {
  id: string;
  text_snippet: string;
  platform: string;
  language: string | null;
  country: string | null;
  sentiment_source: string | null;
};

export type QueryPackClassification = {
  mention_id: string;
  relevance: QueryPackRelevance;
  signal_types: string[];
  reason: string;
};

export type QueryPackMetrics = {
  quality_score: number;
  density_score: number;
  noise_score: number;
  relevant_count: number;
  partial_count: number;
  noise_count: number;
  sample_size: number;
  language_target_pct: number | null;
  language_known_count: number;
  geo_target_pct: number | null;
  geo_known_count: number;
};

export type QueryPackEvaluatorPromptInput = {
  pack: {
    scope: string;
    signalIntent: string;
    objective: string | null;
    queryText: string;
  };
  study: {
    methodologySlug: string;
    businessQuestion: string | null;
    audienceSegment: string | null;
    geoFocus: string[];
  };
  subject: Record<string, unknown>;
  queryStrategyBrief?: unknown;
  knowledgeSources?: unknown[];
  sample: QueryPackMention[];
};

export function buildQueryPackEvaluatorPrompt(input: QueryPackEvaluatorPromptInput): string {
  return [
    "Eres el evaluador interno de queries de Noisia.",
    "Evalua EXCLUSIVAMENTE si cada mencion sirve al objetivo de este query pack y a la pregunta del estudio.",
    "No calcules scores. No inventes cobertura. El sistema calcula todas las metricas con tus clasificaciones.",
    "Devuelve una clasificacion para cada mention_id recibido, exactamente una vez y sin IDs adicionales.",
    "Relevancia:",
    "- relevant: evidencia directa y util para el objetivo del pack.",
    "- partial: relacionada, pero ambigua, superficial o con señal incompleta.",
    "- noise: fuera de marca/categoria/mercado, spam, noticia sin experiencia, coincidencia lexical o irrelevante.",
    "signal_types debe usar etiquetas breves y reutilizables como trigger, barrier, experience, comparison, category_language o noise_reason.",
    "No reescribas la query. proposed_adjustments describe problemas observados; otro paso gobernado compila y valida cualquier nueva version.",
    "No agregues Markdown.",
    "",
    "CONTEXTO DEL PACK:",
    JSON.stringify(
      {
        pack: input.pack,
        study: input.study,
        subject: input.subject,
        query_strategy_brief: input.queryStrategyBrief ?? null,
        knowledge_sources: input.knowledgeSources ?? []
      },
      null,
      2
    ),
    "",
    `MUESTRA (${input.sample.length} menciones):`,
    input.sample
      .map(
        (mention) =>
          `mention_id=${mention.id}\nplatform=${mention.platform} lang=${mention.language ?? "?"} country=${mention.country ?? "?"} sentiment=${mention.sentiment_source ?? "?"}\n${mention.text_snippet}`
      )
      .join("\n\n")
  ].join("\n");
}

export function validateQueryPackClassifications(
  sample: QueryPackMention[],
  classifications: QueryPackClassification[]
): QueryPackClassification[] {
  const expected = new Set(sample.map((mention) => mention.id));
  const seen = new Set<string>();

  for (const classification of classifications) {
    if (!expected.has(classification.mention_id)) {
      throw new Error(`Evaluator returned unknown mention_id: ${classification.mention_id}`);
    }
    if (seen.has(classification.mention_id)) {
      throw new Error(`Evaluator returned duplicate mention_id: ${classification.mention_id}`);
    }
    seen.add(classification.mention_id);
  }

  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`Evaluator omitted ${missing.length} mention(s): ${missing.slice(0, 3).join(", ")}`);
  }

  return classifications;
}

export function computeQueryPackMetrics(input: {
  sample: QueryPackMention[];
  classifications: QueryPackClassification[];
  targetLanguages?: string[];
  targetCountries?: string[];
}): QueryPackMetrics {
  const classifications = validateQueryPackClassifications(input.sample, input.classifications);
  const relevantCount = classifications.filter((item) => item.relevance === "relevant").length;
  const partialCount = classifications.filter((item) => item.relevance === "partial").length;
  const noiseCount = classifications.filter((item) => item.relevance === "noise").length;
  const sampleSize = input.sample.length;

  if (sampleSize === 0) {
    throw new Error("Cannot compute query-pack metrics from an empty sample.");
  }

  const languages = normalizeCodes(input.targetLanguages ?? []);
  const countries = normalizeCodes(input.targetCountries ?? []);
  const knownLanguages = input.sample.filter((mention) => Boolean(mention.language));
  const knownCountries = input.sample.filter((mention) => Boolean(mention.country));

  return {
    quality_score: roundScore(((relevantCount + partialCount * 0.35) / sampleSize) * 10),
    density_score: roundScore(((relevantCount + partialCount) / sampleSize) * 10),
    noise_score: roundScore((noiseCount / sampleSize) * 10),
    relevant_count: relevantCount,
    partial_count: partialCount,
    noise_count: noiseCount,
    sample_size: sampleSize,
    language_target_pct: coveragePct(knownLanguages.map((mention) => mention.language), languages),
    language_known_count: knownLanguages.length,
    geo_target_pct: coveragePct(knownCountries.map((mention) => mention.country), countries),
    geo_known_count: knownCountries.length
  };
}

export function isQueryPackReady(metrics: QueryPackMetrics): boolean {
  return metrics.quality_score >= QUERY_PACK_READY_THRESHOLDS.quality
    && metrics.density_score >= QUERY_PACK_READY_THRESHOLDS.density
    && metrics.noise_score <= QUERY_PACK_READY_THRESHOLDS.noise;
}

export function aggregateQueryPackMetrics(metrics: QueryPackMetrics[]): QueryPackMetrics {
  const total = metrics.reduce((sum, item) => sum + item.sample_size, 0);
  if (total === 0) {
    throw new Error("Cannot aggregate empty query-pack metrics.");
  }

  const weighted = (key: "quality_score" | "density_score" | "noise_score") =>
    roundScore(metrics.reduce((sum, item) => sum + item[key] * item.sample_size, 0) / total);
  const languageKnown = metrics.reduce((sum, item) => sum + item.language_known_count, 0);
  const geoKnown = metrics.reduce((sum, item) => sum + item.geo_known_count, 0);

  return {
    quality_score: weighted("quality_score"),
    density_score: weighted("density_score"),
    noise_score: weighted("noise_score"),
    relevant_count: metrics.reduce((sum, item) => sum + item.relevant_count, 0),
    partial_count: metrics.reduce((sum, item) => sum + item.partial_count, 0),
    noise_count: metrics.reduce((sum, item) => sum + item.noise_count, 0),
    sample_size: total,
    language_target_pct: weightedCoverage(metrics, "language_target_pct", "language_known_count"),
    language_known_count: languageKnown,
    geo_target_pct: weightedCoverage(metrics, "geo_target_pct", "geo_known_count"),
    geo_known_count: geoKnown
  };
}

/**
 * @deprecated Compatibility helper for old provider-sample workflows.
 * Production query construction must use buildQueryConstructionPlan() and the
 * portable semantic compiler. The 250-character default is not a production
 * query limit and this helper must not rewrite governed query packs.
 */
export function buildCompactBooleanQuery(input: {
  queryText?: string | null;
  scopeSeeds?: string[];
  phraseHints?: string[];
  maxLength?: number;
}): string {
  const maxLength = Math.max(40, input.maxLength ?? 250);
  const normalizedQuery = normalizeBooleanListeningQuery(input.queryText ?? "");

  // A refinement is already a complete boolean expression. Preserve its
  // AND/OR/NOT semantics when it fits the portable query contract instead of rebuilding it from
  // quoted terms, which would silently turn a precise query into a broad OR.
  if (
    normalizedQuery
    && normalizedQuery.length <= maxLength
    && isBalancedBooleanQuery(normalizedQuery)
  ) {
    return normalizedQuery;
  }

  const scopes = uniqueTerms(input.scopeSeeds ?? []);
  const phrases = uniqueTerms(input.phraseHints ?? []);

  const candidates: string[] = [];
  if (scopes.length > 0 && phrases.length > 0) {
    for (let scopeCount = Math.min(3, scopes.length); scopeCount >= 1; scopeCount -= 1) {
      for (let phraseCount = Math.min(4, phrases.length); phraseCount >= 1; phraseCount -= 1) {
        candidates.push(`(${orGroup(scopes.slice(0, scopeCount))}) AND (${orGroup(phrases.slice(0, phraseCount))})`);
      }
    }
  }
  if (scopes.length > 0) candidates.push(`(${orGroup(scopes.slice(0, 5))})`);
  if (phrases.length > 0) candidates.push(`(${orGroup(phrases.slice(0, 5))})`);

  const fit = candidates.find((candidate) => candidate.length <= maxLength);
  if (fit) return fit;

  const rawTerms = uniqueTerms(extractQuotedTerms(normalizedQuery));
  const rawCandidate = rawTerms.length > 0 ? `(${orGroup(rawTerms.slice(0, 5))})` : "";
  if (rawCandidate && rawCandidate.length <= maxLength) return rawCandidate;

  const fallback = uniqueTerms([...scopes, ...phrases, ...rawTerms])[0];
  if (!fallback) {
    throw new Error("Query pack has no usable seeds for an external listening sample.");
  }
  return quoteTerm(fallback).slice(0, maxLength);
}

/**
 * @deprecated Compatibility candidates for old provider-sample workflows.
 * Imported-evidence evaluation never executes these candidates. Refinement is
 * compiled from the versioned ANCHOR/THEME/NOISE construction plan instead.
 */
export function buildQueryValidationCandidates(input: {
  queryText?: string | null;
  scopeSeeds?: string[];
  phraseHints?: string[];
  maxLength?: number;
}): string[] {
  const maxLength = input.maxLength ?? 250;
  const candidates = [
    buildCompactBooleanQuery({ ...input, maxLength }),
    ...(input.scopeSeeds?.length
      ? [buildCompactBooleanQuery({ scopeSeeds: input.scopeSeeds, maxLength })]
      : []),
    ...(input.scopeSeeds?.length && input.phraseHints?.length
      ? [buildCompactBooleanQuery({
          scopeSeeds: input.scopeSeeds,
          phraseHints: input.phraseHints,
          maxLength
        })]
      : [])
  ];

  return [...new Set(candidates)].filter(
    (candidate) => candidate.length <= maxLength && isBalancedBooleanQuery(candidate)
  );
}

export function isBalancedBooleanQuery(query: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === '"' && query[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && !quoted;
}

/** Normalizes the portable boolean form used by external listening exports. */
export function normalizeBooleanListeningQuery(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\)\s+NOT\s+\(/gi, ") AND NOT (");
}

function extractQuotedTerms(query: string): string[] {
  return [...query.matchAll(/"([^"\\]{2,80})"/g)].map((match) => match[1] ?? "");
}

function quoteTerm(term: string): string {
  return `"${term.replace(/["\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60)}"`;
}

function orGroup(terms: string[]): string {
  return terms.map(quoteTerm).join(" OR ");
}

function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 2))];
}

function normalizeCodes(values: string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => [value, value.match(/\(([A-Za-z]{2})\)/)?.[1] ?? ""])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function coveragePct(values: Array<string | null>, targets: Set<string>): number | null {
  const known = values.map((value) => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value));
  if (known.length === 0 || targets.size === 0) return null;
  const matched = known.filter((value) => targets.has(value)).length;
  return Math.round((matched / known.length) * 1000) / 10;
}

function weightedCoverage(
  metrics: QueryPackMetrics[],
  pctKey: "language_target_pct" | "geo_target_pct",
  countKey: "language_known_count" | "geo_known_count"
): number | null {
  const known = metrics.reduce((sum, item) => sum + item[countKey], 0);
  if (known === 0) return null;
  const total = metrics.reduce((sum, item) => sum + (item[pctKey] ?? 0) * item[countKey], 0);
  return Math.round((total / known) * 10) / 10;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(10, value)) * 100) / 100;
}
