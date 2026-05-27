import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildSampleEvaluatorPrompt,
  getSampleSize,
  parseSampleEvaluationJson,
  SAMPLE_EVALUATOR_PIPELINE_VERSION,
  type SampleMention
} from "@noisia/query-engine";
import { fetchHistoricalSample, fetchRecentSample, type SentiOneMention } from "../clients/sentione";
import { pool } from "../db/client";

type EvaluateSampleJobData = {
  corpusId: string;
  queryIterationId: string;
  requestedByUserId: string;
};

type IterationRow = {
  id: string;
  query_text: string;
  query_components: {
    brand_seeds?: string[];
    trigger_phrases_tb?: string[];
    barrier_phrases_tb?: string[];
    category_seeds?: string[];
    global_exclusions?: string[];
  } | null;
  iteration_number: number;
  business_question: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  brand_id: string | null;
  theme_id: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  brand_industry_sub: string | null;
  brand_countries: string[] | null;
  brand_seed_handles: string[] | null;
  brand_description: string | null;
  theme_name: string | null;
  theme_description: string | null;
  theme_industry_focus: string[] | null;
  theme_geo_focus: string[] | null;
  methodology_slug: string;
  methodology_name: string;
};

type MentionRow = {
  id: string;
  text_snippet: string;
  platform: string;
  language: string | null;
  country: string | null;
  sentiment_source: string | null;
  quality_flags: Record<string, boolean>;
};

export async function evaluateSampleJob(job: Job<EvaluateSampleJobData>) {
  await job.updateProgress(10);

  const iteration = await loadIteration(job.data.queryIterationId, job.data.corpusId);
  await job.updateProgress(25);

  const sampleSize = getSampleSize(iteration.iteration_number);
  console.log(`[evaluate-sample] iteration #${iteration.iteration_number} → sample size ${sampleSize}`);
  const sample = await loadSample(job.data.corpusId, iteration, sampleSize);
  await job.updateProgress(45);

  const subject = buildSubject(iteration);
  const prompt = buildSampleEvaluatorPrompt({
    corpus: {
      id: job.data.corpusId,
      name: null,
      businessQuestion: iteration.business_question,
      decisionToInform: null,
      audienceSegment: iteration.audience_segment,
      geoFocus: iteration.geo_focus ?? [],
      targetWindowMonths: iteration.target_window_months,
      contextForm: iteration.context_form
    },
    subject,
    methodology: {
      slug: iteration.methodology_slug,
      name: iteration.methodology_name
    },
    query_text: iteration.query_text,
    sample: sample.map(toSampleMention)
  });
  await job.updateProgress(55);

  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const evaluation = await evaluateWithClaude(prompt, model);
  await job.updateProgress(85);

  await pool.query(
    `
      UPDATE query_iterations
      SET
        mentions_returned = $1,
        quality_score     = $2,
        density_score     = $3,
        noise_score       = $4,
        ai_evaluation_notes = $5
      WHERE id = $6
    `,
    [
      sample.length,
      evaluation.quality_score.toFixed(2),
      evaluation.density_score.toFixed(2),
      evaluation.noise_score.toFixed(2),
      JSON.stringify({
        notes: evaluation.notes,
        proposed_adjustments: evaluation.proposed_adjustments,
        language_mx_pct: evaluation.language_mx_pct,
        geo_mx_pct: evaluation.geo_mx_pct,
        model,
        pipeline_version: SAMPLE_EVALUATOR_PIPELINE_VERSION
      }),
      job.data.queryIterationId
    ]
  );

  await job.updateProgress(100);

  return {
    query_iteration_id: job.data.queryIterationId,
    sample_size: sample.length,
    quality_score: evaluation.quality_score,
    density_score: evaluation.density_score,
    noise_score: evaluation.noise_score,
    notes: evaluation.notes,
    proposed_adjustments: evaluation.proposed_adjustments
  };
}

async function loadIteration(iterationId: string, corpusId: string): Promise<IterationRow> {
  const result = await pool.query<IterationRow>(
    `
      SELECT
        qi.id,
        qi.query_text,
        qi.query_components,
        qi.iteration_number,
        sc.business_question,
        sc.audience_segment,
        sc.geo_focus,
        sc.target_window_months,
        sc.context_form,
        sc.brand_id,
        sc.theme_id,
        b.name AS brand_name,
        b.display_name AS brand_display_name,
        b.industry AS brand_industry,
        b.industry_sub AS brand_industry_sub,
        b.countries AS brand_countries,
        b.brand_seed_handles,
        b.description AS brand_description,
        t.name AS theme_name,
        t.description AS theme_description,
        t.industry_focus AS theme_industry_focus,
        t.geo_focus AS theme_geo_focus,
        m.slug AS methodology_slug,
        m.name AS methodology_name
      FROM query_iterations qi
      JOIN study_corpora sc ON sc.id = qi.study_corpus_id
      JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE qi.id = $1 AND qi.study_corpus_id = $2
      LIMIT 1
    `,
    [iterationId, corpusId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(`Query iteration not found: ${iterationId}`);
  }

  return row;
}

async function loadSample(corpusId: string, iteration: IterationRow, sampleSize: number): Promise<MentionRow[]> {
  const result = await pool.query<MentionRow>(
    `
      SELECT id, text_snippet, platform, language, country, sentiment_source, quality_flags
      FROM mentions
      WHERE study_corpus_id = $1
        AND inclusion_status = 'included'
      ORDER BY random()
      LIMIT $2
    `,
    [corpusId, sampleSize]
  );

  if (result.rows.length > 0) {
    console.log(`[evaluate-sample] Loaded ${result.rows.length} local mentions (requested ${sampleSize})`);
    return result.rows;
  }

  // No local mentions — try fetching a live sample from SentiOne API
  console.log(`[evaluate-sample] No local mentions for corpus ${corpusId}, fetching ${sampleSize} from SentiOne API`);
  return fetchSentiOneSample(iteration, sampleSize);
}

async function fetchSentiOneSample(iteration: IterationRow, sampleSize: number): Promise<MentionRow[]> {
  const projectId = Number(process.env.SENTIONE_DEFAULT_PROJECT_ID ?? "0");

  if (!projectId || !process.env.SENTIONE_API_KEY) {
    console.warn("[evaluate-sample] SENTIONE_API_KEY or SENTIONE_DEFAULT_PROJECT_ID not set, skipping live fetch");
    return [];
  }

  const sentiQuery = buildSentiOneQuery(iteration);
  console.log(`[evaluate-sample] SentiOne query (first 120): ${sentiQuery.slice(0, 120)}`);

  let mentions: SentiOneMention[] = [];

  try {
    // Basic tier only has access to recent (last 7 days)
    mentions = await fetchRecentSample(projectId, { query: sentiQuery }, sampleSize);
    console.log(`[evaluate-sample] Recent fetch: ${mentions.length} mentions`);
  } catch (err) {
    console.error(`[evaluate-sample] Recent fetch failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  return mentions.map(sentiOneMentionToRow);
}

function buildSentiOneQuery(iteration: IterationRow): string {
  const components = iteration.query_components;

  const quoteTerm = (t: string) => `"${t.replace(/"/g, "").slice(0, 40)}"`;
  const orGroup = (terms: string[]) =>
    terms.filter((t) => t.length > 0).map(quoteTerm).join(" OR ");

  if (!components) {
    return stripExclusions(iteration.query_text).slice(0, 250);
  }

  const triggers = (components.trigger_phrases_tb ?? []).slice(0, 2);
  const barriers = (components.barrier_phrases_tb ?? []).slice(0, 2);
  const brandSeeds = (components.brand_seeds ?? []).slice(0, 2);
  // Exclusions are omitted — SentiOne LQL rejects NOT in this context
  // and for sampling purposes broad coverage beats perfect precision.

  const signals = [...triggers, ...barriers];
  const parts: string[] = [];

  if (brandSeeds.length > 0) {
    parts.push(`(${orGroup(brandSeeds)})`);
  }

  if (signals.length > 0) {
    parts.push(`(${orGroup(signals)})`);
  }

  const query = parts.join(" AND ");

  if (!query) {
    return stripExclusions(iteration.query_text).slice(0, 250);
  }

  // If over limit, drop brand and keep signals only for broader reach
  if (query.length > 250 && signals.length > 0) {
    return orGroup(signals).slice(0, 250);
  }

  return query.slice(0, 250);
}

// Remove everything after NOT in a raw query_text to avoid LQL syntax issues
function stripExclusions(queryText: string): string {
  const notIdx = queryText.toUpperCase().indexOf(" NOT ");
  return notIdx > 0 ? queryText.slice(0, notIdx) : queryText;
}

function sentiOneMentionToRow(m: SentiOneMention): MentionRow {
  const text = m.content.text ?? m.content.title ?? "";
  return {
    id: m.id,
    text_snippet: text.slice(0, 220),
    platform: m.source.type?.toLowerCase() ?? "unknown",
    language: m.content.language?.code?.slice(0, 2) ?? null,
    country: m.location?.country?.code?.slice(0, 2) ?? null,
    sentiment_source: m.content.sentiment?.toLowerCase() ?? null,
    quality_flags: {}
  };
}

async function evaluateWithClaude(
  prompt: string,
  model: string
) {
  const keySet = !!process.env.ANTHROPIC_API_KEY;
  console.log(`[evaluate-sample] API key set: ${keySet}, model: ${model}`);
  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.1
    });

    console.log(`[evaluate-sample] Claude raw response (first 300): ${result.text.slice(0, 300)}`);
    return parseSampleEvaluationJson(result.text);
  } catch (err) {
    const detail = err instanceof Error ? `${err.message} | stack: ${err.stack?.slice(0, 200)}` : String(err);
    console.error(`[evaluate-sample] Claude evaluation failed: ${detail}`);
    return {
      quality_score: 5,
      density_score: 5,
      noise_score: 5,
      language_mx_pct: 50,
      geo_mx_pct: 50,
      notes: "No se pudo evaluar la muestra automaticamente.",
      proposed_adjustments: []
    };
  }
}

function buildSubject(row: IterationRow) {
  if (row.brand_id) {
    return {
      type: "brand" as const,
      name: row.brand_display_name ?? row.brand_name ?? "Marca",
      slug: row.brand_id,
      industry: row.brand_industry,
      industrySub: row.brand_industry_sub,
      countries: row.brand_countries ?? [],
      brandSeedHandles: row.brand_seed_handles ?? [],
      description: row.brand_description
    };
  }

  return {
    type: "theme" as const,
    name: row.theme_name ?? "Theme",
    slug: row.theme_id ?? "theme",
    industry: row.theme_industry_focus?.[0] ?? null,
    industrySub: null,
    countries: row.theme_geo_focus ?? [],
    brandSeedHandles: [],
    description: row.theme_description
  };
}

function toSampleMention(row: MentionRow): SampleMention {
  return {
    id: row.id,
    text_snippet: row.text_snippet,
    platform: row.platform,
    language: row.language,
    country: row.country,
    sentiment_source: row.sentiment_source,
    quality_flags: row.quality_flags ?? {}
  };
}
