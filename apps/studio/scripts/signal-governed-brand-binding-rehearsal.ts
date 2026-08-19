import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  loadSignalGovernedBrandBindingSetPreflightV1,
  promoteSignalGovernedBrandBindingSetV1,
  withdrawSignalGovernedBrandBindingSetToBridgeV1
} from "../src/lib/data-os/signal-governed-brand-bindings";
import { resolveSignalGovernedViewV1 } from "../src/lib/data-os/signal-governed-view-resolver";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "../src/lib/data-os/signal-workspace";

const DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const EXPECTED_V1_DIGEST =
  "sha256:2e46c7565d2835e616824b1f9866faaea5f0a96b55a3c99978d58271baa0466e";
const EXPECTED_BASE_DIGEST =
  "sha256:1e66cf5906fb4163aee1fc1e408ab630fab2068a55382503c821ef7882b26880";
const MODULES = ["brand-monitoring", "mentions", "topics-narratives"] as const;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_DIRECTORY = resolve(REPOSITORY_ROOT, ".data/signal-7a/backend-05a");
const PREFIX = "NOISIA_SIGNAL_GOVERNED_BINDING_REHEARSAL";

type Mode = "preflight" | "promote" | "verify-governed" | "withdraw" | "verify-bridge" | "repromote" | "verify-final";
type Queryable = { query<Row extends Record<string, unknown> = Record<string, unknown>>(
  sql: string, params?: unknown[]
): Promise<{ rows: Row[]; rowCount: number | null }> };

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
  const value = (process.env[`${PREFIX}_MODE`] ?? "preflight").trim().toLowerCase();
  if (["preflight", "promote", "verify-governed", "withdraw", "verify-bridge", "repromote", "verify-final"].includes(value)) {
    return value as Mode;
  }
  throw new Error(`${PREFIX}_MODE is invalid.`);
}

function connectionFingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
}

function projectRefHash(value: string, kind: "direct" | "pooler") {
  const parsed = new URL(value);
  const ref = kind === "direct"
    ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase())?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!ref) throw new Error(`${kind} connection does not expose a project ref.`);
  return sha256(ref);
}

function assertGuards(mode: Mode, directUrl: string, poolerUrl: string) {
  if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "preview"
    || process.env[`${PREFIX}_ALLOW_REMOTE`] !== "true"
    || connectionFingerprint(directUrl) !== DIRECT_FINGERPRINT
    || connectionFingerprint(poolerUrl) !== POOLER_FINGERPRINT
    || projectRefHash(directUrl, "direct") !== PROJECT_REF_HASH
    || projectRefHash(poolerUrl, "pooler") !== PROJECT_REF_HASH) {
    throw new Error("Backend 05A target identity is not the audited noisia-staging project.");
  }
  const restoreAt = Date.parse(required(`${PREFIX}_RESTORE_POINT_AT`));
  const ageMs = Date.now() - restoreAt;
  if (process.env[`${PREFIX}_RESTORE_VERIFIED`] !== "true"
    || process.env[`${PREFIX}_ISOLATED_TARGET_CONFIRMED`] !== "true"
    || required(`${PREFIX}_RESTORE_REFERENCE`).length < 8
    || !Number.isFinite(restoreAt) || ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("Backend 05A requires a current verified restore point and isolated target.");
  }
  const writes = mode === "promote" || mode === "withdraw" || mode === "repromote";
  if (writes && (process.env[`${PREFIX}_WRITE_APPROVED`] !== "true"
    || !/^sha256:[0-9a-f]{64}$/u.test(process.env[`${PREFIX}_EXPECTED_SET_DIGEST`] ?? "")
    || required(`${PREFIX}_IDEMPOTENCY_KEY`).length < 8)) {
    throw new Error("Backend 05A write guards are incomplete.");
  }
  return {
    project_ref_hash: PROJECT_REF_HASH,
    restore_point_at: new Date(restoreAt).toISOString(),
    restore_point_age_hours: Math.round(ageMs / 36e5 * 10) / 10,
    writes
  };
}

function ssl() {
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
}

async function digestQuery(queryable: Queryable, fromSql: string, orderSql: string) {
  return (await queryable.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text,E'\\n' ORDER BY ${orderSql}),''),'UTF8')),'hex') AS content_hash
    FROM ${fromSql} row_value
  `)).rows[0]!;
}

async function loadWorkspaceAndActor(queryable: Queryable) {
  const result = await queryable.query<{
    workspace_id: string; organization_id: string; brand_id: string; slug: string; brand_name: string;
    timezone: string; status: string; actor_id: string; actor_organization_id: string | null;
  }>(`
    SELECT workspace.id::text AS workspace_id,workspace.organization_id::text,
      workspace.brand_id::text,workspace.slug,brand.name AS brand_name,
      workspace.timezone,workspace.status,
      bundle.created_by_user_id::text AS actor_id,actor.organization_id::text AS actor_organization_id
    FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
    JOIN signal_population_policy_bundles bundle ON bundle.workspace_id=workspace.id
      AND bundle.policy_key='operational-brand-governed' AND bundle.policy_version=1
    JOIN users actor ON actor.id=bundle.created_by_user_id AND actor.user_type='noisia_internal'
    WHERE brand.slug='laika'
  `);
  if (result.rows.length !== 1 || result.rows[0]?.status !== "active") {
    throw new Error("Backend 05A requires one active Laika workspace and server-owned actor.");
  }
  const row = result.rows[0]!;
  const workspace: ResolvedSignalWorkspace = {
    contractVersion: "signal-backend-v1",
    id: row.workspace_id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.brand_name,
    timezone: row.timezone,
    status: "active",
    subject: { type: "brand", id: row.brand_id },
    corpora: []
  };
  const actor: SignalWorkspaceUser = {
    id: row.actor_id,
    userType: "noisia_internal",
    organizationId: row.actor_organization_id
  };
  return { workspace, actor };
}

async function inspectProtected(queryable: Queryable, workspaceId: string) {
  const v1 = (await queryable.query<{
    membership_count: number; included_count: number; digest: string;
  }>(`
    WITH v1 AS (
      SELECT definition.id,definition.workspace_id FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer ON pointer.population_id=definition.id
      WHERE pointer.purpose='operational' AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version' IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT concat_ws('|',v1.workspace_id::text,v1.id::text,membership.mention_id::text,
        membership.membership_status,COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    ) SELECT (SELECT count(*)::int FROM signal_population_memberships m JOIN v1 ON v1.id=m.population_id) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships m JOIN v1 ON v1.id=m.population_id
        WHERE m.membership_status='included' AND m.removed_at IS NULL) AS included_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value) FROM members),''),'UTF8')),'hex') AS digest
  `)).rows[0]!;
  const base = (await queryable.query<{ membership_count: number; membership_digest: string }>(`
    WITH base AS (SELECT id,membership_digest FROM signal_population_definitions
      WHERE workspace_id=$1::uuid AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2')
    SELECT count(membership.mention_id) FILTER (WHERE membership.membership_status='included'
      AND membership.removed_at IS NULL)::int AS membership_count,base.membership_digest
    FROM base LEFT JOIN signal_population_memberships membership ON membership.population_id=base.id
    GROUP BY base.membership_digest
  `, [workspaceId])).rows[0]!;
  const state = {
    operational_v1: v1,
    semantic_base: base,
    pointers: await digestQuery(queryable, "signal_workspace_population_pointers", "row_value.workspace_id,row_value.purpose"),
    assertions: await digestQuery(queryable, "signal_mention_attributions", "row_value.workspace_id,row_value.mention_id,row_value.id"),
    review: await digestQuery(queryable, "signal_mention_attribution_review_events", "row_value.workspace_id,row_value.created_at,row_value.id"),
    compilations: await digestQuery(queryable, "signal_population_policy_compilations", "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.compilation_version")
  };
  if (v1.digest !== EXPECTED_V1_DIGEST || base.membership_count !== 276
    || base.membership_digest !== EXPECTED_BASE_DIGEST) {
    throw new Error("Backend 05A protected V1 or semantic-base state drifted.");
  }
  return { ...state, aggregate_hash: sha256(stableJson(state)) };
}

async function inspectBindings(queryable: Queryable, workspaceId: string) {
  const bindings = (await queryable.query<{
    module_key: typeof MODULES[number]; binding_id: string; binding_version: number;
    population_id: string; policy_compilation_id: string; binding_status: string;
    binding_digest: string;
  }>(`
    SELECT binding.module_key,binding.id::text AS binding_id,binding.binding_version,
      binding.population_id::text,binding.policy_compilation_id::text,binding.binding_status,
      signal_governed_view_binding_digest_v1(binding.id) AS binding_digest
    FROM signal_governed_view_bindings binding
    WHERE binding.workspace_id=$1::uuid AND binding.view_key='brand'
      AND binding.module_key=ANY($2::text[])
    ORDER BY binding.module_key,binding.binding_version
  `, [workspaceId, [...MODULES]])).rows;
  const events = (await queryable.query<{
    action: string; module_key: string; previous_binding_id: string | null;
    next_binding_id: string | null; created_at: string;
  }>(`
    SELECT action,module_key,previous_binding_id::text,next_binding_id::text,created_at::text
    FROM signal_governed_view_binding_events
    WHERE workspace_id=$1::uuid AND view_key='brand' AND module_key=ANY($2::text[])
    ORDER BY created_at,id
  `, [workspaceId, [...MODULES]])).rows;
  const operations = (await queryable.query<{
    action: string; request_digest: string; result_digest: string; created_at: string;
  }>(`
    SELECT action,request_digest,result_digest,created_at::text
    FROM signal_governed_brand_binding_set_operations WHERE workspace_id=$1::uuid
    ORDER BY created_at,id
  `, [workspaceId])).rows;
  return { bindings, events, operations };
}

async function inspectActivity(queryable: Queryable) {
  const row = (await queryable.query<{ active_incompatible: number; named_apps: number; active_writers: number }>(`
    SELECT count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND state IS DISTINCT FROM 'idle')::int AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND state IS DISTINCT FROM 'idle' AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
  if (row.active_incompatible > 0 || row.named_apps > 0 || row.active_writers > 0) {
    throw new Error("Backend 05A found an incompatible application or writer connection.");
  }
  return { ...row, application_names_redacted: true };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (/(^|_)(id|ids)$/u.test(key) && typeof entry === "string") {
      return [key.replace(/_id$/u, "_ref"), sha256(entry).slice(0, 20)];
    }
    return [key, sanitize(entry)];
  }));
}

async function writeEvidence(mode: Mode, privateState: unknown, sanitizedState: unknown) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  const privatePath = resolve(OUTPUT_DIRECTORY, `${mode}.private.json`);
  const sanitizedPath = resolve(OUTPUT_DIRECTORY, `${mode}.sanitized.json`);
  const privateBytes = `${JSON.stringify(privateState, null, 2)}\n`;
  const sanitizedBytes = `${JSON.stringify(sanitizedState, null, 2)}\n`;
  await writeFile(privatePath, privateBytes, { mode: 0o600 });
  await writeFile(sanitizedPath, sanitizedBytes, { mode: 0o600 });
  await chmod(privatePath, 0o600);
  await chmod(sanitizedPath, 0o600);
  return [
    { path: relative(REPOSITORY_ROOT, privatePath), sha256: sha256(privateBytes) },
    { path: relative(REPOSITORY_ROOT, sanitizedPath), sha256: sha256(sanitizedBytes) }
  ];
}

async function main() {
  const mode = readMode();
  const directUrl = required("DATABASE_URL");
  const poolerUrl = required(`${PREFIX}_POOLER_DATABASE_URL`);
  const guard = assertGuards(mode, directUrl, poolerUrl);
  const manifest = {
    contract_version: "backend-05a-governed-brand-binding-rehearsal-v1",
    target: "noisia-staging",
    workspace_selector: "brand:laika",
    modules: MODULES,
    view_key: "brand",
    actions: ["promote", "withdraw-to-bridge", "promote"],
    migration_checksum: "sha256:df1381a270083b0fc91943e1a7be438b9fa4fd71c736ce2b2ad3ed85e1c44b11",
    restore_point_at: guard.restore_point_at
  };
  const manifestHash = sha256(stableJson(manifest));
  const client = new pg.Client({ connectionString: directUrl, ssl: ssl(), application_name: "noisia-backend-05a-rehearsal" });
  await client.connect();
  let readOnly = false;
  try {
    await client.query("SET statement_timeout='15min'; SET lock_timeout='15s'");
    const activity = await inspectActivity(client);
    const { workspace, actor } = await loadWorkspaceAndActor(client);
    const protectedBefore = await inspectProtected(client, workspace.id);
    const bindingBefore = await inspectBindings(client, workspace.id);
    let operation = null;
    if (guard.writes) {
      const expectedSetDigest = required(`${PREFIX}_EXPECTED_SET_DIGEST`);
      const idempotencyKey = required(`${PREFIX}_IDEMPOTENCY_KEY`);
      operation = mode === "withdraw"
        ? await withdrawSignalGovernedBrandBindingSetToBridgeV1({ workspace, actor, expectedSetDigest, idempotencyKey })
        : await promoteSignalGovernedBrandBindingSetV1({ workspace, actor, expectedSetDigest, idempotencyKey });
    } else {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      readOnly = true;
    }
    const preflight = await loadSignalGovernedBrandBindingSetPreflightV1({ workspace, actor, queryable: client });
    const resolutions = [];
    if (mode.startsWith("verify")) {
      for (const moduleKey of MODULES) {
        const descriptor = await resolveSignalGovernedViewV1(workspace, { module_key: moduleKey, view_key: "brand" });
        resolutions.push({
          module_key: moduleKey,
          resolution_source: descriptor.resolution_source,
          population_id: descriptor.population?.population_id ?? null,
          policy_compilation_id: descriptor.population?.policy_compilation_id ?? null,
          membership_digest: descriptor.population?.membership_digest ?? null,
          coverage_state: "partial",
          abstained: { availability: "not_available", value: null }
        });
      }
      const expectedSource = mode === "verify-bridge" ? "operational-brand-bridge" : "governed-binding";
      if (!resolutions.every((entry) => entry.resolution_source === expectedSource)) {
        throw new Error(`Backend 05A resolver did not return ${expectedSource}.`);
      }
    }
    const bindingAfter = await inspectBindings(client, workspace.id);
    const protectedAfter = await inspectProtected(client, workspace.id);
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Backend 05A changed protected V1/base/pointer/Review/compilation state.");
    }
    if (readOnly) {
      await client.query("ROLLBACK");
      readOnly = false;
    }
    const privateState = {
      ok: true, mode, read_only: !guard.writes,
      writes_performed: guard.writes && operation?.replayed !== true,
      target: "noisia-staging", target_identity: { direct_fingerprint: DIRECT_FINGERPRINT,
        pooler_fingerprint: POOLER_FINGERPRINT, project_ref_hash: PROJECT_REF_HASH },
      restore: guard, manifest, manifest_hash: manifestHash, activity,
      workspace_id: workspace.id, actor_user_id: actor.id,
      preflight, operation, resolutions, protected_before: protectedBefore,
      protected_after: protectedAfter, protected_equal: true,
      binding_before: bindingBefore, binding_after: bindingAfter,
      pointers_changed: false, readers_changed: false, production_touched: false,
      workers_llm_tb_executed: false
    };
    const sanitizedState = sanitize(privateState);
    const artifacts = await writeEvidence(mode, privateState, sanitizedState);
    console.log(JSON.stringify({ ...(sanitizedState as object), artifacts }, null, 2));
  } finally {
    if (readOnly) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
    const { pool } = await import("../src/lib/db");
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
