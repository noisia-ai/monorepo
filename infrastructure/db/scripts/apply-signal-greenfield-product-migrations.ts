import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import pg from "pg";

const repositoryRoot = resolve(import.meta.dirname,"../../..");
const requireFromStudio = createRequire(resolve(repositoryRoot,"apps/studio/package.json"));
const { parse } = requireFromStudio("dotenv") as typeof import("dotenv");
const mode = process.argv[2];
const expectedProtectedState = process.argv[3] ?? null;
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const restoreAt = process.env.NOISIA_SIGNAL_GREENFIELD_RESTORE_POINT_AT;
const restoreReferenceHash = process.env.NOISIA_SIGNAL_GREENFIELD_RESTORE_REFERENCE_HASH;
const expected = {
  direct: "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project: "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32",
  migration77: "sha256:64b8302b598744807e6dba2aafd0d3e99f8e49192767cbcc82f70e02921f128c",
  migration78: "sha256:5496e56013711267fe009298ee4ba69b9a43f1cade4335a8d89a14af7c40b96e"
} as const;
const filenames = [
  "0077_signal_operational_bridge_digest.sql",
  "0078_signal_greenfield_product_control_plane.sql"
] as const;
const appName = "noisia-backend-09-greenfield-migrations";

if (!(["preflight","apply","verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging") throw new Error("Only noisia-staging is allowed.");
if (!restoreAt || !restoreReferenceHash?.match(/^sha256:[0-9a-f]{64}$/u)) {
  throw new Error("A verified restore point timestamp and sanitized reference hash are required.");
}
const restoreAgeHours = (Date.now() - Date.parse(restoreAt)) / 3_600_000;
if (!Number.isFinite(restoreAgeHours) || restoreAgeHours < 0 || restoreAgeHours > 24) {
  throw new Error("The verified restore point is not fresh enough for this transition.");
}
if (mode === "apply" && (process.env.NOISIA_SIGNAL_GREENFIELD_MIGRATIONS_APPROVED !== "true"
    || process.env.NOISIA_SIGNAL_GREENFIELD_NO_APPS_CONFIRMED !== "true")) {
  throw new Error("Apply requires migration and no-app acknowledgements.");
}

const env = parse(await readFile(resolve(repositoryRoot,"apps/studio/.env.local"),"utf8"));
const poolerUrl = env.DATABASE_URL?.trim();
if (!poolerUrl || env.DATABASE_SSL !== "true") throw new Error("Canonical staging connection is unavailable.");
const directUrl = deriveDirect(poolerUrl);
if (fingerprint(poolerUrl) !== expected.pooler || fingerprint(directUrl) !== expected.direct
    || projectHash(poolerUrl,"pooler") !== expected.project
    || projectHash(directUrl,"direct") !== expected.project) {
  throw new Error("Direct/pooler target identity mismatch.");
}

const migrationSql = await Promise.all(filenames.map((filename) => (
  readFile(resolve(repositoryRoot,"infrastructure/db/migrations",filename),"utf8")
)));
if (sha256(migrationSql[0]!) !== expected.migration77
    || sha256(migrationSql[1]!) !== expected.migration78) {
  throw new Error("Greenfield migration checksum mismatch.");
}

const direct = new pg.Client({ connectionString: directUrl,ssl: { rejectUnauthorized: false },application_name: appName });
await direct.connect();
try {
  await configure(direct);
  const before = await inspectIdentity(direct);
  const activity = await inspectActivity(direct);
  const peerBefore = await inspectPeer(poolerUrl);
  assertSameIdentity(before,peerBefore);
  if (before.state === "partial") throw new Error("0077/0078 partial state is blocked.");
  if (mode === "preflight") {
    emit({ mode,state: before.state,writes_performed: false,before,activity });
  } else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0077/0078 are not complete.");
    emit({ mode,state: before.state,writes_performed: false,before,activity });
  } else {
    if (before.state === "complete") {
      emit({ mode,state: "complete",action: "verified_existing",writes_performed: false,before,activity });
    } else {
      if (expectedProtectedState !== before.protected_state_hash) {
        throw new Error("Protected-state compare-and-swap failed.");
      }
      await direct.query("SELECT pg_advisory_lock(hashtextextended($1,0))",["noisia:backend-09:0077-0078"]);
      try {
        await direct.query("BEGIN");
        await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["noisia:backend-09:0077-0078"]);
        const locked = await inspectIdentity(direct);
        if (locked.state !== "absent" || locked.protected_state_hash !== expectedProtectedState) {
          throw new Error("Locked migration precondition drifted.");
        }
        await direct.query(migrationSql[0]!);
        await direct.query(migrationSql[1]!);
        const migrated = await inspectSentinels(direct);
        if (migrated.object_count !== 9 || migrated.ledger_count !== 0) {
          throw new Error("Migration sentinels failed before ledger registration.");
        }
        const protectedAfterDdl = await protectedState(direct);
        if (protectedAfterDdl !== expectedProtectedState) {
          throw new Error("0077/0078 changed protected authority or memberships.");
        }
        const bridge = await bridgeIntegrity(direct);
        if (bridge.invalid_digest_count !== 0) throw new Error("Operational bridge digest remains invalid.");
        await direct.query(`INSERT INTO signal_workspace_data_plane_migration_ledger (
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES
          ($1,77,$2,'applied','signal-greenfield-product-migrations-v1',$5),
          ($3,78,$4,'applied','signal-greenfield-product-migrations-v1',$5)`,[
          filenames[0],expected.migration77,filenames[1],expected.migration78,expected.direct
        ]);
        await direct.query("COMMIT");
      } catch (error) {
        await direct.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await direct.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",["noisia:backend-09:0077-0078"]);
      }
      const after = await inspectIdentity(direct);
      const peerAfter = await inspectPeer(poolerUrl);
      assertSameIdentity(after,peerAfter);
      if (after.state !== "complete" || after.protected_state_hash !== before.protected_state_hash) {
        throw new Error("Post-apply verification failed.");
      }
      emit({ mode,state: after.state,action: "applied",writes_performed: true,before,after,activity });
    }
  }
} finally {
  await direct.end();
}

async function configure(client: pg.Client) {
  await client.query("SET statement_timeout='120s'");
  await client.query("SET lock_timeout='15s'");
  await client.query("SET idle_in_transaction_session_timeout='5min'");
}

async function inspectIdentity(client: pg.Client) {
  const database = await client.query<{ value: string }>("SELECT current_database() AS value");
  const sentinels = await inspectSentinels(client);
  const prior = await client.query<{ ordinal: number; checksum_sha256: string }>(`
    SELECT ordinal,checksum_sha256 FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal BETWEEN 59 AND 78 ORDER BY ordinal
  `);
  const prior76 = prior.rows.find((row) => row.ordinal === 76);
  if (!prior76 || prior.rows.some((row) => row.ordinal < 59 || row.ordinal > 78)) {
    throw new Error("Governed migration ledger prerequisite is unavailable.");
  }
  const objectComplete = sentinels.object_count === 9;
  const ledgerComplete = sentinels.ledger_count === 2;
  const state = !objectComplete && sentinels.object_count === 0 && sentinels.ledger_count === 0
    ? "absent" : objectComplete && ledgerComplete ? "complete" : "partial";
  return {
    database_hash: sha256(database.rows[0]!.value),state,
    sentinel_count: sentinels.object_count,ledger_count: sentinels.ledger_count,
    ledger_digest: sha256(stable(prior.rows)),
    protected_state_hash: await protectedState(client),
    bridge_integrity: await bridgeIntegrity(client)
  };
}

async function inspectSentinels(client: pg.Client) {
  const result = await client.query<{ object_count: number; ledger_count: number }>(`
    SELECT (
      (to_regprocedure('refresh_signal_operational_bridge_membership_digest_v1(uuid)') IS NOT NULL)::int
      + (to_regprocedure('protect_signal_governance_control_operation_v1()') IS NOT NULL)::int
      + (to_regclass('signal_governance_control_operations') IS NOT NULL)::int
      + (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_operational_bridge_digest_import' AND NOT tgisinternal))::int
      + (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_operational_bridge_digest_review' AND NOT tgisinternal))::int
      + (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_zz_operational_bridge_digest_source' AND NOT tgisinternal))::int
      + (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_operational_bridge_digest_membership' AND NOT tgisinternal))::int
      + (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_protect_signal_governance_control_operation' AND NOT tgisinternal))::int
      + (EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uq_import_batches_product_idempotency'))::int
    )::int AS object_count,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE (ordinal=77 AND migration_name=$1 AND checksum_sha256=$2 AND disposition='applied')
         OR (ordinal=78 AND migration_name=$3 AND checksum_sha256=$4 AND disposition='applied')) AS ledger_count
  `,[filenames[0],expected.migration77,filenames[1],expected.migration78]);
  return result.rows[0]!;
}

async function protectedState(client: pg.Client) {
  const projections = [
    ["population_definitions",`SELECT to_jsonb(row_value)-'membership_digest'-'updated_at' AS value
      FROM signal_population_definitions row_value`],
    ["population_memberships",`SELECT to_jsonb(row_value) AS value FROM signal_population_memberships row_value`],
    ["population_pointers",`SELECT to_jsonb(row_value) AS value FROM signal_workspace_population_pointers row_value`],
    ["semantic_assertions",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attributions row_value`],
    ["semantic_review",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attribution_review_events row_value`],
    ["policy_bundles",`SELECT to_jsonb(row_value) AS value FROM signal_population_policy_bundles row_value`],
    ["policy_compilations",`SELECT to_jsonb(row_value) AS value FROM signal_population_policy_compilations row_value`],
    ["governed_bindings",`SELECT to_jsonb(row_value) AS value FROM signal_governed_view_bindings row_value`],
    ["governed_binding_events",`SELECT to_jsonb(row_value) AS value FROM signal_governed_view_binding_events row_value`],
    ["quality_policies",`SELECT to_jsonb(row_value) AS value FROM signal_quality_policies row_value`],
    ["retention_policies",`SELECT to_jsonb(row_value) AS value FROM signal_retention_policies row_value`],
    ["licensing_policies",`SELECT to_jsonb(row_value) AS value FROM signal_licensing_policies row_value`],
    ["provenance_bindings",`SELECT to_jsonb(row_value) AS value FROM signal_provenance_policy_bindings row_value`],
    ["strategic_runs",`SELECT to_jsonb(row_value) AS value FROM signal_strategic_run_controls row_value`],
    ["releases",`SELECT to_jsonb(row_value) AS value FROM signal_workspace_releases row_value`]
  ] as const;
  const domains: Record<string,{ row_count: number; digest: string }> = {};
  for (const [name,projection] of projections) {
    const result = await client.query<{ row_count: number; digest: string }>(`
      SELECT count(*)::int AS row_count,
        'sha256:'||encode(sha256(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),'')::bytea),'hex') AS digest
      FROM (SELECT sha256(convert_to(value::text,'UTF8')) AS row_hash FROM (${projection}) projected) hashed
    `);
    domains[name] = result.rows[0]!;
  }
  return sha256(stable(domains));
}

async function bridgeIntegrity(client: pg.Client) {
  const result = await client.query<{ bridge_count: number; invalid_digest_count: number }>(`
    WITH bridge AS (
      SELECT definition.id,definition.workspace_id,definition.membership_digest,
        'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
          membership.mention_id::text,',' ORDER BY membership.mention_id
        ) FILTER (WHERE membership.membership_status='included' AND membership.removed_at IS NULL),''),'UTF8')),'hex') AS expected
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition ON definition.id=pointer.population_id
        AND definition.workspace_id=pointer.workspace_id
      LEFT JOIN signal_population_memberships membership ON membership.population_id=definition.id
        AND membership.workspace_id=definition.workspace_id
      WHERE pointer.purpose='operational' AND definition.purpose='operational'
        AND COALESCE(definition.definition->>'contract_version','')<>'signal-operational-primary-brand-semantic-v2'
      GROUP BY definition.id,definition.workspace_id,definition.membership_digest
    ) SELECT count(*)::int AS bridge_count,
      count(*) FILTER (WHERE membership_digest IS DISTINCT FROM expected)::int AS invalid_digest_count
    FROM bridge
  `);
  return result.rows[0]!;
}

async function inspectActivity(client: pg.Client) {
  const result = await client.query<{ incompatible: number; writers: number; named_apps: number }>(`
    SELECT count(*) FILTER (WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND application_name<>$1)::int AS incompatible,
      count(*) FILTER (WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int AS writers,
      count(*) FILTER (WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND COALESCE(application_name,'')~*'(studio|worker|bullmq)')::int AS named_apps
    FROM pg_stat_activity WHERE datname=current_database()
  `,[appName]);
  const row = result.rows[0]!;
  if (row.incompatible || row.writers || row.named_apps) throw new Error("Incompatible staging activity detected.");
  return row;
}

async function inspectPeer(url: string) {
  const peer = new pg.Client({ connectionString: url,ssl: { rejectUnauthorized: false },application_name: `${appName}-peer` });
  await peer.connect();
  try { await configure(peer);return await inspectIdentity(peer); } finally { await peer.end(); }
}

function assertSameIdentity(left: Awaited<ReturnType<typeof inspectIdentity>>,right: Awaited<ReturnType<typeof inspectIdentity>>) {
  if (left.database_hash !== right.database_hash || left.state !== right.state
      || left.ledger_digest !== right.ledger_digest
      || left.protected_state_hash !== right.protected_state_hash) {
    throw new Error("Direct/pooler database state mismatch.");
  }
}

function deriveDirect(poolerUrl: string) {
  const parsed = new URL(poolerUrl);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!ref) throw new Error("Canonical connection is not the audited pooler shape.");
  parsed.hostname = `db.${ref}.supabase.co`;parsed.port = "5432";parsed.username = "postgres";
  return parsed.toString();
}
function fingerprint(value: string) { const parsed = new URL(value);return sha256([
  parsed.protocol,parsed.hostname.toLowerCase(),parsed.port || "5432",
  parsed.pathname.replace(/^\//u,""),parsed.username
].join("|")); }
function projectHash(value: string,kind: "direct"|"pooler") { const parsed = new URL(value);
  const ref = kind === "direct" ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  if (!ref) throw new Error("Project identity unavailable.");return sha256(ref); }
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>)
    .sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value); }
function emit(value: Record<string,unknown>) { console.log(JSON.stringify({
  contract_version: "signal-greenfield-product-migration-runner-v1",target: "noisia-staging",
  direct_fingerprint: expected.direct,pooler_fingerprint: expected.pooler,project_ref_hash: expected.project,
  restore_point: { reference_hash: restoreReferenceHash,at: restoreAt,age_hours: Number(restoreAgeHours.toFixed(1)) },
  migrations: [
    { ordinal: 77,filename: filenames[0],checksum: expected.migration77 },
    { ordinal: 78,filename: filenames[1],checksum: expected.migration78 }
  ],...value
},null,2)); }
