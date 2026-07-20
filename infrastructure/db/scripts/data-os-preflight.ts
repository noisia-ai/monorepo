import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type PreflightRow = {
  output_id: string;
  output_title: string;
  output_status: string;
  output_kind: string;
  output_methodology_slug: string;
  study_corpus_id: string;
  corpus_name: string | null;
  corpus_methodology_slug: string;
  brand_id: string | null;
  theme_id: string | null;
  payload: unknown;
  total_mentions: number;
  included_mentions: number;
  data_sources: number;
  active_data_sources: number;
  processed_knowledge_sources: number;
  performance_records: number;
  report_periods: number;
  canonical_signals: number;
  signal_period_metrics: number;
  chart_aggregates: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function chartRefCount(payload: Record<string, unknown>) {
  return Object.keys(asRecord(payload.chart_refs)).length;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function addMinimumFailure(failures: string[], label: string, actual: number, minimum: number) {
  if (actual < minimum) failures.push(`${label} expected >= ${minimum}, found ${actual}`);
}

async function loadPreflight(client: pg.Client, corpusId: string, outputId: string) {
  const result = await client.query<PreflightRow>(
    `
      SELECT
        po.id AS output_id,
        po.title AS output_title,
        po.status AS output_status,
        po.kind AS output_kind,
        po.methodology_slug AS output_methodology_slug,
        po.study_corpus_id,
        sc.name AS corpus_name,
        m.slug AS corpus_methodology_slug,
        po.brand_id,
        po.theme_id,
        po.payload,
        (SELECT count(*)::int FROM mentions mn WHERE mn.study_corpus_id = sc.id) AS total_mentions,
        (
          SELECT count(*)::int
          FROM mentions mn
          WHERE mn.study_corpus_id = sc.id
            AND mn.inclusion_status = 'included'
        ) AS included_mentions,
        (SELECT count(*)::int FROM data_sources ds WHERE ds.study_corpus_id = sc.id) AS data_sources,
        (
          SELECT count(*)::int
          FROM data_sources ds
          WHERE ds.study_corpus_id = sc.id
            AND ds.status = 'active'
        ) AS active_data_sources,
        (
          SELECT count(*)::int
          FROM brand_knowledge_sources bks
          WHERE bks.status IN ('processed', 'processed_truncated')
            AND (
              bks.study_corpus_id = sc.id
              OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS processed_knowledge_sources,
        (SELECT count(*)::int FROM performance_records pr WHERE pr.study_corpus_id = sc.id) AS performance_records,
        (SELECT count(*)::int FROM report_periods rp WHERE rp.study_corpus_id = sc.id) AS report_periods,
        (
          SELECT count(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = sc.id
            AND cs.methodology_slug = 'signal-pulse'
        ) AS canonical_signals,
        (SELECT count(*)::int FROM signal_period_metrics spm WHERE spm.study_corpus_id = sc.id) AS signal_period_metrics,
        (SELECT count(*)::int FROM chart_aggregates ca WHERE ca.study_corpus_id = sc.id) AS chart_aggregates
      FROM published_outputs po
      JOIN study_corpora sc ON sc.id = po.study_corpus_id
      JOIN methodologies m ON m.id = sc.methodology_id
      WHERE po.id = $1
        AND sc.id = $2
    `,
    [outputId, corpusId]
  );

  return result.rows[0] ?? null;
}

function audit(row: PreflightRow, corpusId: string, outputId: string) {
  const payload = asRecord(row.payload);
  const payloadCounts = {
    periods: arrayCount(payload.periods),
    signals: arrayCount(payload.signals),
    chart_refs: chartRefCount(payload)
  };
  const liveCounts = {
    total_mentions: numberValue(row.total_mentions),
    included_mentions: numberValue(row.included_mentions),
    data_sources: numberValue(row.data_sources),
    active_data_sources: numberValue(row.active_data_sources),
    processed_knowledge_sources: numberValue(row.processed_knowledge_sources),
    performance_records: numberValue(row.performance_records),
    report_periods: numberValue(row.report_periods),
    canonical_signals: numberValue(row.canonical_signals),
    signal_period_metrics: numberValue(row.signal_period_metrics),
    chart_aggregates: numberValue(row.chart_aggregates)
  };

  const failures: string[] = [];
  const warnings: string[] = [];

  if (row.output_id !== outputId) failures.push(`Loaded output mismatch: ${row.output_id} !== ${outputId}`);
  if (row.study_corpus_id !== corpusId) failures.push(`Loaded corpus mismatch: ${row.study_corpus_id} !== ${corpusId}`);
  if (row.output_kind !== "signal_pulse" || row.output_methodology_slug !== "signal-pulse") {
    failures.push(`Output must be Signal Pulse; found methodology=${row.output_methodology_slug}, kind=${row.output_kind}`);
  }
  if (row.corpus_methodology_slug !== "signal-pulse") {
    failures.push(`Corpus methodology must be signal-pulse; found ${row.corpus_methodology_slug}`);
  }
  if (!["published", "draft", "ready"].includes(row.output_status)) {
    warnings.push(`Output status is ${row.output_status}; expected published/draft/ready for rollout QA.`);
  }

  addMinimumFailure(failures, "payload.periods", payloadCounts.periods, 1);
  addMinimumFailure(failures, "payload.signals", payloadCounts.signals, 1);
  addMinimumFailure(failures, "included_mentions", liveCounts.included_mentions, 1);
  addMinimumFailure(failures, "report_periods", liveCounts.report_periods, 1);
  addMinimumFailure(failures, "canonical_signals", liveCounts.canonical_signals, 1);
  addMinimumFailure(failures, "signal_period_metrics", liveCounts.signal_period_metrics, 1);

  if (liveCounts.data_sources === 0) warnings.push("No data_sources rows are registered for this corpus yet.");
  if (liveCounts.active_data_sources === 0) warnings.push("No active data_sources rows are registered for this corpus yet.");
  if (liveCounts.processed_knowledge_sources === 0) warnings.push("No processed Knowledge Base source exists for this output scope.");
  if (liveCounts.performance_records === 0) warnings.push("No structured performance_records exist for this corpus.");
  if (payloadCounts.chart_refs > 0 && liveCounts.chart_aggregates < payloadCounts.chart_refs) {
    warnings.push(`Live chart_aggregates (${liveCounts.chart_aggregates}) are fewer than payload chart_refs (${payloadCounts.chart_refs}).`);
  }

  return {
    payload: payloadCounts,
    live: liveCounts,
    warnings,
    failures,
    ready_for_backfill: failures.length === 0,
    ready_for_shadow_qa: failures.length === 0
  };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = requireEnv("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const outputId = requireEnv("NOISIA_DATA_OS_SHADOW_OUTPUT_ID");
  const strict = process.env.NOISIA_DATA_OS_PREFLIGHT_STRICT === "true";
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "data-os:preflight",
    allowRemoteEnv: "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const row = await loadPreflight(client, corpusId, outputId);
    if (!row) {
      throw new Error(`No Signal Pulse output/corpus pair found for output=${outputId}, corpus=${corpusId}`);
    }
    const result = audit(row, corpusId, outputId);
    console.log(JSON.stringify({
      ok: result.failures.length === 0 && (!strict || result.warnings.length === 0),
      output: {
        id: row.output_id,
        title: row.output_title,
        status: row.output_status,
        corpus_id: row.study_corpus_id,
        brand_id: row.brand_id,
        theme_id: row.theme_id
      },
      ...result
    }, null, 2));

    if (result.failures.length > 0 || (strict && result.warnings.length > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
