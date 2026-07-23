import {
  signalFiltersHashV1,
  type SignalBreakdownV1,
  type SignalFilterV1,
  type SignalTimeSeriesV1,
  type SignalWorkspaceHomeV1
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

export const SIGNAL_WORKSPACE_HOME_FIXTURE_V1 = {
  contract_version: "signal-backend-v1",
  facade_version: "signal-workspace-home-v1",
  workspace: {
    workspace_id: SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
    workspace_slug: "fixture-brand",
    organization_id: SIGNAL_WORKSPACE_FIXTURE_IDS.organization,
    subject: { type: "brand", id: SIGNAL_WORKSPACE_FIXTURE_IDS.brand },
    timezone: "America/Mexico_City",
    status: "active"
  },
  corpus: {
    id: SIGNAL_WORKSPACE_FIXTURE_IDS.corpus,
    role: "operational",
    status: "corpus_approved",
    name: "Fixture Signal corpus"
  },
  coverage: {
    date_from: "2026-06-01",
    date_through: "2026-06-30",
    mentions: 128
  },
  default_filter: SIGNAL_FILTER_FIXTURE_V1,
  filters_hash: SIGNAL_SERIES_FIXTURE_V1.filters_hash,
  capabilities: [
    { key: "facets", state: "available", href: `/api/data-os/signal/${SIGNAL_WORKSPACE_FIXTURE_IDS.workspace}/facets` },
    { key: "metric_groups", state: "available", href: `/api/data-os/signal/${SIGNAL_WORKSPACE_FIXTURE_IDS.workspace}/metric-groups` },
    { key: "drill_down", state: "available", href: `/api/data-os/signal/${SIGNAL_WORKSPACE_FIXTURE_IDS.workspace}/mentions` },
    { key: "interpretations", state: "available", href: `/api/data-os/signal/${SIGNAL_WORKSPACE_FIXTURE_IDS.workspace}/interpretations` },
    { key: "strategic_releases", state: "available", href: `/api/data-os/signal/${SIGNAL_WORKSPACE_FIXTURE_IDS.workspace}/releases` }
  ],
  facets: {
    platform: [
      { key: "instagram", count: 80 },
      { key: "tiktok", count: 48 }
    ]
  },
  freshness: {
    overall_state: "partial",
    data: { state: "fresh", data_through_at: watermark.data_through_at },
    interpretation: { state: "partial", reason: "human_review_required" }
  },
  metric_groups: [{
    key: "conversation_volume_velocity",
    name: "Conversation volume and velocity",
    metrics: [{ key: "conversation.volume", version: 1, state: "fresh" }]
  }],
  interpretations: [{
    metric_group_key: "conversation_volume_velocity",
    metric_group_version: 1,
    state: "partial",
    review_status: "needs_review",
    interpretation: null
  }],
  strategic: {
    current: {
      release_id: "70000000-0000-4000-8000-000000000001",
      title: "Strategic release · Q2 2026",
      status: "published",
      period_start: "2026-04-01",
      period_end: "2026-06-30"
    },
    history: []
  },
  visibility: { internal: false, source_type: false, quality_details: false },
  lineage: [{
    materialization_key: "sha256:fixture",
    metric_key: "conversation.volume",
    metric_version: 1,
    data_watermark_hash: "sha256:fixture-watermark",
    state: "fresh"
  }],
  partial_states: [{
    section: "interpretations",
    state: "partial",
    reason: "interpretations_not_fresh"
  }],
  legacy_fallback: {
    identity: "outputId",
    dashboard_route_template: "/signal/{outputId}",
    api_route_template: "/api/data-os/pulse/{outputId}/*",
    source_of_truth: false
  },
  state: "partial"
} as const satisfies SignalWorkspaceHomeV1;
