import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const expectedChecksum = "sha256:224641136a74af5d262d86babe9614c56825036b8912b9f0ddd8d795ed757e6a";
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");

if (!(["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u)) {
  throw new Error("The Topics migration runner is restricted to an explicit staging workspace.");
}
if (mode === "apply" && process.env.NOISIA_TOPIC_CATALOG_MIGRATION_APPROVED !== "true") {
  throw new Error("Apply requires the explicit UAT migration acknowledgement.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");
const migration = await readFile(resolve(import.meta.dirname, "../migrations/0127_signal_topics_to_signal.sql"), "utf8");
if (sha256(migration) !== expectedChecksum) throw new Error("0127 checksum mismatch.");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-topics-to-signal-uat-migration"
});
await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect(client, workspaceId);
  if (before.state === "partial") throw new Error("0127 partial state is blocked.");
  if (mode === "preflight") {
    emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  } else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("0127 is not complete.");
    emit({ mode, writes_performed: false, checksum: expectedChecksum, ...before });
  } else if (before.state === "complete") {
    emit({ mode, action: "verified_existing", writes_performed: false,
      checksum: expectedChecksum, ...before });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["noisia:uat:0127:topics-to-signal"]);
      const locked = await inspect(client, workspaceId);
      if (locked.state !== "absent") throw new Error("0127 state changed after preflight.");
      await client.query(migration);
      const applied = await inspect(client, workspaceId);
      if (applied.state !== "complete") throw new Error("0127 sentinels did not complete.");
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
  const dependency = (await client.query<{
    workspace_exists: boolean; corpus_id: string | null; denominator: number;
    authority_ready: boolean; sentinels: number;
  }>(`
    WITH target AS(
      SELECT id FROM signal_workspaces WHERE id=$1::uuid AND status='active'
    ), corpus AS(
      SELECT membership.study_corpus_id id
      FROM signal_workspace_corpora membership JOIN target ON target.id=membership.workspace_id
      WHERE membership.role='operational' AND membership.valid_to IS NULL
      ORDER BY membership.valid_from DESC LIMIT 1
    ), roots AS(
      SELECT DISTINCT membership.mention_id id
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_memberships membership ON membership.population_id=pointer.population_id
        AND membership.workspace_id=pointer.workspace_id
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=pointer.workspace_id
        AND mention.study_corpus_id=(SELECT id FROM corpus) AND mention.canonical_mention_id=mention.id
      WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
        AND membership.membership_status='included' AND membership.removed_at IS NULL
    )
    SELECT EXISTS(SELECT 1 FROM target) workspace_exists,(SELECT id::text FROM corpus) corpus_id,
      (SELECT count(*)::int FROM roots) denominator,
      to_regprocedure('begin_signal_classification_generation_v1(uuid,uuid,text,integer,uuid,text,text,text,integer,text,uuid,text,text,uuid)') IS NOT NULL
        AND to_regprocedure('project_signal_classification_generation_v1(uuid,uuid,uuid,text,text)') IS NOT NULL authority_ready,
      (SELECT count(*)::int FROM unnest(ARRAY[
        to_regclass('public.signal_topic_catalog_operations'),
        to_regclass('public.signal_topic_catalog_executions'),
        to_regclass('public.signal_topic_classification_items'),
        to_regclass('public.signal_topic_classification_suggestions'),
        to_regclass('public.signal_topic_membership_overrides'),
        to_regclass('public.signal_topic_membership_operations'),
        to_regclass('public.signal_topic_definition_embeddings')
      ]) object WHERE object IS NOT NULL)
      + CASE WHEN to_regprocedure('prepare_signal_topic_catalog_profile_v1(uuid,uuid)') IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN to_regprocedure('complete_signal_topic_catalog_profile_v1(uuid)') IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN to_regprocedure('append_signal_classification_result_batch_v1(uuid,uuid,uuid,jsonb,text,uuid,text,text)') IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='signal_topic_catalog_executions' AND column_name='publish_when_ready') THEN 1 ELSE 0 END sentinels
  `, [workspace])).rows[0];
  if (!dependency?.workspace_exists || !dependency.corpus_id || dependency.denominator <= 0
      || !dependency.authority_ready) {
    throw new Error("The selected UAT workspace or 0087 authority is not ready.");
  }
  return {
    state: dependency.sentinels === 0 ? "absent" : dependency.sentinels === 11 ? "complete" : "partial",
    workspace_id: workspace,
    study_corpus_id: dependency.corpus_id,
    denominator: Number(dependency.denominator),
    authority_0087_ready: dependency.authority_ready,
    sentinels: Number(dependency.sentinels)
  };
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
