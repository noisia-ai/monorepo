import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import pg from "pg";

type MigrationOrdinal = 84 | 85 | 86 | 87;

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const requireFromStudio = createRequire(resolve(repositoryRoot, "apps/studio/package.json"));
const { parse } = requireFromStudio("dotenv") as typeof import("dotenv");
const mode = process.argv[2];
const expectedProtectedState = process.argv[3] ?? null;
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const local = target === "local"
  && process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_LOCAL_REHEARSAL === "true";
const restoreAt = process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_RESTORE_POINT_AT;
const restoreReferenceHash = process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_RESTORE_POINT_HASH;
const appName = "noisia-signal-schema-0084-0087";
const lockKey = "noisia:signal-schema-cutover:0084-0087";
const expected = {
  direct: "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project: "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32"
} as const;
const migrations = [
  {
    ordinal: 84 as const,
    filename: "0084_signal_acquisition_plan_control_plane.sql",
    checksum: "sha256:d959f17e1af5378d798bc1ca089bc6802bf6c3e8455a6054a98aeec3359fd26b"
  },
  {
    ordinal: 85 as const,
    filename: "0085_signal_workspace_query_composer.sql",
    checksum: "sha256:f36a32c1562147c0c94e7e00927d04902f4c4c3df446a5b28ea8ea3ff7b419d4"
  },
  {
    ordinal: 86 as const,
    filename: "0086_signal_acquisition_query_review.sql",
    checksum: "sha256:8fda9ce4e45c8464be9cad10ab2a2df0859a6e3d7d03a731d977a3d088dac2b1"
  },
  {
    ordinal: 87 as const,
    filename: "0087_signal_classification_authority.sql",
    checksum: "sha256:fd62b7dd637e62475dcce0eedbbdfc021906b2a1d72a742f74a28e5851ab48d3"
  }
] as const;
const prior83Checksum =
  "sha256:66049da1460b295ae00ec8b1b6d7ea9000d9b8894ef28c5cd15a20648c52e7cd";

if (!(mode === "preflight" || mode === "apply" || mode === "verify")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" && !local) {
  throw new Error("Only noisia-staging or an explicit local rehearsal is authorized.");
}
if (mode === "apply") {
  if (!local && (!restoreAt || !restoreReferenceHash?.match(/^sha256:[0-9a-f]{64}$/u))) {
    throw new Error("Apply requires a fresh verified restore point.");
  }
  const restoreAgeHours = local ? 0 : (Date.now() - Date.parse(restoreAt!)) / 3_600_000;
  if (!local && (!Number.isFinite(restoreAgeHours) || restoreAgeHours < 0 || restoreAgeHours > 24)) {
    throw new Error("The verified restore point must be less than 24 hours old.");
  }
  if (process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_APPROVED !== "true"
      || process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_NO_APPS_CONFIRMED !== "true") {
    throw new Error("Apply requires migration and zero-app acknowledgements.");
  }
}

const env = parse(await readFile(resolve(repositoryRoot, "apps/studio/.env.local"), "utf8"));
const poolerUrl = local
  ? process.env.NOISIA_SIGNAL_SCHEMA_CUTOVER_DATABASE_URL?.trim()
  : env.DATABASE_URL?.trim();
if (!poolerUrl || (!local && env.DATABASE_SSL !== "true")) {
  throw new Error("Canonical database configuration is unavailable.");
}
const directUrl = local ? poolerUrl : deriveDirect(poolerUrl);
if (!local && (
  fingerprint(poolerUrl) !== expected.pooler
  || fingerprint(directUrl) !== expected.direct
  || projectHash(poolerUrl, "pooler") !== expected.project
  || projectHash(directUrl, "direct") !== expected.project
)) throw new Error("Direct/pooler target identity mismatch.");

const migrationSql = await Promise.all(migrations.map(async (migration) => {
  const sql = await readFile(
    resolve(repositoryRoot, "infrastructure/db/migrations", migration.filename), "utf8"
  );
  if (sha256(sql) !== migration.checksum) {
    throw new Error(`${migration.ordinal} checksum mismatch.`);
  }
  return sql;
}));
const declaredSentinels = extractDeclaredSentinels(migrationSql);

const direct = new pg.Client({
  connectionString: directUrl,
  ssl: local ? false : { rejectUnauthorized: false },
  application_name: appName
});
await direct.connect();
try {
  await configure(direct);
  const before = await inspect(direct);
  const peerBefore = local ? before : await inspectPeer(poolerUrl);
  assertSameIdentity(before, peerBefore);
  const activity = await inspectActivity(direct, false);
  if (before.sequence_state === "partial") {
    throw new Error("0084-0087 partial state is blocked.");
  }

  if (mode === "preflight") {
    emit({ mode, writes_performed: false, before, activity });
  } else if (mode === "verify") {
    if (before.sequence_state !== "complete") {
      throw new Error("0084-0087 are not complete.");
    }
    assertDeclaredSentinels(before.declared_sentinels);
    assertNewAuthorityTablesEmpty(before.new_authority_rows);
    emit({ mode, writes_performed: false, before, activity });
  } else if (before.sequence_state === "complete") {
    assertDeclaredSentinels(before.declared_sentinels);
    assertNewAuthorityTablesEmpty(before.new_authority_rows);
    emit({
      mode,
      action: "verified_existing",
      writes_performed: false,
      before,
      activity
    });
  } else {
    if (expectedProtectedState !== before.protected_state_hash) {
      throw new Error("Protected-state compare-and-swap failed.");
    }
    assertAmazonAlexaAbsent(before.amazon_alexa_absence);
    assertNoRunnableWork(before.runnable_work);
    await inspectActivity(direct, true);
    await direct.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lockKey]);
    try {
      for (const [index, migration] of migrations.entries()) {
        await applyOneMigration(direct, migration, migrationSql[index]!, expectedProtectedState);
      }
    } finally {
      await direct.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockKey]);
    }
    const after = await inspect(direct);
    const peerAfter = local ? after : await inspectPeer(poolerUrl);
    assertSameIdentity(after, peerAfter);
    if (after.sequence_state !== "complete"
        || after.protected_state_hash !== before.protected_state_hash) {
      throw new Error("0084-0087 post-apply verification failed.");
    }
    assertDeclaredSentinels(after.declared_sentinels);
    assertAmazonAlexaAbsent(after.amazon_alexa_absence);
    assertNoRunnableWork(after.runnable_work);
    assertNewAuthorityTablesEmpty(after.new_authority_rows);
    emit({
      mode,
      action: "applied",
      writes_performed: true,
      before,
      after,
      activity
    });
  }
} finally {
  await direct.end();
}

async function applyOneMigration(
  client: pg.Client,
  migration: (typeof migrations)[number],
  sql: string,
  protectedCas: string
) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SET LOCAL statement_timeout='10min'");
    await client.query("SET LOCAL lock_timeout='30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${lockKey}:${migration.ordinal}`
    ]);
    const locked = await inspect(client);
    if (locked.protected_state_hash !== protectedCas) {
      throw new Error(`Protected state drifted before ${migration.ordinal}.`);
    }
    const target = locked.migrations.find((item) => item.ordinal === migration.ordinal);
    const prior = migration.ordinal === 84
      ? locked.prerequisite_0083_valid
      : locked.migrations.find((item) => item.ordinal === migration.ordinal - 1)?.state === "complete";
    if (!prior || target?.state !== "absent") {
      throw new Error(`Locked ${migration.ordinal} precondition is invalid.`);
    }
    assertAmazonAlexaAbsent(locked.amazon_alexa_absence);
    assertNoRunnableWork(locked.runnable_work);
    await client.query(sql);
    const objectCheck = await inspectMigrationObjectState(client, migration.ordinal);
    if (objectCheck.present !== objectCheck.expected) {
      throw new Error(`${migration.ordinal} sentinels failed before ledger registration.`);
    }
    if (await protectedState(client) !== protectedCas) {
      throw new Error(`${migration.ordinal} changed protected logical state.`);
    }
    await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
      migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
    ) VALUES($1,$2,$3,'applied','signal-schema-0084-0087-v1',$4)`, [
      migration.filename,
      migration.ordinal,
      migration.checksum,
      local ? fingerprint(directUrl) : expected.direct
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  const completed = await inspectMigrationState(client, migration.ordinal);
  if (completed.state !== "complete") {
    throw new Error(`${migration.ordinal} did not become complete after commit.`);
  }
}

async function configure(client: pg.Client) {
  await client.query("SET statement_timeout='10min'");
  await client.query("SET lock_timeout='30s'");
  await client.query("SET idle_in_transaction_session_timeout='15min'");
}

async function inspect(client: pg.Client) {
  const database = await client.query<{ value: string }>("SELECT current_database() AS value");
  const ledger = await inspectLedger(client);
  const migrationStates: Array<Awaited<ReturnType<typeof inspectMigrationState>>> = [];
  for (const migration of migrations) {
    migrationStates.push(await inspectMigrationState(client, migration.ordinal));
  }
  const completed = migrationStates.filter((item) => item.state === "complete").length;
  const absent = migrationStates.filter((item) => item.state === "absent").length;
  const orderedPrefix = migrationStates.every((item, index) => (
    item.state === "complete" || migrationStates.slice(0, index).every((prior) => prior.state === "complete")
  ));
  const sequenceState = completed === migrations.length
    ? "complete"
    : absent === migrations.length
      ? "absent"
      : orderedPrefix && migrationStates.every((item) => item.state !== "partial")
        ? "partial"
        : "partial";
  const protectedDomainState = await protectedDomains(client);
  return {
    database_hash: sha256(database.rows[0]!.value),
    sequence_state: sequenceState,
    prerequisite_0083_valid: ledger.prerequisite_0083_valid,
    prerequisite_ledger_count: ledger.prerequisite_count,
    ledger_digest: ledger.digest,
    migrations: migrationStates,
    declared_sentinels: await inspectDeclaredSentinels(client),
    protected_state_hash: sha256(stable(protectedDomainState)),
    protected_counts: Object.fromEntries(
      Object.entries(protectedDomainState).map(([key, value]) => [key, value.row_count])
    ),
    amazon_alexa_absence: await inspectAmazonAlexaAbsence(client),
    runnable_work: await inspectRunnableWork(client),
    new_authority_rows: await inspectNewAuthorityRows(client),
    canonical_backfills: await inspectCanonicalBackfills(client)
  };
}

async function inspectLedger(client: pg.Client) {
  const result = await client.query<{
    ordinal: number;
    migration_name: string;
    checksum_sha256: string;
    disposition: string;
  }>(`SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal BETWEEN 59 AND 87 ORDER BY ordinal`);
  const prior = result.rows.filter((row) => row.ordinal <= 83);
  const ordinals = new Set(prior.map((row) => row.ordinal));
  const prerequisite = prior.find((row) => row.ordinal === 83);
  const prerequisiteValid = prior.length === 25
    && Array.from({ length: 25 }, (_, index) => 59 + index).every((ordinal) => ordinals.has(ordinal))
    && prerequisite?.migration_name === "0083_signal_semantic_review_projection_indexes.sql"
    && prerequisite.checksum_sha256 === prior83Checksum
    && prerequisite.disposition === "applied";
  if (!prerequisiteValid) throw new Error("0059-0083 migration ledger prerequisite is invalid.");
  return {
    prerequisite_0083_valid: prerequisiteValid,
    prerequisite_count: prior.length,
    digest: sha256(stable(result.rows))
  };
}

async function inspectMigrationState(client: pg.Client, ordinal: MigrationOrdinal) {
  const objectState = await inspectMigrationObjectState(client, ordinal);
  const migration = migrations.find((item) => item.ordinal === ordinal)!;
  const ledger = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal=$1 AND migration_name=$2 AND checksum_sha256=$3 AND disposition='applied'
  `, [ordinal, migration.filename, migration.checksum]);
  const ledgerCount = ledger.rows[0]!.count;
  const state = objectState.present === 0 && ledgerCount === 0
    ? "absent"
    : objectState.present === objectState.expected && ledgerCount === 1
      ? "complete"
      : "partial";
  return { ordinal, state, ledger_count: ledgerCount, ...objectState };
}

async function inspectMigrationObjectState(client: pg.Client, ordinal: MigrationOrdinal) {
  const queries: Record<MigrationOrdinal, string[]> = {
    84: [
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='competitors' AND column_name='status')`,
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='data_sources' AND column_name='source_key')`,
      `to_regclass('signal_acquisition_plans') IS NOT NULL`,
      `to_regclass('signal_acquisition_slots') IS NOT NULL`,
      `to_regclass('signal_acquisition_query_versions') IS NOT NULL`,
      `to_regclass('signal_provider_mention_observations') IS NOT NULL`,
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='acquisition_contract_version')`
    ],
    85: [
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='signal_acquisition_plans' AND column_name='acquisition_brief_contract_version')`,
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='signal_acquisition_query_versions' AND column_name='generation_contract_version')`,
      `to_regprocedure('signal_acquisition_brief_is_valid_v1(jsonb)') IS NOT NULL`,
      `EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='validate_signal_acquisition_query_operation_v1' AND NOT tgisinternal)`,
      `EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_acquisition_query_versions_origin_kind_check' AND pg_get_constraintdef(oid) LIKE '%engine-generated%')`
    ],
    86: [
      `to_regclass('signal_acquisition_query_review_events') IS NOT NULL`,
      `to_regprocedure('validate_signal_acquisition_query_review_event_v1()') IS NOT NULL`,
      `EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='validate_signal_acquisition_query_review_event_v1' AND NOT tgisinternal)`,
      `EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='enforce_signal_acquisition_query_review_append_only_v1' AND NOT tgisinternal)`
    ],
    87: [
      `to_regclass('signal_classification_generations') IS NOT NULL`,
      `to_regclass('signal_classification_assignments') IS NOT NULL`,
      `to_regclass('signal_labeling_function_versions') IS NOT NULL`,
      `to_regclass('signal_classification_approval_policies') IS NOT NULL`,
      `to_regclass('signal_classification_gold_set_versions') IS NOT NULL`,
      `to_regclass('signal_classification_projection_runs') IS NOT NULL`,
      `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='record_tags' AND column_name='classification_assignment_id')`,
      `EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='enforce_signal_taxonomy_enrichment_retired_10b_v1' AND NOT tgisinternal)`,
      `EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_mention_attribution_no_provider_autoapproval')`
    ]
  };
  const expressions = queries[ordinal];
  const result = await client.query<{ present: number }>(`
    SELECT (${expressions.map((expression) => `(${expression})::int`).join("+")})::int AS present
  `);
  return { present: result.rows[0]!.present, expected: expressions.length };
}

async function inspectDeclaredSentinels(client: pg.Client) {
  const relations = await inspectNames(client, "pg_class", "relname", declaredSentinels.relations);
  const functions = await inspectNames(client, "pg_proc", "proname", declaredSentinels.functions);
  const triggers = await inspectNames(
    client, "pg_trigger", "tgname", declaredSentinels.triggers, "NOT tgisinternal"
  );
  const constraints = await inspectNames(
    client, "pg_constraint", "conname", declaredSentinels.constraints
  );
  const columns = await client.query<{ present: number; missing: string[] }>(`
    SELECT count(*) FILTER(WHERE column_value.column_name IS NOT NULL)::int AS present,
      COALESCE(array_agg(expected.table_name||'.'||expected.column_name ORDER BY 1)
        FILTER(WHERE column_value.column_name IS NULL),ARRAY[]::text[]) AS missing
    FROM unnest($1::text[],$2::text[]) expected(table_name,column_name)
    LEFT JOIN information_schema.columns column_value
      ON column_value.table_schema='public' AND column_value.table_name=expected.table_name
        AND column_value.column_name=expected.column_name
  `, [declaredSentinels.columns.map((item) => item.table), declaredSentinels.columns.map((item) => item.column)]);
  const present = relations.present + functions.present + triggers.present + constraints.present
    + columns.rows[0]!.present;
  const expectedCount = declaredSentinels.relations.length + declaredSentinels.functions.length
    + declaredSentinels.triggers.length + declaredSentinels.constraints.length
    + declaredSentinels.columns.length;
  return {
    present,
    expected: expectedCount,
    missing: {
      relations: relations.missing,
      functions: functions.missing,
      triggers: triggers.missing,
      constraints: constraints.missing,
      columns: columns.rows[0]!.missing
    }
  };
}

async function inspectNames(
  client: pg.Client,
  table: "pg_class" | "pg_proc" | "pg_trigger" | "pg_constraint",
  column: "relname" | "proname" | "tgname" | "conname",
  values: string[],
  extra = "true"
) {
  if (values.length === 0) return { present: 0, missing: [] as string[] };
  const result = await client.query<{ present: number; missing: string[] }>(`
    SELECT count(*) FILTER(WHERE catalog.name IS NOT NULL)::int AS present,
      COALESCE(array_agg(expected.name ORDER BY expected.name)
        FILTER(WHERE catalog.name IS NULL),ARRAY[]::text[]) AS missing
    FROM unnest($1::text[]) expected(name)
    LEFT JOIN LATERAL(SELECT catalog.${column} AS name FROM ${table} catalog
      WHERE catalog.${column}=expected.name AND ${extra} LIMIT 1) catalog ON true
  `, [values]);
  return result.rows[0]!;
}

async function protectedState(client: pg.Client) {
  return sha256(stable(await protectedDomains(client)));
}

async function protectedDomains(client: pg.Client) {
  const domains = [
    ["organizations", `SELECT to_jsonb(row_value) AS value FROM organizations row_value`],
    ["brands", `SELECT to_jsonb(row_value) AS value FROM brands row_value`],
    ["workspaces", `SELECT to_jsonb(row_value) AS value FROM signal_workspaces row_value`],
    ["competitors", `SELECT to_jsonb(row_value)-ARRAY['status','effective_from','effective_to','updated_at','retired_by_user_id'] AS value FROM competitors row_value`],
    ["sources", `SELECT to_jsonb(row_value)-ARRAY['source_contract_version','source_key'] AS value FROM data_sources row_value`],
    ["imports", `SELECT to_jsonb(row_value)-ARRAY[
      'acquisition_contract_version','acquisition_plan_id','acquisition_slot_id',
      'acquisition_query_version_id','capture_period_start','capture_period_end',
      'capture_timezone','acquisition_plan_digest','acquisition_slot_digest',
      'acquisition_query_digest','acquisition_brand_os_digest',
      'acquisition_identity_catalog_digest','provider_schema_version',
      'provider_observation_projection_state','provider_observation_header_hash',
      'provider_observation_count','acquisition_sealed_at'] AS value FROM import_batches row_value`],
    ["mentions", `SELECT to_jsonb(row_value)-ARRAY[
      'text_raw','text_clean','text_snippet','title','url','raw_metadata','engagement'] AS value
      FROM mentions row_value`],
    ["import_memberships", `SELECT to_jsonb(row_value) AS value FROM signal_mention_import_memberships row_value`],
    ["semantic_assertions", `SELECT to_jsonb(row_value) AS value FROM signal_mention_attributions row_value`],
    ["semantic_reviews", `SELECT to_jsonb(row_value) AS value FROM signal_mention_attribution_review_events row_value`],
    ["population_definitions", `SELECT to_jsonb(row_value) AS value FROM signal_population_definitions row_value`],
    ["population_memberships", `SELECT to_jsonb(row_value) AS value FROM signal_population_memberships row_value`],
    ["population_pointers", `SELECT to_jsonb(row_value) AS value FROM signal_workspace_population_pointers row_value`],
    ["governed_bindings", `SELECT to_jsonb(row_value) AS value FROM signal_governed_view_bindings row_value`],
    ["governed_binding_events", `SELECT to_jsonb(row_value) AS value FROM signal_governed_view_binding_events row_value`],
    ["quality_policies", `SELECT to_jsonb(row_value) AS value FROM signal_quality_policies row_value`],
    ["retention_policies", `SELECT to_jsonb(row_value) AS value FROM signal_retention_policies row_value`],
    ["licensing_policies", `SELECT to_jsonb(row_value) AS value FROM signal_licensing_policies row_value`],
    ["provenance_bindings", `SELECT to_jsonb(row_value) AS value FROM signal_provenance_policy_bindings row_value`],
    ["record_tags", `SELECT to_jsonb(row_value)-ARRAY['classification_assignment_id','classification_generation_id','classification_projection_contract'] AS value FROM record_tags row_value`],
    ["tagging_models", `SELECT to_jsonb(row_value)-ARRAY[
      'registry_contract_version','artifact_digest','runtime_kind','artifact_format',
      'configuration','configuration_digest','dataset_digest','gold_set_digest',
      'license_key','provenance_digest','taxonomy_profile_id',
      'supersedes_model_version_id','registry_operation_id','registered_by_user_id'] AS value
      FROM tagging_model_versions row_value`],
    ["strategic_runs", `SELECT to_jsonb(row_value) AS value FROM signal_strategic_run_controls row_value`],
    ["strategic_run_outbox", `SELECT to_jsonb(row_value) AS value FROM signal_strategic_run_outbox row_value`],
    ["strategic_step_outbox", `SELECT to_jsonb(row_value) AS value FROM signal_strategic_step_outbox row_value`],
    ["semantic_resolution_runs", `SELECT to_jsonb(row_value) AS value FROM signal_semantic_resolution_runs row_value`],
    ["semantic_resolution_children", `SELECT to_jsonb(row_value) AS value FROM signal_semantic_resolution_child_batches row_value`],
    ["semantic_resolution_outbox", `SELECT to_jsonb(row_value) AS value FROM signal_semantic_resolution_child_outbox row_value`],
    ["import_outbox", `SELECT to_jsonb(row_value) AS value FROM signal_workspace_import_outbox row_value`],
    ["workspace_releases", `SELECT to_jsonb(row_value) AS value FROM signal_workspace_releases row_value`],
    ["current_releases", `SELECT to_jsonb(row_value) AS value FROM signal_workspace_current_releases row_value`]
  ] as const;
  const result: Record<string, { row_count: number; digest: string }> = {};
  for (const [name, projection] of domains) {
    const domain = await client.query<{ row_count: number; digest: string }>(`
      SELECT count(*)::int AS row_count,
        'sha256:'||encode(sha256(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),'')::bytea),'hex') AS digest
      FROM (SELECT sha256(convert_to(value::text,'UTF8')) AS row_hash FROM (${projection}) rows) hashed
    `);
    result[name] = domain.rows[0]!;
  }
  return result;
}

async function inspectAmazonAlexaAbsence(client: pg.Client) {
  const result = await client.query<{
    organizations: number;
    brands: number;
    workspaces: number;
    competitors: number;
    brand_os_profiles: number;
    brand_seeds: number;
  }>(`
    WITH matching_organizations AS (
      SELECT id FROM organizations WHERE lower(btrim(COALESCE(slug,'')))='amazon-alexa'
        OR lower(btrim(display_name))='amazon alexa' OR lower(btrim(legal_name))='amazon alexa'
    ), matching_brands AS (
      SELECT id FROM brands WHERE lower(btrim(slug))='amazon-alexa'
        OR lower(btrim(name))='amazon alexa' OR lower(btrim(COALESCE(display_name,'')))='amazon alexa'
        OR organization_id IN(SELECT id FROM matching_organizations)
    ) SELECT
      (SELECT count(*)::int FROM matching_organizations) AS organizations,
      (SELECT count(*)::int FROM matching_brands) AS brands,
      (SELECT count(*)::int FROM signal_workspaces WHERE brand_id IN(SELECT id FROM matching_brands)
        OR organization_id IN(SELECT id FROM matching_organizations)) AS workspaces,
      (SELECT count(*)::int FROM competitors WHERE brand_id IN(SELECT id FROM matching_brands)) AS competitors,
      (SELECT count(*)::int FROM brand_os_profiles WHERE brand_id IN(SELECT id FROM matching_brands)
        OR organization_id IN(SELECT id FROM matching_organizations)) AS brand_os_profiles,
      (SELECT count(*)::int FROM brand_seeds WHERE lower(btrim(canonical_name))='amazon alexa') AS brand_seeds
  `);
  return result.rows[0]!;
}

async function inspectRunnableWork(client: pg.Client) {
  const result = await client.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM signal_semantic_resolution_runs
      WHERE status IN('queued','running')) AS semantic_resolution_runs,
    (SELECT count(*)::int FROM signal_semantic_resolution_child_batches
      WHERE status IN('queued','dispatching','provider','applying','canceling')) AS semantic_resolution_children,
    (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox
      WHERE status IN('pending','failed','dispatching','dispatched')) AS semantic_resolution_outbox,
    (SELECT count(*)::int FROM signal_strategic_run_controls
      WHERE status IN('queued','running')) AS strategic_runs,
    (SELECT count(*)::int FROM signal_strategic_run_outbox
      WHERE status IN('pending','failed','dispatching','dispatched')) AS strategic_run_outbox,
    (SELECT count(*)::int FROM signal_strategic_step_outbox
      WHERE status IN('pending','failed','dispatching','dispatched','running')) AS strategic_step_outbox,
    (SELECT count(*)::int FROM signal_workspace_import_outbox outbox
      JOIN import_batches batch ON batch.id=outbox.import_batch_id
      WHERE batch.status='queued' AND (
        outbox.status IN('pending','failed') AND outbox.available_at<=now()
        OR outbox.status='dispatching' AND outbox.lease_expires_at<now()
      )) AS import_outbox,
    (SELECT count(*)::int FROM signal_refresh_runs
      WHERE status IN('queued','running')) AS refresh_runs
  `);
  return result.rows[0]!;
}

async function inspectNewAuthorityRows(client: pg.Client) {
  const tables = [
    "signal_competitor_lifecycle_events",
    "signal_acquisition_plans",
    "signal_acquisition_reference_decisions",
    "signal_acquisition_slots",
    "signal_acquisition_query_versions",
    "signal_acquisition_plan_events",
    "signal_provider_mention_observations",
    "signal_provider_mention_observation_terms",
    "signal_acquisition_query_review_events",
    "signal_classification_operations",
    "signal_classification_events",
    "signal_labeling_function_versions",
    "signal_classification_approval_policies",
    "signal_tagging_model_version_events",
    "signal_classification_generations",
    "signal_classification_generation_items",
    "signal_classification_assignments",
    "signal_classification_gold_set_versions",
    "signal_classification_gold_items",
    "signal_classification_evaluations",
    "signal_classification_evaluation_slices",
    "signal_classification_projection_runs"
  ];
  const counts: Record<string, number | null> = {};
  for (const table of tables) {
    const exists = await client.query<{ value: boolean }>("SELECT to_regclass($1) IS NOT NULL AS value", [table]);
    if (!exists.rows[0]!.value) {
      counts[table] = null;
      continue;
    }
    const count = await client.query<{ value: number }>(`SELECT count(*)::int AS value FROM ${table}`);
    counts[table] = count.rows[0]!.value;
  }
  return counts;
}

async function inspectCanonicalBackfills(client: pg.Client) {
  const has84 = await client.query<{ value: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='competitors' AND column_name='status') AS value
  `);
  if (!has84.rows[0]!.value) return { available: false };
  const result = await client.query<{
    source_rows: number;
    invalid_source_rows: number;
    competitor_rows: number;
    invalid_competitor_rows: number;
  }>(`SELECT
    (SELECT count(*)::int FROM data_sources) AS source_rows,
    (SELECT count(*)::int FROM data_sources WHERE source_contract_version IS NULL
      OR source_key !~ '^source-sha256-[0-9a-f]{64}$') AS invalid_source_rows,
    (SELECT count(*)::int FROM competitors) AS competitor_rows,
    (SELECT count(*)::int FROM competitors WHERE status<>'current' OR effective_from IS NULL
      OR updated_at IS NULL OR effective_to IS NOT NULL OR retired_by_user_id IS NOT NULL) AS invalid_competitor_rows
  `);
  return { available: true, ...result.rows[0]! };
}

async function inspectActivity(client: pg.Client, enforce: boolean) {
  const result = await client.query<{
    incompatible: number;
    writers: number;
    named_apps: number;
  }>(`SELECT
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle' AND application_name<>$1)::int AS incompatible,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle'
      AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int AS writers,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND COALESCE(application_name,'')~*'(studio|worker|bullmq|next)')::int AS named_apps
    FROM pg_stat_activity WHERE datname=current_database()`, [appName]);
  const row = result.rows[0]!;
  if (enforce && (row.incompatible || row.writers || row.named_apps)) {
    throw new Error("Incompatible staging activity detected.");
  }
  return row;
}

async function inspectPeer(url: string) {
  const peer = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    application_name: `${appName}-peer`
  });
  await peer.connect();
  try {
    await configure(peer);
    return await inspect(peer);
  } finally {
    await peer.end();
  }
}

function assertSameIdentity(
  left: Awaited<ReturnType<typeof inspect>>,
  right: Awaited<ReturnType<typeof inspect>>
) {
  if (left.database_hash !== right.database_hash
      || left.sequence_state !== right.sequence_state
      || left.ledger_digest !== right.ledger_digest
      || left.protected_state_hash !== right.protected_state_hash) {
    throw new Error("Direct/pooler database state mismatch.");
  }
}

function assertAmazonAlexaAbsent(counts: Record<string, number>) {
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error("A partial Amazon Alexa brand or intake artifact exists.");
  }
}

function assertNoRunnableWork(counts: Record<string, number>) {
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error("Runnable DB work exists; cutover and worker restart are blocked.");
  }
}

function assertNewAuthorityTablesEmpty(counts: Record<string, number | null>) {
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error("New authority tables are not data-neutral after cutover.");
  }
}

function assertDeclaredSentinels(value: { present: number; expected: number }) {
  if (value.present !== value.expected) {
    throw new Error("One or more declared migration sentinels are missing.");
  }
}

function extractDeclaredSentinels(sqlValues: string[]) {
  const sql = sqlValues.join("\n");
  const names = (pattern: RegExp) => unique(Array.from(sql.matchAll(pattern), (match) => match[1]!.toLowerCase()));
  const relations = unique([
    ...names(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/giu),
    ...names(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/giu)
  ]);
  const functions = names(/CREATE OR REPLACE FUNCTION\s+([a-z_][a-z0-9_]*)/giu);
  const triggers = names(/CREATE (?:CONSTRAINT )?TRIGGER\s+([a-z_][a-z0-9_]*)/giu);
  const constraints = names(/(?:ADD\s+)?CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?/giu)
    .filter((name) => !["if", "trigger", "where"].includes(name));
  const columns: Array<{ table: string; column: string }> = [];
  for (const statement of sql.matchAll(/ALTER TABLE\s+([a-z_][a-z0-9_]*)\s+([\s\S]*?);/giu)) {
    for (const column of statement[2]!.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/giu)) {
      columns.push({ table: statement[1]!.toLowerCase(), column: column[1]!.toLowerCase() });
    }
  }
  return {
    relations,
    functions,
    triggers,
    constraints,
    columns: unique(columns.map((item) => `${item.table}.${item.column}`)).map((value) => {
      const [table, column] = value.split(".");
      return { table: table!, column: column! };
    })
  };
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function deriveDirect(poolerUrl: string) {
  const parsed = new URL(poolerUrl);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(
    decodeURIComponent(parsed.username).toLowerCase()
  )?.[1];
  if (!ref) throw new Error("Canonical connection is not the audited pooler shape.");
  parsed.hostname = `db.${ref}.supabase.co`;
  parsed.port = "5432";
  parsed.username = "postgres";
  return parsed.toString();
}

function fingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
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

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function emit(value: Record<string, unknown>) {
  const restoreAgeHours = restoreAt ? (Date.now() - Date.parse(restoreAt)) / 3_600_000 : null;
  process.stdout.write(`${JSON.stringify({
    contract_version: "signal-schema-0084-0087-migration-runner-v1",
    target: local ? "local-rehearsal" : "noisia-staging",
    direct_fingerprint: local ? fingerprint(directUrl) : expected.direct,
    pooler_fingerprint: local ? fingerprint(poolerUrl!) : expected.pooler,
    project_ref_hash: local ? null : expected.project,
    restore_point: restoreAt && restoreReferenceHash ? {
      reference_hash: restoreReferenceHash,
      at: restoreAt,
      age_hours: Number(restoreAgeHours!.toFixed(2))
    } : null,
    migrations,
    declared_sentinel_expected: declaredSentinels.relations.length
      + declaredSentinels.functions.length + declaredSentinels.triggers.length
      + declaredSentinels.constraints.length + declaredSentinels.columns.length,
    ...value
  }, null, 2)}\n`);
}
