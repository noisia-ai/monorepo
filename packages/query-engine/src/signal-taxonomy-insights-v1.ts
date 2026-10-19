import { createHash } from "node:crypto";

import { SignalBackendContractError } from "./signal-backend-v1";
import type {
  SignalEvidenceSentimentDominantV1,
  SignalTaxonomyKindV1
} from "./signal-topics-narratives-v1";

export const SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION =
  "signal-taxonomy-insights-v1" as const;
export const SIGNAL_TAXONOMY_INSIGHT_PACKET_VERSION =
  "signal-taxonomy-insight-packet-v1" as const;
export const SIGNAL_TAXONOMY_INSIGHT_JOB_NAME =
  "signal.topics-narratives-insights.v1" as const;
export const SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY =
  "topics_narratives.insights" as const;
export const SIGNAL_TAXONOMY_INSIGHT_PROMPT_VERSION =
  "signal-topics-narratives-insights-research-v1" as const;
export const SIGNAL_TAXONOMY_INSIGHT_MODEL_VERSION =
  "claude-sonnet-4-5" as const;
export const SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY =
  "topics_narratives.insight_analysis.v1" as const;
// Migration 0052 constrains interpretation runs to at most two minutes.
export const SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS = 120_000;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_BUDGET_USD = 16;
export const SIGNAL_TAXONOMY_INSIGHT_DEFAULT_BUDGET_USD = 4;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS = 200;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS = 120_000;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS = 20;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS = 30_000;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES = 6;
export const SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SOURCES = 8;

export type SignalTaxonomyInsightLocalizedTextV1 = {
  en_us: string;
  es_mx: string;
};

export type SignalTaxonomyInsightTermV1 = {
  kind: SignalTaxonomyKindV1;
  term_key: string;
  label: string;
  definition: string | null;
};

export type SignalTaxonomyInsightMentionV1 = {
  mention_id: string;
  occurred_at: string;
  text: string;
  platform: string;
  sentiment: SignalEvidenceSentimentDominantV1;
  engagement: number;
  conversation_root: string;
  topic_keys: string[];
  narrative_keys: string[];
};

export type SignalTaxonomyInsightTermMetricV1 = {
  kind: SignalTaxonomyKindV1;
  term_key: string;
  label: string;
  current_mentions: number;
  previous_mentions: number | null;
  current_share: number | null;
  previous_share: number | null;
};

export type SignalTaxonomyInsightContextRefV1 = {
  source_type:
    | "brand_os_objective"
    | "brand_os_brief"
    | "brand_os_audience"
    | "knowledge_assertion"
    | "knowledge_source";
  source_id: string;
  title: string;
  content: string;
  content_hash: string;
};

export type SignalTaxonomyInsightPacketV1 = {
  contract_version: typeof SIGNAL_TAXONOMY_INSIGHT_PACKET_VERSION;
  workspace_id: string;
  study_corpus_id: string;
  organization_id: string | null;
  brand_id: string | null;
  timezone: string;
  window: { start: string; end: string; days: number };
  comparison_window: { start: string; end: string; days: number } | null;
  population: {
    current_mentions: number;
    previous_mentions: number | null;
  };
  context: {
    state: "ready" | "partial" | "not_available";
    ref_count: number;
    context_hash: string;
  };
  sampling: {
    policy_version: "signal-taxonomy-insight-stratified-v1";
    max_mentions: number;
    max_chars: number;
    analyzed_mentions: number;
    analyzed_chars: number;
    deduplicated_conversation_roots: number;
    truncated: boolean;
  };
  terms: SignalTaxonomyInsightTermV1[];
  term_metrics: SignalTaxonomyInsightTermMetricV1[];
  mentions: SignalTaxonomyInsightMentionV1[];
};

export type SignalTaxonomyInsightJobDataV1 = {
  contract_version: "signal-taxonomy-insight-job-v1";
  requested_by_user_id: string;
  packet: SignalTaxonomyInsightPacketV1;
  packet_hash: string;
  filters_hash: string;
  data_watermark_hash: string;
  idempotency_key: string;
  budget_cap_usd: number;
  prompt_version: typeof SIGNAL_TAXONOMY_INSIGHT_PROMPT_VERSION;
  model_version: string;
};

export type SignalTaxonomyInsightResearchSourceV1 = {
  source_id: string;
  url: string;
  title: string | null;
  retrieved_at: string;
  source_kind: "external_context";
};

export type SignalTaxonomyInsightItemV1 = {
  insight_id: string;
  priority: number;
  kind:
    | "emergent_language"
    | "experience_pattern"
    | "cross_term_tension"
    | "contextual_shift";
  tone: "positive" | "negative" | "neutral" | "attention";
  status: "observed" | "contextually_supported" | "plausible";
  title: SignalTaxonomyInsightLocalizedTextV1;
  headline: SignalTaxonomyInsightLocalizedTextV1;
  explanation: SignalTaxonomyInsightLocalizedTextV1;
  why_it_matters: SignalTaxonomyInsightLocalizedTextV1;
  confidence: "high" | "medium" | "low";
  topic_keys: string[];
  narrative_keys: string[];
  supporting_mention_ids: string[];
  counterevidence_mention_ids: string[];
  internal_context_refs: Array<{
    source_type: SignalTaxonomyInsightContextRefV1["source_type"];
    source_id: string;
  }>;
  external_source_ids: string[];
  limitations: SignalTaxonomyInsightLocalizedTextV1[];
  chart: {
    type: "bar";
    items: Array<{ key: string; value: number }>;
  };
};

export type SignalTaxonomyInsightResultV1 = {
  contract_version: typeof SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION;
  packet_hash: string;
  cadence: "rolling_30_days";
  independent_of_page_filter: true;
  window: SignalTaxonomyInsightPacketV1["window"];
  comparison_window: SignalTaxonomyInsightPacketV1["comparison_window"];
  calculated_through: string;
  sample: {
    analyzed_mentions: number;
    population_mentions: number;
    analyzed_chars: number;
    limit: number;
    truncated: boolean;
  };
  research: {
    web_searches_used: number;
    sources: SignalTaxonomyInsightResearchSourceV1[];
  };
  items: SignalTaxonomyInsightItemV1[];
};

export type SignalTaxonomyInsightsServingV1 = {
  contract_version: typeof SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION;
  state: "ready" | "pending" | "failed" | "not_available";
  run: {
    id: string;
    status: string;
    budget_cap_usd: number;
    estimated_cost_usd: number;
    actual_cost_usd: number;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
  } | null;
  enrichment: {
    analyzed_mentions: number;
    persisted_mentions: number;
    complete: boolean;
  };
  result: SignalTaxonomyInsightResultV1 | null;
};

export function signalTaxonomyInsightPacketHashV1(
  packet: SignalTaxonomyInsightPacketV1
) {
  return hashCanonical(packet);
}

export function signalTaxonomyInsightIdempotencyKeyV1(input: {
  workspace_id: string;
  study_corpus_id: string;
  packet_hash: string;
  prompt_version: string;
  model_version: string;
}) {
  return hashCanonical(input);
}

export function validateSignalTaxonomyInsightJobDataV1(
  input: SignalTaxonomyInsightJobDataV1
) {
  if (input.contract_version !== "signal-taxonomy-insight-job-v1") {
    throw invalid("Unsupported Topics & Narratives insight job contract.");
  }
  if (
    input.packet.contract_version !== SIGNAL_TAXONOMY_INSIGHT_PACKET_VERSION
    || input.packet.window.days < 1
    || input.packet.window.days > 30
  ) {
    throw invalid("Topics & Narratives insights require a rolling window of at most thirty days.");
  }
  if (
    input.packet.mentions.length < 1
    || input.packet.mentions.length > SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS
    || input.packet.sampling.analyzed_mentions !== input.packet.mentions.length
  ) {
    throw invalid("Topics & Narratives insight sample is outside the governed mention limit.");
  }
  const analyzedChars = input.packet.mentions.reduce(
    (total, mention) => total + mention.text.length,
    0
  );
  if (
    analyzedChars !== input.packet.sampling.analyzed_chars
    || analyzedChars > SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS
  ) {
    throw invalid("Topics & Narratives insight sample is outside the governed character limit.");
  }
  if (new Set(input.packet.mentions.map((mention) => mention.mention_id)).size !== input.packet.mentions.length) {
    throw invalid("Topics & Narratives insight sample contains duplicate mentions.");
  }
  if (new Set(input.packet.mentions.map((mention) => mention.conversation_root)).size !== input.packet.mentions.length) {
    throw invalid("Topics & Narratives insight sample contains duplicate conversation roots.");
  }
  if (input.packet_hash !== signalTaxonomyInsightPacketHashV1(input.packet)) {
    throw invalid("Topics & Narratives insight packet hash is invalid.");
  }
  if (
    !Number.isFinite(input.budget_cap_usd)
    || input.budget_cap_usd <= 0
    || input.budget_cap_usd > SIGNAL_TAXONOMY_INSIGHT_MAX_BUDGET_USD
  ) {
    throw invalid("Topics & Narratives insight budget is outside the approved range.");
  }
  return input;
}

export function selectSignalTaxonomyInsightMentionSampleV1(
  candidates: SignalTaxonomyInsightMentionV1[],
  options: {
    maxMentions?: number;
    maxChars?: number;
  } = {}
) {
  const maxMentions = Math.max(
    1,
    Math.min(
      Math.floor(options.maxMentions ?? SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS),
      SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS
    )
  );
  const maxChars = Math.max(
    1,
    Math.min(
      Math.floor(options.maxChars ?? SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS),
      SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS
    )
  );
  const roots = new Map<string, SignalTaxonomyInsightMentionV1>();
  for (const mention of candidates) {
    const current = roots.get(mention.conversation_root);
    if (!current || mentionPriority(mention, current) < 0) {
      roots.set(mention.conversation_root, mention);
    }
  }
  const unique = [...roots.values()];
  const buckets = new Map<string, SignalTaxonomyInsightMentionV1[]>();
  for (const mention of unique) {
    const week = isoWeekStart(mention.occurred_at);
    const strata = new Set([
      `week:${week}:platform:${mention.platform}:sentiment:${mention.sentiment}`,
      ...mention.topic_keys.map((key) => `topic:${key}`),
      ...mention.narrative_keys.map((key) => `narrative:${key}`)
    ]);
    if (strata.size === 1) strata.add("unclassified");
    for (const stratum of strata) {
      const values = buckets.get(stratum) ?? [];
      values.push(mention);
      buckets.set(stratum, values);
    }
  }
  for (const values of buckets.values()) values.sort(mentionPriority);
  const selected: SignalTaxonomyInsightMentionV1[] = [];
  const selectedIds = new Set<string>();
  let analyzedChars = 0;
  const orderedBuckets = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right));
  let round = 0;
  while (selected.length < maxMentions) {
    let added = false;
    for (const [, values] of orderedBuckets) {
      const mention = values[round];
      if (!mention || selectedIds.has(mention.mention_id)) continue;
      if (analyzedChars + mention.text.length > maxChars) continue;
      selected.push(mention);
      selectedIds.add(mention.mention_id);
      analyzedChars += mention.text.length;
      added = true;
      if (selected.length >= maxMentions) break;
    }
    if (!added) break;
    round += 1;
  }
  if (selected.length < maxMentions) {
    for (const mention of [...unique].sort(mentionPriority)) {
      if (selectedIds.has(mention.mention_id)) continue;
      if (analyzedChars + mention.text.length > maxChars) continue;
      selected.push(mention);
      selectedIds.add(mention.mention_id);
      analyzedChars += mention.text.length;
      if (selected.length >= maxMentions) break;
    }
  }
  return {
    mentions: selected,
    analyzedChars,
    deduplicatedConversationRoots: unique.length,
    truncated: selected.length < unique.length
  };
}

function mentionPriority(
  left: SignalTaxonomyInsightMentionV1,
  right: SignalTaxonomyInsightMentionV1
) {
  return right.engagement - left.engagement
    || right.occurred_at.localeCompare(left.occurred_at)
    || left.mention_id.localeCompare(right.mention_id);
}

function isoWeekStart(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function hashCanonical(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function invalid(message: string, details: Record<string, unknown> = {}) {
  return new SignalBackendContractError("not_available", message, details);
}
