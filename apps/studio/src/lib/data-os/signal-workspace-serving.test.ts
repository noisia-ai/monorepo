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
  SIGNAL_FILTER_FIXTURE_V1,
  SIGNAL_SERIES_FIXTURE_V1,
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

test("Signal workspace fixtures satisfy the shared series and breakdown contract", () => {
  assert.deepEqual(validateSignalTimeSeriesV1(SIGNAL_SERIES_FIXTURE_V1), SIGNAL_SERIES_FIXTURE_V1);
  assert.deepEqual(validateSignalBreakdownV1(SIGNAL_BREAKDOWN_FIXTURE_V1), SIGNAL_BREAKDOWN_FIXTURE_V1);
  assert.equal(SIGNAL_SERIES_FIXTURE_V1.filters_hash, signalFiltersHashV1(SIGNAL_FILTER_FIXTURE_V1));
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
  const sources = await Promise.all(routeNames.map((name) => readFile(resolve(routeRoot, name, "route.ts"), "utf8")));
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
  assert.match(pulseMetrics, /loadDataOsPulseContext/);
  assert.match(fixtureSource, /SignalTimeSeriesV1/);
  assert.match(fixtureSource, /SignalBreakdownV1/);
});
