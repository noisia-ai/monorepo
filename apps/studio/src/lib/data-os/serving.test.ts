import assert from "node:assert/strict";
import test from "node:test";

import "./signal-workspace.test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const {
  applyPulseLiveVisibility,
  disabledDataOsResponse,
  disabledSignalPulseLiveResponse,
  isDataOsServingEnabled,
  isSignalPulseLiveApiEnabled,
  isSignalPulseLiveRenderEnabled,
  optionalSearchParam,
  parseDataOsReviewQueueFilters,
  parseDataOsTagFilters,
  parsePagination,
  parsePulseLiveCorpusFilters,
  parsePulseLiveMetricFilters
} = await import("./serving");

const clientDefaultVisibility = {
  showPaidOrganic: false,
  showCompetitive: true,
  showEvidence: true,
  showComposer: false,
  showCorpus: false,
  showSources: false,
  showQuality: false,
  showRawMetadata: false
};

const internalVisibility = {
  showPaidOrganic: true,
  showCompetitive: true,
  showEvidence: true,
  showComposer: true,
  showCorpus: true,
  showSources: true,
  showQuality: true,
  showRawMetadata: true
};

test("Data OS serving flag requires the global and serving switches", () => {
  assert.equal(isDataOsServingEnabled({ NOISIA_DATA_OS_ENABLED: "true", NOISIA_DATA_OS_SERVING_ENABLED: "true" }), true);
  assert.equal(isDataOsServingEnabled({ NOISIA_DATA_OS_ENABLED: "true", NOISIA_DATA_OS_SERVING_ENABLED: "false" }), false);
  assert.equal(isDataOsServingEnabled({ NOISIA_DATA_OS_ENABLED: "false", NOISIA_DATA_OS_SERVING_ENABLED: "true" }), false);
});

test("Signal Pulse live API has its own explicit kill switch", () => {
  assert.equal(isSignalPulseLiveApiEnabled({ NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true" }), true);
  assert.equal(isSignalPulseLiveApiEnabled({ NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "false" }), false);
  assert.equal(isSignalPulseLiveApiEnabled({}), false);
});

test("Signal Pulse live render requires Data OS serving, live API and its own flag", () => {
  assert.equal(isSignalPulseLiveRenderEnabled({
    NOISIA_DATA_OS_ENABLED: "true",
    NOISIA_DATA_OS_SERVING_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "true"
  }), true);
  assert.equal(isSignalPulseLiveRenderEnabled({
    NOISIA_DATA_OS_ENABLED: "true",
    NOISIA_DATA_OS_SERVING_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false"
  }), false);
  assert.equal(isSignalPulseLiveRenderEnabled({
    NOISIA_DATA_OS_ENABLED: "false",
    NOISIA_DATA_OS_SERVING_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
    NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "true"
  }), false);
});

test("Data OS pagination clamps unsafe values", () => {
  const high = parsePagination(new URLSearchParams("limit=9999&offset=-4"));
  assert.deepEqual(high, { limit: 500, offset: 0 });

  const invalid = parsePagination(new URLSearchParams("limit=nope&offset=nope"));
  assert.deepEqual(invalid, { limit: 100, offset: 0 });
});

test("Data OS optional filters trim blank query params", () => {
  const params = new URLSearchParams("period=++&platform=TikTok&q=%20trust%20");
  assert.equal(optionalSearchParam(params, "period"), null);
  assert.equal(optionalSearchParam(params, "platform"), "TikTok");
  assert.equal(optionalSearchParam(params, "q"), "trust");
  assert.equal(optionalSearchParam(params, "missing"), null);
});

test("Data OS tag filters preserve the public query contract", () => {
  const filters = parseDataOsTagFilters(new URLSearchParams(
    "limit=25&offset=10&subject_type=mention&taxonomy=trigger&review_status=approved"
  ));

  assert.deepEqual(filters, {
    limit: 25,
    offset: 10,
    subjectType: "mention",
    taxonomy: "trigger",
    reviewStatus: "approved"
  });
});

test("Data OS review queue filters preserve internal review query params", () => {
  const filters = parseDataOsReviewQueueFilters(new URLSearchParams(
    "limit=25&offset=10&taxonomy=barrier&review_status=unreviewed&assertion_status=candidate&confidence=low"
  ));

  assert.deepEqual(filters, {
    limit: 25,
    offset: 10,
    taxonomy: "barrier",
    reviewStatus: "unreviewed",
    assertionStatus: "candidate",
    confidence: "low"
  });
});

test("Signal Pulse metric filters preserve period and signal aliases", () => {
  const filters = parsePulseLiveMetricFilters(new URLSearchParams(
    "limit=25&period=period-1&signal_id=signal-1"
  ));

  assert.deepEqual(filters, {
    limit: 25,
    offset: 0,
    period: "period-1",
    signalId: "signal-1"
  });
});

test("Signal Pulse corpus filters preserve dashboard dimensions", () => {
  const filters = parsePulseLiveCorpusFilters(new URLSearchParams(
    [
      "limit=25",
      "offset=5",
      "period=period-1",
      "platform=TikTok",
      "source_type=conversation",
      "inclusion_status=included",
      "taxonomy=journey_stage",
      "term=consideration",
      "lifecycle=emerging",
      "audience=switcher",
      "demographic=gen_z",
      "journey_stage=conversion",
      "signal_id=signal-1",
      "q=trust"
    ].join("&")
  ));

  assert.deepEqual(filters, {
    limit: 25,
    offset: 5,
    period: "period-1",
    platform: "TikTok",
    sourceType: "conversation",
    inclusionStatus: "included",
    taxonomy: "journey_stage",
    term: "consideration",
    lifecycle: "emerging",
    audience: "switcher",
    demographic: "gen_z",
    journeyStage: "conversion",
    signalId: "signal-1",
    query: "trust"
  });
});

test("Data OS disabled responses expose the payload fallback", async () => {
  const dataOs = disabledDataOsResponse();
  assert.equal(dataOs.status, 503);
  assert.deepEqual(await dataOs.json(), {
    error: "data_os_disabled",
    message: "Noisia Data OS serving APIs are disabled. Enable NOISIA_DATA_OS_ENABLED and NOISIA_DATA_OS_SERVING_ENABLED.",
    fallback: "published_outputs.payload",
    required_flags: ["NOISIA_DATA_OS_ENABLED", "NOISIA_DATA_OS_SERVING_ENABLED"]
  });

  const pulse = disabledSignalPulseLiveResponse();
  assert.equal(pulse.status, 503);
  assert.deepEqual(await pulse.json(), {
    error: "signal_pulse_live_api_disabled",
    message: "Signal Pulse live Data OS APIs are disabled. Enable NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED.",
    fallback: "published_outputs.payload",
    required_flags: ["NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED"]
  });
});

test("Signal Pulse live visibility hides internal refs and source health for default clients", () => {
  const sanitized = applyPulseLiveVisibility(
    {
      output_id: "output-1",
      dashboard_data_refs: [
        { ref_key: "sources", visibility: { internal: true } },
        { ref_key: "public-summary", visibility: { internal: false } }
      ],
      source_health: { failed: 0, assets: 10 }
    },
    clientDefaultVisibility
  );

  assert.deepEqual(sanitized.dashboard_data_refs, [
    { ref_key: "public-summary", visibility: { internal: false } }
  ]);
  assert.deepEqual(sanitized.source_health, {
    status: "hidden",
    section: "source_health",
    reason: "visibility_config",
    fallback: "published_outputs.payload"
  });
  assert.deepEqual(sanitized.visibility, {
    paid_organic: false,
    competitive: true,
    evidence: true,
    corpus: false,
    sources: false,
    quality: false,
    raw_metadata: false
  });
});

test("Signal Pulse live visibility keeps internals for internal users", () => {
  const live = {
    output_id: "output-1",
    dashboard_data_refs: [{ ref_key: "sources", visibility: { internal: true } }],
    source_health: { failed: 0, assets: 10 }
  };

  assert.deepEqual(applyPulseLiveVisibility(live, internalVisibility), {
    ...live,
    visibility: {
      paid_organic: true,
      competitive: true,
      evidence: true,
      corpus: true,
      sources: true,
      quality: true,
      raw_metadata: true
    }
  });
});
