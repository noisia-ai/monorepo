import {
  SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
  SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY,
  SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS,
  SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS,
  SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY,
  SIGNAL_TAXONOMY_INSIGHT_PACKET_VERSION,
  selectSignalTaxonomyInsightMentionSampleV1,
  type SignalEvidenceSentimentDominantV1,
  type SignalTaxonomyInsightMentionV1,
  type SignalTaxonomyInsightPacketV1,
  type SignalTaxonomyInsightResultV1,
  type SignalTaxonomyInsightsServingV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { SignalOperationalReadScopeV1 } from "@/lib/data-os/signal-operational-read-scope";
import {
  requireOperationalCorpus,
  type ResolvedSignalWorkspace
} from "@/lib/data-os/signal-workspace";

type MentionCandidateRow = {
  mention_id: string;
  occurred_at: Date;
  text: string;
  platform: string;
  sentiment_score: string | null;
  engagement: string;
  conversation_root: string;
  topic_keys: string[];
  narrative_keys: string[];
};

type TermMetricRow = {
  kind: "topic" | "narrative";
  term_key: string;
  label: string;
  description: string | null;
  current_mentions: number;
  previous_mentions: number;
};

export async function prepareSignalTaxonomyInsightPacketV1(
  workspace: ResolvedSignalWorkspace
): Promise<SignalTaxonomyInsightPacketV1> {
  const corpus = requireOperationalCorpus(workspace);
  const coverage = await pool.query<{
    date_from: string | null;
    date_through: string | null;
  }>(`
    SELECT
      min(published_at)::date::text AS date_from,
      max(published_at)::date::text AS date_through
    FROM mentions
    WHERE study_corpus_id = $1::uuid
      AND inclusion_status = 'included'
  `, [corpus.id]);
  const dateFrom = coverage.rows[0]?.date_from;
  const dateThrough = coverage.rows[0]?.date_through;
  if (!dateFrom || !dateThrough) {
    throw new Error("Topics & Narratives insights require included mentions.");
  }
  const currentStart = maxIsoDate(dateFrom, shiftIsoDate(dateThrough, -29));
  const currentDays = inclusiveDays(currentStart, dateThrough);
  const previousEnd = shiftIsoDate(currentStart, -1);
  const previousStart = shiftIsoDate(previousEnd, -(currentDays - 1));
  const comparisonWindow = previousStart >= dateFrom
    ? { start: previousStart, end: previousEnd, days: currentDays }
    : null;
  const [population, context, candidates, metricRows] = await Promise.all([
    loadPopulation(
      corpus.id,
      workspace.id,
      currentStart,
      dateThrough,
      comparisonWindow
    ),
    loadContextWatermark(workspace, corpus.id),
    loadMentionCandidates(corpus.id, workspace.id, currentStart, dateThrough),
    loadTermMetrics(
      corpus.id,
      workspace.id,
      currentStart,
      dateThrough,
      comparisonWindow
    )
  ]);
  const sampled = selectSignalTaxonomyInsightMentionSampleV1(
    candidates.map(mapMentionCandidate),
    {
      maxMentions: SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS,
      maxChars: SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS
    }
  );
  if (sampled.mentions.length === 0) {
    throw new Error("Topics & Narratives insight sample is empty.");
  }
  const terms = metricRows.map((row) => ({
    kind: row.kind,
    term_key: row.term_key,
    label: row.label,
    definition: row.description
  }));
  return {
    contract_version: SIGNAL_TAXONOMY_INSIGHT_PACKET_VERSION,
    workspace_id: workspace.id,
    study_corpus_id: corpus.id,
    organization_id: workspace.organizationId,
    brand_id: workspace.subject.type === "brand" ? workspace.subject.id : null,
    timezone: workspace.timezone,
    window: {
      start: currentStart,
      end: dateThrough,
      days: currentDays
    },
    comparison_window: comparisonWindow,
    population,
    context,
    sampling: {
      policy_version: "signal-taxonomy-insight-stratified-v1",
      max_mentions: SIGNAL_TAXONOMY_INSIGHT_MAX_MENTIONS,
      max_chars: SIGNAL_TAXONOMY_INSIGHT_MAX_MENTION_CHARS,
      analyzed_mentions: sampled.mentions.length,
      analyzed_chars: sampled.analyzedChars,
      deduplicated_conversation_roots: sampled.deduplicatedConversationRoots,
      truncated: sampled.truncated
    },
    terms,
    term_metrics: metricRows.map((row) => ({
      kind: row.kind,
      term_key: row.term_key,
      label: row.label,
      current_mentions: row.current_mentions,
      previous_mentions: comparisonWindow ? row.previous_mentions : null,
      current_share: safeRatio(row.current_mentions, population.current_mentions),
      previous_share: comparisonWindow && population.previous_mentions != null
        ? safeRatio(row.previous_mentions, population.previous_mentions)
        : null
    })),
    mentions: sampled.mentions
  };
}

export async function loadSignalTaxonomyInsightsV1(
  workspaceId: string,
  options: {
    includeInternalContextRefs?: boolean;
    readScope?: SignalOperationalReadScopeV1;
  } = {}
): Promise<SignalTaxonomyInsightsServingV1> {
  const servingScope = options.readScope?.visibleSource === "governed_population"
    ? {
        sql: `AND packet->>'population_id' = $3::text
          AND packet->>'population_version' = $4::text
          AND packet->>'population_definition_hash' = $5::text`,
        params: [
          options.readScope.population?.id ?? "",
          String(options.readScope.population?.version ?? ""),
          options.readScope.population?.definition_hash ?? ""
        ]
      }
    : options.readScope?.legacyCorpus
      ? {
          sql: "AND packet->>'study_corpus_id' = $3::text",
          params: [options.readScope.legacyCorpus.id]
        }
      : { sql: "", params: [] as string[] };
  const runResult = await pool.query<{
    id: string;
    status: string;
    budget_cap_usd: string;
    estimated_cost_usd: string;
    actual_cost_usd: string;
    error_code: string | null;
    error_summary: Record<string, unknown>;
    packet: Record<string, unknown>;
    created_at: Date;
    completed_at: Date | null;
  }>(`
    SELECT
      id::text,
      status,
      budget_cap_usd::text,
      estimated_cost_usd::text,
      actual_cost_usd::text,
      error_code,
      error_summary,
      packet,
      created_at,
      completed_at
    FROM metric_interpretation_runs
    WHERE workspace_id = $1::uuid
      AND metric_group_key = $2
      ${servingScope.sql}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [
    workspaceId,
    SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY,
    ...servingScope.params
  ]);
  const run = runResult.rows[0] ?? null;
  if (!run) return emptyServingState();
  const interpretationResult = run.status === "completed"
    ? await pool.query<{ content: unknown }>(`
        SELECT content
        FROM metric_interpretations
        WHERE run_id = $1::uuid
          AND metric_group_key = $2
          AND status = 'fresh'
          AND review_status IN ('auto_published', 'approved')
        ORDER BY revision DESC, created_at DESC
        LIMIT 1
      `, [run.id, SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY])
    : { rows: [] };
  const rawResult = signalTaxonomyInsightResult(interpretationResult.rows[0]?.content);
  const result = rawResult && !options.includeInternalContextRefs
    ? {
        ...rawResult,
        items: rawResult.items.map((item) => ({
          ...item,
          internal_context_refs: []
        }))
      }
    : rawResult;
  const analyzedMentions = packetAnalyzedMentions(run.packet);
  const enrichmentResult = await pool.query<{ count: number }>(`
    SELECT count(DISTINCT subject_id)::int AS count
    FROM record_feature_values
    WHERE subject_type = 'mention'
      AND feature_key = $1
      AND feature_value->>'run_id' = $2
  `, [SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY, run.id]);
  const persistedMentions = Number(enrichmentResult.rows[0]?.count ?? 0);
  return {
    contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
    state: run.status === "completed" && result
      ? "ready"
      : run.status === "queued" || run.status === "running"
        ? "pending"
        : run.status === "failed" || run.status === "dead_letter"
          ? "failed"
          : "not_available",
    run: {
      id: run.id,
      status: run.status,
      budget_cap_usd: Number(run.budget_cap_usd),
      estimated_cost_usd: Number(run.estimated_cost_usd),
      actual_cost_usd: Number(run.actual_cost_usd),
      error_code: run.error_code,
      error_message: typeof run.error_summary?.message === "string"
        ? run.error_summary.message
        : null,
      created_at: run.created_at.toISOString(),
      completed_at: run.completed_at?.toISOString() ?? null
    },
    enrichment: {
      analyzed_mentions: analyzedMentions,
      persisted_mentions: persistedMentions,
      complete: analyzedMentions > 0 && persistedMentions === analyzedMentions
    },
    result
  };
}

async function loadContextWatermark(
  workspace: ResolvedSignalWorkspace,
  corpusId: string
) {
  const result = await pool.query<{
    ref_count: number;
    context_hash: string;
  }>(`
    WITH profiles AS (
      SELECT id, updated_at
      FROM brand_os_profiles
      WHERE status = 'active'
        AND (
          ($2 = 'brand' AND brand_id = $3::uuid)
          OR ($2 = 'theme' AND theme_id = $3::uuid)
        )
    ),
    refs AS (
      SELECT 'profile:' || id::text || ':' || updated_at::text AS value
      FROM profiles
      UNION ALL
      SELECT
        'objective:' || objective.id::text || ':' || md5(concat_ws(
          '|',
          objective.name,
          objective.description,
          objective.success_criteria::text,
          objective.status
        ))
      FROM brand_os_objectives objective
      WHERE objective.brand_os_profile_id IN (SELECT id FROM profiles)
        AND objective.status = 'active'
      UNION ALL
      SELECT 'brief:' || brief.id::text || ':' || brief.updated_at::text
      FROM brand_os_briefs brief
      WHERE brief.brand_os_profile_id IN (SELECT id FROM profiles)
        AND (brief.study_corpus_id = $1::uuid OR brief.study_corpus_id IS NULL)
        AND brief.status = 'active'
      UNION ALL
      SELECT
        'audience:' || audience.id::text || ':' || md5(concat_ws(
          '|',
          audience.name,
          audience.description,
          audience.attributes::text,
          audience.status
        ))
      FROM brand_os_audiences audience
      WHERE audience.brand_os_profile_id IN (SELECT id FROM profiles)
        AND audience.status = 'active'
      UNION ALL
      SELECT 'source:' || source.id::text || ':' || source.updated_at::text
      FROM brand_knowledge_sources source
      WHERE source.status IN ('processed', 'processed_truncated')
        AND (
          source.study_corpus_id = $1::uuid
          OR ($2 = 'brand' AND source.brand_id = $3::uuid)
        )
      UNION ALL
      SELECT 'assertion:' || assertion.id::text || ':' || assertion.updated_at::text
      FROM knowledge_assertions assertion
      JOIN brand_knowledge_sources source
        ON source.id = assertion.knowledge_source_id
      WHERE assertion.status IN ('accepted', 'approved', 'active')
        AND (
          source.study_corpus_id = $1::uuid
          OR ($2 = 'brand' AND source.brand_id = $3::uuid)
        )
    )
    SELECT
      count(*)::int AS ref_count,
      COALESCE(
        md5(string_agg(value, '|' ORDER BY value)),
        md5('no-context')
      ) AS context_hash
    FROM refs
  `, [corpusId, workspace.subject.type, workspace.subject.id]);
  const refCount = Number(result.rows[0]?.ref_count ?? 0);
  return {
    state: refCount >= 2
      ? "ready" as const
      : refCount > 0
        ? "partial" as const
        : "not_available" as const,
    ref_count: refCount,
    context_hash: `md5:${result.rows[0]?.context_hash ?? "no-context"}`
  };
}

async function loadPopulation(
  corpusId: string,
  workspaceId: string,
  currentStart: string,
  currentEnd: string,
  comparisonWindow: { start: string; end: string } | null
) {
  const result = await pool.query<{
    current_mentions: number;
    previous_mentions: number;
  }>(`
    SELECT
      count(*) FILTER (
        WHERE published_at >= $2::date
          AND published_at < ($3::date + interval '1 day')
      )::int AS current_mentions,
      count(*) FILTER (
        WHERE $4::date IS NOT NULL
          AND published_at >= $4::date
          AND published_at < ($5::date + interval '1 day')
      )::int AS previous_mentions
    FROM mentions
    WHERE study_corpus_id = $1::uuid
      AND inclusion_status = 'included'
      AND published_at >= COALESCE($4::date, $2::date)
      AND published_at < ($3::date + interval '1 day')
      AND EXISTS (
        SELECT 1
        FROM record_tags tag
        JOIN signal_taxonomy_profiles profile
          ON profile.id = tag.signal_taxonomy_profile_id
         AND profile.workspace_id = $6::uuid
         AND profile.status = 'active'
        JOIN taxonomy_terms term
          ON term.id = tag.taxonomy_term_id
         AND term.taxonomy_id = profile.taxonomy_id
         AND term.status = 'active'
        WHERE tag.subject_type = 'mention'
          AND tag.subject_id = mentions.id
          AND tag.review_status = 'approved'
      )
  `, [
    corpusId,
    currentStart,
    currentEnd,
    comparisonWindow?.start ?? null,
    comparisonWindow?.end ?? null,
    workspaceId
  ]);
  return {
    current_mentions: Number(result.rows[0]?.current_mentions ?? 0),
    previous_mentions: comparisonWindow
      ? Number(result.rows[0]?.previous_mentions ?? 0)
      : null
  };
}

async function loadMentionCandidates(
  corpusId: string,
  workspaceId: string,
  start: string,
  end: string
) {
  const result = await pool.query<MentionCandidateRow>(`
    WITH base AS (
      SELECT
        mention.id,
        mention.published_at AS occurred_at,
        COALESCE(NULLIF(mention.text_clean, ''), NULLIF(mention.text_snippet, ''), NULLIF(mention.title, '')) AS text,
        COALESCE(NULLIF(mention.resolved_platform, ''), NULLIF(mention.platform, ''), 'unknown') AS platform,
        mention.sentiment_score,
        COALESCE(
          CASE
            WHEN mention.engagement->>'engagement' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN (mention.engagement->>'engagement')::numeric
          END,
          0
        ) + COALESCE(
          CASE
            WHEN mention.engagement->>'likes' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN (mention.engagement->>'likes')::numeric
          END,
          0
        ) + COALESCE(
          CASE
            WHEN mention.engagement->>'comments' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN (mention.engagement->>'comments')::numeric
          END,
          0
        ) + COALESCE(
          CASE
            WHEN mention.engagement->>'shares' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN (mention.engagement->>'shares')::numeric
          END,
          0
        ) AS engagement,
        COALESCE(
          NULLIF(mention.raw_metadata->>'root_post_id', ''),
          NULLIF(mention.raw_metadata->>'thread_id', ''),
          NULLIF(mention.raw_metadata->>'conversation_id', ''),
          mention.id::text
        ) AS conversation_root
      FROM mentions mention
      WHERE mention.study_corpus_id = $1::uuid
        AND mention.inclusion_status = 'included'
        AND mention.published_at >= $3::date
        AND mention.published_at < ($4::date + interval '1 day')
        AND COALESCE(NULLIF(mention.text_clean, ''), NULLIF(mention.text_snippet, ''), NULLIF(mention.title, '')) IS NOT NULL
    ),
    assignments AS (
      SELECT
        tag.subject_id AS mention_id,
        profile.kind,
        term.term_key
      FROM record_tags tag
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.workspace_id = $2::uuid
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.status = 'active'
      JOIN base ON base.id = tag.subject_id
      WHERE tag.subject_type = 'mention'
        AND tag.review_status = 'approved'
    ),
    rolled AS (
      SELECT
        base.*,
        COALESCE(
          array_agg(DISTINCT assignments.term_key ORDER BY assignments.term_key)
            FILTER (WHERE assignments.kind = 'topic'),
          ARRAY[]::text[]
        ) AS topic_keys,
        COALESCE(
          array_agg(DISTINCT assignments.term_key ORDER BY assignments.term_key)
            FILTER (WHERE assignments.kind = 'narrative'),
          ARRAY[]::text[]
        ) AS narrative_keys
      FROM base
      LEFT JOIN assignments ON assignments.mention_id = base.id
      GROUP BY
        base.id,
        base.occurred_at,
        base.text,
        base.platform,
        base.sentiment_score,
        base.engagement,
        base.conversation_root
    ),
    stratified AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY
            date_trunc('week', occurred_at),
            platform,
            CASE
              WHEN sentiment_score > 0.2 THEN 'positive'
              WHEN sentiment_score < -0.2 THEN 'negative'
              WHEN sentiment_score IS NULL THEN 'not_available'
              ELSE 'neutral'
            END
          ORDER BY engagement DESC, occurred_at DESC, id
        ) AS rank
      FROM rolled
      WHERE cardinality(topic_keys) > 0
         OR cardinality(narrative_keys) > 0
    ),
    term_stratified AS (
      SELECT
        assignments.mention_id AS id,
        row_number() OVER (
          PARTITION BY assignments.kind, assignments.term_key
          ORDER BY base.engagement DESC, base.occurred_at DESC, base.id
        ) AS rank
      FROM assignments
      JOIN base ON base.id = assignments.mention_id
    ),
    candidate_ids AS (
      SELECT id FROM stratified WHERE rank <= 35
      UNION
      SELECT id FROM term_stratified WHERE rank <= 15
    )
    SELECT
      rolled.id::text AS mention_id,
      rolled.occurred_at,
      rolled.text,
      rolled.platform,
      rolled.sentiment_score::text,
      rolled.engagement::text,
      rolled.conversation_root,
      rolled.topic_keys,
      rolled.narrative_keys
    FROM rolled
    JOIN candidate_ids ON candidate_ids.id = rolled.id
    ORDER BY rolled.occurred_at DESC, rolled.id
    LIMIT 6000
  `, [corpusId, workspaceId, start, end]);
  return result.rows;
}

async function loadTermMetrics(
  corpusId: string,
  workspaceId: string,
  currentStart: string,
  currentEnd: string,
  comparisonWindow: { start: string; end: string } | null
) {
  const result = await pool.query<TermMetricRow>(`
    WITH active_terms AS (
      SELECT
        profile.kind,
        profile.id AS profile_id,
        term.id AS term_id,
        term.term_key,
        term.label,
        term.description
      FROM signal_taxonomy_profiles profile
      JOIN taxonomy_terms term
        ON term.taxonomy_id = profile.taxonomy_id
       AND term.status = 'active'
      WHERE profile.workspace_id = $2::uuid
        AND profile.status = 'active'
    )
    SELECT
      active_terms.kind,
      active_terms.term_key,
      active_terms.label,
      active_terms.description,
      count(DISTINCT mention.id) FILTER (
        WHERE mention.published_at >= $3::date
          AND mention.published_at < ($4::date + interval '1 day')
      )::int AS current_mentions,
      count(DISTINCT mention.id) FILTER (
        WHERE $5::date IS NOT NULL
          AND mention.published_at >= $5::date
          AND mention.published_at < ($6::date + interval '1 day')
      )::int AS previous_mentions
    FROM active_terms
    LEFT JOIN record_tags tag
      ON tag.signal_taxonomy_profile_id = active_terms.profile_id
     AND tag.taxonomy_term_id = active_terms.term_id
     AND tag.subject_type = 'mention'
     AND tag.review_status = 'approved'
    LEFT JOIN mentions mention
      ON mention.id = tag.subject_id
     AND mention.study_corpus_id = $1::uuid
     AND mention.inclusion_status = 'included'
     AND mention.published_at >= COALESCE($5::date, $3::date)
     AND mention.published_at < ($4::date + interval '1 day')
    GROUP BY
      active_terms.kind,
      active_terms.term_key,
      active_terms.label,
      active_terms.description
    ORDER BY active_terms.kind, current_mentions DESC, active_terms.term_key
  `, [
    corpusId,
    workspaceId,
    currentStart,
    currentEnd,
    comparisonWindow?.start ?? null,
    comparisonWindow?.end ?? null
  ]);
  return result.rows;
}

function mapMentionCandidate(row: MentionCandidateRow): SignalTaxonomyInsightMentionV1 {
  const text = compactText(row.text, 900);
  return {
    mention_id: row.mention_id,
    occurred_at: row.occurred_at.toISOString(),
    text,
    platform: row.platform,
    sentiment: sentimentLabel(row.sentiment_score),
    engagement: Math.max(0, Number(row.engagement) || 0),
    conversation_root: row.conversation_root,
    topic_keys: row.topic_keys ?? [],
    narrative_keys: row.narrative_keys ?? []
  };
}

function signalTaxonomyInsightResult(value: unknown): SignalTaxonomyInsightResultV1 | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<SignalTaxonomyInsightResultV1>;
  if (
    result.contract_version !== SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION
    || typeof result.packet_hash !== "string"
    || !result.window
    || !result.sample
    || !result.research
    || !Array.isArray(result.items)
  ) {
    return null;
  }
  return result as SignalTaxonomyInsightResultV1;
}

function packetAnalyzedMentions(packet: Record<string, unknown>) {
  const sampling = packet.sampling;
  if (!sampling || typeof sampling !== "object") return 0;
  return Math.max(0, Number((sampling as Record<string, unknown>).analyzed_mentions) || 0);
}

function emptyServingState(): SignalTaxonomyInsightsServingV1 {
  return {
    contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
    state: "not_available",
    run: null,
    enrichment: {
      analyzed_mentions: 0,
      persisted_mentions: 0,
      complete: false
    },
    result: null
  };
}

function sentimentLabel(value: string | null): SignalEvidenceSentimentDominantV1 {
  if (value == null) return "not_available";
  const score = Number(value);
  if (!Number.isFinite(score)) return "not_available";
  if (score > 0.2) return "positive";
  if (score < -0.2) return "negative";
  return "neutral";
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function safeRatio(value: number, denominator: number) {
  return denominator > 0 ? value / denominator : null;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  const startMs = new Date(`${start}T12:00:00Z`).getTime();
  const endMs = new Date(`${end}T12:00:00Z`).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function maxIsoDate(left: string, right: string) {
  return left > right ? left : right;
}
