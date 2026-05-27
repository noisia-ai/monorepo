import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildCorpusAssessmentPrompt,
  parseCorpusAssessmentJson,
  type CorpusAssessmentResult,
  type SampleMention
} from "@noisia/query-engine";
import { pool } from "../db/client";

type AssessCorpusJobData = {
  corpusId: string;
  requestedByUserId: string;
};

type CorpusContextRow = {
  corpus_id: string;
  business_question: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  methodology_slug: string;
  methodology_name: string;
  brand_id: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  brand_industry_sub: string | null;
  brand_countries: string[] | null;
  brand_seed_handles: string[] | null;
  brand_description: string | null;
  theme_id: string | null;
  theme_name: string | null;
  theme_description: string | null;
  theme_industry_focus: string[] | null;
  theme_geo_focus: string[] | null;
};

type MentionRow = {
  id: string;
  text_snippet: string | null;
  text_clean: string;
  platform: string;
  language: string | null;
  country: string | null;
  sentiment_source: string | null;
};

const ASSESSMENT_SAMPLE_SIZE = 600;

export async function assessCorpusJob(job: Job<AssessCorpusJobData>) {
  await job.updateProgress(10);

  const corpus = await loadCorpusContext(job.data.corpusId);
  await job.updateProgress(20);

  // Sample randomly across the entire corpus, biased to included mentions
  const sample = await pool.query<MentionRow>(
    `SELECT id, text_snippet, text_clean, platform, language, country, sentiment_source
     FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'
     ORDER BY random()
     LIMIT $2`,
    [job.data.corpusId, ASSESSMENT_SAMPLE_SIZE]
  );
  await job.updateProgress(45);

  // Total + iterations count for context
  const [{ rows: [counts] }, { rows: [iterCount] }] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM mentions WHERE study_corpus_id = $1 AND inclusion_status = 'included'`,
      [job.data.corpusId]
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM query_iterations WHERE study_corpus_id = $1`,
      [job.data.corpusId]
    )
  ]);
  await job.updateProgress(55);

  const subject =
    corpus.brand_id
      ? {
          type: "brand" as const,
          name: corpus.brand_display_name ?? corpus.brand_name ?? "Marca",
          slug: corpus.brand_id,
          industry: corpus.brand_industry,
          industrySub: corpus.brand_industry_sub,
          countries: corpus.brand_countries ?? [],
          brandSeedHandles: corpus.brand_seed_handles ?? [],
          description: corpus.brand_description
        }
      : {
          type: "theme" as const,
          name: corpus.theme_name ?? "Theme",
          slug: corpus.theme_id ?? "theme",
          industry: corpus.theme_industry_focus?.[0] ?? null,
          industrySub: null,
          countries: corpus.theme_geo_focus ?? [],
          brandSeedHandles: [],
          description: corpus.theme_description
        };

  const prompt = buildCorpusAssessmentPrompt({
    corpus: {
      id: corpus.corpus_id,
      name: null,
      businessQuestion: corpus.business_question,
      decisionToInform: null,
      audienceSegment: corpus.audience_segment,
      geoFocus: corpus.geo_focus ?? [],
      targetWindowMonths: corpus.target_window_months,
      contextForm: corpus.context_form
    },
    subject,
    methodology: { slug: corpus.methodology_slug, name: corpus.methodology_name },
    totalMentions: counts?.total ?? 0,
    iterationsCount: iterCount?.count ?? 0,
    sample: sample.rows.map(toSampleMention)
  });

  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";

  let result: CorpusAssessmentResult;
  try {
    const r = await generateText({ model: anthropic(model), prompt, temperature: 0.1 });
    console.log(`[assess-corpus] response first 300: ${r.text.slice(0, 300)}`);
    result = parseCorpusAssessmentJson(r.text);
  } catch (err) {
    console.error(`[assess-corpus] Claude failed: ${err instanceof Error ? err.message : err}`);
    result = {
      ready_for_study: false,
      confidence: 0,
      verdict: "needs_more_signal",
      coverage: { trigger_signal_pct: 0, barrier_signal_pct: 0, experience_signal_pct: 0, noise_pct: 0 },
      signals_well_covered: [],
      signals_missing: [],
      recommendation: "El evaluador no pudo completar el analisis. Reintenta en unos minutos."
    };
  }

  await job.updateProgress(90);

  await pool.query(
    `UPDATE study_corpora
     SET latest_assessment = $1::jsonb, latest_assessed_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ ...result, sample_size: sample.rows.length, model }), job.data.corpusId]
  );

  await job.updateProgress(100);

  return {
    corpus_id: job.data.corpusId,
    sample_size: sample.rows.length,
    ...result
  };
}

async function loadCorpusContext(corpusId: string): Promise<CorpusContextRow> {
  const result = await pool.query<CorpusContextRow>(
    `
      SELECT
        sc.id AS corpus_id,
        sc.business_question,
        sc.audience_segment,
        sc.geo_focus,
        sc.target_window_months,
        sc.context_form,
        m.slug AS methodology_slug,
        m.name AS methodology_name,
        sc.brand_id,
        b.name AS brand_name,
        b.display_name AS brand_display_name,
        b.industry AS brand_industry,
        b.industry_sub AS brand_industry_sub,
        b.countries AS brand_countries,
        b.brand_seed_handles,
        b.description AS brand_description,
        sc.theme_id,
        t.name AS theme_name,
        t.description AS theme_description,
        t.industry_focus AS theme_industry_focus,
        t.geo_focus AS theme_geo_focus
      FROM study_corpora sc
      JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE sc.id = $1
      LIMIT 1
    `,
    [corpusId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Corpus ${corpusId} not found.`);
  return row;
}

function toSampleMention(row: MentionRow): SampleMention {
  const text = row.text_snippet ?? row.text_clean.slice(0, 280);
  return {
    id: row.id,
    text_snippet: text,
    platform: row.platform,
    language: row.language,
    country: row.country,
    sentiment_source: row.sentiment_source,
    quality_flags: {}
  };
}
