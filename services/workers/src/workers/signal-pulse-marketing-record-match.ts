export type SignalPulseMarketingRecordCandidate = {
  record_date: string;
  period_label: string | null;
  platform: string;
  channel: string;
  entity_kind: string;
  entity_name: string | null;
  objective: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  engagement: number;
  creative_text: string | null;
};

export type SignalPulseMarketingRecordMatch = SignalPulseMarketingRecordCandidate & {
  relevance_score: number;
  match_basis: string;
  period_relation: "same_active_period" | "window_only";
  matched_terms: string[];
};

export type SignalPulseMarketingRecordMatchCluster = {
  id: string;
  term: string;
  currentTitle: string;
  mentionCount: number;
  platforms: string[];
  discoveryPeriods: string[];
  memberMentionIds: string[];
  samples: Array<{ id: string; text: string; platform: string; published_at: string | null }>;
};

export type SignalPulseMarketingRecordMatchContext = {
  marketing_brief: Record<string, unknown>;
  repeated_marketing_language: Array<{ phrase: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export type SignalPulseMarketingRecordSemanticMatches = {
  knowledge: Array<{ title: string | null; source_kind: string | null; text: string; similarity: number | null }>;
  conversation: Array<{
    mention_id: string;
    text: string;
    platform: string;
    published_at: string | null;
    period_label: string | null;
    similarity: number | null;
  }>;
};

export function rankSignalPulseMarketingRecordsForCluster(args: {
  cluster: SignalPulseMarketingRecordMatchCluster;
  semanticMatches: SignalPulseMarketingRecordSemanticMatches;
  marketingContext: SignalPulseMarketingRecordMatchContext;
  records: SignalPulseMarketingRecordCandidate[];
  periodLabels: string[];
  limit?: number;
}): SignalPulseMarketingRecordMatch[] {
  const activePeriods = new Set(args.periodLabels.filter(Boolean));
  const evidenceWeights = new Map<string, { weight: number; sources: Set<string> }>();
  const phraseWeights = new Map<string, { weight: number; sources: Set<string> }>();
  const addTerm = (term: string, weight: number, source: string) => {
    const normalized = normalizeText(term).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized || MARKETING_MATCH_STOPWORDS.has(normalized)) return;
    const adjustedWeight = GENERIC_SIGNAL_MATCH_TERMS.has(normalized) ? Math.min(weight, 0.75) : weight;
    const existing = evidenceWeights.get(normalized) ?? { weight: 0, sources: new Set<string>() };
    existing.weight = Math.max(existing.weight, adjustedWeight);
    existing.sources.add(source);
    evidenceWeights.set(normalized, existing);
  };
  const addText = (value: unknown, weight: number, source: string) => {
    for (const token of tokenizeMarketingMatchText(String(value ?? ""))) {
      addTerm(token, weight, source);
    }
  };
  const addPhrase = (value: unknown, weight: number, source: string) => {
    const normalized = normalizeText(String(value ?? "")).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length < 8 || normalized.length > 96) return;
    const existing = phraseWeights.get(normalized) ?? { weight: 0, sources: new Set<string>() };
    existing.weight = Math.max(existing.weight, weight);
    existing.sources.add(source);
    phraseWeights.set(normalized, existing);
  };

  addText(args.cluster.term, 0.35, "provisional_cluster_term");
  addText(args.cluster.currentTitle, 0.35, "provisional_cluster_title");
  for (const sample of args.cluster.samples.slice(0, 8)) {
    addText(sample.text, 3.2, "sample_evidence");
    for (const phrase of extractEvidencePhrases(sample.text).slice(0, 8)) addPhrase(phrase, 4.4, "sample_phrase");
  }
  for (const match of args.semanticMatches.conversation.slice(0, 12)) {
    addText(match.text, 3.6, "semantic_conversation_match");
    for (const phrase of extractEvidencePhrases(match.text).slice(0, 8)) addPhrase(phrase, 4.8, "semantic_conversation_phrase");
  }
  for (const match of args.semanticMatches.knowledge.slice(0, 8)) {
    addText(`${match.title ?? ""} ${match.text}`, 1.4, "knowledge_match");
    for (const phrase of extractEvidencePhrases(`${match.title ?? ""} ${match.text}`).slice(0, 5)) addPhrase(phrase, 2.4, "knowledge_phrase");
  }
  addText(JSON.stringify(args.marketingContext.marketing_brief), 0.8, "marketing_brief");
  for (const language of args.marketingContext.repeated_marketing_language.slice(0, 16)) {
    addText(language.phrase, 1.8, "repeated_marketing_language");
    addPhrase(language.phrase, 3.8, "repeated_marketing_language");
  }

  const clusterPlatforms = new Set(args.cluster.platforms.map((platform) => normalizeText(platform)).filter(Boolean));
  const scored: SignalPulseMarketingRecordMatch[] = args.records.map((record) => {
    const recordText = [
      record.creative_text,
      record.entity_name,
      record.objective,
      record.platform,
      record.channel,
      record.entity_kind
    ].filter(Boolean).join(" ");
    const normalizedRecordText = normalizeText(recordText).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const recordTokens = new Set(tokenizeMarketingMatchText(recordText));
    let score = 0;
    const sources = new Set<string>();
    const matchedTerms = new Set<string>();
    for (const token of recordTokens) {
      const weighted = evidenceWeights.get(token);
      if (!weighted) continue;
      score += weighted.weight;
      matchedTerms.add(token);
      weighted.sources.forEach((source) => sources.add(source));
    }
    for (const [phrase, weighted] of phraseWeights.entries()) {
      if (!normalizedRecordText.includes(phrase)) continue;
      score += weighted.weight;
      matchedTerms.add(phrase);
      weighted.sources.forEach((source) => sources.add(source));
    }
    if (record.period_label && activePeriods.has(record.period_label)) {
      score += matchedTerms.size > 0 ? 1.25 : 0.35;
      sources.add("same_active_period");
    }
    if (clusterPlatforms.has(normalizeText(record.platform))) {
      score += 0.35;
      sources.add("same_platform");
    }
    const periodRelation: SignalPulseMarketingRecordMatch["period_relation"] = record.period_label && activePeriods.has(record.period_label)
      ? "same_active_period"
      : "window_only";
    return {
      ...record,
      relevance_score: round(score, 3),
      match_basis: marketingMatchBasis(sources, matchedTerms.size),
      period_relation: periodRelation,
      matched_terms: Array.from(matchedTerms)
        .sort((a, b) => b.split(" ").length - a.split(" ").length || a.localeCompare(b))
        .slice(0, 10)
    };
  });

  const directMatches = scored
    .filter((record) => record.relevance_score >= 2 || record.matched_terms.length >= 2)
    .sort(marketingRecordSort);
  const samePeriodContext = scored
    .filter((record) => !directMatches.includes(record) && record.period_label && activePeriods.has(record.period_label))
    .sort(marketingRecordSort)
    .slice(0, 4);
  return [...directMatches, ...samePeriodContext]
    .sort(marketingRecordSort)
    .slice(0, args.limit ?? 10);
}

export function marketingRecordSort(left: SignalPulseMarketingRecordMatch, right: SignalPulseMarketingRecordMatch) {
  return right.relevance_score - left.relevance_score
    || right.engagement - left.engagement
    || right.spend - left.spend
    || right.impressions - left.impressions
    || String(right.record_date).localeCompare(String(left.record_date));
}

function tokenizeMarketingMatchText(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !MARKETING_MATCH_STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function extractEvidencePhrases(value: string) {
  const tokens = tokenizeMarketingMatchText(value);
  const phrases: string[] = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(" ");
      if (phrase.length >= 10 && phrase.length <= 96 && !phrases.includes(phrase)) {
        phrases.push(phrase);
      }
    }
  }
  return phrases.slice(0, 32);
}

function marketingMatchBasis(sources: Set<string>, matchedTerms: number) {
  const basis: string[] = [];
  if ([...sources].some((source) => source.includes("sample") || source.includes("semantic_conversation"))) {
    basis.push("evidence_overlap");
  }
  if ([...sources].some((source) => source.includes("knowledge") || source.includes("brief"))) {
    basis.push("knowledge_or_brief_overlap");
  }
  if (sources.has("repeated_marketing_language")) {
    basis.push("repeated_marketing_language_overlap");
  }
  if (sources.has("same_active_period")) {
    basis.push("same_active_period");
  }
  if (sources.has("same_platform")) {
    basis.push("same_platform");
  }
  if (basis.length === 0 && matchedTerms > 0) {
    basis.push("low_confidence_overlap");
  }
  return basis.length > 0 ? basis.join("+") : "same_period_context";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const MARKETING_MATCH_STOPWORDS = new Set([
  "para",
  "pero",
  "como",
  "porque",
  "cuando",
  "donde",
  "quien",
  "cual",
  "cuales",
  "este",
  "esta",
  "estos",
  "estas",
  "todo",
  "toda",
  "todos",
  "todas",
  "algo",
  "mucho",
  "mucha",
  "muchos",
  "muchas",
  "mismo",
  "misma",
  "mismos",
  "mismas",
  "solo",
  "mas",
  "menos",
  "muy",
  "hay",
  "son",
  "fue",
  "ser",
  "sin",
  "con",
  "por",
  "una",
  "uno",
  "unos",
  "unas",
  "los",
  "las",
  "del",
  "and",
  "the",
  "for",
  "with",
  "from",
  "campaign",
  "campana",
  "campaña",
  "adset",
  "creative",
  "trafico",
  "traffic",
  "engagement",
  "conversion",
  "awareness",
  "alcance",
  "interaccion",
  "interacciones",
  "meta",
  "tiktok",
  "facebook",
  "instagram",
  "youtube",
  "organic",
  "organico",
  "paid",
  "pauta"
]);

const GENERIC_SIGNAL_MATCH_TERMS = new Set([
  "seguro",
  "seguros",
  "aseguradora",
  "aseguradoras",
  "auto",
  "autos",
  "vehiculo",
  "vehiculos",
  "vehículo",
  "vehículos",
  "cliente",
  "clientes",
  "servicio",
  "marca",
  "campana",
  "campaña",
  "anuncio",
  "anuncios",
  "publicacion",
  "publicación"
]);
