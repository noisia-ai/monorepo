import { z } from "zod";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { isUndefinedTableError } from "@/lib/db/errors";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { shouldReuseEngineAnalysis } from "@/lib/engine/launch-guards";
import { selectedEngineRuntimeLenses } from "@/lib/engine/selected-lenses";
import { validateEngineQueryPackCoverage } from "@/lib/engine/query-pack-validation";
import {
  applyComposerEditorialCut,
  buildComposerModules,
  buildComposerDraft,
  buildComposerEditorialDraft,
  dedupeComposerSignals,
  filterComposerSignals,
  isComposerOpportunity,
  isComposerRisk,
  normalizeComposerRow,
  reusableComposerEngineAnalysisSql,
  type ComposerRow
} from "@/lib/live-intelligence/composer";
import { normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const composerSaveSchema = z.object({
  dateFrom: z.string().max(20).nullable().optional(),
  dateTo: z.string().max(20).nullable().optional(),
  selection: z.object({
    methodologies: z.array(z.string()).max(40).optional(),
    signalTypes: z.array(z.string()).max(40).optional(),
    statuses: z.array(z.string()).max(40).optional(),
    modules: z.array(z.string()).max(40).optional(),
    chartKeys: z.array(z.string()).max(240).optional(),
    canonicalSignalIds: z.array(z.string()).max(160).optional(),
    opportunitySignalIds: z.array(z.string()).max(80).optional(),
    riskSignalIds: z.array(z.string()).max(80).optional()
  }).default({}),
  draft: z.record(z.unknown()).default({}),
  notes: z.string().max(2000).nullable().optional()
});

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const params: unknown[] = [];
  const scopeClauses: string[] = [];
  const observationClauses: string[] = ["1 = 1"];
  const scopedCorpusIds = Array.from(new Set([output.studyCorpusId, output.baseCorpusId].flatMap((id) => id ? [id] : [])));
  if (output.brandId) {
    params.push(output.brandId);
    scopeClauses.push(`cs.brand_id = $${params.length}`);
  }
  if (output.themeId) {
    params.push(output.themeId);
    scopeClauses.push(`cs.theme_id = $${params.length}`);
  }
  params.push(scopedCorpusIds);
  scopeClauses.push(`COALESCE(lo.study_corpus_id, cs.study_corpus_id) = ANY($${params.length}::uuid[])`);

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("dateFrom") ?? "";
  const dateTo = url.searchParams.get("dateTo") ?? "";
  if (dateFrom) {
    params.push(dateFrom);
    observationClauses.push(`COALESCE(so.window_end, so.window_start) >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    observationClauses.push(`COALESCE(so.window_start, so.window_end) <= $${params.length}::date`);
  }

  let result;
  try {
    result = await pool.query<ComposerRow>(
      `
        WITH latest_observation AS (
          SELECT DISTINCT ON (so.canonical_signal_id)
            so.*
          FROM signal_observations so
          LEFT JOIN published_outputs po ON po.id = so.published_output_id
          WHERE ${observationClauses.join(" AND ")}
            AND (
              so.engine_analysis_id IS NULL
              OR EXISTS (
              SELECT 1
              FROM engine_analyses live_ea
              WHERE live_ea.id = so.engine_analysis_id
                AND ${reusableComposerEngineAnalysisSql("live_ea")}
            )
          )
            AND (
              so.published_output_id IS NULL
              OR (po.status = 'published' AND po.archived_at IS NULL)
            )
          ORDER BY so.canonical_signal_id, so.window_end DESC NULLS LAST, so.created_at DESC
        ),
        evidence_counts AS (
          SELECT signal_observation_id, COUNT(*)::int AS evidence_count
          FROM signal_observation_evidence
          GROUP BY signal_observation_id
        )
        SELECT
          cs.id::text AS canonical_signal_id,
          cs.methodology_slug,
          cs.signal_type,
          cs.semantic_key,
          cs.canonical_title,
          cs.status AS signal_status,
          cs.dimensions,
          lo.id::text AS observation_id,
          lo.frequency,
          lo.share_pct::text,
          lo.intensity::text,
          lo.sentiment::text,
          lo.composite_score::text,
          lo.confidence,
          lo.delta_vs_previous::text,
          COALESCE(ec.evidence_count, 0)::int AS evidence_count,
          COALESCE(ex.evidence_examples, '[]'::jsonb) AS evidence_examples
        FROM canonical_signals cs
        LEFT JOIN latest_observation lo ON lo.canonical_signal_id = cs.id
        LEFT JOIN evidence_counts ec ON ec.signal_observation_id = lo.id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'observation_id', e.signal_observation_id::text,
              'mention_id', e.mention_id::text,
              'source_id', e.source_id::text,
              'quote', COALESCE(e.quote, m.text_snippet, m.text_clean),
              'platform', COALESCE(m.resolved_platform, m.platform),
              'published_at', m.published_at::text,
              'evidence_role', e.evidence_role,
              'is_protagonist', e.is_protagonist
            )
            ORDER BY e.is_protagonist DESC, e.position ASC, e.created_at ASC
          ) AS evidence_examples
          FROM (
            SELECT *
            FROM signal_observation_evidence
            WHERE signal_observation_id = lo.id
            ORDER BY is_protagonist DESC, position ASC, created_at ASC
            LIMIT 3
          ) e
          LEFT JOIN mentions m ON m.id = e.mention_id
        ) ex ON lo.id IS NOT NULL
        WHERE (${scopeClauses.join(" OR ")})
          AND cs.status <> 'archived'
          AND lo.id IS NOT NULL
        ORDER BY COALESCE(lo.composite_score, 0) DESC, COALESCE(lo.frequency, 0) DESC
        LIMIT 160
      `,
      params
    );
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json({
      ok: false,
      unavailable: true,
      reason: "live_intelligence_schema_missing",
      scope: {
        brand_id: output.brandId,
        theme_id: output.themeId,
        study_corpus_id: output.studyCorpusId,
        base_corpus_id: output.baseCorpusId
      },
      analysis_plan: output.analysisPlan ?? null,
      available: {
        methodologies: [],
        signal_types: [],
        statuses: []
      },
      editorial: null,
      modules: [],
      opportunities: [],
      risks: []
    });
  }

  const selection = {
    methodologies: parseCsvParam(url.searchParams.get("methodologies") ?? url.searchParams.get("modules")),
    signalTypes: parseCsvParam(url.searchParams.get("signalTypes")),
    statuses: parseCsvParam(url.searchParams.get("statuses"))
  };
  const rows = filterComposerSignals(result.rows.map(normalizeComposerRow), selection);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows
    .filter((row) => isComposerOpportunity(row))
    .slice(0, 10);
  const risks = dedupedRows
    .filter((row) => isComposerRisk(row))
    .slice(0, 10);
  const lensStatuses = await loadComposerLensStatuses({
    analysisPlan: output.analysisPlan ?? null,
    brandId: output.brandId,
    themeId: output.themeId,
    studyCorpusId: output.studyCorpusId,
    baseCorpusId: output.baseCorpusId,
    activeRows: result.rows
  });
  const draft = buildComposerDraft({ rows, dedupedRows, modules, opportunities, risks, selection, lensStatuses });
  const editorial = await loadComposerEditorial(output.id);
  const visible = applyComposerEditorialCut({
    modules,
    opportunities,
    risks,
    draft,
    editorial
  });

  return Response.json(
    {
      ok: true,
      scope: {
        brand_id: output.brandId,
        theme_id: output.themeId,
        study_corpus_id: output.studyCorpusId,
        base_corpus_id: output.baseCorpusId
      },
      analysis_plan: output.analysisPlan ?? null,
      selection,
      available: {
        methodologies: Array.from(new Set(result.rows.map((row) => row.methodology_slug))).sort(),
        signal_types: Array.from(new Set(result.rows.map((row) => row.signal_type))).sort(),
        statuses: Array.from(new Set(result.rows.map((row) => row.signal_status))).sort()
      },
      modules: visible.modules,
      opportunities: visible.opportunities,
      risks: visible.risks,
      draft: visible.draft,
      editorial,
      editorial_applied: visible.applied,
      lens_statuses: lensStatuses,
      candidates: {
        modules,
        opportunities,
        risks,
        draft
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const parsed = composerSaveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const selection = normalizeSavedSelection(parsed.data.selection);
  const candidates = await loadComposerCandidateState({
    output,
    selection,
    dateFrom: parsed.data.dateFrom ?? "",
    dateTo: parsed.data.dateTo ?? ""
  });
  const draft = buildComposerEditorialDraft({
    baseDraft: candidates.draft,
    modules: candidates.modules,
    opportunities: candidates.opportunities,
    risks: candidates.risks,
    selectedModuleSlugs: selection.modules,
    selectedCanonicalSignalIds: selection.canonicalSignalIds,
    selection,
    lensStatuses: candidates.lensStatuses
  });
  const savedSelection = {
    ...selection,
    modules: draft.module_slugs,
    chartKeys: draft.selected_chart_keys,
    canonicalSignalIds: draft.selected_canonical_signal_ids,
    opportunitySignalIds: draft.opportunity_signal_ids,
    riskSignalIds: draft.risk_signal_ids
  };
  const notes = parsed.data.notes?.trim() || null;

  const result = await pool.query<{ id: string; updated_at: string }>(
    `
      INSERT INTO signal_composer_edits (
        output_id, study_corpus_id, status, selection, draft,
        notes, created_by_user_id, updated_by_user_id
      )
      VALUES ($1, $2, 'draft', $3::jsonb, $4::jsonb, $5, $6, $6)
      ON CONFLICT (output_id)
      DO UPDATE SET
        study_corpus_id = EXCLUDED.study_corpus_id,
        status = 'draft',
        selection = EXCLUDED.selection,
        draft = EXCLUDED.draft,
        notes = EXCLUDED.notes,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = NOW()
      RETURNING id::text, updated_at::text
    `,
    [
      output.id,
      output.studyCorpusId,
      JSON.stringify(savedSelection),
      JSON.stringify(draft),
      notes,
      session.appUser.id
    ]
  );

  return Response.json(
    {
      ok: true,
      editorial: {
        id: result.rows[0]?.id ?? null,
        status: "draft",
        selection: savedSelection,
        draft,
        notes,
        updated_at: result.rows[0]?.updated_at ?? new Date().toISOString()
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function loadComposerCandidateState(args: {
  output: NonNullable<Awaited<ReturnType<typeof getSignalOutputForUser>>>;
  selection: ReturnType<typeof normalizeSavedSelection>;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const params: unknown[] = [];
  const scopeClauses: string[] = [];
  const observationClauses: string[] = ["1 = 1"];
  const scopedCorpusIds = Array.from(new Set([args.output.studyCorpusId, args.output.baseCorpusId].flatMap((id) => id ? [id] : [])));
  if (args.output.brandId) {
    params.push(args.output.brandId);
    scopeClauses.push(`cs.brand_id = $${params.length}`);
  }
  if (args.output.themeId) {
    params.push(args.output.themeId);
    scopeClauses.push(`cs.theme_id = $${params.length}`);
  }
  params.push(scopedCorpusIds);
  scopeClauses.push(`COALESCE(lo.study_corpus_id, cs.study_corpus_id) = ANY($${params.length}::uuid[])`);

  const dateFrom = String(args.dateFrom ?? "").trim();
  const dateTo = String(args.dateTo ?? "").trim();
  if (dateFrom) {
    params.push(dateFrom);
    observationClauses.push(`COALESCE(so.window_end, so.window_start) >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    observationClauses.push(`COALESCE(so.window_start, so.window_end) <= $${params.length}::date`);
  }

  const result = await pool.query<ComposerRow>(
    `
      WITH latest_observation AS (
        SELECT DISTINCT ON (so.canonical_signal_id)
          so.*
        FROM signal_observations so
        LEFT JOIN published_outputs po ON po.id = so.published_output_id
        WHERE ${observationClauses.join(" AND ")}
          AND (
            so.engine_analysis_id IS NULL
            OR EXISTS (
              SELECT 1
            FROM engine_analyses live_ea
            WHERE live_ea.id = so.engine_analysis_id
              AND ${reusableComposerEngineAnalysisSql("live_ea")}
            )
          )
          AND (
            so.published_output_id IS NULL
            OR (po.status = 'published' AND po.archived_at IS NULL)
          )
        ORDER BY so.canonical_signal_id, so.window_end DESC NULLS LAST, so.created_at DESC
      ),
      evidence_counts AS (
        SELECT signal_observation_id, COUNT(*)::int AS evidence_count
        FROM signal_observation_evidence
        GROUP BY signal_observation_id
      )
      SELECT
        cs.id::text AS canonical_signal_id,
        cs.methodology_slug,
        cs.signal_type,
        cs.semantic_key,
        cs.canonical_title,
        cs.status AS signal_status,
        cs.dimensions,
        lo.id::text AS observation_id,
        lo.frequency,
        lo.share_pct::text,
        lo.intensity::text,
        lo.sentiment::text,
        lo.composite_score::text,
        lo.confidence,
        lo.delta_vs_previous::text,
        COALESCE(ec.evidence_count, 0)::int AS evidence_count,
        COALESCE(ex.evidence_examples, '[]'::jsonb) AS evidence_examples
      FROM canonical_signals cs
      LEFT JOIN latest_observation lo ON lo.canonical_signal_id = cs.id
      LEFT JOIN evidence_counts ec ON ec.signal_observation_id = lo.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'observation_id', e.signal_observation_id::text,
            'mention_id', e.mention_id::text,
            'source_id', e.source_id::text,
            'quote', COALESCE(e.quote, m.text_snippet, m.text_clean),
            'platform', COALESCE(m.resolved_platform, m.platform),
            'published_at', m.published_at::text,
            'evidence_role', e.evidence_role,
            'is_protagonist', e.is_protagonist
          )
          ORDER BY e.is_protagonist DESC, e.position ASC, e.created_at ASC
        ) AS evidence_examples
        FROM (
          SELECT *
          FROM signal_observation_evidence
          WHERE signal_observation_id = lo.id
          ORDER BY is_protagonist DESC, position ASC, created_at ASC
          LIMIT 3
        ) e
        LEFT JOIN mentions m ON m.id = e.mention_id
      ) ex ON lo.id IS NOT NULL
      WHERE (${scopeClauses.join(" OR ")})
        AND cs.status <> 'archived'
        AND lo.id IS NOT NULL
      ORDER BY COALESCE(lo.composite_score, 0) DESC, COALESCE(lo.frequency, 0) DESC
      LIMIT 160
    `,
    params
  );

  const rows = filterComposerSignals(result.rows.map(normalizeComposerRow), args.selection);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows
    .filter((row) => isComposerOpportunity(row))
    .slice(0, 10);
  const risks = dedupedRows
    .filter((row) => isComposerRisk(row))
    .slice(0, 10);
  const lensStatuses = await loadComposerLensStatuses({
    analysisPlan: args.output.analysisPlan ?? null,
    brandId: args.output.brandId,
    themeId: args.output.themeId,
    studyCorpusId: args.output.studyCorpusId,
    baseCorpusId: args.output.baseCorpusId,
    activeRows: result.rows
  });
  const draft = buildComposerDraft({
    rows,
    dedupedRows,
    modules,
    opportunities,
    risks,
    selection: args.selection,
    lensStatuses
  });

  return { rows, dedupedRows, modules, opportunities, risks, draft, lensStatuses };
}

function parseCsvParam(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

async function loadComposerEditorial(outputId: string) {
  try {
    const result = await pool.query<{
      id: string;
      status: string;
      selection: Record<string, unknown>;
      draft: Record<string, unknown>;
      notes: string | null;
      updated_at: string;
    }>(
      `
        SELECT
          id::text,
          status,
          selection,
          draft,
          notes,
          updated_at::text
        FROM signal_composer_edits
        WHERE output_id = $1
        LIMIT 1
      `,
      [outputId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

function normalizeSavedSelection(selection: {
  methodologies?: string[];
  signalTypes?: string[];
  statuses?: string[];
  modules?: string[];
  chartKeys?: string[];
  canonicalSignalIds?: string[];
  opportunitySignalIds?: string[];
  riskSignalIds?: string[];
}) {
  return {
    methodologies: normalizeStringList(selection.methodologies, 40),
    signalTypes: normalizeStringList(selection.signalTypes, 40),
    statuses: normalizeStringList(selection.statuses, 40),
    modules: normalizeStringList(selection.modules, 40),
    chartKeys: normalizeStringList(selection.chartKeys, 240),
    canonicalSignalIds: normalizeStringList(selection.canonicalSignalIds, 160),
    opportunitySignalIds: normalizeStringList(selection.opportunitySignalIds, 80),
    riskSignalIds: normalizeStringList(selection.riskSignalIds, 80)
  };
}

function normalizeStringList(value: string[] | undefined, maxItems: number) {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).slice(0, maxItems);
}

type ComposerLensStatus = {
  methodology_slug: string;
  status: "active" | "ready" | "queued" | "running" | "needs_review" | "approved" | "failed" | "blocked" | "no_signals" | "not_started";
  engine_analysis_id: string | null;
  current_step: string | null;
  signals_in_range: number;
  evidence_in_range: number;
  message: string | null;
  readiness: ComposerLensReadiness | null;
  quality_gates_failed: Array<{ id: string; detail: string }>;
};

type ComposerLensReadiness = {
  status: "ready" | "directional" | "blocked";
  hard_failures: string[];
  warnings: string[];
  summary: ReturnType<typeof validateEngineQueryPackCoverage>["summary"];
};

async function loadComposerLensStatuses(args: {
  analysisPlan: unknown;
  brandId: string | null;
  themeId: string | null;
  studyCorpusId: string | null;
  baseCorpusId: string | null;
  activeRows: ComposerRow[];
}): Promise<ComposerLensStatus[]> {
  const plan = normalizeStudyAnalysisPlan(args.analysisPlan);
  const selectedLenses = plan.selected_lenses;
  if (selectedLenses.length === 0 || !args.studyCorpusId) return [];

  const activeByLens = new Map<string, { signals: number; evidence: number }>();
  for (const row of args.activeRows) {
    const current = activeByLens.get(row.methodology_slug) ?? { signals: 0, evidence: 0 };
    current.signals += 1;
    current.evidence += Math.max(0, Number(row.evidence_count ?? 0));
    activeByLens.set(row.methodology_slug, current);
  }

  const engineLenses = selectedEngineRuntimeLenses(args.analysisPlan);
  const engineSet = new Set<string>(engineLenses);
  const latestEngine = await loadLatestEngineAnalyses(args.studyCorpusId, engineLenses);
  const coverage = await loadComposerCoverageInput(args.studyCorpusId, args.brandId, args.themeId, args.baseCorpusId);

  return selectedLenses.map((slug) => {
    const active = activeByLens.get(slug) ?? { signals: 0, evidence: 0 };
    const engine = latestEngine.get(slug);
    const validation = coverage ? validateEngineQueryPackCoverage(slug, coverage) : null;
    const readiness = composerReadinessFromValidation(validation);
    const failedGates = engine?.quality_gates_failed ?? [];
    if (active.signals > 0) {
      return {
        methodology_slug: slug,
        status: "active",
        engine_analysis_id: engine?.id ?? null,
        current_step: engine?.current_step ?? null,
        signals_in_range: active.signals,
        evidence_in_range: active.evidence,
        message: [
          `${active.signals} señales vivas en el rango activo.`,
          failedGates.length > 0 ? `${failedGates.length} quality gates requieren review.` : null
        ].filter(Boolean).join(" "),
        readiness,
        quality_gates_failed: failedGates
      } satisfies ComposerLensStatus;
    }

    if (!engineSet.has(slug)) {
      return {
        methodology_slug: slug,
        status: "no_signals",
        engine_analysis_id: null,
        current_step: null,
        signals_in_range: 0,
        evidence_in_range: 0,
        message: "No hay señales publicables de este lente en el rango activo.",
        readiness,
        quality_gates_failed: []
      } satisfies ComposerLensStatus;
    }

    if (!engine) {
      if (validation && !validation.ok) {
        return {
          methodology_slug: slug,
          status: "blocked",
          engine_analysis_id: null,
          current_step: null,
          signals_in_range: 0,
          evidence_in_range: 0,
          message: validation.hardFailures[0] ?? "El lente no tiene coverage/imports suficientes para correr.",
          readiness,
          quality_gates_failed: []
        } satisfies ComposerLensStatus;
      }
      return {
        methodology_slug: slug,
        status: validation?.ok ? "ready" : "not_started",
        engine_analysis_id: null,
        current_step: null,
        signals_in_range: 0,
        evidence_in_range: 0,
        message: validation?.warnings[0] ?? "Listo para correr cuando el admin lance los lentes seleccionados.",
        readiness,
        quality_gates_failed: []
      } satisfies ComposerLensStatus;
    }

    if (!shouldReuseEngineAnalysis({
      status: engine.status,
      retrievedUnits: engine.retrieved_units,
      codingProvider: engine.coding_provider,
      codingFixture: engine.coding_fixture
    })) {
      return {
        methodology_slug: slug,
        status: validation && !validation.ok ? "blocked" : "ready",
        engine_analysis_id: engine.id,
        current_step: null,
        signals_in_range: 0,
        evidence_in_range: 0,
        message: engine.status === "needs_review" || engine.status === "approved"
          ? "La última corrida de este lente no tiene retrieval + Claude real completos; vuelve a correrla antes de confiar o publicar."
          : engine.failure_reason ?? validation?.warnings[0] ?? "Listo para reintentar.",
        readiness,
        quality_gates_failed: failedGates
      } satisfies ComposerLensStatus;
    }

    const normalizedStatus = normalizeComposerLensStatus(engine.status);
    return {
      methodology_slug: slug,
      status: normalizedStatus === "approved" ? "no_signals" : normalizedStatus,
      engine_analysis_id: engine.id,
      current_step: engine.current_step,
      signals_in_range: 0,
      evidence_in_range: 0,
      message: engine.failure_reason
        ?? (failedGates.length > 0 ? `${failedGates.length} quality gates requieren review.` : null)
        ?? validation?.warnings[0]
        ?? (normalizedStatus === "approved"
          ? "El lente terminó, pero no produjo señales vivas para este rango."
          : null),
      readiness,
      quality_gates_failed: failedGates
    } satisfies ComposerLensStatus;
  });
}

async function loadLatestEngineAnalyses(studyCorpusId: string, slugs: string[]) {
  const latest = new Map<string, {
    id: string;
    methodology_slug: string;
    status: string;
    current_step: string | null;
    failure_reason: string | null;
    retrieved_units: number | null;
    coding_provider: string | null;
    coding_fixture: boolean | null;
    quality_gates_failed: Array<{ id: string; detail: string }>;
  }>();
  if (slugs.length === 0) return latest;
  try {
    const result = await pool.query<{
      id: string;
      methodology_slug: string;
      status: string;
      current_step: string | null;
      failure_reason: string | null;
      retrieved_units: number | null;
      coding_provider: string | null;
      coding_fixture: boolean | null;
      meta_json: unknown;
    }>(
      `
        SELECT DISTINCT ON (methodology_slug)
          id::text,
          methodology_slug,
          status,
          current_step,
          failure_reason,
          CASE
            WHEN COALESCE(meta_json->'retrieval'->>'retrieved_units', '') ~ '^[0-9]+$'
            THEN (meta_json->'retrieval'->>'retrieved_units')::int
            ELSE 0
          END AS retrieved_units,
          meta_json->'engine_coding'->>'provider' AS coding_provider,
          CASE
            WHEN meta_json->'engine_coding' ? 'fixture'
            THEN (meta_json->'engine_coding'->>'fixture')::boolean
            ELSE NULL
          END AS coding_fixture,
          meta_json
        FROM engine_analyses
        WHERE study_corpus_id = $1
          AND methodology_slug = ANY($2::text[])
        ORDER BY methodology_slug, created_at DESC
      `,
      [studyCorpusId, slugs]
    );
    for (const row of result.rows) {
      latest.set(row.methodology_slug, {
        id: row.id,
        methodology_slug: row.methodology_slug,
        status: row.status,
        current_step: row.current_step,
        failure_reason: row.failure_reason,
        retrieved_units: row.retrieved_units,
        coding_provider: row.coding_provider,
        coding_fixture: row.coding_fixture,
        quality_gates_failed: failedQualityGates(row.meta_json)
      });
    }
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  return latest;
}

async function loadComposerCoverageInput(
  studyCorpusId: string,
  brandId: string | null,
  themeId: string | null,
  baseCorpusId: string | null
) {
  try {
    const [entities, batches, packs] = await Promise.all([
      pool.query<{
        id: string;
        name: string | null;
        entity_kind: string | null;
        is_category_baseline: boolean | null;
        included_count: number | null;
      }>(
        `
          SELECT
            ce.id::text,
            ce.name,
            ce.entity_kind,
            ce.is_category_baseline,
            COALESCE(SUM(CASE WHEN ib.status = 'completed' THEN ib.included_count ELSE 0 END), 0)::int AS included_count
          FROM corpus_entities ce
          LEFT JOIN import_batches ib ON ib.corpus_entity_id = ce.id
          WHERE ce.study_corpus_id = $1
            AND ce.status <> 'archived'
          GROUP BY ce.id, ce.name, ce.entity_kind, ce.is_category_baseline
        `,
        [studyCorpusId]
      ),
      pool.query<{
        query_pack_id: string | null;
        corpus_entity_id: string | null;
        entity_kind: string | null;
        entity_label: string | null;
        mention_type: string | null;
        included_count: number | null;
        status: string | null;
      }>(
        `
          SELECT
            query_pack_id::text,
            corpus_entity_id::text,
            entity_kind,
            entity_label,
            mention_type,
            included_count,
            status
          FROM import_batches
          WHERE study_corpus_id = $1
        `,
        [studyCorpusId]
      ),
      pool.query<{
        id: string;
        lens_slug: string | null;
        signal_intent: string | null;
        scope: string | null;
        status: string | null;
        mentions_returned: number | null;
        linked_mention_count: number | null;
        direct_mention_count: number | null;
        shared_mention_count: number | null;
      }>(
        `
          SELECT
            qp.id::text,
            qp.lens_slug,
            qp.signal_intent,
            qp.scope,
            qp.status,
            qp.mentions_returned,
            COUNT(DISTINCT mqs.mention_id) FILTER (WHERE mn.inclusion_status = 'included')::int AS linked_mention_count,
            COUNT(DISTINCT mqs.mention_id) FILTER (WHERE mqs.match_reason = 'csv_import_batch' AND mn.inclusion_status = 'included')::int AS direct_mention_count,
            COUNT(DISTINCT mqs.mention_id) FILTER (WHERE COALESCE(mqs.match_reason, '') <> 'csv_import_batch' AND mn.inclusion_status = 'included')::int AS shared_mention_count
          FROM query_packs qp
          LEFT JOIN mention_query_sources mqs ON mqs.query_pack_id = qp.id
          LEFT JOIN mentions mn ON mn.id = mqs.mention_id
          WHERE qp.study_corpus_id = $1
          GROUP BY qp.id, qp.lens_slug, qp.signal_intent, qp.scope, qp.status, qp.mentions_returned
        `,
        [studyCorpusId]
      )
    ]);

    return {
      brandId,
      themeId,
      baseCorpusId,
      entities: entities.rows.map((entity) => ({
        id: entity.id,
        name: entity.name,
        entityKind: entity.entity_kind,
        isCategoryBaseline: entity.is_category_baseline,
        includedCount: entity.included_count
      })),
      importBatches: batches.rows.map((batch) => ({
        queryPackId: batch.query_pack_id,
        corpusEntityId: batch.corpus_entity_id,
        entityKind: batch.entity_kind,
        entityLabel: batch.entity_label,
        mentionType: batch.mention_type,
        includedCount: batch.included_count,
        status: batch.status
      })),
      queryPacks: packs.rows.map((pack) => ({
        id: pack.id,
        lensSlug: pack.lens_slug,
        signalIntent: pack.signal_intent,
        scope: pack.scope,
        status: pack.status,
        mentionsReturned: pack.mentions_returned,
        linkedMentionCount: pack.linked_mention_count,
        directMentionCount: pack.direct_mention_count,
        sharedMentionCount: pack.shared_mention_count
      }))
    };
  } catch (error) {
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

function normalizeComposerLensStatus(status: string): ComposerLensStatus["status"] {
  if (status === "queued" || status === "running" || status === "needs_review" || status === "approved" || status === "failed") {
    return status;
  }
  return "running";
}

function composerReadinessFromValidation(
  validation: ReturnType<typeof validateEngineQueryPackCoverage> | null
): ComposerLensReadiness | null {
  if (!validation) return null;
  return {
    status: validation.status,
    hard_failures: validation.hardFailures,
    warnings: validation.warnings,
    summary: validation.summary
  };
}

function failedQualityGates(metaJson: unknown) {
  const meta = metaJson && typeof metaJson === "object" && !Array.isArray(metaJson)
    ? metaJson as Record<string, unknown>
    : {};
  const gates = Array.isArray(meta.quality_gates) ? meta.quality_gates : [];
  return gates
    .map((gate) => {
      const value = gate && typeof gate === "object" && !Array.isArray(gate) ? gate as Record<string, unknown> : {};
      const id = typeof value.id === "string" ? value.id : "";
      const detail = typeof value.detail === "string" ? value.detail : "";
      const passed = value.passed === true;
      return id && !passed ? { id, detail } : null;
    })
    .filter((gate): gate is { id: string; detail: string } => Boolean(gate));
}
