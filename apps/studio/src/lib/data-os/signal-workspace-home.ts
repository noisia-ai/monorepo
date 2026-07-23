import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  signalDefaultWorkspaceHomeFilterV1,
  signalFiltersHashV1,
  type SignalFilterV1,
  type SignalWorkspaceHomeV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import {
  loadSignalBootstrapV1,
  loadSignalFacetsV1,
  loadSignalInterpretationsV1,
  loadSignalLineageV1,
  loadSignalMetricGroupsV1,
  signalWorstResponseStateV1
} from "@/lib/data-os/signal-workspace-serving";
import { loadSignalStrategicReleasesV1 } from "@/lib/data-os/signal-strategic-releases";

export async function loadSignalWorkspaceHomeV1(
  workspace: ResolvedSignalWorkspace,
  isInternalUser: boolean
): Promise<SignalWorkspaceHomeV1> {
  const bootstrap = await loadSignalBootstrapV1(workspace, isInternalUser);
  const defaultFilter = defaultSignalHomeFilter(
    bootstrap.coverage.date_from,
    bootstrap.coverage.date_through,
    workspace.timezone
  );
  const basePath = `/api/data-os/signal/${workspace.id}`;

  if (!defaultFilter) {
    return {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      facade_version: "signal-workspace-home-v1",
      workspace: bootstrap.workspace,
      corpus: homeCorpus(bootstrap.corpus),
      coverage: bootstrap.coverage,
      default_filter: null,
      filters_hash: null,
      capabilities: homeCapabilities(basePath, {}),
      facets: {},
      freshness: {
        overall_state: homeState(bootstrap.state),
        data: bootstrap.data_freshness,
        interpretation: bootstrap.interpretation_freshness
      },
      metric_groups: bootstrap.metric_groups,
      interpretations: [],
      strategic: { current: null, history: [] },
      visibility: bootstrap.visibility,
      lineage: [],
      partial_states: [
        { section: "data", state: "not_available", reason: "workspace_has_no_included_mentions" },
        { section: "metrics", state: "not_available", reason: "default_filter_not_available" },
        { section: "interpretations", state: "not_available", reason: "default_filter_not_available" },
        { section: "strategic", state: "not_available", reason: "strategic_release_not_available" }
      ],
      legacy_fallback: legacyFallback(),
      state: "not_available"
    };
  }

  const [facets, metrics, interpretations, releases, lineage] = await Promise.all([
    loadSignalFacetsV1({ workspace, filter: defaultFilter, isInternalUser }),
    loadSignalMetricGroupsV1({ workspace, filter: defaultFilter, isInternalUser }),
    loadSignalInterpretationsV1({ workspace, filter: defaultFilter, isInternalUser }),
    loadSignalStrategicReleasesV1(workspace, isInternalUser),
    loadSignalLineageV1({ workspace, filter: defaultFilter, isInternalUser })
  ]);
  const strategicState = releases.current
    ? "fresh"
    : releases.history.length > 0 ? "partial" : "not_available";
  const state = homeState(signalWorstResponseStateV1([
    bootstrap.state,
    metrics.state,
    interpretations.state,
    strategicState
  ]));
  const partialStates: SignalWorkspaceHomeV1["partial_states"] = [];
  if (bootstrap.data_freshness.state !== "fresh") {
    partialStates.push({
      section: "data",
      state: bootstrap.data_freshness.state,
      reason: "data_freshness_not_fresh"
    });
  }
  if (metrics.state !== "fresh") {
    partialStates.push({
      section: "metrics",
      state: homeState(metrics.state),
      reason: "metric_groups_not_fresh"
    });
  }
  if (interpretations.state !== "fresh") {
    partialStates.push({
      section: "interpretations",
      state: homeState(interpretations.state),
      reason: "interpretations_not_fresh"
    });
  }
  if (!releases.current) {
    partialStates.push({
      section: "strategic",
      state: strategicState,
      reason: releases.history.length > 0
        ? "strategic_release_has_history_without_current"
        : "strategic_release_not_available"
    });
  }

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    facade_version: "signal-workspace-home-v1",
    workspace: bootstrap.workspace,
    corpus: homeCorpus(bootstrap.corpus),
    coverage: bootstrap.coverage,
    default_filter: defaultFilter,
    filters_hash: signalFiltersHashV1(defaultFilter),
    capabilities: homeCapabilities(basePath, {
      facets: "available",
      metric_groups: capabilityState(metrics.state),
      time_series: capabilityState(metrics.state),
      breakdowns: capabilityState(metrics.state),
      period_comparison: capabilityState(metrics.state),
      drill_down: capabilityState(metrics.state),
      interpretations: capabilityState(interpretations.state),
      strategic_releases: capabilityState(strategicState),
      lineage: capabilityState(metrics.state)
    }),
    facets: facets.facets,
    freshness: {
      overall_state: state,
      data: bootstrap.data_freshness,
      interpretation: bootstrap.interpretation_freshness
    },
    metric_groups: metrics.groups,
    interpretations: interpretations.interpretations,
    strategic: { current: releases.current, history: releases.history },
    visibility: bootstrap.visibility,
    lineage: lineage.materializations,
    partial_states: partialStates,
    legacy_fallback: legacyFallback(),
    state
  };
}

export function defaultSignalHomeFilter(
  dateFrom: string | null,
  dateThrough: string | null,
  timezone: string
): SignalFilterV1 | null {
  return signalDefaultWorkspaceHomeFilterV1(dateFrom, dateThrough, timezone);
}

function legacyFallback(): SignalWorkspaceHomeV1["legacy_fallback"] {
  return {
    identity: "outputId",
    dashboard_route_template: "/signal/{outputId}",
    api_route_template: "/api/data-os/pulse/{outputId}/*",
    source_of_truth: false
  };
}

function homeCapabilities(
  basePath: string,
  states: Partial<Record<string, "available" | "partial" | "not_available">>
): SignalWorkspaceHomeV1["capabilities"] {
  const definitions: Array<[string, string]> = [
    ["facets", "/facets"],
    ["metric_groups", "/metric-groups"],
    ["time_series", "/series"],
    ["breakdowns", "/breakdowns"],
    ["period_comparison", "/comparison"],
    ["drill_down", "/mentions"],
    ["interpretations", "/interpretations"],
    ["strategic_releases", "/releases"],
    ["lineage", "/lineage"]
  ];
  return definitions.map(([key, path]) => ({
    key,
    state: states[key] ?? "not_available",
    href: `${basePath}${path}`
  }));
}

function capabilityState(value: string): "available" | "partial" | "not_available" {
  if (value === "fresh") return "available";
  if (value === "not_available") return "not_available";
  return "partial";
}

function homeCorpus(corpus: {
  id: string;
  role: string;
  status: string;
  name: string | null;
}): SignalWorkspaceHomeV1["corpus"] {
  return {
    ...corpus,
    role: corpus.role === "operational" ? "operational" : "legacy"
  };
}

function homeState(value: string): SignalWorkspaceHomeV1["state"] {
  if (
    value === "fresh"
    || value === "stale"
    || value === "pending"
    || value === "partial"
    || value === "not_available"
  ) {
    return value;
  }
  return "partial";
}
