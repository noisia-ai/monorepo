import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { Job } from "bullmq";
import { z } from "zod";

import {
  BOOLEAN_LISTENING_QUERY_RULES,
  buildGenerationContract,
  buildQueryConstructionInput,
  buildQueryConstructionPlan,
  PORTABLE_LISTEN_QUERY_MAX_LENGTH,
  queryValidationReports,
  QUERY_ENGINE_PIPELINE_VERSION,
  validateConstructedQuery,
  type ComposedQuery,
  type EvaluationHistoryEntry,
  type QueryCompetitorEntity,
  type QueryConstructionScope,
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

type SourcePackRow = {
  id: string;
  scope: "brand" | "competitors" | "category" | string;
  entity_key: string | null;
  signal_intent: string;
  objective: string | null;
  query_text: string | null;
  query_components: Record<string, unknown> | null;
  evaluation: Record<string, unknown> | null;
};

const refinedQuerySchema = z.object({
  // Keep transport parsing permissive enough to feed contract violations back
  // into the refinement loop. The listening adapter limit is enforced below.
  query: z.string().trim().min(1).max(PORTABLE_LISTEN_QUERY_MAX_LENGTH)
});

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

  const [corpusInput, evaluationHistory, sourcePacks] = await Promise.all([
    loadCorpusContext(corpusId),
    loadEvaluationHistory(corpusId),
    loadSourcePacks(corpusId, sourceIterationId)
  ]);
  await job.updateProgress(45);
  console.log(`[apply-adjustments] Loaded ${evaluationHistory.length} history entries for context`);

  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const queryComponents = typeof sourceIteration.query_components === "object"
    && sourceIteration.query_components !== null
    ? sourceIteration.query_components as ComposedQuery["query_components"]
    : null;
  if (!queryComponents) {
    throw new Error("The source iteration is missing query components.");
  }

  const identityGroups = groupSourcePacks(sourcePacks, corpusInput);
  const groupsToRefine = identityGroups.filter((group) =>
    group.packs.some((pack) => pack.evaluation?.status !== "ready")
  );
  const frozenGroups = identityGroups.filter((group) =>
    group.packs.every((pack) => pack.evaluation?.status === "ready")
  );
  if (groupsToRefine.length === 0) {
    throw new Error("All query packs are already stable; there is nothing to refine.");
  }

  const refinedByIdentity = new Map<string, string>();
  for (const group of groupsToRefine) {
    const representative = group.packs.find((pack) => pack.evaluation?.status !== "ready")
      ?? group.packs[0];
    if (!representative) continue;
    const currentQuery = sourceQueryForIdentity({
      iteration: sourceIteration,
      queryComponents,
      group
    });
    if (!currentQuery) throw new Error(`Query identity ${group.identity} has no source query.`);
    const packAdjustments = uniqueStrings(group.packs.flatMap((pack) =>
      stringArray(pack.evaluation?.proposed_adjustments)
    ));
    const refined = await generatePackQuery({
      pack: representative,
      identity: group.identity,
      entityLabel: group.entityLabel,
      relatedPacks: group.packs,
      currentQuery,
      proposedAdjustments: packAdjustments.length > 0 ? packAdjustments : proposedAdjustments,
      corpus: corpusInput,
      evaluation,
      evaluationHistory,
      userComments: job.data.userComments,
      model
    });
    if (normalizeQuery(refined) === normalizeQuery(currentQuery)) {
      throw new Error(`The ${group.identity} refinement did not change the query.`);
    }
    refinedByIdentity.set(group.identity, refined);
  }

  const sourceCompetitorQueries = firstClassCompetitorQueries({
    queryComponents,
    identityGroups,
    iteration: sourceIteration
  });
  const competitorQueries = sourceCompetitorQueries.map((item) => ({
    ...item,
    query_text: refinedByIdentity.get(queryIdentityKey("competitors", item.entity))
      ?? item.query_text
  }));
  const brandQuery = refinedByIdentity.get("brand") ?? sourceIteration.query_text;
  const categoryQuery = refinedByIdentity.get("category")
    ?? sourceIteration.industry_query_text
    ?? undefined;
  const legacyCompetitorQuery = refinedByIdentity.get("competitors:legacy-peer-set")
    ?? sourceIteration.competitor_query_text
    ?? undefined;
  const generationQueries = {
    brand: brandQuery,
    ...Object.fromEntries(competitorQueries.map((item) => [
      `competitor:${item.entity}`,
      item.query_text
    ])),
    ...(categoryQuery ? { category: categoryQuery } : {})
  };
  const composed: ComposedQuery = {
    query_text: brandQuery,
    ...(competitorQueries.length > 0 ? { competitor_queries: competitorQueries } : {}),
    ...(legacyCompetitorQuery ? { competitor_query_text: legacyCompetitorQuery } : {}),
    ...(categoryQuery ? { industry_query_text: categoryQuery } : {}),
    query_components: {
      ...queryComponents,
      ...(competitorQueries.length > 0 ? { competitor_queries: competitorQueries } : {}),
      model,
      generation_contract: buildGenerationContract(
        corpusInput,
        queryValidationReports(generationQueries),
        {
          validationMode: "structural_plus_imported_evidence",
          evidenceStatus: "validated_on_imported_mentions"
        }
      ),
      refinement: {
        source_iteration_id: sourceIterationId,
        refined_pack_scopes: uniqueStrings(groupsToRefine.flatMap((group) =>
          group.packs.map((pack) => pack.scope)
        )),
        frozen_pack_scopes: uniqueStrings(frozenGroups.flatMap((group) =>
          group.packs.map((pack) => pack.scope)
        )),
        refined_query_identities: groupsToRefine.map((group) => group.identity),
        frozen_query_identities: frozenGroups.map((group) => group.identity),
        applied_at: new Date().toISOString()
      }
    }
  };

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
    planned_query_packs: queryPacks.planned_packs,
    refined_pack_scopes: uniqueStrings(groupsToRefine.flatMap((group) =>
      group.packs.map((pack) => pack.scope)
    )),
    frozen_pack_scopes: uniqueStrings(frozenGroups.flatMap((group) =>
      group.packs.map((pack) => pack.scope)
    )),
    refined_query_identities: groupsToRefine.map((group) => group.identity),
    frozen_query_identities: frozenGroups.map((group) => group.identity)
  };
}

async function generatePackQuery(input: {
  pack: SourcePackRow;
  identity: string;
  entityLabel: string | null;
  relatedPacks: SourcePackRow[];
  currentQuery: string;
  proposedAdjustments: string[];
  corpus: QueryComposerInput;
  evaluation: ApplyAdjustmentsJobData["evaluation"];
  evaluationHistory: EvaluationHistoryEntry[];
  userComments?: string;
  model: string;
}) {
  const constructionInput = buildQueryConstructionInput(input.corpus);
  const constructionPlan = buildQueryConstructionPlan(constructionInput);
  const scope = constructionScope(input.pack.scope);
  const competitorEntity = scope === "competitors" && input.identity !== "competitors:legacy-peer-set"
    ? input.entityLabel ?? undefined
    : undefined;
  const scopeAnchors = scope === "brand"
    ? constructionPlan.anchors.brand
    : scope === "category"
      ? constructionPlan.anchors.category
      : constructionPlan.anchors.competitor_entities.find((entity) =>
          normalizeEntityName(entity.entity) === normalizeEntityName(competitorEntity ?? "")
        )?.terms ?? [];
  const basePrompt = [
    "Eres el refinador de hipótesis de queries de listening de Noisia.",
    `Refina UNA SOLA identidad canónica: ${input.identity}. No cambies ni propongas queries para otras identidades.`,
    "Devuelve la query booleana final en el campo query, sin Markdown ni explicación.",
    `La query debe ser ejecutable y respetar el límite portable de ${PORTABLE_LISTEN_QUERY_MAX_LENGTH} caracteres.`,
    "Conserva la intención del pack y aplica solo los ajustes respaldados por evidencia.",
    "No inventes marcas, mercados ni exclusiones no presentes en el contexto.",
    "No agrupes competidores: una query competitiva representa exactamente una entidad.",
    constructionPlan.mode === "exploratory"
      ? "MODO EXPLORATORIO: conserva recuperación amplia por entidad. No agregues un AND de triggers, barriers o frases de resultado; esas señales se clasifican después de importar."
      : "MODO DETECTION: conserva un bloque temático balanceado entre lenguaje positivo y negativo, respaldado por el plan.",
    "Usa frases naturales cortas; para conceptos más largos usa proximidad. Evita términos ambiguos aislados.",
    "Conserva o mejora el bloque AND NOT cuando existe ruido conocido.",
    "La autoridad contextual es: Subject OS (Brand OS o Theme OS), Study OS y fuentes RAG gobernadas.",
    "La evidencia posterior a importación solo permite corregir el query pack evaluado; no reemplaza esos OS.",
    "",
    BOOLEAN_LISTENING_QUERY_RULES,
    "",
    `CONTRATO: mode=${constructionPlan.mode}; scope=${scope}; entity=${input.entityLabel ?? "n/a"}`,
    `ANCHORS GOBERNADOS: ${JSON.stringify(scopeAnchors)}`,
    `RUIDO GOBERNADO: ${JSON.stringify(constructionPlan.noise_terms)}`,
    `THEME POST-INGEST/DETECTION: ${JSON.stringify(constructionPlan.theme_terms)}`,
    `PACKS RELACIONADOS: ${input.relatedPacks.map((pack) => `${pack.signal_intent}: ${pack.objective ?? "n/a"}`).join(" | ")}`,
    `QUERY ACTUAL: ${input.currentQuery}`,
    `AJUSTES OBSERVADOS: ${input.proposedAdjustments.join(" | ") || "n/a"}`,
    `SCORES SOBRE EVIDENCIA IMPORTADA: calidad=${input.evaluation.quality_score}; densidad=${input.evaluation.density_score}; ruido=${input.evaluation.noise_score}`,
    `NOTAS: ${input.evaluation.notes || "n/a"}`,
    `COMENTARIO DEL ANALISTA: ${input.userComments ?? "n/a"}`,
    `SUBJECT OS: ${input.corpus.subject.type === "brand" ? "brand_os" : "theme_os"}`,
    `SUJETO: ${JSON.stringify(input.corpus.subject)}`,
    `PREGUNTA DE NEGOCIO: ${input.corpus.corpus.businessQuestion ?? "n/a"}`,
    `STUDY OS / CONTEXTO ESTRUCTURADO: ${promptJson(input.corpus.corpus.contextForm, 6_000)}`,
    `AUDIENCIA: ${input.corpus.corpus.audienceSegment ?? "n/a"}`,
    `MERCADOS: ${input.corpus.corpus.geoFocus.join(", ") || "n/a"}`,
    `COMPETIDORES CANÓNICOS: ${input.corpus.competitors.slice(0, 20).join(", ") || "n/a"}`,
    `QUERY STRATEGY BRIEF: ${promptJson(input.corpus.queryStrategyBrief ?? null, 8_000)}`,
    `FUENTES RAG: ${promptJson(input.corpus.knowledgeSources.slice(0, 16), 12_000)}`,
    `HISTORIAL RECIENTE: ${JSON.stringify(input.evaluationHistory.slice(-3))}`
  ].join("\n");

  let validationFeedback = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await generateObject({
      model: anthropic(input.model),
      schema: refinedQuerySchema,
      prompt: [basePrompt, validationFeedback].filter(Boolean).join("\n\n"),
      temperature: 0,
      maxRetries: 2
    });
    const validation = validateConstructedQuery({
      query: result.object.query,
      scope,
      input: constructionInput,
      plan: constructionPlan,
      ...(competitorEntity ? { competitorEntity } : {}),
      allowLegacyCompetitorUnion: input.identity === "competitors:legacy-peer-set"
    });
    if (validation.valid) {
      return validation.structural.normalized_query;
    }
    validationFeedback = [
      "La respuesta anterior fue rechazada por el compilador estructural/semántico.",
      `QUERY RECHAZADA: ${result.object.query}`,
      `ERRORES ESTRUCTURALES: ${JSON.stringify(validation.structural.errors)}`,
      `ERRORES SEMÁNTICOS: ${JSON.stringify(validation.errors)}`,
      "Corrige únicamente esos errores. Conserva la identidad, el modo de recuperación y la evidencia RAG/importada."
    ].join("\n");
  }

  throw new Error(`The ${input.identity} query could not satisfy the listening query contract.`);
}

async function loadSourcePacks(corpusId: string, iterationId: string) {
  const result = await pool.query<SourcePackRow>(
    `SELECT id, scope, entity_key, signal_intent, objective, query_text, query_components, evaluation
     FROM query_packs
     WHERE study_corpus_id = $1 AND query_iteration_id = $2
     ORDER BY CASE scope WHEN 'brand' THEN 1 WHEN 'competitors' THEN 2 WHEN 'category' THEN 3 ELSE 4 END`,
    [corpusId, iterationId]
  );
  if (result.rows.length === 0) throw new Error("The source iteration has no query packs.");
  return result.rows;
}

type QueryPackIdentityGroup = {
  identity: string;
  scope: QueryConstructionScope;
  entityLabel: string | null;
  packs: SourcePackRow[];
};

function groupSourcePacks(
  packs: SourcePackRow[],
  corpus: QueryComposerInput
): QueryPackIdentityGroup[] {
  const groups = new Map<string, QueryPackIdentityGroup>();
  for (const pack of packs) {
    const scope = constructionScope(pack.scope);
    const entityLabel = packEntityLabel(pack, corpus);
    const identity = queryIdentityKey(scope, entityLabel);
    const current = groups.get(identity);
    if (current) {
      current.packs.push(pack);
      continue;
    }
    groups.set(identity, { identity, scope, entityLabel, packs: [pack] });
  }
  const order: Record<QueryConstructionScope, number> = {
    brand: 1,
    competitors: 2,
    category: 3
  };
  return Array.from(groups.values()).sort((left, right) =>
    order[left.scope] - order[right.scope] || left.identity.localeCompare(right.identity)
  );
}

function sourceQueryForIdentity(input: {
  iteration: SourceIterationRow;
  queryComponents: ComposedQuery["query_components"];
  group: QueryPackIdentityGroup;
}) {
  const packQuery = input.group.packs.find((pack) => pack.query_text?.trim())?.query_text?.trim();
  if (packQuery) return packQuery;
  if (input.group.identity === "brand") return input.iteration.query_text;
  if (input.group.identity === "category") return input.iteration.industry_query_text ?? "";
  if (input.group.identity === "competitors:legacy-peer-set") {
    return input.iteration.competitor_query_text ?? "";
  }
  const competitor = firstClassCompetitorQueries({
    queryComponents: input.queryComponents,
    identityGroups: [input.group],
    iteration: input.iteration
  }).find((item) => queryIdentityKey("competitors", item.entity) === input.group.identity);
  return competitor?.query_text ?? "";
}

function firstClassCompetitorQueries(input: {
  queryComponents: ComposedQuery["query_components"];
  identityGroups: QueryPackIdentityGroup[];
  iteration: SourceIterationRow;
}) {
  const fromComponents = Array.isArray(input.queryComponents.competitor_queries)
    ? input.queryComponents.competitor_queries
        .filter((item): item is { entity: string; query_text: string } =>
          Boolean(item)
          && typeof item.entity === "string"
          && item.entity.trim().length > 0
          && typeof item.query_text === "string"
          && item.query_text.trim().length > 0
        )
    : [];
  const fromPacks = input.identityGroups.flatMap((group) => {
    if (group.scope !== "competitors" || !group.entityLabel) return [];
    const queryText = group.packs.find((pack) => pack.query_text?.trim())?.query_text?.trim();
    return queryText ? [{ entity: group.entityLabel, query_text: queryText }] : [];
  });
  const merged = new Map<string, { entity: string; query_text: string }>();
  for (const item of [...fromComponents, ...fromPacks]) {
    const key = normalizeEntityName(item.entity);
    if (!key || merged.has(key)) continue;
    merged.set(key, { entity: item.entity.trim(), query_text: item.query_text.trim() });
  }
  return Array.from(merged.values());
}

function packEntityLabel(pack: SourcePackRow, corpus: QueryComposerInput) {
  if (constructionScope(pack.scope) !== "competitors") return null;
  const componentLabel = pack.query_components?.entity_label;
  if (typeof componentLabel === "string" && componentLabel.trim()) return componentLabel.trim();
  const componentKey = pack.query_components?.entity_key;
  const entityKey = typeof componentKey === "string" ? componentKey : pack.entity_key;
  if (!entityKey?.startsWith("competitor:")) return null;
  return corpus.competitorEntities?.find((entity) =>
    queryIdentityKey("competitors", entity.name) === entityKey
  )?.name ?? null;
}

function queryIdentityKey(scope: QueryConstructionScope | string, entityLabel?: string | null) {
  const normalizedScope = constructionScope(scope);
  if (normalizedScope === "brand") return "brand";
  if (normalizedScope === "category") return "category";
  return entityLabel ? `competitor:${entitySlug(entityLabel)}` : "competitors:legacy-peer-set";
}

function constructionScope(scope: string): QueryConstructionScope {
  if (scope === "competitors") return "competitors";
  if (scope === "category" || scope === "baseline") return "category";
  return "brand";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeQuery(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeEntityName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function entitySlug(value: string) {
  return normalizeEntityName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function promptJson(value: unknown, maxLength: number) {
  const rendered = JSON.stringify(value ?? null);
  if (rendered.length <= maxLength) return rendered;
  return `${rendered.slice(0, maxLength)}...[truncated]`;
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
  const competitorEntities = mergeCompetitorEntities(
    competitorRows.rows.map((competitor) => ({
      name: competitor.canonical_name,
      aliases: competitor.aliases ?? []
    })),
    corpusEntitySeeds.competitorEntities
  );
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
    competitors: flattenCompetitorEntities(competitorEntities),
    competitorEntities,
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
