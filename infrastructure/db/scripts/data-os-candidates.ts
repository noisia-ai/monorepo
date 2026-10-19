import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type CandidateRow = {
  output_id: string;
  output_title: string;
  output_status: string;
  output_updated_at: string;
  output_published_at: string | null;
  study_corpus_id: string;
  corpus_name: string | null;
  corpus_status: string;
  brand_id: string | null;
  brand_name: string | null;
  theme_id: string | null;
  theme_name: string | null;
  payload_periods: number;
  payload_signals: number;
  payload_chart_refs: number;
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
  data_os_assets: number;
  data_os_tags: number;
  data_os_dashboard_refs: number;
};

function parsePositiveInteger(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

async function loadCandidates(client: pg.Client, options: { limit: number; minimumIncludedMentions: number }) {
  const result = await client.query<CandidateRow>(
    `
      SELECT
        po.id AS output_id,
        po.title AS output_title,
        po.status AS output_status,
        po.updated_at::text AS output_updated_at,
        po.published_at::text AS output_published_at,
        po.study_corpus_id,
        sc.name AS corpus_name,
        sc.status AS corpus_status,
        po.brand_id,
        COALESCE(b.display_name, b.name) AS brand_name,
        po.theme_id,
        t.name AS theme_name,
        jsonb_array_length(
          CASE WHEN jsonb_typeof(po.payload->'periods') = 'array' THEN po.payload->'periods' ELSE '[]'::jsonb END
        )::int AS payload_periods,
        jsonb_array_length(
          CASE WHEN jsonb_typeof(po.payload->'signals') = 'array' THEN po.payload->'signals' ELSE '[]'::jsonb END
        )::int AS payload_signals,
        (
          SELECT count(*)::int
          FROM jsonb_object_keys(
            CASE WHEN jsonb_typeof(po.payload->'chart_refs') = 'object' THEN po.payload->'chart_refs' ELSE '{}'::jsonb END
          )
        ) AS payload_chart_refs,
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
        (SELECT count(*)::int FROM chart_aggregates ca WHERE ca.study_corpus_id = sc.id) AS chart_aggregates,
        (SELECT count(*)::int FROM data_assets da WHERE da.study_corpus_id = sc.id) AS data_os_assets,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.subject_type IN ('mention', 'canonical_signal', 'performance_record')
            AND rt.subject_id IN (
              SELECT mn.id FROM mentions mn WHERE mn.study_corpus_id = sc.id
              UNION
              SELECT cs.id FROM canonical_signals cs WHERE cs.study_corpus_id = sc.id
              UNION
              SELECT pr.id FROM performance_records pr WHERE pr.study_corpus_id = sc.id
            )
        ) AS data_os_tags,
        (SELECT count(*)::int FROM dashboard_data_refs ddr WHERE ddr.output_id = po.id) AS data_os_dashboard_refs
      FROM published_outputs po
      JOIN study_corpora sc ON sc.id = po.study_corpus_id
      JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN brands b ON b.id = po.brand_id
      LEFT JOIN themes t ON t.id = po.theme_id
      WHERE po.kind = 'signal_pulse'
        AND po.methodology_slug = 'signal-pulse'
        AND m.slug = 'signal-pulse'
        AND po.archived_at IS NULL
      ORDER BY
        (po.status = 'published') DESC,
        po.published_at DESC NULLS LAST,
        po.updated_at DESC
      LIMIT $1
    `,
    [options.limit]
  );

  return result.rows.filter((row) => numberValue(row.included_mentions) >= options.minimumIncludedMentions);
}

function buildAudit(row: CandidateRow, minimumIncludedMentions: number) {
  const payload = {
    periods: numberValue(row.payload_periods),
    signals: numberValue(row.payload_signals),
    chart_refs: numberValue(row.payload_chart_refs)
  };
  const live = {
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
  const existingDataOs = {
    assets: numberValue(row.data_os_assets),
    tags: numberValue(row.data_os_tags),
    dashboard_refs: numberValue(row.data_os_dashboard_refs)
  };

  const failures: string[] = [];
  const warnings: string[] = [];

  if (row.output_status !== "published") warnings.push(`Output status is ${row.output_status}; prefer published for first shadow QA.`);
  if (payload.periods < 1) failures.push("payload.periods expected >= 1");
  if (payload.signals < 1) failures.push("payload.signals expected >= 1");
  if (live.included_mentions < minimumIncludedMentions) {
    failures.push(`included_mentions expected >= ${minimumIncludedMentions}, found ${live.included_mentions}`);
  }
  if (live.report_periods < 1) failures.push("report_periods expected >= 1");
  if (live.canonical_signals < 1) failures.push("canonical_signals expected >= 1");
  if (live.signal_period_metrics < 1) failures.push("signal_period_metrics expected >= 1");
  if (live.data_sources === 0) warnings.push("No data_sources rows registered.");
  if (live.active_data_sources === 0) warnings.push("No active data_sources rows registered.");
  if (live.processed_knowledge_sources === 0) warnings.push("No processed Knowledge Base source exists for this output scope.");
  if (live.performance_records === 0) warnings.push("No structured performance_records exist for this corpus.");
  if (payload.chart_refs > 0 && live.chart_aggregates < payload.chart_refs) {
    warnings.push(`Live chart_aggregates (${live.chart_aggregates}) are fewer than payload chart_refs (${payload.chart_refs}).`);
  }
  if (existingDataOs.assets > 0 || existingDataOs.dashboard_refs > 0) {
    warnings.push("Data OS rows already exist for this corpus/output; rerun is idempotent but not a first-touch candidate.");
  }

  const score = Math.max(0, 100 - failures.length * 25 - warnings.length * 5);

  return {
    score,
    payload,
    live,
    existing_data_os: existingDataOs,
    warnings,
    failures,
    ready_for_preflight: failures.length === 0,
    ready_for_backfill: failures.length === 0,
    ready_for_shadow_qa: failures.length === 0
  };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const limit = parsePositiveInteger(process.env.NOISIA_DATA_OS_CANDIDATES_LIMIT, 10, 50);
  const minimumIncludedMentions = parsePositiveInteger(process.env.NOISIA_DATA_OS_CANDIDATES_MIN_INCLUDED, 1, 1000);
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "data-os:candidates",
    allowRemoteEnv: "NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const rows = await loadCandidates(client, { limit, minimumIncludedMentions });
    const candidates = rows
      .map((row) => {
        const audit = buildAudit(row, minimumIncludedMentions);
        return {
          output: {
            id: row.output_id,
            title: row.output_title,
            status: row.output_status,
            published_at: row.output_published_at,
            updated_at: row.output_updated_at
          },
          corpus: {
            id: row.study_corpus_id,
            name: row.corpus_name,
            status: row.corpus_status
          },
          subject: {
            brand_id: row.brand_id,
            brand_name: row.brand_name,
            theme_id: row.theme_id,
            theme_name: row.theme_name
          },
          ...audit,
          env: {
            NOISIA_DATA_OS_BACKFILL_CORPUS_ID: row.study_corpus_id,
            NOISIA_DATA_OS_SHADOW_OUTPUT_ID: row.output_id
          }
        };
      })
      .sort((a, b) => b.score - a.score || Date.parse(b.output.updated_at) - Date.parse(a.output.updated_at));

    console.log(JSON.stringify({
      ok: true,
      limit,
      minimum_included_mentions: minimumIncludedMentions,
      candidates,
      recommended: candidates[0] ?? null
    }, null, 2));

    if (candidates.length === 0) {
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
