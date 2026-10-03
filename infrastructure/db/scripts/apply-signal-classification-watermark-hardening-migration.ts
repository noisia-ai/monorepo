import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const expectedChecksum = "sha256:069c6be8e9a8df1f1885e22b3ae6b2f86c2705f0fed600f800608117fa0ac448";
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");

if (!(["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u)) {
  throw new Error("The watermark hardening runner is restricted to an explicit staging workspace.");
}
if (mode === "apply" && process.env.NOISIA_TOPIC_CATALOG_MIGRATION_APPROVED !== "true") {
  throw new Error("Apply requires the explicit UAT migration acknowledgement.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");
const migration = await readFile(resolve(import.meta.dirname,
  "../migrations/0129_signal_classification_watermark_digest_hardening.sql"), "utf8");
if (sha256(migration) !== expectedChecksum) throw new Error("0129 checksum mismatch.");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-uat-watermark-digest-hardening"
});
await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect(client, workspaceId);
  if (mode === "preflight") emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0129 is not complete.");
    await verifyRestrictedCall(client, workspaceId);
    emit({ mode, writes_performed: false, restricted_call_ready: true,
      checksum: expectedChecksum, ...before });
  } else if (before.state === "complete") {
    await verifyRestrictedCall(client, workspaceId);
    emit({ mode, action: "verified_existing", writes_performed: false,
      restricted_call_ready: true, checksum: expectedChecksum, ...before });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["noisia:uat:0129:watermark-digest-hardening"]);
      const locked = await inspect(client, workspaceId);
      if (locked.state !== "absent") throw new Error("0129 state changed after preflight.");
      await client.query(migration);
      const applied = await inspect(client, workspaceId);
      if (applied.state !== "complete") throw new Error("0129 sentinel did not complete.");
      await client.query("COMMIT");
      await verifyRestrictedCall(client, workspaceId);
      emit({ mode, action: "applied", writes_performed: true, restricted_call_ready: true,
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
  const row = (await client.query<{
    workspace_exists: boolean; function_exists: boolean; qualified_digest: boolean;
  }>(`
    SELECT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=$1::uuid AND status='active') workspace_exists,
      to_regprocedure('public.signal_classification_watermark_digest_v1(uuid,uuid)') IS NOT NULL function_exists,
      COALESCE(pg_get_functiondef(
        to_regprocedure('public.signal_classification_watermark_digest_v1(uuid,uuid)')),'')
        LIKE '%extensions.digest%' qualified_digest
  `, [workspace])).rows[0];
  if (!row?.workspace_exists || !row.function_exists) {
    throw new Error("The selected UAT workspace or classification watermark function is unavailable.");
  }
  return { state: row.qualified_digest ? "complete" : "absent", workspace_id: workspace,
    function_exists: row.function_exists, qualified_digest: row.qualified_digest };
}

async function verifyRestrictedCall(client: pg.Client, workspace: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path=public,pg_temp");
    const row = (await client.query<{ callable: boolean }>(`
      SELECT signal_classification_watermark_digest_v1(
        $1::uuid,(SELECT study_corpus_id FROM signal_workspace_corpora
          WHERE workspace_id=$1::uuid AND role='operational' AND valid_to IS NULL
          ORDER BY valid_from DESC LIMIT 1)
      ) IS NOT NULL callable
    `, [workspace])).rows[0];
    if (!row?.callable) throw new Error("The restricted watermark call did not return a digest.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
