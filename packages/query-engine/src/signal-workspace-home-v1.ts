import type {
  DataFreshnessStateV1,
  InterpretationFreshnessStateV1,
  SignalDimensionV1,
  SignalFilterV1,
  SignalMetricValueStateV1
} from "./signal-backend-v1";

export type SignalWorkspaceHomeStateV1 =
  | DataFreshnessStateV1
  | InterpretationFreshnessStateV1;

export type SignalWorkspaceHomeV1 = {
  contract_version: "signal-backend-v1";
  facade_version: "signal-workspace-home-v1";
  workspace: {
    workspace_id: string;
    workspace_slug: string;
    organization_id: string;
    subject: { type: "brand" | "theme"; id: string };
    timezone: string;
    status: string;
  };
  corpus: {
    id: string;
    role: "operational" | "legacy";
    status: string;
    name: string | null;
  };
  coverage: {
    date_from: string | null;
    date_through: string | null;
    mentions: number;
  };
  default_filter: SignalFilterV1 | null;
  filters_hash: string | null;
  capabilities: Array<{
    key: string;
    state: "available" | "partial" | "not_available";
    href: string;
  }>;
  facets: Partial<Record<SignalDimensionV1, Array<{ key: string; count: number }>>>;
  freshness: {
    overall_state: SignalWorkspaceHomeStateV1;
    data: Record<string, unknown>;
    interpretation: Record<string, unknown>;
  };
  metric_groups: Array<Record<string, unknown>>;
  interpretations: Array<Record<string, unknown>>;
  strategic: {
    current: Record<string, unknown> | null;
    history: Array<Record<string, unknown>>;
  };
  visibility: {
    internal: boolean;
    source_type: boolean;
    quality_details: boolean;
  };
  lineage: Array<Record<string, unknown>>;
  partial_states: Array<{
    section: "data" | "metrics" | "interpretations" | "strategic";
    state: SignalWorkspaceHomeStateV1 | SignalMetricValueStateV1;
    reason: string;
  }>;
  legacy_fallback: {
    identity: "outputId";
    dashboard_route_template: "/signal/{outputId}";
    api_route_template: "/api/data-os/pulse/{outputId}/*";
    source_of_truth: false;
  };
  state: SignalWorkspaceHomeStateV1;
};

export function signalDefaultWorkspaceHomeFilterV1(
  dateFrom: string | null,
  dateThrough: string | null,
  timezone: string
): SignalFilterV1 | null {
  if (!dateFrom || !dateThrough || dateFrom > dateThrough) return null;
  const monthStart = `${dateThrough.slice(0, 7)}-01`;
  return {
    contract_version: "signal-backend-v1",
    date_range: { start: monthStart < dateFrom ? dateFrom : monthStart, end: dateThrough },
    timezone,
    granularity: "day",
    dimensions: {}
  };
}
