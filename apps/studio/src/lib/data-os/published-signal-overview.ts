import { pool } from "@/lib/db";
import {
  normalizeSignalMobility,
  SIGNAL_SEMANTIC_DEFINITIONS,
  SIGNAL_SERVING_CONTRACT_VERSION,
  type SignalMobility
} from "@/lib/signal/semantics";
import type {
  PublicActionCard,
  PublicTbFinding,
  StrategicOpportunity,
  TbConfidence,
  TbLayer,
  TbMobility,
  TbPolarity
} from "@/lib/signal/contracts";
import {
  loadSignalDataOsTimeline,
  type SignalDataOsTimelineModel
} from "@/lib/data-os/signal-timeline";

type DistributionRow = { count: number };
type MobilityRow = DistributionRow & { movilidad: string | null };

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type PublishedSignalOpportunity = {
  id: string;
  opportunity_id: string;
  title: string;
  decision: string;
  why_now: string;
  level: string;
  source_mix: string[];
  related_finding_ids: string[];
  evidence_summary: string;
  what_to_do: string;
  success_signal: string;
  confidence: string;
  citation_count: number;
  position: number;
};

type PublishedSignalActionRow = {
  action_id: string;
  target_team: string;
  kind: string;
  title: string;
  finding_ids: string[];
  primary_finding_id: string | null;
  rationale: string;
  action_text: string;
  suggested_channel: string | null;
  suggested_format: string | null;
  success_signal: string;
  estimated_effort: string;
  estimated_impact: string;
  confidence: string;
  priority_rank: number;
  citation_count: number;
};

export type PublishedSignalOverview = {
  ok: true;
  contract: {
    version: typeof SIGNAL_SERVING_CONTRACT_VERSION;
    source_of_truth: "relational";
    snapshot_id: string;
    analysis_id: string;
    payload_role: "manifest_only";
    definitions: typeof SIGNAL_SEMANTIC_DEFINITIONS;
  };
  filters: { dateFrom: string; dateTo: string };
  corpus: {
    total_mentions: number;
    window: { start: string | null; end: string | null };
  };
  metrics: {
    findings_total: number;
    triggers_total: number;
    barriers_total: number;
    movable_total: number;
    opportunities_total: number;
    coded_mentions_total: number;
    citations_total: number;
    tags_total: number;
    features_total: number;
  };
  polarity_distribution: Array<{ polarity: string; count: number }>;
  layer_distribution: Array<{ layer: string; count: number; avg_intensity: string | null }>;
  mobility_distribution: Array<{ movilidad: SignalMobility; count: number }>;
  platform_distribution: Array<{ platform: string; count: number }>;
  content_type_distribution: Array<{ content_type: string; count: number }>;
  volume_timeline: Array<{ month: string; mentions: number }>;
  polarity_time_series: Array<{ month: string; trigger: number; barrier: number }>;
  finding_time_series: Array<{
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    movilidad: SignalMobility;
    month: string;
    mentions: number;
    intensidad: string | null;
    score: string | null;
  }>;
  findings_scatter: Array<{
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    movilidad: SignalMobility;
    frecuencia: number;
    intensidad: string | null;
    score: string | null;
    confidence: string | null;
    citation_count: number;
  }>;
  findings: PublicTbFinding[];
  top_findings_by_voice: Array<{ finding_id: string; nombre: string; citation_count: number }>;
  top_barriers: Array<{
    finding_id: string;
    nombre: string;
    movilidad: SignalMobility;
    frecuencia: number;
    intensidad: string | null;
    score: string | null;
    citation_count: number;
  }>;
  opportunities: StrategicOpportunity[];
  action_studio: PublicActionCard[];
  tag_distribution: Array<{
    taxonomy_key: string;
    term_key: string;
    label: string;
    count: number;
    avg_score: string | null;
  }>;
  feature_distribution: Array<{
    feature_key: string;
    feature_value: string;
    value_type: string | null;
    count: number;
  }>;
  evidence: {
    finding_citations: number;
    coded_mentions: number;
    tagged_mentions: number;
    featured_mentions: number;
  };
  cross_source_timeline: SignalDataOsTimelineModel | null;
};

export type LoadPublishedSignalOverviewArgs = {
  snapshotId: string;
  analysisId: string;
  corpusId?: string;
  outputId?: string;
  requireGovernedRef?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

function normalizeOpportunityConfidence(value: string | null): TbConfidence {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "alta" || normalized === "high") return "alta";
  if (normalized === "media" || normalized === "medium") return "media";
  return "baja_direccional";
}

function normalizeFindingPolarity(value: string | null): TbPolarity {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "trigger") return "trigger";
  if (normalized === "barrier") return "barrier";
  return "mixed";
}

function normalizeFindingLayer(value: string | null): TbLayer {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "psicologico" || normalized === "psychological") return "psicologico";
  if (normalized === "social") return "social";
  if (normalized === "cultural") return "cultural";
  return "personal";
}

function normalizeFindingMobility(value: string | null): TbMobility | null {
  const normalized = normalizeSignalMobility(value);
  if (normalized === "movable") return "movible_por_marca";
  if (normalized === "partial") return "parcialmente_movible";
  if (normalized === "structural") return "estructural";
  return null;
}

export function mapPublishedSignalOpportunities(
  rows: PublishedSignalOpportunity[]
): StrategicOpportunity[] {
  return rows.map((row) => ({
    opportunity_id: row.opportunity_id,
    title: row.title,
    decision: row.decision,
    why_now: row.why_now,
    level: requiredEnum(row.level, OPPORTUNITY_LEVELS, "Strategic opportunity level"),
    source_mix: Array.from(new Set([
      ...row.source_mix,
      "published_snapshot",
      "tb_strategic_opportunities",
      ...(row.citation_count > 0 ? ["finding_citations"] : [])
    ])),
    related_finding_ids: row.related_finding_ids,
    evidence_summary: row.evidence_summary,
    what_to_do: row.what_to_do,
    success_signal: row.success_signal,
    confidence: requiredEnum(row.confidence, CONFIDENCE_LEVELS, "Strategic opportunity confidence")
  }));
}

export function mapPublishedSignalActions(rows: PublishedSignalActionRow[]): PublicActionCard[] {
  return rows.map((row) => ({
    action_id: row.action_id,
    target_team: requiredEnum(row.target_team, ACTION_TEAMS, "Action Studio target_team"),
    kind: requiredEnum(row.kind, ACTION_KINDS, "Action Studio kind"),
    title: row.title,
    finding_ids: row.finding_ids,
    primary_finding_id: row.primary_finding_id,
    action_text: row.action_text,
    rationale: row.rationale,
    suggested_channel: row.suggested_channel,
    suggested_format: row.suggested_format,
    success_signal: row.success_signal,
    estimated_effort: requiredEnum(row.estimated_effort, ACTION_EFFORTS, "Action Studio estimated_effort"),
    estimated_impact: requiredEnum(row.estimated_impact, ACTION_IMPACTS, "Action Studio estimated_impact"),
    confidence: requiredEnum(row.confidence, CONFIDENCE_LEVELS, "Action Studio confidence"),
    priority_rank: row.priority_rank
  }));
}

const ACTION_TEAMS = [
  "brand_strategy",
  "creative_content",
  "product_cx",
  "retail_media",
  "measurement",
  "cultural_guardrails"
] as const;

const ACTION_KINDS = [
  "activation",
  "friction_removal",
  "alignment",
  "experiment",
  "guardrail",
  "structural_note"
] as const;

const ACTION_EFFORTS = ["baja", "media", "alta"] as const;
const ACTION_IMPACTS = ["bajo", "medio", "alto"] as const;

const OPPORTUNITY_LEVELS = [
  "brand",
  "content",
  "product_cx",
  "competitive",
  "measurement",
  "category"
] as const;

const CONFIDENCE_LEVELS = ["alta", "media", "baja_direccional"] as const;

function requiredEnum<const T extends readonly string[]>(value: string, allowed: T, label: string): T[number] {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label} has an invalid canonical value: ${value}`);
  }
  return value as T[number];
}

function normalizeMobilityDistribution(rows: MobilityRow[]) {
  const distribution = new Map<SignalMobility, number>([
    ["movable", 0],
    ["partial", 0],
    ["structural", 0],
    ["unknown", 0]
  ]);

  for (const row of rows) {
    const mobility = normalizeSignalMobility(row.movilidad);
    distribution.set(mobility, (distribution.get(mobility) ?? 0) + Number(row.count ?? 0));
  }

  return Array.from(distribution, ([movilidad, count]) => ({ movilidad, count })).filter((row) => row.count > 0);
}

function buildSnapshotMentionFilter(args: LoadPublishedSignalOverviewArgs) {
  const params: unknown[] = [args.snapshotId];
  const where = ["csm.snapshot_id = $1::uuid"];
  if (args.dateFrom) {
    params.push(args.dateFrom);
    where.push(`m.published_at >= $${params.length}::date`);
  }
  if (args.dateTo) {
    params.push(args.dateTo);
    where.push(`m.published_at < ($${params.length}::date + interval '1 day')`);
  }
  return { params, where };
}

function buildSnapshotCodingFilter(args: LoadPublishedSignalOverviewArgs) {
  const params: unknown[] = [args.snapshotId, args.analysisId];
  const where = ["csm.snapshot_id = $1::uuid", "mc.tb_analysis_id = $2::uuid"];
  if (args.dateFrom) {
    params.push(args.dateFrom);
    where.push(`m.published_at >= $${params.length}::date`);
  }
  if (args.dateTo) {
    params.push(args.dateTo);
    where.push(`m.published_at < ($${params.length}::date + interval '1 day')`);
  }
  return { params, where };
}

export async function loadPublishedSignalOverview(
  args: LoadPublishedSignalOverviewArgs
): Promise<PublishedSignalOverview> {
  const mentionFilter = buildSnapshotMentionFilter(args);
  const codingFilter = buildSnapshotCodingFilter(args);
  const analysisParams = [args.analysisId];
  const snapshotAnalysisParams = [args.analysisId, args.snapshotId];

  const [
    corpus,
    platformDistribution,
    contentTypeDistribution,
    volumeTimeline,
    signalMetrics,
    polarityDistribution,
    polarityTimeline,
    findingTimeSeries,
    layerDistribution,
    mobilityDistribution,
    findingsScatter,
    topVoice,
    topBarriers,
    opportunities,
    actionStudio,
    tagDistribution,
    featureDistribution,
    evidence,
    crossSourceTimeline
  ] = await Promise.all([
    pool.query<{ total_mentions: number; window_start: string | null; window_end: string | null }>(
      `
        SELECT COUNT(*)::int AS total_mentions,
               min(m.published_at)::text AS window_start,
               max(m.published_at)::text AS window_end
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        WHERE ${mentionFilter.where.join(" AND ")}
      `,
      mentionFilter.params
    ),
    pool.query<{ platform: string; count: number }>(
      `
        SELECT COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
               COUNT(*)::int AS count
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        WHERE ${mentionFilter.where.join(" AND ")}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 30
      `,
      mentionFilter.params
    ),
    pool.query<{ content_type: string; count: number }>(
      `
        SELECT COALESCE(NULLIF(m.content_type, ''), 'unknown') AS content_type,
               COUNT(*)::int AS count
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        WHERE ${mentionFilter.where.join(" AND ")}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 30
      `,
      mentionFilter.params
    ),
    pool.query<{ month: string; mentions: number }>(
      `
        SELECT to_char(date_trunc('month', m.published_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS mentions
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        WHERE ${mentionFilter.where.join(" AND ")}
        GROUP BY 1
        ORDER BY 1
      `,
      mentionFilter.params
    ),
    pool.query<{
      findings_total: number;
      triggers_total: number;
      barriers_total: number;
      movable_total: number;
      opportunities_total: number;
    }>(
      `
        SELECT COUNT(*)::int AS findings_total,
               COUNT(*) FILTER (WHERE lower(tf.polarity) = 'trigger')::int AS triggers_total,
               COUNT(*) FILTER (WHERE lower(tf.polarity) = 'barrier')::int AS barriers_total,
               COUNT(*) FILTER (
                 WHERE lower(COALESCE(tf.movilidad, '')) IN
                   ('movable', 'movible', 'movible_por_marca', 'brand_movable')
               )::int AS movable_total,
               (
                 SELECT COUNT(*)::int
                 FROM tb_strategic_opportunities opportunity
                 WHERE opportunity.tb_analysis_id = $1::uuid
               ) AS opportunities_total
        FROM tb_findings tf
        WHERE tf.tb_analysis_id = $1::uuid
      `,
      analysisParams
    ),
    pool.query<{ polarity: string; count: number }>(
      `
        SELECT COALESCE(NULLIF(lower(tf.polarity), ''), 'unknown') AS polarity,
               COUNT(*)::int AS count
        FROM tb_findings tf
        WHERE tf.tb_analysis_id = $1::uuid
        GROUP BY 1
        ORDER BY count DESC
      `,
      analysisParams
    ),
    pool.query<{ month: string; trigger: number; barrier: number }>(
      `
        SELECT to_char(date_trunc('month', m.published_at), 'YYYY-MM') AS month,
               COUNT(DISTINCT m.id) FILTER (WHERE lower(mc.polarity) = 'trigger')::int AS trigger,
               COUNT(DISTINCT m.id) FILTER (WHERE lower(mc.polarity) = 'barrier')::int AS barrier
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        JOIN tb_mention_codings mc ON mc.mention_id = m.id
        WHERE ${codingFilter.where.join(" AND ")}
        GROUP BY 1
        ORDER BY 1
      `,
      codingFilter.params
    ),
    pool.query<{
      finding_id: string;
      nombre: string;
      polarity: string;
      layer: string | null;
      movilidad: string | null;
      month: string;
      mentions: number;
      intensidad: string | null;
      score: string | null;
    }>(
      `
        SELECT tf.finding_id,
               tf.nombre_comercial AS nombre,
               COALESCE(NULLIF(lower(tf.polarity), ''), 'unknown') AS polarity,
               tf.layer,
               tf.movilidad,
               to_char(date_trunc('month', m.published_at), 'YYYY-MM') AS month,
               COUNT(DISTINCT m.id)::int AS mentions,
               avg(mc.intensity_score)::text AS intensidad,
               tf.score_compuesto::text AS score
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        JOIN tb_mention_codings mc ON mc.mention_id = m.id
        JOIN tb_findings tf ON tf.id = mc.finding_id AND tf.tb_analysis_id = mc.tb_analysis_id
        WHERE ${codingFilter.where.join(" AND ")}
        GROUP BY tf.id, tf.finding_id, tf.nombre_comercial, tf.polarity, tf.layer, tf.movilidad,
                 tf.score_compuesto, date_trunc('month', m.published_at)
        ORDER BY month, mentions DESC
      `,
      codingFilter.params
    ),
    pool.query<{ layer: string; count: number; avg_intensity: string | null }>(
      `
        SELECT COALESCE(NULLIF(lower(tf.layer), ''), 'unknown') AS layer,
               COUNT(*)::int AS count,
               avg(tf.intensidad_promedio)::text AS avg_intensity
        FROM tb_findings tf
        WHERE tf.tb_analysis_id = $1::uuid
        GROUP BY 1
        ORDER BY count DESC
      `,
      analysisParams
    ),
    pool.query<MobilityRow>(
      `
        SELECT tf.movilidad, COUNT(*)::int AS count
        FROM tb_findings tf
        WHERE tf.tb_analysis_id = $1::uuid
        GROUP BY tf.movilidad
        ORDER BY count DESC
      `,
      analysisParams
    ),
    pool.query<{
      finding_id: string;
      nombre: string;
      polarity: string;
      layer: string | null;
      movilidad: string | null;
      frecuencia: number;
      intensidad: string | null;
      score: string | null;
      confidence: string | null;
      predictive_capacity: string | null;
      period_start: string | null;
      period_end: string | null;
      public_quote: string | null;
      citation_count: number;
    }>(
      `
        SELECT tf.finding_id,
               tf.nombre_comercial AS nombre,
               lower(tf.polarity) AS polarity,
               tf.layer,
               tf.movilidad,
               tf.frecuencia::int,
               tf.intensidad_promedio::text AS intensidad,
               tf.score_compuesto::text AS score,
               tf.confidence,
               tf.capacidad_predictiva::text AS predictive_capacity,
               tf.period_start::text AS period_start,
               tf.period_end::text AS period_end,
               CASE
                 WHEN jsonb_typeof(tf.cita_protagonista) = 'string'
                   THEN trim(BOTH '"' FROM tf.cita_protagonista::text)
                 WHEN jsonb_typeof(tf.cita_protagonista) = 'object'
                   THEN COALESCE(tf.cita_protagonista->>'text', tf.cita_protagonista->>'quote')
                 ELSE NULL
               END AS public_quote,
               COUNT(DISTINCT csm.mention_id)::int AS citation_count
        FROM tb_findings tf
        LEFT JOIN tb_finding_citations fc ON fc.finding_id = tf.id
        LEFT JOIN corpus_snapshot_mentions csm
          ON csm.mention_id = fc.mention_id
         AND csm.snapshot_id = $2::uuid
        WHERE tf.tb_analysis_id = $1::uuid
        GROUP BY tf.id
        ORDER BY tf.score_compuesto DESC NULLS LAST, citation_count DESC, tf.finding_id
      `,
      snapshotAnalysisParams
    ),
    pool.query<{ finding_id: string; nombre: string; citation_count: number }>(
      `
        SELECT tf.finding_id,
               tf.nombre_comercial AS nombre,
               COUNT(DISTINCT csm.mention_id)::int AS citation_count
        FROM tb_findings tf
        LEFT JOIN tb_finding_citations fc ON fc.finding_id = tf.id
        LEFT JOIN corpus_snapshot_mentions csm
          ON csm.mention_id = fc.mention_id
         AND csm.snapshot_id = $2::uuid
        WHERE tf.tb_analysis_id = $1::uuid
        GROUP BY tf.id
        ORDER BY citation_count DESC, tf.finding_id
        LIMIT 12
      `,
      snapshotAnalysisParams
    ),
    pool.query<{
      finding_id: string;
      nombre: string;
      movilidad: string | null;
      frecuencia: number;
      intensidad: string | null;
      score: string | null;
      citation_count: number;
    }>(
      `
        SELECT tf.finding_id,
               tf.nombre_comercial AS nombre,
               tf.movilidad,
               tf.frecuencia::int,
               tf.intensidad_promedio::text AS intensidad,
               tf.score_compuesto::text AS score,
               COUNT(DISTINCT csm.mention_id)::int AS citation_count
        FROM tb_findings tf
        LEFT JOIN tb_finding_citations fc ON fc.finding_id = tf.id
        LEFT JOIN corpus_snapshot_mentions csm
          ON csm.mention_id = fc.mention_id
         AND csm.snapshot_id = $2::uuid
        WHERE tf.tb_analysis_id = $1::uuid
          AND lower(tf.polarity) = 'barrier'
        GROUP BY tf.id
        ORDER BY tf.score_compuesto DESC NULLS LAST, citation_count DESC, tf.finding_id
        LIMIT 12
      `,
      snapshotAnalysisParams
    ),
    pool.query<PublishedSignalOpportunity>(
      `
        SELECT opportunity.id::text AS id,
               opportunity.opportunity_id,
               opportunity.title,
               opportunity.decision,
               opportunity.why_now,
               opportunity.level,
               opportunity.source_mix,
               COALESCE((
                 SELECT array_agg(finding.finding_id ORDER BY link.position, finding.finding_id)
                 FROM tb_opportunity_findings link
                 INNER JOIN tb_findings finding ON finding.id = link.finding_id
                 WHERE link.opportunity_id = opportunity.id
                   AND finding.tb_analysis_id = opportunity.tb_analysis_id
               ), ARRAY[]::text[]) AS related_finding_ids,
               opportunity.evidence_summary,
               opportunity.what_to_do,
               opportunity.success_signal,
               opportunity.confidence,
               (
                 SELECT COUNT(DISTINCT snapshot_mention.mention_id)::int
                 FROM tb_opportunity_findings link
                 INNER JOIN tb_findings finding
                   ON finding.id = link.finding_id
                  AND finding.tb_analysis_id = opportunity.tb_analysis_id
                 INNER JOIN tb_finding_citations citation ON citation.finding_id = link.finding_id
                 INNER JOIN corpus_snapshot_mentions snapshot_mention
                   ON snapshot_mention.mention_id = citation.mention_id
                  AND snapshot_mention.snapshot_id = $2::uuid
                 WHERE link.opportunity_id = opportunity.id
               ) AS citation_count,
               opportunity.position::int
        FROM tb_strategic_opportunities opportunity
        WHERE opportunity.tb_analysis_id = $1::uuid
        ORDER BY opportunity.position, opportunity.created_at, opportunity.id
      `,
      snapshotAnalysisParams
    ),
    pool.query<PublishedSignalActionRow>(
      `
        SELECT action.action_id,
               action.target_team,
               action.kind,
               action.title,
               COALESCE((
                 SELECT array_agg(finding.finding_id ORDER BY link.position, finding.finding_id)
                 FROM tb_action_findings link
                 INNER JOIN tb_findings finding ON finding.id = link.finding_id
                 WHERE link.action_id = action.id
                   AND finding.tb_analysis_id = action.tb_analysis_id
               ), ARRAY[]::text[]) AS finding_ids,
               primary_finding.finding_id AS primary_finding_id,
               action.rationale,
               action.action_text,
               action.suggested_channel,
               action.suggested_format,
               action.success_signal,
               action.estimated_effort,
               action.estimated_impact,
               action.confidence,
               action.priority_rank::int,
               (
                 SELECT COUNT(DISTINCT snapshot_mention.mention_id)::int
                 FROM tb_action_findings link
                 INNER JOIN tb_findings finding
                   ON finding.id = link.finding_id
                  AND finding.tb_analysis_id = action.tb_analysis_id
                 INNER JOIN tb_finding_citations citation ON citation.finding_id = link.finding_id
                 INNER JOIN corpus_snapshot_mentions snapshot_mention
                   ON snapshot_mention.mention_id = citation.mention_id
                  AND snapshot_mention.snapshot_id = $2::uuid
                 WHERE link.action_id = action.id
               ) AS citation_count
        FROM tb_action_studio action
        LEFT JOIN tb_findings primary_finding
          ON primary_finding.id = action.primary_finding_id
         AND primary_finding.tb_analysis_id = action.tb_analysis_id
        WHERE action.tb_analysis_id = $1::uuid
        ORDER BY action.priority_rank, action.created_at, action.id
      `,
      snapshotAnalysisParams
    ),
    pool.query<{
      taxonomy_key: string;
      term_key: string;
      label: string;
      count: number;
      avg_score: string | null;
    }>(
      `
        SELECT tx.taxonomy_key,
               tt.term_key,
               tt.label,
               COUNT(DISTINCT rt.subject_id)::int AS count,
               avg(rt.score)::text AS avg_score
        FROM record_tags rt
        JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
        JOIN taxonomies tx ON tx.id = tt.taxonomy_id
        JOIN corpus_snapshot_mentions csm
          ON csm.mention_id = rt.subject_id
         AND csm.snapshot_id = $2::uuid
        WHERE rt.tb_analysis_id = $1::uuid
          AND rt.subject_type = 'mention'
          AND rt.review_status <> 'rejected'
        GROUP BY tx.taxonomy_key, tt.term_key, tt.label
        ORDER BY count DESC, tx.taxonomy_key, tt.term_key
        LIMIT 100
      `,
      snapshotAnalysisParams
    ),
    pool.query<{
      feature_key: string;
      feature_value: string;
      value_type: string | null;
      count: number;
    }>(
      `
        SELECT rfv.feature_key,
               rfv.feature_value::text AS feature_value,
               rfv.value_type,
               COUNT(DISTINCT rfv.subject_id)::int AS count
        FROM record_feature_values rfv
        JOIN corpus_snapshot_mentions csm
          ON csm.mention_id = rfv.subject_id
         AND csm.snapshot_id = $2::uuid
        WHERE rfv.tb_analysis_id = $1::uuid
          AND rfv.subject_type = 'mention'
        GROUP BY rfv.feature_key, rfv.feature_value, rfv.value_type
        ORDER BY count DESC, rfv.feature_key, feature_value
        LIMIT 100
      `,
      snapshotAnalysisParams
    ),
    pool.query<{
      finding_citations: number;
      coded_mentions: number;
      tagged_mentions: number;
      featured_mentions: number;
    }>(
      `
        SELECT
          (
            SELECT COUNT(DISTINCT (fc.finding_id, fc.mention_id))::int
            FROM tb_finding_citations fc
            JOIN tb_findings tf ON tf.id = fc.finding_id
            JOIN corpus_snapshot_mentions csm
              ON csm.mention_id = fc.mention_id
             AND csm.snapshot_id = $2::uuid
            WHERE tf.tb_analysis_id = $1::uuid
          ) AS finding_citations,
          (
            SELECT COUNT(DISTINCT mc.mention_id)::int
            FROM tb_mention_codings mc
            JOIN corpus_snapshot_mentions csm
              ON csm.mention_id = mc.mention_id
             AND csm.snapshot_id = $2::uuid
            WHERE mc.tb_analysis_id = $1::uuid
          ) AS coded_mentions,
          (
            SELECT COUNT(DISTINCT rt.subject_id)::int
            FROM record_tags rt
            JOIN corpus_snapshot_mentions csm
              ON csm.mention_id = rt.subject_id
             AND csm.snapshot_id = $2::uuid
            WHERE rt.tb_analysis_id = $1::uuid
              AND rt.subject_type = 'mention'
              AND rt.review_status <> 'rejected'
          ) AS tagged_mentions,
          (
            SELECT COUNT(DISTINCT rfv.subject_id)::int
            FROM record_feature_values rfv
            JOIN corpus_snapshot_mentions csm
              ON csm.mention_id = rfv.subject_id
             AND csm.snapshot_id = $2::uuid
            WHERE rfv.tb_analysis_id = $1::uuid
              AND rfv.subject_type = 'mention'
          ) AS featured_mentions
      `,
      snapshotAnalysisParams
    ),
    args.corpusId
      ? loadSignalDataOsTimeline({
          corpusId: args.corpusId,
          outputId: args.outputId,
          requireGovernedRef: args.requireGovernedRef
        })
      : Promise.resolve(null)
  ]);

  const corpusRow = corpus.rows[0] ?? { total_mentions: 0, window_start: null, window_end: null };
  const metricsRow = signalMetrics.rows[0] ?? {
    findings_total: 0,
    triggers_total: 0,
    barriers_total: 0,
    movable_total: 0,
    opportunities_total: 0
  };
  const evidenceRow = evidence.rows[0] ?? {
    finding_citations: 0,
    coded_mentions: 0,
    tagged_mentions: 0,
    featured_mentions: 0
  };
  const totalFindingFrequency = findingsScatter.rows.reduce(
    (total, row) => total + toNumber(row.frecuencia),
    0
  );
  const relationalFindings: PublicTbFinding[] = findingsScatter.rows.map((row) => {
    const frequency = toNumber(row.frecuencia);
    return {
      finding_id: row.finding_id,
      finding_name: row.nombre,
      polarity: normalizeFindingPolarity(row.polarity),
      layer: normalizeFindingLayer(row.layer),
      mobility: normalizeFindingMobility(row.movilidad),
      confidence: normalizeOpportunityConfidence(row.confidence),
      frequency_mentions: frequency,
      intensity_score: toNumber(row.intensidad),
      predictive_capacity: row.predictive_capacity === null ? null : toNumber(row.predictive_capacity),
      composite_score: toNumber(row.score),
      share_of_findings_pct: totalFindingFrequency > 0 ? (frequency / totalFindingFrequency) * 100 : 0,
      evidence_count: toNumber(row.citation_count),
      period_start: row.period_start,
      period_end: row.period_end,
      public_quote: row.public_quote
    };
  });

  return {
    ok: true,
    contract: {
      version: SIGNAL_SERVING_CONTRACT_VERSION,
      source_of_truth: "relational",
      snapshot_id: args.snapshotId,
      analysis_id: args.analysisId,
      payload_role: "manifest_only",
      definitions: SIGNAL_SEMANTIC_DEFINITIONS
    },
    filters: { dateFrom: args.dateFrom ?? "", dateTo: args.dateTo ?? "" },
    corpus: {
      total_mentions: Number(corpusRow.total_mentions ?? 0),
      window: { start: corpusRow.window_start, end: corpusRow.window_end }
    },
    metrics: {
      findings_total: toNumber(metricsRow.findings_total),
      triggers_total: toNumber(metricsRow.triggers_total),
      barriers_total: toNumber(metricsRow.barriers_total),
      movable_total: toNumber(metricsRow.movable_total),
      opportunities_total: toNumber(metricsRow.opportunities_total),
      coded_mentions_total: toNumber(evidenceRow.coded_mentions),
      citations_total: toNumber(evidenceRow.finding_citations),
      tags_total: toNumber(evidenceRow.tagged_mentions),
      features_total: toNumber(evidenceRow.featured_mentions)
    },
    polarity_distribution: polarityDistribution.rows.map((row) => ({
      polarity: row.polarity,
      count: toNumber(row.count)
    })),
    layer_distribution: layerDistribution.rows.map((row) => ({
      layer: row.layer,
      count: toNumber(row.count),
      avg_intensity: row.avg_intensity
    })),
    mobility_distribution: normalizeMobilityDistribution(mobilityDistribution.rows),
    platform_distribution: platformDistribution.rows.map((row) => ({
      platform: row.platform,
      count: toNumber(row.count)
    })),
    content_type_distribution: contentTypeDistribution.rows.map((row) => ({
      content_type: row.content_type,
      count: toNumber(row.count)
    })),
    volume_timeline: volumeTimeline.rows.map((row) => ({
      month: row.month,
      mentions: toNumber(row.mentions)
    })),
    polarity_time_series: polarityTimeline.rows.map((row) => ({
      month: row.month,
      trigger: Number(row.trigger ?? 0),
      barrier: Number(row.barrier ?? 0)
    })),
    finding_time_series: findingTimeSeries.rows.map((row) => ({
      ...row,
      mentions: toNumber(row.mentions),
      movilidad: normalizeSignalMobility(row.movilidad)
    })),
    findings_scatter: findingsScatter.rows.map((row) => ({
      ...row,
      frecuencia: toNumber(row.frecuencia),
      citation_count: toNumber(row.citation_count),
      movilidad: normalizeSignalMobility(row.movilidad)
    })),
    findings: relationalFindings,
    top_findings_by_voice: topVoice.rows.map((row) => ({
      ...row,
      citation_count: toNumber(row.citation_count)
    })),
    top_barriers: topBarriers.rows.map((row) => ({
      ...row,
      frecuencia: toNumber(row.frecuencia),
      citation_count: toNumber(row.citation_count),
      movilidad: normalizeSignalMobility(row.movilidad)
    })),
    opportunities: mapPublishedSignalOpportunities(opportunities.rows.map((row) => ({
      ...row,
      citation_count: toNumber(row.citation_count),
      position: toNumber(row.position)
    }))),
    action_studio: mapPublishedSignalActions(actionStudio.rows.map((row) => ({
      ...row,
      priority_rank: toNumber(row.priority_rank),
      citation_count: toNumber(row.citation_count)
    }))),
    tag_distribution: tagDistribution.rows.map((row) => ({
      ...row,
      count: toNumber(row.count)
    })),
    feature_distribution: featureDistribution.rows.map((row) => ({
      ...row,
      count: toNumber(row.count)
    })),
    evidence: {
      finding_citations: toNumber(evidenceRow.finding_citations),
      coded_mentions: toNumber(evidenceRow.coded_mentions),
      tagged_mentions: toNumber(evidenceRow.tagged_mentions),
      featured_mentions: toNumber(evidenceRow.featured_mentions)
    },
    cross_source_timeline: crossSourceTimeline
  };
}
