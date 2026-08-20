import { createHash, createHmac } from "node:crypto";

import {
  auditSignalSemanticResolutionPreflightAuthorityV2,
  loadSignalSemanticResolutionPreflightDataV2
} from "@noisia/db";
import type { PoolClient } from "pg";

export const SIGNAL_SEMANTIC_BENCHMARK_EXPORT_CONTRACT =
  "signal-semantic-benchmark-export-v1" as const;
export const SIGNAL_SEMANTIC_BENCHMARK_RECORD_CONTRACT =
  "signal-semantic-benchmark-record-v1" as const;
export const SIGNAL_SEMANTIC_BENCHMARK_EXPORT_V2_CONTRACT =
  "signal-semantic-benchmark-export-v2" as const;
export const SIGNAL_SEMANTIC_BENCHMARK_RECORD_V2_CONTRACT =
  "signal-semantic-benchmark-record-v2" as const;

type Digest = `sha256:${string}`;

export type SignalSemanticBenchmarkFrozenPartitionV2 = {
  key: string;
  scope: "primary_brand" | "competitor" | "category" | "reference";
  entity_ref: Digest;
  declared_market: string;
  total: number;
  included: number;
  excluded: number;
  population_digest: Digest;
  modeling_digest: Digest;
  plan_version: number;
  plan_digest: Digest;
  slot_digest: Digest;
};

export type SignalSemanticBenchmarkFrozenCorpusV2 = {
  identity: string;
  acquisition_denominator: number;
  included_modeling_population: number;
  quality_excluded_roots: number;
  population_digest: Digest;
  content_digest: Digest;
  provenance_digest: Digest;
  watermark_digest: Digest;
  timezone: string;
  observed_period_local: { from: string; to: string };
  partitions: SignalSemanticBenchmarkFrozenPartitionV2[];
};

type AcquisitionRootAuthorityRowV2 = {
  mention_id: string;
  inclusion_status: string;
  published_at: string;
  text_clean: string | null;
  language: string | null;
  country: string | null;
  platform: string | null;
  canonical_alias_count: number;
  partition_key: string;
  scope: SignalSemanticBenchmarkFrozenPartitionV2["scope"];
  entity_ref: Digest;
  declared_market: string;
  plan_version: number;
  plan_digest: Digest;
  slot_digest: Digest;
  slot_key: string;
  provenance_digest: Digest;
  authority_state: string;
  authority_digest: Digest | null;
  authority_valid_until: string | null;
};

export type SignalSemanticBenchmarkRecordV2 = {
  contract_version: typeof SIGNAL_SEMANTIC_BENCHMARK_RECORD_V2_CONTRACT;
  record_key: Digest;
  canonical_family_key: Digest;
  canonical_alias_count: number;
  content_hash: Digest;
  text: string;
  published_at: string;
  month: string;
  language: string;
  country: string;
  platform: string;
  partition_memberships: Array<{
    partition_key: string;
    scope: SignalSemanticBenchmarkFrozenPartitionV2["scope"];
    entity_ref: Digest;
    declared_market: string;
    plan_version: number;
    plan_digest: Digest;
    slot_key: string;
    slot_digest: Digest;
    provenance_digest: Digest;
    authority_digest: Digest;
    authority_valid_until: string | null;
  }>;
  quality_disposition: "included";
  authority_usage: "strategic-analysis";
  authority_digest: Digest;
};

export type SignalSemanticBenchmarkExportPreflightV2 = {
  contract_version: typeof SIGNAL_SEMANTIC_BENCHMARK_EXPORT_V2_CONTRACT;
  ready: boolean;
  blockers: string[];
  corpus_identity: string;
  acquisition_denominator: number;
  modeling_population: number;
  quality_excluded_roots: number;
  partitions: Record<string, {
    scope: SignalSemanticBenchmarkFrozenPartitionV2["scope"];
    declared_market: string;
    total: number;
    included: number;
    excluded: number;
  }>;
  population_digest: Digest;
  content_digest: Digest;
  provenance_digest: Digest;
  watermark_digest: Digest;
  required_usage: "strategic-analysis";
  authority_digest: Digest | null;
  resource_estimate: {
    physical_roots: number;
    partition_memberships: number;
    estimated_private_jsonl_bytes: number | null;
  };
  transaction_read_only: true;
  transaction_id_assigned: false;
  writes_performed: false;
  provider_calls: 0;
  jobs_enqueued: 0;
  serving_writes: 0;
};

export type SignalSemanticBenchmarkExportResultV2 =
  SignalSemanticBenchmarkExportPreflightV2 & {
    ready: true;
    blockers: [];
    authority_digest: Digest;
    workspace_ref: Digest;
    export_timestamp: string;
    period_start: string;
    period_end: string;
    timezone: string;
    export_records_digest: Digest;
    exported: number;
    excluded_by_reason: { quality_excluded: number };
    language_counts: Record<string, number>;
    country_counts: Record<string, number>;
    platform_counts: Record<string, number>;
    declared_market_membership_counts: Record<string, number>;
    shared_root_count: number;
    licensing_evaluation: "allowed";
    retention_evaluation: "current";
    quality_evaluation: "current";
    protected_state_digest_before: Digest;
    protected_state_digest_after: Digest;
    records: SignalSemanticBenchmarkRecordV2[];
  };

export type SignalSemanticBenchmarkExportManifestV2 = {
  contract_version: typeof SIGNAL_SEMANTIC_BENCHMARK_EXPORT_V2_CONTRACT;
  target: "noisia-staging";
  read_only: true;
  writes_performed: false;
  provider_calls: 0;
  jobs_enqueued: 0;
  serving_writes: 0;
  workspace_ref: Digest;
  corpus_identity: string;
  export_timestamp: string;
  period_start: string;
  period_end: string;
  timezone: string;
  population_digest: Digest;
  content_digest: Digest;
  provenance_digest: Digest;
  watermark_digest: Digest;
  authority_digest: Digest;
  export_records_digest: Digest;
  schema_version: typeof SIGNAL_SEMANTIC_BENCHMARK_RECORD_V2_CONTRACT;
  acquisition_denominator: number;
  modeling_population: number;
  quality_excluded_roots: number;
  exported: number;
  excluded_by_reason: { quality_excluded: number };
  partitions: Record<string, Omit<SignalSemanticBenchmarkFrozenPartitionV2, "key">>;
  language_counts: Record<string, number>;
  country_counts: Record<string, number>;
  platform_counts: Record<string, number>;
  declared_market_membership_counts: Record<string, number>;
  shared_root_count: number;
  required_usage: "strategic-analysis";
  licensing_evaluation: "allowed";
  retention_evaluation: "current";
  quality_evaluation: "current";
  exclusion_contract: "acquisition-quality-exclusive-v2";
  protected_state_digest_before: Digest;
  protected_state_digest_after: Digest;
  transaction_read_only: true;
  transaction_id_assigned: false;
  export_file_sha256: Digest;
};

type WorkspaceRow = {
  workspace_id: string;
  timezone: string;
  current_generation: string;
  snapshot_digest: Digest;
  population_digest: Digest;
  governance_digest: Digest;
  reconciled_at: string;
  projected_root_count: number;
  dirty_root_count: number;
  full_rebuild_required: boolean;
  observed_at: string;
};

type RootAuthorityRow = {
  mention_id: string;
  published_at: string;
  language: string | null;
  country: string | null;
  platform: string;
  text_clean: string | null;
  queue_state: string | null;
  context_hash: Digest | null;
  projection_eligibility: string | null;
  projection_authority_digest: Digest | null;
  live_eligibility: string;
  live_authority_digest: Digest | null;
  authority_valid_until: string | null;
  source_intents: unknown;
};

export type SignalSemanticBenchmarkRecordV1 = {
  contract_version: typeof SIGNAL_SEMANTIC_BENCHMARK_RECORD_CONTRACT;
  record_key: Digest;
  canonical_family_key: Digest;
  content_hash: Digest;
  text: string;
  published_at: string;
  month: string;
  language: string;
  country: string;
  platform: string;
  provenance_intents: Array<{
    scope: "primary_brand" | "competitor" | "category" | "reference" | "unattributed";
    entity_ref: Digest | null;
  }>;
  queue_state: string;
  context_hash: Digest;
  authority_digest: Digest;
  authority_valid_until: string | null;
};

export type SignalSemanticBenchmarkExportResultV1 = {
  workspace_ref: Digest;
  timezone: string;
  period_start: string;
  period_end: string;
  population_digest: Digest;
  watermark_digest: Digest;
  governance_digest: Digest;
  projection_snapshot_digest: Digest;
  projection_generation: number;
  projection_reconciled_at: string;
  denominator: number;
  exported: number;
  excluded_by_reason: Record<string, number>;
  scope_counts: Record<string, number>;
  entity_counts: Record<string, number>;
  language_counts: Record<string, number>;
  platform_counts: Record<string, number>;
  protected_state_digest_before: Digest;
  protected_state_digest_after: Digest;
  transaction_read_only: true;
  transaction_id_assigned: false;
  records: SignalSemanticBenchmarkRecordV1[];
};

export async function preflightSignalSemanticBenchmarkExportV2(args: {
  client: PoolClient;
  workspaceId: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
}): Promise<SignalSemanticBenchmarkExportPreflightV2> {
  return withAcquisitionBenchmarkReadOnlyTransaction(args.client, async () => {
    const rows = await loadAcquisitionBenchmarkAuthorityRowsV2({
      client: args.client,
      workspaceId: args.workspaceId,
      frozenCorpus: args.frozenCorpus,
      includeText: false
    });
    const result = buildSignalSemanticBenchmarkPreflightV2({
      rows,
      frozenCorpus: args.frozenCorpus
    });
    return result;
  });
}

export async function exportSignalSemanticBenchmarkV2(args: {
  client: PoolClient;
  workspaceId: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  pseudonymKey: Buffer;
}): Promise<SignalSemanticBenchmarkExportResultV2> {
  if (args.pseudonymKey.byteLength < 32) {
    throw new Error("signal_benchmark_pseudonym_key_too_short");
  }
  return withAcquisitionBenchmarkReadOnlyTransaction(args.client, async () => {
    const before = await protectedStateDigest(args.client, args.workspaceId);
    const rows = await loadAcquisitionBenchmarkAuthorityRowsV2({
      client: args.client,
      workspaceId: args.workspaceId,
      frozenCorpus: args.frozenCorpus,
      includeText: true
    });
    const artifacts = buildSignalSemanticBenchmarkArtifactsV2({
      rows,
      frozenCorpus: args.frozenCorpus,
      workspaceId: args.workspaceId,
      pseudonymKey: args.pseudonymKey
    });
    const after = await protectedStateDigest(args.client, args.workspaceId);
    if (before !== after) throw new Error("signal_benchmark_protected_state_changed");
    return {
      ...artifacts,
      protected_state_digest_before: before,
      protected_state_digest_after: after
    };
  });
}

export function buildSignalSemanticBenchmarkPreflightV2(args: {
  rows: AcquisitionRootAuthorityRowV2[];
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
}): SignalSemanticBenchmarkExportPreflightV2 {
  assertFrozenCorpusV2(args.frozenCorpus);
  const rootStates = aggregateAcquisitionRowsV2(args.rows, args.frozenCorpus);
  const blockers = [...rootStates.blockers];
  if (rootStates.uniqueRoots !== args.frozenCorpus.acquisition_denominator) {
    blockers.push("acquisition_denominator_drift");
  }
  if (rootStates.includedRoots !== args.frozenCorpus.included_modeling_population) {
    blockers.push("modeling_population_drift");
  }
  if (rootStates.excludedRoots !== args.frozenCorpus.quality_excluded_roots) {
    blockers.push("quality_excluded_roots_drift");
  }
  const partitions = Object.fromEntries(args.frozenCorpus.partitions.map((partition) => {
    const observed = rootStates.partitionCounts.get(partition.key) ?? {
      total: 0,
      included: 0,
      excluded: 0
    };
    if (
      observed.total !== partition.total
      || observed.included !== partition.included
      || observed.excluded !== partition.excluded
    ) {
      blockers.push(`partition_drift:${partition.key}`);
    }
    return [partition.key, {
      scope: partition.scope,
      declared_market: partition.declared_market,
      ...observed
    }];
  }));
  const uniqueBlockers = [...new Set(blockers)].sort();
  return {
    contract_version: SIGNAL_SEMANTIC_BENCHMARK_EXPORT_V2_CONTRACT,
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    corpus_identity: args.frozenCorpus.identity,
    acquisition_denominator: rootStates.uniqueRoots,
    modeling_population: rootStates.includedRoots,
    quality_excluded_roots: rootStates.excludedRoots,
    partitions,
    population_digest: args.frozenCorpus.population_digest,
    content_digest: args.frozenCorpus.content_digest,
    provenance_digest: args.frozenCorpus.provenance_digest,
    watermark_digest: args.frozenCorpus.watermark_digest,
    required_usage: "strategic-analysis",
    authority_digest: rootStates.authorityDigest,
    resource_estimate: {
      physical_roots: rootStates.includedRoots,
      partition_memberships: rootStates.includedMemberships,
      estimated_private_jsonl_bytes: null
    },
    transaction_read_only: true,
    transaction_id_assigned: false,
    writes_performed: false,
    provider_calls: 0,
    jobs_enqueued: 0,
    serving_writes: 0
  };
}

export function buildSignalSemanticBenchmarkArtifactsV2(args: {
  rows: AcquisitionRootAuthorityRowV2[];
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  workspaceId: string;
  pseudonymKey: Buffer;
}): Omit<
  SignalSemanticBenchmarkExportResultV2,
  "protected_state_digest_before" | "protected_state_digest_after"
> {
  const preflight = buildSignalSemanticBenchmarkPreflightV2(args);
  if (!preflight.ready || !preflight.authority_digest) {
    throw new Error(`signal_benchmark_acquisition_authority_blocked:${preflight.blockers.join(",")}`);
  }
  const grouped = groupAcquisitionRowsByRoot(args.rows);
  const records: SignalSemanticBenchmarkRecordV2[] = [];
  const languageCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const marketCounts: Record<string, number> = {};
  let sharedRootCount = 0;
  for (const rows of grouped.values()) {
    const included = rows.filter((row) => row.inclusion_status === "included");
    if (included.length === 0) continue;
    const first = included[0]!;
    if (!first.text_clean) throw new Error("signal_benchmark_text_not_loaded");
    const text = normalizeBenchmarkText(first.text_clean);
    if (!text) throw new Error("signal_benchmark_text_empty");
    const memberships = included.map((row) => {
      if (row.authority_state !== "eligible" || !row.authority_digest) {
        throw new Error("signal_benchmark_acquisition_authority_incomplete");
      }
      increment(marketCounts, row.declared_market);
      return {
        partition_key: row.partition_key,
        scope: row.scope,
        entity_ref: row.entity_ref,
        declared_market: row.declared_market,
        plan_version: row.plan_version,
        plan_digest: row.plan_digest,
        slot_key: hmacDigest(args.pseudonymKey, `slot:${row.slot_key}`),
        slot_digest: row.slot_digest,
        provenance_digest: row.provenance_digest,
        authority_digest: row.authority_digest,
        authority_valid_until: row.authority_valid_until
          ? isoTimestamp(row.authority_valid_until)
          : null
      };
    }).sort((left, right) => left.partition_key.localeCompare(right.partition_key));
    if (memberships.length > 1) sharedRootCount += 1;
    const language = normalizeFacet(first.language, "und");
    const country = normalizeCountry(first.country);
    const platform = normalizeFacet(first.platform, "unknown");
    increment(languageCounts, language);
    increment(countryCounts, country);
    increment(platformCounts, platform);
    const recordKey = hmacDigest(args.pseudonymKey, `root:${first.mention_id}`);
    records.push({
      contract_version: SIGNAL_SEMANTIC_BENCHMARK_RECORD_V2_CONTRACT,
      record_key: recordKey,
      canonical_family_key: recordKey,
      canonical_alias_count: Number(first.canonical_alias_count),
      content_hash: sha256Digest(text),
      text,
      published_at: isoTimestamp(first.published_at),
      month: first.published_at.slice(0, 7),
      language,
      country,
      platform,
      partition_memberships: memberships,
      quality_disposition: "included",
      authority_usage: "strategic-analysis",
      authority_digest: sha256Digest(stableJson(memberships.map((item) => ({
        partition_key: item.partition_key,
        authority_digest: item.authority_digest
      }))))
    });
  }
  records.sort((left, right) => left.record_key.localeCompare(right.record_key));
  const dates = records.map((record) => record.published_at.slice(0, 10)).sort();
  const exportRecordsDigest = sha256Digest(records.map((record) => [
    record.record_key,
    record.content_hash,
    record.authority_digest,
    record.partition_memberships.map((membership) =>
      `${membership.partition_key}:${membership.provenance_digest}:${membership.authority_digest}`
    ).join(",")
  ].join("|")).join("\n"));
  return {
    ...preflight,
    ready: true,
    blockers: [],
    authority_digest: preflight.authority_digest,
    workspace_ref: hmacDigest(args.pseudonymKey, `workspace:${args.workspaceId}`),
    export_timestamp: new Date().toISOString(),
    period_start: dates[0]!,
    period_end: dates.at(-1)!,
    timezone: args.frozenCorpus.timezone,
    export_records_digest: exportRecordsDigest,
    exported: records.length,
    excluded_by_reason: { quality_excluded: preflight.quality_excluded_roots },
    language_counts: sortRecord(languageCounts),
    country_counts: sortRecord(countryCounts),
    platform_counts: sortRecord(platformCounts),
    declared_market_membership_counts: sortRecord(marketCounts),
    shared_root_count: sharedRootCount,
    licensing_evaluation: "allowed",
    retention_evaluation: "current",
    quality_evaluation: "current",
    resource_estimate: {
      ...preflight.resource_estimate,
      estimated_private_jsonl_bytes: Buffer.byteLength(
        records.map((record) => JSON.stringify(record)).join("\n") + "\n"
      )
    },
    records
  };
}

export function buildSignalSemanticBenchmarkExportManifestV2(args: {
  exported: SignalSemanticBenchmarkExportResultV2;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  exportFileSha256: Digest;
}): SignalSemanticBenchmarkExportManifestV2 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(args.exportFileSha256)) {
    throw new Error("signal_benchmark_export_file_digest_invalid");
  }
  if (
    args.exported.records.length !== args.exported.modeling_population
    || args.exported.protected_state_digest_before
      !== args.exported.protected_state_digest_after
    || args.exported.corpus_identity !== args.frozenCorpus.identity
  ) {
    throw new Error("signal_benchmark_export_manifest_invariant_failed");
  }
  return {
    contract_version: SIGNAL_SEMANTIC_BENCHMARK_EXPORT_V2_CONTRACT,
    target: "noisia-staging",
    read_only: true,
    writes_performed: false,
    provider_calls: 0,
    jobs_enqueued: 0,
    serving_writes: 0,
    workspace_ref: args.exported.workspace_ref,
    corpus_identity: args.exported.corpus_identity,
    export_timestamp: args.exported.export_timestamp,
    period_start: args.exported.period_start,
    period_end: args.exported.period_end,
    timezone: args.exported.timezone,
    population_digest: args.exported.population_digest,
    content_digest: args.exported.content_digest,
    provenance_digest: args.exported.provenance_digest,
    watermark_digest: args.exported.watermark_digest,
    authority_digest: args.exported.authority_digest,
    export_records_digest: args.exported.export_records_digest,
    schema_version: SIGNAL_SEMANTIC_BENCHMARK_RECORD_V2_CONTRACT,
    acquisition_denominator: args.exported.acquisition_denominator,
    modeling_population: args.exported.modeling_population,
    quality_excluded_roots: args.exported.quality_excluded_roots,
    exported: args.exported.exported,
    excluded_by_reason: args.exported.excluded_by_reason,
    partitions: Object.fromEntries(args.frozenCorpus.partitions.map(({ key, ...partition }) => [
      key,
      partition
    ])),
    language_counts: args.exported.language_counts,
    country_counts: args.exported.country_counts,
    platform_counts: args.exported.platform_counts,
    declared_market_membership_counts: args.exported.declared_market_membership_counts,
    shared_root_count: args.exported.shared_root_count,
    required_usage: "strategic-analysis",
    licensing_evaluation: "allowed",
    retention_evaluation: "current",
    quality_evaluation: "current",
    exclusion_contract: "acquisition-quality-exclusive-v2",
    protected_state_digest_before: args.exported.protected_state_digest_before,
    protected_state_digest_after: args.exported.protected_state_digest_after,
    transaction_read_only: true,
    transaction_id_assigned: false,
    export_file_sha256: args.exportFileSha256
  };
}

const VALID_SCOPES = new Set([
  "primary_brand",
  "competitor",
  "category",
  "reference",
  "unattributed"
]);

const PROTECTED_QUERIES = [
  {
    key: "classification_generations",
    table: "signal_classification_generations",
    sql: "SELECT row_value.* FROM signal_classification_generations row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "classification_assignments",
    table: "signal_classification_assignments",
    sql: "SELECT row_value.* FROM signal_classification_assignments row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "record_tags",
    table: "record_tags",
    sql: `SELECT row_value.* FROM record_tags row_value
      WHERE classification_generation_id IS NULL OR EXISTS(
        SELECT 1 FROM signal_classification_generations generation
        WHERE generation.id=row_value.classification_generation_id
          AND generation.workspace_id=$1::uuid)`
  },
  {
    key: "semantic_assertions",
    table: "signal_mention_attributions",
    sql: "SELECT row_value.* FROM signal_mention_attributions row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "population_definitions",
    table: "signal_population_definitions",
    sql: "SELECT row_value.* FROM signal_population_definitions row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "population_memberships",
    table: "signal_population_memberships",
    sql: "SELECT row_value.* FROM signal_population_memberships row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "governed_bindings",
    table: "signal_governed_view_bindings",
    sql: "SELECT row_value.* FROM signal_governed_view_bindings row_value WHERE workspace_id=$1::uuid"
  },
  {
    key: "workspace_pointers",
    table: "signal_workspace_population_pointers",
    sql: "SELECT row_value.* FROM signal_workspace_population_pointers row_value WHERE workspace_id=$1::uuid"
  }
] as const;

export async function exportSignalSemanticBenchmarkV1(args: {
  client: PoolClient;
  workspaceId: string;
  pseudonymKey: Buffer;
}): Promise<SignalSemanticBenchmarkExportResultV1> {
  if (args.pseudonymKey.byteLength < 32) {
    throw new Error("signal_benchmark_pseudonym_key_too_short");
  }
  await args.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await args.client.query("SET LOCAL statement_timeout='15min'");
    await args.client.query("SET LOCAL idle_in_transaction_session_timeout='20min'");
    const workspace = await loadWorkspace(args.client, args.workspaceId);
    const before = await protectedStateDigest(args.client, args.workspaceId);
    const projected = await loadSignalSemanticResolutionPreflightDataV2(
      args.client,
      args.workspaceId
    );
    const audited = await auditSignalSemanticResolutionPreflightAuthorityV2(
      args.client,
      args.workspaceId
    );
    assertProjectionAuthority(projected, audited, workspace.observed_at);
    const rootResult = await args.client.query<RootAuthorityRow>(ROOT_AUTHORITY_SQL, [
      args.workspaceId,
      Number(workspace.current_generation)
    ]);
    const watermarkDigest = await loadWatermarkDigest(args.client, args.workspaceId);
    const output = buildSignalSemanticBenchmarkArtifactsV1({
      rows: rootResult.rows,
      workspace,
      auditedEligibleCount: audited.llm_eligible_count,
      liveGovernanceDigest: audited.governance_digest as Digest,
      watermarkDigest,
      pseudonymKey: args.pseudonymKey
    });
    const after = await protectedStateDigest(args.client, args.workspaceId);
    const transaction = await args.client.query<{
      transaction_read_only: string;
      transaction_id: string | null;
    }>(`SELECT current_setting('transaction_read_only') AS transaction_read_only,
      txid_current_if_assigned()::text AS transaction_id`);
    if (
      transaction.rows[0]?.transaction_read_only !== "on"
      || transaction.rows[0]?.transaction_id !== null
      || before !== after
    ) {
      throw new Error("signal_benchmark_read_only_contract_failed");
    }
    await args.client.query("COMMIT");
    return {
      ...output,
      protected_state_digest_before: before,
      protected_state_digest_after: after,
      transaction_read_only: true,
      transaction_id_assigned: false
    };
  } catch (error) {
    await args.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function buildSignalSemanticBenchmarkArtifactsV1(args: {
  rows: RootAuthorityRow[];
  workspace: WorkspaceRow;
  auditedEligibleCount: number;
  liveGovernanceDigest: Digest;
  watermarkDigest: Digest;
  pseudonymKey: Buffer;
}): Omit<
  SignalSemanticBenchmarkExportResultV1,
  | "protected_state_digest_before"
  | "protected_state_digest_after"
  | "transaction_read_only"
  | "transaction_id_assigned"
> {
  const denominator = args.rows.length;
  const excludedByReason: Record<string, number> = {};
  const scopeCounts: Record<string, number> = {};
  const entityCounts: Record<string, number> = {};
  const languageCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const records: SignalSemanticBenchmarkRecordV1[] = [];
  const seenRoots = new Set<string>();
  for (const row of args.rows) {
    if (seenRoots.has(row.mention_id)) throw new Error("signal_benchmark_root_duplicate");
    seenRoots.add(row.mention_id);
    if (row.live_eligibility !== "eligible") {
      increment(excludedByReason, row.live_eligibility);
      continue;
    }
    if (
      !row.text_clean
      || !row.context_hash
      || !row.live_authority_digest
    ) {
      throw new Error("signal_benchmark_live_authority_incomplete");
    }
    const text = normalizeBenchmarkText(row.text_clean);
    if (!text) throw new Error("signal_benchmark_text_empty");
    const intents = sanitizeSourceIntents(row.source_intents, args.pseudonymKey);
    for (const intent of intents) {
      increment(scopeCounts, intent.scope);
      if (intent.entity_ref) increment(entityCounts, intent.entity_ref);
    }
    const language = normalizeFacet(row.language, "und");
    const country = normalizeFacet(row.country, "unknown");
    const platform = normalizeFacet(row.platform, "unknown");
    increment(languageCounts, language);
    increment(platformCounts, platform);
    const rootRef = hmacDigest(args.pseudonymKey, `root:${row.mention_id}`);
    records.push({
      contract_version: SIGNAL_SEMANTIC_BENCHMARK_RECORD_CONTRACT,
      record_key: rootRef,
      canonical_family_key: rootRef,
      content_hash: sha256Digest(text),
      text,
      published_at: isoTimestamp(row.published_at),
      month: row.published_at.slice(0, 7),
      language,
      country,
      platform,
      provenance_intents: intents,
      queue_state: row.queue_state ?? "unknown",
      context_hash: row.context_hash,
      authority_digest: row.live_authority_digest,
      authority_valid_until: row.authority_valid_until
        ? isoTimestamp(row.authority_valid_until)
        : null
    });
  }
  if (records.length !== args.auditedEligibleCount) {
    throw new Error("signal_benchmark_eligible_count_mismatch");
  }
  const excluded = Object.values(excludedByReason).reduce((sum, value) => sum + value, 0);
  if (denominator !== records.length + excluded) {
    throw new Error("signal_benchmark_denominator_does_not_reconcile");
  }
  if (records.length === 0) throw new Error("signal_benchmark_population_empty");
  records.sort((left, right) => left.record_key.localeCompare(right.record_key));
  const dates = records.map((record) => record.published_at.slice(0, 10)).sort();
  return {
    workspace_ref: hmacDigest(args.pseudonymKey, `workspace:${args.workspace.workspace_id}`),
    timezone: args.workspace.timezone,
    period_start: dates[0]!,
    period_end: dates.at(-1)!,
    population_digest: args.workspace.population_digest,
    watermark_digest: args.watermarkDigest,
    governance_digest: args.liveGovernanceDigest,
    projection_snapshot_digest: args.workspace.snapshot_digest,
    projection_generation: Number(args.workspace.current_generation),
    projection_reconciled_at: isoTimestamp(args.workspace.reconciled_at),
    denominator,
    exported: records.length,
    excluded_by_reason: sortRecord(excludedByReason),
    scope_counts: sortRecord(scopeCounts),
    entity_counts: sortRecord(entityCounts),
    language_counts: sortRecord(languageCounts),
    platform_counts: sortRecord(platformCounts),
    records
  };
}

async function withAcquisitionBenchmarkReadOnlyTransaction<T>(
  client: PoolClient,
  operation: () => Promise<T>
): Promise<T> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20min'");
    const result = await operation();
    const transaction = await client.query<{
      transaction_read_only: string;
      transaction_id: string | null;
    }>(`SELECT current_setting('transaction_read_only') AS transaction_read_only,
      txid_current_if_assigned()::text AS transaction_id`);
    if (
      transaction.rows[0]?.transaction_read_only !== "on"
      || transaction.rows[0]?.transaction_id !== null
    ) {
      throw new Error("signal_benchmark_read_only_contract_failed");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function loadAcquisitionBenchmarkAuthorityRowsV2(args: {
  client: PoolClient;
  workspaceId: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  includeText: boolean;
}) {
  assertFrozenCorpusV2(args.frozenCorpus);
  const result = await args.client.query<AcquisitionRootAuthorityRowV2>(
    ACQUISITION_ROOT_AUTHORITY_V2_SQL,
    [args.workspaceId, JSON.stringify(args.frozenCorpus.partitions), args.includeText]
  );
  return result.rows;
}

function aggregateAcquisitionRowsV2(
  rows: AcquisitionRootAuthorityRowV2[],
  frozen: SignalSemanticBenchmarkFrozenCorpusV2
) {
  const grouped = groupAcquisitionRowsByRoot(rows);
  const blockers: string[] = [];
  const frozenPartitions = new Map(frozen.partitions.map((item) => [item.key, item]));
  const partitionCounts = new Map<string, {
    total: number;
    included: number;
    excluded: number;
  }>();
  let includedRoots = 0;
  let excludedRoots = 0;
  let includedMemberships = 0;
  const authorityRows: string[] = [];
  for (const [rootId, rootRows] of grouped) {
    const dispositions = new Set(rootRows.map((row) => row.inclusion_status));
    if (dispositions.size !== 1) blockers.push("root_quality_disposition_conflict");
    const disposition = rootRows[0]?.inclusion_status;
    if (disposition === "included") includedRoots += 1;
    else if (disposition === "excluded") excludedRoots += 1;
    else blockers.push("root_quality_disposition_unknown");
    const seenPartitions = new Set<string>();
    for (const row of rootRows) {
      if (seenPartitions.has(row.partition_key)) {
        blockers.push(`root_partition_duplicate:${row.partition_key}`);
        continue;
      }
      seenPartitions.add(row.partition_key);
      const expected = frozenPartitions.get(row.partition_key);
      if (!expected || !rowMatchesFrozenPartition(row, expected)) {
        blockers.push(`partition_authority_mismatch:${row.partition_key}`);
      }
      const counts = partitionCounts.get(row.partition_key) ?? {
        total: 0,
        included: 0,
        excluded: 0
      };
      counts.total += 1;
      if (disposition === "included") counts.included += 1;
      if (disposition === "excluded") counts.excluded += 1;
      partitionCounts.set(row.partition_key, counts);
      if (disposition === "included") {
        includedMemberships += 1;
        if (row.authority_state !== "eligible" || !row.authority_digest) {
          blockers.push(`strategic_authority_blocked:${row.authority_state}`);
        } else {
          authorityRows.push([
            rootId,
            row.partition_key,
            row.provenance_digest,
            row.authority_digest
          ].join("|"));
        }
      }
    }
  }
  return {
    uniqueRoots: grouped.size,
    includedRoots,
    excludedRoots,
    includedMemberships,
    partitionCounts,
    blockers,
    authorityDigest: blockers.length === 0
      ? sha256Digest(authorityRows.sort().join("\n"))
      : null
  };
}

function groupAcquisitionRowsByRoot(rows: AcquisitionRootAuthorityRowV2[]) {
  const grouped = new Map<string, AcquisitionRootAuthorityRowV2[]>();
  for (const row of rows) {
    const values = grouped.get(row.mention_id) ?? [];
    values.push(row);
    grouped.set(row.mention_id, values);
  }
  return grouped;
}

function rowMatchesFrozenPartition(
  row: AcquisitionRootAuthorityRowV2,
  expected: SignalSemanticBenchmarkFrozenPartitionV2
) {
  return row.scope === expected.scope
    && row.entity_ref === expected.entity_ref
    && row.declared_market === expected.declared_market
    && Number(row.plan_version) === expected.plan_version
    && row.plan_digest === expected.plan_digest
    && row.slot_digest === expected.slot_digest;
}

function assertFrozenCorpusV2(corpus: SignalSemanticBenchmarkFrozenCorpusV2) {
  if (
    corpus.partitions.length < 4
    || corpus.included_modeling_population < 1
    || corpus.acquisition_denominator
      !== corpus.included_modeling_population + corpus.quality_excluded_roots
    || new Set(corpus.partitions.map((item) => item.key)).size !== corpus.partitions.length
  ) {
    throw new Error("signal_benchmark_frozen_corpus_invalid");
  }
  for (const value of [
    corpus.population_digest,
    corpus.content_digest,
    corpus.provenance_digest,
    corpus.watermark_digest
  ]) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
      throw new Error("signal_benchmark_frozen_digest_invalid");
    }
  }
  for (const partition of corpus.partitions) {
    if (
      partition.total !== partition.included + partition.excluded
      || partition.included < 1
      || !/^[A-Z]{2}$/u.test(partition.declared_market)
      || !/^sha256:[0-9a-f]{64}$/u.test(partition.entity_ref)
      || !/^sha256:[0-9a-f]{64}$/u.test(partition.plan_digest)
      || !/^sha256:[0-9a-f]{64}$/u.test(partition.slot_digest)
    ) {
      throw new Error("signal_benchmark_frozen_partition_invalid");
    }
  }
}

async function loadWorkspace(client: PoolClient, workspaceId: string): Promise<WorkspaceRow> {
  const result = await client.query<WorkspaceRow>(`
    SELECT workspace.id::text AS workspace_id,workspace.timezone,
      state.current_generation::text,state.snapshot_digest,state.population_digest,
      state.governance_digest,state.reconciled_at::text,state.projected_root_count::int,
      state.dirty_root_count::int,state.full_rebuild_required,
      transaction_timestamp()::text AS observed_at
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id=workspace.brand_id
    JOIN signal_semantic_review_projection_state state ON state.workspace_id=workspace.id
    WHERE workspace.id=$1::uuid AND workspace.status='active' AND brand.status='active'
      AND state.status='ready' AND state.current_generation>=1
      AND state.snapshot_digest IS NOT NULL AND state.population_digest IS NOT NULL
      AND state.governance_digest IS NOT NULL AND state.reconciled_at IS NOT NULL
  `, [workspaceId]);
  const row = result.rows[0];
  if (!row || result.rowCount !== 1) throw new Error("signal_benchmark_workspace_not_ready");
  if (row.dirty_root_count !== 0 || row.full_rebuild_required) {
    throw new Error("signal_benchmark_projection_stale");
  }
  return row;
}

function assertProjectionAuthority(
  projected: Awaited<ReturnType<typeof loadSignalSemanticResolutionPreflightDataV2>>,
  audited: Awaited<ReturnType<typeof auditSignalSemanticResolutionPreflightAuthorityV2>>,
  observedAt: string
) {
  const exactKeys = [
    "projection_generation",
    "projection_snapshot_digest",
    "population_digest",
    "accepted_root_count",
    "quality_excluded_count",
    "quality_unknown_count",
    "incomplete_provenance_count",
    "retention_blocked_count",
    "retention_expired_count",
    "retention_unknown_count",
    "licensing_unknown_count",
    "licensing_denied_count",
    "licensing_expired_count",
    "llm_eligible_count",
    "already_resolved_count",
    "unresolved_count",
    "deterministic_count",
    "ambiguous_count",
    "needs_context_count",
    "selected_character_count",
    "selection_digest",
    "next_policy_transition_at"
  ] as const;
  for (const key of exactKeys) {
    if (projected[key] !== audited[key]) {
      throw new Error(`signal_benchmark_projection_audit_mismatch:${key}`);
    }
  }
  if (
    audited.next_policy_transition_at
    && Date.parse(audited.next_policy_transition_at) <= Date.parse(observedAt)
  ) {
    throw new Error("signal_benchmark_authority_expired");
  }
}

async function loadWatermarkDigest(client: PoolClient, workspaceId: string): Promise<Digest> {
  const result = await client.query<{ digest: Digest; row_count: number }>(`
    SELECT count(*)::int AS row_count,
      'sha256:'||encode(digest(convert_to(COALESCE(string_agg(concat_ws('|',
      watermark.source_key,watermark.corpus_revision::text,
      COALESCE(watermark.last_import_batch_id::text,'∅'),
      COALESCE(watermark.max_observed_at::text,'∅'),watermark.accepted_at::text,
      watermark.materialized_at::text,watermark.source_freshness_state,
      watermark.data_freshness_state),E'\n' ORDER BY watermark.source_key,watermark.id),''),
      'UTF8'),'sha256'),'hex') AS digest
    FROM signal_data_watermarks watermark WHERE watermark.workspace_id=$1::uuid
  `, [workspaceId]);
  if (!result.rows[0] || Number(result.rows[0].row_count) === 0) {
    throw new Error("signal_benchmark_watermark_not_available");
  }
  return result.rows[0].digest;
}

async function protectedStateDigest(client: PoolClient, workspaceId: string): Promise<Digest> {
  const domains: Array<{ key: string; count: number; digest: string }> = [];
  for (const query of PROTECTED_QUERIES) {
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [query.table]
    );
    if (!exists.rows[0]?.present) continue;
    let protectedSql: string = query.sql;
    if (query.key === "record_tags") {
      const generationTable = await client.query<{ present: boolean }>(
        "SELECT to_regclass('signal_classification_generations') IS NOT NULL AS present"
      );
      if (!generationTable.rows[0]?.present) {
        protectedSql = "SELECT row_value.* FROM record_tags row_value";
      }
    }
    const result = await client.query<{ row_count: number; digest: string }>(`
      WITH rows AS (${protectedSql}), row_hashes AS (
        SELECT digest(convert_to(to_jsonb(rows)::text,'UTF8'),'sha256') AS row_hash FROM rows
      ) SELECT count(*)::int AS row_count,
        encode(digest(convert_to(COALESCE(string_agg(encode(row_hash,'hex'),''
          ORDER BY encode(row_hash,'hex')),''),'UTF8'),'sha256'),'hex') AS digest
      FROM row_hashes
    `, protectedSql.includes("$1") ? [workspaceId] : []);
    domains.push({
      key: query.key,
      count: Number(result.rows[0]?.row_count ?? 0),
      digest: result.rows[0]?.digest ?? ""
    });
  }
  return sha256Digest(stableJson(domains));
}

function sanitizeSourceIntents(value: unknown, key: Buffer) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, {
    scope: SignalSemanticBenchmarkRecordV1["provenance_intents"][number]["scope"];
    entity_ref: Digest | null;
  }>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const scope = Reflect.get(entry, "scope");
    if (typeof scope !== "string" || !VALID_SCOPES.has(scope)) {
      throw new Error("signal_benchmark_source_intent_scope_invalid");
    }
    const entityId = Reflect.get(entry, "entity_id");
    const entityType = Reflect.get(entry, "entity_type");
    const entityRef = typeof entityId === "string" && entityId
      ? hmacDigest(key, `entity:${String(entityType ?? "unknown")}:${entityId}`)
      : null;
    unique.set(`${scope}:${entityRef ?? "∅"}`, {
      scope: scope as SignalSemanticBenchmarkRecordV1["provenance_intents"][number]["scope"],
      entity_ref: entityRef
    });
  }
  return [...unique.values()].sort((left, right) =>
    `${left.scope}:${left.entity_ref ?? ""}`.localeCompare(`${right.scope}:${right.entity_ref ?? ""}`)
  );
}

function normalizeBenchmarkText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeFacet(value: string | null, fallback: string) {
  const normalized = value?.normalize("NFKC").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeCountry(value: string | null) {
  const normalized = value?.normalize("NFKC").trim().toUpperCase();
  return normalized || "UNKNOWN";
}

function isoTimestamp(value: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.valueOf())) {
    throw new Error("signal_benchmark_timestamp_invalid");
  }
  return timestamp.toISOString();
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function sortRecord(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function hmacDigest(key: Buffer, value: string): Digest {
  return `sha256:${createHmac("sha256", key).update(value).digest("hex")}`;
}

function sha256Digest(value: string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

const ROOT_AUTHORITY_SQL = `
  WITH projection AS MATERIALIZED (
    SELECT state.current_generation FROM signal_semantic_review_projection_state state
    WHERE state.workspace_id=$1::uuid AND state.current_generation=$2::bigint
      AND state.status='ready'
  ), roots AS MATERIALIZED (
    SELECT mention.id AS mention_id,mention.published_at,mention.language,mention.country,
      COALESCE(mention.resolved_platform,mention.platform) AS platform,
      mention.text_clean,mention.quality_score,
      COALESCE(mention.quality_flags,'[]'::jsonb) AS quality_flags,
      item.queue_state,item.context_hash,item.resolution_eligibility AS projection_eligibility,
      item.resolution_authority_digest AS projection_authority_digest,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',intent.scope,
        'entity_type',intent.entity_type,'entity_id',intent.entity_id::text)
        ORDER BY intent.scope,intent.entity_type,intent.entity_id)
        FROM signal_mention_attributions intent
        JOIN import_batches completed ON completed.id=intent.import_batch_id
          AND completed.workspace_id=intent.workspace_id AND completed.status='completed'
        WHERE intent.workspace_id=mention.workspace_id AND intent.mention_id=mention.id
          AND intent.attribution_basis='source_intent'),'[]'::jsonb) AS source_intents
    FROM mentions mention CROSS JOIN projection
    LEFT JOIN signal_semantic_review_projection_items item
      ON item.workspace_id=mention.workspace_id AND item.generation=projection.current_generation
     AND item.mention_id=mention.id
    WHERE mention.workspace_id=$1::uuid AND mention.canonical_mention_id=mention.id
      AND mention.inclusion_status='included'
  ), memberships AS MATERIALIZED (
    SELECT DISTINCT root.mention_id,membership.data_source_id,membership.import_batch_id
    FROM roots root JOIN mentions provenance_mention
      ON provenance_mention.workspace_id=$1::uuid
     AND provenance_mention.canonical_mention_id=root.mention_id
    JOIN signal_mention_import_memberships membership
      ON membership.workspace_id=$1::uuid AND membership.mention_id=provenance_mention.id
    JOIN import_batches batch ON batch.id=membership.import_batch_id
      AND batch.workspace_id=membership.workspace_id AND batch.status='completed'
  ), source_imports AS MATERIALIZED (
    SELECT DISTINCT data_source_id,import_batch_id FROM memberships
  ), selected_bindings AS MATERIALIZED (
    SELECT pair.data_source_id,pair.import_batch_id,binding.id,binding.status,
      binding.effective_from,binding.effective_to,binding.binding_version,
      binding.quality_policy_id,binding.retention_policy_id,binding.licensing_policy_id
    FROM source_imports pair LEFT JOIN LATERAL (
      SELECT candidate.* FROM signal_provenance_policy_bindings candidate
      WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=pair.data_source_id
        AND (candidate.import_batch_id=pair.import_batch_id OR candidate.import_batch_id IS NULL)
      ORDER BY (candidate.status='active' AND candidate.effective_from<=transaction_timestamp()
        AND (candidate.effective_to IS NULL OR candidate.effective_to>transaction_timestamp())) DESC,
        (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id
      LIMIT 1
    ) binding ON true
  ), paths AS (
    SELECT root.mention_id,binding.id AS binding_id,
      quality.id AS quality_policy_id,quality.definition_hash AS quality_hash,
      retention.id AS retention_policy_id,retention.definition_hash AS retention_hash,
      licensing.id AS licensing_policy_id,licensing.definition_hash AS licensing_hash,
      transition.next_transition,
      CASE
        WHEN binding.id IS NULL OR binding.status<>'active'
          OR binding.effective_from>transaction_timestamp() THEN 'licensing_unknown'
        WHEN binding.effective_to IS NOT NULL
          AND binding.effective_to<=transaction_timestamp() THEN 'licensing_expired'
        WHEN quality.id IS NULL OR quality.status<>'active'
          OR quality.effective_from>transaction_timestamp()
          OR (quality.effective_to IS NOT NULL AND quality.effective_to<=transaction_timestamp())
          OR quality.canonical_root_disposition='not_available' THEN 'quality_unknown'
        WHEN quality.canonical_root_disposition='blocked'
          OR (quality.min_quality_score IS NOT NULL
            AND COALESCE(root.quality_score,-1)<quality.min_quality_score)
          OR EXISTS(SELECT 1 FROM unnest(quality.required_quality_flags) flag
            WHERE NOT root.quality_flags ? flag)
          OR EXISTS(SELECT 1 FROM unnest(quality.forbidden_quality_flags) flag
            WHERE root.quality_flags ? flag) THEN 'quality_excluded'
        WHEN retention.id IS NULL OR retention.status<>'active'
          OR retention.effective_from>transaction_timestamp()
          OR retention.retention_state='not_available' THEN 'retention_unknown'
        WHEN retention.effective_to IS NOT NULL
          AND retention.effective_to<=transaction_timestamp() THEN 'retention_expired'
        WHEN retention.retention_state='blocked' THEN 'retention_blocked'
        WHEN retention.retention_mode='until'
          AND retention.retain_until<=transaction_timestamp() THEN 'retention_expired'
        WHEN licensing.id IS NULL OR licensing.status<>'active'
          OR licensing.effective_from>transaction_timestamp() THEN 'licensing_unknown'
        WHEN licensing.effective_to IS NOT NULL
          AND licensing.effective_to<=transaction_timestamp() THEN 'licensing_expired'
        WHEN EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id
            AND usage.usage_purpose='llm-processing' AND usage.decision='prohibited')
          THEN 'licensing_denied'
        WHEN NOT EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id
            AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
          THEN 'licensing_unknown'
        ELSE 'eligible'
      END AS path_state
    FROM roots root JOIN memberships membership ON membership.mention_id=root.mention_id
    LEFT JOIN selected_bindings binding ON binding.data_source_id=membership.data_source_id
      AND binding.import_batch_id=membership.import_batch_id
    LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
    LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
    LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
    LEFT JOIN LATERAL (SELECT min(value) AS next_transition FROM (VALUES
      (binding.effective_to),(quality.effective_to),(retention.effective_to),
      (retention.retain_until),(licensing.effective_to)) boundary(value)
      WHERE value IS NOT NULL) transition ON true
  ), authority AS (
    SELECT root.mention_id,
      CASE
        WHEN bool_or(path.path_state='eligible') THEN 'eligible'
        WHEN bool_or(path.path_state='quality_excluded') THEN 'quality_excluded'
        WHEN bool_or(path.path_state='quality_unknown') THEN 'quality_unknown'
        WHEN bool_or(path.path_state='retention_blocked') THEN 'retention_blocked'
        WHEN bool_or(path.path_state='retention_expired') THEN 'retention_expired'
        WHEN bool_or(path.path_state='retention_unknown') THEN 'retention_unknown'
        WHEN bool_or(path.path_state='licensing_denied') THEN 'licensing_denied'
        WHEN bool_or(path.path_state='licensing_expired') THEN 'licensing_expired'
        WHEN count(path.mention_id)=0 THEN 'provenance_incomplete'
        ELSE 'licensing_unknown'
      END AS eligibility,
      CASE WHEN bool_or(path.path_state='eligible') THEN
        'sha256:'||encode(digest(convert_to(COALESCE(string_agg(concat_ws('|',
          path.binding_id::text,path.quality_policy_id::text,path.retention_policy_id::text,
          path.licensing_policy_id::text,path.quality_hash,path.retention_hash,
          path.licensing_hash),E'\n' ORDER BY path.binding_id)
          FILTER(WHERE path.path_state='eligible'),''),'UTF8'),'sha256'),'hex')
      END AS authority_digest,
      min(path.next_transition) FILTER(WHERE path.path_state='eligible') AS valid_until
    FROM roots root LEFT JOIN paths path ON path.mention_id=root.mention_id
    GROUP BY root.mention_id
  )
  SELECT root.mention_id::text,root.published_at::text,root.language,root.country,
    root.platform,CASE WHEN authority.eligibility='eligible' THEN root.text_clean END AS text_clean,
    root.queue_state,root.context_hash,root.projection_eligibility,
    root.projection_authority_digest,authority.eligibility AS live_eligibility,
    authority.authority_digest AS live_authority_digest,authority.valid_until::text
      AS authority_valid_until,
    CASE WHEN authority.eligibility='eligible' THEN root.source_intents ELSE '[]'::jsonb END
      AS source_intents
  FROM roots root JOIN authority ON authority.mention_id=root.mention_id
  ORDER BY root.mention_id
`;

const ACQUISITION_ROOT_AUTHORITY_V2_SQL = `
  WITH requested AS MATERIALIZED (
    SELECT value.key AS partition_key,value.scope,value.entity_ref,
      value.declared_market,value.plan_version,value.plan_digest,value.slot_digest
    FROM jsonb_to_recordset($2::jsonb) AS value(
      key text,scope text,entity_ref text,declared_market text,plan_version integer,
      plan_digest text,slot_digest text,total integer,included integer,excluded integer,
      population_digest text,modeling_digest text
    )
  ), accepted_batches AS MATERIALIZED (
    SELECT request.partition_key,request.scope,request.entity_ref,request.declared_market,
      request.plan_version,request.plan_digest,request.slot_digest,
      batch.id AS import_batch_id,batch.data_source_id,batch.acquisition_slot_id,
      batch.acquisition_import_seal_digest,slot.slot_key
    FROM requested request
    JOIN signal_acquisition_plans plan
      ON plan.workspace_id=$1::uuid AND plan.plan_version=request.plan_version
     AND plan.definition_hash=request.plan_digest
    JOIN signal_acquisition_slots slot
      ON slot.workspace_id=plan.workspace_id AND slot.plan_id=plan.id
     AND slot.definition_hash=request.slot_digest AND slot.scope=request.scope
    JOIN import_batches batch
      ON batch.workspace_id=plan.workspace_id AND batch.acquisition_plan_id=plan.id
     AND batch.acquisition_slot_id=slot.id AND batch.status='completed'
     AND batch.acquisition_contract_version='signal-acquisition-import-v2'
     AND batch.acquisition_plan_digest=request.plan_digest
     AND batch.acquisition_slot_digest=request.slot_digest
     AND batch.acquisition_import_seal_digest IS NOT NULL
     AND batch.provider_observation_projection_state='ready'
  ), member_observations AS MATERIALIZED (
    SELECT batch.*,root.id AS root_id,root.inclusion_status,root.published_at,
      CASE WHEN $3::boolean THEN root.text_clean END AS text_clean,
      root.language,root.country,COALESCE(root.resolved_platform,root.platform) AS platform,
      observation.observation_hash,observation.provenance_binding_id,
      observation.rights_definition_hash,observation.retention_until,
      alias_count.value AS canonical_alias_count
    FROM accepted_batches batch
    JOIN signal_mention_import_memberships membership
      ON membership.workspace_id=$1::uuid
     AND membership.import_batch_id=batch.import_batch_id
    JOIN mentions member
      ON member.workspace_id=membership.workspace_id AND member.id=membership.mention_id
    JOIN mentions root
      ON root.workspace_id=member.workspace_id AND root.id=member.canonical_mention_id
     AND root.canonical_mention_id=root.id
    JOIN signal_provider_mention_observations observation
      ON observation.workspace_id=membership.workspace_id
     AND observation.import_batch_id=membership.import_batch_id
     AND observation.mention_id=membership.mention_id
     AND NOT EXISTS(
       SELECT 1 FROM signal_provider_mention_observations successor
       WHERE successor.supersedes_observation_id=observation.id
     )
    JOIN LATERAL (
      SELECT greatest(count(*)::int-1,0) AS value
      FROM mentions alias
      WHERE alias.workspace_id=root.workspace_id AND alias.canonical_mention_id=root.id
    ) alias_count ON true
  ), evaluated AS MATERIALIZED (
    SELECT member.*,
      CASE
        WHEN binding.id IS NULL OR binding.status<>'active'
          OR binding.effective_from>transaction_timestamp()
          OR (binding.effective_to IS NOT NULL
            AND binding.effective_to<=transaction_timestamp())
          THEN 'provenance_binding_unavailable'
        WHEN member.rights_definition_hash IS NULL
          OR member.provenance_binding_id IS DISTINCT FROM binding.id
          THEN 'typed_rights_unavailable'
        WHEN quality.id IS NULL OR quality.status<>'active'
          OR quality.effective_from>transaction_timestamp()
          OR (quality.effective_to IS NOT NULL
            AND quality.effective_to<=transaction_timestamp())
          THEN 'quality_policy_unavailable'
        WHEN retention.id IS NULL OR retention.status<>'active'
          OR retention.effective_from>transaction_timestamp()
          OR retention.retention_state<>'allowed'
          OR (retention.effective_to IS NOT NULL
            AND retention.effective_to<=transaction_timestamp())
          OR (retention.retention_mode='until'
            AND retention.retain_until<=transaction_timestamp())
          OR (member.retention_until IS NOT NULL
            AND member.retention_until<=transaction_timestamp())
          THEN 'retention_unavailable'
        WHEN licensing.id IS NULL OR licensing.status<>'active'
          OR licensing.effective_from>transaction_timestamp()
          OR (licensing.effective_to IS NOT NULL
            AND licensing.effective_to<=transaction_timestamp())
          THEN 'licensing_unavailable'
        WHEN EXISTS(
          SELECT 1 FROM signal_licensing_policy_usages denied
          WHERE denied.licensing_policy_id=licensing.id
            AND denied.usage_purpose='strategic-analysis'
            AND denied.decision='prohibited'
        ) THEN 'strategic_analysis_denied'
        WHEN NOT EXISTS(
          SELECT 1 FROM signal_licensing_policy_usages allowed
          WHERE allowed.licensing_policy_id=licensing.id
            AND allowed.usage_purpose='strategic-analysis'
            AND allowed.decision='allowed'
        ) THEN 'strategic_analysis_unknown'
        ELSE 'eligible'
      END AS authority_state,
      CASE WHEN binding.id IS NOT NULL THEN
        'sha256:'||encode(digest(convert_to(concat_ws('|',binding.id::text,
          quality.definition_hash,retention.definition_hash,licensing.definition_hash,
          member.rights_definition_hash),'UTF8'),'sha256'),'hex')
      END AS authority_digest,
      least(binding.effective_to,quality.effective_to,retention.effective_to,
        retention.retain_until,licensing.effective_to,member.retention_until)
        AS authority_valid_until
    FROM member_observations member
    LEFT JOIN signal_provenance_policy_bindings binding
      ON binding.workspace_id=$1::uuid AND binding.id=member.provenance_binding_id
    LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
    LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
    LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
  )
  SELECT root_id::text AS mention_id,inclusion_status,published_at::text,
    max(text_clean) AS text_clean,max(language) AS language,max(country) AS country,
    max(platform) AS platform,max(canonical_alias_count)::int AS canonical_alias_count,
    partition_key,scope,entity_ref,declared_market,plan_version,plan_digest,slot_digest,
    slot_key,
    'sha256:'||encode(digest(convert_to(string_agg(DISTINCT concat_ws('|',
      import_batch_id::text,acquisition_import_seal_digest,observation_hash),E'\n'
      ORDER BY concat_ws('|',import_batch_id::text,acquisition_import_seal_digest,
        observation_hash)),'UTF8'),'sha256'),'hex') AS provenance_digest,
    CASE WHEN bool_or(authority_state='eligible') THEN 'eligible'
      ELSE min(authority_state) END AS authority_state,
    CASE WHEN bool_or(authority_state='eligible') THEN
      'sha256:'||encode(digest(convert_to(string_agg(DISTINCT authority_digest,E'\n'
        ORDER BY authority_digest) FILTER(WHERE authority_state='eligible'),
        'UTF8'),'sha256'),'hex') END AS authority_digest,
    min(authority_valid_until) FILTER(WHERE authority_state='eligible')::text
      AS authority_valid_until
  FROM evaluated
  GROUP BY root_id,inclusion_status,published_at,partition_key,scope,entity_ref,
    declared_market,plan_version,plan_digest,slot_digest,slot_key
  ORDER BY root_id,partition_key
`;
