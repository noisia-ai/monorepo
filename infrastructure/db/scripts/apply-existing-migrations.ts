import pg from "pg";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const MIGRATIONS_TO_APPLY = [
  "0035_data_os_foundation.sql",
  "0036_data_os_observations.sql",
  "0037_engine_validation_separation.sql",
  "0038_query_validation_lineage.sql",
  "0039_query_validation_imported_evidence.sql",
  "0040_data_os_semantic_observation_contract.sql",
  "0041_tb_data_os_coding_bridge.sql",
  "0042_data_os_static_catalog_semantics.sql",
  "0043_data_os_asset_records_metric_catalog.sql",
  "0044_query_pack_entity_identity.sql",
  "0045_signal_serving_entities.sql"
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
    operation: "apply Data OS DB migrations 0035-0045",
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
