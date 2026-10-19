import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeSignalFilterV1,
  signalLicensingPolicyDefinitionHashV1,
  signalProvenancePolicyBindingDefinitionHashV1,
  signalQualityPolicyDefinitionHashV1,
  signalRetentionPolicyDefinitionHashV1,
  type SignalDataUsagePurposeV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalLicensingPolicyDefinitionV1,
  type SignalProvenancePolicyBindingDefinitionV1,
  type SignalQualityPolicyDefinitionV1,
  type SignalRetentionPolicyDefinitionV1
} from "@noisia/query-engine";
import pg from "pg";

import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1,
  ensureSignalQualityPolicyDraftV1,
  ensureSignalRetentionPolicyDraftV1
} from "../src/lib/data-os/signal-data-governance";
import {
  ensureSignalBrandPolicyDraftV1,
  reconcileSignalBrandPolicyCandidateV1,
  resolveSignalBrandPolicyDraftGovernanceV1,
  SIGNAL_BRAND_POLICY_KEY,
  SIGNAL_BRAND_POLICY_VERSION
} from "../src/lib/data-os/signal-governed-brand-policy";
import { runSignalBrandDraftShadowV1 } from "../src/lib/data-os/signal-governed-brand-shadow";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "../src/lib/data-os/signal-workspace";

const DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const INPUT_MANIFEST_HASH =
  "sha256:d8eae3d1e6c51e4a404c3fed5926898b064a7804f380dbad1f36518ecdfafdfc";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:backend-04b:laika-governed-brand";
const MODULES = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalGovernedViewModuleKeyV1[];
const MODULE_USAGES: Record<(typeof MODULES)[number], SignalDataUsagePurposeV1[]> = {
  "brand-monitoring": ["client-derived-metrics"],
  mentions: ["client-mention-list", "client-text-or-excerpt"],
  "topics-narratives": ["client-derived-metrics"]
};
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_DIRECTORY = resolve(REPOSITORY_ROOT, ".data", "signal-7a", "backend-04b");
const INPUT_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  ".data",
  "signal-7a",
  "backend-04a",
  "governance-decision-manifest.private.json"
);

type Mode = "preflight" | "apply" | "verify";
type Queryable = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

type WorkspaceIdentity = {
  workspace_id: string;
  organization_id: string;
  brand_id: string;
  workspace_slug: string;
  workspace_status: string;
  timezone: string;
};

type SourceIdentity = {
  source_id: string;
  source_key: string;
  canonical_root_count: number;
  included_root_count: number;
};

type ProtectedState = Awaited<ReturnType<typeof inspectProtectedState>>;

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeKey(kind: string, value: string) {
  return `${kind}_${sha256(`${kind}:${value}`).slice(7, 19)}`;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readMode(): Mode {
  const mode = (process.env.NOISIA_SIGNAL_GOVERNED_BRAND_REHEARSAL_MODE ?? "preflight")
    .trim()
    .toLowerCase();
  if (mode === "preflight" || mode === "apply" || mode === "verify") return mode;
  throw new Error("NOISIA_SIGNAL_GOVERNED_BRAND_REHEARSAL_MODE must be preflight, apply or verify.");
}

function connectionFingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function projectRef(value: string, kind: "direct" | "pooler") {
  const parsed = new URL(value);
  if (kind === "direct") {
    const match = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase());
    if (!match?.[1]) throw new Error("Direct connection does not expose a Supabase project ref.");
    return match[1];
  }
  const usernameMatch = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase());
  if (usernameMatch?.[1]) return usernameMatch[1];
  const hostMatch = /^([a-z0-9]+)\.[a-z0-9.-]*pooler\.supabase\.com$/u.exec(
    parsed.hostname.toLowerCase()
  );
  if (!hostMatch?.[1]) throw new Error("Pooler connection does not expose a Supabase project ref.");
  return hostMatch[1];
}

function ssl() {
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
}

function assertRemoteGuards(mode: Mode, directUrl: string, poolerUrl: string) {
  if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "preview") {
    throw new Error("Backend 04B requires NOISIA_REMOTE_DATABASE_TARGET=preview.");
  }
  if (process.env.NOISIA_SIGNAL_GOVERNED_BRAND_REHEARSAL_ALLOW_REMOTE !== "true") {
    throw new Error("Remote Backend 04B preflight approval is required.");
  }
  if (connectionFingerprint(directUrl) !== DIRECT_FINGERPRINT
    || connectionFingerprint(poolerUrl) !== POOLER_FINGERPRINT) {
    throw new Error("Backend 04B connection fingerprint mismatch.");
  }
  const directProjectRef = projectRef(directUrl, "direct");
  const poolerProjectRef = projectRef(poolerUrl, "pooler");
  if (directProjectRef !== poolerProjectRef
    || sha256(directProjectRef) !== PROJECT_REF_HASH
    || sha256(poolerProjectRef) !== PROJECT_REF_HASH) {
    throw new Error("Direct and pooler connections do not resolve to the audited project.");
  }
  if (mode === "apply") {
    if (process.env.NOISIA_SIGNAL_GOVERNED_BRAND_REHEARSAL_APPLY_APPROVED !== "true"
      || process.env.NOISIA_SIGNAL_GOVERNED_BRAND_REHEARSAL_ISOLATED_TARGET_CONFIRMED !== "true") {
      throw new Error("Backend 04B apply requires explicit apply and isolation approvals.");
    }
  }
  const restorePointAt = Date.parse(required("NOISIA_SIGNAL_GOVERNED_BRAND_RESTORE_POINT_AT"));
  const ageMs = Date.now() - restorePointAt;
  if (process.env.NOISIA_SIGNAL_GOVERNED_BRAND_RESTORE_VERIFIED !== "true"
    || !Number.isFinite(restorePointAt)
    || ageMs < 0
    || ageMs > 7 * 24 * 60 * 60 * 1000
    || required("NOISIA_SIGNAL_GOVERNED_BRAND_RESTORE_REFERENCE").length < 8) {
    throw new Error("Backend 04B requires a current, verified restore point.");
  }
  return {
    project_ref_hash: PROJECT_REF_HASH,
    restore_point_at: new Date(restorePointAt).toISOString(),
    restore_point_age_hours: Math.round(ageMs / 36e5 * 10) / 10
  };
}

async function digestQuery(client: Queryable, fromSql: string, orderSql: string) {
  return (await client.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text, E'\\n' ORDER BY ${orderSql}
      ), ''), 'UTF8')), 'hex') AS content_hash
    FROM ${fromSql} row_value
  `)).rows[0]!;
}

async function inspectProtectedState(client: Queryable) {
  const v1 = (await client.query<{
    definition_count: number;
    pointer_count: number;
    membership_count: number;
    included_count: number;
    digest: string;
  }>(`
    WITH v1 AS (
      SELECT definition.id, definition.workspace_id
      FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer
        ON pointer.population_id=definition.id AND pointer.workspace_id=definition.workspace_id
      WHERE pointer.purpose='operational'
        AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), rows AS (
      SELECT concat_ws('|', v1.workspace_id::text, v1.id::text,
        membership.mention_id::text, membership.membership_status,
        COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    )
    SELECT (SELECT count(*)::int FROM v1) AS definition_count,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
        JOIN v1 ON v1.id=pointer.population_id) AS pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL) AS included_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value)
        FROM rows),''),'UTF8')),'hex') AS digest
  `)).rows[0]!;
  const pointers = await digestQuery(
    client,
    "signal_workspace_population_pointers",
    "row_value.workspace_id,row_value.purpose"
  );
  const attributions = await digestQuery(
    client,
    "signal_mention_attributions",
    "row_value.workspace_id,row_value.mention_id,row_value.id"
  );
  const reviewEvents = await digestQuery(
    client,
    "signal_mention_attribution_review_events",
    "row_value.workspace_id,row_value.attribution_id,row_value.created_at,row_value.id"
  );
  const materializations = await digestQuery(
    client,
    "metric_materializations",
    "row_value.workspace_id,row_value.metric_key,row_value.period_start,row_value.period_end,row_value.id"
  );
  const releases = await digestQuery(
    client,
    "signal_workspace_current_releases",
    "row_value.workspace_id"
  );
  const runningSyncs = (await client.query<{
    count: number;
    oldest_started_at: string | null;
    newest_started_at: string | null;
    digest: string;
  }>(`
    SELECT count(*)::int AS count,
      min(started_at)::text AS oldest_started_at,
      max(started_at)::text AS newest_started_at,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        id::text,workspace_id::text,data_source_id::text,status,created_at::text,
        started_at::text,finished_at::text),E'\\n' ORDER BY id),''),'UTF8')),'hex') AS digest
    FROM source_sync_runs WHERE status='running'
  `)).rows[0]!;
  const state = {
    operational_v1: v1,
    population_pointers: pointers,
    semantic_assertions: attributions,
    review_events: reviewEvents,
    legacy_materializations: materializations,
    current_releases: releases,
    running_syncs: runningSyncs
  };
  return { ...state, aggregate_hash: sha256(stableJson(state)) };
}

async function inspectLedger(client: Queryable) {
  const rows = (await client.query<{
    migration_name: string;
    ordinal: number;
    checksum_sha256: string;
    disposition: string;
  }>(`
    SELECT migration_name,ordinal,checksum_sha256,disposition
    FROM ${LEDGER} WHERE ordinal BETWEEN 59 AND 69 ORDER BY ordinal
  `)).rows;
  const ordinals = rows.map((row) => row.ordinal);
  if (ordinals.join(",") !== "59,60,61,62,63,64,65,66,67,68,69") {
    throw new Error("Backend 04B requires the exact 0059-0069 ledger.");
  }
  if (rows.find((row) => row.ordinal === 68)?.checksum_sha256
      !== "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"
    || rows.find((row) => row.ordinal === 69)?.checksum_sha256
      !== "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff") {
    throw new Error("Backend 04B ledger checksum mismatch for 0068/0069.");
  }
  return { rows, digest: sha256(stableJson(rows)) };
}

async function inspectWorkspace(client: Queryable): Promise<WorkspaceIdentity> {
  const rows = (await client.query<WorkspaceIdentity>(`
    SELECT workspace.id::text AS workspace_id,workspace.organization_id::text,
      workspace.brand_id::text,workspace.slug AS workspace_slug,
      workspace.status AS workspace_status,workspace.timezone
    FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
    WHERE brand.slug='laika'
  `)).rows;
  if (rows.length !== 1 || rows[0]?.workspace_status !== "active") {
    throw new Error("Backend 04B requires exactly one active Laika workspace.");
  }
  return rows[0]!;
}

async function inspectConnections(client: Queryable) {
  return (await client.query<{
    active_incompatible: number;
    named_apps: number;
    active_writers: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name NOT IN ('noisia-backend-04b-direct','noisia-backend-04b-pooler'))::int
        AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
}

async function inspectCurrentObjects(client: Queryable, workspaceId: string) {
  return (await client.query<{
    policy_bundles: number;
    policies: number;
    provenance_bindings: number;
    derivations: number;
    compilations: number;
    governed_bindings: number;
    v2_pointers: number;
    population_watermarks: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM signal_population_policy_bundles WHERE workspace_id=$1::uuid) AS policy_bundles,
      ((SELECT count(*) FROM signal_quality_policies WHERE workspace_id=$1::uuid)
       +(SELECT count(*) FROM signal_retention_policies WHERE workspace_id=$1::uuid)
       +(SELECT count(*) FROM signal_licensing_policies WHERE workspace_id=$1::uuid))::int AS policies,
      (SELECT count(*)::int FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid) AS provenance_bindings,
      (SELECT count(*)::int FROM signal_governed_view_population_derivations WHERE workspace_id=$1::uuid) AS derivations,
      (SELECT count(*)::int FROM signal_population_policy_compilations WHERE workspace_id=$1::uuid) AS compilations,
      (SELECT count(*)::int FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid) AS governed_bindings,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
       JOIN signal_population_definitions population ON population.id=pointer.population_id
       WHERE pointer.workspace_id=$1::uuid
         AND population.definition->>'contract_version'='signal-operational-primary-brand-semantic-v2') AS v2_pointers,
      (SELECT count(*)::int FROM signal_data_watermarks
       WHERE workspace_id=$1::uuid AND population_id IS NOT NULL
         AND source_key LIKE 'governed-brand-%-v1') AS population_watermarks
  `, [workspaceId])).rows[0]!;
}

async function inspectSourceFromManifest(
  client: Queryable,
  workspace: WorkspaceIdentity,
  manifest: Record<string, unknown>
): Promise<SourceIdentity> {
  const sources = Array.isArray(manifest.sources) ? manifest.sources as Array<Record<string, unknown>> : [];
  const selected = sources.filter((source) => source.carries_current_provenance === true);
  if (selected.length !== 1 || typeof selected[0]?.source_id !== "string") {
    throw new Error("04A manifest must select exactly one current-provenance source.");
  }
  const sourceId = selected[0].source_id;
  const result = await client.query<SourceIdentity>(`
    SELECT source.id::text AS source_id,
      count(DISTINCT root.id)::int AS canonical_root_count,
      count(DISTINCT root.id) FILTER (WHERE root.inclusion_status='included')::int AS included_root_count
    FROM data_sources source
    JOIN signal_mention_import_memberships membership
      ON membership.workspace_id=source.workspace_id AND membership.data_source_id=source.id
    JOIN mentions provenance ON provenance.id=membership.mention_id
      AND provenance.workspace_id=membership.workspace_id
    JOIN mentions root ON root.id=provenance.canonical_mention_id
      AND root.workspace_id=membership.workspace_id
    WHERE source.id=$2::uuid AND source.workspace_id=$1::uuid AND source.status='active'
    GROUP BY source.id
  `, [workspace.workspace_id, sourceId]);
  const row = result.rows[0];
  if (!row || safeKey("source", row.source_id) !== selected[0].source_key) {
    throw new Error("04A source identity no longer matches noisia-staging.");
  }
  return { ...row, source_key: safeKey("source", row.source_id) };
}

async function inspectCandidate(client: Queryable, workspace: WorkspaceIdentity, source: SourceIdentity) {
  const result = await client.query<{
    population_id: string;
    population_version: number;
    membership_count: number;
    membership_digest: string;
    semantic_root_count: number;
    primary_brand_root_count: number;
    provenance_root_count: number;
    alias_membership_count: number;
    min_date: string;
    max_date: string;
    last_import_batch_id: string;
    accepted_at: string;
    max_observed_at: string;
    corpus_revision: number;
    lineage_digest: string;
  }>(`
    WITH candidate AS (
      SELECT population.id,population.version
      FROM signal_population_definitions population
      WHERE population.workspace_id=$1::uuid AND population.population_key='primary-brand-operational'
        AND population.purpose='operational' AND population.status='draft'
        AND population.definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT mention.id,mention.published_at
      FROM candidate JOIN signal_population_memberships membership ON membership.population_id=candidate.id
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=$1::uuid
      WHERE membership.membership_status='included' AND membership.removed_at IS NULL
    ), semantic AS (
      SELECT DISTINCT assertion.mention_id
      FROM signal_mention_attributions assertion
      WHERE assertion.workspace_id=$1::uuid AND assertion.attribution_basis='mention_semantic'
        AND assertion.is_current AND assertion.review_status='approved'
        AND assertion.eligibility_status='eligible' AND assertion.scope='primary_brand'
        AND assertion.entity_type='brand' AND assertion.entity_id=$2::uuid
    ), provenance AS (
      SELECT DISTINCT root.id
      FROM signal_mention_import_memberships membership
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=membership.workspace_id
      JOIN mentions root ON root.id=mention.canonical_mention_id AND root.workspace_id=membership.workspace_id
      WHERE membership.workspace_id=$1::uuid AND membership.data_source_id=$3::uuid
    ), latest_import AS (
      SELECT batch.id,batch.created_at
      FROM import_batches batch
      WHERE batch.workspace_id=$1::uuid AND batch.data_source_id=$3::uuid AND batch.status='completed'
      ORDER BY batch.created_at DESC,batch.id DESC LIMIT 1
    ), lineage AS (
      SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        membership.id::text,membership.mention_id::text,membership.import_batch_id::text,
        membership.data_source_id::text),E'\\n' ORDER BY membership.id),''),'UTF8')),'hex') AS digest
      FROM signal_mention_import_memberships membership
      WHERE membership.workspace_id=$1::uuid AND membership.data_source_id=$3::uuid
    )
    SELECT candidate.id::text AS population_id,candidate.version AS population_version,
      (SELECT count(*)::int FROM members) AS membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(id::text,',' ORDER BY id)
        FROM members),''),'UTF8')),'hex') AS membership_digest,
      (SELECT count(*)::int FROM members JOIN semantic ON semantic.mention_id=members.id) AS semantic_root_count,
      (SELECT count(*)::int FROM semantic) AS primary_brand_root_count,
      (SELECT count(*)::int FROM members JOIN provenance ON provenance.id=members.id) AS provenance_root_count,
      (SELECT count(*)::int FROM members JOIN mentions mention ON mention.id=members.id
        WHERE mention.canonical_mention_id<>mention.id) AS alias_membership_count,
      (SELECT min((published_at AT TIME ZONE $4)::date)::text FROM members) AS min_date,
      (SELECT max((published_at AT TIME ZONE $4)::date)::text FROM members) AS max_date,
      (SELECT id::text FROM latest_import) AS last_import_batch_id,
      (SELECT created_at::text FROM latest_import) AS accepted_at,
      (SELECT max(published_at)::text FROM members) AS max_observed_at,
      COALESCE((SELECT max(corpus.corpus_revision)::int FROM signal_workspace_corpora relation
        JOIN study_corpora corpus ON corpus.id=relation.study_corpus_id
        WHERE relation.workspace_id=$1::uuid AND relation.valid_to IS NULL),0) AS corpus_revision,
      (SELECT digest FROM lineage) AS lineage_digest
    FROM candidate
  `, [workspace.workspace_id, workspace.brand_id, source.source_id, workspace.timezone]);
  if (result.rows.length !== 1) throw new Error("Expected one semantic V2 base candidate.");
  const row = result.rows[0]!;
  if (row.membership_count === 0
    || row.membership_count !== row.semantic_root_count
    || row.membership_count !== row.primary_brand_root_count
    || row.membership_count !== row.provenance_root_count
    || row.alias_membership_count !== 0
    || !row.min_date || !row.max_date || !row.last_import_batch_id || !row.accepted_at
    || !row.max_observed_at) {
    throw new Error("Brand candidate has unresolved semantics, provenance or lineage.");
  }
  return row;
}

async function inspectActor(client: Queryable, workspaceId: string): Promise<SignalWorkspaceUser> {
  const result = await client.query<{
    id: string;
    user_type: string;
    organization_id: string | null;
  }>(`
    SELECT actor.id::text,actor.user_type,actor.organization_id::text
    FROM signal_mention_attribution_review_events event
    JOIN signal_mention_attributions assertion ON assertion.id=event.attribution_id
    JOIN users actor ON actor.id=event.reviewer_user_id
    WHERE event.workspace_id=$1::uuid AND actor.status='active'
      AND actor.user_type='noisia_internal'
      AND signal_data_governance_actor_is_valid($1::uuid,actor.id)
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  `, [workspaceId]);
  const row = result.rows[0];
  if (!row) throw new Error("No authenticated internal semantic reviewer can act in Laika.");
  return { id: row.id, userType: row.user_type, organizationId: row.organization_id };
}

async function loadWorkspace(client: Queryable, identity: WorkspaceIdentity): Promise<ResolvedSignalWorkspace> {
  const corpora = (await client.query<{
    id: string;
    name: string | null;
    role: "operational" | "strategic" | "legacy";
    status: string;
    valid_from: string;
    methodology_slug: string | null;
    output_id: string | null;
  }>(`
    SELECT corpus.id::text,corpus.name,relation.role,corpus.status,
      relation.valid_from::text,methodology.slug AS methodology_slug,
      (SELECT output.id::text FROM published_outputs output
       WHERE output.study_corpus_id=corpus.id AND output.status='published'
         AND output.archived_at IS NULL
       ORDER BY output.published_at DESC NULLS LAST,output.id LIMIT 1) AS output_id
    FROM signal_workspace_corpora relation
    JOIN study_corpora corpus ON corpus.id=relation.study_corpus_id
    LEFT JOIN methodologies methodology ON methodology.id=corpus.methodology_id
    WHERE relation.workspace_id=$1::uuid AND relation.valid_to IS NULL
    ORDER BY relation.role,relation.valid_from DESC
  `, [identity.workspace_id])).rows;
  return {
    contractVersion: "signal-backend-v1",
    id: identity.workspace_id,
    organizationId: identity.organization_id,
    slug: identity.workspace_slug,
    name: "Laika",
    subject: { type: "brand", id: identity.brand_id },
    timezone: identity.timezone,
    status: identity.workspace_status,
    corpora: corpora.map((corpus) => ({
      id: corpus.id,
      name: corpus.name,
      role: corpus.role,
      status: corpus.status,
      validFrom: corpus.valid_from,
      methodologySlug: corpus.methodology_slug,
      outputId: corpus.output_id
    }))
  };
}

async function snapshot(client: Queryable, manifest: Record<string, unknown>) {
  const ledger = await inspectLedger(client);
  const workspace = await inspectWorkspace(client);
  const protectedState = await inspectProtectedState(client);
  const currentObjects = await inspectCurrentObjects(client, workspace.workspace_id);
  const source = await inspectSourceFromManifest(client, workspace, manifest);
  const candidate = await inspectCandidate(client, workspace, source);
  return {
    ledger,
    workspace,
    workspace_identity_hash: sha256(stableJson(workspace)),
    protected_state: protectedState,
    current_objects: currentObjects,
    source,
    candidate
  };
}

async function connect(value: string, applicationName: string) {
  const client = new pg.Client({
    connectionString: value,
    ssl: ssl(),
    application_name: applicationName
  });
  await client.connect();
  return client;
}

async function readOnlySnapshot(
  value: string,
  applicationName: string,
  manifest: Record<string, unknown>
) {
  const client = await connect(value, applicationName);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10min'");
    const database = (await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name"
    )).rows[0]!.database_name;
    const state = await snapshot(client, manifest);
    await client.query("ROLLBACK");
    return { database_name_hash: sha256(database), ...state };
  } finally {
    await client.end();
  }
}

function publicSnapshot(value: Awaited<ReturnType<typeof readOnlySnapshot>>) {
  return {
    database_name_hash: value.database_name_hash,
    ledger_digest: value.ledger.digest,
    workspace_identity_hash: value.workspace_identity_hash,
    protected_state_hash: value.protected_state.aggregate_hash,
    operational_v1: value.protected_state.operational_v1,
    current_objects: value.current_objects,
    candidate: {
      membership_count: value.candidate.membership_count,
      membership_digest: value.candidate.membership_digest,
      semantic_root_count: value.candidate.semantic_root_count,
      primary_brand_root_count: value.candidate.primary_brand_root_count,
      provenance_root_count: value.candidate.provenance_root_count,
      alias_membership_count: value.candidate.alias_membership_count,
      period_start: value.candidate.min_date,
      period_end: value.candidate.max_date,
      lineage_digest: value.candidate.lineage_digest
    }
  };
}

function compareConnections(
  direct: Awaited<ReturnType<typeof readOnlySnapshot>>,
  pooler: Awaited<ReturnType<typeof readOnlySnapshot>>
) {
  const directPublic = publicSnapshot(direct);
  const poolerPublic = publicSnapshot(pooler);
  if (stableJson(directPublic) !== stableJson(poolerPublic)) {
    throw new Error("Direct and pooler snapshots do not identify the same database state.");
  }
  return directPublic;
}

function buildDecisionArtifact(source: SourceIdentity) {
  return {
    contract_version: "signal-backend-04b-operator-decision-v1",
    target: "noisia-staging",
    scope: {
      brand_slug: "laika",
      workspace: "server-resolved",
      source: source.source_key,
      other_workspaces: "excluded"
    },
    effective_from: "captured-once-at-apply",
    effective_to: null,
    quality: {
      policy_key: "laika-staging-observed-quality",
      policy_version: 1,
      min_quality_score: null,
      required_quality_flags: [],
      forbidden_quality_flags: [],
      canonical_root_disposition: "evaluate",
      interpretation: "No numeric threshold is asserted for this disposable staging fixture."
    },
    retention: {
      policy_key: "laika-staging-retention",
      policy_version: 1,
      retention_state: "allowed",
      retention_mode: "indefinite",
      retain_until: null,
      expiry_action: "block_use"
    },
    licensing: {
      policy_key: "laika-staging-client-usage",
      policy_version: 1,
      usages: [
        { usage_purpose: "client-derived-metrics", decision: "allowed" },
        { usage_purpose: "client-mention-list", decision: "allowed" },
        { usage_purpose: "client-text-or-excerpt", decision: "allowed" }
      ],
      explicitly_not_authorized: ["internal-qa", "llm-processing", "strategic-analysis"]
    },
    provenance: {
      binding_scope: "source",
      import_exceptions: false,
      sources_bound: 1
    },
    prohibited_actions: [
      "create-current-governed-binding",
      "promote-population-pointer",
      "change-reader-mode",
      "run-workers-or-llm-or-tb",
      "touch-production"
    ]
  } as const;
}

async function writeArtifact(name: string, value: unknown) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  const path = resolve(OUTPUT_DIRECTORY, name);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  return { path: `.data/signal-7a/backend-04b/${name}`, sha256: sha256(content) };
}

async function loadInputManifest() {
  const input = await readFile(INPUT_MANIFEST_PATH);
  if (sha256(input) !== INPUT_MANIFEST_HASH) throw new Error("04A input manifest checksum mismatch.");
  return JSON.parse(input.toString("utf8")) as Record<string, unknown>;
}

async function createIdentityEvidence(args: {
  directUrl: string;
  poolerUrl: string;
  manifest: Record<string, unknown>;
  restore: ReturnType<typeof assertRemoteGuards>;
}) {
  const poolerState = await readOnlySnapshot(
    args.poolerUrl,
    "noisia-backend-04b-pooler",
    args.manifest
  );
  const directState = await readOnlySnapshot(
    args.directUrl,
    "noisia-backend-04b-direct",
    args.manifest
  );
  const equalState = compareConnections(directState, poolerState);
  const evidence = {
    contract_version: "signal-backend-04b-target-identity-v1",
    read_only: true,
    target: "noisia-staging",
    project_ref_hash: PROJECT_REF_HASH,
    direct_fingerprint: DIRECT_FINGERPRINT,
    pooler_fingerprint: POOLER_FINGERPRINT,
    same_project: true,
    same_database_state: true,
    restore_point: args.restore,
    compared_state: equalState
  };
  return { evidence, directState };
}

async function inspectNoWriters(directUrl: string) {
  const client = await connect(directUrl, "noisia-backend-04b-direct");
  try {
    const connections = await inspectConnections(client);
    if (connections.active_incompatible > 0 || connections.named_apps > 0 || connections.active_writers > 0) {
      throw new Error("An incompatible application or writer is connected to noisia-staging.");
    }
    return connections;
  } finally {
    await client.end();
  }
}

async function preflight(args: {
  directUrl: string;
  poolerUrl: string;
  manifest: Record<string, unknown>;
  restore: ReturnType<typeof assertRemoteGuards>;
}) {
  const identity = await createIdentityEvidence(args);
  const connections = await inspectNoWriters(args.directUrl);
  const state = identity.directState;
  if (state.current_objects.governed_bindings !== 0 || state.current_objects.v2_pointers !== 0) {
    throw new Error("Backend 04B refuses existing governed bindings or V2 pointers.");
  }
  const staleSyncStartedAt = Date.parse(state.protected_state.running_syncs.newest_started_at ?? "");
  if (state.protected_state.running_syncs.count !== 1
    || !Number.isFinite(staleSyncStartedAt)
    || Date.now() - staleSyncStartedAt < 24 * 60 * 60 * 1000) {
    throw new Error("Backend 04B requires only the previously acknowledged stale sync.");
  }
  const decision = buildDecisionArtifact(state.source);
  const decisionHash = sha256(`${JSON.stringify(decision, null, 2)}\n`);
  const publicEvidence = {
    contract_version: "signal-backend-04b-preflight-v1",
    read_only: true,
    writes_performed: false,
    target_identity: identity.evidence,
    decision_artifact_hash: decisionHash,
    source: {
      key: state.source.source_key,
      canonical_root_count: state.source.canonical_root_count,
      included_root_count: state.source.included_root_count
    },
    candidate: publicSnapshot(state).candidate,
    expected_modules: MODULES.map((moduleKey) => ({
      module_key: moduleKey,
      view_key: "brand",
      usage_purposes: MODULE_USAGES[moduleKey],
      expected_membership_count: state.candidate.membership_count,
      expected_membership_digest: state.candidate.membership_digest,
      governance_unknown_count: 0
    })),
    watermark_plan: {
      missing_population_watermarks: Math.max(
        0,
        MODULES.length - state.current_objects.population_watermarks
      ),
      corpus_revision_observed: state.candidate.corpus_revision,
      accepted_at_observed: state.candidate.accepted_at,
      max_observed_at: state.candidate.max_observed_at,
      lineage_digest: state.candidate.lineage_digest,
      freshness_state: "not_available"
    },
    connections: { ...connections, application_names_redacted: true },
    gates: {
      target_identity_equal: true,
      ledger_0059_0069_exact: true,
      semantic_primary_brand_exact: true,
      provenance_complete: true,
      governance_unknown_count: 0,
      unexplained_count: 0,
      no_current_bindings: true,
      no_v2_pointer: true,
      passed: true
    }
  };
  return { identity, decision, decisionHash, publicEvidence };
}

async function ensureWatermark(args: {
  client: Queryable;
  workspace: WorkspaceIdentity;
  source: SourceIdentity;
  candidate: Awaited<ReturnType<typeof inspectCandidate>>;
  populationId: string;
  moduleKey: SignalGovernedViewModuleKeyV1;
  materializedAt: string;
  approvalEvidenceHash: string;
}) {
  const sourceKey = `governed-brand-${args.moduleKey}-v1`;
  const existing = await args.client.query<{ id: string }>(`
    SELECT id::text FROM signal_data_watermarks
    WHERE workspace_id=$1::uuid AND population_id=$2::uuid
      AND data_source_id=$3::uuid AND source_key=$4
  `, [args.workspace.workspace_id, args.populationId, args.source.source_id, sourceKey]);
  if (existing.rows.length > 1) throw new Error("Population watermark identity is ambiguous.");
  if (existing.rows[0]) return { watermark_id: existing.rows[0].id, created: false };
  const inserted = await args.client.query<{ id: string }>(`
    INSERT INTO signal_data_watermarks (
      workspace_id,study_corpus_id,population_id,data_source_id,source_key,
      corpus_revision,last_import_batch_id,max_observed_at,accepted_at,materialized_at,
      source_freshness_state,data_freshness_state,stale_after,metadata
    ) VALUES (
      $1::uuid,NULL,$2::uuid,$3::uuid,$4,$5::int,$6::uuid,$7::timestamptz,
      $8::timestamptz,$9::timestamptz,'not_available','not_available',NULL,
      jsonb_build_object(
        'contract_version','signal-governed-brand-watermark-v1',
        'module_key',$10::text,'view_key','brand','lineage_digest',$11::text,
        'approval_evidence_hash',$12::text,'freshness_measurement','not_available'
      )
    ) RETURNING id::text
  `, [
    args.workspace.workspace_id,
    args.populationId,
    args.source.source_id,
    sourceKey,
    args.candidate.corpus_revision,
    args.candidate.last_import_batch_id,
    args.candidate.max_observed_at,
    args.candidate.accepted_at,
    args.materializedAt,
    args.moduleKey,
    args.candidate.lineage_digest,
    args.approvalEvidenceHash
  ]);
  return { watermark_id: inserted.rows[0]!.id, created: true };
}

async function existingBundle(client: Queryable, workspaceId: string) {
  return (await client.query<{
    id: string;
    quality_policy_id: string | null;
    data_governance_contract_status: string;
  }>(`
    SELECT id::text,quality_policy_id::text,data_governance_contract_status
    FROM signal_population_policy_bundles
    WHERE workspace_id=$1::uuid AND policy_key=$2 AND policy_version=$3 AND status='draft'
  `, [workspaceId, SIGNAL_BRAND_POLICY_KEY, SIGNAL_BRAND_POLICY_VERSION])).rows[0] ?? null;
}

async function applyPolicies(args: {
  client: Queryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  source: SourceIdentity;
  decisionHash: string;
  effectiveFrom: string;
}) {
  const qualityDefinition: SignalQualityPolicyDefinitionV1 = {
    workspace_id: args.workspace.id,
    policy_key: "laika-staging-observed-quality",
    policy_version: 1,
    min_quality_score: null,
    required_quality_flags: [],
    forbidden_quality_flags: [],
    canonical_root_disposition: "evaluate"
  };
  const retentionDefinition: SignalRetentionPolicyDefinitionV1 = {
    workspace_id: args.workspace.id,
    policy_key: "laika-staging-retention",
    policy_version: 1,
    retention_state: "allowed",
    retention_mode: "indefinite",
    retain_until: null,
    expiry_action: "block_use",
    approval_evidence_hash: args.decisionHash
  };
  const licensingDefinition: SignalLicensingPolicyDefinitionV1 = {
    workspace_id: args.workspace.id,
    policy_key: "laika-staging-client-usage",
    policy_version: 1,
    approval_evidence_hash: args.decisionHash,
    usages: [
      { usage_purpose: "client-derived-metrics", decision: "allowed" },
      { usage_purpose: "client-mention-list", decision: "allowed" },
      { usage_purpose: "client-text-or-excerpt", decision: "allowed" }
    ]
  };
  const key = (name: string) => sha256(`backend-04b:${args.decisionHash}:${args.workspace.id}:${name}`);
  const quality = await ensureSignalQualityPolicyDraftV1({
    queryable: args.client,
    organizationId: args.workspace.organizationId,
    actor: args.actor,
    definition: qualityDefinition,
    idempotencyKey: key("quality-draft"),
    effectiveFrom: args.effectiveFrom
  });
  const retention = await ensureSignalRetentionPolicyDraftV1({
    queryable: args.client,
    organizationId: args.workspace.organizationId,
    actor: args.actor,
    definition: retentionDefinition,
    idempotencyKey: key("retention-draft"),
    effectiveFrom: args.effectiveFrom
  });
  const licensing = await ensureSignalLicensingPolicyDraftV1({
    queryable: args.client,
    organizationId: args.workspace.organizationId,
    actor: args.actor,
    definition: licensingDefinition,
    idempotencyKey: key("licensing-draft"),
    effectiveFrom: args.effectiveFrom
  });
  for (const [kind, id] of [
    ["quality-policy", quality.policy_id],
    ["retention-policy", retention.policy_id],
    ["licensing-policy", licensing.policy_id]
  ] as const) {
    await activateSignalDataGovernanceObjectV1({
      queryable: args.client,
      workspaceId: args.workspace.id,
      actor: args.actor,
      objectKind: kind,
      objectId: id,
      idempotencyKey: key(`${kind}-activate`)
    });
  }
  const bindingDefinition: SignalProvenancePolicyBindingDefinitionV1 = {
    workspace_id: args.workspace.id,
    data_source_id: args.source.source_id,
    import_batch_id: null,
    binding_version: 1,
    quality_policy_id: quality.policy_id,
    retention_policy_id: retention.policy_id,
    licensing_policy_id: licensing.policy_id
  };
  const binding = await ensureSignalProvenancePolicyBindingDraftV1({
    queryable: args.client,
    actor: args.actor,
    definition: bindingDefinition,
    idempotencyKey: key("provenance-binding-draft"),
    effectiveFrom: args.effectiveFrom
  });
  await activateSignalDataGovernanceObjectV1({
    queryable: args.client,
    workspaceId: args.workspace.id,
    actor: args.actor,
    objectKind: "provenance-binding",
    objectId: binding.binding_id,
    idempotencyKey: key("provenance-binding-activate")
  });
  const persisted = await args.client.query<{ effective_from: string }>(`
    SELECT effective_from::text FROM signal_quality_policies
    WHERE id=$1::uuid AND workspace_id=$2::uuid
  `, [quality.policy_id, args.workspace.id]);
  return {
    effective_from: persisted.rows[0]!.effective_from,
    quality: { ...quality, expected_hash: signalQualityPolicyDefinitionHashV1(qualityDefinition) },
    retention: { ...retention, expected_hash: signalRetentionPolicyDefinitionHashV1(retentionDefinition) },
    licensing: { ...licensing, expected_hash: signalLicensingPolicyDefinitionHashV1(licensingDefinition) },
    binding: { ...binding, expected_hash: signalProvenancePolicyBindingDefinitionHashV1(bindingDefinition) }
  };
}

async function applyRehearsal(args: {
  directUrl: string;
  manifest: Record<string, unknown>;
  preflightState: Awaited<ReturnType<typeof preflight>>;
}) {
  const client = await connect(args.directUrl, "noisia-backend-04b-direct");
  const effectiveFrom = new Date().toISOString();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
    const connections = await inspectConnections(client);
    if (connections.active_incompatible > 0 || connections.named_apps > 0 || connections.active_writers > 0) {
      throw new Error("Writer/app connection appeared immediately before Backend 04B apply.");
    }
    const before = await snapshot(client, args.manifest);
    if (before.protected_state.aggregate_hash
        !== args.preflightState.identity.directState.protected_state.aggregate_hash
      || before.workspace_identity_hash
        !== args.preflightState.identity.directState.workspace_identity_hash
      || before.candidate.membership_digest
        !== args.preflightState.identity.directState.candidate.membership_digest) {
      throw new Error("Protected state changed after Backend 04B preflight.");
    }
    const actor = await inspectActor(client, before.workspace.workspace_id);
    const workspace = await loadWorkspace(client, before.workspace);
    const policies = await applyPolicies({
      client,
      workspace,
      actor,
      source: before.source,
      decisionHash: args.preflightState.decisionHash,
      effectiveFrom
    });
    let bundleCreated = false;
    let bundle = await existingBundle(client, workspace.id);
    if (!bundle) {
      const created = await ensureSignalBrandPolicyDraftV1({ workspace, actor, queryable: client });
      bundleCreated = true;
      bundle = {
        id: created.policy_bundle_id,
        quality_policy_id: null,
        data_governance_contract_status: "not_available"
      };
    }
    if (bundle.data_governance_contract_status !== "resolved"
      || bundle.quality_policy_id !== policies.quality.policy_id) {
      await resolveSignalBrandPolicyDraftGovernanceV1({
        workspace,
        actor,
        policyBundleId: bundle.id,
        qualityPolicyId: policies.quality.policy_id,
        queryable: client
      });
    }
    const firstPass: Awaited<ReturnType<typeof reconcileSignalBrandPolicyCandidateV1>>[] = [];
    for (const moduleKey of MODULES) {
      firstPass.push(await reconcileSignalBrandPolicyCandidateV1({
        workspace,
        actor,
        policyBundleId: bundle.id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      }));
    }
    const watermarks = [];
    for (const reconciliation of firstPass) {
      watermarks.push({
        module_key: reconciliation.module_key,
        ...(await ensureWatermark({
          client,
          workspace: before.workspace,
          source: before.source,
          candidate: before.candidate,
          populationId: reconciliation.population_id,
          moduleKey: reconciliation.module_key,
          materializedAt: effectiveFrom,
          approvalEvidenceHash: args.preflightState.decisionHash
        }))
      });
    }
    const normal: Awaited<ReturnType<typeof reconcileSignalBrandPolicyCandidateV1>>[] = [];
    for (const moduleKey of MODULES) {
      normal.push(await reconcileSignalBrandPolicyCandidateV1({
        workspace,
        actor,
        policyBundleId: bundle.id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      }));
    }
    const reverse: Awaited<ReturnType<typeof reconcileSignalBrandPolicyCandidateV1>>[] = [];
    for (const moduleKey of [...MODULES].reverse()) {
      reverse.push(await reconcileSignalBrandPolicyCandidateV1({
        workspace,
        actor,
        policyBundleId: bundle.id,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      }));
    }
    const normalized = (rows: typeof normal) => rows.map((row) => ({
      module_key: row.module_key,
      population_id: row.population_id,
      compiled_plan_hash: row.compiled_plan_hash,
      membership_count: row.actual_membership_count,
      membership_digest: row.actual_membership_digest,
      compilation_status: row.compilation_status,
      blocking_reasons: row.blocking_reasons
    })).sort((a, b) => a.module_key.localeCompare(b.module_key));
    if (stableJson(normalized(normal)) !== stableJson(normalized(reverse))) {
      throw new Error("Module reconciliation order changed governed results.");
    }
    if (normal.some((row) => row.compilation_status !== "ready"
      || row.blocking_reasons.length > 0
      || row.governance_unknown_count !== 0
      || row.actual_membership_count !== before.candidate.membership_count
      || row.actual_membership_digest !== before.candidate.membership_digest)) {
      throw new Error("One or more governed module compilations failed readiness.");
    }
    if (new Set(normal.map((row) => row.population_id)).size !== MODULES.length
      || new Set(normal.map((row) => row.compiled_plan_hash)).size !== MODULES.length) {
      throw new Error("Governed module populations or plans are not isolated.");
    }
    const bindingPointerGuard = await inspectCurrentObjects(client, workspace.id);
    if (bindingPointerGuard.governed_bindings !== 0 || bindingPointerGuard.v2_pointers !== 0) {
      throw new Error("Backend 04B must not create governed bindings or V2 pointers.");
    }
    const protectedAfter = await inspectProtectedState(client);
    if (protectedAfter.aggregate_hash !== before.protected_state.aggregate_hash) {
      const changedDomains = Object.keys(before.protected_state)
        .filter((key) => key !== "aggregate_hash")
        .filter((key) => stableJson(
          before.protected_state[key as keyof ProtectedState]
        ) !== stableJson(protectedAfter[key as keyof ProtectedState]));
      throw new Error(
        `Backend 04B changed protected domains: ${changedDomains.join(",") || "unknown"}; `
        + `operational_v1=${JSON.stringify({
          before: before.protected_state.operational_v1,
          after: protectedAfter.operational_v1
        })}.`
      );
    }
    await client.query("COMMIT");
    return {
      effective_from: policies.effective_from,
      actor,
      workspace,
      policies,
      bundle_id: bundle.id,
      bundle_created: bundleCreated,
      watermarks,
      normal,
      reverse,
      protected_before: before.protected_state,
      protected_after: protectedAfter
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function shadowRehearsal(args: {
  directUrl: string;
  apply: Awaited<ReturnType<typeof applyRehearsal>>;
}) {
  const period = args.apply.normal[0]
    ? await periodForPopulation(
      args.directUrl,
      args.apply.workspace.id,
      args.apply.normal[0].base_population_id
    )
    : null;
  const boundedPeriod = period ? boundSignalServingPeriod(period) : null;
  const filter = normalizeSignalFilterV1({
    contract_version: "signal-backend-v1",
    date_range: {
      start: boundedPeriod?.start ?? "",
      end: boundedPeriod?.end ?? ""
    },
    timezone: args.apply.workspace.timezone,
    granularity: "month",
    dimensions: {}
  });
  const runOrder = async (modules: readonly SignalGovernedViewModuleKeyV1[]) => {
    const outputs = [];
    for (const moduleKey of modules) {
      const client = await connect(args.directUrl, "noisia-backend-04b-direct");
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await runSignalBrandDraftShadowV1({
          workspace: args.apply.workspace,
          actor: args.apply.actor,
          moduleKey,
          filter,
          queryable: client
        });
        await client.query("ROLLBACK");
        outputs.push(result);
      } finally {
        await client.end();
      }
    }
    return outputs;
  };
  const normal = await runOrder(MODULES);
  const reverse = await runOrder([...MODULES].reverse());
  const comparable = (rows: typeof normal) => rows.map((row) => ({
    module_key: row.public_evidence.module_key,
    population_id: row.private_identity.population_id,
    denominator: row.public_evidence.denominator,
    canonical_ids_hash: row.public_evidence.canonical_ids_hash,
    membership_digest: row.public_evidence.population.membership_digest,
    compiled_plan_hash: row.public_evidence.policy.compiled_plan_hash,
    gate_passed: row.public_evidence.gate_passed
  })).sort((a, b) => a.module_key.localeCompare(b.module_key));
  const normalComparable = comparable(normal);
  if (stableJson(normalComparable) !== stableJson(comparable(reverse))) {
    throw new Error("Draft-aware shadow is order-dependent.");
  }
  if (normal.some((row) => !row.public_evidence.gate_passed
    || row.public_evidence.legacy_differences.unexplained_count !== 0)
    || new Set(normalComparable.map((row) => row.population_id)).size !== MODULES.length
    || new Set(normalComparable.map((row) => row.compiled_plan_hash)).size !== MODULES.length
    || new Set(normalComparable.map((row) => row.denominator)).size !== 1
    || new Set(normalComparable.map((row) => row.canonical_ids_hash)).size !== 1
    || new Set(normalComparable.map((row) => row.membership_digest)).size !== 1) {
    throw new Error("Draft-aware shadow failed governed reconciliation.");
  }
  return {
    normal,
    reverse,
    comparable: normalComparable,
    filter,
    observed_period: period,
    serving_period: boundedPeriod
  };
}

function boundSignalServingPeriod(period: { start: string; end: string }) {
  const end = new Date(`${period.end}T00:00:00.000Z`);
  const earliest = new Date(end);
  earliest.setUTCDate(earliest.getUTCDate() - 365);
  const earliestStart = earliest.toISOString().slice(0, 10);
  return {
    start: period.start < earliestStart ? earliestStart : period.start,
    end: period.end,
    bounded_to_contract: period.start < earliestStart
  };
}

async function periodForPopulation(
  databaseUrl: string,
  workspaceId: string,
  populationId: string
) {
  const client = await connect(databaseUrl, "noisia-backend-04b-direct");
  try {
    return (await client.query<{ start: string; end: string }>(`
      SELECT min((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS start,
        max((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS end
      FROM signal_workspaces workspace
      JOIN signal_population_memberships membership
        ON membership.workspace_id=workspace.id AND membership.population_id=$2::uuid
       AND membership.membership_status='included' AND membership.removed_at IS NULL
      JOIN mentions mention ON mention.id=membership.mention_id
        AND mention.workspace_id=membership.workspace_id
      WHERE workspace.id=$1::uuid AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included'
      GROUP BY workspace.id
    `, [workspaceId, populationId])).rows[0]!;
  } finally {
    await client.end();
  }
}

async function verify(args: {
  directUrl: string;
  poolerUrl: string;
  manifest: Record<string, unknown>;
  restore: ReturnType<typeof assertRemoteGuards>;
  protectedBefore?: ProtectedState;
}) {
  const identity = await createIdentityEvidence(args);
  const client = await connect(args.directUrl, "noisia-backend-04b-direct");
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const workspace = identity.directState.workspace;
    const rows = await client.query<{
      module_key: SignalGovernedViewModuleKeyV1;
      population_id: string;
      membership_count: number;
      membership_digest: string;
      compiled_plan_hash: string;
      compilation_status: string;
      is_current: boolean;
      governance_unknown_count: number;
      usage_purposes: string[];
    }>(`
      SELECT compilation.module_key,population.id::text AS population_id,
        count(membership.mention_id) FILTER (WHERE membership.membership_status='included'
          AND membership.removed_at IS NULL)::int AS membership_count,
        population.membership_digest,compilation.compiled_plan_hash,
        compilation.compilation_status,compilation.is_current,
        compilation.governance_unknown_count,compilation.usage_purposes
      FROM signal_population_policy_compilations compilation
      JOIN signal_population_definitions population ON population.id=compilation.population_id
      LEFT JOIN signal_population_memberships membership ON membership.population_id=population.id
      WHERE compilation.workspace_id=$1::uuid AND compilation.is_current
        AND compilation.view_key='brand'
      GROUP BY compilation.id,population.id ORDER BY compilation.module_key
    `, [workspace.workspace_id]);
    const objects = await inspectCurrentObjects(client, workspace.workspace_id);
    const otherWorkspaceChanges = (await client.query<{ count: number }>(`
      SELECT (
        (SELECT count(*) FROM signal_quality_policies WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_retention_policies WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_licensing_policies WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_population_policy_bundles WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_governed_view_population_derivations WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_population_policy_compilations WHERE workspace_id<>$1::uuid)
        +(SELECT count(*) FROM signal_governed_view_bindings WHERE workspace_id<>$1::uuid)
      )::int AS count
    `, [workspace.workspace_id])).rows[0]!.count;
    await client.query("ROLLBACK");
    if (rows.rows.length !== MODULES.length
      || rows.rows.some((row) => row.compilation_status !== "ready" || !row.is_current
        || row.governance_unknown_count !== 0)
      || new Set(rows.rows.map((row) => row.population_id)).size !== MODULES.length
      || objects.governed_bindings !== 0 || objects.v2_pointers !== 0
      || otherWorkspaceChanges !== 0
      || (args.protectedBefore
        && args.protectedBefore.aggregate_hash !== identity.directState.protected_state.aggregate_hash)) {
      throw new Error("Backend 04B verify failed protected or governed invariants.");
    }
    return { identity, modules: rows.rows, objects, other_workspace_governance_rows: otherWorkspaceChanges };
  } finally {
    await client.end();
  }
}

function sanitizeApply(
  value: Awaited<ReturnType<typeof applyRehearsal>>,
  decisionHash: string
) {
  return {
    effective_from: value.effective_from,
    actor_key: safeKey("actor", value.actor.id),
    approval_evidence_hash: decisionHash,
    policies: {
      quality: { key: "laika-staging-observed-quality", version: 1, hash: value.policies.quality.expected_hash },
      retention: { key: "laika-staging-retention", version: 1, hash: value.policies.retention.expected_hash },
      licensing: { key: "laika-staging-client-usage", version: 1, hash: value.policies.licensing.expected_hash }
    },
    provenance_binding: {
      binding_key: safeKey("binding", value.policies.binding.binding_id),
      definition_hash: value.policies.binding.expected_hash,
      source_scope_only: true,
      import_exceptions: 0
    },
    modules: value.normal.map((row) => ({
      module_key: row.module_key,
      population_ref: safeKey("population", row.population_id),
      population_definition_hash: row.population_definition_hash,
      membership_count: row.actual_membership_count,
      membership_digest: row.actual_membership_digest,
      compiled_plan_hash: row.compiled_plan_hash,
      compilation_status: row.compilation_status,
      governance_unknown_count: row.governance_unknown_count,
      usage_purposes: row.usage_purposes
    })),
    reconciliation_order_independent: true,
    current_governed_bindings: 0,
    v2_pointers: 0,
    content_changed: value.bundle_created
      || value.policies.quality.created
      || value.policies.retention.created
      || value.policies.licensing.created
      || value.policies.binding.created
      || value.watermarks.some((watermark) => watermark.created)
  };
}

async function main() {
  const mode = readMode();
  const directUrl = required("DATABASE_URL");
  const poolerUrl = required("NOISIA_SIGNAL_GOVERNED_BRAND_POOLER_DATABASE_URL");
  const restore = assertRemoteGuards(mode, directUrl, poolerUrl);
  const manifest = await loadInputManifest();
  const preflightResult = await preflight({ directUrl, poolerUrl, manifest, restore });
  const artifacts: Array<{ path: string; sha256: string }> = [];
  artifacts.push(await writeArtifact("target-identity-reconciliation.private.json", {
    ...preflightResult.identity.evidence,
    direct: preflightResult.identity.directState
  }));
  artifacts.push(await writeArtifact(
    "target-identity-reconciliation.sanitized.json",
    preflightResult.identity.evidence
  ));
  artifacts.push(await writeArtifact("decision-artifact.private.json", preflightResult.decision));
  artifacts.push(await writeArtifact("decision-artifact.sanitized.json", {
    ...preflightResult.decision,
    approval_evidence_hash: preflightResult.decisionHash
  }));
  artifacts.push(await writeArtifact("fresh-preflight.private.json", {
    ...preflightResult.publicEvidence,
    workspace_id: preflightResult.identity.directState.workspace.workspace_id,
    source_id: preflightResult.identity.directState.source.source_id,
    base_population_id: preflightResult.identity.directState.candidate.population_id,
    last_import_batch_id: preflightResult.identity.directState.candidate.last_import_batch_id
  }));
  artifacts.push(await writeArtifact("fresh-preflight.sanitized.json", preflightResult.publicEvidence));

  if (mode === "preflight") {
    console.log(JSON.stringify({
      ok: true,
      mode,
      ...preflightResult.publicEvidence,
      artifacts
    }, null, 2));
    return;
  }

  if (mode === "verify") {
    const verified = await verify({ directUrl, poolerUrl, manifest, restore });
    const publicVerify = {
      contract_version: "signal-backend-04b-verify-v1",
      read_only: true,
      writes_performed: false,
      target_identity: verified.identity.evidence,
      modules: verified.modules.map((row) => ({
        module_key: row.module_key,
        population_ref: safeKey("population", row.population_id),
        membership_count: row.membership_count,
        membership_digest: row.membership_digest,
        compiled_plan_hash: row.compiled_plan_hash,
        compilation_status: row.compilation_status,
        governance_unknown_count: row.governance_unknown_count,
        usage_purposes: row.usage_purposes
      })),
      current_governed_bindings: verified.objects.governed_bindings,
      v2_pointers: verified.objects.v2_pointers,
      other_workspace_governance_rows: verified.other_workspace_governance_rows,
      gate_passed: true
    };
    artifacts.push(await writeArtifact("protected-state-after.private.json", verified.identity.directState.protected_state));
    artifacts.push(await writeArtifact("protected-state-after.sanitized.json", {
      aggregate_hash: verified.identity.directState.protected_state.aggregate_hash,
      operational_v1: verified.identity.directState.protected_state.operational_v1
    }));
    artifacts.push(await writeArtifact("verify.sanitized.json", publicVerify));
    console.log(JSON.stringify({ ok: true, mode, ...publicVerify, artifacts }, null, 2));
    return;
  }

  const applied = await applyRehearsal({ directUrl, manifest, preflightState: preflightResult });
  const appliedPublic = sanitizeApply(applied, preflightResult.decisionHash);
  artifacts.push(await writeArtifact("protected-state-before.private.json", applied.protected_before));
  artifacts.push(await writeArtifact("protected-state-before.sanitized.json", {
    aggregate_hash: applied.protected_before.aggregate_hash,
    operational_v1: applied.protected_before.operational_v1
  }));
  artifacts.push(await writeArtifact("policy-apply.private.json", applied));
  artifacts.push(await writeArtifact("policy-apply.sanitized.json", appliedPublic));
  artifacts.push(await writeArtifact("provenance-binding.private.json", applied.policies.binding));
  artifacts.push(await writeArtifact("provenance-binding.sanitized.json", appliedPublic.provenance_binding));
  artifacts.push(await writeArtifact("derived-populations.private.json", applied.normal));
  artifacts.push(await writeArtifact("derived-populations.sanitized.json", appliedPublic.modules));
  artifacts.push(await writeArtifact("module-compilations.private.json", applied.reverse));
  artifacts.push(await writeArtifact("module-compilations.sanitized.json", appliedPublic.modules));
  const shadow = await shadowRehearsal({ directUrl, apply: applied });
  const shadowPublic = {
    contract_version: "signal-backend-04b-shadow-v1",
    read_only: true,
    operational_pointer_followed: false,
    modules: shadow.normal.map((row) => row.public_evidence),
    order_independent: true,
    population_refs_distinct: true,
    compiled_plan_hashes_distinct: true,
    canonical_sets_equal: true,
    unexplained_count: shadow.normal.reduce(
      (total, row) => total + row.public_evidence.legacy_differences.unexplained_count,
      0
    ),
    gate_passed: shadow.normal.every((row) => row.public_evidence.gate_passed)
  };
  artifacts.push(await writeArtifact("shadow-reconciliation.private.json", shadow));
  artifacts.push(await writeArtifact("shadow-reconciliation.sanitized.json", shadowPublic));
  const verified = await verify({
    directUrl,
    poolerUrl,
    manifest,
    restore,
    protectedBefore: applied.protected_before
  });
  artifacts.push(await writeArtifact("protected-state-after.private.json", verified.identity.directState.protected_state));
  artifacts.push(await writeArtifact("protected-state-after.sanitized.json", {
    aggregate_hash: verified.identity.directState.protected_state.aggregate_hash,
    operational_v1: verified.identity.directState.protected_state.operational_v1
  }));
  console.log(JSON.stringify({
    ok: true,
    mode,
    writes_performed: true,
    target: "noisia-staging",
    project_ref_hash: PROJECT_REF_HASH,
    restore_point: restore,
    approval_evidence_hash: preflightResult.decisionHash,
    apply: appliedPublic,
    content_changed: appliedPublic.content_changed,
    shadow: shadowPublic,
    protected_state_equal: applied.protected_before.aggregate_hash
      === verified.identity.directState.protected_state.aggregate_hash,
    current_governed_bindings: verified.objects.governed_bindings,
    v2_pointers: verified.objects.v2_pointers,
    production_touched: false,
    readers_changed: false,
    artifacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
