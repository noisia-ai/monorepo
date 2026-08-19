import { createHash } from "node:crypto";

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";
import type { Job } from "bullmq";
import { z } from "zod";

import {
  SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
  SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY,
  SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS,
  SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS,
  SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES,
  SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SOURCES,
  SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY,
  SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS,
  validateSignalTaxonomyInsightJobDataV1,
  type SignalTaxonomyInsightContextRefV1,
  type SignalTaxonomyInsightItemV1,
  type SignalTaxonomyInsightJobDataV1,
  type SignalTaxonomyInsightLocalizedTextV1,
  type SignalTaxonomyInsightResearchSourceV1,
  type SignalTaxonomyInsightResultV1
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { estimateModelCostUsd } from "./engine-cost";

const localizedTextSchema = z.object({
  en_us: z.string().min(1).max(320),
  es_mx: z.string().min(1).max(320)
});

const insightDraftSchema = z.object({
  items: z.array(z.object({
    insight_id: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u),
    priority: z.number().int().min(1).max(5),
    kind: z.enum([
      "emergent_language",
      "experience_pattern",
      "cross_term_tension",
      "contextual_shift"
    ]),
    tone: z.enum(["positive", "negative", "neutral", "attention"]),
    status: z.enum(["observed", "contextually_supported", "plausible"]),
    title: localizedTextSchema,
    headline: localizedTextSchema,
    explanation: localizedTextSchema,
    why_it_matters: localizedTextSchema,
    confidence: z.enum(["high", "medium", "low"]),
    topic_keys: z.array(z.string()).max(8),
    narrative_keys: z.array(z.string()).max(8),
    supporting_mention_ids: z.array(z.string().uuid()).min(2).max(24),
    counterevidence_mention_ids: z.array(z.string().uuid()).max(12),
    internal_context_refs: z.array(z.object({
      source_type: z.enum([
        "brand_os_objective",
        "brand_os_brief",
        "brand_os_audience",
        "knowledge_assertion",
        "knowledge_source"
      ]),
      source_id: z.string().uuid()
    })).max(8),
    external_urls: z.array(z.string().url()).max(5),
    limitations: z.array(localizedTextSchema).max(4)
  })).max(5)
});

type InsightDraft = z.infer<typeof insightDraftSchema>;

export async function signalTaxonomyInsightJob(
  job: Job<SignalTaxonomyInsightJobDataV1>
) {
  const data = validateSignalTaxonomyInsightJobDataV1(job.data);
  const estimatedCostUsd = estimateCost(data);
  if (estimatedCostUsd > data.budget_cap_usd) {
    throw new Error("estimated_cost_exceeds_budget_cap");
  }
  const run = await pool.query<{ id: string; status: string }>(`
    INSERT INTO metric_interpretation_runs (
      workspace_id, study_corpus_id, metric_group_key, metric_group_version,
      normalized_filter, filters_hash, data_scope, data_watermark_hash,
      packet, packet_hash, prompt_version, model_version, provider,
      idempotency_key, status, attempt, budget_cap_usd, estimated_cost_usd,
      timeout_ms, started_at
    ) VALUES (
      $1::uuid, $2::uuid, $3, 1,
      $4::jsonb, $5, $6::jsonb, $7,
      $8::jsonb, $9, $10, $11, 'anthropic',
      $12, 'running', $13, $14, $15, $16, now()
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      status = CASE
        WHEN metric_interpretation_runs.status = 'completed'
          THEN metric_interpretation_runs.status
        ELSE 'running'
      END,
      attempt = GREATEST(metric_interpretation_runs.attempt, EXCLUDED.attempt),
      started_at = COALESCE(metric_interpretation_runs.started_at, now()),
      updated_at = now()
    RETURNING id::text, status
  `, [
    data.packet.workspace_id,
    data.packet.study_corpus_id,
    SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY,
    JSON.stringify({
      contract_version: "signal-backend-v1",
      date_range: data.packet.window,
      timezone: data.packet.timezone,
      granularity: "day",
      dimensions: {}
    }),
    data.filters_hash,
    JSON.stringify({
      window: data.packet.window,
      comparison_window: data.packet.comparison_window,
      sample: data.packet.sampling,
      context: data.packet.context
    }),
    data.data_watermark_hash,
    JSON.stringify(data.packet),
    data.packet_hash,
    data.prompt_version,
    data.model_version,
    data.idempotency_key,
    job.attemptsMade + 1,
    data.budget_cap_usd,
    estimatedCostUsd,
    SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS
  ]);
  const runId = run.rows[0]!.id;
  if (run.rows[0]?.status === "completed") {
    return { run_id: runId, reconciliation_only: true };
  }

  try {
    await upsertSampleAnalysisLedger({
      data,
      runId,
      analysisStatus: "submitted"
    });
    const context = await loadGovernedContext(data);
    const response = await generateText({
      model: anthropic(data.model_version),
      tools: {
        web_search: anthropic.tools.webSearch_20250305({
          maxUses: SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES
        })
      },
      stopWhen: stepCountIs(SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES + 2),
      output: Output.object({
        schema: insightDraftSchema,
        name: "signal_topics_narratives_insights",
        description: "Evidence-bound Topics & Narratives insights for a rolling thirty-day window."
      }),
      prompt: buildInsightPrompt(data, context),
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 7_000,
      timeout: { totalMs: SIGNAL_TAXONOMY_INSIGHT_TIMEOUT_MS }
    });
    const research = collectResearchSources(response.steps.flatMap((step) => step.sources));
    const webSearchesUsed = response.steps.reduce(
      (total, step) => total + step.toolCalls.filter(
        (call) => call.toolName === "web_search"
      ).length,
      0
    );
    const items = reconcileInsightDraft({
      draft: response.output,
      data,
      context,
      research
    });
    const result: SignalTaxonomyInsightResultV1 = {
      contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
      packet_hash: data.packet_hash,
      cadence: "rolling_30_days",
      independent_of_page_filter: true,
      window: data.packet.window,
      comparison_window: data.packet.comparison_window,
      calculated_through: data.packet.window.end,
      sample: {
        analyzed_mentions: data.packet.sampling.analyzed_mentions,
        population_mentions: data.packet.population.current_mentions,
        analyzed_chars: data.packet.sampling.analyzed_chars,
        limit: data.packet.sampling.max_mentions,
        truncated: data.packet.sampling.truncated
      },
      research: {
        web_searches_used: webSearchesUsed,
        sources: research
      },
      items
    };
    const inputTokens = positiveInteger(response.totalUsage.inputTokens);
    const outputTokens = positiveInteger(response.totalUsage.outputTokens);
    const modelCostUsd = estimateModelCostUsd({
      provider: "anthropic",
      model: data.model_version,
      inputTokens,
      outputTokens
    }) ?? Number.POSITIVE_INFINITY;
    const actualCostUsd = roundUsd(modelCostUsd + webSearchesUsed * 0.02);
    if (!Number.isFinite(actualCostUsd) || actualCostUsd > data.budget_cap_usd) {
      throw new Error("actual_cost_exceeds_budget_cap");
    }
    return await persistInsightResult({
      data,
      runId,
      result,
      actualCostUsd,
      inputTokens,
      outputTokens
    });
  } catch (error) {
    await upsertSampleAnalysisLedger({
      data,
      runId,
      analysisStatus: "failed",
      failureCode: safeError(error)
    }).catch(() => undefined);
    await pool.query(`
      UPDATE metric_interpretation_runs
      SET
        status = 'failed',
        error_code = 'taxonomy_insight_failed',
        error_summary = $2::jsonb,
        completed_at = now(),
        updated_at = now()
      WHERE id = $1::uuid
    `, [runId, JSON.stringify({ message: safeError(error) })]);
    throw error;
  }
}

async function loadGovernedContext(
  data: SignalTaxonomyInsightJobDataV1
): Promise<SignalTaxonomyInsightContextRefV1[]> {
  const [objectives, briefs, audiences, assertions, sources] = await Promise.all([
    pool.query<{ id: string; title: string; content: string }>(`
      SELECT
        objective.id::text AS id,
        objective.name AS title,
        concat_ws(
          E'\n',
          objective.description,
          NULLIF(objective.success_criteria, '{}'::jsonb)::text
        ) AS content
      FROM brand_os_objectives objective
      JOIN brand_os_profiles profile
        ON profile.id = objective.brand_os_profile_id
       AND profile.status = 'active'
      WHERE $1::uuid IS NOT NULL
        AND profile.brand_id = $1::uuid
        AND objective.status = 'active'
      ORDER BY objective.priority NULLS LAST, objective.created_at DESC
      LIMIT 4
    `, [data.packet.brand_id]),
    pool.query<{ id: string; title: string; content: string }>(`
      SELECT
        brief.id::text AS id,
        brief.title,
        concat_ws(E'\n', brief.summary, NULLIF(brief.metadata, '{}'::jsonb)::text) AS content
      FROM brand_os_briefs brief
      JOIN brand_os_profiles profile
        ON profile.id = brief.brand_os_profile_id
       AND profile.status = 'active'
      WHERE (
          brief.study_corpus_id = $1::uuid
          OR ($2::uuid IS NOT NULL AND profile.brand_id = $2::uuid)
        )
        AND brief.status = 'active'
      ORDER BY
        CASE WHEN brief.study_corpus_id = $1::uuid THEN 0 ELSE 1 END,
        brief.updated_at DESC
      LIMIT 4
    `, [data.packet.study_corpus_id, data.packet.brand_id]),
    pool.query<{ id: string; title: string; content: string }>(`
      SELECT
        audience.id::text AS id,
        audience.name AS title,
        concat_ws(
          E'\n',
          audience.description,
          NULLIF(audience.attributes, '{}'::jsonb)::text
        ) AS content
      FROM brand_os_audiences audience
      JOIN brand_os_profiles profile
        ON profile.id = audience.brand_os_profile_id
       AND profile.status = 'active'
      WHERE $1::uuid IS NOT NULL
        AND profile.brand_id = $1::uuid
        AND audience.status = 'active'
      ORDER BY audience.created_at DESC
      LIMIT 3
    `, [data.packet.brand_id]),
    pool.query<{ id: string; title: string; content: string }>(`
      SELECT
        assertion.id::text AS id,
        source.title,
        assertion.assertion_text AS content
      FROM knowledge_assertions assertion
      JOIN brand_knowledge_sources source
        ON source.id = assertion.knowledge_source_id
      WHERE assertion.status IN ('accepted', 'approved', 'active')
        AND (
          source.study_corpus_id = $1::uuid
          OR ($2::uuid IS NOT NULL AND source.brand_id = $2::uuid)
        )
      ORDER BY
        CASE WHEN source.study_corpus_id = $1::uuid THEN 0 ELSE 1 END,
        assertion.updated_at DESC
      LIMIT 5
    `, [data.packet.study_corpus_id, data.packet.brand_id]),
    pool.query<{
      id: string;
      title: string;
      raw_text: string | null;
      extracted_payload: unknown;
    }>(`
      SELECT
        source.id::text,
        source.title,
        source.raw_text,
        source.extracted_payload
      FROM brand_knowledge_sources source
      WHERE source.status IN ('processed', 'processed_truncated')
        AND (
          source.study_corpus_id = $1::uuid
          OR ($2::uuid IS NOT NULL AND source.brand_id = $2::uuid)
        )
      ORDER BY
        CASE WHEN source.study_corpus_id = $1::uuid THEN 0 ELSE 1 END,
        source.updated_at DESC
      LIMIT 4
    `, [data.packet.study_corpus_id, data.packet.brand_id])
  ]);
  const candidates: Array<Omit<SignalTaxonomyInsightContextRefV1, "content_hash">> = [
    ...objectives.rows.map((row) => ({
      source_type: "brand_os_objective" as const,
      source_id: row.id,
      title: row.title,
      content: row.content
    })),
    ...briefs.rows.map((row) => ({
      source_type: "brand_os_brief" as const,
      source_id: row.id,
      title: row.title,
      content: row.content
    })),
    ...audiences.rows.map((row) => ({
      source_type: "brand_os_audience" as const,
      source_id: row.id,
      title: row.title,
      content: row.content
    })),
    ...assertions.rows.map((row) => ({
      source_type: "knowledge_assertion" as const,
      source_id: row.id,
      title: row.title,
      content: row.content
    })),
    ...sources.rows.map((row) => ({
      source_type: "knowledge_source" as const,
      source_id: row.id,
      title: row.title,
      content: row.raw_text?.trim() || JSON.stringify(row.extracted_payload)
    }))
  ];
  const selected: SignalTaxonomyInsightContextRefV1[] = [];
  let chars = 0;
  for (const candidate of candidates.slice(0, SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS)) {
    const content = compactText(candidate.content, 1_800);
    if (!content || chars + content.length > SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS) continue;
    selected.push({
      ...candidate,
      content,
      content_hash: sha256(content)
    });
    chars += content.length;
  }
  return selected;
}

function buildInsightPrompt(
  data: SignalTaxonomyInsightJobDataV1,
  context: SignalTaxonomyInsightContextRefV1[]
) {
  return [
    "You are Noisia's Topics & Narratives insight investigator.",
    "The governed taxonomy and SQL metrics already exist. Do not reclassify mentions, alter terms, or replace the ETL.",
    "Your task is to read the bounded mention sample for the latest rolling thirty days and detect a small number of non-obvious, decision-useful language or experience patterns.",
    "Language proposes a hypothesis; the supplied Data OS metrics and exact mention IDs constrain it.",
    "Every published item needs at least two distinct supporting mention IDs from the sample. Include counterevidence when the sample contains it.",
    "Do not merely restate volume, share, sentiment, or the visible ranking. Explain a repeated expression, experience, tension, change in meaning, or connection between a topic and a narrative.",
    "Internal Brand OS and Study OS context can explain why a pattern matters, but it is not social evidence. Cite its exact source_type and source_id.",
    "Use web search only for at most three promising patterns where external context could clarify timing or environment. Prefer primary, institutional, official, or directly accountable sources.",
    "Do not assume a country or market. Localize research only when the governed context or the mentions establish that geography.",
    "External context never proves causality. Do not say an event caused the conversation unless the mentions themselves explicitly establish that link. Use language such as aligns with, may help contextualize, or is consistent with.",
    "Do not search for, infer, or expose personal identities. Never include private contact details.",
    "Return zero items if the sample does not support a useful insight. It is better to publish nothing than a decorative summary.",
    "All generated editorial prose must be qualitative and contain no digits, percentages, invented metrics, or provider jargon. The interface renders governed quantities separately.",
    "Write concise natural copy in both en_us and es_mx. The two versions must express the same claim.",
    "Status rules: observed means mentions alone support the reading; contextually_supported means governed internal or accepted external context aligns with it; plausible means a clearly limited interpretation worth watching, never a fact.",
    "Confidence must reflect evidence diversity, counterevidence, sample truncation, and context quality.",
    "Do not mention Claude, prompts, RAG, embeddings, or implementation details.",
    JSON.stringify({
      contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
      packet_hash: data.packet_hash,
      window: data.packet.window,
      comparison_window: data.packet.comparison_window,
      population: data.packet.population,
      sampling: data.packet.sampling,
      taxonomy_terms: data.packet.terms,
      governed_term_metrics: data.packet.term_metrics,
      mentions: data.packet.mentions,
      governed_context: context,
      output_rules: {
        maximum_items: 5,
        minimum_supporting_mentions_per_item: 2,
        maximum_web_research_candidates: 3,
        web_searches_available: SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES,
        web_sources_are_context_not_social_evidence: true,
        no_causal_claims: true
      }
    })
  ].join("\n");
}

function collectResearchSources(sources: Array<{
  sourceType: string;
  url?: string;
  title?: string;
}>) {
  const seen = new Set<string>();
  const accepted: SignalTaxonomyInsightResearchSourceV1[] = [];
  for (const source of sources) {
    if (
      source.sourceType !== "url"
      || !source.url?.startsWith("http")
      || seen.has(normalizeUrl(source.url))
    ) {
      continue;
    }
    const url = normalizeUrl(source.url);
    seen.add(url);
    accepted.push({
      source_id: `web_${sha256(url).slice(0, 16)}`,
      url,
      title: source.title?.trim() || null,
      retrieved_at: new Date().toISOString(),
      source_kind: "external_context"
    });
    if (accepted.length >= SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SOURCES) break;
  }
  return accepted;
}

function reconcileInsightDraft(input: {
  draft: InsightDraft;
  data: SignalTaxonomyInsightJobDataV1;
  context: SignalTaxonomyInsightContextRefV1[];
  research: SignalTaxonomyInsightResearchSourceV1[];
}) {
  const mentionById = new Map(
    input.data.packet.mentions.map((mention) => [mention.mention_id, mention])
  );
  const topicKeys = new Set(
    input.data.packet.terms
      .filter((term) => term.kind === "topic")
      .map((term) => term.term_key)
  );
  const narrativeKeys = new Set(
    input.data.packet.terms
      .filter((term) => term.kind === "narrative")
      .map((term) => term.term_key)
  );
  const contextKeys = new Set(
    input.context.map((ref) => `${ref.source_type}:${ref.source_id}`)
  );
  const sourceByUrl = new Map(
    input.research.map((source) => [normalizeUrl(source.url), source])
  );
  const priorities = new Set<number>();
  const ids = new Set<string>();
  const items: SignalTaxonomyInsightItemV1[] = [];
  for (const draft of [...input.draft.items].sort(
    (left, right) => left.priority - right.priority || left.insight_id.localeCompare(right.insight_id)
  )) {
    if (ids.has(draft.insight_id) || priorities.has(draft.priority)) continue;
    const supportingIds = unique(
      draft.supporting_mention_ids.filter((id) => mentionById.has(id))
    );
    if (supportingIds.length < 2) continue;
    const supportingSet = new Set(supportingIds);
    const counterevidenceIds = unique(
      draft.counterevidence_mention_ids.filter(
        (id) => mentionById.has(id) && !supportingSet.has(id)
      )
    );
    const inferredTopics = unique(
      supportingIds.flatMap((id) => mentionById.get(id)?.topic_keys ?? [])
    );
    const inferredNarratives = unique(
      supportingIds.flatMap((id) => mentionById.get(id)?.narrative_keys ?? [])
    );
    const reconciledTopics = unique([
      ...draft.topic_keys.filter((key) => topicKeys.has(key)),
      ...inferredTopics
    ]).slice(0, 8);
    const reconciledNarratives = unique([
      ...draft.narrative_keys.filter((key) => narrativeKeys.has(key)),
      ...inferredNarratives
    ]).slice(0, 8);
    const internalContextRefs = draft.internal_context_refs.filter(
      (ref) => contextKeys.has(`${ref.source_type}:${ref.source_id}`)
    );
    const externalSources = unique(
      draft.external_urls
        .map((url) => sourceByUrl.get(normalizeUrl(url))?.source_id)
        .filter((value): value is string => Boolean(value))
    );
    const status = draft.status === "contextually_supported"
      && internalContextRefs.length === 0
      && externalSources.length === 0
      ? "observed"
      : draft.status;
    const termKeys = [...reconciledTopics, ...reconciledNarratives];
    const chartItems = input.data.packet.term_metrics
      .filter((metric) => termKeys.includes(metric.term_key))
      .sort((left, right) =>
        right.current_mentions - left.current_mentions
        || left.label.localeCompare(right.label)
      )
      .slice(0, 5)
      .map((metric) => ({
        key: metric.label,
        value: metric.current_mentions
      }));
    items.push({
      insight_id: draft.insight_id,
      priority: draft.priority,
      kind: draft.kind === "cross_term_tension" && termKeys.length < 2
        ? "experience_pattern"
        : draft.kind,
      tone: draft.tone,
      status,
      title: validateLocalizedText(draft.title),
      headline: validateLocalizedText(draft.headline),
      explanation: validateLocalizedText(draft.explanation),
      why_it_matters: validateLocalizedText(draft.why_it_matters),
      confidence: draft.confidence,
      topic_keys: reconciledTopics,
      narrative_keys: reconciledNarratives,
      supporting_mention_ids: supportingIds,
      counterevidence_mention_ids: counterevidenceIds,
      internal_context_refs: internalContextRefs,
      external_source_ids: externalSources,
      limitations: draft.limitations.map(validateLocalizedText),
      chart: {
        type: "bar",
        items: chartItems.length > 0
          ? chartItems
          : [{ key: "Supporting evidence", value: supportingIds.length }]
      }
    });
    ids.add(draft.insight_id);
    priorities.add(draft.priority);
  }
  return items.slice(0, 5);
}

async function persistInsightResult(input: {
  data: SignalTaxonomyInsightJobDataV1;
  runId: string;
  result: SignalTaxonomyInsightResultV1;
  actualCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const interpretation = await client.query<{ id: string }>(`
      INSERT INTO metric_interpretations (
        run_id, workspace_id, study_corpus_id, metric_group_key,
        metric_group_version, revision, filters_hash, data_watermark_hash,
        packet_hash, data_scope, content, facts, hypotheses, causal_claims,
        recommendations, status, review_status, generated_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4,
        1, 1, $5, $6,
        $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, '[]'::jsonb,
        $12::jsonb, 'fresh', 'auto_published', 'claude'
      )
      ON CONFLICT (
        workspace_id, metric_group_key, metric_group_version,
        filters_hash, data_watermark_hash, revision
      ) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        packet_hash = EXCLUDED.packet_hash,
        data_scope = EXCLUDED.data_scope,
        content = EXCLUDED.content,
        facts = EXCLUDED.facts,
        hypotheses = EXCLUDED.hypotheses,
        causal_claims = '[]'::jsonb,
        recommendations = EXCLUDED.recommendations,
        status = 'fresh',
        review_status = 'auto_published',
        generated_by = 'claude',
        created_at = now()
      RETURNING id::text
    `, [
      input.runId,
      input.data.packet.workspace_id,
      input.data.packet.study_corpus_id,
      SIGNAL_TAXONOMY_INSIGHT_METRIC_GROUP_KEY,
      input.data.filters_hash,
      input.data.data_watermark_hash,
      input.data.packet_hash,
      JSON.stringify({
        window: input.data.packet.window,
        comparison_window: input.data.packet.comparison_window,
        sample: input.result.sample,
        context: input.data.packet.context
      }),
      JSON.stringify(input.result),
      JSON.stringify(input.result.items
        .filter((item) => item.status === "observed")
        .map(evidenceBoundRecord)),
      JSON.stringify(input.result.items
        .filter((item) => item.status !== "observed")
        .map(evidenceBoundRecord)),
      JSON.stringify(input.result.items.map((item) => ({
        insight_id: item.insight_id,
        en_us: item.why_it_matters.en_us,
        es_mx: item.why_it_matters.es_mx
      })))
    ]);
    const interpretationId = interpretation.rows[0]!.id;
    const citedByMention = new Map<string, {
      supporting: string[];
      counterevidence: string[];
    }>();
    for (const item of input.result.items) {
      for (const mentionId of item.supporting_mention_ids) {
        const value = citedByMention.get(mentionId) ?? { supporting: [], counterevidence: [] };
        value.supporting.push(item.insight_id);
        citedByMention.set(mentionId, value);
      }
      for (const mentionId of item.counterevidence_mention_ids) {
        const value = citedByMention.get(mentionId) ?? { supporting: [], counterevidence: [] };
        value.counterevidence.push(item.insight_id);
        citedByMention.set(mentionId, value);
      }
    }
    const mentionEnrichments = input.data.packet.mentions.map((mention, sampleIndex) => {
      const citations = citedByMention.get(mention.mention_id) ?? {
        supporting: [],
        counterevidence: []
      };
      return {
        mention_id: mention.mention_id,
        feature_value: {
          contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
          run_id: input.runId,
          interpretation_id: interpretationId,
          packet_hash: input.data.packet_hash,
          analyzed_at: new Date().toISOString(),
          analysis_status: "completed",
          window: input.data.packet.window,
          sample_index: sampleIndex,
          sample_policy: input.data.packet.sampling.policy_version,
          topic_keys: mention.topic_keys,
          narrative_keys: mention.narrative_keys,
          disposition: citations.supporting.length > 0
            ? "supporting_evidence"
            : citations.counterevidence.length > 0
              ? "counterevidence"
              : "analyzed_not_cited",
          supporting_insight_ids: citations.supporting,
          counterevidence_insight_ids: citations.counterevidence
        }
      };
    });
    await client.query(`
      INSERT INTO record_feature_values (
        organization_id,
        brand_id,
        study_corpus_id,
        subject_type,
        subject_id,
        feature_key,
        feature_value,
        value_type,
        confidence,
        source
      )
      SELECT
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'mention',
        enrichment.mention_id,
        $4,
        enrichment.feature_value,
        'json',
        NULL,
        $5
      FROM jsonb_to_recordset($6::jsonb) AS enrichment(
        mention_id uuid,
        feature_value jsonb
      )
      ON CONFLICT (subject_type, subject_id, feature_key, source)
      DO UPDATE SET
        feature_value = EXCLUDED.feature_value,
        value_type = EXCLUDED.value_type,
        confidence = EXCLUDED.confidence
    `, [
      input.data.packet.organization_id,
      input.data.packet.brand_id,
      input.data.packet.study_corpus_id,
      SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY,
      "signal-taxonomy-insights",
      JSON.stringify(mentionEnrichments)
    ]);
    const sourceFeatures = input.result.research.sources.map((source) => ({
      feature_key: `topics_narratives.external_context.v1:${source.source_id}`,
      feature_value: {
        ...source,
        run_id: input.runId,
        interpretation_id: interpretationId,
        packet_hash: input.data.packet_hash,
        evidence_role: "external_context",
        causal_authority: false
      }
    }));
    if (sourceFeatures.length > 0) {
      await client.query(`
        INSERT INTO record_feature_values (
          organization_id,
          brand_id,
          study_corpus_id,
          subject_type,
          subject_id,
          feature_key,
          feature_value,
          value_type,
          confidence,
          source
        )
        SELECT
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'metric_interpretation',
          $4::uuid,
          research.feature_key,
          research.feature_value,
          'json',
          NULL,
          'anthropic:web_search'
        FROM jsonb_to_recordset($5::jsonb) AS research(
          feature_key text,
          feature_value jsonb
        )
        ON CONFLICT (subject_type, subject_id, feature_key, source)
        DO UPDATE SET feature_value = EXCLUDED.feature_value
      `, [
        input.data.packet.organization_id,
        input.data.packet.brand_id,
        input.data.packet.study_corpus_id,
        interpretationId,
        JSON.stringify(sourceFeatures)
      ]);
    }
    await client.query(`
      UPDATE metric_interpretation_runs
      SET
        status = 'completed',
        actual_cost_usd = $2,
        input_tokens = $3,
        output_tokens = $4,
        completed_at = now(),
        updated_at = now()
      WHERE id = $1::uuid
    `, [
      input.runId,
      input.actualCostUsd,
      input.inputTokens,
      input.outputTokens
    ]);
    await client.query("COMMIT");
    return {
      run_id: input.runId,
      interpretation_id: interpretationId,
      analyzed_mentions: mentionEnrichments.length,
      persisted_mentions: mentionEnrichments.length,
      insights: input.result.items.length,
      web_sources: sourceFeatures.length,
      cost_usd: input.actualCostUsd
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function upsertSampleAnalysisLedger(input: {
  data: SignalTaxonomyInsightJobDataV1;
  runId: string;
  analysisStatus: "submitted" | "failed";
  failureCode?: string;
}) {
  const recordedAt = new Date().toISOString();
  const enrichments = input.data.packet.mentions.map((mention, sampleIndex) => ({
    mention_id: mention.mention_id,
    feature_value: {
      contract_version: SIGNAL_TAXONOMY_INSIGHT_CONTRACT_VERSION,
      run_id: input.runId,
      packet_hash: input.data.packet_hash,
      requested_by_user_id: input.data.requested_by_user_id,
      recorded_at: recordedAt,
      analysis_status: input.analysisStatus,
      failure_code: input.failureCode ?? null,
      window: input.data.packet.window,
      sample_index: sampleIndex,
      sample_policy: input.data.packet.sampling.policy_version,
      topic_keys: mention.topic_keys,
      narrative_keys: mention.narrative_keys,
      disposition: input.analysisStatus === "failed"
        ? "analysis_failed"
        : "submitted_for_analysis",
      supporting_insight_ids: [],
      counterevidence_insight_ids: []
    }
  }));
  await pool.query(`
    INSERT INTO record_feature_values (
      organization_id,
      brand_id,
      study_corpus_id,
      subject_type,
      subject_id,
      feature_key,
      feature_value,
      value_type,
      confidence,
      source
    )
    SELECT
      $1::uuid,
      $2::uuid,
      $3::uuid,
      'mention',
      enrichment.mention_id,
      $4,
      enrichment.feature_value,
      'json',
      NULL,
      $5
    FROM jsonb_to_recordset($6::jsonb) AS enrichment(
      mention_id uuid,
      feature_value jsonb
    )
    ON CONFLICT (subject_type, subject_id, feature_key, source)
    DO UPDATE SET
      feature_value = EXCLUDED.feature_value,
      value_type = EXCLUDED.value_type,
      confidence = EXCLUDED.confidence
  `, [
    input.data.packet.organization_id,
    input.data.packet.brand_id,
    input.data.packet.study_corpus_id,
    SIGNAL_TAXONOMY_INSIGHT_FEATURE_KEY,
    "signal-taxonomy-insights",
    JSON.stringify(enrichments)
  ]);
}

function evidenceBoundRecord(item: SignalTaxonomyInsightItemV1) {
  return {
    insight_id: item.insight_id,
    status: item.status,
    supporting_mention_ids: item.supporting_mention_ids,
    counterevidence_mention_ids: item.counterevidence_mention_ids,
    internal_context_refs: item.internal_context_refs,
    external_source_ids: item.external_source_ids
  };
}

function validateLocalizedText(
  value: SignalTaxonomyInsightLocalizedTextV1
) {
  for (const [locale, text] of Object.entries(value)) {
    if (!text.trim() || /\d/u.test(text)) {
      throw new Error(`invalid_qualitative_editorial_${locale}`);
    }
  }
  return {
    en_us: value.en_us.trim(),
    es_mx: value.es_mx.trim()
  };
}

function estimateCost(data: SignalTaxonomyInsightJobDataV1) {
  const estimatedInputTokens = Math.ceil(
    (
      JSON.stringify(data.packet).length
      + SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS
      + 12_000
    ) / 4
  );
  const modelCost = estimateModelCostUsd({
    provider: "anthropic",
    model: data.model_version,
    inputTokens: estimatedInputTokens,
    outputTokens: 7_000
  }) ?? 3;
  return roundUsd(modelCost + SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES * 0.02);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : 0;
}

function roundUsd(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:sk-ant-|postgres(?:ql)?:\/\/)\S+/giu, "[redacted]")
    .slice(0, 300);
}
