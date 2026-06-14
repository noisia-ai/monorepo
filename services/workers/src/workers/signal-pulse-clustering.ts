export type TermCluster = {
  term: string;
  mention_count: number;
  platforms: string[];
  sample_mention_ids: string[];
  member_mention_ids: string[];
  sentiment_avg: number | null;
  engagement_sum: number;
  algorithm: "semantic_embedding_neighborhood_v1" | "term_cluster_v2";
  discovery_source?: "global" | "period_first" | "merged";
  discovery_periods?: string[];
  max_period_mention_count?: number;
};

export type EmbeddingNeighborhoodRow = {
  anchor_id: string;
  mention_id: string;
  text_clean: string;
  platform: string | null;
  sentiment_score: string | null;
  engagement_score: string | null;
  similarity: string | null;
};

export type SignalPulseClusterSelectionArgs = {
  globalClusters: TermCluster[];
  periodClusters: TermCluster[];
  maxClusters?: number;
  perPeriod?: number;
};

const STOPWORDS_ES_MX = new Set([
  "para", "pero", "como", "con", "que", "por", "una", "uno", "los", "las", "del", "este", "esta",
  "esto", "muy", "mas", "menos", "porque", "cuando", "todo", "toda", "todos", "todas", "solo", "bien",
  "mal", "sin", "hay", "son", "soy", "fue", "ser", "mis", "sus", "me", "mi", "ya", "no", "si",
  "tambien", "marca", "producto", "personas", "gente", "hacer", "dice", "dicen", "video", "comentario",
  "hasta", "siempre", "ellos", "ellas", "estan", "esta", "estas", "este", "estos", "tiene", "tienen",
  "tener", "sera", "seria", "puede", "pueden", "donde", "quien", "cuando", "ahora", "aqui", "alla",
  "algo", "cada", "mismo", "misma", "mismos", "mismas", "otro", "otra", "otros", "otras"
]);

export function buildEmbeddingNeighborhoodClusters(rows: EmbeddingNeighborhoodRow[]): TermCluster[] {
  const byAnchor = new Map<string, EmbeddingNeighborhoodRow[]>();
  for (const row of rows) {
    if (!row.anchor_id || !row.mention_id || !row.text_clean) continue;
    const current = byAnchor.get(row.anchor_id) ?? [];
    current.push(row);
    byAnchor.set(row.anchor_id, current);
  }

  const assigned = new Set<string>();
  const clusters: TermCluster[] = [];
  for (const [anchorId, group] of byAnchor.entries()) {
    if (assigned.has(anchorId)) continue;
    const members = group
      .slice()
      .sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
      .filter((row) => !assigned.has(row.mention_id));
    if (members.length < 4) continue;

    members.forEach((row) => assigned.add(row.mention_id));
    const term = selectSignalPulseClusterPhrase(members.map((row) => row.text_clean));
    const sentiments = members.map((row) => numberOrNull(row.sentiment_score)).filter((value): value is number => value !== null);
    clusters.push({
      term,
      mention_count: members.length,
      platforms: Array.from(new Set(members.map((row) => row.platform).filter(Boolean) as string[])).slice(0, 8),
      member_mention_ids: members.map((row) => row.mention_id),
      sample_mention_ids: members
        .slice()
        .sort((a, b) => Number(b.engagement_score ?? 0) - Number(a.engagement_score ?? 0))
        .map((row) => row.mention_id)
        .slice(0, 12),
      sentiment_avg: sentiments.length > 0 ? round(sentiments.reduce((sum, item) => sum + item, 0) / sentiments.length, 3) : null,
      engagement_sum: members.reduce((sum, row) => sum + Number(row.engagement_score ?? 0), 0),
      algorithm: "semantic_embedding_neighborhood_v1"
    });
  }

  return clusters
    .sort((a, b) => b.mention_count - a.mention_count || b.engagement_sum - a.engagement_sum || a.term.localeCompare(b.term))
    .slice(0, 120);
}

export function selectPeriodFirstSignalPulseClusters(args: SignalPulseClusterSelectionArgs): TermCluster[] {
  const maxClusters = Math.max(1, args.maxClusters ?? 24);
  const perPeriod = Math.max(1, args.perPeriod ?? 2);
  const merged = new Map<string, TermCluster>();
  const addOrMerge = (cluster: TermCluster) => {
    const key = clusterKey(cluster);
    const existingKey = findMergeKey(merged, cluster) ?? key;
    const existing = merged.get(existingKey);
    merged.set(existingKey, existing ? mergeClusters(existing, cluster) : normalizeCluster(cluster));
  };

  args.globalClusters.forEach(addOrMerge);
  args.periodClusters.forEach(addOrMerge);

  const byPeriod = new Map<string, TermCluster[]>();
  for (const cluster of merged.values()) {
    for (const period of cluster.discovery_periods ?? []) {
      const list = byPeriod.get(period) ?? [];
      list.push(cluster);
      byPeriod.set(period, list);
    }
  }

  const selected = new Map<string, TermCluster>();
  for (const period of Array.from(byPeriod.keys()).sort()) {
    const topForPeriod = (byPeriod.get(period) ?? [])
      .slice()
      .sort(clusterSort)
      .slice(0, perPeriod);
    for (const cluster of topForPeriod) {
      if (selected.size >= maxClusters) break;
      selected.set(clusterKey(cluster), cluster);
    }
  }

  const fill = Array.from(merged.values()).sort(clusterSort);
  for (const cluster of fill) {
    if (selected.size >= maxClusters) break;
    selected.set(clusterKey(cluster), cluster);
  }

  return Array.from(selected.values())
    .sort(clusterSort)
    .slice(0, maxClusters)
    .map((cluster, index) => ({
      ...cluster,
      discovery_source: cluster.discovery_periods?.length && cluster.discovery_source === "global" ? "merged" : cluster.discovery_source,
      max_period_mention_count: cluster.max_period_mention_count ?? cluster.mention_count,
      sample_mention_ids: cluster.sample_mention_ids.slice(0, 12),
      member_mention_ids: cluster.member_mention_ids,
      platforms: cluster.platforms.slice(0, 8),
      term: cluster.term || `signal ${index + 1}`
    }));
}

export function selectSignalPulseClusterPhrase(texts: string[]) {
  const scores = new Map<string, number>();
  for (const text of texts) {
    const tokens = tokenize(text).slice(0, 42);
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length; i += 1) {
      const unigram = tokens[i];
      if (unigram) seen.add(unigram);
      const bigram = tokens[i + 1] ? `${tokens[i]} ${tokens[i + 1]}` : "";
      if (bigram && !tooGenericPhrase(bigram)) seen.add(bigram);
      const trigram = tokens[i + 2] ? `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}` : "";
      if (trigram && !tooGenericPhrase(trigram)) seen.add(trigram);
    }
    for (const phrase of seen) {
      const words = phrase.split(" ").length;
      scores.set(phrase, (scores.get(phrase) ?? 0) + words);
    }
  }
  const [best] = Array.from(scores.entries())
    .filter(([phrase, score]) => score >= 2 && phrase.length <= 46)
    .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]))[0] ?? [];
  return best ?? "señal de conversación";
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !STOPWORDS_ES_MX.has(term));
}

function tooGenericPhrase(phrase: string) {
  const words = phrase.split(" ");
  return words.every((word) => STOPWORDS_ES_MX.has(word) || word.length < 5);
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCluster(cluster: TermCluster): TermCluster {
  return {
    ...cluster,
    discovery_source: cluster.discovery_source ?? "global",
    discovery_periods: Array.from(new Set(cluster.discovery_periods ?? [])).sort(),
    max_period_mention_count: cluster.max_period_mention_count ?? cluster.mention_count,
    member_mention_ids: Array.from(new Set(cluster.member_mention_ids)),
    sample_mention_ids: Array.from(new Set(cluster.sample_mention_ids)),
    platforms: Array.from(new Set(cluster.platforms))
  };
}

function mergeClusters(left: TermCluster, right: TermCluster): TermCluster {
  const leftWeight = Math.max(1, left.mention_count);
  const rightWeight = Math.max(1, right.mention_count);
  const sentiment = weightedAverage(left.sentiment_avg, leftWeight, right.sentiment_avg, rightWeight);
  const discoveryPeriods = Array.from(new Set([...(left.discovery_periods ?? []), ...(right.discovery_periods ?? [])])).sort();
  return {
    term: left.term.length >= right.term.length ? left.term : right.term,
    mention_count: new Set([...left.member_mention_ids, ...right.member_mention_ids]).size,
    platforms: Array.from(new Set([...left.platforms, ...right.platforms])).slice(0, 8),
    sample_mention_ids: Array.from(new Set([...left.sample_mention_ids, ...right.sample_mention_ids])).slice(0, 12),
    member_mention_ids: Array.from(new Set([...left.member_mention_ids, ...right.member_mention_ids])),
    sentiment_avg: sentiment === null ? null : round(sentiment, 3),
    engagement_sum: left.engagement_sum + right.engagement_sum,
    algorithm: left.algorithm === "semantic_embedding_neighborhood_v1" ? left.algorithm : right.algorithm,
    discovery_source: left.discovery_source === right.discovery_source ? left.discovery_source : "merged",
    discovery_periods: discoveryPeriods,
    max_period_mention_count: Math.max(left.max_period_mention_count ?? left.mention_count, right.max_period_mention_count ?? right.mention_count)
  };
}

function findMergeKey(clusters: Map<string, TermCluster>, candidate: TermCluster) {
  const direct = clusterKey(candidate);
  if (clusters.has(direct)) return direct;
  const candidateMembers = new Set(candidate.member_mention_ids);
  if (candidateMembers.size === 0) return null;
  for (const [key, cluster] of clusters.entries()) {
    const overlap = cluster.member_mention_ids.filter((id) => candidateMembers.has(id)).length;
    const denominator = Math.min(candidateMembers.size, Math.max(1, cluster.member_mention_ids.length));
    if (overlap / denominator >= 0.5) return key;
  }
  return null;
}

function clusterKey(cluster: TermCluster) {
  return normalizeKey(cluster.term);
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "signal";
}

function clusterSort(a: TermCluster, b: TermCluster) {
  return (b.max_period_mention_count ?? b.mention_count) - (a.max_period_mention_count ?? a.mention_count)
    || b.mention_count - a.mention_count
    || b.engagement_sum - a.engagement_sum
    || a.term.localeCompare(b.term);
}

function weightedAverage(left: number | null, leftWeight: number, right: number | null, rightWeight: number) {
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return ((left * leftWeight) + (right * rightWeight)) / (leftWeight + rightWeight);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
