import { pool } from "@/lib/db";

export type EngineLiveIntelligenceFindingLink = {
  finding_id: string;
  engine_finding_id: string | null;
  canonical_signal_id: string;
  signal_observation_id: string;
  signal_type: string;
  methodology_slug: string;
  title: string;
  evidence_count: number;
};

export type EngineLiveIntelligenceLinkRow = {
  finding_id: string | null;
  engine_finding_id: string | null;
  canonical_signal_id: string;
  signal_observation_id: string;
  signal_type: string;
  methodology_slug: string;
  title: string;
  evidence_count: number;
};

export type EnginePublishedOutputLiveIntelligence = {
  status: "ok" | "skipped";
  reason?: string;
  signals: number;
  observations: number;
  evidence: number;
  mappings: EngineLiveIntelligenceFindingLink[];
};

export async function loadEngineLiveIntelligenceLinks(engineAnalysisId: string) {
  const result = await pool.query<EngineLiveIntelligenceLinkRow>(
    `
      SELECT
        COALESCE(
          f.finding_key,
          cs.dimensions->>'finding_key',
          so.metrics->>'finding_key',
          cs.semantic_key
        ) AS finding_id,
        f.id::text AS engine_finding_id,
        cs.id::text AS canonical_signal_id,
        so.id::text AS signal_observation_id,
        so.signal_type,
        so.methodology_slug,
        cs.canonical_title AS title,
        COUNT(e.id)::int AS evidence_count
      FROM signal_observations so
      JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
      LEFT JOIN engine_findings f ON f.id = cs.created_from_engine_finding_id
      LEFT JOIN signal_observation_evidence e ON e.signal_observation_id = so.id
      WHERE so.engine_analysis_id = $1
      GROUP BY so.id, cs.id, f.id
      ORDER BY so.rank ASC NULLS LAST, so.composite_score DESC NULLS LAST, so.created_at ASC
    `,
    [engineAnalysisId]
  );
  return result.rows;
}

export function summarizeEngineLiveIntelligenceLinks(
  rows: EngineLiveIntelligenceLinkRow[]
): EnginePublishedOutputLiveIntelligence {
  const mappings = rows.map(buildEngineLiveIntelligenceFindingLink);
  if (mappings.length === 0) {
    return {
      status: "skipped",
      reason: "engine_observations_not_found",
      signals: 0,
      observations: 0,
      evidence: 0,
      mappings: []
    };
  }

  return {
    status: "ok",
    signals: new Set(mappings.map((item) => item.canonical_signal_id)).size,
    observations: mappings.length,
    evidence: mappings.reduce((sum, item) => sum + item.evidence_count, 0),
    mappings
  };
}

export function buildEngineLiveIntelligenceFindingLink(
  row: EngineLiveIntelligenceLinkRow
): EngineLiveIntelligenceFindingLink {
  return {
    finding_id: row.finding_id || row.canonical_signal_id,
    engine_finding_id: row.engine_finding_id,
    canonical_signal_id: row.canonical_signal_id,
    signal_observation_id: row.signal_observation_id,
    signal_type: row.signal_type,
    methodology_slug: row.methodology_slug,
    title: row.title,
    evidence_count: Number(row.evidence_count ?? 0)
  };
}
