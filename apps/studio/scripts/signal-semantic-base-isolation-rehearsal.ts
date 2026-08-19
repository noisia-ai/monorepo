import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSignalFilterV1, type SignalGovernedViewModuleKeyV1 } from "@noisia/query-engine";
import pg from "pg";

import {
  reconcileSignalBrandPolicyCandidateV1,
  SIGNAL_BRAND_POLICY_KEY,
  SIGNAL_BRAND_POLICY_VERSION
} from "../src/lib/data-os/signal-governed-brand-policy";
import { runSignalBrandDraftShadowV1 } from "../src/lib/data-os/signal-governed-brand-shadow";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "../src/lib/data-os/signal-workspace";

const DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const EXPECTED_V1_DIGEST =
  "sha256:2e46c7565d2835e616824b1f9866faaea5f0a96b55a3c99978d58271baa0466e";
const EXPECTED_BASE_COUNT = 276;
const EXPECTED_BASE_DIGEST =
  "sha256:1e66cf5906fb4163aee1fc1e408ab630fab2068a55382503c821ef7882b26880";
const MODULES = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalGovernedViewModuleKeyV1[];
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:backend-04c:semantic-base-isolation";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_DIRECTORY = resolve(REPOSITORY_ROOT, ".data", "signal-7a", "backend-04c");

type Mode = "preflight" | "apply" | "verify";
type Queryable = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readMode(): Mode {
  const value = (process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_MODE
    ?? "preflight").trim().toLowerCase();
  if (value === "preflight" || value === "apply" || value === "verify") return value;
  throw new Error("NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_MODE is invalid.");
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
    if (!match?.[1]) throw new Error("Direct connection does not expose a project ref.");
    return match[1];
  }
  const match = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase());
  if (!match?.[1]) throw new Error("Pooler connection does not expose a project ref.");
  return match[1];
}

function ssl() {
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
}

function assertGuards(mode: Mode, directUrl: string, poolerUrl: string) {
  if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "preview") {
    throw new Error("Backend 04C requires NOISIA_REMOTE_DATABASE_TARGET=preview.");
  }
  if (process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_ALLOW_REMOTE !== "true") {
    throw new Error("Backend 04C remote preflight approval is required.");
  }
  if (connectionFingerprint(directUrl) !== DIRECT_FINGERPRINT
    || connectionFingerprint(poolerUrl) !== POOLER_FINGERPRINT) {
    throw new Error("Backend 04C connection fingerprint mismatch.");
  }
  const directRef = projectRef(directUrl, "direct");
  const poolerRef = projectRef(poolerUrl, "pooler");
  if (directRef !== poolerRef || sha256(directRef) !== PROJECT_REF_HASH) {
    throw new Error("Direct and pooler connections do not identify noisia-staging.");
  }
  const restoreAt = Date.parse(required("NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_POINT_AT"));
  const ageMs = Date.now() - restoreAt;
  if (process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_VERIFIED !== "true"
    || !Number.isFinite(restoreAt) || ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000
    || required("NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_REFERENCE").length < 8) {
    throw new Error("Backend 04C requires a current verified restore point.");
  }
  if (mode === "apply") {
    if (process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_APPLY_APPROVED !== "true"
      || process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_ISOLATED_TARGET_CONFIRMED !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(
        process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_EXPECTED_STATE_DIGEST ?? ""
      )) {
      throw new Error("Backend 04C apply guards are incomplete.");
    }
  }
  return {
    project_ref_hash: PROJECT_REF_HASH,
    restore_point_at: new Date(restoreAt).toISOString(),
    restore_point_age_hours: Math.round(ageMs / 36e5 * 10) / 10
  };
}

async function connect(value: string, applicationName: string) {
  const client = new pg.Client({ connectionString: value, ssl: ssl(), application_name: applicationName });
  await client.connect();
  return client;
}

async function digestQuery(client: Queryable, fromSql: string, orderSql: string) {
  return (await client.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text,E'\\n' ORDER BY ${orderSql}
      ),''),'UTF8')),'hex') AS content_hash
    FROM ${fromSql} row_value
  `)).rows[0]!;
}

async function inspectV1(client: Queryable) {
  return (await client.query<{
    definition_count: number;
    pointer_count: number;
    membership_count: number;
    included_count: number;
    digest: string;
  }>(`
    WITH v1 AS (
      SELECT definition.id,definition.workspace_id
      FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer ON pointer.population_id=definition.id
      WHERE pointer.purpose='operational'
        AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), rows AS (
      SELECT concat_ws('|',v1.workspace_id::text,v1.id::text,membership.mention_id::text,
        membership.membership_status,COALESCE(membership.removed_at::text,'∅')) AS value
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
}

async function inspectWorkspace(client: Queryable) {
  const rows = (await client.query<{
    workspace_id: string;
    organization_id: string;
    brand_id: string;
    workspace_slug: string;
    status: string;
    timezone: string;
  }>(`
    SELECT workspace.id::text AS workspace_id,workspace.organization_id::text,
      workspace.brand_id::text,workspace.slug AS workspace_slug,workspace.status,workspace.timezone
    FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
    WHERE brand.slug='laika'
  `)).rows;
  if (rows.length !== 1 || rows[0]?.status !== "active") {
    throw new Error("Backend 04C requires exactly one active Laika workspace.");
  }
  return rows[0]!;
}

async function inspectBase(client: Queryable, workspaceId: string) {
  const rows = (await client.query<{
    population_id: string;
    version: number;
    definition_hash: string;
    policy_key: string;
    policy_version: string;
    membership_digest: string;
    membership_count: number;
    computed_membership_digest: string;
    membership_rows_digest: string;
    exact_contract: boolean;
  }>(`
    WITH base AS (
      SELECT definition.* FROM signal_population_definitions definition
      WHERE definition.workspace_id=$1::uuid
        AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT membership.* FROM base JOIN signal_population_memberships membership
        ON membership.population_id=base.id
      WHERE membership.membership_status='included' AND membership.removed_at IS NULL
    )
    SELECT base.id::text AS population_id,base.version,base.definition_hash,
      base.policy_key,base.policy_version,base.membership_digest,
      (SELECT count(*)::int FROM members) AS membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(mention_id::text,',' ORDER BY mention_id)
        FROM members),''),'UTF8')),'hex') AS computed_membership_digest,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(concat_ws('|',
        mention_id::text,membership_status,membership_reason,COALESCE(removed_at::text,'∅')),
        E'\\n' ORDER BY mention_id) FROM members),''),'UTF8')),'hex') AS membership_rows_digest,
      base.policy_key='primary-brand-semantic' AND base.policy_version='1'
        AND base.definition=signal_operational_semantic_base_definition_v2()
        AND base.definition_hash=signal_operational_semantic_base_definition_hash_v2(base.workspace_id,base.version)
        AS exact_contract
    FROM base
  `, [workspaceId])).rows;
  if (rows.length !== 1) throw new Error("Expected exactly one Laika semantic base.");
  return rows[0]!;
}

async function inspectModules(client: Queryable, workspaceId: string) {
  return (await client.query<{
    module_key: SignalGovernedViewModuleKeyV1;
    population_id: string;
    membership_count: number;
    membership_digest: string;
    compiled_plan_hash: string;
    compilation_id: string;
    compilation_status: string;
    is_current: boolean;
    governance_unknown_count: number;
  }>(`
    SELECT compilation.module_key,population.id::text AS population_id,
      count(membership.mention_id) FILTER (WHERE membership.membership_status='included'
        AND membership.removed_at IS NULL)::int AS membership_count,
      population.membership_digest,compilation.compiled_plan_hash,
      compilation.id::text AS compilation_id,compilation.compilation_status,
      compilation.is_current,compilation.governance_unknown_count
    FROM signal_population_policy_compilations compilation
    JOIN signal_population_definitions population ON population.id=compilation.population_id
    LEFT JOIN signal_population_memberships membership ON membership.population_id=population.id
    WHERE compilation.workspace_id=$1::uuid AND compilation.view_key='brand'
      AND compilation.is_current
    GROUP BY compilation.id,population.id ORDER BY compilation.module_key
  `, [workspaceId])).rows;
}

async function inspectProtected(client: Queryable, workspaceId: string) {
  const state = {
    operational_v1: await inspectV1(client),
    pointers: await digestQuery(
      client, "signal_workspace_population_pointers", "row_value.workspace_id,row_value.purpose"
    ),
    assertions: await digestQuery(
      client, "signal_mention_attributions", "row_value.workspace_id,row_value.mention_id,row_value.id"
    ),
    review: await digestQuery(
      client,
      "signal_mention_attribution_review_events",
      "row_value.workspace_id,row_value.attribution_id,row_value.created_at,row_value.id"
    ),
    base: await inspectBase(client, workspaceId),
    derivations: await digestQuery(
      client,
      "signal_governed_view_population_derivations",
      "row_value.workspace_id,row_value.module_key,row_value.view_key"
    ),
    derived_populations: await digestQuery(
      client,
      `(SELECT definition.id,definition.workspace_id,definition.population_key,
          definition.version,definition.purpose,definition.status,
          definition.acceptance_status,definition.allowed_scopes,
          definition.min_quality_score,definition.period_start,definition.period_end,
          definition.definition_hash,definition.policy_key,definition.policy_version,
          definition.timezone,definition.membership_digest,definition.created_by_user_id,
          definition.definition
        FROM signal_population_definitions definition
        WHERE definition.definition->>'contract_version'='signal-governed-view-resolved-population-v1')`,
      "row_value.workspace_id,row_value.population_key,row_value.version"
    ),
    derived_memberships: await digestQuery(
      client,
      `(SELECT membership.* FROM signal_population_memberships membership
        JOIN signal_population_definitions definition ON definition.id=membership.population_id
        WHERE definition.definition->>'contract_version'='signal-governed-view-resolved-population-v1')`,
      "row_value.workspace_id,row_value.population_id,row_value.mention_id"
    ),
    compilations: await digestQuery(
      client,
      "signal_population_policy_compilations",
      "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.compilation_version"
    ),
    policies: await digestQuery(
      client,
      `(SELECT 'quality'::text AS kind,id,workspace_id,definition_hash,status,updated_at
        FROM signal_quality_policies UNION ALL
        SELECT 'retention',id,workspace_id,definition_hash,status,updated_at FROM signal_retention_policies
        UNION ALL SELECT 'licensing',id,workspace_id,definition_hash,status,updated_at
        FROM signal_licensing_policies)`,
      "row_value.workspace_id,row_value.kind,row_value.id"
    ),
    watermarks: await digestQuery(
      client, "signal_data_watermarks", "row_value.workspace_id,row_value.population_id,row_value.id"
    ),
    legacy_materializations: await digestQuery(
      client,
      "metric_materializations",
      "row_value.workspace_id,row_value.metric_key,row_value.period_start,row_value.period_end,row_value.id"
    ),
    releases: await digestQuery(
      client, "signal_workspace_current_releases", "row_value.workspace_id"
    ),
    running_syncs: await digestQuery(
      client, "(SELECT * FROM source_sync_runs WHERE status='running')", "row_value.id"
    )
  };
  return { ...state, aggregate_hash: sha256(stableJson(state)) };
}

async function inspectLedger(client: Queryable) {
  const rows = (await client.query<{
    ordinal: number;
    migration_name: string;
    checksum_sha256: string;
  }>(`
    SELECT ordinal,migration_name,checksum_sha256 FROM ${LEDGER}
    WHERE ordinal BETWEEN 59 AND 70 ORDER BY ordinal
  `)).rows;
  if (rows.map((row) => row.ordinal).join(",")
    !== "59,60,61,62,63,64,65,66,67,68,69,70") {
    throw new Error("Backend 04C requires exact ledger 0059-0070.");
  }
  if (rows.find((row) => row.ordinal === 70)?.checksum_sha256
    !== "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910") {
    throw new Error("Backend 04C 0070 ledger checksum mismatch.");
  }
  return { rows, digest: sha256(stableJson(rows)) };
}

async function inspectConnections(client: Queryable) {
  return (await client.query<{
    active_incompatible: number;
    named_apps: number;
    active_writers: number;
  }>(`
    SELECT count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name NOT IN ('noisia-backend-04c-direct','noisia-backend-04c-pooler'))::int
        AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
}

async function snapshot(client: Queryable) {
  const workspace = await inspectWorkspace(client);
  const ledger = await inspectLedger(client);
  const protectedState = await inspectProtected(client, workspace.workspace_id);
  const modules = await inspectModules(client, workspace.workspace_id);
  const guards = (await client.query<{ governed_bindings: number; v2_pointers: number }>(`
    SELECT (SELECT count(*)::int FROM signal_governed_view_bindings
      WHERE workspace_id=$1::uuid) AS governed_bindings,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
        JOIN signal_population_definitions definition ON definition.id=pointer.population_id
        WHERE pointer.workspace_id=$1::uuid AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2') AS v2_pointers
  `, [workspace.workspace_id])).rows[0]!;
  if (protectedState.operational_v1.digest !== EXPECTED_V1_DIGEST
    || protectedState.base.membership_count !== EXPECTED_BASE_COUNT
    || protectedState.base.membership_digest !== EXPECTED_BASE_DIGEST
    || protectedState.base.computed_membership_digest !== EXPECTED_BASE_DIGEST
    || !protectedState.base.exact_contract
    || modules.length !== 3
    || modules.some((module) => module.compilation_status !== "ready" || !module.is_current
      || module.governance_unknown_count !== 0)
    || guards.governed_bindings !== 0 || guards.v2_pointers !== 0) {
    throw new Error("Backend 04C staging invariants are not satisfied.");
  }
  return {
    workspace,
    workspace_identity_hash: sha256(stableJson(workspace)),
    ledger,
    protected_state: protectedState,
    modules,
    guards
  };
}

async function readOnlySnapshot(value: string, applicationName: string) {
  const client = await connect(value, applicationName);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const database = (await client.query<{ name: string }>(
      "SELECT current_database() AS name"
    )).rows[0]!.name;
    const result = await snapshot(client);
    await client.query("ROLLBACK");
    return { database_name_hash: sha256(database), ...result };
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
    semantic_base: {
      definition_hash: value.protected_state.base.definition_hash,
      policy_key: value.protected_state.base.policy_key,
      policy_version: value.protected_state.base.policy_version,
      membership_count: value.protected_state.base.membership_count,
      membership_digest: value.protected_state.base.membership_digest,
      membership_rows_digest: value.protected_state.base.membership_rows_digest,
      exact_contract: value.protected_state.base.exact_contract
    },
    modules: value.modules.map((module) => ({
      module_key: module.module_key,
      population_ref: `population_${sha256(module.population_id).slice(7, 19)}`,
      membership_count: module.membership_count,
      membership_digest: module.membership_digest,
      compiled_plan_hash: module.compiled_plan_hash,
      compilation_status: module.compilation_status,
      governance_unknown_count: module.governance_unknown_count
    })),
    guards: value.guards
  };
}

async function identityPreflight(args: {
  directUrl: string;
  poolerUrl: string;
  restore: ReturnType<typeof assertGuards>;
}) {
  const direct = await readOnlySnapshot(args.directUrl, "noisia-backend-04c-direct");
  const pooler = await readOnlySnapshot(args.poolerUrl, "noisia-backend-04c-pooler");
  if (stableJson(publicSnapshot(direct)) !== stableJson(publicSnapshot(pooler))) {
    throw new Error("Direct and pooler Backend 04C snapshots differ.");
  }
  const client = await connect(args.directUrl, "noisia-backend-04c-direct");
  try {
    const connections = await inspectConnections(client);
    if (connections.active_incompatible > 0 || connections.named_apps > 0
      || connections.active_writers > 0) {
      throw new Error("An incompatible app or writer is connected to noisia-staging.");
    }
    return { direct, public: publicSnapshot(direct), connections, restore: args.restore };
  } finally {
    await client.end();
  }
}

async function loadActor(client: Queryable, workspaceId: string): Promise<SignalWorkspaceUser> {
  const row = (await client.query<{
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
  `, [workspaceId])).rows[0];
  if (!row) throw new Error("No authorized internal actor is available for Backend 04C.");
  return { id: row.id, userType: row.user_type, organizationId: row.organization_id };
}

async function loadWorkspace(
  client: Queryable,
  identity: Awaited<ReturnType<typeof inspectWorkspace>>
): Promise<ResolvedSignalWorkspace> {
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
    status: identity.status,
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

async function loadBundleId(client: Queryable, workspaceId: string) {
  const rows = (await client.query<{ id: string }>(`
    SELECT id::text FROM signal_population_policy_bundles
    WHERE workspace_id=$1::uuid AND policy_key=$2
      AND policy_version=$3 AND status='draft'
  `, [workspaceId, SIGNAL_BRAND_POLICY_KEY, SIGNAL_BRAND_POLICY_VERSION])).rows;
  if (rows.length !== 1) throw new Error("Backend 04C requires one brand policy draft.");
  return rows[0]!.id;
}

async function recompile(args: {
  directUrl: string;
  preflight: Awaited<ReturnType<typeof identityPreflight>>;
}) {
  const client = await connect(args.directUrl, "noisia-backend-04c-direct");
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
    const connections = await inspectConnections(client);
    if (connections.active_incompatible > 0 || connections.named_apps > 0
      || connections.active_writers > 0) {
      throw new Error("A writer appeared before Backend 04C recompilation.");
    }
    const before = await snapshot(client);
    if (before.protected_state.aggregate_hash
      !== process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_REHEARSAL_EXPECTED_STATE_DIGEST
      || before.protected_state.aggregate_hash !== args.preflight.direct.protected_state.aggregate_hash) {
      throw new Error("Backend 04C protected state changed after preflight.");
    }
    const actor = await loadActor(client, before.workspace.workspace_id);
    const workspace = await loadWorkspace(client, before.workspace);
    const policyBundleId = await loadBundleId(client, workspace.id);
    const run = async (moduleKey: SignalGovernedViewModuleKeyV1) =>
      reconcileSignalBrandPolicyCandidateV1({
        workspace,
        actor,
        policyBundleId,
        moduleKey,
        reconcileMemberships: true,
        queryable: client
      });
    const normal: Awaited<ReturnType<typeof reconcileSignalBrandPolicyCandidateV1>>[] = [];
    for (const moduleKey of MODULES) normal.push(await run(moduleKey));
    const reverse: Awaited<ReturnType<typeof reconcileSignalBrandPolicyCandidateV1>>[] = [];
    for (const moduleKey of [...MODULES].reverse()) reverse.push(await run(moduleKey));
    const comparable = (rows: typeof normal) => rows.map((row) => ({
      module_key: row.module_key,
      population_id: row.population_id,
      membership_count: row.actual_membership_count,
      membership_digest: row.actual_membership_digest,
      compiled_plan_hash: row.compiled_plan_hash,
      compilation_id: row.policy_compilation_id,
      compilation_status: row.compilation_status,
      governance_unknown_count: row.governance_unknown_count
    })).sort((left, right) => left.module_key.localeCompare(right.module_key));
    if (stableJson(comparable(normal)) !== stableJson(comparable(reverse))) {
      throw new Error("Backend 04C recompilation is order-dependent.");
    }
    const after = await snapshot(client);
    if (stableJson(before.protected_state) !== stableJson(after.protected_state)
      || stableJson(before.modules) !== stableJson(after.modules)) {
      const changedDomains = Object.keys(before.protected_state)
        .filter((key) => stableJson(
          before.protected_state[key as keyof typeof before.protected_state]
        ) !== stableJson(after.protected_state[key as keyof typeof after.protected_state]));
      throw new Error(
        `Backend 04C retry changed protected domains: ${changedDomains.join(",") || "none"}; `
        + `module_state_changed=${stableJson(before.modules) !== stableJson(after.modules)}.`
      );
    }
    await client.query("COMMIT");
    return { before, after, actor, workspace, normal, reverse, comparable: comparable(normal) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function servingPeriod(databaseUrl: string, workspaceId: string, populationId: string) {
  const client = await connect(databaseUrl, "noisia-backend-04c-direct");
  try {
    return (await client.query<{ start: string; end: string }>(`
      SELECT min((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS start,
        max((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS end
      FROM signal_workspaces workspace
      JOIN signal_population_memberships membership ON membership.workspace_id=workspace.id
        AND membership.population_id=$2::uuid AND membership.membership_status='included'
        AND membership.removed_at IS NULL
      JOIN mentions mention ON mention.id=membership.mention_id
      WHERE workspace.id=$1::uuid AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included' GROUP BY workspace.id
    `, [workspaceId, populationId])).rows[0]!;
  } finally {
    await client.end();
  }
}

async function shadow(args: {
  directUrl: string;
  recompiled: Awaited<ReturnType<typeof recompile>>;
}) {
  const basePopulationId = args.recompiled.normal[0]!.base_population_id;
  const period = await servingPeriod(args.directUrl, args.recompiled.workspace.id, basePopulationId);
  const end = new Date(`${period.end}T00:00:00.000Z`);
  const earliest = new Date(end);
  earliest.setUTCDate(earliest.getUTCDate() - 365);
  const start = period.start < earliest.toISOString().slice(0, 10)
    ? earliest.toISOString().slice(0, 10)
    : period.start;
  const filter = normalizeSignalFilterV1({
    contract_version: "signal-backend-v1",
    date_range: { start, end: period.end },
    timezone: args.recompiled.workspace.timezone,
    granularity: "month",
    dimensions: {}
  });
  const outputs = [];
  for (const moduleKey of MODULES) {
    const client = await connect(args.directUrl, "noisia-backend-04c-direct");
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      outputs.push(await runSignalBrandDraftShadowV1({
        workspace: args.recompiled.workspace,
        actor: args.recompiled.actor,
        moduleKey,
        filter,
        queryable: client
      }));
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
  const unexplainedCount = outputs.reduce(
    (sum, output) => sum + output.public_evidence.legacy_differences.unexplained_count,
    0
  );
  if (outputs.some((output) => !output.public_evidence.gate_passed) || unexplainedCount !== 0) {
    throw new Error("Backend 04C shadow reconciliation failed.");
  }
  return { outputs, filter, unexplained_count: unexplainedCount, gate_passed: true };
}

async function writeArtifact(name: string, value: unknown) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  const path = resolve(OUTPUT_DIRECTORY, name);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  return { path: `.data/signal-7a/backend-04c/${name}`, sha256: sha256(content) };
}

async function main() {
  const mode = readMode();
  const directUrl = required("DATABASE_URL");
  const poolerUrl = required("NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_POOLER_DATABASE_URL");
  const restore = assertGuards(mode, directUrl, poolerUrl);
  const preflight = await identityPreflight({ directUrl, poolerUrl, restore });
  const artifacts = [
    await writeArtifact("target-identity.private.json", preflight),
    await writeArtifact("target-identity.sanitized.json", {
      target: "noisia-staging",
      project_ref_hash: PROJECT_REF_HASH,
      direct_fingerprint: DIRECT_FINGERPRINT,
      pooler_fingerprint: POOLER_FINGERPRINT,
      restore,
      snapshot: preflight.public,
      connections: { ...preflight.connections, application_names_redacted: true }
    }),
    await writeArtifact("base-before.private.json", preflight.direct.protected_state.base),
    await writeArtifact("base-before.sanitized.json", preflight.public.semantic_base),
    await writeArtifact("v1-before.sanitized.json", preflight.public.operational_v1)
  ];
  if (mode === "preflight" || mode === "verify") {
    console.log(JSON.stringify({
      ok: true,
      mode,
      read_only: true,
      writes_performed: false,
      target: "noisia-staging",
      project_ref_hash: PROJECT_REF_HASH,
      restore,
      state: preflight.public,
      artifacts
    }, null, 2));
    return;
  }
  const recompiled = await recompile({ directUrl, preflight });
  const shadowResult = await shadow({ directUrl, recompiled });
  const after = await readOnlySnapshot(directUrl, "noisia-backend-04c-direct");
  if (after.protected_state.aggregate_hash !== preflight.direct.protected_state.aggregate_hash) {
    throw new Error("Backend 04C post-shadow protected state changed.");
  }
  artifacts.push(
    await writeArtifact("base-after.private.json", after.protected_state.base),
    await writeArtifact("base-after.sanitized.json", publicSnapshot(after).semantic_base),
    await writeArtifact("v1-after.sanitized.json", after.protected_state.operational_v1),
    await writeArtifact("derivations-compilations.private.json", recompiled),
    await writeArtifact("derivations-compilations.sanitized.json", publicSnapshot(after).modules),
    await writeArtifact("shadow-reconciliation.private.json", shadowResult),
    await writeArtifact("shadow-reconciliation.sanitized.json", {
      read_only: true,
      operational_pointer_followed: false,
      modules: shadowResult.outputs.map((output) => output.public_evidence),
      unexplained_count: shadowResult.unexplained_count,
      gate_passed: shadowResult.gate_passed
    }),
    await writeArtifact("retry-idempotency.sanitized.json", {
      normal_reverse_equal: true,
      protected_state_equal: true,
      modules: recompiled.comparable.map((module) => ({
        module_key: module.module_key,
        population_ref: `population_${sha256(module.population_id).slice(7, 19)}`,
        membership_count: module.membership_count,
        membership_digest: module.membership_digest,
        compiled_plan_hash: module.compiled_plan_hash,
        compilation_status: module.compilation_status,
        governance_unknown_count: module.governance_unknown_count
      }))
    })
  );
  console.log(JSON.stringify({
    ok: true,
    mode,
    writes_performed: true,
    semantic_content_changed: false,
    target: "noisia-staging",
    project_ref_hash: PROJECT_REF_HASH,
    restore,
    base_before_after_equal: stableJson(preflight.direct.protected_state.base)
      === stableJson(after.protected_state.base),
    v1_before_after_equal: stableJson(preflight.direct.protected_state.operational_v1)
      === stableJson(after.protected_state.operational_v1),
    protected_state_equal: preflight.direct.protected_state.aggregate_hash
      === after.protected_state.aggregate_hash,
    current_governed_bindings: after.guards.governed_bindings,
    v2_pointers: after.guards.v2_pointers,
    shadow: {
      gate_passed: shadowResult.gate_passed,
      unexplained_count: shadowResult.unexplained_count
    },
    readers_changed: false,
    production_touched: false,
    workers_llm_tb_executed: false,
    artifacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
