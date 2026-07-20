import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildFallbackQuery,
  buildGenerationContract,
  buildQueryComposerPrompt,
  parseComposedQueryJson,
  queryValidationReports,
  QUERY_ENGINE_PIPELINE_VERSION,
  type ComposedQuery,
  type QueryCompetitorEntity,
  type QueryComposerInput
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { ensureQueryStrategyBrief, loadAnalysisRagContext } from "./analysis-rag-context";
import { materializeQueryPacksForIteration } from "./query-packs";

type ComposeInitialQueryJobData = {
  corpusId: string;
  requestedByUserId: string;
  pipelineVersion?: string;
};

type CorpusComposerRow = {
  corpus_id: string;
  corpus_name: string | null;
  business_question: string | null;
  decision_to_inform: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  brand_id: string | null;
  theme_id: string | null;
  base_corpus_id: string | null;
  methodology_slug: string;
  methodology_name: string;
  methodology_version: string;
  manifest: QueryComposerInput["methodology"]["manifest"];
  brand_slug: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  brand_industry_sub: string | null;
  brand_countries: string[] | null;
  brand_seed_handles: string[] | null;
  brand_description: string | null;
  theme_slug: string | null;
  theme_name: string | null;
  theme_description: string | null;
  theme_industry_focus: string[] | null;
  theme_geo_focus: string[] | null;
};

type MemoryRow = {
  type: string;
  content: unknown;
};

export async function composeInitialQueryJob(job: Job<ComposeInitialQueryJobData>) {
  await job.updateProgress(10);
  const baseInput = await loadComposerInput(job.data.corpusId);
  await job.updateProgress(35);

  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const queryStrategyBrief = await ensureQueryStrategyBrief({
    input: baseInput,
    model,
    requestedByUserId: job.data.requestedByUserId
  });
  const input: QueryComposerInput = {
    ...baseInput,
    queryStrategyBrief,
    knowledgeSources: [
      { type: "query_strategy_brief", content: queryStrategyBrief },
      ...baseInput.knowledgeSources.filter((source) => source.type !== "query_strategy_brief")
    ]
  };
  await job.updateProgress(50);

  const composed = await composeWithClaude(input, model);
  await job.updateProgress(75);

  const iterationNumber = await nextIterationNumber(input.corpus.id);
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
      input.corpus.id,
      iterationNumber,
      composed.query_text,
      composed.competitor_query_text ?? null,
      composed.industry_query_text ?? null,
      JSON.stringify(composed.query_components),
      job.data.requestedByUserId,
      job.data.pipelineVersion ?? QUERY_ENGINE_PIPELINE_VERSION
    ]
  );
  const iteration = inserted.rows[0];

  if (!iteration) {
    throw new Error("Could not persist query iteration.");
  }

  const queryPacks = await materializeQueryPacksForIteration({
    corpusId: input.corpus.id,
    queryIterationId: iteration.id,
    input,
    composed,
    requestedByUserId: job.data.requestedByUserId
  });

  await job.updateProgress(100);

  return {
    query_iteration_id: iteration.id,
    query_text: iteration.query_text,
    iteration_number: iterationNumber,
    planned_query_packs: queryPacks.planned_packs
  };
}

async function composeWithClaude(input: QueryComposerInput, model: string): Promise<ComposedQuery> {
  const prompt = buildQueryComposerPrompt(input);

  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2
    });

    let composed = parseComposedQueryJson(result.text, input, model);
    const rejectedScopes = composed.query_components.generation_contract?.fallback_scopes ?? [];
    if (rejectedScopes.length > 0) {
      const repairResult = await generateText({
        model: anthropic(model),
        prompt: [
          prompt,
          "",
          "REPARACION OBLIGATORIA DEL COMPILADOR:",
          `Los scopes ${rejectedScopes.join(", ")} fueron rechazados por el compilador estructural y/o semantico.`,
          "Corrige SOLO los errores reportados y conserva la intencion, la evidencia RAG y el modo de construccion.",
          "En modo exploratory no agregues un AND tematico. En modo detection conserva THEME balanceado. No mezcles competidores.",
          "Respuesta rechazada:",
          result.text,
          "Errores estructurales:",
          JSON.stringify(composed.query_components.generation_contract?.rejected_queries ?? {}, null, 2),
          "Errores semanticos:",
          JSON.stringify(composed.query_components.generation_contract?.rejected_semantic_queries ?? {}, null, 2)
        ].join("\n"),
        temperature: 0
      });
      const repaired = parseComposedQueryJson(repairResult.text, input, model);
      const repairedFallbackScopes = repaired.query_components.generation_contract?.fallback_scopes ?? [];
      if (repairedFallbackScopes.length < rejectedScopes.length) composed = repaired;
    }

    return refreshGenerationContract(composed, input);
  } catch (error) {
    // TODO mejora-futura: registrar errores LLM en tabla pipeline_logs y
    // alertar cuando fallback se use mas de N veces por dia.
    const fallback = buildFallbackQuery(input);
    return {
      ...fallback,
      query_components: {
        ...fallback.query_components,
        model,
        fallback_used: true,
        fallback_reason: error instanceof Error ? error.message : "unknown_llm_error"
      }
    };
  }
}

async function loadComposerInput(corpusId: string): Promise<QueryComposerInput> {
  const result = await pool.query<CorpusComposerRow>(
    `
      SELECT
        sc.id AS corpus_id,
        sc.name AS corpus_name,
        sc.business_question,
        sc.decision_to_inform,
        sc.audience_segment,
        sc.geo_focus,
        sc.target_window_months,
        sc.context_form,
        sc.brand_id,
        sc.theme_id,
        sc.base_corpus_id,
        m.slug AS methodology_slug,
        m.name AS methodology_name,
        m.version AS methodology_version,
        m.manifest_yaml AS manifest,
        b.slug AS brand_slug,
        b.name AS brand_name,
        b.display_name AS brand_display_name,
        b.industry AS brand_industry,
        b.industry_sub AS brand_industry_sub,
        b.countries AS brand_countries,
        b.brand_seed_handles AS brand_seed_handles,
        b.description AS brand_description,
        t.slug AS theme_slug,
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

  if (!row) {
    throw new Error(`Corpus not found: ${corpusId}`);
  }

  return row.brand_id ? loadBrandInput(row) : loadThemeInput(row);
}

async function loadBrandInput(row: CorpusComposerRow): Promise<QueryComposerInput> {
  const competitors = await pool.query<{ canonical_name: string; aliases: string[] | null }>(
    `
      SELECT bs.canonical_name, bs.aliases
      FROM competitors c
      JOIN brand_seeds bs ON bs.id = c.competitor_brand_seed_id
      WHERE c.brand_id = $1
      ORDER BY c.priority NULLS LAST
    `,
    [row.brand_id]
  );
  const corpusEntitySeeds = await loadCorpusEntitySeeds([row.corpus_id, row.base_corpus_id]);
  const competitorEntities = mergeCompetitorEntities(
    competitors.rows.map((competitor) => ({
      name: competitor.canonical_name,
      aliases: competitor.aliases ?? []
    })),
    corpusEntitySeeds.competitorEntities
  );
  const industryMemory = row.brand_industry
    ? await pool.query<MemoryRow>(
        `
          SELECT memory_type AS type, content
          FROM memory_industry
          WHERE industry = $1
            AND (methodology_slug = $2 OR methodology_slug IS NULL)
            AND shareable = true
          ORDER BY evidence_count DESC NULLS LAST
          LIMIT 20
        `,
        [row.brand_industry, row.methodology_slug]
      )
    : { rows: [] as MemoryRow[] };
  const brandMemory = await pool.query<MemoryRow>(
    `
      SELECT memory_type AS type, content
      FROM memory_brand
      WHERE brand_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `,
    [row.brand_id]
  );
  const ragContext = await loadAnalysisRagContext(row.corpus_id, row.brand_id);

  return {
    corpus: {
      id: row.corpus_id,
      name: row.corpus_name,
      businessQuestion: row.business_question,
      decisionToInform: row.decision_to_inform,
      audienceSegment: row.audience_segment,
      geoFocus: row.geo_focus ?? [],
      targetWindowMonths: row.target_window_months,
      contextForm: row.context_form
    },
    subject: {
      type: "brand",
      name: row.brand_display_name ?? row.brand_name ?? "Marca",
      slug: row.brand_slug ?? "brand",
      industry: row.brand_industry,
      industrySub: row.brand_industry_sub,
      countries: row.brand_countries ?? [],
      brandSeedHandles: row.brand_seed_handles ?? [],
      description: row.brand_description
    },
    methodology: {
      slug: row.methodology_slug,
      name: row.methodology_name,
      version: row.methodology_version,
      manifest: row.manifest
    },
    competitors: flattenCompetitorEntities(competitorEntities),
    competitorEntities,
    brandSeeds: [
      row.brand_name ?? "",
      row.brand_display_name ?? "",
      ...(row.brand_seed_handles ?? []),
      ...corpusEntitySeeds.primaryBrand
    ].filter(Boolean),
    knowledgeSources: ragContext.knowledgeSources,
    queryStrategyBrief: ragContext.queryStrategyBrief ?? undefined,
    memoryIndustry: industryMemory.rows,
    memoryBrand: brandMemory.rows
  };
}

async function loadThemeInput(row: CorpusComposerRow): Promise<QueryComposerInput> {
  const corpusEntitySeeds = await loadCorpusEntitySeeds([row.corpus_id, row.base_corpus_id]);
  const competitorEntities = mergeCompetitorEntities(corpusEntitySeeds.competitorEntities);
  const ragContext = await loadAnalysisRagContext(row.corpus_id, null);
  return {
    corpus: {
      id: row.corpus_id,
      name: row.corpus_name,
      businessQuestion: row.business_question,
      decisionToInform: row.decision_to_inform,
      audienceSegment: row.audience_segment,
      geoFocus: row.geo_focus ?? row.theme_geo_focus ?? [],
      targetWindowMonths: row.target_window_months,
      contextForm: row.context_form
    },
    subject: {
      type: "theme",
      name: row.theme_name ?? "Theme",
      slug: row.theme_slug ?? "theme",
      industry: row.theme_industry_focus?.[0] ?? null,
      industrySub: null,
      countries: row.theme_geo_focus ?? [],
      brandSeedHandles: [],
      description: row.theme_description
    },
    methodology: {
      slug: row.methodology_slug,
      name: row.methodology_name,
      version: row.methodology_version,
      manifest: row.manifest
    },
    competitors: flattenCompetitorEntities(competitorEntities),
    competitorEntities,
    brandSeeds: [row.theme_name ?? "", ...corpusEntitySeeds.primaryBrand].filter(Boolean),
    knowledgeSources: ragContext.knowledgeSources,
    queryStrategyBrief: ragContext.queryStrategyBrief ?? undefined,
    memoryIndustry: [],
    memoryBrand: []
  };
}

function refreshGenerationContract(composed: ComposedQuery, input: QueryComposerInput): ComposedQuery {
  const queries = queryValidationReports({
    brand: composed.query_text,
    ...Object.fromEntries(
      (composed.competitor_queries ?? []).map((item) => [
        `competitor:${item.entity}`,
        item.query_text
      ])
    ),
    ...(composed.industry_query_text ? { category: composed.industry_query_text } : {})
  });
  const previous = composed.query_components.generation_contract;
  return {
    ...composed,
    query_components: {
      ...composed.query_components,
      generation_contract: {
        ...buildGenerationContract(input, queries),
        ...(previous?.rejected_queries ? { rejected_queries: previous.rejected_queries } : {}),
        ...(previous?.rejected_semantic_queries
          ? { rejected_semantic_queries: previous.rejected_semantic_queries }
          : {}),
        ...(previous?.fallback_scopes ? { fallback_scopes: previous.fallback_scopes } : {})
      }
    }
  };
}

async function loadCorpusEntitySeeds(corpusIds: Array<string | null>) {
  const ids = Array.from(new Set(corpusIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) {
    return { competitorEntities: [], primaryBrand: [] };
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

  const competitorEntities: QueryCompetitorEntity[] = [];
  const primaryBrand: string[] = [];
  for (const row of result.rows) {
    const seeds = [
      row.name,
      ...(row.aliases ?? []),
      ...(row.handles ?? []),
      ...(row.query_seeds ?? [])
    ].filter(Boolean);
    if (row.entity_kind === "competitor") {
      competitorEntities.push({
        name: row.name,
        aliases: uniqueStrings([...(row.aliases ?? []), ...(row.query_seeds ?? [])]),
        handles: uniqueStrings(row.handles ?? [])
      });
    }
    if (row.entity_kind === "primary_brand") primaryBrand.push(...seeds);
  }

  return {
    competitorEntities: mergeCompetitorEntities(competitorEntities),
    primaryBrand: Array.from(new Set(primaryBrand)).slice(0, 40)
  };
}

function mergeCompetitorEntities(...groups: QueryCompetitorEntity[][]): QueryCompetitorEntity[] {
  const merged = new Map<string, QueryCompetitorEntity>();
  for (const entity of groups.flat()) {
    const name = entity.name.trim();
    if (!name) continue;
    const key = normalizeEntityName(name);
    const current = merged.get(key);
    merged.set(key, {
      name: current?.name ?? name,
      aliases: uniqueStrings([...(current?.aliases ?? []), ...(entity.aliases ?? [])])
        .filter((value) => normalizeEntityName(value) !== key),
      handles: uniqueStrings([...(current?.handles ?? []), ...(entity.handles ?? [])])
    });
  }
  return Array.from(merged.values()).slice(0, 20);
}

function flattenCompetitorEntities(entities: QueryCompetitorEntity[]) {
  return uniqueStrings(entities.flatMap((entity) => [
    entity.name,
    ...(entity.aliases ?? []),
    ...(entity.handles ?? [])
  ])).slice(0, 80);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeEntityName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function nextIterationNumber(corpusId: string) {
  const result = await pool.query<{ next_iteration: number }>(
    `
      SELECT coalesce(max(iteration_number), 0)::int + 1 AS next_iteration
      FROM query_iterations
      WHERE study_corpus_id = $1
    `,
    [corpusId]
  );

  return result.rows[0]?.next_iteration ?? 1;
}
