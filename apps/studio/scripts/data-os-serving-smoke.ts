import {
  applyPulseLiveVisibility,
  disabledDataOsResponse,
  disabledSignalPulseLiveResponse,
  getDataOsBrandOs,
  getDataOsCatalog,
  getDataOsKnowledge,
  getDataOsReviewQueue,
  getDataOsSourceHealth,
  getPulseLiveData,
  isDataOsServingEnabled,
  isSignalPulseLiveApiEnabled,
  listDataOsLineage,
  listDataOsSources,
  listDataOsTags,
  listDataOsTaxonomies,
  listPulseLiveCorpus,
  listPulseLiveMetrics
} from "../src/lib/data-os/serving";
import { pool } from "../src/lib/db";

type JsonRecord = Record<string, unknown>;
type PayloadCounts = {
  dashboardRefs: number;
  periods: number;
  signals: number;
};

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_REMOTE_DATABASE_TARGETS = new Set(["staging", "throwaway", "preview"]);

const CLIENT_DEFAULT_VISIBILITY = {
  showPaidOrganic: false,
  showCompetitive: true,
  showEvidence: true,
  showComposer: false,
  showCorpus: false,
  showSources: false,
  showQuality: false,
  showRawMetadata: false
};

const INTERNAL_VISIBILITY = {
  showPaidOrganic: true,
  showCompetitive: true,
  showEvidence: true,
  showComposer: true,
  showCorpus: true,
  showSources: true,
  showQuality: true,
  showRawMetadata: true
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isLocalDatabaseUrl(databaseUrl: string) {
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

function requireSafeDatabaseReadTarget(databaseUrl: string) {
  if (isLocalDatabaseUrl(databaseUrl)) {
    return;
  }

  const parsed = new URL(databaseUrl);
  if (process.env.NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE === "true") {
    const target = process.env.NOISIA_REMOTE_DATABASE_TARGET?.trim().toLowerCase();
    if (target && ALLOWED_REMOTE_DATABASE_TARGETS.has(target)) return;

    throw new Error(
      [
        "Refusing to run data-os:serving-smoke against a non-local database without a confirmed remote target.",
        `Host: ${parsed.hostname}`,
        "Set NOISIA_REMOTE_DATABASE_TARGET=staging, throwaway or preview after confirming DATABASE_URL is not production."
      ].join(" ")
    );
  }

  throw new Error(
    [
      "Refusing to run data-os:serving-smoke against a non-local database.",
      `Host: ${parsed.hostname}`,
      "Set NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true only for an isolated staging/throwaway database after confirming the target."
    ].join(" ")
  );
}

function addMinimumFailure(failures: string[], label: string, actual: number, minimum: number) {
  if (actual < minimum) failures.push(`${label} expected >= ${minimum}, found ${actual}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dashboardRefs(data: { dashboard_data_refs?: unknown }) {
  return Array.isArray(data.dashboard_data_refs) ? data.dashboard_data_refs : [];
}

function buildLivePayloadParity(live: PayloadCounts, payload: PayloadCounts) {
  const deltas = {
    dashboard_refs: live.dashboardRefs - payload.dashboardRefs,
    periods: live.periods - payload.periods,
    signals: live.signals - payload.signals
  };
  return {
    live_behind_payload: deltas.periods < 0 || deltas.signals < 0 || deltas.dashboard_refs < 0,
    live_counts: {
      dashboard_refs: live.dashboardRefs,
      periods: live.periods,
      signals: live.signals
    },
    payload_counts: {
      dashboard_refs: payload.dashboardRefs,
      periods: payload.periods,
      signals: payload.signals
    },
    deltas
  };
}

function isInternalDashboardRef(ref: unknown) {
  if (!isRecord(ref)) return false;
  const visibility = ref.visibility;
  return isRecord(visibility) && visibility.internal === true;
}

function isHiddenSection(value: unknown, section: string) {
  return isRecord(value) &&
    value.status === "hidden" &&
    value.section === section &&
    value.reason === "visibility_config" &&
    value.fallback === "published_outputs.payload";
}

async function verifyFallbackResponses() {
  const dataOs = disabledDataOsResponse();
  const dataOsBody = await dataOs.json() as { fallback?: unknown };
  const signalPulse = disabledSignalPulseLiveResponse();
  const signalPulseBody = await signalPulse.json() as { fallback?: unknown };

  return {
    data_os_disabled_status: dataOs.status,
    data_os_disabled_fallback: dataOsBody.fallback,
    data_os_disabled_ready: dataOs.status === 503 && dataOsBody.fallback === "published_outputs.payload",
    signal_pulse_live_disabled_status: signalPulse.status,
    signal_pulse_live_disabled_fallback: signalPulseBody.fallback,
    signal_pulse_live_disabled_ready:
      signalPulse.status === 503 && signalPulseBody.fallback === "published_outputs.payload"
  };
}

async function loadPublishedPayloadCounts(outputId: string, corpusId: string): Promise<PayloadCounts> {
  const result = await pool.query(
    `
      SELECT
        jsonb_array_length(
          CASE WHEN jsonb_typeof(payload->'periods') = 'array' THEN payload->'periods' ELSE '[]'::jsonb END
        )::int AS payload_periods,
        jsonb_array_length(
          CASE WHEN jsonb_typeof(payload->'signals') = 'array' THEN payload->'signals' ELSE '[]'::jsonb END
        )::int AS payload_signals,
        (
          SELECT count(*)::int
          FROM jsonb_object_keys(
            CASE WHEN jsonb_typeof(payload->'chart_refs') = 'object' THEN payload->'chart_refs' ELSE '{}'::jsonb END
          )
        ) AS payload_dashboard_refs
      FROM published_outputs
      WHERE id = $1
        AND study_corpus_id = $2
    `,
    [outputId, corpusId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Signal Pulse output/corpus pair not found for serving smoke payload parity.");
  return {
    dashboardRefs: Number(row.payload_dashboard_refs ?? 0),
    periods: Number(row.payload_periods ?? 0),
    signals: Number(row.payload_signals ?? 0)
  };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = requireEnv("NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID");
  const outputId = requireEnv("NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID");
  requireSafeDatabaseReadTarget(databaseUrl);

  const failures: string[] = [];
  if (!isDataOsServingEnabled()) {
    failures.push("NOISIA_DATA_OS_ENABLED and NOISIA_DATA_OS_SERVING_ENABLED must be true.");
  }
  if (!isSignalPulseLiveApiEnabled()) {
    failures.push("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED must be true.");
  }

  const sources = await listDataOsSources(corpusId);
  const sourceHealth = await getDataOsSourceHealth(corpusId);
  const catalog = await getDataOsCatalog(corpusId);
  const lineage = await listDataOsLineage(corpusId, { limit: 50 });
  const brandOs = await getDataOsBrandOs(corpusId);
  const knowledge = await getDataOsKnowledge(corpusId, { limit: 25 });
  const reviewQueue = await getDataOsReviewQueue(corpusId, { limit: 25 });
  const taxonomies = await listDataOsTaxonomies(corpusId);
  const tags = await listDataOsTags(corpusId, { limit: 25 });
  const live = await getPulseLiveData(outputId, corpusId);
  const payloadCounts = await loadPublishedPayloadCounts(outputId, corpusId);
  const clientLive = applyPulseLiveVisibility(live, CLIENT_DEFAULT_VISIBILITY);
  const internalLive = applyPulseLiveVisibility(live, INTERNAL_VISIBILITY);
  const metrics = await listPulseLiveMetrics(corpusId, { limit: 25 });
  const corpus = await listPulseLiveCorpus(corpusId, { limit: 25 });
  const fallbackChecks = await verifyFallbackResponses();
  const rawDashboardRefs = dashboardRefs(live);
  const clientDashboardRefs = dashboardRefs(clientLive);
  const internalDashboardRefs = dashboardRefs(internalLive);
  const internalOnlyDashboardRefs = rawDashboardRefs.filter(isInternalDashboardRef).length;
  const livePayloadParity = buildLivePayloadParity(
    {
      dashboardRefs: rawDashboardRefs.length,
      periods: live.periods.length,
      signals: live.signals.length
    },
    payloadCounts
  );
  const visibilityChecks = {
    client_source_health_hidden: isHiddenSection(clientLive.source_health, "source_health"),
    client_internal_dashboard_refs_hidden:
      internalOnlyDashboardRefs === 0 || clientDashboardRefs.every((ref) => !isInternalDashboardRef(ref)),
    internal_source_health_visible: !isHiddenSection(internalLive.source_health, "source_health"),
    internal_dashboard_refs_preserved: internalDashboardRefs.length === rawDashboardRefs.length
  };

  const counts = {
    sources: sources.length,
    source_health_assets: Number(sourceHealth.summary.assets ?? 0),
    source_health_fields: sourceHealth.assets.reduce((sum, asset) => sum + Number(asset.field_count ?? 0), 0),
    source_health_assets_without_fields: sourceHealth.assets.filter((asset) => Number(asset.field_count ?? 0) === 0).length,
    source_health_failed: Number(sourceHealth.summary.failed ?? 0),
    catalog_assets: catalog.counts.assets,
    catalog_fields: catalog.counts.fields,
    catalog_contracts: catalog.counts.contracts,
    catalog_quality_results: catalog.counts.quality_results,
    catalog_assets_without_fields: catalog.counts.assets_without_fields,
    catalog_failed_quality: catalog.counts.failed_quality,
    lineage_edges: lineage.lineage_edges.length,
    brand_os_profiles: brandOs.counts.profiles,
    brand_os_objectives: brandOs.counts.objectives,
    brand_os_briefs: Number(brandOs.counts.briefs ?? 0),
    brand_os_links: Number(brandOs.counts.links ?? 0),
    brand_os_seed_terms: brandOs.counts.seed_terms,
    knowledge_sources: knowledge.counts.sources,
    knowledge_chunks: knowledge.counts.chunks,
    knowledge_assertions: knowledge.counts.assertions,
    knowledge_assertion_links: Number(knowledge.counts.assertion_links ?? 0),
    knowledge_usage_events: Number(knowledge.counts.usage_events ?? 0),
    review_queue_tags: reviewQueue.tags.length,
    review_queue_tag_taxonomies: Number(reviewQueue.summary.record_tag_taxonomies ?? 0),
    review_queue_tag_review_events: Number(reviewQueue.summary.tag_review_events ?? 0),
    review_queue_tags_with_evidence: Number(reviewQueue.summary.record_tags_with_evidence ?? 0),
    review_queue_assertions: reviewQueue.assertions.length,
    review_queue_assertion_review_events: Number(reviewQueue.summary.knowledge_assertion_review_events ?? 0),
    review_queue_assertions_with_evidence: Number(reviewQueue.summary.knowledge_assertions_with_evidence ?? 0),
    review_queue_ready_for_human_review: reviewQueue.summary.ready_for_human_review === true,
    review_queue_required_before_client_visible: reviewQueue.summary.required_before_client_visible === true,
    taxonomies: taxonomies.taxonomies.length,
    tags: tags.tags.length,
    periods: live.periods.length,
    signals: live.signals.length,
    payload_periods: livePayloadParity.payload_counts.periods,
    payload_signals: livePayloadParity.payload_counts.signals,
    payload_dashboard_refs: livePayloadParity.payload_counts.dashboard_refs,
    live_payload_period_delta: livePayloadParity.deltas.periods,
    live_payload_signal_delta: livePayloadParity.deltas.signals,
    live_payload_dashboard_ref_delta: livePayloadParity.deltas.dashboard_refs,
    live_behind_payload: livePayloadParity.live_behind_payload,
    dashboard_data_refs: rawDashboardRefs.length,
    internal_only_dashboard_data_refs: internalOnlyDashboardRefs,
    client_visible_dashboard_data_refs: clientDashboardRefs.length,
    internal_visible_dashboard_data_refs: internalDashboardRefs.length,
    metrics: metrics.metrics.length,
    mentions: corpus.mentions.length
  };

  addMinimumFailure(failures, "sources", counts.sources, 1);
  addMinimumFailure(failures, "source_health_assets", counts.source_health_assets, 1);
  addMinimumFailure(failures, "source_health_fields", counts.source_health_fields, 50);
  addMinimumFailure(failures, "catalog_assets", counts.catalog_assets, 10);
  addMinimumFailure(failures, "catalog_fields", counts.catalog_fields, 50);
  addMinimumFailure(failures, "catalog_contracts", counts.catalog_contracts, 10);
  addMinimumFailure(failures, "catalog_quality_results", counts.catalog_quality_results, 10);
  addMinimumFailure(failures, "lineage_edges", counts.lineage_edges, 9);
  addMinimumFailure(failures, "brand_os_profiles", counts.brand_os_profiles, 1);
  addMinimumFailure(failures, "brand_os_objectives", counts.brand_os_objectives, 1);
  addMinimumFailure(failures, "brand_os_briefs", counts.brand_os_briefs, 1);
  addMinimumFailure(failures, "brand_os_links", counts.brand_os_links, 3);
  addMinimumFailure(failures, "brand_os_seed_terms", counts.brand_os_seed_terms, 1);
  addMinimumFailure(failures, "knowledge_sources", counts.knowledge_sources, 1);
  addMinimumFailure(failures, "knowledge_chunks", counts.knowledge_chunks, 1);
  addMinimumFailure(failures, "knowledge_assertions", counts.knowledge_assertions, 1);
  addMinimumFailure(failures, "knowledge_assertion_links", counts.knowledge_assertion_links, 3);
  addMinimumFailure(failures, "knowledge_usage_events", counts.knowledge_usage_events, 3);
  addMinimumFailure(failures, "review_queue_tags", counts.review_queue_tags, 1);
  addMinimumFailure(failures, "review_queue_tag_taxonomies", counts.review_queue_tag_taxonomies, 5);
  addMinimumFailure(failures, "review_queue_tags_with_evidence", counts.review_queue_tags_with_evidence, counts.tags);
  addMinimumFailure(failures, "review_queue_assertions", counts.review_queue_assertions, 1);
  addMinimumFailure(
    failures,
    "review_queue_assertions_with_evidence",
    counts.review_queue_assertions_with_evidence,
    counts.knowledge_assertions
  );
  addMinimumFailure(failures, "taxonomies", counts.taxonomies, 10);
  addMinimumFailure(failures, "tags", counts.tags, 1);
  addMinimumFailure(failures, "periods", counts.periods, 1);
  addMinimumFailure(failures, "signals", counts.signals, 1);
  addMinimumFailure(failures, "dashboard_data_refs", counts.dashboard_data_refs, 4);
  addMinimumFailure(failures, "metrics", counts.metrics, 1);
  addMinimumFailure(failures, "mentions", counts.mentions, 1);
  if (counts.source_health_assets_without_fields > 0) {
    failures.push(`source_health_assets_without_fields expected 0, found ${counts.source_health_assets_without_fields}`);
  }
  if (counts.source_health_failed > 0) failures.push(`source_health_failed expected 0, found ${counts.source_health_failed}`);
  if (counts.catalog_assets_without_fields > 0) {
    failures.push(`catalog_assets_without_fields expected 0, found ${counts.catalog_assets_without_fields}`);
  }
  if (counts.catalog_failed_quality > 0) failures.push(`catalog_failed_quality expected 0, found ${counts.catalog_failed_quality}`);
  if (!fallbackChecks.data_os_disabled_ready) {
    failures.push("Data OS disabled response must return 503 with published_outputs.payload fallback.");
  }
  if (!fallbackChecks.signal_pulse_live_disabled_ready) {
    failures.push("Signal Pulse live disabled response must return 503 with published_outputs.payload fallback.");
  }
  if (!visibilityChecks.client_source_health_hidden) {
    failures.push("Client-default Signal Pulse live view must hide source_health with published_outputs.payload fallback.");
  }
  if (!visibilityChecks.client_internal_dashboard_refs_hidden) {
    failures.push("Client-default Signal Pulse live view must hide internal dashboard_data_refs.");
  }
  if (!visibilityChecks.internal_source_health_visible) {
    failures.push("Internal Signal Pulse live view must keep source_health visible.");
  }
  if (!visibilityChecks.internal_dashboard_refs_preserved) {
    failures.push("Internal Signal Pulse live view must preserve dashboard_data_refs.");
  }
  if (livePayloadParity.live_behind_payload) {
    failures.push(
      `Signal Pulse live DB is behind published payload: periods_delta=${livePayloadParity.deltas.periods}, signals_delta=${livePayloadParity.deltas.signals}, dashboard_refs_delta=${livePayloadParity.deltas.dashboard_refs}.`
    );
  }
  if (!counts.review_queue_ready_for_human_review) failures.push("Review queue must be ready for human review.");
  if (!counts.review_queue_required_before_client_visible) {
    failures.push("Review queue must be required before client-visible activation.");
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    corpus_id: "set_redacted",
    output_id: "set_redacted",
    contains_sensitive_ids: false,
    counts,
    live_payload_parity: livePayloadParity,
    fallback_checks: fallbackChecks,
    visibility_checks: visibilityChecks,
    failures,
    ready_for_serving_shadow: failures.length === 0
  }, null, 2));

  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
