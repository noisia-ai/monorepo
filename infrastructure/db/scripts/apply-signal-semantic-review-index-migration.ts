import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import pg from "pg";

const root = resolve(import.meta.dirname, "../../..");
const requireFromStudio = createRequire(resolve(root, "apps/studio/package.json"));
const { parse } = requireFromStudio("dotenv") as typeof import("dotenv");
const mode = process.argv[2];
const expectedProtected = process.argv[3] ?? null;
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const local = target === "local"
  && process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_LOCAL_REHEARSAL === "true";
const restoreAt = process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_RESTORE_POINT_AT;
const restoreHash = process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_RESTORE_POINT_HASH;
const filename = "0083_signal_semantic_review_projection_indexes.sql";
const migrationChecksum =
  "sha256:66049da1460b295ae00ec8b1b6d7ea9000d9b8894ef28c5cd15a20648c52e7cd";
const priorChecksum =
  "sha256:f000bfffe4378c36dad444aaf18235e9ce7ba50cff83c87803f519096b024c25";
const expected = {
  direct: "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project: "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32"
} as const;

if (!(["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" && !local) {
  throw new Error("Only noisia-staging or an explicit local rehearsal is authorized.");
}
if (!local && (!restoreAt || !restoreHash?.match(/^sha256:[0-9a-f]{64}$/u))) {
  throw new Error("A verified restore point is required.");
}
const restoreAgeHours = local ? 0 : (Date.now() - Date.parse(restoreAt!)) / 3_600_000;
if (!local && (!Number.isFinite(restoreAgeHours) || restoreAgeHours < 0 || restoreAgeHours > 24)) {
  throw new Error("The restore point must be less than 24 hours old.");
}
if (mode === "apply" && (
  process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_INDEX_MIGRATION_APPROVED !== "true"
  || process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_NO_APPS_CONFIRMED !== "true"
)) throw new Error("Apply requires migration and zero-app acknowledgements.");

const env = parse(await readFile(resolve(root, "apps/studio/.env.local"), "utf8"));
const poolerUrl = local
  ? process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_DATABASE_URL?.trim()
  : env.DATABASE_URL?.trim();
if (!poolerUrl) throw new Error("Canonical database configuration is unavailable.");
const directUrl = local ? poolerUrl : deriveDirect(poolerUrl);
if (!local && (
  fingerprint(poolerUrl) !== expected.pooler
  || fingerprint(directUrl) !== expected.direct
  || projectHash(poolerUrl, "pooler") !== expected.project
  || projectHash(directUrl, "direct") !== expected.project
)) throw new Error("Direct/pooler target identity mismatch.");
const migration = await readFile(resolve(root, "infrastructure/db/migrations", filename), "utf8");
if (sha256(migration) !== migrationChecksum) throw new Error("0083 checksum mismatch.");

const client = new pg.Client({
  connectionString: directUrl,
  ssl: local ? false : { rejectUnauthorized: false },
  application_name: "noisia-semantic-review-index-migration"
});
await client.connect();
try {
  await client.query("SET statement_timeout='10min'");
  await client.query("SET lock_timeout='30s'");
  const before = await inspect(client);
  if (before.state === "partial") throw new Error("0083 partial state is blocked.");
  if (mode === "preflight") emit({ mode, writes_performed: false, before });
  else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0083 is not complete.");
    emit({ mode, writes_performed: false, before });
  } else if (before.state === "complete") {
    emit({ mode, action: "verified_existing", writes_performed: false, before });
  } else {
    if (expectedProtected !== before.protected_state_hash) {
      throw new Error("Protected-state compare-and-swap failed.");
    }
    const activity = await client.query<{ writers: number; incompatible: number }>(`
      SELECT count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
          AND state IS DISTINCT FROM 'idle'
          AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int AS writers,
        count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
          AND state IS DISTINCT FROM 'idle')::int AS incompatible
      FROM pg_stat_activity WHERE datname=current_database()
    `);
    if (activity.rows[0]?.writers || activity.rows[0]?.incompatible) {
      throw new Error("Incompatible staging activity detected.");
    }
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      "noisia:semantic-review-scale:0083"
    ]);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "noisia:semantic-review-scale:0083"
      ]);
      const locked = await inspect(client);
      if (locked.state !== "absent" || locked.protected_state_hash !== expectedProtected) {
        throw new Error("Locked 0083 precondition drifted.");
      }
      await client.query(migration);
      if (await protectedState(client) !== expectedProtected) {
        throw new Error("0083 changed protected logical state.");
      }
      await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
        migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
      ) VALUES($1,83,$2,'applied','signal-semantic-review-index-v1',$3)`, [
        filename, migrationChecksum, local ? fingerprint(directUrl) : expected.direct
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        "noisia:semantic-review-scale:0083"
      ]);
    }
    const after = await inspect(client);
    if (
      after.state !== "complete"
      || after.protected_state_hash !== before.protected_state_hash
    ) throw new Error("0083 post-apply verification failed.");
    emit({ mode, action: "applied", writes_performed: true, before, after });
  }
} finally {
  await client.end();
}

async function inspect(connection: pg.Client) {
  const prerequisite = await connection.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal=82 AND checksum_sha256=$1 AND disposition='applied'
  `, [priorChecksum]);
  if (prerequisite.rows[0]?.count !== 1) throw new Error("0082 prerequisite is invalid.");
  const sentinels = await connection.query<{
    root_index: boolean;provenance_index:boolean;ledger_count:number
  }>(`
    SELECT to_regclass('idx_mentions_semantic_review_accepted_roots') IS NOT NULL AS root_index,
      to_regclass('idx_signal_mention_source_intent_workspace_root') IS NOT NULL AS provenance_index,
      (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
        WHERE ordinal=83 AND migration_name=$1 AND checksum_sha256=$2
          AND disposition='applied') AS ledger_count
  `, [filename, migrationChecksum]);
  const row = sentinels.rows[0]!;
  const present = Number(row.root_index) + Number(row.provenance_index);
  const state = present === 0 && row.ledger_count === 0
    ? "absent"
    : present === 2 && row.ledger_count === 1 ? "complete" : "partial";
  return {
    state,
    sentinel_count: present,
    sentinel_expected: 2,
    ledger_count: row.ledger_count,
    protected_state_hash: await protectedState(connection)
  };
}

async function protectedState(connection: pg.Client) {
  const result = await connection.query<{
    workspaces: number;mentions:number;attributions:number;reviews:number;
    pointers:number;bindings:number;resolution_runs:number;child_batches:number;
    child_outbox:number
  }>(`
    SELECT
      (SELECT count(*)::int FROM signal_workspaces) AS workspaces,
      (SELECT count(*)::int FROM mentions) AS mentions,
      (SELECT count(*)::int FROM signal_mention_attributions) AS attributions,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events) AS reviews,
      (SELECT count(*)::int FROM signal_workspace_population_pointers) AS pointers,
      (SELECT count(*)::int FROM signal_governed_view_bindings) AS bindings,
      (SELECT count(*)::int FROM signal_semantic_resolution_runs) AS resolution_runs,
      (SELECT count(*)::int FROM signal_semantic_resolution_child_batches) AS child_batches,
      (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox) AS child_outbox
  `);
  return sha256(stable(result.rows[0]));
}

function deriveDirect(value: string) {
  const parsed = new URL(value);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(
    decodeURIComponent(parsed.username).toLowerCase()
  )?.[1];
  if (!ref) throw new Error("Pooler shape invalid.");
  parsed.hostname = `db.${ref}.supabase.co`;
  parsed.port = "5432";
  parsed.username = "postgres";
  return parsed.toString();
}
function fingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
}
function projectHash(value: string, kind: "direct" | "pooler") {
  const parsed = new URL(value);
  const ref = kind === "direct"
    ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  if (!ref) throw new Error("Project identity unavailable.");
  return sha256(ref);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function emit(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }
