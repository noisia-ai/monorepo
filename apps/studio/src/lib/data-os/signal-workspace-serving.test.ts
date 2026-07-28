import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  signalFiltersHashV1,
  validateSignalBreakdownV1,
  validateSignalTimeSeriesV1
} from "@noisia/query-engine";

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
  parseSignalApiFilterV1,
  signalJsonResponse,
  signalWorstResponseStateV1,
  summarizeSignalMetricPointsV1
} = await import("./signal-workspace-serving");
const { defaultSignalHomeFilter } = await import("./signal-workspace-home");
const {
  aggregateSignalTaxonomyServingFixtureV1,
  signalTaxonomyComparisonRangeV1,
  signalTaxonomyKindV1,
  signalTaxonomyTermKeyV1
} = await import("./signal-topics-narratives-serving");

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
    subject: { type: "brand" as const, id: SIGNAL_WORKSPACE_FIXTURE_IDS.brand },
    timezone: "America/Mexico_City",
    status: "active",
    corpora: [{
      id: SIGNAL_WORKSPACE_FIXTURE_IDS.corpus,
      name: "Fixture",
      role: "operational" as const,
      status: "corpus_approved",
      validFrom: "2026-07-01T00:00:00.000Z"
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
  assert.equal("response" in ambiguous ? ambiguous.response?.status : 0, 409);
  assert.equal(
    "response" in ambiguous
      ? (await ambiguous.response?.json())?.details?.reason
      : null,
    "multiple_active_operational_corpora"
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
    assert.match(source, /loadSignalWorkspaceContext/);
    assert.doesNotMatch(source, /published_outputs|payload\.payload|raw_metadata/u);
  }
  assert.doesNotMatch(service, /published_outputs|raw_metadata|chart_aggregates/u);
  assert.match(service, /FROM metric_materializations/);
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

test("TN promotion reconciles profiles, excludes pending tags and invalidates approved review changes", async () => {
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
  assert.match(review, /INSERT INTO tag_review_events/);
  assert.match(review, /taxonomy_review_changed/);
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
    assert.match(route, /loadSignalWorkspaceContext/);
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /published_outputs|chart_aggregates|raw_metadata/);
  }
  assert.match(service, /FROM metric_materializations/);
  assert.match(service, /buildSignalMentionPredicateV1/);
  assert.match(service, /tag\.review_status = 'approved'/);
  assert.match(service, /JOIN signal_taxonomy_profiles profile/);
  assert.match(service, /profile\.workspace_id =/);
  assert.match(service, /profile\.status = 'active'/);
  assert.match(service, /cooccurrence_not_causality/);
  assert.match(worker, /'mention'.*'record_tag'/s);
  assert.match(worker, /'signal_taxonomy_profile'.*'record_tag'/s);
  assert.match(worker, /INSERT INTO lineage_edges/);
  assert.match(home, /loadSignalTopicsNarrativesOverviewV1/);
  assert.match(home, /topics_narratives: topicsNarratives/);
  assert.match(home, /\["topics_narratives", "\/topics-narratives"\]/);
  assert.doesNotMatch(service, /published_outputs|chart_aggregates|raw_metadata/);
  assert.doesNotMatch(home, /published_outputs|chart_aggregates|raw_metadata/);
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
