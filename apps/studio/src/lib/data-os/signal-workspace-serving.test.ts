import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  signalFiltersHashV1,
  validateSignalBreakdownV1,
  validateSignalTimeSeriesV1,
  type SignalServingScopeDescriptorV1
} from "@noisia/query-engine";

import type { SignalOperationalReadScopeV1 } from "./signal-operational-read-scope";
import type { ResolvedSignalWorkspace } from "./signal-workspace";

import {
  SIGNAL_BREAKDOWN_FIXTURE_V1,
  SIGNAL_DRILL_DOWN_FIXTURE_V1,
  SIGNAL_FILTER_FIXTURE_V1,
  SIGNAL_SERIES_FIXTURE_V1,
  SIGNAL_TAXONOMY_EVIDENCE_FIXTURE_V1,
  SIGNAL_TAXONOMY_LINEAGE_FIXTURE_V1,
  SIGNAL_TAXONOMY_TERM_DETAIL_FIXTURE_V1,
  SIGNAL_TOPICS_NARRATIVES_OVERVIEW_FIXTURE_V1,
  SIGNAL_WORKSPACE_HOME_FIXTURE_V1,
  SIGNAL_WORKSPACE_FIXTURE_IDS
} from "./signal-workspace-fixtures";
import { loadSignalWorkspaceContextWithDependencies } from "./signal-workspace-context";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const {
  loadSignalClientEvidenceAccessV1,
  loadSignalMentionsV1,
  parseSignalApiFilterV1,
  signalMaterializationResultResponse,
  signalMentionsServingTokensV1,
  signalJsonResponse,
  signalWorstResponseStateV1,
  summarizeSignalMetricPointsV1
} = await import("./signal-workspace-serving");
const { defaultSignalHomeFilter } = await import("./signal-workspace-home");
const {
  SignalClientFetchError,
  fetchSharedSignalJson,
  fetchSignalJsonWithRetry
} = await import("./signal-client-fetch");
const {
  aggregateSignalTaxonomyServingFixtureV1,
  loadSignalTaxonomyEvidenceV1,
  signalDominantSentimentV1,
  signalTaxonomyEvidenceServingTokensV1,
  signalTaxonomyComparisonRangeV1,
  signalTaxonomyKindV1,
  signalTaxonomyTermKeyV1
} = await import("./signal-topics-narratives-serving");
const {
  decodeSignalTriggersBarriersEvidenceCursorV2,
  encodeSignalTriggersBarriersEvidenceCursorV2,
  resolveSignalTriggersBarriersPeriodV2
} = await import("./signal-triggers-barriers-serving");

test("Triggers & Barriers evidence cursors preserve release and finding scope", () => {
  const cursor = {
    analysis_id: "3f32fc7d-aede-4e6a-98d4-7d0ac5ec4ecf",
    finding_id: "B-PER-01",
    position: 4,
    mention_id: "36d09b53-99eb-42fc-9921-3eb237d1069f"
  };
  const encoded = encodeSignalTriggersBarriersEvidenceCursorV2(cursor);
  assert.deepEqual(decodeSignalTriggersBarriersEvidenceCursorV2(encoded), cursor);
  assert.throws(() => decodeSignalTriggersBarriersEvidenceCursorV2("not-a-cursor"));
});

test("Triggers & Barriers periods stay inside the frozen relational cut", () => {
  const cut = { period_start: "2026-07-01", period_end: "2026-07-25" };
  assert.deepEqual(resolveSignalTriggersBarriersPeriodV2(cut), {
    start: "2026-07-01",
    end: "2026-07-25"
  });
  assert.deepEqual(resolveSignalTriggersBarriersPeriodV2(cut, "2026-07-08", "2026-07-14"), {
    start: "2026-07-08",
    end: "2026-07-14"
  });
  assert.throws(() => resolveSignalTriggersBarriersPeriodV2(
    cut,
    "2026-06-30",
    "2026-07-14"
  ));
  assert.throws(() => resolveSignalTriggersBarriersPeriodV2(
    cut,
    "2026-07-20",
    "2026-07-10"
  ));
});

test("Triggers & Barriers V2 serves one relational cut without payload fallback", async () => {
  const routeRoot = resolve(
    process.cwd(),
    "src/app/api/data-os/signal/[workspaceId]/triggers-barriers"
  );
  const [overviewRoute, findingRoute, evidenceRoute, seriesRoute, service, component, filterComponent, dataScopeComponent] = await Promise.all([
    readFile(resolve(routeRoot, "route.ts"), "utf8"),
    readFile(resolve(routeRoot, "findings/[findingId]/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "findings/[findingId]/evidence/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "series/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-triggers-barriers-serving.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/components/signal-v2/SignalV2TriggersBarriers.tsx"), "utf8"),
    readFile(resolve(process.cwd(), "src/components/signal-v2/SignalAnalyticsFilter.tsx"), "utf8"),
    readFile(resolve(process.cwd(), "src/components/signal-v2/SignalDataScopeFilter.tsx"), "utf8")
  ]);
  for (const route of [overviewRoute, findingRoute, evidenceRoute, seriesRoute]) {
    assert.match(route, /loadSignalWorkspaceContext/);
    assert.match(route, /export async function GET/);
  }
  assert.match(service, /signal_workspace_releases/);
  assert.match(service, /published_outputs output/);
  assert.match(service, /data_contract,version/);
  assert.match(service, /corpus_snapshot_mentions/);
  assert.match(service, /tb_finding_citations/);
  assert.match(service, /tb_action_studio/);
  assert.match(service, /tb_action_findings/);
  assert.match(service, /citations_total: activeFindings\.reduce/);
  assert.match(service, /preferredFindingId/);
  assert.match(service, /\[\.\.\.activeFindings\]\.sort\(compareFindings\)/);
  assert.match(service, /intensity_score: nullableNumeric\(row\.intensity_score\)/);
  assert.match(service, /platforms: \[\.\.\.row\.platforms\]\.sort/);
  assert.match(service, /mention\.resolved_platform/);
  assert.match(service, /actions: mapPublishedSignalActions\(actionsResult\.rows\)/);
  assert.doesNotMatch(service, /\n\s*\)\s*\n\s*\), authority AS \(/u);
  assert.match(service, /Promise\.all\(\[\s*loadPublishedSignalOverview/);
  assert.doesNotMatch(service, /published_outputs\.payload|output\.payload/);
  assert.match(component, /const MOBILITIES: Mobility\[\] = \["movible_por_marca", "parcialmente_movible", "estructural"\]/);
  assert.match(component, /const LAYERS: Layer\[\] = \["personal", "psicologico", "social", "cultural"\]/);
  assert.match(component, /limit=5/);
  assert.match(component, /\/mentions\?mention=/);
  assert.match(component, /SignalAnalyticsFilter/);
  assert.match(component, /boundedToCoverage/);
  assert.match(component, /showComparison=\{false\}/);
  assert.match(component, /SignalDataScopeFilter/);
  assert.match(component, /onOpenMentions=\{onOpenMentions\}/);
  assert.doesNotMatch(component, /signal-v2-filter--static/);
  assert.match(dataScopeComponent, /aria-expanded=\{open\}/);
  assert.match(dataScopeComponent, /role="dialog"/);
  assert.match(dataScopeComponent, /onOpenMentions\(\)/);
  assert.match(component, /SignalMetricHelp/);
  assert.doesNotMatch(component, /LayerMix/);
  assert.match(component, /signal-v2-tb__selection-layout/);
  assert.match(component, /signal-v2-tb__decision-hero/);
  assert.match(component, /detail\.actions\[0\]/);
  assert.doesNotMatch(component, /tbView|evidenceMode/);
  assert.doesNotMatch(component, /periodStatus\.updating/);
  assert.doesNotMatch(component, /<span>\{finding\.finding_id\}<\/span>/);
  assert.match(filterComponent, /const updateDraft = \(nextDraft: string\)/);
  assert.match(filterComponent, /readDateInputRange\(periodAnchorRef\.current/);
  assert.match(filterComponent, /data-signal-date-edge=\{edge\}/);
  assert.match(filterComponent, /onChange=\{\(event\) => updateDraft\(event\.currentTarget\.value\)\}/);
  assert.doesNotMatch(component, /balanceOption/);
  assert.doesNotMatch(component, /d3|forceSimulation|chord/i);
});

test("Signal modules share one enforced header and controls geometry", async () => {
  const componentRoot = resolve(process.cwd(), "src/components/signal-v2");
  const [header, monitoring, mentions, topics, triggersBarriers, skeleton, css] = await Promise.all([
    readFile(resolve(componentRoot, "SignalV2ModuleHeader.tsx"), "utf8"),
    readFile(resolve(componentRoot, "SignalV2BrandMonitoring.tsx"), "utf8"),
    readFile(resolve(componentRoot, "SignalV2Mentions.tsx"), "utf8"),
    readFile(resolve(componentRoot, "SignalV2TopicsNarratives.tsx"), "utf8"),
    readFile(resolve(componentRoot, "SignalV2TriggersBarriers.tsx"), "utf8"),
    readFile(resolve(componentRoot, "SignalV2RouteSkeleton.tsx"), "utf8"),
    readFile(resolve(process.cwd(), "src/app/signal-v2/signal-v2.css"), "utf8")
  ]);

  assert.match(header, /data-signal-module-header/);
  assert.match(header, /signal-v2-page-head/);
  assert.match(header, /signal-v2-filterbar/);
  for (const consumer of [monitoring, mentions, topics, triggersBarriers, skeleton]) {
    assert.match(consumer, /SignalV2ModuleHeader/);
  }
  const componentSources = await Promise.all(
    (await readdir(componentRoot))
      .filter((fileName) => fileName.endsWith(".tsx") && fileName !== "SignalV2ModuleHeader.tsx")
      .map(async (fileName) => ({
        fileName,
        source: await readFile(resolve(componentRoot, fileName), "utf8")
      }))
  );
  for (const { fileName, source } of componentSources) {
    assert.doesNotMatch(
      source,
      /className="signal-v2-page-head/,
      `${fileName} must render SignalV2ModuleHeader instead of owning page-head geometry`
    );
    assert.doesNotMatch(
      source,
      /className="signal-v2-filterbar/,
      `${fileName} must render SignalV2ModuleHeader instead of owning filterbar geometry`
    );
  }
  assert.match(css, /\.signal-v2-module-header\s*\{[^}]*gap: 6px;[^}]*margin-bottom: 6px;/s);
  assert.match(css, /\.signal-v2-module-header--with-controls\s*\{[^}]*margin-bottom: 10px;/s);
  assert.match(css, /\.signal-v2-module-header > \.signal-v2-page-head,[^}]*margin-bottom: 0;/s);
  assert.match(css, /\.signal-v2-tb\s*\{[^}]*padding: 0 0 28px;/s);
});

test("strategic study navigation uses the shared module href and visible pending state", async () => {
  const component = await readFile(
    resolve(process.cwd(), "src/components/signal-v2/SignalV2BrandMonitoring.tsx"),
    "utf8"
  );
  assert.match(component, /const navigateToStudy = useCallback/);
  assert.match(component, /setPendingModule\("study"\)/);
  assert.match(component, /triggers-barriers`/);
  assert.match(component, /variant=\{pendingModule === "study" \? "triggersBarriers" : pendingModule\}/);
  assert.match(component, /window\.history\.pushState/);
  assert.doesNotMatch(component, /window\.location\.assign/);
});

test("Signal client detail fetch retries a transient serving error", async () => {
  let attempts = 0;
  const payload = await fetchSignalJsonWithRetry<{ term_key: string }>(
    "/api/data-os/signal/workspace/topics-narratives/topic/promotions",
    {
      fallbackMessage: "Could not load detail.",
      retryDelaysMs: [0],
      fetcher: async () => {
        attempts += 1;
        return attempts === 1
          ? Response.json({ message: "Temporarily unavailable." }, { status: 503 })
          : Response.json({ term_key: "promotions" });
      }
    }
  );

  assert.equal(attempts, 2);
  assert.equal(payload.term_key, "promotions");
});

test("Signal client detail fetch does not retry a non-transient response", async () => {
  let attempts = 0;
  await assert.rejects(
    fetchSignalJsonWithRetry(
      "/api/data-os/signal/workspace/topics-narratives/topic/unknown",
      {
        fallbackMessage: "Could not load detail.",
        retryDelaysMs: [0, 0],
        fetcher: async () => {
          attempts += 1;
          return Response.json({ message: "Term not found." }, { status: 404 });
        }
      }
    ),
    (error) => error instanceof SignalClientFetchError
      && error.status === 404
      && error.message === "Term not found."
  );
  assert.equal(attempts, 1);
});

test("Signal client coalesces identical reads only while they are in flight", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return Response.json({ records: [calls] });
  };

  try {
    const first = fetchSharedSignalJson<{ records: number[] }>("/api/data-os/signal/shared-read");
    const second = fetchSharedSignalJson<{ records: number[] }>("/api/data-os/signal/shared-read");
    assert.equal(calls, 1);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult, secondResult);
    assert.deepEqual(firstResult.body, { records: [1] });

    await fetchSharedSignalJson("/api/data-os/signal/shared-read");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Signal workspace fixtures satisfy the shared series and breakdown contract", () => {
  assert.deepEqual(validateSignalTimeSeriesV1(SIGNAL_SERIES_FIXTURE_V1), SIGNAL_SERIES_FIXTURE_V1);
  assert.deepEqual(validateSignalBreakdownV1(SIGNAL_BREAKDOWN_FIXTURE_V1), SIGNAL_BREAKDOWN_FIXTURE_V1);
  assert.equal(SIGNAL_SERIES_FIXTURE_V1.filters_hash, signalFiltersHashV1(SIGNAL_FILTER_FIXTURE_V1));
  assert.equal(SIGNAL_WORKSPACE_HOME_FIXTURE_V1.contract_version, "signal-backend-v1");
  assert.equal(SIGNAL_WORKSPACE_HOME_FIXTURE_V1.legacy_fallback.source_of_truth, false);
  assert.equal(SIGNAL_WORKSPACE_HOME_FIXTURE_V1.default_filter, SIGNAL_FILTER_FIXTURE_V1);
  assert.equal(SIGNAL_WORKSPACE_HOME_FIXTURE_V1.coverage.mentions, 128);
  assert.equal(SIGNAL_WORKSPACE_HOME_FIXTURE_V1.facade_version, "signal-workspace-home-v1");
  assert.equal(
    SIGNAL_WORKSPACE_HOME_FIXTURE_V1.topics_narratives.contract_version,
    "signal-topics-narratives-v1"
  );
  assert.ok(
    SIGNAL_WORKSPACE_HOME_FIXTURE_V1.capabilities.some(
      (capability) => capability.key === "topics_narratives"
    )
  );
});

test("Topics and Narratives fixtures freeze overview, detail, evidence and lineage contracts", () => {
  assert.equal(
    SIGNAL_TOPICS_NARRATIVES_OVERVIEW_FIXTURE_V1.contract_version,
    "signal-topics-narratives-v1"
  );
  assert.equal(
    SIGNAL_TOPICS_NARRATIVES_OVERVIEW_FIXTURE_V1.topics.metric_key,
    "topic.volume"
  );
  assert.equal(
    SIGNAL_TOPICS_NARRATIVES_OVERVIEW_FIXTURE_V1.narratives.metric_key,
    "narrative.volume"
  );
  assert.equal(
    SIGNAL_TAXONOMY_TERM_DETAIL_FIXTURE_V1.term.mention_count,
    SIGNAL_TAXONOMY_LINEAGE_FIXTURE_V1.source_summary.mention_count
  );
  assert.equal(SIGNAL_TAXONOMY_EVIDENCE_FIXTURE_V1.records.length, 1);
  assert.equal(
    SIGNAL_TAXONOMY_EVIDENCE_FIXTURE_V1.page.total_count,
    SIGNAL_TAXONOMY_TERM_DETAIL_FIXTURE_V1.term.mention_count
  );
  assert.equal(
    SIGNAL_TAXONOMY_EVIDENCE_FIXTURE_V1.records[0]?.mention_id,
    SIGNAL_DRILL_DOWN_FIXTURE_V1.records[0]?.subject_id
  );
});

test("Topics and Narratives route keys and comparison controls fail closed", () => {
  assert.equal(signalTaxonomyKindV1("narrative"), "narrative");
  assert.equal(signalTaxonomyTermKeyV1(" Pet_Health "), "pet_health");
  assert.equal(signalTaxonomyComparisonRangeV1(new URLSearchParams()), null);
  assert.deepEqual(signalTaxonomyComparisonRangeV1(new URLSearchParams(
    "comparison_start=2026-05-01&comparison_end=2026-05-31"
  )), { start: "2026-05-01", end: "2026-05-31" });
  assert.throws(() => signalTaxonomyKindV1("trigger"));
  assert.throws(() => signalTaxonomyTermKeyV1("not a key"));
  assert.throws(() => signalTaxonomyComparisonRangeV1(new URLSearchParams(
    "comparison_start=2026-05-01"
  )));
});

test("TN overview sentiment uses only a unique classified leader", () => {
  assert.equal(signalDominantSentimentV1({
    positive: 1,
    neutral: 2,
    negative: 3
  }), "negative");
  assert.equal(signalDominantSentimentV1({
    positive: 2,
    neutral: 2,
    negative: 0
  }), "mixed");
  assert.equal(signalDominantSentimentV1({
    positive: 0,
    neutral: 0,
    negative: 0
  }), "not_available");
});

test("TN serving aggregates all denominators, emits period zero and retains disappeared terms", () => {
  const payload = (included: number, classified: number, buckets: unknown[]) => ({
    included_mentions: included,
    processed_mentions: included,
    classified_mentions: classified,
    tag_assertions: classified,
    pending_mentions: 0,
    rejected_mentions: 0,
    buckets,
    cooccurrences: []
  });
  const section = aggregateSignalTaxonomyServingFixtureV1({
    kind: "topic",
    current: [
      {
        period_start: "2026-06-01",
        period_end: "2026-06-01",
        typed_payload: payload(2, 1, [{
          key: "pet_health",
          label: "Pet health",
          value: 1,
          denominator: 2
        }]),
        state: "fresh"
      },
      {
        period_start: "2026-06-02",
        period_end: "2026-06-02",
        typed_payload: payload(1, 0, []),
        state: "fresh"
      }
    ],
    comparison: [{
      period_start: "2026-05-31",
      period_end: "2026-05-31",
      typed_payload: payload(2, 1, [{
        key: "delivery_trust",
        label: "Delivery trust",
        value: 1,
        denominator: 2
      }]),
      state: "fresh"
    }]
  });
  const petHealth = section.terms.find((term) => term.term_key === "pet_health");
  const disappeared = section.terms.find((term) => term.term_key === "delivery_trust");
  assert.equal(petHealth?.denominator, 3);
  assert.equal(petHealth?.share_of_included, 1 / 3);
  assert.deepEqual(
    section.series.map((point) => point.denominator),
    [2, 1]
  );
  assert.equal(disappeared?.mention_count, 0);
  assert.equal(disappeared?.comparison_mention_count, 1);
  assert.equal(disappeared?.delta, -1);
});

test("TN serving consolidates a period split across bounded materialization windows", () => {
  const payload = (included: number, classified: number, value: number) => ({
    included_mentions: included,
    processed_mentions: included,
    classified_mentions: classified,
    tag_assertions: classified,
    pending_mentions: 0,
    rejected_mentions: 0,
    buckets: [{
      key: "discount_perception",
      label: "Discount perception",
      value,
      denominator: included
    }],
    cooccurrences: []
  });
  const section = aggregateSignalTaxonomyServingFixtureV1({
    kind: "narrative",
    current: [
      {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        typed_payload: payload(3, 2, 2),
        state: "fresh"
      },
      {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        typed_payload: payload(2, 1, 1),
        state: "partial"
      }
    ]
  });

  assert.deepEqual(section.series, [{
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    mention_count: 3,
    denominator: 5,
    share_of_included: 3 / 5,
    state: "partial"
  }]);
  assert.equal(section.terms[0]?.mention_count, 3);
  assert.equal(section.terms[0]?.denominator, 5);
});

test("home facade chooses the latest covered month without inventing dates", () => {
  assert.deepEqual(
    defaultSignalHomeFilter("2026-05-18", "2026-07-22", "America/Mexico_City"),
    {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-07-01", end: "2026-07-22" },
      timezone: "America/Mexico_City",
      granularity: "day",
      dimensions: {}
    }
  );
  assert.equal(defaultSignalHomeFilter(null, null, "UTC"), null);
});

test("workspace APIs use the canonical filter parser and ignore only route controls", () => {
  const left = parseSignalApiFilterV1(new URLSearchParams(
    "metric_key=conversation.volume&end=2026-06-30&start=2026-06-01&platform=instagram&grain=monthly"
  ), "America/Mexico_City");
  const right = parseSignalApiFilterV1(new URLSearchParams(
    "granularity=month&dimension.platform=instagram&start=2026-06-01&end=2026-06-30"
  ), "America/Mexico_City");
  assert.deepEqual(left, right);
  assert.throws(
    () => parseSignalApiFilterV1(new URLSearchParams("start=2026-06-01&end=2026-06-30&unknown=x"), "UTC"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "unsupported_dimension"
  );
});

test("workspace APIs keep comparison controls out of analytical dimensions", () => {
  const filter = parseSignalApiFilterV1(new URLSearchParams(
    "start=2026-07-01&end=2026-07-25&timezone=America%2FMexico_City"
    + "&granularity=day&compare=previous_period"
    + "&comparison_start=2026-06-06&comparison_end=2026-06-30"
  ), "America/Mexico_City");

  assert.deepEqual(filter.dimensions, {});
  assert.deepEqual(filter.date_range, {
    start: "2026-07-01",
    end: "2026-07-25"
  });
});

test("workspace filter parsing keeps canonical text search in the shared hash", () => {
  const left = parseSignalApiFilterV1(new URLSearchParams(
    "start=2026-06-01&end=2026-06-30&q=Entrega%20%20R%C3%81PIDA&narratives=la-entrega-genera-confianza"
  ), "America/Mexico_City");
  const right = parseSignalApiFilterV1(new URLSearchParams(
    "dimension.narrative=la-entrega-genera-confianza&search=entrega+r%C3%A1pida&end=2026-06-30&start=2026-06-01"
  ), "America/Mexico_City");
  assert.deepEqual(left, right);
  assert.equal(signalFiltersHashV1(left), signalFiltersHashV1(right));
  assert.equal(left.text_search, "entrega rápida");
});

test("workspace responses emit private ETags and honor conditional GET", async () => {
  const request = new Request("https://studio.test/api/data-os/signal/workspace/bootstrap");
  const first = signalJsonResponse(request, { ok: true }, { etagSeed: "watermark", state: "fresh" });
  assert.equal(first.status, 200);
  assert.match(first.headers.get("etag") ?? "", /^W\//u);
  assert.match(first.headers.get("cache-control") ?? "", /private/u);
  const conditional = signalJsonResponse(new Request(request.url, {
    headers: { "if-none-match": first.headers.get("etag") ?? "" }
  }), { ok: true }, { etagSeed: "watermark", state: "fresh" });
  assert.equal(conditional.status, 304);
});

test("cache policy derives from the worst visible state and never caches degraded groups as fresh", () => {
  for (const state of ["stale", "partial", "pending", "not_available"]) {
    const response = signalJsonResponse(
      new Request("https://studio.test/api/data-os/signal/workspace/metric-groups"),
      { state },
      { etagSeed: state, state }
    );
    assert.equal(response.headers.get("cache-control"), "private, no-cache");
  }
  assert.equal(signalWorstResponseStateV1(["fresh", "stale", "fresh"]), "stale");
  assert.equal(signalWorstResponseStateV1(["fresh", "partial"]), "partial");
  assert.equal(signalWorstResponseStateV1(["fresh", "pending"]), "pending");
  assert.equal(signalWorstResponseStateV1(["fresh", "not_available"]), "not_available");
  assert.equal(signalWorstResponseStateV1(["fresh", "fresh"]), "fresh");
});

test("conversation velocity summaries never average non-additive period-change ratios", () => {
  const points = [
    {
      period_start: "2026-06-01",
      period_end: "2026-06-01",
      value: 0.5,
      denominator: 10,
      sample_size: 15,
      state: "available" as const
    },
    {
      period_start: "2026-06-02",
      period_end: "2026-06-02",
      value: -0.25,
      denominator: 20,
      sample_size: 15,
      state: "available" as const
    }
  ];
  assert.equal(summarizeSignalMetricPointsV1(points, "conversation.velocity", "ratio"), -0.25);
  assert.notEqual(summarizeSignalMetricPointsV1(points, "conversation.velocity", "ratio"), 0);
});

test("workspace loader fails closed for unauthenticated, suspended, disabled, paused and inaccessible users", async () => {
  const baseSession = {
    appUser: {
      id: "70000000-0000-4000-8000-000000000001",
      userType: "client",
      organizationId: SIGNAL_WORKSPACE_FIXTURE_IDS.organization,
      primaryRole: "client_viewer",
      status: "active"
    }
  };
  const workspace = {
    contractVersion: "signal-backend-v1" as const,
    id: SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
    organizationId: SIGNAL_WORKSPACE_FIXTURE_IDS.organization,
    slug: "fixture-signal",
    name: "Fixture brand",
    subject: { type: "brand" as const, id: SIGNAL_WORKSPACE_FIXTURE_IDS.brand },
    timezone: "America/Mexico_City",
    status: "active",
    corpora: [{
      id: SIGNAL_WORKSPACE_FIXTURE_IDS.corpus,
      name: "Fixture",
      role: "operational" as const,
      status: "corpus_approved",
      validFrom: "2026-07-01T00:00:00.000Z",
      methodologySlug: "signal-pulse",
      outputId: null
    }]
  };
  const dependencies = {
    getSession: async () => baseSession,
    isEnabled: () => true,
    canView: () => true,
    resolveWorkspace: async () => workspace
  };
  const unauthorized = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    getSession: async () => null
  });
  assert.equal("response" in unauthorized ? unauthorized.response?.status : 0, 401);
  const suspended = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    getSession: async () => ({ appUser: { ...baseSession.appUser, status: "suspended" } })
  });
  assert.equal("response" in suspended ? suspended.response?.status : 0, 403);
  const disabled = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    isEnabled: () => false
  });
  assert.equal("response" in disabled ? disabled.response?.status : 0, 503);
  const inaccessible = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    resolveWorkspace: async () => null
  });
  assert.equal("response" in inaccessible ? inaccessible.response?.status : 0, 404);
  const paused = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    resolveWorkspace: async () => ({ ...workspace, status: "paused" })
  });
  assert.equal("response" in paused ? paused.response?.status : 0, 404);
  const authorized = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, dependencies);
  assert.equal("workspace" in authorized ? authorized.workspace?.id : null, SIGNAL_WORKSPACE_FIXTURE_IDS.workspace);

  const corpuslessWorkspace = { ...workspace, corpora: [] };
  const corpuslessServing = await loadSignalWorkspaceContextWithDependencies(
    SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
    { ...dependencies, resolveWorkspace: async () => corpuslessWorkspace }
  );
  assert.equal(
    "workspace" in corpuslessServing ? corpuslessServing.workspace?.corpora.length : -1,
    0
  );
  const corpuslessManagement = await loadSignalWorkspaceContextWithDependencies(
    SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
    { ...dependencies, resolveWorkspace: async () => corpuslessWorkspace },
    { requireOperationalCorpus: false }
  );
  assert.equal(
    "workspace" in corpuslessManagement ? corpuslessManagement.workspace?.corpora.length : -1,
    0
  );

  const ambiguous = await loadSignalWorkspaceContextWithDependencies(SIGNAL_WORKSPACE_FIXTURE_IDS.workspace, {
    ...dependencies,
    resolveWorkspace: async () => ({
      ...workspace,
      corpora: [
        ...workspace.corpora,
        {
          ...workspace.corpora[0]!,
          id: "60000000-0000-4000-8000-000000000002",
          name: "Second Signal Pulse corpus"
        }
      ]
    })
  });
  assert.equal(
    "workspace" in ambiguous ? ambiguous.workspace?.corpora.length : -1,
    2
  );
});

test("workspace routes use authZ and canonical stores without published payload, raw metadata or legacy route edits", async () => {
  const routeRoot = resolve(process.cwd(), "src/app/api/data-os/signal/[workspaceId]");
  const routeNames = ["bootstrap", "facets", "metric-groups", "series", "breakdowns", "comparison", "mentions", "lineage", "interpretations", "releases"];
  const sources = await Promise.all([
    readFile(resolve(routeRoot, "route.ts"), "utf8"),
    ...routeNames.map((name) => readFile(resolve(routeRoot, name, "route.ts"), "utf8"))
  ]);
  const [service, openapi, pulseMetrics, fixtureSource] = await Promise.all([
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-workspace-serving.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8"),
    readFile(resolve(process.cwd(), "src/app/api/data-os/pulse/[outputId]/metrics/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-workspace-fixtures.ts"), "utf8")
  ]);
  for (const source of sources) {
    assert.match(source, /loadSignalWorkspace(?:Module)?Context/);
    assert.doesNotMatch(source, /published_outputs|payload\.payload|raw_metadata/u);
  }
  assert.doesNotMatch(service, /published_outputs|raw_metadata|chart_aggregates/u);
  assert.match(service, /FROM metric_materializations/);
  assert.match(service, /buildSignalMetricMaterializationPlanV1/);
  assert.match(service, /serving_mode: "live_read_through"/);
  assert.match(service, /evaluateSignalMetricQualityV1/);
  assert.match(service, /FROM metric_interpretations interpretation/);
  assert.match(service, /FROM mentions m WHERE \$\{predicate\.sql\}/);
  assert.match(service, /sourceTypeSelect = args\.isInternalUser/);
  for (const routeName of routeNames) {
    assert.match(openapi, new RegExp(`/api/data-os/signal/\\{workspaceId\\}/${routeName}:`));
  }
  assert.match(openapi, /\/api\/data-os\/signal\/\{workspaceId\}:/);
  assert.match(pulseMetrics, /loadDataOsPulseContext/);
  assert.match(fixtureSource, /SignalTimeSeriesV1/);
  assert.match(fixtureSource, /SignalBreakdownV1/);

  const [sourceRoute, importRoute, populationShadow, workspaceIngestion] = await Promise.all([
    readFile(resolve(routeRoot, "sources/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "sources/[sourceId]/imports/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "populations/operational/shadow/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/workspace-ingestion.ts"), "utf8")
  ]);
  for (const route of [sourceRoute, importRoute, populationShadow]) {
    assert.match(route, /loadSignalWorkspaceContextForManagement/);
    assert.doesNotMatch(route, /published_outputs|\.payload/u);
  }
  assert.match(workspaceIngestion, /recordSignalWorkspaceDataAcceptance/);
  assert.match(importRoute, /contributedByStudyCorpusId/);
  assert.match(populationShadow, /loadWorkspacePopulationShadowComparison/);
});

test("module shadow uses a durable post-response outbox and stale population caches read through", async () => {
  const routeRoot = resolve(process.cwd(), "src/app/api/data-os/signal/[workspaceId]");
  const [monitoring, mentions, taxonomy, shadow, shadowAuthority, serving, migration] = await Promise.all([
    readFile(resolve(routeRoot, "brand-monitoring/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "mentions/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "topics-narratives/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-operational-module-shadow.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-module-shadow-authority.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-workspace-serving.ts"), "utf8"),
    readFile(
      resolve(
        process.cwd(),
        "../../infrastructure/db/migrations/0061_signal_operational_membership_invalidation_shadow_outbox.sql"
      ),
      "utf8"
    )
  ]);
  for (const route of [monitoring, mentions, taxonomy]) {
    assert.match(route, /import \{ after \} from "next\/server"/);
    assert.match(route, /Server-Timing/);
    assert.match(route, /scheduleSignal/);
    assert.match(route, /servingScope: loaded\.servingScope/);
    assert.doesNotMatch(route, /await recordSignal/u);
  }
  assert.match(taxonomy, /signalTopicsNarrativesOverviewContentHashV1\(payload\)/);
  assert.match(shadow, /INSERT INTO signal_operational_shadow_requests/);
  assert.match(shadow, /drainSignalOperationalModuleShadowOutboxV1/);
  assert.match(shadow, /stale_processing_lease/);
  assert.match(shadow, /LIMIT 3/);
  assert.match(shadow, /withSignalModuleShadowAuthorityV1/);
  assert.match(shadowAuthority, /SHADOW_AUTHORITY_KEY = "__governed_shadow_authority"/);
  assert.match(shadowAuthority, /\[SHADOW_AUTHORITY_KEY\]: authority/);
  assert.match(shadow, /resolveSignalModuleServingScopeV1/);
  assert.match(shadow, /sameSignalModuleShadowAuthorityV1/);
  assert.doesNotMatch(shadow, /resolveSignalOperationalReadScopeV1/);
  assert.doesNotMatch(shadow, /while \(cursor && pages < 200\)/);
  assert.match(serving, /result\.rows\.every\(isUsableMaterializationRow\)/);
  assert.match(migration, /operational_population_membership_changed/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_operational_shadow_requests/);
});

test("TN taxonomy admin uses governed context, atomic activation and canonical stores", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/data-os/signal-topics-narratives-admin.ts"),
    "utf8"
  );
  const store = await readFile(
    resolve(process.cwd(), "../../infrastructure/db/signal-taxonomy-profile.ts"),
    "utf8"
  );
  assert.match(source, /loadSignalTaxonomyDiscoveryContextStoreV1/);
  assert.match(source, /createSignalTaxonomyDraftStoreV1/);
  assert.match(store, /FROM brand_os_objectives/);
  assert.match(store, /FROM knowledge_assertions/);
  assert.match(store, /mention\.inclusion_status = 'included'/);
  assert.match(store, /signalTaxonomyContextHashV1/);
  assert.match(store, /INSERT INTO taxonomies/);
  assert.match(store, /INSERT INTO taxonomy_terms/);
  assert.match(store, /INSERT INTO tagging_rule_sets/);
  assert.match(store, /INSERT INTO tagging_model_versions/);
  assert.match(store, /INSERT INTO signal_taxonomy_profiles/);
  assert.match(source, /activate_signal_taxonomy_profile/);
  assert.match(source, /profile_review/);
  assert.match(source, /reviewed_at/);
  assert.match(source, /reject_signal_taxonomy_profile/);
  assert.match(store, /INSERT INTO lineage_edges/);
  assert.doesNotMatch(`${source}\n${store}`, /published_outputs|chart_aggregates/);
});

test("TN promotion reconciles profiles and legacy direct tag review is closed by the 10B ledger", async () => {
  const [admin, review] = await Promise.all([
    readFile(
      resolve(process.cwd(), "src/lib/data-os/signal-topics-narratives-admin.ts"),
      "utf8"
    ),
    readFile(
      resolve(process.cwd(), "src/lib/data-os/signal-topics-narratives-review.ts"),
      "utf8"
    )
  ]);
  assert.match(admin, /ready_for_activation/);
  assert.match(review, /review_status = 'approved'/);
  assert.match(review, /review_status IN \('pending', 'unreviewed', 'needs_review'\)/);
  assert.match(review, /emerging_candidates_visibility/);
  assert.match(review, /internal_review_only/);
  assert.match(review, /signal_classification_ledger_required_10b/);
  assert.doesNotMatch(review, /INSERT INTO tag_review_events/);
  assert.doesNotMatch(review, /UPDATE record_tags/);
  assert.match(review, /signalTaxonomyCoverageV1/);
  assert.doesNotMatch(review, /published_outputs|chart_aggregates/);
});

test("TN facets use exact active workspace profiles and keep narrative canonical", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/data-os/signal-workspace-serving.ts"),
    "utf8"
  );
  assert.match(source, /JOIN signal_taxonomy_profiles profile/);
  assert.match(source, /profile\.workspace_id = \$\{workspaceParameter\}/);
  assert.match(source, /profile\.status = 'active'/);
  assert.match(source, /SELECT filtered\.id, profile\.kind/);
  assert.match(source, /"narrative\.volume": "narrative"/);
  assert.doesNotMatch(source, /LIKE '%topic%'/);
  assert.doesNotMatch(source, /LIKE '%narrative%'/);
  assert.doesNotMatch(source, /published_outputs|chart_aggregates/);
});

test("TN serving routes reconcile canonical materializations, approved evidence and lineage", async () => {
  const routeRoot = resolve(
    process.cwd(),
    "src/app/api/data-os/signal/[workspaceId]/topics-narratives"
  );
  const routeSources = await Promise.all([
    readFile(resolve(routeRoot, "route.ts"), "utf8"),
    readFile(resolve(routeRoot, "[kind]/[termKey]/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "[kind]/[termKey]/evidence/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "[kind]/[termKey]/lineage/route.ts"), "utf8")
  ]);
  const [service, worker, home] = await Promise.all([
    readFile(
      resolve(process.cwd(), "src/lib/data-os/signal-topics-narratives-serving.ts"),
      "utf8"
    ),
    readFile(
      resolve(process.cwd(), "../../services/workers/src/workers/signal-taxonomy-enrichment.ts"),
      "utf8"
    ),
    readFile(
      resolve(process.cwd(), "src/lib/data-os/signal-workspace-home.ts"),
      "utf8"
    )
  ]);
  for (const route of routeSources) {
    assert.match(route, /loadSignalWorkspace(?:Module)?Context/);
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /published_outputs|chart_aggregates|raw_metadata/);
  }
  assert.match(service, /FROM metric_materializations/);
  assert.match(service, /buildSignalMentionReadPredicateV1/);
  assert.match(service, /tag\.review_status = 'approved'/);
  assert.match(service, /JOIN signal_taxonomy_profiles profile/);
  assert.match(service, /profile\.workspace_id =/);
  assert.match(service, /profile\.status = 'active'/);
  assert.match(service, /profile\.approved_at AS activated_at/);
  assert.doesNotMatch(
    service,
    /profile\.context_hash,\s+profile\.activated_at/
  );
  assert.match(service, /cooccurrence_not_causality/);
  assert.match(worker, /SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON/);
  assert.match(worker, /status='blocked'/);
  assert.match(worker, /provider_calls',0/);
  assert.doesNotMatch(worker, /INSERT INTO record_tags/);
  assert.doesNotMatch(worker, /INSERT INTO lineage_edges/);
  assert.match(home, /loadSignalTopicsNarrativesOverviewV1/);
  assert.match(home, /topics_narratives: topicsNarratives/);
  assert.match(home, /\["topics_narratives", "\/topics-narratives"\]/);
  assert.doesNotMatch(service, /published_outputs|chart_aggregates|raw_metadata/);
  assert.doesNotMatch(home, /published_outputs|chart_aggregates|raw_metadata/);
});

test("TN insight API is budgeted, evidence-bound and persists analyzed mentions in Data OS", async () => {
  const [route, service, worker] = await Promise.all([
    readFile(
      resolve(
        process.cwd(),
        "src/app/api/data-os/signal/[workspaceId]/topics-narratives/insights/route.ts"
      ),
      "utf8"
    ),
    readFile(
      resolve(process.cwd(), "src/lib/data-os/signal-taxonomy-insights.ts"),
      "utf8"
    ),
    readFile(
      resolve(
        process.cwd(),
        "../../services/workers/src/workers/signal-taxonomy-insights.ts"
      ),
      "utf8"
    )
  ]);
  assert.match(route, /loadSignalWorkspaceContext/);
  assert.match(route, /loadSignalWorkspaceContextForManagement/);
  assert.match(route, /budget_cap_usd/);
  assert.match(service, /rolling window of at most thirty days|shiftIsoDate\(dateThrough, -29\)/);
  assert.match(service, /selectSignalTaxonomyInsightMentionSampleV1/);
  assert.match(service, /tag\.review_status = 'approved'/);
  assert.match(service, /cardinality\(topic_keys\) > 0/);
  assert.match(service, /record_feature_values/);
  assert.match(worker, /supporting_mention_ids/);
  assert.match(worker, /record_feature_values/);
  assert.match(worker, /analyzed_not_cited/);
  assert.match(worker, /anthropic:web_search/);
  assert.match(worker, /BEGIN/);
  assert.match(worker, /COMMIT/);
  assert.doesNotMatch(`${route}\n${service}\n${worker}`, /published_outputs\.payload/);
});

test("Laika taxonomy backfill resolves governed scope and requires human and budget approvals", async () => {
  const source = await readFile(
    resolve(process.cwd(), "scripts/backfill-signal-topics-narratives.ts"),
    "utf8"
  );
  assert.match(source, /output\.study_corpus_id = corpus\.id/);
  assert.match(source, /membership\.role = 'operational'/);
  assert.match(source, /active_operational_memberships !== 1/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED/);
  assert.match(source, /--budget-cap-usd is required for --apply/);
  assert.match(source, /signal-taxonomy-backfill-v1/);
  assert.match(source, /ON CONFLICT \(idempotency_key\) DO UPDATE/);
  assert.match(source, /paid_provider_invoked: false/);
  assert.doesNotMatch(source, /output\.payload/);
  assert.doesNotMatch(source, /chart_aggregates/);
});

test("bulk TN tag review records one audit event per pending tag and materializes without LLMs", async () => {
  const source = await readFile(
    resolve(process.cwd(), "scripts/review-signal-taxonomy-tags.ts"),
    "utf8"
  );
  assert.match(source, /INSERT INTO tag_review_events/);
  assert.match(source, /SET review_status = 'approved'/);
  assert.match(source, /review_status = 'pending'/);
  assert.match(source, /signal_data_invalidations/);
  assert.match(source, /signalMaterializationJob/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_TAG_REVIEW_APPROVED/);
  assert.doesNotMatch(
    source,
    /published_outputs\.payload|chart_aggregates|generateObject|anthropic/
  );
});

const governedWorkspace: ResolvedSignalWorkspace = {
  contractVersion: "signal-backend-v1",
  id: SIGNAL_WORKSPACE_FIXTURE_IDS.workspace,
  organizationId: SIGNAL_WORKSPACE_FIXTURE_IDS.organization,
  slug: "fixture-brand",
  name: "Fixture brand",
  subject: { type: "brand", id: SIGNAL_WORKSPACE_FIXTURE_IDS.brand },
  timezone: "America/Mexico_City",
  status: "active",
  corpora: []
};

const servingIdsByModule = {
  "brand-monitoring": {
    binding: "71000000-0000-4000-8000-000000000011",
    population: "71000000-0000-4000-8000-000000000012",
    compilation: "71000000-0000-4000-8000-000000000013"
  },
  mentions: {
    binding: "71000000-0000-4000-8000-000000000021",
    population: "71000000-0000-4000-8000-000000000022",
    compilation: "71000000-0000-4000-8000-000000000023"
  },
  "topics-narratives": {
    binding: "71000000-0000-4000-8000-000000000031",
    population: "71000000-0000-4000-8000-000000000032",
    compilation: "71000000-0000-4000-8000-000000000033"
  }
} as const;

function governedServingDescriptor(
  moduleKey: "brand-monitoring" | "mentions" | "topics-narratives",
  membershipDigit = "3"
): SignalServingScopeDescriptorV1 {
  const ids = servingIdsByModule[moduleKey];
  const usagePurposes = moduleKey === "mentions"
    ? ["client-mention-list", "client-text-or-excerpt"] as const
    : ["client-derived-metrics"] as const;
  return {
    contract_version: "signal-serving-scope-v1",
    workspace_id: governedWorkspace.id,
    module_key: moduleKey,
    view_key: "brand",
    rollout_mode: "governed",
    resolution_source: "governed-binding",
    visible_source: "governed-binding",
    binding: {
      workspace_id: governedWorkspace.id,
      binding_id: ids.binding,
      binding_version: 1,
      module_key: moduleKey,
      view_key: "brand"
    },
    policy: {
      workspace_id: governedWorkspace.id,
      policy_bundle_id: "71000000-0000-4000-8000-000000000001",
      policy_key: "operational-brand-governed",
      policy_version: 1,
      definition_hash: `sha256:${"1".repeat(64)}`
    },
    population: {
      population_id: ids.population,
      population_key: `${moduleKey}-brand-governed`,
      population_version: 1,
      definition_hash: `sha256:${"2".repeat(64)}`,
      membership_digest: `sha256:${membershipDigit.repeat(64)}`,
      policy_compilation_id: ids.compilation,
      compiled_plan_hash: `sha256:${"4".repeat(64)}`,
      compilation_status: "ready"
    },
    compilation: {
      policy_compilation_id: ids.compilation,
      compiled_plan_hash: `sha256:${"4".repeat(64)}`,
      compilation_status: "ready"
    },
    visibility_class: "client-safe",
    usage_purposes: [...usagePurposes],
    watermark: {
      availability: "available",
      data_watermark_hash: `sha256:${"5".repeat(64)}`,
      source_watermark_hash: `sha256:${"6".repeat(64)}`,
      governance_digest: `sha256:${"7".repeat(64)}`,
      captured_at: "2026-08-12T12:00:00.000Z",
      next_policy_transition_at: null
    },
    freshness: {
      state: "fresh",
      invalidation_state: "valid",
      invalidated_at: null
    },
    coverage: {
      state: "partial",
      captured: { availability: "available", count: 220 },
      quality_eligible: { availability: "available", count: 210 },
      unreviewed: { availability: "available", count: 10 },
      reviewed: { availability: "available", count: 210 },
      resolved_attributed: { availability: "available", count: 205 },
      abstained: { availability: "not_available", count: null },
      unattributed: { availability: "available", count: 5 },
      used_by_view: { availability: "available", count: 201 }
    },
    denominator: {
      key: "eligible-canonical-roots",
      unit: "canonical-root",
      count: 201,
      deduplication_policy: "canonical-root"
    },
    period: {
      start: "2026-06-01",
      end: "2026-06-30",
      timezone: "America/Mexico_City"
    }
  };
}

test("materialization responses attach governed authority without changing legacy payload or ETag", async () => {
  const payload = {
    contract_version: "signal-backend-v1",
    freshness: { state: "fresh" },
    points: [{ period: "2026-06-01", value: 2 }]
  };
  const result = { status: "ready" as const, payload, etagSeed: "existing-etag-seed" };
  const legacy = signalMaterializationResultResponse(
    new Request("https://studio.test/series"),
    result
  );
  assert.deepEqual(await legacy.json(), payload);

  const shadow = signalMaterializationResultResponse(
    new Request("https://studio.test/series"),
    result,
    { servingScope: null }
  );
  assert.deepEqual(await shadow.json(), payload);
  assert.equal(shadow.headers.get("etag"), legacy.headers.get("etag"));

  const governed = signalMaterializationResultResponse(
    new Request("https://studio.test/series"),
    result,
    { servingScope: governedServingDescriptor("brand-monitoring") }
  );
  assert.deepEqual(await governed.json(), {
    ...payload,
    serving_scope: governedServingDescriptor("brand-monitoring")
  });
  assert.notEqual(governed.headers.get("etag"), legacy.headers.get("etag"));
});

function governedOperationalScope(
  moduleKey: "brand-monitoring" | "mentions" | "topics-narratives"
): SignalOperationalReadScopeV1 {
  const descriptor = governedServingDescriptor(moduleKey);
  return {
    descriptor: {
      contract_version: "signal-workspace-data-plane-v1",
      workspace_id: governedWorkspace.id,
      mode: "governed",
      visible_source: "governed_population",
      policy_key: "operational-primary-brand",
      population: {
        id: descriptor.population.population_id,
        key: descriptor.population.population_key,
        version: descriptor.population.population_version,
        definition_hash: descriptor.population.definition_hash,
        acceptance_status: "included",
        allowed_scopes: ["primary_brand"]
      },
      legacy_corpus_id: null
    },
    workspace: governedWorkspace,
    mode: "governed",
    visibleSource: "governed_population",
    legacyCorpus: null,
    population: {
      id: descriptor.population.population_id,
      key: descriptor.population.population_key,
      version: descriptor.population.population_version,
      definition_hash: descriptor.population.definition_hash,
      acceptance_status: "included",
      allowed_scopes: ["primary_brand"],
      quality_contract_status: "resolved",
      quality_policy_key: "fixture-quality",
      quality_policy_version: 1,
      min_quality_score: null,
      required_quality_flags: [],
      forbidden_quality_flags: [],
      period_start: null,
      period_end: null,
      timezone: null
    }
  };
}

function mentionRow(index: number, totalCount: number) {
  const tail = String(index).padStart(12, "0");
  return {
    subject_id: `72000000-0000-4000-8000-${tail}`,
    occurred_at: new Date(Date.UTC(2026, 5, 30, 23, 59, 59 - (index % 59))),
    text_snippet: `fixture-${index}`,
    title: null,
    url: null,
    platform: "instagram",
    language: "es",
    country: "mx",
    content_type: "root_post",
    sentiment: "neutral" as const,
    sentiment_score: 0,
    engagement: {},
    thread_key: `thread-${index}`,
    tags: [],
    entities: [],
    features: [],
    attribution: [],
    tb_classification: null,
    tb_analysis_status: null,
    total_count: totalCount
  };
}

test("governed Mentions cursor and ETag identity stay stable beyond 100 and reject scope reuse", async () => {
  const servingScope = governedServingDescriptor("mentions");
  const readScope = governedOperationalScope("mentions");
  let queryCount = 0;
  const queryable = {
    async query<Row extends Record<string, unknown>>() {
      queryCount += 1;
      const start = queryCount === 1 ? 1 : 102;
      return {
        rows: Array.from({ length: 101 }, (_, offset) => (
          mentionRow(start + offset, 202)
        )) as unknown as Row[],
        rowCount: 101
      };
    }
  };
  const first = await loadSignalMentionsV1({
    workspace: governedWorkspace,
    readScope,
    servingScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    limit: 100,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true,
    queryable
  });
  assert.equal(first.records.length, 100);
  assert.ok(first.page.next_cursor);
  const second = await loadSignalMentionsV1({
    workspace: governedWorkspace,
    readScope,
    servingScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    cursor: first.page.next_cursor,
    limit: 100,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true,
    queryable
  });
  assert.equal(second.records.length, 100);
  assert.equal(new Set([
    ...first.records.map((record) => record.subject_id),
    ...second.records.map((record) => record.subject_id)
  ]).size, 200);
  const initialTokens = signalMentionsServingTokensV1({
    servingScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    sort: { field: "published", direction: "desc" }
  });
  const changedScope = governedServingDescriptor("mentions", "8");
  const changedTokens = signalMentionsServingTokensV1({
    servingScope: changedScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    sort: { field: "published", direction: "desc" }
  });
  assert.notEqual(initialTokens.etag_seed, changedTokens.etag_seed);
  assert.notEqual(initialTokens.cursor_isolation_hash, changedTokens.cursor_isolation_hash);
  await assert.rejects(loadSignalMentionsV1({
    workspace: governedWorkspace,
    readScope,
    servingScope: changedScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    cursor: first.page.next_cursor,
    limit: 100,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true,
    queryable
  }), /cursor does not match/iu);
  assert.equal(queryCount, 2, "scope-rejected cursor must not execute SQL");
});

test("rollback to legacy rejects governed cursors before SQL and keeps validators isolated", async () => {
  const servingScope = governedServingDescriptor("mentions");
  const governedReadScope = governedOperationalScope("mentions");
  let queryCount = 0;
  const first = await loadSignalMentionsV1({
    workspace: governedWorkspace,
    readScope: governedReadScope,
    servingScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    limit: 2,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queryCount += 1;
        return {
          rows: [mentionRow(1, 3), mentionRow(2, 3), mentionRow(3, 3)] as unknown as Row[],
          rowCount: 3
        };
      }
    }
  });
  assert.ok(first.page.next_cursor);
  const legacyCorpus = {
    id: "72000000-0000-4000-8000-000000000099",
    name: "Legacy operational",
    role: "operational" as const,
    status: "active" as const,
    validFrom: "2026-01-01T00:00:00.000Z",
    methodologySlug: "signal-v2",
    outputId: null
  };
  const legacyReadScope: SignalOperationalReadScopeV1 = {
    descriptor: {
      contract_version: "signal-workspace-data-plane-v1",
      workspace_id: governedWorkspace.id,
      mode: "legacy",
      visible_source: "legacy_corpus",
      policy_key: "operational-primary-brand",
      population: null,
      legacy_corpus_id: legacyCorpus.id
    },
    workspace: governedWorkspace,
    mode: "legacy",
    visibleSource: "legacy_corpus",
    legacyCorpus,
    population: null
  };
  await assert.rejects(loadSignalMentionsV1({
    workspace: governedWorkspace,
    readScope: legacyReadScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    cursor: first.page.next_cursor,
    limit: 2,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queryCount += 1;
        return { rows: [] as Row[], rowCount: 0 };
      }
    }
  }), /cursor does not match/iu);
  assert.equal(queryCount, 1, "rollback cursor rejection must not query either population");

  const payload = {
    contract_version: "signal-backend-v1",
    freshness: { state: "fresh" },
    points: []
  };
  const result = { status: "ready" as const, payload, etagSeed: "same-content" };
  const governedResponse = signalMaterializationResultResponse(
    new Request("https://studio.test/series"),
    result,
    { servingScope }
  );
  const legacyResponse = signalMaterializationResultResponse(
    new Request("https://studio.test/series"),
    result
  );
  assert.notEqual(governedResponse.headers.get("etag"), legacyResponse.headers.get("etag"));
});

test("client evidence access preserves metric denominator and reports unavailable without false zeros", async () => {
  const metricReadScope = governedOperationalScope("brand-monitoring");
  const evidenceReadScope = governedOperationalScope("mentions");
  let sql = "";
  const available = await loadSignalClientEvidenceAccessV1({
    workspace: governedWorkspace,
    metricReadScope,
    evidenceReadScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    queryable: {
      async query<Row extends Record<string, unknown>>(query: string) {
        sql = query;
        return {
          rows: [{ metric_count: 8, visible_count: 5 }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  });
  assert.deepEqual(available, {
    state: "available",
    metric_denominator_count: 8,
    evidence_constituent_count: 8,
    evidence_visible_count: 5,
    evidence_withheld_count: 3,
    reason: null
  });
  assert.match(sql, /SELECT DISTINCT COALESCE\(m\.canonical_mention_id, m\.id\)/u);
  const unavailable = await loadSignalClientEvidenceAccessV1({
    workspace: governedWorkspace,
    metricReadScope,
    evidenceReadScope: null,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        return {
          rows: [{ metric_count: 8 }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  });
  assert.deepEqual(unavailable, {
    state: "not_available",
    metric_denominator_count: 8,
    evidence_constituent_count: 8,
    evidence_visible_count: null,
    evidence_withheld_count: null,
    reason: "mentions_capability_not_available"
  });

  await assert.rejects(loadSignalClientEvidenceAccessV1({
    workspace: governedWorkspace,
    metricReadScope,
    evidenceReadScope: null,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        return { rows: [] as Row[], rowCount: 0 };
      }
    }
  }), /coverage could not be measured/iu);

  await assert.rejects(loadSignalClientEvidenceAccessV1({
    workspace: governedWorkspace,
    metricReadScope,
    evidenceReadScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        return {
          rows: [{ metric_count: 4, visible_count: 5 }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  }), /inconsistent with its metric denominator/iu);
});

test("governed taxonomy evidence intersects Mentions, paginates and rejects cross-scope cursors", async () => {
  const moduleScope = governedServingDescriptor("topics-narratives");
  const mentionsScope = governedServingDescriptor("mentions");
  const readScope = governedOperationalScope("topics-narratives");
  const evidenceReadScope = governedOperationalScope("mentions");
  let queryCount = 0;
  let observedSql = "";
  const queryable = {
    async query<Row extends Record<string, unknown>>(sql: string) {
      queryCount += 1;
      observedSql = sql;
      const start = queryCount === 1 ? 1 : 102;
      return {
        rows: Array.from({ length: 101 }, (_, offset) => {
          const index = start + offset;
          return {
            mention_id: `73000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            occurred_at: new Date(Date.UTC(2026, 5, 30, 23, 59, 59 - (index % 59))),
            text_snippet: `evidence-${index}`,
            title: null,
            url: null,
            platform: "instagram",
            language: "es",
            country: "mx",
            score: "1",
            confidence: "high",
            evidence: { quotes: [] },
            model_version_id: null,
            profile_id: "73000000-0000-4000-8000-000000009999",
            import_batch_id: null,
            total_count: 202,
            metric_denominator_count: 220,
            evidence_constituent_count: 205
          };
        }) as unknown as Row[],
        rowCount: 101
      };
    }
  };
  const first = await loadSignalTaxonomyEvidenceV1({
    workspace: governedWorkspace,
    readScope,
    evidenceReadScope,
    servingScope: moduleScope,
    evidenceServingScope: mentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health",
    limit: 100,
    isInternalUser: false,
    queryable
  });
  assert.equal(first.records.length, 100);
  assert.ok(first.page.next_cursor);
  assert.deepEqual(first.evidence_access, {
    state: "available",
    metric_denominator_count: 220,
    evidence_constituent_count: 205,
    evidence_visible_count: 202,
    evidence_withheld_count: 3,
    reason: null
  });
  assert.match(observedSql, /\), constituents AS/u);
  assert.match(observedSql, /JOIN mentions evidence_mention/u);
  const second = await loadSignalTaxonomyEvidenceV1({
    workspace: governedWorkspace,
    readScope,
    evidenceReadScope,
    servingScope: moduleScope,
    evidenceServingScope: mentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health",
    cursor: first.page.next_cursor,
    limit: 100,
    isInternalUser: false,
    queryable
  });
  assert.equal(second.records.length, 100);
  assert.equal(new Set([
    ...first.records.map((record) => record.mention_id),
    ...second.records.map((record) => record.mention_id)
  ]).size, 200);
  const changedMentionsScope = governedServingDescriptor("mentions", "8");
  const initialTokens = signalTaxonomyEvidenceServingTokensV1({
    servingScope: moduleScope,
    evidenceServingScope: mentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health"
  });
  const changedTokens = signalTaxonomyEvidenceServingTokensV1({
    servingScope: moduleScope,
    evidenceServingScope: changedMentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health"
  });
  assert.notEqual(initialTokens.etag_seed, changedTokens.etag_seed);
  assert.notEqual(initialTokens.cursor_isolation_hash, changedTokens.cursor_isolation_hash);
  await assert.rejects(loadSignalTaxonomyEvidenceV1({
    workspace: governedWorkspace,
    readScope,
    evidenceReadScope,
    servingScope: moduleScope,
    evidenceServingScope: changedMentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health",
    cursor: first.page.next_cursor,
    limit: 100,
    isInternalUser: false,
    queryable
  }), /cursor does not match/iu);
  assert.equal(queryCount, 2, "scope-rejected evidence cursor must not execute SQL");
});

test("governed taxonomy withholds evidence when Mentions capability is unavailable and isolates its validators", async () => {
  const moduleScope = governedServingDescriptor("topics-narratives");
  const mentionsScope = governedServingDescriptor("mentions");
  const readScope = governedOperationalScope("topics-narratives");
  const availableTokens = signalTaxonomyEvidenceServingTokensV1({
    servingScope: moduleScope,
    evidenceServingScope: mentionsScope,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health"
  });
  const withheldTokens = signalTaxonomyEvidenceServingTokensV1({
    servingScope: moduleScope,
    evidenceServingScope: null,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health"
  });
  assert.notEqual(withheldTokens.etag_seed, availableTokens.etag_seed);
  assert.notEqual(withheldTokens.cursor_isolation_hash, availableTokens.cursor_isolation_hash);

  let queryCount = 0;
  const withheld = await loadSignalTaxonomyEvidenceV1({
    workspace: governedWorkspace,
    readScope,
    evidenceReadScope: null,
    servingScope: moduleScope,
    evidenceServingScope: null,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health",
    limit: 100,
    isInternalUser: false,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queryCount += 1;
        return {
          rows: [{
            mention_id: null,
            occurred_at: null,
            profile_id: null,
            total_count: 0,
            metric_denominator_count: 220,
            evidence_constituent_count: 205
          }] as unknown as Row[],
          rowCount: 1
        };
      }
    }
  });
  assert.equal(queryCount, 1);
  assert.deepEqual(withheld.records, []);
  assert.deepEqual(withheld.evidence_access, {
    state: "not_available",
    metric_denominator_count: 220,
    evidence_constituent_count: 205,
    evidence_visible_count: null,
    evidence_withheld_count: null,
    reason: "mentions_capability_not_available"
  });
  assert.equal(withheld.page.total_count, 0);

  const availableCursor = Buffer.from(JSON.stringify({
    contract_version: "signal-backend-v1",
    metric_key: "topic.volume",
    filters_hash: availableTokens.cursor_isolation_hash,
    direction: "next",
    sort: {
      occurred_at: "2026-06-30T23:59:59.000Z",
      subject_id: "73000000-0000-4000-8000-000000000001"
    }
  }), "utf8").toString("base64url");
  await assert.rejects(loadSignalTaxonomyEvidenceV1({
    workspace: governedWorkspace,
    readScope,
    evidenceReadScope: null,
    servingScope: moduleScope,
    evidenceServingScope: null,
    filter: SIGNAL_FILTER_FIXTURE_V1,
    kind: "topic",
    termKey: "pet_health",
    cursor: availableCursor,
    limit: 100,
    isInternalUser: false,
    queryable: {
      async query<Row extends Record<string, unknown>>() {
        queryCount += 1;
        return { rows: [] as Row[], rowCount: 0 };
      }
    }
  }), /cursor does not match/iu);
  assert.equal(queryCount, 1, "capability-scoped cursor must be rejected before SQL");
});

test("module routes finalize and expose governed authority only on the governed branch", async () => {
  const routeRoot = resolve(process.cwd(), "src/app/api/data-os/signal/[workspaceId]");
  const jsonRoutes = [
    "bootstrap/route.ts",
    "facets/route.ts",
    "interpretations/route.ts",
    "lineage/route.ts",
    "metric-groups/route.ts",
    "topics-narratives/[kind]/[termKey]/route.ts",
    "topics-narratives/[kind]/[termKey]/lineage/route.ts",
    "topics-narratives/insights/route.ts"
  ];
  for (const routeName of jsonRoutes) {
    const source = await readFile(resolve(routeRoot, routeName), "utf8");
    assert.match(source, /rollout_mode === "governed"/u, routeName);
    assert.match(source, /finalizeServingScope/u, routeName);
    assert.match(source, /serving_scope/u, routeName);
    assert.match(source, /signalModuleServingEtagSeedV1/u, routeName);
  }
  for (const routeName of [
    "series/route.ts",
    "breakdowns/route.ts",
    "comparison/route.ts"
  ]) {
    const source = await readFile(resolve(routeRoot, routeName), "utf8");
    assert.match(source, /rollout_mode === "governed"/u, routeName);
    assert.match(source, /finalizeServingScope/u, routeName);
    assert.match(source, /signalMaterializationResultResponse\([\s\S]*\{ servingScope \}/u, routeName);
  }
});

test("visible canary contracts keep serving authority server-owned across HTTP and SSR", async () => {
  const routeRoot = resolve(process.cwd(), "src/app/api/data-os/signal/[workspaceId]");
  const [monitoring, mentions, topics, termDetail, evidence, lineage, workspacePage] = await Promise.all([
    readFile(resolve(routeRoot, "brand-monitoring/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "mentions/route.ts"), "utf8"),
    readFile(resolve(routeRoot, "topics-narratives/route.ts"), "utf8"),
    readFile(resolve(
      routeRoot,
      "topics-narratives/[kind]/[termKey]/route.ts"
    ), "utf8"),
    readFile(resolve(
      routeRoot,
      "topics-narratives/[kind]/[termKey]/evidence/route.ts"
    ), "utf8"),
    readFile(resolve(
      routeRoot,
      "topics-narratives/[kind]/[termKey]/lineage/route.ts"
    ), "utf8"),
    readFile(resolve(
      process.cwd(),
      "src/components/signal-v2/SignalV2WorkspacePage.tsx"
    ), "utf8")
  ]);
  const expectedModules = [
    [monitoring, "brand-monitoring"],
    [mentions, "mentions"],
    [topics, "topics-narratives"]
  ] as const;
  for (const [source, moduleKey] of expectedModules) {
    assert.match(
      source,
      new RegExp(`loadSignalWorkspaceModuleContext\\(workspaceId, "${moduleKey}", request\\)`, "u")
    );
    assert.match(source, /serving_scope/u);
    assert.doesNotMatch(
      source,
      /searchParams\.get\(["'](?:population_id|policy_bundle_id|binding_id|read_mode|rollout_mode)["']\)/u
    );
    assert.doesNotMatch(
      source,
      /UPDATE\s+signal_workspace_population_pointers|promote_signal_governed_view_binding/iu
    );
  }
  assert.match(monitoring, /resolveSignalClientEvidenceServingScopeV1/u);
  assert.match(evidence, /resolveSignalClientEvidenceServingScopeV1/u);
  assert.match(evidence, /evidence_serving_scope/u);
  for (const timedRoute of [monitoring, mentions, topics, termDetail, evidence, lineage]) {
    assert.match(timedRoute, /Server-Timing/u);
    assert.match(timedRoute, /signal-visible/u);
  }
  assert.match(workspacePage, /brandMonitoringServingDescriptor/u);
  assert.match(workspacePage, /mentionsServingDescriptor/u);
  assert.match(workspacePage, /topicsNarrativesServingDescriptor/u);
  assert.match(workspacePage, /serving_scope: brandMonitoringServingDescriptor/u);
  assert.match(workspacePage, /serving_scope: mentionsServingDescriptor/u);
  assert.match(workspacePage, /serving_scope: topicsNarrativesServingDescriptor/u);
  assert.doesNotMatch(
    workspacePage,
    /query\.(?:population_id|policy_bundle_id|binding_id|read_mode|rollout_mode)/u
  );

  for (const key of [
    "population_id",
    "policy_bundle_id",
    "binding_id",
    "read_mode",
    "rollout_mode"
  ]) {
    const params = new URLSearchParams({
      start: "2026-06-01",
      end: "2026-06-30",
      [key]: "untrusted-client-selection"
    });
    assert.throws(
      () => parseSignalApiFilterV1(params, "UTC"),
      /unsupported signal dimension/iu,
      key
    );
  }
});
