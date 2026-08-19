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

type Digest = `sha256:${string}`;

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
