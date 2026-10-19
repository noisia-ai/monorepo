export type SignalPulseMarketingActivityRow = {
  month: string;
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

export type SignalPulseMarketingActivityMonth = {
  month: string;
  records: number;
  spend: number;
  impressions: number;
  clicks: number;
  engagement: number;
  platforms: string[];
  channels: string[];
  objectives: string[];
  top_entities: Array<{
    entity_kind: string;
    entity_name: string | null;
    objective: string | null;
    platform: string;
    channel: string;
    records: number;
    spend: number;
    impressions: number;
    engagement: number;
  }>;
  top_creative_excerpts: string[];
};

export type SignalPulseRepeatedMarketingLanguage = {
  phrase: string;
  months: string[];
  first_month: string;
  last_month: string;
  records: number;
  spend: number;
  impressions: number;
  engagement: number;
  platforms: string[];
  channels: string[];
  example_creatives: string[];
};

export function summarizeSignalPulseMarketingActivity(rows: SignalPulseMarketingActivityRow[]): {
  months: SignalPulseMarketingActivityMonth[];
  repeatedLanguage: SignalPulseRepeatedMarketingLanguage[];
} {
  const monthMap = new Map<string, {
    records: number;
    spend: number;
    impressions: number;
    clicks: number;
    engagement: number;
    platforms: Set<string>;
    channels: Set<string>;
    objectives: Set<string>;
    entities: Map<string, SignalPulseMarketingActivityMonth["top_entities"][number]>;
    excerpts: string[];
  }>();
  const phraseMap = new Map<string, {
    months: Set<string>;
    records: number;
    spend: number;
    impressions: number;
    engagement: number;
    platforms: Set<string>;
    channels: Set<string>;
    examples: string[];
  }>();

  for (const row of rows) {
    if (!row.month) continue;
    const month = getOrCreate(monthMap, row.month, () => ({
      records: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      engagement: 0,
      platforms: new Set<string>(),
      channels: new Set<string>(),
      objectives: new Set<string>(),
      entities: new Map<string, SignalPulseMarketingActivityMonth["top_entities"][number]>(),
      excerpts: []
    }));
    month.records += 1;
    month.spend += row.spend;
    month.impressions += row.impressions;
    month.clicks += row.clicks;
    month.engagement += row.engagement;
    if (row.platform) month.platforms.add(row.platform);
    if (row.channel) month.channels.add(row.channel);
    if (row.objective) month.objectives.add(row.objective);

    const entityKey = [row.entity_kind, row.entity_name, row.objective, row.platform, row.channel].join("|");
    const entity = getOrCreate(month.entities, entityKey, () => ({
      entity_kind: row.entity_kind,
      entity_name: row.entity_name,
      objective: row.objective,
      platform: row.platform,
      channel: row.channel,
      records: 0,
      spend: 0,
      impressions: 0,
      engagement: 0
    }));
    entity.records += 1;
    entity.spend += row.spend;
    entity.impressions += row.impressions;
    entity.engagement += row.engagement;

    const creativeExcerpt = compactText(row.creative_text, 180);
    if (creativeExcerpt && !month.excerpts.includes(creativeExcerpt) && month.excerpts.length < 6) {
      month.excerpts.push(creativeExcerpt);
    }

    const phraseSource = [row.creative_text, row.entity_name, row.objective].filter(Boolean).join(" ");
    for (const phrase of extractMarketingLanguagePhrases(phraseSource).slice(0, 10)) {
      const phraseStats = getOrCreate(phraseMap, phrase, () => ({
        months: new Set<string>(),
        records: 0,
        spend: 0,
        impressions: 0,
        engagement: 0,
        platforms: new Set<string>(),
        channels: new Set<string>(),
        examples: []
      }));
      phraseStats.months.add(row.month);
      phraseStats.records += 1;
      phraseStats.spend += row.spend;
      phraseStats.impressions += row.impressions;
      phraseStats.engagement += row.engagement;
      if (row.platform) phraseStats.platforms.add(row.platform);
      if (row.channel) phraseStats.channels.add(row.channel);
      if (creativeExcerpt && !phraseStats.examples.includes(creativeExcerpt) && phraseStats.examples.length < 3) {
        phraseStats.examples.push(creativeExcerpt);
      }
    }
  }

  const months = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-36)
    .map(([month, value]) => ({
      month,
      records: value.records,
      spend: round(value.spend, 2),
      impressions: round(value.impressions, 2),
      clicks: round(value.clicks, 2),
      engagement: round(value.engagement, 2),
      platforms: [...value.platforms].sort().slice(0, 8),
      channels: [...value.channels].sort().slice(0, 8),
      objectives: [...value.objectives].sort().slice(0, 8),
      top_entities: [...value.entities.values()]
        .sort((a, b) => b.spend - a.spend || b.impressions - a.impressions || b.engagement - a.engagement || b.records - a.records)
        .slice(0, 5)
        .map((entity) => ({
          ...entity,
          spend: round(entity.spend, 2),
          impressions: round(entity.impressions, 2),
          engagement: round(entity.engagement, 2)
        })),
      top_creative_excerpts: value.excerpts.slice(0, 4)
    }));

  const repeatedLanguage = [...phraseMap.entries()]
    .map(([phrase, value]) => {
      const monthsForPhrase = [...value.months].sort();
      return {
        phrase,
        months: monthsForPhrase,
        first_month: monthsForPhrase[0] ?? "",
        last_month: monthsForPhrase.at(-1) ?? "",
        records: value.records,
        spend: round(value.spend, 2),
        impressions: round(value.impressions, 2),
        engagement: round(value.engagement, 2),
        platforms: [...value.platforms].sort().slice(0, 8),
        channels: [...value.channels].sort().slice(0, 8),
        example_creatives: value.examples
      };
    })
    .filter((item) => item.months.length >= 2 || item.records >= 4)
    .sort((a, b) => b.months.length - a.months.length || b.spend - a.spend || b.engagement - a.engagement || b.records - a.records)
    .slice(0, 16);

  return { months, repeatedLanguage };
}

function extractMarketingLanguagePhrases(value: string) {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !MARKETING_PHRASE_STOPWORDS.has(token) && !/^\d+$/.test(token));
  const phrases: string[] = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(" ");
      if (phrase.length >= 8 && phrase.length <= 72 && !phrases.includes(phrase)) {
        phrases.push(phrase);
      }
    }
  }
  return phrases.slice(0, 24);
}

function compactText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = factory();
  map.set(key, created);
  return created;
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

const MARKETING_PHRASE_STOPWORDS = new Set([
  "para",
  "por",
  "con",
  "sin",
  "los",
  "las",
  "una",
  "uno",
  "del",
  "que",
  "como",
  "mas",
  "muy",
  "todo",
  "toda",
  "todos",
  "todas",
  "este",
  "esta",
  "estos",
  "estas",
  "desde",
  "hasta",
  "sobre",
  "entre",
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
