import pg from "pg";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const MIGRATIONS_TO_APPLY = [
  "0025_engine_methodologies.sql",
  "0026_live_intelligence_store.sql",
  "0027_query_pack_provenance_backfill.sql",
  "0028_signal_observation_run_uniqueness.sql",
  "0029_engine_cost_ledger.sql",
  "0030_monthly_cut_and_composer.sql",
  "0031_study_analysis_plan.sql",
  "0032_import_batch_query_pack_link.sql",
  "0033_engine_run_mention_map.sql"
];

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

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "apply existing DB migrations 0025-0033",
    allowRemoteEnv: "NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE"
  });

  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationsDir = join(dbRoot, "migrations");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    await client.query(`set statement_timeout = '10min'`);
    for (const migration of MIGRATIONS_TO_APPLY) {
      await applyMigration(client, join(migrationsDir, migration));
      console.log(`applied ${migration}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
