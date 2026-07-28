import pg from "pg";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getDatabaseSslConfig,
  requireSafeDatabaseWriteTarget
} from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const MIGRATION = "0057_signal_topics_narratives_profiles.sql";
const APPLY_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_SCHEMA_APPLY_APPROVED";
const ALLOW_REMOTE_ENV = "NOISIA_DB_APPLY_SIGNAL_TAXONOMY_ALLOW_REMOTE";

async function verifyMigration(client: pg.Client) {
  const result = await client.query<{
    profiles_table: string | null;
    profile_column: boolean;
    active_profile_index: boolean;
    assignment_index: boolean;
    activation_function: boolean;
  }>(`
    SELECT
      to_regclass('public.signal_taxonomy_profiles')::text AS profiles_table,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'record_tags'
          AND column_name = 'signal_taxonomy_profile_id'
      ) AS profile_column,
      to_regclass('public.uq_signal_taxonomy_profiles_active_kind') IS NOT NULL
        AS active_profile_index,
      to_regclass('public.uq_record_tags_signal_profile_assignment') IS NOT NULL
        AS assignment_index,
      to_regprocedure(
        'public.activate_signal_taxonomy_profile(uuid,uuid)'
      ) IS NOT NULL AS activation_function
  `);
  return result.rows[0];
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "apply Signal Topics & Narratives migration 0057",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  });
  if (process.env[APPLY_APPROVAL_ENV] !== "true") {
    throw new Error(`${APPLY_APPROVAL_ENV}=true is required.`);
  }

  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sql = await readFile(join(dbRoot, "migrations", MIGRATION), "utf8");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    await client.query(`SET statement_timeout = '10min'`);
    const before = await verifyMigration(client);
    let applied = false;
    if (!before?.profiles_table) {
      await client.query("BEGIN");
      try {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [MIGRATION]
        );
        await client.query(sql);
        await client.query("COMMIT");
        applied = true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const verified = await verifyMigration(client);
    if (
      !verified?.profiles_table
      || !verified.profile_column
      || !verified.active_profile_index
      || !verified.assignment_index
      || !verified.activation_function
    ) {
      throw new Error("Signal Topics & Narratives migration verification failed.");
    }
    console.log(JSON.stringify({
      ok: true,
      migration: MIGRATION,
      applied,
      target: process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "local",
      verified: {
        profiles_table: true,
        record_tags_profile_column: true,
        active_profile_index: true,
        assignment_index: true,
        activation_function: true
      }
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
