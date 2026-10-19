import { pool } from "@/lib/db";

type PersistTbSignalObservationsArgs = {
  tbAnalysisId: string;
  publishedOutputId?: string | null;
};

export type LiveIntelligenceFindingLink = {
  finding_id: string;
  tb_finding_id: string;
  canonical_signal_id: string;
  signal_observation_id: string;
  signal_type: string;
  title: string;
};

export type TbObservationContext = {
  tb_analysis_id: string;
  study_corpus_id: string;
  snapshot_id: string | null;
  brand_id: string | null;
  theme_id: string | null;
  organization_id: string | null;
};

export type TbFindingObservationRow = {
  id: string;
  finding_id: string;
  polarity: string;
  layer: string;
  nombre_comercial: string;
  frecuencia: number;
  intensidad_promedio: string | null;
  score_compuesto: string | null;
  confidence: string | null;
  period_start: string | null;
  period_end: string | null;
  cita_protagonista: unknown;
  raw_data: unknown;
  position_in_layer: number;
  evidence_count: number;
};

type EvidenceRow = {
  citation_id: string;
  mention_id: string;
  text_clean: string;
  is_protagonist: boolean;
  position: number;
};

export async function persistTbSignalObservations(args: PersistTbSignalObservationsArgs) {
  const ctx = await loadAnalysisContext(args.tbAnalysisId);
  if (!ctx) {
    return { status: "skipped", reason: "analysis_not_found", signals: 0, observations: 0, evidence: 0, mappings: [] };
  }

  const findings = await loadFindings(args.tbAnalysisId);
  let signals = 0;
  let observations = 0;
  let evidence = 0;
  const mappings: LiveIntelligenceFindingLink[] = [];

  for (const finding of findings) {
    const semanticKey = buildTbSemanticKey(finding);
    const canonicalSignalId = await upsertCanonicalSignal(ctx, finding, semanticKey);
    if (!canonicalSignalId) continue;
    signals += 1;

    const observationId = await upsertSignalObservation({
      canonicalSignalId,
      ctx,
      finding,
      publishedOutputId: args.publishedOutputId ?? null
    });
    if (!observationId) continue;
    observations += 1;
    mappings.push(buildLiveIntelligenceFindingLink(finding, canonicalSignalId, observationId));

    const insertedEvidence = await refreshObservationEvidence({ observationId, findingId: finding.id });
    evidence += insertedEvidence;
  }

  return { status: "ok", signals, observations, evidence, mappings };
}

export type TbCanonicalSignalDraft = {
  organizationId: string | null;
  brandId: string | null;
  themeId: string | null;
  studyCorpusId: string;
  methodologySlug: "triggers-barriers";
  signalType: string;
  canonicalTitle: string;
  semanticKey: string;
  description: string;
  dimensions: Record<string, unknown>;
  status: "active";
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdFromTbFindingId: string;
};

export type TbSignalObservationDraft = {
  canonicalSignalId: string;
  studyCorpusId: string;
  snapshotId: string | null;
  tbAnalysisId: string;
  publishedOutputId: string | null;
  methodologySlug: "triggers-barriers";
  signalType: string;
  windowStart: string | null;
  windowEnd: string | null;
  frequency: number;
  intensity: number | null;
  compositeScore: number | null;
  confidence: string | null;
  rank: number;
  deltaVsPrevious: number;
  status: "observed";
  metrics: {
    layer: string;
    finding_id: string;
    evidence_count: number;
    previous_frequency: number;
  };
};

async function loadAnalysisContext(tbAnalysisId: string): Promise<TbObservationContext | null> {
  const result = await pool.query<TbObservationContext>(
    `
      SELECT
        ta.id AS tb_analysis_id,
        ta.study_corpus_id,
        ta.snapshot_id,
        sc.brand_id,
        sc.theme_id,
        COALESCE(b.organization_id, t.organization_id) AS organization_id
      FROM tb_analyses ta
      JOIN study_corpora sc ON sc.id = ta.study_corpus_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE ta.id = $1
      LIMIT 1
    `,
    [tbAnalysisId]
  );
  return result.rows[0] ?? null;
}

async function loadFindings(tbAnalysisId: string): Promise<TbFindingObservationRow[]> {
  const result = await pool.query<TbFindingObservationRow>(
    `
      SELECT
        f.id::text,
        f.finding_id,
        f.polarity,
        f.layer,
        f.nombre_comercial,
        f.frecuencia,
        f.intensidad_promedio::text,
        f.score_compuesto::text,
        f.confidence,
        f.period_start::text,
        f.period_end::text,
        f.cita_protagonista,
        f.raw_data,
        f.position_in_layer,
        COUNT(c.id)::int AS evidence_count
      FROM tb_findings f
      LEFT JOIN tb_finding_citations c ON c.finding_id = f.id
      WHERE f.tb_analysis_id = $1
      GROUP BY f.id
      ORDER BY f.score_compuesto DESC NULLS LAST, f.position_in_layer ASC
    `,
    [tbAnalysisId]
  );
  return result.rows;
}

async function upsertCanonicalSignal(ctx: TbObservationContext, finding: TbFindingObservationRow, semanticKey: string) {
  const draft = buildTbCanonicalSignalDraft(ctx, finding, semanticKey);
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO canonical_signals (
        organization_id, brand_id, theme_id, study_corpus_id, methodology_slug,
        signal_type, canonical_title, semantic_key, description, dimensions,
        status, first_seen_at, last_seen_at, created_from_tb_finding_id
      )
      VALUES ($1, $2, $3, $4, 'triggers-barriers', $5, $6, $7, $8, $9::jsonb, 'active', $10::date, $11::date, $12)
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
      draft.organizationId,
      draft.brandId,
      draft.themeId,
      draft.studyCorpusId,
      draft.signalType,
      draft.canonicalTitle,
      draft.semanticKey,
      draft.description,
      JSON.stringify(draft.dimensions),
      draft.firstSeenAt,
      draft.lastSeenAt,
      draft.createdFromTbFindingId
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function upsertSignalObservation(args: {
  canonicalSignalId: string;
  ctx: TbObservationContext;
  finding: TbFindingObservationRow;
  publishedOutputId: string | null;
}) {
  const previous = await pool.query<{ frequency: number }>(
    `
      SELECT frequency
      FROM signal_observations
      WHERE canonical_signal_id = $1
        AND snapshot_id IS DISTINCT FROM $2::uuid
      ORDER BY window_end DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [args.canonicalSignalId, args.ctx.snapshot_id]
  );
  const previousFrequency = Number(previous.rows[0]?.frequency ?? 0);
  const draft = buildTbSignalObservationDraft({
    canonicalSignalId: args.canonicalSignalId,
    ctx: args.ctx,
    finding: args.finding,
    publishedOutputId: args.publishedOutputId,
    previousFrequency
  });
  const conflictTarget = getTbObservationConflictTarget(draft.snapshotId);

  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO signal_observations (
        canonical_signal_id, study_corpus_id, snapshot_id, tb_analysis_id,
        published_output_id, methodology_slug, signal_type, window_start,
        window_end, frequency, intensity, composite_score, confidence, rank,
        delta_vs_previous, status, metrics
      )
      VALUES (
        $1, $2, $3, $4, $5, 'triggers-barriers', $6, $7::date, $8::date,
        $9, $10, $11, $12, $13, $14, 'observed', $15::jsonb
      )
      ${conflictTarget}
      DO UPDATE SET
        tb_analysis_id = EXCLUDED.tb_analysis_id,
        published_output_id = EXCLUDED.published_output_id,
        window_start = EXCLUDED.window_start,
        window_end = EXCLUDED.window_end,
        frequency = EXCLUDED.frequency,
        intensity = EXCLUDED.intensity,
        composite_score = EXCLUDED.composite_score,
        confidence = EXCLUDED.confidence,
        rank = EXCLUDED.rank,
        delta_vs_previous = EXCLUDED.delta_vs_previous,
        metrics = EXCLUDED.metrics
      RETURNING id
    `,
    [
      draft.canonicalSignalId,
      draft.studyCorpusId,
      draft.snapshotId,
      draft.tbAnalysisId,
      draft.publishedOutputId,
      draft.signalType,
      draft.windowStart,
      draft.windowEnd,
      draft.frequency,
      draft.intensity,
      draft.compositeScore,
      draft.confidence,
      draft.rank,
      draft.deltaVsPrevious,
      JSON.stringify(draft.metrics)
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function refreshObservationEvidence(args: { observationId: string; findingId: string }) {
  const evidence = await loadEvidence(args.findingId);
  await pool.query(`DELETE FROM signal_observation_evidence WHERE signal_observation_id = $1`, [args.observationId]);
  let inserted = 0;
  for (const item of evidence.slice(0, 12)) {
    await pool.query(
      `
        INSERT INTO signal_observation_evidence (
          signal_observation_id, mention_id, tb_finding_citation_id, quote,
          evidence_role, is_protagonist, position
        )
        VALUES ($1, $2, $3, $4, 'tb_citation', $5, $6)
      `,
      [args.observationId, item.mention_id, item.citation_id, item.text_clean, item.is_protagonist, item.position]
    );
    inserted += 1;
  }
  return inserted;
}

async function loadEvidence(findingId: string): Promise<EvidenceRow[]> {
  const result = await pool.query<EvidenceRow>(
    `
      SELECT
        c.id::text AS citation_id,
        c.mention_id::text,
        m.text_clean,
        c.is_protagonist,
        c.position
      FROM tb_finding_citations c
      JOIN mentions m ON m.id = c.mention_id
      WHERE c.finding_id = $1
      ORDER BY c.is_protagonist DESC, c.position ASC
    `,
    [findingId]
  );
  return result.rows;
}

export function buildTbCanonicalSignalDraft(
  ctx: TbObservationContext,
  finding: TbFindingObservationRow,
  semanticKey = buildTbSemanticKey(finding)
): TbCanonicalSignalDraft {
  const firstSeenAt = finding.period_start ?? null;
  const lastSeenAt = finding.period_end ?? finding.period_start ?? null;
  return {
    organizationId: ctx.organization_id,
    brandId: ctx.brand_id,
    themeId: ctx.theme_id,
    studyCorpusId: ctx.study_corpus_id,
    methodologySlug: "triggers-barriers",
    signalType: finding.polarity,
    canonicalTitle: finding.nombre_comercial,
    semanticKey,
    description: `${finding.nombre_comercial} opera como ${finding.polarity} ${finding.layer}.`,
    dimensions: {
      layer: finding.layer,
      original_finding_id: finding.finding_id,
      raw_data: compactRawData(finding.raw_data)
    },
    status: "active",
    firstSeenAt,
    lastSeenAt,
    createdFromTbFindingId: finding.id
  };
}

export function buildTbSignalObservationDraft(args: {
  canonicalSignalId: string;
  ctx: TbObservationContext;
  finding: TbFindingObservationRow;
  publishedOutputId: string | null;
  previousFrequency: number;
}): TbSignalObservationDraft {
  const frequency = Number(args.finding.frecuencia ?? 0);
  const previousFrequency = Number.isFinite(args.previousFrequency) ? args.previousFrequency : 0;
  return {
    canonicalSignalId: args.canonicalSignalId,
    studyCorpusId: args.ctx.study_corpus_id,
    snapshotId: args.ctx.snapshot_id,
    tbAnalysisId: args.ctx.tb_analysis_id,
    publishedOutputId: args.publishedOutputId,
    methodologySlug: "triggers-barriers",
    signalType: args.finding.polarity,
    windowStart: args.finding.period_start,
    windowEnd: args.finding.period_end,
    frequency,
    intensity: numericOrNull(args.finding.intensidad_promedio),
    compositeScore: numericOrNull(args.finding.score_compuesto),
    confidence: args.finding.confidence,
    rank: args.finding.position_in_layer,
    deltaVsPrevious: frequency - previousFrequency,
    status: "observed",
    metrics: {
      layer: args.finding.layer,
      finding_id: args.finding.finding_id,
      evidence_count: args.finding.evidence_count,
      previous_frequency: previousFrequency
    }
  };
}

export function buildLiveIntelligenceFindingLink(
  finding: TbFindingObservationRow,
  canonicalSignalId: string,
  observationId: string
): LiveIntelligenceFindingLink {
  return {
    finding_id: finding.finding_id,
    tb_finding_id: finding.id,
    canonical_signal_id: canonicalSignalId,
    signal_observation_id: observationId,
    signal_type: finding.polarity,
    title: finding.nombre_comercial
  };
}

export function getTbObservationConflictTarget(snapshotId: string | null) {
  return snapshotId
    ? `
      ON CONFLICT (canonical_signal_id, snapshot_id)
      WHERE snapshot_id IS NOT NULL
    `
    : `
      ON CONFLICT (canonical_signal_id, tb_analysis_id)
      WHERE tb_analysis_id IS NOT NULL
    `;
}

export function buildTbSemanticKey(finding: TbFindingObservationRow) {
  const rawTags = compactRawData(finding.raw_data).member_tags;
  const tagPart = Array.isArray(rawTags) && rawTags.length > 0
    ? Array.from(new Set(rawTags.map((tag) => slugify(String(tag))).filter(Boolean))).sort().slice(0, 6).join(" ")
    : "";
  return slugify(`${finding.polarity} ${finding.layer} ${finding.nombre_comercial} ${tagPart}`);
}

function compactRawData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    .slice(0, 160);
}
