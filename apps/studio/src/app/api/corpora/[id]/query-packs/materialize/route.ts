import {
  buildLensQueryPacks,
  type ComposedQuery,
  type QueryComposerInput
} from "@noisia/query-engine";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { getCorpusForUser } from "@/lib/data/corpora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CorpusQueryPackRow = {
  corpus_id: string;
  corpus_name: string | null;
  business_question: string | null;
  decision_to_inform: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  analysis_plan: unknown;
  brand_id: string | null;
  theme_id: string | null;
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
  query_iteration_id: string;
  query_text: string;
  competitor_query_text: string | null;
  industry_query_text: string | null;
  query_components: unknown;
};

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const row = await loadCorpusLatestIteration(corpus.id);
  if (!row) {
    return Response.json(
      { error: "missing_query_iteration", message: "Generate queries before materializing query packs." },
      { status: 409 }
    );
  }

  const input = await buildInput(row);
  const composed: ComposedQuery = {
    query_text: row.query_text,
    competitor_query_text: row.competitor_query_text ?? undefined,
    industry_query_text: row.industry_query_text ?? undefined,
    query_components: normalizeQueryComponents(row.query_components, input)
  };
  const packs = buildLensQueryPacks({
    input,
    composed,
    analysisPlan: row.analysis_plan
  });

  for (const pack of packs) {
    await pool.query(
      `
        INSERT INTO query_packs (
          study_corpus_id,
          query_iteration_id,
          lens_slug,
          signal_intent,
          scope,
          objective,
          query_text,
          query_components,
          seeds,
          evaluation,
          status,
          cost_budget,
          created_by_user_id
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9::jsonb,
          $10::jsonb,
          $11,
          $12::jsonb,
          $13::uuid
        )
        ON CONFLICT (
          study_corpus_id,
          (COALESCE(query_iteration_id::text, '')),
          lens_slug,
          signal_intent,
          scope
        )
        DO UPDATE SET
          objective = EXCLUDED.objective,
          query_text = EXCLUDED.query_text,
          query_components = EXCLUDED.query_components,
          seeds = EXCLUDED.seeds,
          evaluation = query_packs.evaluation || EXCLUDED.evaluation,
          status = CASE
            WHEN query_packs.status IN ('imported', 'approved') THEN query_packs.status
            ELSE EXCLUDED.status
          END,
          cost_budget = EXCLUDED.cost_budget,
          updated_at = now()
      `,
      [
        row.corpus_id,
        row.query_iteration_id,
        pack.lensSlug,
        pack.signalIntent,
        pack.scope,
        pack.objective,
        pack.queryText,
        JSON.stringify(pack.queryComponents),
        JSON.stringify(pack.seeds),
        JSON.stringify(pack.evaluation),
        pack.status,
        JSON.stringify(pack.costBudget),
        session.appUser.id
      ]
    );
  }

  return Response.json(
    {
      ok: true,
      query_iteration_id: row.query_iteration_id,
      planned_query_packs: packs.length,
      lenses: Array.from(new Set(packs.map((pack) => pack.lensSlug))).sort()
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function loadCorpusLatestIteration(corpusId: string) {
  const result = await pool.query<CorpusQueryPackRow>(
    `
      SELECT
        sc.id::text AS corpus_id,
        sc.name AS corpus_name,
        sc.business_question,
        sc.decision_to_inform,
        sc.audience_segment,
        sc.geo_focus,
        sc.target_window_months,
        sc.context_form,
        sc.analysis_plan,
        sc.brand_id::text,
        sc.theme_id::text,
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
        b.brand_seed_handles,
        b.description AS brand_description,
        t.slug AS theme_slug,
        t.name AS theme_name,
        t.description AS theme_description,
        t.industry_focus AS theme_industry_focus,
        t.geo_focus AS theme_geo_focus,
        qi.id::text AS query_iteration_id,
        qi.query_text,
        qi.competitor_query_text,
        qi.industry_query_text,
        qi.query_components
      FROM study_corpora sc
      JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      JOIN LATERAL (
        SELECT *
        FROM query_iterations qi
        WHERE qi.study_corpus_id = sc.id
        ORDER BY qi.created_at DESC
        LIMIT 1
      ) qi ON true
      WHERE sc.id = $1::uuid
      LIMIT 1
    `,
    [corpusId]
  );
  return result.rows[0] ?? null;
}

async function buildInput(row: CorpusQueryPackRow): Promise<QueryComposerInput> {
  const competitors = row.brand_id ? await loadCompetitorNames(row.brand_id) : [];
  const subjectName = row.brand_display_name ?? row.brand_name ?? row.theme_name ?? row.corpus_name ?? "Corpus";
  const subjectSlug = row.brand_slug ?? row.theme_slug ?? slugify(subjectName);
  const themeIndustry = row.theme_industry_focus?.[0] ?? null;
  const subjectType = row.brand_id ? "brand" : "theme";
  return {
    corpus: {
      id: row.corpus_id,
      name: row.corpus_name,
      businessQuestion: row.business_question,
      decisionToInform: row.decision_to_inform,
      audienceSegment: row.audience_segment,
      geoFocus: arrayOfStrings(row.geo_focus),
      targetWindowMonths: row.target_window_months,
      contextForm: row.context_form
    },
    subject: {
      type: subjectType,
      name: subjectName,
      slug: subjectSlug,
      industry: row.brand_industry ?? themeIndustry,
      industrySub: row.brand_industry_sub,
      countries: arrayOfStrings(row.brand_countries ?? row.theme_geo_focus ?? row.geo_focus),
      brandSeedHandles: arrayOfStrings(row.brand_seed_handles),
      description: row.brand_description ?? row.theme_description
    },
    methodology: {
      slug: row.methodology_slug,
      name: row.methodology_name,
      version: row.methodology_version,
      manifest: row.manifest ?? {}
    },
    competitors,
    brandSeeds: unique([
      subjectName,
      row.brand_name ?? "",
      row.brand_display_name ?? "",
      row.brand_slug ?? "",
      ...arrayOfStrings(row.brand_seed_handles)
    ]),
    knowledgeSources: [],
    memoryIndustry: [],
    memoryBrand: []
  };
}

async function loadCompetitorNames(brandId: string) {
  const result = await pool.query<{ canonical_name: string }>(
    `
      SELECT bs.canonical_name
      FROM competitors c
      JOIN brand_seeds bs ON bs.id = c.competitor_brand_seed_id
      WHERE c.brand_id = $1::uuid
      ORDER BY c.priority ASC NULLS LAST, bs.canonical_name ASC
      LIMIT 50
    `,
    [brandId]
  );
  return result.rows.map((row) => row.canonical_name).filter(Boolean);
}

function normalizeQueryComponents(value: unknown, input: QueryComposerInput): ComposedQuery["query_components"] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    brand_seeds: arrayOfStrings(record.brand_seeds).length > 0 ? arrayOfStrings(record.brand_seeds) : input.brandSeeds,
    competitor_seeds: arrayOfStrings(record.competitor_seeds).length > 0 ? arrayOfStrings(record.competitor_seeds) : input.competitors,
    category_seeds: arrayOfStrings(record.category_seeds),
    trigger_phrases_tb: arrayOfStrings(record.trigger_phrases_tb),
    barrier_phrases_tb: arrayOfStrings(record.barrier_phrases_tb),
    knowledge_query_language: arrayOfStrings(record.knowledge_query_language),
    knowledge_potential_triggers: arrayOfStrings(record.knowledge_potential_triggers),
    knowledge_potential_barriers: arrayOfStrings(record.knowledge_potential_barriers),
    global_exclusions: arrayOfStrings(record.global_exclusions),
    knowledge_sources: [],
    query_strategy_brief: null,
    memory_industry: [],
    memory_brand: []
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
