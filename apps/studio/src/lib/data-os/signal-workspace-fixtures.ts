import {
  signalFiltersHashV1,
  type SignalBreakdownV1,
  type SignalFilterV1,
  type SignalTimeSeriesV1
} from "@noisia/query-engine";

export const SIGNAL_WORKSPACE_FIXTURE_IDS = {
  organization: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000001",
  brand: "30000000-0000-4000-8000-000000000001",
  corpus: "40000000-0000-4000-8000-000000000001",
  sync: "50000000-0000-4000-8000-000000000001"
} as const;

export const SIGNAL_FILTER_FIXTURE_V1: SignalFilterV1 = {
  contract_version: "signal-backend-v1",
  date_range: { start: "2026-06-01", end: "2026-06-30" },
  timezone: "America/Mexico_City",
  granularity: "month",
  dimensions: { platform: ["instagram"] }
};

const watermark = {
  contract_version: "signal-backend-v1" as const,
  workspace_id: SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
  corpus_id: SIGNAL_WORKSPACE_FIXTURE_IDS.corpus,
  corpus_revision: 3,
  source_sync_run_ids: [],
  data_through_at: "2026-06-30T23:59:00.000Z",
  accepted_at: "2026-07-01T01:00:00.000Z",
  materialized_at: "2026-07-01T01:05:00.000Z"
};

export const SIGNAL_SERIES_FIXTURE_V1: SignalTimeSeriesV1 = {
  contract_version: "signal-backend-v1",
  metric_key: "conversation.volume",
  metric_version: 1,
  filters_hash: signalFiltersHashV1(SIGNAL_FILTER_FIXTURE_V1),
  granularity: "month",
  watermark,
  freshness: {
    state: "fresh",
    evaluated_at: "2026-07-01T01:05:00.000Z",
    stale_after: "2026-07-02T01:00:00.000Z",
    watermark,
    reason: null
  },
  points: [{
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    value: 128,
    denominator: null,
    sample_size: 128,
    state: "available"
  }]
};

export const SIGNAL_BREAKDOWN_FIXTURE_V1: SignalBreakdownV1 = {
  contract_version: "signal-backend-v1",
  metric_key: "platform.share",
  metric_version: 1,
  filters_hash: SIGNAL_SERIES_FIXTURE_V1.filters_hash,
  dimension: "platform",
  watermark,
  freshness: SIGNAL_SERIES_FIXTURE_V1.freshness,
  buckets: [
    { key: "instagram", label: "instagram", value: 0.625, denominator: 128, sample_size: 80, state: "available" },
    { key: "tiktok", label: "tiktok", value: 0.375, denominator: 128, sample_size: 48, state: "available" }
  ]
};

export const SIGNAL_DRILL_DOWN_FIXTURE_V1 = {
  contract_version: "signal-backend-v1" as const,
  metric_key: "conversation.volume",
  filters_hash: SIGNAL_SERIES_FIXTURE_V1.filters_hash,
  records: [{
    subject_id: "60000000-0000-4000-8000-000000000001",
    occurred_at: "2026-06-30T20:00:00.000Z",
    text_snippet: "La conversación creció durante el lanzamiento.",
    title: null,
    url: "https://example.test/mention/1",
    platform: "instagram",
    language: "es",
    country: "mx"
  }],
  page: { limit: 50, next_cursor: null }
};
