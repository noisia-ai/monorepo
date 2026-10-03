import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const expectedChecksum = "sha256:175e438e441d4c4cca9a8ad1880f05d7e2d5652fa45f53866979d71cf36aad0c";
const expectedFunctions = 12;
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");

if (!(["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u)) {
  throw new Error("The authority search-path runner is restricted to an explicit staging workspace.");
}
if (mode === "apply" && process.env.NOISIA_TOPIC_CATALOG_MIGRATION_APPROVED !== "true") {
  throw new Error("Apply requires the explicit UAT migration acknowledgement.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");
const migration = await readFile(resolve(import.meta.dirname,
  "../migrations/0130_signal_classification_authority_search_path_hardening.sql"), "utf8");
if (sha256(migration) !== expectedChecksum) throw new Error("0130 checksum mismatch.");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-uat-classification-authority-search-path-hardening"
});
await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect(client, workspaceId);
  if (before.state === "partial") throw new Error("0130 partial state is blocked.");
  if (mode === "preflight") emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0130 is not complete.");
    emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  } else if (before.state === "complete") {
    emit({ mode, action: "verified_existing", writes_performed: false,
      checksum: expectedChecksum, ...before });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["noisia:uat:0130:classification-authority-search-path"]);
      const locked = await inspect(client, workspaceId);
      if (locked.state !== "absent") throw new Error("0130 state changed after preflight.");
      await client.query(migration);
      const applied = await inspect(client, workspaceId);
      if (applied.state !== "complete") throw new Error("0130 sentinels did not complete.");
      await client.query("COMMIT");
      emit({ mode, action: "applied", writes_performed: true,
        checksum: expectedChecksum, ...applied });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.end();
}

async function inspect(client: pg.Client, workspace: string) {
  const row = (await client.query<{ workspace_exists: boolean; functions_found: number;
    functions_hardened: number }>(`
    WITH targets(name) AS(VALUES
      ('register_signal_labeling_function_v1'),
      ('register_signal_classification_approval_policy_v1'),
      ('register_signal_tagging_model_v1'),
      ('transition_signal_tagging_model_v1'),
      ('register_signal_classification_gold_set_v1'),
      ('record_signal_classification_evaluation_v1'),
      ('record_signal_classification_evaluation_slice_v1'),
      ('project_signal_classification_generation_v1'),
      ('begin_signal_classification_generation_v1'),
      ('append_signal_classification_result_v1'),
      ('append_signal_classification_result_batch_v1'),
      ('finalize_signal_classification_generation_v1')
    ), functions AS(
      SELECT procedure.proname,COALESCE(array_to_string(procedure.proconfig,','),'') configuration
      FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      JOIN targets ON targets.name=procedure.proname
      WHERE namespace.nspname='public' AND procedure.prosecdef=true
    )
    SELECT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=$1::uuid AND status='active') workspace_exists,
      count(*)::int functions_found,
      count(*) FILTER(WHERE configuration LIKE '%search_path=public, extensions, pg_temp%')::int
        functions_hardened
    FROM functions
  `, [workspace])).rows[0];
  if (!row?.workspace_exists || Number(row.functions_found) !== expectedFunctions) {
    throw new Error("The selected UAT workspace or classification authority functions are unavailable.");
  }
  const hardened = Number(row.functions_hardened);
  return { state: hardened === 0 ? "absent" : hardened === expectedFunctions ? "complete" : "partial",
    workspace_id: workspace, functions_found: Number(row.functions_found), functions_hardened: hardened };
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
