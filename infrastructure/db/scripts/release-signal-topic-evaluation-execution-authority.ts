/**
 * Hand-verified runner for the one forward-only 0113 Topic Evaluation V2 authority migration.
 *
 * It deliberately reads the UAT connection from the ignored Studio environment but only emits
 * fingerprints and digests. `apply` is unavailable without a sealed preflight, fresh restore
 * receipt and an exact approval literal. It creates no execution authority, run, candidate or
 * provider request; the migration only adds disabled control-plane schema.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

import pg from "pg";

process.umask(0o077);

const ROOT = resolve(import.meta.dirname, "../../..");
const MIGRATION_FILE = "0113_signal_topic_evaluation_full_evidence_execution_authority.sql";
const MIGRATION_PATH = resolve(ROOT, "infrastructure/db/migrations", MIGRATION_FILE);
const MODE = process.argv[2] ?? "";
const MODES = new Set(["preflight", "capture", "apply", "verify"]);
const ENV_PREFIX = "NOISIA_TOPIC_EVALUATION_V2_0113";
const EXPECTED = {
  // The target is the existing non-production Preview/UAT pooler, not production.
  uatTargetFingerprint: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  predecessorChecksum: "sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5",
  checksum: "sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71"
} as const;

if (!MODES.has(MODE)) throw new Error("Mode must be preflight, capture, apply or verify.");

const localRehearsal = process.env[`${ENV_PREFIX}_LOCAL_REHEARSAL`] === "true";
const evidenceDir = required(`${ENV_PREFIX}_EVIDENCE_DIR`);
const databaseUrl = loadDatabaseUrl();
const targetFingerprint = fingerprint(databaseUrl);
if (!localRehearsal && targetFingerprint !== EXPECTED.uatTargetFingerprint) {
  throw new Error("The configured database is not the sealed Preview/UAT target.");
}
const migrationSql = await readFile(MIGRATION_PATH, "utf8");
if (digest(migrationSql) !== EXPECTED.checksum) throw new Error("0113 migration checksum mismatch.");
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: localRehearsal ? false : { rejectUnauthorized: false },
  application_name: `noisia-topic-evaluation-0113-${MODE}`
});
await client.connect();
try {
  await client.query("SET statement_timeout='15min'");
  await client.query("SET lock_timeout='30s'");
  if (MODE === "preflight" || MODE === "verify") await readOnly(client, MODE);
  if (MODE === "capture") await capture(client);
  if (MODE === "apply") await apply(client);
} finally {
  await client.end();
}

async function readOnly(client: pg.Client, mode: "preflight" | "verify") {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await inspect(client);
    const expectedState = mode === "preflight" ? "absent" : "complete";
    if (state.migration_state !== expectedState) {
      throw new Error(`${mode} expected 0113 ${expectedState}, found ${state.migration_state}.`);
    }
    assertInvariantState(state);
    const txid = (await client.query<{ value: string | null }>("SELECT txid_current_if_assigned()::text value"))
      .rows[0]?.value;
    if (txid !== null) throw new Error("Read-only migration probe unexpectedly received a transaction id.");
    await client.query("ROLLBACK");
    await emit(`${mode}.sanitized.json`, envelope(mode, state, false));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function capture(client: pg.Client) {
  const preflight = await readReceipt("preflight.sanitized.json") as {
    mode?: string; writes_performed?: boolean; state?: { migration_state?: string };
  };
  if (preflight.mode !== "preflight" || preflight.writes_performed !== false
      || preflight.state?.migration_state !== "absent") {
    throw new Error("A current sealed 0113 preflight is required before backup capture.");
  }
  const dumpPath = resolve(evidenceDir, "preview-uat-before-0113.public.dump");
  const reusedExistingArchive = existsSync(dumpPath);
  if (!reusedExistingArchive) await runPgDump(dumpPath);
  const tocEntries = await verifyArchive(dumpPath);
  if (tocEntries < 3_000) throw new Error("Restore archive verification found too few table-of-contents entries.");

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const after = await inspect(client);
    if (stable(after) !== stable(preflight.state)) throw new Error("Database changed during restore capture.");
    await client.query("ROLLBACK");
    await emit("restore.sanitized.json", {
      contract_version: "signal-topic-evaluation-v2-0113-restore-v1",
      recorded_at: new Date().toISOString(),
      target: publicTarget(),
      preflight_sha256: digest(readFileSync(resolve(evidenceDir, "preflight.sanitized.json"))),
      restore: {
        file: "preview-uat-before-0113.public.dump",
        sha256: digest(readFileSync(dumpPath)),
        bytes: readFileSync(dumpPath).byteLength,
        toc_entries: tocEntries,
        complete_archive_stream_verified: true,
        reused_existing_verified_archive: reusedExistingArchive,
        recoverable: true
      },
      writes_performed: false,
      production_accessed: false
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function apply(client: pg.Client) {
  if (process.env[`${ENV_PREFIX}_APPLY_APPROVED`] !== "apply-0113-once") {
    throw new Error("Apply requires the exact 0113 approval literal.");
  }
  const preflightBytes = readFileSync(resolve(evidenceDir, "preflight.sanitized.json"));
  const restoreBytes = readFileSync(resolve(evidenceDir, "restore.sanitized.json"));
  if (process.env[`${ENV_PREFIX}_PREFLIGHT_SHA256`] !== digest(preflightBytes)
      || process.env[`${ENV_PREFIX}_RESTORE_SHA256`] !== digest(restoreBytes)) {
    throw new Error("Apply requires the exact current preflight and restore receipt hashes.");
  }
  const preflight = JSON.parse(preflightBytes.toString("utf8"));
  const restore = JSON.parse(restoreBytes.toString("utf8"));
  if (preflight.state?.migration_state !== "absent" || restore.restore?.recoverable !== true) {
    throw new Error("The sealed apply preconditions are not satisfied.");
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "noisia:signal-topic-evaluation-v2:0113"
    ]);
    const before = await inspect(client);
    if (before.migration_state !== "absent" || stable(before) !== stable(preflight.state)) {
      throw new Error("0113 preflight state drifted while acquiring the migration lock.");
    }
    assertInvariantState(before);
    await client.query(migrationSql);
    const partial = await inspect(client);
    if (partial.migration_state !== "partial") throw new Error("0113 sentinels failed before ledger registration.");
    await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
      migration_name, ordinal, checksum_sha256, disposition, runner_version, target_fingerprint
    ) VALUES($1,113,$2,'applied','topic-evaluation-v2-0113-release-v1',$3)`,
    [MIGRATION_FILE, EXPECTED.checksum, targetFingerprint]);
    const after = await inspect(client);
    if (after.migration_state !== "complete") throw new Error("0113 ledger or sentinel verification failed.");
    assertInvariantState(after);
    if (stable(before.frozen_snapshot) !== stable(after.frozen_snapshot)
        || stable(before.protected_state) !== stable(after.protected_state)) {
      throw new Error("0113 changed frozen Topic authority or protected serving state.");
    }
    await client.query("COMMIT");
    await emit("apply.sanitized.json", {
      ...envelope("apply", after, true), action: "applied_exactly_once",
      preflight_sha256: digest(preflightBytes), restore_sha256: digest(restoreBytes)
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function inspect(client: pg.Client) {
  const ledger = (await client.query<{ ordinal: number; migration_name: string; checksum_sha256: string; disposition: string }>(`
    SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 112 AND 113 ORDER BY ordinal
  `)).rows;
  const sentinels = (await client.query<{
    authority_table: boolean; authority_protector: boolean; pair_validator: boolean; run_column: boolean;
    authority_trigger: boolean; pair_authority_trigger: boolean; pair_run_trigger: boolean;
  }>(`SELECT
    to_regclass('signal_topic_evaluation_v2_execution_authorizations') IS NOT NULL authority_table,
    to_regprocedure('protect_signal_topic_evaluation_v2_execution_authorization_v1()') IS NOT NULL authority_protector,
    to_regprocedure('validate_signal_topic_evaluation_v2_execution_pair_v1()') IS NOT NULL pair_validator,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='signal_topic_evaluation_v2_runs' AND column_name='execution_authorization_id') run_column,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_protect_signal_topic_evaluation_v2_execution_authorization'
      AND NOT tgisinternal) authority_trigger,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_signal_topic_evaluation_v2_execution_authorization_pair'
      AND NOT tgisinternal) pair_authority_trigger,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_signal_topic_evaluation_v2_execution_run_pair'
      AND NOT tgisinternal) pair_run_trigger`)).rows[0]!;
  const frozenSnapshot = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_snapshots) snapshots,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters) clusters,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships) memberships,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label>=0) assigned,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label=-1) outliers,
    (SELECT COALESCE(json_agg(json_build_object('snapshot_digest',snapshot_digest,'rights_digest',rights_digest)
      ORDER BY snapshot_digest),'[]'::json) FROM signal_topic_evaluation_v2_snapshots) digests
  `)).rows[0]!;
  const authorizations = sentinels.authority_table
    ? Number((await client.query<{ count: number }>(
      "SELECT count(*)::int count FROM signal_topic_evaluation_v2_execution_authorizations"
    )).rows[0]?.count ?? 0)
    : 0;
  const evaluation = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals) retrievals,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings) rankings,
    (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs) provider_calls
  `)).rows[0]!;
  const protectedCounts = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_workspaces) workspaces,
    (SELECT count(*)::int FROM mentions) mentions,
    (SELECT count(*)::int FROM signal_workspace_population_pointers) pointers,
    (SELECT count(*)::int FROM signal_governed_view_bindings) bindings,
    (SELECT count(*)::int FROM signal_semantic_context_generations) generations
  `)).rows[0]!;
  const pointerRows = (await client.query("SELECT to_jsonb(value) row FROM signal_workspace_population_pointers value ORDER BY id")).rows;
  const bindingRows = (await client.query("SELECT to_jsonb(value) row FROM signal_governed_view_bindings value ORDER BY id")).rows;
  const row112 = ledger.find((row) => Number(row.ordinal) === 112);
  const row113 = ledger.find((row) => Number(row.ordinal) === 113);
  const allSentinels = Object.values(sentinels).every(Boolean);
  const noSentinels = Object.values(sentinels).every((value) => !value);
  const predecessorValid = row112?.migration_name === "0112_signal_topic_evaluation_full_evidence_control_plane.sql"
    && row112.checksum_sha256 === EXPECTED.predecessorChecksum && row112.disposition === "applied";
  const migration0113Valid = row113?.migration_name === MIGRATION_FILE && row113.checksum_sha256 === EXPECTED.checksum
    && row113.disposition === "applied";
  const migration_state = !row113 && noSentinels ? "absent"
    : Boolean(migration0113Valid && allSentinels) ? "complete" : "partial";
  return {
    migration_state, predecessor_valid: predecessorValid,
    ledger: ledger.map((row) => ({ ...row, ordinal: Number(row.ordinal) })), sentinels,
    frozen_snapshot: frozenSnapshot, evaluation: { authorizations, ...evaluation },
    protected_state: { digest: digest(stable({ counts: protectedCounts, pointers: pointerRows, bindings: bindingRows })) }
  };
}

function assertInvariantState(state: Awaited<ReturnType<typeof inspect>>) {
  if (!state.predecessor_valid) throw new Error("0112 ledger prerequisite is invalid.");
  const snapshot = state.frozen_snapshot as Record<string, unknown>;
  const expected = { snapshots: 1, clusters: 116, memberships: 21195, assigned: 11186, outliers: 10009 };
  for (const [key, value] of Object.entries(expected)) if (Number(snapshot[key]) !== value) {
    throw new Error(`Frozen Topic snapshot ${key} did not match the sealed authority.`);
  }
  const evaluation = state.evaluation as Record<string, unknown>;
  for (const key of ["authorizations", "runs", "retrievals", "candidates", "rankings", "provider_calls"]) {
    if (Number(evaluation[key]) !== 0) throw new Error(`Topic Evaluation V2 ${key} must remain zero for 0113.`);
  }
}

function loadDatabaseUrl() {
  if (localRehearsal) return required(`${ENV_PREFIX}_DATABASE_URL`);
  const requireFromStudio = createRequire(resolve(ROOT, "apps/studio/package.json"));
  const { parse } = requireFromStudio("dotenv") as typeof import("dotenv");
  const env = parse(readFileSync(resolve(ROOT, "apps/studio/.env.local"), "utf8"));
  if (!env.DATABASE_URL) throw new Error("Studio UAT database configuration is unavailable.");
  return env.DATABASE_URL;
}

async function runPgDump(destination: string) {
  const url = new URL(databaseUrl);
  const container = process.env[`${ENV_PREFIX}_PG_TOOL_CONTAINER`];
  const toolHost = process.env[`${ENV_PREFIX}_PG_TOOL_HOST`] ?? url.hostname;
  const toolPort = (process.env[`${ENV_PREFIX}_PG_TOOL_PORT`] ?? url.port) || "5432";
  const password = decodeURIComponent(url.password);
  if (/\r|\n/u.test(password)) throw new Error("The database password cannot be safely supplied to pg_dump.");
  const baseArgs = ["--format=custom", "--no-owner", "--no-acl", "--schema=public"];
  const connectionEnv = {
    PGHOST: toolHost,
    PGPORT: toolPort,
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: url.pathname.slice(1),
    PGSSLMODE: localRehearsal ? "disable" : "require"
  };
  if (container) {
    // Docker exposes `exec -e PGPASSWORD=...` in the host process list. Feed the password
    // over stdin to a tiny non-logging wrapper instead, then exec pg_dump with only safe
    // connection metadata in its environment.
    await spawnToFile("docker", ["exec", "-i",
      ...Object.entries(connectionEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      container, "sh", "-ceu", "IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_dump \"$@\"", "sh", ...baseArgs
    ], destination, `${password}\n`);
  } else {
    await spawnToFile(process.env[`${ENV_PREFIX}_PG_DUMP_COMMAND`] ?? "pg_dump", baseArgs, destination,
      undefined, { ...connectionEnv, PGPASSWORD: password });
  }
  await chmod(destination, 0o600);
}

async function verifyArchive(source: string) {
  const container = process.env[`${ENV_PREFIX}_PG_TOOL_CONTAINER`];
  const command = container ? "docker" : process.env[`${ENV_PREFIX}_PG_RESTORE_COMMAND`] ?? "pg_restore";
  const args = container ? ["exec", "-i", container, "pg_restore", "--list"] : ["--list"];
  const output = await spawnWithInput(command, args, source);
  return output.split("\n").filter((line) => /^\d+;/u.test(line)).length;
}

function spawnToFile(
  command: string,
  args: string[],
  destination: string,
  stdin?: string,
  environment?: Record<string, string>
) {
  return new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(destination, { mode: 0o600 });
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: environment ? { ...process.env, ...environment } : process.env
    });
    let stderr = "";
    child.stdin.end(stdin);
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      output.end(() => {
        if (code === 0) resolvePromise();
        else {
          void unlink(destination).catch(() => undefined);
          reject(new Error(`${command} dump failed (${code}): ${redact(stderr).slice(0, 500)}`));
        }
      });
    });
  });
}

function spawnWithInput(command: string, args: string[], source: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const input = createReadStream(source);
    input.on("error", reject);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    input.pipe(child.stdin);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} restore verification failed (${code}): ${redact(stderr).slice(0, 500)}`));
    });
  });
}

async function readReceipt(name: string) {
  const bytes = await readFile(resolve(evidenceDir, name));
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

async function emit(name: string, value: Record<string, unknown>) {
  const path = resolve(evidenceDir, name);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(JSON.stringify({ artifact: name, sha256: digest(bytes), mode: value.mode ?? value.contract_version }));
}

function envelope(mode: string, state: Record<string, unknown>, writes: boolean) {
  return {
    contract_version: "signal-topic-evaluation-v2-0113-release-v1", mode,
    recorded_at: new Date().toISOString(), target: publicTarget(), writes_performed: writes,
    provider_calls_added: 0, topic_candidates_added: 0, topic_adoptions_added: 0,
    publications_added: 0, serving_effects: 0, production_accessed: false, state
  };
}

function publicTarget() {
  return { environment: localRehearsal ? "local-disposable" : "Preview/UAT", target_fingerprint: targetFingerprint,
    production_accessed: false };
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function fingerprint(value: string) {
  const url = new URL(value);
  // Keep the long-established Preview/UAT pooler fingerprint contract. This deliberately
  // excludes the password while retaining scheme, host, port, database and username.
  return digest([
    url.protocol,
    url.hostname.toLowerCase(),
    url.port || "5432",
    url.pathname.replace(/^\//u, ""),
    decodeURIComponent(url.username)
  ].join("|"));
}
function digest(value: string | Buffer) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}
function redact(value: string) { return value.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "<redacted-url>"); }
