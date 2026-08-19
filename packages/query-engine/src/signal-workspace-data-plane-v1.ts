export const SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION =
  "signal-workspace-data-plane-v1" as const;

export const SIGNAL_OPERATIONAL_READ_MODES = [
  "legacy",
  "shadow",
  "governed"
] as const;

export type SignalOperationalReadModeV1 =
  (typeof SIGNAL_OPERATIONAL_READ_MODES)[number];

export type SignalOperationalReadScopeDescriptorV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  mode: SignalOperationalReadModeV1;
  visible_source: "legacy_corpus" | "governed_population";
  /**
   * Server-resolved policy identity. Legacy operational reads retain the
   * compatibility key; governed reads carry the exact bound bundle key.
   * This value is descriptive authority and is never accepted from clients.
   */
  policy_key: string;
  population: {
    id: string;
    key: string;
    version: number;
    definition_hash: string;
    acceptance_status: "included";
    allowed_scopes: SignalMentionScopeV1[];
  } | null;
  legacy_corpus_id: string | null;
};

export const SIGNAL_MENTION_SCOPES = [
  "primary_brand",
  "competitor",
  "category",
  "reference",
  "unattributed"
] as const;

export type SignalMentionScopeV1 = (typeof SIGNAL_MENTION_SCOPES)[number];

export type SignalWorkspaceDataSourceContractV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  data_source_id: string;
  provider: string;
  source_type: string;
  connection_method: string;
  status: "draft" | "active" | "paused" | "failed" | "archived";
};

export type SignalWorkspaceImportContractV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  import_batch_id: string;
  data_source_id: string;
  contributed_by_study_corpus_id: string | null;
  scope: SignalMentionScopeV1;
  status: "queued" | "processing" | "completed" | "failed";
};

export type SignalCanonicalMentionIdentityV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  mention_id: string;
  canonical_mention_id: string;
  source_system: string;
  provider_record_id: string;
  data_source_id: string;
};

export type SignalMentionAttributionContractV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  mention_id: string;
  scope: SignalMentionScopeV1;
  entity_type: "brand" | "competitor" | "category" | "reference" | "unattributed";
  entity_id: string | null;
  confidence: number | null;
  review_status: "pending" | "approved" | "rejected";
  policy_version: string;
};

export type SignalGovernedPopulationIdentityV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  population_id: string;
  population_key: string;
  version: number;
  definition_hash: string;
  acceptance_status: "included";
  allowed_scopes: SignalMentionScopeV1[];
};

export type SignalSnapshotIdentityV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  snapshot_id: string;
  population_id: string;
  population_version: number;
  definition_hash: string;
  period_start: string;
  period_end: string;
  mention_count: number;
  watermark_captured_at: string;
};

export type SignalWorkspaceReportIdentityV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION;
  workspace_id: string;
  report_key: string;
  current_release_id: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SCOPE_SET = new Set<string>(SIGNAL_MENTION_SCOPES);
const READ_MODE_SET = new Set<string>(SIGNAL_OPERATIONAL_READ_MODES);

export function resolveSignalOperationalReadModeV1(
  input: unknown
): SignalOperationalReadModeV1 {
  const normalized = String(input ?? "").trim().toLowerCase();
  return READ_MODE_SET.has(normalized)
    ? normalized as SignalOperationalReadModeV1
    : "legacy";
}

export function normalizeSignalMentionScopeV1(input: unknown): SignalMentionScopeV1 {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (!SCOPE_SET.has(normalized)) {
    throw new Error(`scope must be one of: ${SIGNAL_MENTION_SCOPES.join(", ")}`);
  }
  return normalized as SignalMentionScopeV1;
}

export function validateSignalWorkspaceSourceInputV1(input: unknown) {
  const row = requireRecord(input, "source");
  return {
    name: requiredText(row.name, "name", 160),
    provider: requiredKey(row.provider, "provider"),
    source_type: requiredKey(row.source_type, "source_type"),
    connection_method: requiredKey(row.connection_method, "connection_method"),
    scope: normalizeSignalMentionScopeV1(row.scope),
    entity_id: nullableUuid(row.entity_id, "entity_id")
  };
}

export function validateSignalWorkspaceImportInputV1(input: {
  scope: unknown;
  contributed_by_study_corpus_id?: unknown;
}) {
  return {
    scope: normalizeSignalMentionScopeV1(input.scope),
    contributed_by_study_corpus_id: nullableUuid(
      input.contributed_by_study_corpus_id,
      "contributed_by_study_corpus_id"
    )
  };
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${field} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function requiredText(input: unknown, field: string, maxLength: number) {
  const value = String(input ?? "").trim();
  if (!value || value.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters.`);
  }
  return value;
}

function requiredKey(input: unknown, field: string) {
  const value = requiredText(input, field, 80).toLowerCase();
  if (!KEY_PATTERN.test(value)) {
    throw new Error(`${field} must be a canonical kebab-case key.`);
  }
  return value;
}

function nullableUuid(input: unknown, field: string) {
  if (input == null || input === "") return null;
  const value = String(input).trim().toLowerCase();
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
  return value;
}
