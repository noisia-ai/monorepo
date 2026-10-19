import { pool } from "../db/client";

type EngineAnalysisContext = {
  engine_analysis_id: string;
  study_corpus_id: string;
  snapshot_id: string | null;
  brand_id: string | null;
  theme_id: string | null;
  organization_id: string | null;
  methodology_slug: string;
};

type EngineFindingRow = {
  id: string;
  finding_key: string;
  methodology_slug: string;
  entity_id: string | null;
  unit_kind: string;
  name: string;
  dimensions: Record<string, unknown>;
  frequency: number;
  intensity: string | null;
  sentiment: string | null;
  share_pct: string | null;
  composite_score: string | null;
  ownership: string | null;
  differentiation_index: string | null;
  confidence: string | null;
  confidence_factors: unknown;
  period_start: string | null;
  period_end: string | null;
  position: number;
};

type EngineEvidenceRow = {
  citation_id: string;
  mention_id: string | null;
  source_id: string | null;
  quote: string | null;
  is_protagonist: boolean;
  position: number;
};

export async function persistEngineSignalObservations(engineAnalysisId: string) {
  const ctx = await loadEngineAnalysisContext(engineAnalysisId);
  if (!ctx) {
    return { status: "skipped", reason: "engine_analysis_not_found", signals: 0, observations: 0, evidence: 0 };
  }

  const findings = await loadEngineFindings(engineAnalysisId);
  let signals = 0;
  let observations = 0;
  let evidence = 0;

  for (const finding of findings) {
    const semanticKey = buildEngineSemanticKey(finding);
    const canonicalSignalId = await upsertCanonicalSignal(ctx, finding, semanticKey);
    if (!canonicalSignalId) continue;
    signals += 1;

    const observationId = await upsertSignalObservation({ canonicalSignalId, ctx, finding });
    if (!observationId) continue;
    observations += 1;

    evidence += await refreshObservationEvidence({ observationId, findingId: finding.id });
  }

  return { status: "ok", signals, observations, evidence };
}

async function loadEngineAnalysisContext(engineAnalysisId: string): Promise<EngineAnalysisContext | null> {
  const result = await pool.query<EngineAnalysisContext>(
    `
      SELECT
        ea.id AS engine_analysis_id,
        ea.study_corpus_id,
        ea.snapshot_id,
        sc.brand_id,
        sc.theme_id,
        COALESCE(b.organization_id, t.organization_id) AS organization_id,
        ea.methodology_slug
      FROM engine_analyses ea
      JOIN study_corpora sc ON sc.id = ea.study_corpus_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE ea.id = $1
      LIMIT 1
    `,
    [engineAnalysisId]
  );
  return result.rows[0] ?? null;
}

async function loadEngineFindings(engineAnalysisId: string): Promise<EngineFindingRow[]> {
  const result = await pool.query<EngineFindingRow>(
    `
      SELECT
        id::text,
        finding_key,
        methodology_slug,
        entity_id,
        unit_kind,
        name,
        dimensions,
        frequency,
        intensity::text,
        sentiment::text,
        share_pct::text,
        composite_score::text,
        ownership,
        differentiation_index::text,
        confidence,
        confidence_factors,
        period_start::text,
        period_end::text,
        position
      FROM engine_findings
      WHERE engine_analysis_id = $1
      ORDER BY composite_score DESC NULLS LAST, frequency DESC, position ASC
    `,
    [engineAnalysisId]
  );
  return result.rows;
}

async function upsertCanonicalSignal(ctx: EngineAnalysisContext, finding: EngineFindingRow, semanticKey: string) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO canonical_signals (
        organization_id, brand_id, theme_id, study_corpus_id, methodology_slug,
        signal_type, canonical_title, semantic_key, description, dimensions,
        status, first_seen_at, last_seen_at, created_from_engine_finding_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'active', $11::date, $12::date, $13)
      ON CONFLICT (
        (COALESCE(organization_id::text, '')),
        (COALESCE(brand_id::text, '')),
        (COALESCE(theme_id::text, '')),
        methodology_slug,
        signal_type,
        semantic_key
      )
      DO UPDATE SET
        canonical_title = EXCLUDED.canonical_title,
        description = COALESCE(EXCLUDED.description, canonical_signals.description),
        dimensions = canonical_signals.dimensions || EXCLUDED.dimensions,
        status = 'active',
        first_seen_at = CASE
          WHEN canonical_signals.first_seen_at IS NULL THEN EXCLUDED.first_seen_at
          WHEN EXCLUDED.first_seen_at IS NULL THEN canonical_signals.first_seen_at
          ELSE LEAST(canonical_signals.first_seen_at, EXCLUDED.first_seen_at)
        END,
        last_seen_at = CASE
          WHEN canonical_signals.last_seen_at IS NULL THEN EXCLUDED.last_seen_at
          WHEN EXCLUDED.last_seen_at IS NULL THEN canonical_signals.last_seen_at
          ELSE GREATEST(canonical_signals.last_seen_at, EXCLUDED.last_seen_at)
        END,
        updated_at = NOW()
      RETURNING id
    `,
    [
      ctx.organization_id,
      ctx.brand_id,
      ctx.theme_id,
      ctx.study_corpus_id,
      ctx.methodology_slug,
      finding.unit_kind,
      finding.name,
      semanticKey,
      `${finding.name} detectado por ${ctx.methodology_slug}.`,
      JSON.stringify({
        ...finding.dimensions,
        entity_id: finding.entity_id,
        finding_key: finding.finding_key,
        ownership: finding.ownership,
        confidence_factors: finding.confidence_factors
      }),
      finding.period_start,
      finding.period_end,
      finding.id
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function upsertSignalObservation(args: {
  canonicalSignalId: string;
  ctx: EngineAnalysisContext;
  finding: EngineFindingRow;
}) {
  const previous = await pool.query<{ frequency: number }>(
    `
      SELECT frequency
      FROM signal_observations
      WHERE canonical_signal_id = $1
        AND ($2::uuid IS NULL OR snapshot_id IS DISTINCT FROM $2::uuid)
      ORDER BY window_end DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [args.canonicalSignalId, args.ctx.snapshot_id]
  );
  const previousFrequency = Number(previous.rows[0]?.frequency ?? 0);
  const delta = Number(args.finding.frequency ?? 0) - previousFrequency;
  const conflictTarget = args.ctx.snapshot_id
    ? `
      ON CONFLICT (canonical_signal_id, snapshot_id)
      WHERE snapshot_id IS NOT NULL
    `
    : `
      ON CONFLICT (canonical_signal_id, engine_analysis_id)
      WHERE engine_analysis_id IS NOT NULL
    `;

  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO signal_observations (
        canonical_signal_id, study_corpus_id, snapshot_id, engine_analysis_id,
        methodology_slug, signal_type, window_start, window_end, frequency,
        share_pct, intensity, sentiment, composite_score, confidence, rank,
        delta_vs_previous, status, metrics
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9,
        $10, $11, $12, $13, $14, $15, $16, 'observed', $17::jsonb
      )
      ${conflictTarget}
      DO UPDATE SET
        engine_analysis_id = EXCLUDED.engine_analysis_id,
        window_start = EXCLUDED.window_start,
        window_end = EXCLUDED.window_end,
        frequency = EXCLUDED.frequency,
        share_pct = EXCLUDED.share_pct,
        intensity = EXCLUDED.intensity,
        sentiment = EXCLUDED.sentiment,
        composite_score = EXCLUDED.composite_score,
        confidence = EXCLUDED.confidence,
        rank = EXCLUDED.rank,
        delta_vs_previous = EXCLUDED.delta_vs_previous,
        metrics = EXCLUDED.metrics
      RETURNING id
    `,
    [
      args.canonicalSignalId,
      args.ctx.study_corpus_id,
      args.ctx.snapshot_id,
      args.ctx.engine_analysis_id,
      args.ctx.methodology_slug,
      args.finding.unit_kind,
      args.finding.period_start,
      args.finding.period_end,
      args.finding.frequency,
      numericOrNull(args.finding.share_pct),
      numericOrNull(args.finding.intensity),
      numericOrNull(args.finding.sentiment),
      numericOrNull(args.finding.composite_score),
      args.finding.confidence,
      args.finding.position,
      delta,
      JSON.stringify({
        finding_key: args.finding.finding_key,
        entity_id: args.finding.entity_id,
        ownership: args.finding.ownership,
        differentiation_index: numericOrNull(args.finding.differentiation_index),
        previous_frequency: previousFrequency
      })
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function refreshObservationEvidence(args: { observationId: string; findingId: string }) {
  const evidence = await loadEngineEvidence(args.findingId);
  await pool.query(`DELETE FROM signal_observation_evidence WHERE signal_observation_id = $1`, [args.observationId]);
  let inserted = 0;
  for (const item of evidence.slice(0, 12)) {
    await pool.query(
      `
        INSERT INTO signal_observation_evidence (
          signal_observation_id, mention_id, source_id, engine_finding_citation_id,
          quote, evidence_role, is_protagonist, position
        )
        VALUES ($1, $2, $3, $4, $5, 'engine_citation', $6, $7)
      `,
      [
        args.observationId,
        item.mention_id,
        item.source_id,
        item.citation_id,
        item.quote,
        item.is_protagonist,
        item.position
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function loadEngineEvidence(findingId: string): Promise<EngineEvidenceRow[]> {
  const result = await pool.query<EngineEvidenceRow>(
    `
      SELECT
        c.id::text AS citation_id,
        c.mention_id::text,
        c.source_id::text,
        LEFT(COALESCE(ec.span, m.text_clean, bks.raw_text), 1200) AS quote,
        c.is_protagonist,
        c.position
      FROM engine_finding_citations c
      LEFT JOIN engine_codings ec
        ON ec.finding_id = c.finding_id
       AND (ec.mention_id IS NOT DISTINCT FROM c.mention_id)
       AND (ec.source_id IS NOT DISTINCT FROM c.source_id)
      LEFT JOIN mentions m ON m.id = c.mention_id
      LEFT JOIN brand_knowledge_sources bks ON bks.id = c.source_id
      WHERE c.finding_id = $1
      ORDER BY c.is_protagonist DESC, c.position ASC
    `,
    [findingId]
  );
  return result.rows.filter((row) => row.mention_id || row.source_id);
}

function buildEngineSemanticKey(finding: EngineFindingRow) {
  return slugify(`${finding.methodology_slug} ${finding.unit_kind} ${finding.name} ${finding.finding_key}`);
}

function numericOrNull(value: string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}
