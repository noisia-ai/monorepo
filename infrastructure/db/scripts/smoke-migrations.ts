import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabaseSslConfig } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function requireLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const allowRemote = process.env.NOISIA_DB_SMOKE_ALLOW_REMOTE === "true";

  if (allowRemote || LOCAL_HOSTS.has(parsed.hostname)) {
    return;
  }

  throw new Error(
    [
      "Refusing to run migration smoke against a non-local database.",
      `Host: ${parsed.hostname}`,
      "Use a disposable local Postgres with pgvector, or set NOISIA_DB_SMOKE_ALLOW_REMOTE=true only for an isolated throwaway database."
    ].join(" ")
  );
}

async function assertEmptySchema(client: pg.Client) {
  const resetSchema = process.env.NOISIA_DB_SMOKE_RESET_SCHEMA === "true";
  const result = await client.query<{ count: string }>(`
    select count(*)::text
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  `);
  const tableCount = Number(result.rows[0]?.count ?? "0");

  if (tableCount === 0) {
    return;
  }

  if (!resetSchema) {
    throw new Error(
      `Migration smoke requires an empty public schema. Found ${tableCount} table(s). Set NOISIA_DB_SMOKE_RESET_SCHEMA=true only for a disposable local database.`
    );
  }

  await client.query(`drop schema public cascade; create schema public;`);
}

async function assertPgVectorAvailable(client: pg.Client) {
  const result = await client.query<{ name: string; default_version: string | null }>(`
    select name, default_version
    from pg_available_extensions
    where name = 'vector'
  `);

  if (result.rowCount === 0) {
    throw new Error(
      "pgvector is not available in this Postgres. Use a pgvector-enabled local image/database before running migration smoke."
    );
  }
}

async function applyMigration(client: pg.Client, migrationPath: string) {
  const sql = await readFile(migrationPath, "utf8");

  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function verifySchema(client: pg.Client) {
  const requiredTables = [
    "engine_analyses",
    "engine_findings",
    "engine_pipeline_steps",
    "engine_cost_events",
    "query_packs",
    "mention_query_sources",
    "canonical_signals",
    "signal_observations",
    "signal_observation_evidence"
  ];
  const requiredIndexes = [
    "idx_engine_analyses_corpus",
    "idx_engine_findings_analysis",
    "idx_engine_cost_events_analysis",
    "idx_query_packs_lens",
    "idx_mention_query_sources_corpus",
    "idx_canonical_signals_brand",
    "idx_signal_observations_corpus",
    "uq_signal_observation_signal_tb_analysis",
    "uq_signal_observation_signal_engine_analysis"
  ];

  const tables = await client.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [requiredTables]
  );
  const indexes = await client.query<{ indexname: string }>(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [requiredIndexes]
  );

  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const foundIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingTables = requiredTables.filter((table) => !foundTables.has(table));
  const missingIndexes = requiredIndexes.filter((index) => !foundIndexes.has(index));

  if (missingTables.length > 0 || missingIndexes.length > 0) {
    throw new Error(
      `Migration smoke verification failed: ${JSON.stringify({ missingTables, missingIndexes })}`
    );
  }

  return {
    requiredTables: requiredTables.length,
    requiredIndexes: requiredIndexes.length
  };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  requireLocalDatabase(databaseUrl);

  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationsDir = join(dbRoot, "migrations");
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    await client.query(`set statement_timeout = '5min'`);
    await assertPgVectorAvailable(client);
    await assertEmptySchema(client);

    for (const file of migrationFiles) {
      await applyMigration(client, join(migrationsDir, file));
      console.log(`applied ${file}`);
    }

    const schema = await verifySchema(client);
    console.log(
      JSON.stringify(
        {
          ok: true,
          migrationsApplied: migrationFiles.length,
          ...schema
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
