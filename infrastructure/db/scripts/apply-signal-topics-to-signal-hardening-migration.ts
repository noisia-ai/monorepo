import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const expectedChecksum = "sha256:797b0279fb79d9bb86f91aea427cefd401ace2b3f878be52b5f816235d5bbcf0";
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");

if (!( ["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u)) {
  throw new Error("The Topics hardening runner is restricted to an explicit staging workspace.");
}
if (mode === "apply" && process.env.NOISIA_TOPIC_CATALOG_MIGRATION_APPROVED !== "true") {
  throw new Error("Apply requires the explicit UAT migration acknowledgement.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");
const migration = await readFile(resolve(import.meta.dirname,
  "../migrations/0128_signal_topics_to_signal_hardening.sql"), "utf8");
if (sha256(migration) !== expectedChecksum) throw new Error("0128 checksum mismatch.");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-topics-to-signal-uat-hardening"
});
await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect(client, workspaceId);
  if (!before.base_0127_ready) throw new Error("0128 requires the complete 0127 Topics cut.");
  if (before.state === "partial") throw new Error("0128 partial state is blocked.");
  if (mode === "preflight") emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0128 is not complete.");
    emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  } else if (before.state === "complete") {
    emit({ mode, action: "verified_existing", writes_performed: false, checksum: expectedChecksum, ...before });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["noisia:uat:0128:topics-to-signal-hardening"]);
      const locked = await inspect(client, workspaceId);
      if (locked.state !== "absent") throw new Error("0128 state changed after preflight.");
      await client.query(migration);
      const applied = await inspect(client, workspaceId);
      if (applied.state !== "complete") throw new Error("0128 sentinels did not complete.");
      await client.query("COMMIT");
      emit({ mode, action: "applied", writes_performed: true, checksum: expectedChecksum, ...applied });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.end();
}

async function inspect(client: pg.Client, workspace: string) {
  const row = (await client.query<{
    workspace_exists: boolean; base_0127_ready: boolean; sentinels: number;
  }>(`
    SELECT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=$1::uuid AND status='active') workspace_exists,
      to_regclass('public.signal_topic_catalog_executions') IS NOT NULL
        AND to_regclass('public.signal_topic_classification_suggestions') IS NOT NULL
        AND to_regprocedure('complete_signal_topic_catalog_profile_v1(uuid)') IS NOT NULL base_0127_ready,
      CASE WHEN to_regclass('public.signal_topic_embedding_calls') IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN to_regclass('public.signal_topic_classification_outbox') IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_classification_suggestions'
          AND column_name='negative_semantic_score') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_classification_suggestions'
          AND column_name='excluded_by_negative') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_catalog_executions'
          AND column_name='embedding_cost_estimate_micro_usd') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_catalog_executions'
          AND column_name='embedding_cost_cap_micro_usd') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_catalog_executions'
          AND column_name='embedding_pricing_version') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_catalog_operations'
          AND column_name='result_summary') THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_embedding_calls'
          AND column_name='input_digests') THEN 1 ELSE 0 END
      + CASE WHEN to_regprocedure('signal_topic_membership_override_digest_v1(uuid,uuid)') IS NOT NULL
          THEN 1 ELSE 0 END
      + CASE WHEN COALESCE(pg_get_functiondef(
          to_regprocedure('complete_signal_topic_catalog_profile_v1(uuid,text,text,text,integer)')),'')
          LIKE '%target_current_population_digest IS DISTINCT FROM execution.population_digest%'
          THEN 1 ELSE 0 END sentinels
  `, [workspace])).rows[0];
  if (!row?.workspace_exists) throw new Error("The selected UAT workspace is not active.");
  return { state: row.sentinels === 0 ? "absent" : row.sentinels === 11 ? "complete" : "partial",
    base_0127_ready: row.base_0127_ready, sentinels: Number(row.sentinels), workspace_id: workspace };
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
