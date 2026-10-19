import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const expectedChecksum = "sha256:da33d2320f3902e56da6e38c3e814e4e7dc4c608767f152ce7f65988dde66e01";
const expectedPriorBody = "sha256:54a9aa8f8cffbdccef0e90b5994c61531dc5fd0bc3169cef297e0ea1289bfd4f";
const expectedNextBody = "sha256:6187b2ba8ab35a12799971b85ed7b030f87bcac9a35e427687e49ca677269032";
const signature = "public.complete_signal_workspace_import_v1(uuid,text,text,integer,integer,integer,integer,bigint)";
const workspaceId = process.env.NOISIA_WORKSPACE_IMPORT_UAT_WORKSPACE_ID;
const expectedBrand = process.env.NOISIA_WORKSPACE_IMPORT_UAT_EXPECTED_BRAND?.trim();
const evidenceDir = process.env.NOISIA_WORKSPACE_IMPORT_MIGRATION_EVIDENCE_DIR;

if (!["preflight", "apply", "verify"].includes(mode ?? "")) throw new Error("Mode must be preflight, apply or verify.");
if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "noisia-staging"
    || !workspaceId?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
    || !expectedBrand || !evidenceDir) {
  throw new Error("An explicit staging workspace, expected brand and private evidence directory are required.");
}
if (mode === "apply" && process.env.NOISIA_WORKSPACE_IMPORT_MIGRATION_APPROVED !== "true") {
  throw new Error("Apply requires the explicit UAT migration acknowledgement.");
}
const envFile = process.env.NOISIA_ENV_FILE;
const env = { ...(envFile ? parse(await readFile(envFile, "utf8")) : {}), ...process.env };
if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is unavailable in the selected environment.");
const migration = await readFile(resolve(import.meta.dirname,
  "../migrations/0131_signal_workspace_import_duplicate_completion.sql"), "utf8");
if (sha256(migration) !== expectedChecksum) throw new Error("0131 checksum mismatch.");

const client = new pg.Client({ connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-uat-import-duplicate-completion" });
await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect();
  await capture(`${mode}-before`, before);
  if (mode === "verify" && before.state !== "complete") throw new Error("0131 is not complete.");
  if (mode !== "apply" || before.state === "complete") {
    emit({ mode, action: before.state === "complete" ? "verified_existing" : "ready_to_apply",
      writes_performed: false, state: before.state, checksum: expectedChecksum, definition_hash: before.body_hash });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["noisia:uat:0131:import-duplicate-completion"]);
      const locked = await inspect();
      if (locked.state !== "prior" || metadata(locked) !== metadata(before)) {
        throw new Error("Function definition or authority changed after preflight.");
      }
      await client.query(migration);
      const after = await inspect();
      if (after.state !== "complete" || metadata(before) !== metadata(after)) {
        throw new Error("0131 changed function authority or did not install the exact expected body.");
      }
      await capture("apply-after", after);
      await client.query("COMMIT");
      emit({ mode, action: "applied", writes_performed: true, checksum: expectedChecksum,
        definition_hash_before: before.body_hash, definition_hash_after: after.body_hash,
        signature_owner_acl_security_configuration_unchanged: true });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  }
} finally { await client.end(); }

async function inspect() {
  const workspace = (await client.query<{ valid: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM signal_workspaces workspace JOIN brands brand
      ON brand.id=workspace.brand_id AND brand.organization_id=workspace.organization_id
      WHERE workspace.id=$1::uuid AND workspace.status='active' AND brand.status='active'
        AND brand.name=$2) valid
  `, [workspaceId, expectedBrand])).rows[0];
  if (!workspace?.valid) throw new Error("The selected active UAT workspace does not match the expected active brand.");
  const row = (await client.query<{
    body: string; definition: string; owner: string; acl: string | null; security_definer: boolean;
    configuration: string[] | null; arguments: string; result: string; language: string;
    volatility: string; parallel: string; leakproof: boolean; strict: boolean; cost: number; rows: number;
  }>(`SELECT proc.prosrc body,pg_get_functiondef(proc.oid) definition,pg_get_userbyid(proc.proowner) owner,
      proc.proacl::text acl,proc.prosecdef security_definer,proc.proconfig configuration,
      pg_get_function_arguments(proc.oid) arguments,pg_get_function_result(proc.oid) result,
      language.lanname language,proc.provolatile volatility,proc.proparallel parallel,
      proc.proleakproof leakproof,proc.proisstrict strict,proc.procost cost,proc.prorows rows
    FROM pg_proc proc JOIN pg_language language ON language.oid=proc.prolang
    WHERE proc.oid=to_regprocedure($1)`, [signature])).rows[0];
  if (!row) throw new Error("The expected import completion signature is unavailable.");
  const bodyHash = sha256(row.body.replace(/\r\n/gu, "\n").trim());
  if (bodyHash !== expectedPriorBody && bodyHash !== expectedNextBody) {
    // Never replace an unrecognized later fix with this historical definition.
    throw new Error("The installed import completion body differs from both reviewed versions; no write performed.");
  }
  return { ...row, body_hash: bodyHash, state: bodyHash === expectedNextBody ? "complete" : "prior" };
}

function metadata(row: Awaited<ReturnType<typeof inspect>>) {
  return JSON.stringify(Object.fromEntries(Object.entries(row)
    .filter(([key]) => !["body", "definition", "body_hash", "state"].includes(key))));
}
async function capture(label: string, row: Awaited<ReturnType<typeof inspect>>) {
  await mkdir(evidenceDir!, { recursive: true, mode: 0o700 });
  await writeFile(resolve(evidenceDir!, `0131-${label}-function.sql`), row.definition, { mode: 0o600 });
  await writeFile(resolve(evidenceDir!, `0131-${label}-metadata.json`), `${JSON.stringify({
    signature, workspace_id: workspaceId, expected_brand: expectedBrand,
    checksum: expectedChecksum, body_hash: row.body_hash, state: row.state,
    authority: JSON.parse(metadata(row))
  }, null, 2)}\n`, { mode: 0o600 });
}
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function emit(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
