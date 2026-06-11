import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildQueryRefinementPrompt,
  parseComposedQueryJson,
  QUERY_ENGINE_PIPELINE_VERSION,
  SENTIONE_LQL_RULES,
  type ComposedQuery,
  type EvaluationHistoryEntry,
  type QueryComposerInput
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";
import { materializeQueryPacksForIteration } from "./query-packs";

type ApplyAdjustmentsJobData = {
  corpusId: string;
  sourceIterationId: string;
  proposedAdjustments: string[];
  evaluation: {
    quality_score: number;
    density_score: number;
    noise_score: number;
    notes: string;
  };
  requestedByUserId: string;
  /** Optional free-form instructions from the analyst added to the prompt verbatim. */
  userComments?: string;
};

type SourceIterationRow = {
  query_text: string;
  competitor_query_text: string | null;
  industry_query_text: string | null;
  query_components: unknown;
};

export async function applyQueryAdjustmentsJob(job: Job<ApplyAdjustmentsJobData>) {
  await job.updateProgress(10);

  const { corpusId, sourceIterationId, proposedAdjustments, evaluation } = job.data;

  // Load the source iteration and corpus context
  const srcResult = await pool.query<SourceIterationRow>(
    `SELECT query_text, competitor_query_text, industry_query_text, query_components FROM query_iterations WHERE id = $1 AND study_corpus_id = $2 LIMIT 1`,
    [sourceIterationId, corpusId]
  );

  const sourceIteration = srcResult.rows[0];
  if (!sourceIteration) {
    throw new Error(`Source iteration ${sourceIterationId} not found.`);
  }

  await job.updateProgress(25);

  const [corpusInput, evaluationHistory] = await Promise.all([
    loadCorpusContext(corpusId),
    loadEvaluationHistory(corpusId)
  ]);
  await job.updateProgress(45);
  console.log(`[apply-adjustments] Loaded ${evaluationHistory.length} history entries for context`);

  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const prompt = buildQueryRefinementPrompt({
    previousQueryText: sourceIteration.query_text,
    proposedAdjustments,
    evaluation,
    subject: corpusInput.subject,
    corpus: corpusInput.corpus,
    methodology: { slug: corpusInput.methodology.slug, name: corpusInput.methodology.name },
    knowledgeSources: corpusInput.knowledgeSources,
    queryStrategyBrief: corpusInput.queryStrategyBrief,
    evaluationHistory,
    userComments: job.data.userComments
  });

  let composed: ComposedQuery;
  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2
    });
    console.log(`[apply-adjustments] Claude response (first 200): ${result.text.slice(0, 200)}`);
    composed = parseComposedQueryJson(result.text, corpusInput, model);

    if (!composed.competitor_query_text || composed.competitor_query_text.length === 0) {
      console.warn(`[apply-adjustments] Claude returned no competitor query — retrying`);
      const competitorOnly = await generateCompetitorQuery({
        brandQueryText: composed.query_text,
        corpus: corpusInput,
        model
      });
      if (competitorOnly) {
        composed = { ...composed, competitor_query_text: competitorOnly };
      }
    }
    // If Claude dropped the industry query, do a focused retry asking ONLY for that one.
    if (!composed.industry_query_text || composed.industry_query_text.length === 0) {
      console.warn(`[apply-adjustments] Claude returned only brand query — retrying for industry`);
      const industryOnly = await generateIndustryQuery({
        brandQueryText: composed.query_text,
        corpus: corpusInput,
        model
      });
      if (industryOnly) {
        composed = { ...composed, industry_query_text: industryOnly };
      }
    }
  } catch (err) {
    console.error(`[apply-adjustments] Claude failed: ${err instanceof Error ? err.message : err}`);
    // Fall back to source iteration with minimal modifications
    composed = {
      query_text: sourceIteration.query_text,
      competitor_query_text: sourceIteration.competitor_query_text ?? undefined,
      industry_query_text: sourceIteration.industry_query_text ?? undefined,
      query_components: {
        ...(typeof sourceIteration.query_components === "object" && sourceIteration.query_components !== null
          ? sourceIteration.query_components as Record<string, unknown>
          : {}),
        brand_seeds: [],
        competitor_seeds: [],
        category_seeds: [],
        trigger_phrases_tb: [],
        barrier_phrases_tb: [],
        global_exclusions: [],
        memory_industry: [],
        memory_brand: [],
        model,
        fallback_used: true,
        fallback_reason: err instanceof Error ? err.message : "unknown"
      }
    };
  }

  await job.updateProgress(75);

  const iterationNumber = await nextIterationNumber(corpusId);
  const inserted = await pool.query<{ id: string; query_text: string }>(
    `
      INSERT INTO query_iterations (
        study_corpus_id,
        iteration_number,
        query_text,
        competitor_query_text,
        industry_query_text,
        query_components,
        insights_manager_user_id,
        pipeline_version
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      RETURNING id, query_text
    `,
    [
      corpusId,
      iterationNumber,
      composed.query_text,
      composed.competitor_query_text ?? null,
      composed.industry_query_text ?? null,
      JSON.stringify(composed.query_components),
      job.data.requestedByUserId,
      QUERY_ENGINE_PIPELINE_VERSION
    ]
  );

  const newIteration = inserted.rows[0];
  if (!newIteration) {
    throw new Error("Could not persist refined query iteration.");
  }

  const queryPacks = await materializeQueryPacksForIteration({
    corpusId,
    queryIterationId: newIteration.id,
    input: corpusInput,
    composed,
    requestedByUserId: job.data.requestedByUserId
  });

  await job.updateProgress(100);

  return {
    source_iteration_id: sourceIterationId,
    new_iteration_id: newIteration.id,
    iteration_number: iterationNumber,
    query_text: newIteration.query_text,
    planned_query_packs: queryPacks.planned_packs
  };
}

async function generateCompetitorQuery(params: {
  brandQueryText: string;
  corpus: QueryComposerInput;
  model: string;
}): Promise<string | null> {
  const { brandQueryText, corpus, model } = params;
  if (corpus.competitors.length === 0) return null;
  const prompt = [
    "Tarea unica: derivar la version COMPETENCIA de una query booleana de marca.",
    "Devuelve SOLAMENTE la query booleana en una sola linea. Sin JSON, sin comentarios, sin etiquetas.",
    "",
    "Reglas:",
    "- La query de competencia usa SOLO competidores nombrados + la misma señal.",
    "- NO incluyas la marca principal ni sus handles.",
    "- Mantiene la misma calidad de exclusiones que la query de marca, sin excluir a los competidores.",
    "",
    SENTIONE_LQL_RULES,
    "",
    `Competidores disponibles: ${corpus.competitors.slice(0, 20).join(", ")}`,
    "",
    `Query de marca de referencia:\n${brandQueryText}`,
    "",
    `Pregunta de negocio: ${corpus.corpus.businessQuestion ?? "n/a"}`,
    "",
    "Devuelve la query de competencia ahora (una sola linea, sin envoltorio):"
  ].join("\n");

  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2
    });
    const cleaned = result.text
      .trim()
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```$/i, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (cleaned.length === 0 || cleaned.length > 4000) return null;
    return cleaned;
  } catch (err) {
    console.error(`[apply-adjustments] Competitor retry failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Focused second-pass call: ask Claude for ONLY the industry version of a
 * brand query that we already have. Returns plain text — no JSON envelope —
 * because we can't trust Claude to keep the schema on a one-shot retry.
 */
async function generateIndustryQuery(params: {
  brandQueryText: string;
  corpus: QueryComposerInput;
  model: string;
}): Promise<string | null> {
  const { brandQueryText, corpus, model } = params;
  const prompt = [
    "Tarea unica: derivar la version INDUSTRIA de una query booleana de marca.",
    "Devuelve SOLAMENTE la query booleana en una sola linea. Sin JSON, sin comentarios, sin etiquetas.",
    "",
    "Reglas:",
    "- La query de industria mide la misma tematica pero SIN semillas de marca ni handles ni competidores nombrados.",
    "- Usa terminos de categoria + frases de señal del lenguaje real.",
    "- Misma calidad de exclusiones que la query de marca, sin la marca misma en NOT.",
    "",
    SENTIONE_LQL_RULES,
    "",
    `Query de marca de referencia:\n${brandQueryText}`,
    "",
    `Contexto: subject=${corpus.subject.type}/${corpus.subject.name}, industria=${corpus.subject.industry ?? "n/a"}, sub=${corpus.subject.industrySub ?? "n/a"}, paises=${(corpus.subject.countries ?? []).join(",")}.`,
    `Pregunta de negocio: ${corpus.corpus.businessQuestion ?? "n/a"}`,
    "",
    "Devuelve la query de industria ahora (una sola linea, sin envoltorio):"
  ].join("\n");

  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2
    });
    const cleaned = result.text
      .trim()
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```$/i, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (cleaned.length === 0 || cleaned.length > 4000) return null;
    console.log(`[apply-adjustments] Industry retry produced ${cleaned.length} chars`);
    return cleaned;
  } catch (err) {
    console.error(`[apply-adjustments] Industry retry failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function loadEvaluationHistory(corpusId: string): Promise<EvaluationHistoryEntry[]> {
  const result = await pool.query<{
    iteration_number: number;
    query_text: string;
    quality_score: string;
    density_score: string;
    noise_score: string;
    ai_evaluation_notes: string | null;
  }>(
    `SELECT iteration_number, query_text, quality_score, density_score, noise_score, ai_evaluation_notes
     FROM query_iterations
     WHERE study_corpus_id = $1
       AND quality_score IS NOT NULL
     ORDER BY iteration_number ASC`,
    [corpusId]
  );

  return result.rows.map((row) => {
    let notes = "";
    let adjustments: string[] = [];
    if (row.ai_evaluation_notes) {
      try {
        const parsed = JSON.parse(row.ai_evaluation_notes) as {
          notes?: string;
          proposed_adjustments?: string[];
        };
        notes = parsed.notes ?? "";
        adjustments = parsed.proposed_adjustments ?? [];
      } catch {
        notes = row.ai_evaluation_notes.slice(0, 200);
      }
    }
    return {
      iteration_number: row.iteration_number,
      query_text: row.query_text,
      quality_score: Number(row.quality_score),
      density_score: Number(row.density_score),
      noise_score: Number(row.noise_score),
      notes,
      proposed_adjustments: adjustments
    };
  });
}

async function nextIterationNumber(corpusId: string): Promise<number> {
  const result = await pool.query<{ max: string | null }>(
    `SELECT MAX(iteration_number) AS max FROM query_iterations WHERE study_corpus_id = $1`,
    [corpusId]
  );
  return (Number(result.rows[0]?.max ?? 0) || 0) + 1;
}

type CorpusContextRow = {
  corpus_id: string;
  business_question: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  base_corpus_id: string | null;
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

async function loadCorpusContext(corpusId: string): Promise<QueryComposerInput> {
  const result = await pool.query<CorpusContextRow>(
    `
      SELECT
        sc.id AS corpus_id,
        sc.business_question,
        sc.audience_segment,
        sc.geo_focus,
        sc.target_window_months,
        sc.context_form,
        sc.base_corpus_id,
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

  const competitorRows = row.brand_id
    ? await pool.query<{ canonical_name: string; aliases: string[] | null }>(
        `
          SELECT bs.canonical_name, bs.aliases
          FROM competitors c
          JOIN brand_seeds bs ON bs.id = c.competitor_brand_seed_id
          WHERE c.brand_id = $1
          ORDER BY c.priority NULLS LAST
        `,
        [row.brand_id]
      )
    : { rows: [] as Array<{ canonical_name: string; aliases: string[] | null }> };
  const corpusEntitySeeds = await loadCorpusEntitySeeds([row.corpus_id, row.base_corpus_id]);
  const ragContext = await loadAnalysisRagContext(row.corpus_id, row.brand_id);

  const subject: QueryComposerInput["subject"] = row.brand_id
    ? {
        type: "brand",
        name: row.brand_display_name ?? row.brand_name ?? "Marca",
        slug: row.brand_id,
        industry: row.brand_industry,
        industrySub: row.brand_industry_sub,
        countries: row.brand_countries ?? [],
        brandSeedHandles: row.brand_seed_handles ?? [],
        description: row.brand_description
      }
    : {
        type: "theme",
        name: row.theme_name ?? "Theme",
        slug: row.theme_id ?? "theme",
        industry: row.theme_industry_focus?.[0] ?? null,
        industrySub: null,
        countries: row.theme_geo_focus ?? [],
        brandSeedHandles: [],
        description: row.theme_description
      };

  return {
    corpus: {
      id: row.corpus_id,
      name: null,
      businessQuestion: row.business_question,
      decisionToInform: null,
      audienceSegment: row.audience_segment,
      geoFocus: row.geo_focus ?? [],
      targetWindowMonths: row.target_window_months,
      contextForm: row.context_form
    },
    subject,
    methodology: {
      slug: row.methodology_slug,
      name: row.methodology_name,
      version: "1",
      manifest: {}
    },
    competitors: competitorRows.rows.flatMap((competitor) => [
      competitor.canonical_name,
      ...(competitor.aliases ?? [])
    ]).concat(corpusEntitySeeds.competitors),
    brandSeeds: row.brand_id
      ? [
          row.brand_name ?? "",
          row.brand_display_name ?? "",
          ...(row.brand_seed_handles ?? []),
          ...corpusEntitySeeds.primaryBrand
        ].filter(Boolean)
      : [row.theme_name ?? "", ...corpusEntitySeeds.primaryBrand].filter(Boolean),
    knowledgeSources: ragContext.knowledgeSources,
    queryStrategyBrief: ragContext.queryStrategyBrief ?? undefined,
    memoryIndustry: [],
    memoryBrand: []
  };
}

async function loadCorpusEntitySeeds(corpusIds: Array<string | null>) {
  const ids = Array.from(new Set(corpusIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) {
    return { competitors: [], primaryBrand: [] };
  }
  const result = await pool.query<{
    entity_kind: string;
    name: string;
    aliases: string[] | null;
    handles: string[] | null;
    query_seeds: string[] | null;
  }>(
    `
      SELECT entity_kind, name, aliases, handles, query_seeds
      FROM corpus_entities
      WHERE study_corpus_id = ANY($1::uuid[])
        AND status = 'active'
      ORDER BY priority NULLS LAST, name
    `,
    [ids]
  );

  const competitors: string[] = [];
  const primaryBrand: string[] = [];
  for (const row of result.rows) {
    const seeds = [
      row.name,
      ...(row.aliases ?? []),
      ...(row.handles ?? []),
      ...(row.query_seeds ?? [])
    ].filter(Boolean);
    if (row.entity_kind === "competitor") competitors.push(...seeds);
    if (row.entity_kind === "primary_brand") primaryBrand.push(...seeds);
  }

  return {
    competitors: Array.from(new Set(competitors)).slice(0, 80),
    primaryBrand: Array.from(new Set(primaryBrand)).slice(0, 40)
  };
}
