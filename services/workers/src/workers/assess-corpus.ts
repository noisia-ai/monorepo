import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { Job } from "bullmq";
import { z } from "zod";

import {
  buildCorpusClassificationPrompt,
  computeDeterministicCorpusAssessment,
  CORPUS_ASSESSMENT_BATCH_SIZE,
  CORPUS_ASSESSMENT_FULL_POPULATION_LIMIT,
  CORPUS_ASSESSMENT_PIPELINE_VERSION,
  CORPUS_ASSESSMENT_STRATIFIED_SAMPLE_SIZE,
  type CorpusAssessmentClassification,
  type CorpusAssessmentMention
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  aliasQueryPackSample,
  restoreQueryPackClassificationIds
} from "./query-pack-classification-ids";

type AssessCorpusJobData = {
  corpusId: string;
  corpusRevision?: number;
  requestedByUserId: string;
};

type CorpusContextRow = {
  corpus_id: string;
  corpus_revision: number;
  business_question: string | null;
  geo_focus: string[] | null;
  methodology_slug: string;
  methodology_name: string;
  brand_id: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  theme_id: string | null;
  theme_name: string | null;
};

type MentionRow = CorpusAssessmentMention & {
  text_clean: string;
};

const classificationSchema = z.object({
  mention_id: z.string().min(1),
  relevance: z.enum(["relevant", "partial", "noise"]),
  signal_types: z.array(
    z.enum(["trigger", "barrier", "experience", "comparison", "category_language", "other_signal"])
  ).max(6),
  reason: z.string().min(1).max(600)
});

const batchSchema = z.object({
  classifications: z.array(classificationSchema).min(1).max(CORPUS_ASSESSMENT_BATCH_SIZE + 5)
});

export async function assessCorpusJob(job: Job<AssessCorpusJobData>) {
  await job.updateProgress(5);
  const corpus = await loadCorpusContext(job.data.corpusId);
  if (
    job.data.corpusRevision !== undefined
    && job.data.corpusRevision !== corpus.corpus_revision
  ) {
    throw new Error(
      `Corpus revision changed before assessment started (requested r${job.data.corpusRevision}, current r${corpus.corpus_revision}).`
    );
  }
  const populationSize = await countIncludedMentions(job.data.corpusId);
  if (populationSize === 0) throw new Error("The corpus has no included mentions to assess.");

  const fullPopulation = populationSize <= CORPUS_ASSESSMENT_FULL_POPULATION_LIMIT;
  const targetSize = fullPopulation
    ? populationSize
    : Math.min(populationSize, CORPUS_ASSESSMENT_STRATIFIED_SAMPLE_SIZE);
  const sampleStrategy = fullPopulation
    ? "full_population"
    : "stratified_platform_month_pack_deterministic";
  const mentions = await loadAssessmentMentions({
    corpusId: job.data.corpusId,
    corpusRevision: corpus.corpus_revision,
    populationSize,
    targetSize,
    fullPopulation
  });
  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const assessmentId = await createAssessment({
    corpusId: job.data.corpusId,
    corpusRevision: corpus.corpus_revision,
    populationSize,
    sampleSize: mentions.length,
    sampleStrategy,
    model,
    requestedByUserId: job.data.requestedByUserId
  });
  await job.updateProgress(12);

  try {
    const classifications: CorpusAssessmentClassification[] = [];
    const batches = chunk(mentions, CORPUS_ASSESSMENT_BATCH_SIZE);
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index] ?? [];
      const batchClassifications = await classifyBatch({ corpus, mentions: batch, model });
      await persistAssessmentClassifications(assessmentId, batchClassifications);
      classifications.push(...batchClassifications);
      await job.updateProgress(12 + Math.round(((index + 1) / batches.length) * 76));
    }

    const result = computeDeterministicCorpusAssessment({ populationSize, classifications });
    const latestAssessment = {
      ...result,
      corpus_revision: corpus.corpus_revision,
      population_size: populationSize,
      sample_size: mentions.length,
      sample_strategy: sampleStrategy,
      model,
      pipeline_version: CORPUS_ASSESSMENT_PIPELINE_VERSION
    };
    await completeAssessment(assessmentId, result);
    const promoted = await pool.query(
      `UPDATE study_corpora
       SET latest_assessment = $1::jsonb,
           latest_assessed_at = now(),
           latest_assessed_revision = corpus_revision
       WHERE id = $2 AND corpus_revision = $3`,
      [JSON.stringify(latestAssessment), job.data.corpusId, corpus.corpus_revision]
    );
    if (promoted.rowCount !== 1) {
      throw new Error(
        `Corpus revision changed during assessment of r${corpus.corpus_revision}; the result was not promoted.`
      );
    }
    await job.updateProgress(100);
    return { corpus_id: job.data.corpusId, assessment_id: assessmentId, ...latestAssessment };
  } catch (error) {
    await failAssessment(assessmentId, error);
    throw error;
  }
}

async function classifyBatch(input: {
  corpus: CorpusContextRow;
  mentions: MentionRow[];
  model: string;
}) {
  const sample = input.mentions.map(toAssessmentMention);
  const { aliasedSample, originalIdByAlias } = aliasQueryPackSample(sample);
  const result = await generateObject({
    model: anthropic(input.model),
    schema: batchSchema,
    prompt: buildCorpusClassificationPrompt({
      methodologySlug: input.corpus.methodology_slug,
      businessQuestion: input.corpus.business_question,
      subjectName: input.corpus.brand_display_name
        ?? input.corpus.brand_name
        ?? input.corpus.theme_name
        ?? "Study subject",
      geoFocus: input.corpus.geo_focus ?? [],
      mentions: aliasedSample
    }),
    temperature: 0,
    maxRetries: 2
  });
  const restored = restoreQueryPackClassificationIds(
    result.object.classifications,
    originalIdByAlias
  );
  assertCompleteClassifications(sample, restored);
  return restored;
}

async function loadCorpusContext(corpusId: string): Promise<CorpusContextRow> {
  const result = await pool.query<CorpusContextRow>(
    `
      SELECT
        sc.id AS corpus_id,
        sc.corpus_revision,
        sc.business_question,
        sc.geo_focus,
        m.slug AS methodology_slug,
        m.name AS methodology_name,
        sc.brand_id,
        b.name AS brand_name,
        b.display_name AS brand_display_name,
        sc.theme_id,
        t.name AS theme_name
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

async function countIncludedMentions(corpusId: string) {
  const result = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'`,
    [corpusId]
  );
  return result.rows[0]?.total ?? 0;
}

async function loadAssessmentMentions(input: {
  corpusId: string;
  corpusRevision: number;
  populationSize: number;
  targetSize: number;
  fullPopulation: boolean;
}) {
  if (input.fullPopulation) {
    const result = await pool.query<MentionRow>(
      `SELECT id, text_snippet, text_clean, platform, language, country, sentiment_source
       FROM mentions
       WHERE study_corpus_id = $1 AND inclusion_status = 'included'
       ORDER BY id`,
      [input.corpusId]
    );
    return result.rows;
  }

  const result = await pool.query<MentionRow>(
    `
      WITH source_dimensions AS (
        SELECT
          mention_id,
          coalesce(min(query_pack_id::text), 'unattributed') AS query_pack
        FROM mention_query_sources
        WHERE study_corpus_id = $1
        GROUP BY mention_id
      ), ranked AS (
        SELECT
          m.id,
          m.text_snippet,
          m.text_clean,
          m.platform,
          m.language,
          m.country,
          m.sentiment_source,
          row_number() OVER (
            PARTITION BY
              coalesce(m.platform, 'unknown'),
              date_trunc('month', m.published_at),
              coalesce(sd.query_pack, 'unattributed')
            ORDER BY md5(m.id::text || $2::text)
          ) AS stratum_rank,
          count(*) OVER (
            PARTITION BY
              coalesce(m.platform, 'unknown'),
              date_trunc('month', m.published_at),
              coalesce(sd.query_pack, 'unattributed')
          ) AS stratum_size
        FROM mentions m
        LEFT JOIN source_dimensions sd ON sd.mention_id = m.id
        WHERE m.study_corpus_id = $1 AND m.inclusion_status = 'included'
      )
      SELECT id, text_snippet, text_clean, platform, language, country, sentiment_source
      FROM ranked
      WHERE stratum_rank <= greatest(1, ceil(stratum_size::numeric / $3::numeric * $4::numeric))
      ORDER BY md5(id::text || $2::text)
      LIMIT $4
    `,
    [input.corpusId, input.corpusRevision, input.populationSize, input.targetSize]
  );
  return result.rows;
}

async function createAssessment(input: {
  corpusId: string;
  corpusRevision: number;
  populationSize: number;
  sampleSize: number;
  sampleStrategy: string;
  model: string;
  requestedByUserId: string;
}) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO corpus_assessments (
       study_corpus_id, corpus_revision, population_size, sample_size, sample_strategy,
       status, model, pipeline_version, requested_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8)
     RETURNING id`,
    [
      input.corpusId,
      input.corpusRevision,
      input.populationSize,
      input.sampleSize,
      input.sampleStrategy,
      input.model,
      CORPUS_ASSESSMENT_PIPELINE_VERSION,
      input.requestedByUserId
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Could not create corpus assessment.");
  return id;
}

async function persistAssessmentClassifications(
  assessmentId: string,
  classifications: CorpusAssessmentClassification[]
) {
  await pool.query(
    `INSERT INTO corpus_assessment_mentions (
       corpus_assessment_id, mention_id, relevance, signal_types, reason
     )
     SELECT $1::uuid, item.mention_id::uuid, item.relevance, item.signal_types, item.reason
     FROM jsonb_to_recordset($2::jsonb) AS item(
       mention_id text,
       relevance text,
       signal_types text[],
       reason text
     )
     ON CONFLICT (corpus_assessment_id, mention_id) DO UPDATE
     SET relevance = EXCLUDED.relevance,
         signal_types = EXCLUDED.signal_types,
         reason = EXCLUDED.reason`,
    [assessmentId, JSON.stringify(classifications)]
  );
}

async function completeAssessment(
  assessmentId: string,
  result: ReturnType<typeof computeDeterministicCorpusAssessment>
) {
  await pool.query(
    `UPDATE corpus_assessments
     SET status = 'completed',
         ready_for_study = $1,
         confidence = $2,
         verdict = $3,
         metrics = $4::jsonb,
         findings = $5::jsonb,
         completed_at = now()
     WHERE id = $6`,
    [
      result.ready_for_study,
      result.confidence,
      result.verdict,
      JSON.stringify({ ...result.metrics, coverage: result.coverage }),
      JSON.stringify({
        signals_well_covered: result.signals_well_covered,
        signals_missing: result.signals_missing,
        recommendation: result.recommendation
      }),
      assessmentId
    ]
  );
}

async function failAssessment(assessmentId: string, error: unknown) {
  await pool.query(
    `UPDATE corpus_assessments
     SET status = 'failed',
         findings = jsonb_build_object('error', $1::text),
         completed_at = now()
     WHERE id = $2`,
    [error instanceof Error ? error.message : String(error), assessmentId]
  );
}

function assertCompleteClassifications(
  mentions: CorpusAssessmentMention[],
  classifications: CorpusAssessmentClassification[]
) {
  const expected = new Set(mentions.map((mention) => mention.id));
  const seen = new Set<string>();
  for (const classification of classifications) {
    if (!expected.has(classification.mention_id)) {
      throw new Error(`Corpus assessor returned unknown mention_id: ${classification.mention_id}`);
    }
    if (seen.has(classification.mention_id)) {
      throw new Error(`Corpus assessor returned duplicate mention_id: ${classification.mention_id}`);
    }
    seen.add(classification.mention_id);
  }
  if (seen.size !== expected.size) {
    throw new Error(`Corpus assessor classified ${seen.size}/${expected.size} mentions in the batch.`);
  }
}

function toAssessmentMention(row: MentionRow): CorpusAssessmentMention {
  return {
    id: row.id,
    text_snippet: row.text_snippet ?? row.text_clean.slice(0, 500),
    platform: row.platform,
    language: row.language,
    country: row.country,
    sentiment_source: row.sentiment_source
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
