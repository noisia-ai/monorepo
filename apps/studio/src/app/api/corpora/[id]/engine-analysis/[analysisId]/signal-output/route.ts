import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { publishedOutputs } from "@noisia/db";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db, pool } from "@/lib/db";
import {
  loadEngineLiveIntelligenceLinks,
  summarizeEngineLiveIntelligenceLinks,
  type EnginePublishedOutputLiveIntelligence
} from "@/lib/live-intelligence/engine-observations";
import { attachLiveIntelligenceLinksToPayload } from "@/lib/live-intelligence/published-output";
import { buildEngineOutputManifestForMethodology } from "@/lib/engine/methodology-options";
import { validateEnginePublishReadiness } from "@/lib/engine/publish-guards";
import { enginePublishedOutputTypeForMethodology } from "@/lib/signal-pulse/runtime-contracts";
import { buildEngineSignalPayload, normalizeSignalManifest } from "@/lib/signal/build";
import { SIGNAL_PAYLOAD_VERSION, type CompetitiveOwnership, type TbConfidence } from "@/lib/signal/contracts";

const bodySchema = z.object({
  title: z.string().min(3).max(140),
  headline: z.string().min(3).max(220).optional().nullable(),
  summary: z.string().min(3).max(700).optional().nullable(),
  manifest: z.record(z.unknown()).optional(),
  action: z.enum(["save_draft", "publish"]).default("save_draft")
});

type EngineAnalysisRow = {
  id: string;
  study_corpus_id: string;
  methodology_slug: string;
  methodology_version: string;
  status: string;
  business_question: string | null;
  meta_json: Record<string, unknown> | null;
  limitations: unknown;
};

type EngineFindingRow = {
  id: string;
  finding_key: string;
  name: string;
  dimensions: Record<string, unknown> | null;
  frequency: number;
  intensity: string | null;
  sentiment: string | null;
  share_pct: string | null;
  composite_score: string | null;
  ownership: string | null;
  confidence: string | null;
  evidence_count: number;
  mention_ids: string[] | null;
  quote: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);

  const analysis = await loadEngineAnalysis(corpus.id, analysisId);
  if (!analysis) {
    return Response.json({ error: "not_found", message: "Engine analysis not found." }, { status: 404 });
  }

  if (analysis.status !== "needs_review" && analysis.status !== "approved") {
    return Response.json(
      {
        error: "analysis_not_reviewable",
        message: "El engine analysis debe llegar a needs_review antes de preparar Signal."
      },
      { status: 409 }
    );
  }

  if (analysis.methodology_slug === "signal-pulse") {
    return handleSignalPulseOutput({
      analysis,
      corpus,
      isPublish: parsed.data.action === "publish",
      manifest: parsed.data.manifest ?? {},
      title: parsed.data.title,
      headline: parsed.data.headline ?? null,
      summary: parsed.data.summary ?? null,
      userId: session.appUser.id
    });
  }

  const findings = await loadEngineFindings(analysis.id);
  const isPublish = parsed.data.action === "publish";
  if (isPublish) {
    if (await engineAnalysisUsedFixtureCoding(analysis.id, analysis.meta_json)) {
      return Response.json(
        {
          error: "fixture_coding_used",
          message: "Este output viene de fixture/no-cost QA y no puede publicarse como client-ready. Recorre el lente con Claude real.",
          failedChecks: [{ id: "fixture_coding", detail: "engine_cost_events.provider=fixture" }]
        },
        { status: 409 }
      );
    }
    const readiness = validateEnginePublishReadiness(analysis.meta_json);
    if (!readiness.ok) {
      return Response.json(
        {
          error: readiness.error,
          message: readiness.message,
          failedChecks: readiness.failedChecks
        },
        { status: 409 }
      );
    }
  }
  const manifest = normalizeSignalManifest({
    ...(parsed.data.manifest ?? {}),
    ...buildEngineOutputManifestForMethodology(analysis.methodology_slug)
  });
  const payload = buildEngineSignalPayload({
    corpus,
    analysis: {
      id: analysis.id,
      methodologySlug: analysis.methodology_slug,
      methodologyVersion: analysis.methodology_version,
      businessQuestion: analysis.business_question,
      metaJson: analysis.meta_json ?? {},
      limitations: analysis.limitations
    },
    findings: findings.map(normalizeEngineFinding),
    manifest,
    headline: parsed.data.headline,
    summary: parsed.data.summary
  });
  const output = await upsertEngineOutput({
    engineAnalysisId: analysis.id,
    studyCorpusId: corpus.id,
    brandId: corpus.brandId,
    themeId: corpus.themeId,
    methodologySlug: analysis.methodology_slug,
    kind: "signal",
    outputType: "narrative_dashboard",
    status: isPublish ? "published" : "draft",
    title: parsed.data.title,
    headline: parsed.data.headline ?? null,
    summary: parsed.data.summary ?? null,
    manifest,
    payload,
    userId: session.appUser.id,
    publish: isPublish
  });

  let liveIntelligence: EnginePublishedOutputLiveIntelligence | null = null;
  if (isPublish && output?.id) {
    try {
      await pool.query(
        `UPDATE signal_observations
         SET published_output_id = $1
         WHERE engine_analysis_id = $2
           AND published_output_id IS NULL`,
        [output.id, analysis.id]
      );
      liveIntelligence = summarizeEngineLiveIntelligenceLinks(
        await loadEngineLiveIntelligenceLinks(analysis.id)
      );
      if (liveIntelligence.status === "ok" && liveIntelligence.mappings.length > 0) {
        await db
          .update(publishedOutputs)
          .set({
            payload: attachLiveIntelligenceLinksToPayload(payload, liveIntelligence),
            updatedAt: new Date()
          })
          .where(eq(publishedOutputs.id, output.id));
      }
    } catch (error) {
      liveIntelligence = {
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown_engine_live_intelligence_error",
        signals: 0,
        observations: 0,
        evidence: 0,
        mappings: []
      };
    }
  }

  return Response.json({ ok: true, output, liveIntelligence });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const analysis = await loadEngineAnalysis(corpus.id, analysisId);
  if (!analysis) {
    return Response.json({ error: "not_found", message: "Engine analysis not found." }, { status: 404 });
  }
  const outputType = enginePublishedOutputTypeForMethodology(analysis.methodology_slug);

  const [output] = await db
    .select({
      id: publishedOutputs.id,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      status: publishedOutputs.status,
      manifest: publishedOutputs.manifest,
      publishedAt: publishedOutputs.publishedAt
    })
    .from(publishedOutputs)
    .where(and(eq(publishedOutputs.engineAnalysisId, analysisId), eq(publishedOutputs.outputType, outputType)))
    .limit(1);

  return Response.json({ output: output ?? null });
}

async function loadEngineAnalysis(corpusId: string, analysisId: string) {
  const result = await pool.query<EngineAnalysisRow>(
    `SELECT id,
            study_corpus_id,
            methodology_slug,
            methodology_version,
            status,
            business_question,
            meta_json,
            limitations
     FROM engine_analyses
     WHERE id = $1
       AND study_corpus_id = $2
     LIMIT 1`,
    [analysisId, corpusId]
  );
  return result.rows[0] ?? null;
}

async function loadEngineFindings(engineAnalysisId: string) {
  const result = await pool.query<EngineFindingRow>(
    `SELECT
       f.id,
       f.finding_key,
       f.name,
       f.dimensions,
       f.frequency,
       f.intensity::text,
       f.sentiment::text,
       f.share_pct::text,
       f.composite_score::text,
       f.ownership,
       f.confidence,
       COUNT(c.id)::int AS evidence_count,
       COALESCE(array_remove(array_agg(c.mention_id::text ORDER BY c.position), NULL), ARRAY[]::text[]) AS mention_ids,
       (array_remove(array_agg(m.text_clean ORDER BY c.is_protagonist DESC, c.position ASC), NULL))[1] AS quote
     FROM engine_findings f
     LEFT JOIN engine_finding_citations c ON c.finding_id = f.id
     LEFT JOIN mentions m ON m.id = c.mention_id
     WHERE f.engine_analysis_id = $1
     GROUP BY f.id
     ORDER BY f.position ASC, f.composite_score DESC NULLS LAST`,
    [engineAnalysisId]
  );
  return result.rows;
}

function normalizeEngineFinding(row: EngineFindingRow) {
  return {
    id: row.id,
    findingKey: row.finding_key,
    name: row.name,
    dimensions: row.dimensions ?? {},
    frequency: Number(row.frequency ?? 0),
    intensity: numberOrNull(row.intensity),
    sentiment: numberOrNull(row.sentiment),
    sharePct: numberOrNull(row.share_pct),
    compositeScore: numberOrNull(row.composite_score),
    ownership: coerceOwnership(row.ownership),
    confidence: coerceConfidence(row.confidence),
    evidenceCount: Number(row.evidence_count ?? 0),
    mentionIds: row.mention_ids ?? [],
    quote: row.quote
  };
}

async function upsertEngineOutput(args: {
  engineAnalysisId: string;
  studyCorpusId: string;
  brandId: string | null;
  themeId: string | null;
  methodologySlug: string;
  kind: "signal" | "signal_pulse";
  outputType: string;
  status: "draft" | "published";
  title: string;
  headline: string | null;
  summary: string | null;
  manifest: unknown;
  payload: unknown;
  userId: string;
  publish: boolean;
}) {
  const result = await pool.query<{ id: string; status: string; title: string }>(
    `INSERT INTO published_outputs (
       engine_analysis_id, study_corpus_id, brand_id, theme_id, methodology_slug,
       kind, output_type, status, title, headline, summary, manifest, payload, visibility_config, version,
       created_by_user_id, published_by_user_id, published_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14,
       $15, $16, CASE WHEN $17::boolean THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (engine_analysis_id, output_type)
       WHERE engine_analysis_id IS NOT NULL
     DO UPDATE SET
       kind = EXCLUDED.kind,
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       headline = EXCLUDED.headline,
       summary = EXCLUDED.summary,
       manifest = EXCLUDED.manifest,
       payload = EXCLUDED.payload,
       visibility_config = EXCLUDED.visibility_config,
       version = EXCLUDED.version,
       published_by_user_id = EXCLUDED.published_by_user_id,
       published_at = CASE WHEN $17::boolean THEN NOW() ELSE published_outputs.published_at END,
       archived_at = NULL,
       updated_at = NOW()
     RETURNING id, status, title`,
    [
      args.engineAnalysisId,
      args.studyCorpusId,
      args.brandId,
      args.themeId,
      args.methodologySlug,
      args.kind,
      args.outputType,
      args.status,
      args.title,
      args.headline,
      args.summary,
      JSON.stringify(args.manifest),
      JSON.stringify(args.payload),
      JSON.stringify(args.kind === "signal_pulse" ? { client_default: true, internal_quality: true } : {}),
      SIGNAL_PAYLOAD_VERSION,
      args.userId,
      args.publish ? args.userId : null,
      args.publish
    ]
  );
  return result.rows[0] ?? null;
}

async function handleSignalPulseOutput(args: {
  analysis: EngineAnalysisRow;
  corpus: NonNullable<Awaited<ReturnType<typeof getCorpusForUser>>>;
  isPublish: boolean;
  manifest: Record<string, unknown>;
  title: string;
  headline: string | null;
  summary: string | null;
  userId: string;
}) {
  const readiness = validateSignalPulsePublishReadiness(args.analysis.meta_json);
  if (args.isPublish && !readiness.ok) {
    return Response.json(
      {
        error: readiness.error,
        message: readiness.message,
        failedChecks: readiness.failedChecks
      },
      { status: 409 }
    );
  }

  const payload = await buildSignalPulsePublishedPayload(args.analysis, args.corpus);
  const manifest = normalizeSignalPulseManifest(args.manifest, readiness.checks);
  const output = await upsertEngineOutput({
    engineAnalysisId: args.analysis.id,
    studyCorpusId: args.corpus.id,
    brandId: args.corpus.brandId,
    themeId: args.corpus.themeId,
    methodologySlug: "signal-pulse",
    kind: "signal_pulse",
    outputType: "signal_pulse_dashboard",
    status: args.isPublish ? "published" : "draft",
    title: args.title,
    headline: args.headline,
    summary: args.summary,
    manifest,
    payload,
    userId: args.userId,
    publish: args.isPublish
  });

  if (output?.id) {
    await pool.query(
      `UPDATE signal_observations
       SET published_output_id = $1
       WHERE engine_analysis_id = $2
         AND published_output_id IS NULL`,
      [output.id, args.analysis.id]
    );
  }

  return Response.json({ ok: true, output, liveIntelligence: { status: "ok", kind: "signal_pulse" } });
}

async function buildSignalPulsePublishedPayload(
  analysis: EngineAnalysisRow,
  corpus: NonNullable<Awaited<ReturnType<typeof getCorpusForUser>>>
) {
  const [periods, signals, moves, charts, evidence, sources, performance, cost] = await Promise.all([
    pool.query(
      `SELECT id::text, label, period_start::text, period_end::text, coverage, comparable, confidence, known_gaps
       FROM report_periods
       WHERE study_corpus_id = $1 AND granularity = 'month'
       ORDER BY period_start`,
      [corpus.id]
    ),
    pool.query(
      `
        WITH latest AS (
          SELECT DISTINCT ON (spm.canonical_signal_id)
            spm.*
          FROM signal_period_metrics spm
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
          ORDER BY spm.canonical_signal_id, rp.period_start DESC
        )
        SELECT
          cs.id::text AS id,
          cs.canonical_title AS title,
          cs.description,
          cs.signal_type,
          cs.dimensions,
          latest.volume,
          latest.impact_v1::text AS impact_v1,
          latest.sentiment_score::text AS sentiment_score,
          latest.polarity_bucket,
          latest.dominant_emotion,
          latest.source_mix,
          latest.evidence_count,
          latest.confidence,
          latest.delta_prev::text AS delta_prev,
          latest.lifecycle_state
        FROM canonical_signals cs
        JOIN latest ON latest.canonical_signal_id = cs.id
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status <> 'archived'
        ORDER BY COALESCE(latest.impact_v1, 0) DESC, latest.volume DESC
        LIMIT 80
      `,
      [corpus.id]
    ),
    pool.query(
      `SELECT id::text, move_type, action_text, signal_refs::text[], evidence_refs, owner_suggestion,
              timing, measurement_suggestion, no_go_notes, confidence, status, position
       FROM marketing_moves
       WHERE study_corpus_id = $1 AND engine_analysis_id = $2
       ORDER BY position NULLS LAST, created_at`,
      [corpus.id, analysis.id]
    ),
    pool.query(
      `SELECT chart_key, payload, algo_version, computed_at::text
       FROM chart_aggregates
       WHERE study_corpus_id = $1
       ORDER BY chart_key`,
      [corpus.id]
    ),
    pool.query(
      `
        SELECT
          so.canonical_signal_id::text AS signal_id,
          soe.id::text AS evidence_id,
          soe.mention_id::text,
          soe.quote,
          soe.evidence_role,
          soe.is_protagonist,
          m.resolved_platform AS platform,
          m.published_at::text,
          m.url
        FROM signal_observations so
        JOIN signal_observation_evidence soe ON soe.signal_observation_id = so.id
        LEFT JOIN mentions m ON m.id = soe.mention_id
        WHERE so.study_corpus_id = $1
          AND so.engine_analysis_id = $2
        ORDER BY so.rank NULLS LAST, soe.is_protagonist DESC, soe.position ASC
        LIMIT 240
      `,
      [corpus.id, analysis.id]
    ),
    pool.query(
      `
        SELECT
          ds.id::text,
          ds.source_type,
          ds.provider,
          ds.connection_method,
          ds.name,
          ds.status,
          ds.visibility,
          ds.mapping_version,
          ds.role,
          latest_sync.status AS sync_status,
          latest_sync.records_total,
          latest_sync.records_valid,
          latest_sync.records_duplicate,
          latest_sync.records_failed,
          latest_sync.coverage_start::text,
          latest_sync.coverage_end::text,
          latest_sync.finished_at::text
        FROM data_sources ds
        LEFT JOIN LATERAL (
          SELECT ssr.*
          FROM source_sync_runs ssr
          WHERE ssr.data_source_id = ds.id
          ORDER BY ssr.created_at DESC
          LIMIT 1
        ) latest_sync ON true
        WHERE ds.study_corpus_id = $1
        ORDER BY ds.source_type, ds.created_at
      `,
      [corpus.id]
    ),
    pool.query(
      `
        WITH period_performance AS (
          SELECT
            rp.id::text AS period_id,
            rp.label,
            rp.period_start::text,
            rp.period_end::text,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.reach), 0)::bigint AS reach,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.video_views), 0)::bigint AS video_views,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            COALESCE(SUM(pr.conversions), 0)::float AS conversions,
            COUNT(DISTINCT pr.external_id)::int AS entities,
            COUNT(pr.id)::int AS records
          FROM report_periods rp
          LEFT JOIN performance_records pr
            ON pr.study_corpus_id = rp.study_corpus_id
           AND pr.record_date >= rp.period_start
           AND pr.record_date <= rp.period_end
          WHERE rp.study_corpus_id = $1
            AND rp.granularity = 'month'
          GROUP BY rp.id, rp.label, rp.period_start, rp.period_end
          ORDER BY rp.period_start
        ),
        campaign_rows AS (
          SELECT
            pr.external_id,
            COALESCE(pr.entity_name, pr.external_id) AS entity_name,
            pr.entity_kind,
            pr.platform,
            pr.channel,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            MIN(pr.record_date)::text AS first_seen,
            MAX(pr.record_date)::text AS last_seen,
            COUNT(*)::int AS records
          FROM performance_records pr
          WHERE pr.study_corpus_id = $1
          GROUP BY pr.external_id, pr.entity_name, pr.entity_kind, pr.platform, pr.channel
          ORDER BY COALESCE(SUM(pr.spend), 0) DESC, COALESCE(SUM(pr.impressions), 0) DESC
          LIMIT 40
        ),
        creative_rows AS (
          SELECT
            pr.creative_text,
            pr.platform,
            pr.channel,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            COUNT(*)::int AS records
          FROM performance_records pr
          WHERE pr.study_corpus_id = $1
            AND NULLIF(trim(pr.creative_text), '') IS NOT NULL
          GROUP BY pr.creative_text, pr.platform, pr.channel
          ORDER BY COALESCE(SUM(pr.impressions), 0) DESC, COALESCE(SUM(pr.engagement), 0) DESC
          LIMIT 30
        )
        SELECT jsonb_build_object(
          'periods', COALESCE((SELECT jsonb_agg(period_performance) FROM period_performance), '[]'::jsonb),
          'campaigns', COALESCE((SELECT jsonb_agg(campaign_rows) FROM campaign_rows), '[]'::jsonb),
          'creatives', COALESCE((SELECT jsonb_agg(creative_rows) FROM creative_rows), '[]'::jsonb)
        ) AS payload
      `,
      [corpus.id]
    ),
    pool.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS estimated_cost_usd
       FROM engine_cost_events
       WHERE engine_analysis_id = $1`,
      [analysis.id]
    )
  ]);

  const chartMap = Object.fromEntries(charts.rows.map((row: { chart_key: string; payload: unknown }) => [row.chart_key, row.payload]));
  return {
    kind: "signal_pulse",
    version: 1,
    report: {
      corpus_id: corpus.id,
      brand_id: corpus.brandId,
      theme_id: corpus.themeId,
      title: corpus.name,
      business_question: corpus.businessQuestion,
      generated_from_engine_analysis_id: analysis.id
    },
    executive_read: buildSignalPulseExecutiveRead(signals.rows, moves.rows),
    periods: periods.rows,
    signals: signals.rows,
    marketing_moves: moves.rows,
    chart_refs: chartMap,
    evidence: evidence.rows,
    sources: sources.rows,
    performance: performance.rows[0]?.payload ?? { periods: [], campaigns: [], creatives: [] },
    quality_gates: Array.isArray((analysis.meta_json ?? {}).quality_gates) ? (analysis.meta_json ?? {}).quality_gates : [],
    cost: {
      estimated_cost_usd: Number(cost.rows[0]?.estimated_cost_usd ?? 0),
      budget_cap_usd: Number(asRecord((analysis.meta_json ?? {}).signal_pulse).readiness && asRecord(asRecord((analysis.meta_json ?? {}).signal_pulse).readiness).budget_cap_usd || 0)
    },
    limitations: signalPulseLimitations(analysis.meta_json)
  };
}

function buildSignalPulseExecutiveRead(signals: Array<Record<string, unknown>>, moves: Array<Record<string, unknown>>) {
  const topSignal = signals[0];
  const topMove = moves[0];
  if (!topSignal) {
    return {
      headline: "Todavía no hay señales suficientes para mover marketing.",
      body: "Sube más conversación o amplía el periodo antes de convertir esto en acciones.",
      action: "Revisar fuentes y cobertura."
    };
  }
  return {
    headline: `${String(topSignal.title ?? "La señal principal")} concentra la prioridad del corte.`,
    body: `Tiene ${Number(topSignal.volume ?? 0)} menciones en el periodo más reciente y confianza ${String(topSignal.confidence ?? "baja")}.`,
    action: String(topMove?.action_text ?? "Usarla como prueba controlada antes de mover presupuesto fuerte.")
  };
}

function signalPulseLimitations(metaJson: unknown) {
  const gates = Array.isArray(asRecord(metaJson).quality_gates) ? asRecord(metaJson).quality_gates as Array<Record<string, unknown>> : [];
  return gates
    .filter((gate) => gate.passed !== true)
    .map((gate) => String(gate.detail ?? gate.id ?? "Limitacion pendiente"))
    .slice(0, 8);
}

function normalizeSignalPulseManifest(input: Record<string, unknown>, checks: Array<{ id: string; passed: boolean; detail: string }>) {
  return {
    kind: "signal_pulse",
    version: 1,
    modules: ["overview", "signals", "marketing_moves", "evidence", "corpus_view", "composer", "quality_settings"],
    quality_gates: checks,
    ...input
  };
}

function validateSignalPulsePublishReadiness(metaJson: unknown):
  | { ok: true; checks: Array<{ id: string; passed: boolean; detail: string }> }
  | { ok: false; error: "signal_pulse_gates_failed" | "signal_pulse_gates_missing"; message: string; failedChecks: Array<{ id: string; detail: string }>; checks: Array<{ id: string; passed: boolean; detail: string }> } {
  const checks = Array.isArray(asRecord(metaJson).quality_gates)
    ? (asRecord(metaJson).quality_gates as unknown[]).map(normalizeSignalPulseGate).filter((gate): gate is { id: string; passed: boolean; detail: string } => Boolean(gate))
    : [];
  if (checks.length === 0) {
    return {
      ok: false,
      error: "signal_pulse_gates_missing",
      message: "Faltan quality gates de Signal Pulse antes de publicar.",
      failedChecks: [],
      checks
    };
  }
  const blockers = new Set(["source_presence", "signal_min_evidence", "chart_data_available", "move_has_signal", "cost_within_budget", "no_invented_numbers"]);
  const failedChecks = checks
    .filter((gate) => blockers.has(gate.id) && !gate.passed)
    .map((gate) => ({ id: gate.id, detail: gate.detail }));
  if (failedChecks.length > 0) {
    return {
      ok: false,
      error: "signal_pulse_gates_failed",
      message: "Signal Pulse no puede publicarse con blockers activos.",
      failedChecks,
      checks
    };
  }
  return { ok: true, checks };
}

function normalizeSignalPulseGate(value: unknown) {
  const gate = asRecord(value);
  const id = typeof gate.id === "string" ? gate.id : "";
  if (!id) return null;
  return {
    id,
    passed: gate.passed === true,
    detail: typeof gate.detail === "string" ? gate.detail : ""
  };
}

async function engineAnalysisUsedFixtureCoding(engineAnalysisId: string, metaJson: unknown) {
  const meta = asRecord(metaJson);
  const engineCoding = asRecord(meta.engine_coding);
  if (engineCoding.fixture === true || engineCoding.provider === "fixture") return true;

  const result = await pool.query<{ used_fixture: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM engine_cost_events
       WHERE engine_analysis_id = $1
         AND provider = 'fixture'
     ) AS used_fixture`,
    [engineAnalysisId]
  );
  return result.rows[0]?.used_fixture === true;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coerceConfidence(value: unknown): TbConfidence {
  return value === "alta" || value === "media" || value === "baja_direccional" ? value : "baja_direccional";
}

function coerceOwnership(value: unknown): CompetitiveOwnership | null {
  if (
    value === "brand_owned" ||
    value === "competitor_owned" ||
    value === "category_wide" ||
    value === "shared" ||
    value === "insufficient_evidence"
  ) {
    return value;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
