import { createHash } from "node:crypto";
import { createReadStream,createWriteStream } from "node:fs";
import { chmod,mkdir,readFile,stat,writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname,resolve } from "node:path";
import { once } from "node:events";
import { createGzip } from "node:zlib";

import pg from "pg";

const root = resolve(import.meta.dirname,"../../..");
const requireFromStudio = createRequire(resolve(root,"apps/studio/package.json"));
const { parse } = requireFromStudio("dotenv") as typeof import("dotenv");
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceName = process.env.NOISIA_IMPORT_RESTORE_WORKSPACE_NAME?.trim();
const sourceName = process.env.NOISIA_IMPORT_RESTORE_SOURCE_NAME?.trim();
const fileName = process.env.NOISIA_IMPORT_RESTORE_FILE_NAME?.trim();
const output = process.argv[2] ? resolve(process.argv[2]) : null;
const sanitizedOutput = process.argv[3] ? resolve(process.argv[3]) : null;

if (target!=="noisia-staging" || !workspaceName || !sourceName || !fileName
    || !output || !sanitizedOutput) {
  throw new Error("A staging target, exact incident identity and two output paths are required.");
}

const env = parse(await readFile(resolve(root,"apps/studio/.env.local"),"utf8"));
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl || env.DATABASE_SSL!=="true") {
  throw new Error("Canonical staging database configuration is unavailable.");
}

await mkdir(dirname(output),{ recursive: true,mode: 0o700 });
const gzip = createGzip({ level: 9 });
const destination = createWriteStream(output,{ flags: "wx",mode: 0o600 });
gzip.pipe(destination);
const client = new pg.Client({
  connectionString: databaseUrl,ssl: { rejectUnauthorized: false },
  application_name: "noisia-workspace-import-restore-point"
});
await client.connect();
let committed = false;
const counts: Record<string,number> = {};
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY DEFERRABLE");
  await client.query("SET LOCAL statement_timeout='10min'");
  const incident = await client.query<{
    workspace_id: string;source_id: string;batch_id: string;
  }>(`
    SELECT workspace.id::text AS workspace_id,source.id::text AS source_id,batch.id::text AS batch_id
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id=workspace.brand_id
    JOIN data_sources source ON source.workspace_id=workspace.id AND source.name=$2
    JOIN import_batches batch ON batch.workspace_id=workspace.id
      AND batch.data_source_id=source.id AND batch.source_file_name=$3 AND batch.status='failed'
    WHERE workspace.status='active' AND brand.status='active'
      AND (brand.name=$1 OR brand.display_name=$1)
    ORDER BY batch.created_at DESC
  `,[workspaceName,sourceName,fileName]);
  if (incident.rowCount!==1) throw new Error("The failed import incident identity is not unique.");
  const authority = incident.rows[0]!;
  await writeLine({
    contract_version: "signal-workspace-import-logical-restore-v1",
    captured_at: new Date().toISOString(),target: "noisia-staging",
    authority
  });

  const domains = [
    ["workspace",`SELECT to_jsonb(row_value) AS value FROM signal_workspaces row_value WHERE id=$1::uuid`,[authority.workspace_id]],
    ["source",`SELECT to_jsonb(row_value) AS value FROM data_sources row_value WHERE id=$1::uuid`,[authority.source_id]],
    ["batch",`SELECT to_jsonb(row_value) AS value FROM import_batches row_value WHERE id=$1::uuid`,[authority.batch_id]],
    ["import_memberships",`SELECT to_jsonb(row_value) AS value FROM signal_mention_import_memberships row_value WHERE import_batch_id=$1::uuid ORDER BY id`,[authority.batch_id]],
    ["mentions",`SELECT to_jsonb(mention) AS value FROM mentions mention WHERE mention.id IN (
      SELECT membership.mention_id FROM signal_mention_import_memberships membership WHERE membership.import_batch_id=$1::uuid
    ) OR mention.source_file_id=$1::uuid ORDER BY mention.id`,[authority.batch_id]],
    ["population_memberships",`SELECT to_jsonb(row_value) AS value FROM signal_population_memberships row_value WHERE mention_id IN (
      SELECT membership.mention_id FROM signal_mention_import_memberships membership WHERE membership.import_batch_id=$1::uuid
    ) ORDER BY population_id,mention_id`,[authority.batch_id]],
    ["semantic_assertions",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attributions row_value WHERE mention_id IN (
      SELECT membership.mention_id FROM signal_mention_import_memberships membership WHERE membership.import_batch_id=$1::uuid
    ) ORDER BY mention_id,created_at,id`,[authority.batch_id]],
    ["governance_events",`SELECT to_jsonb(row_value) AS value FROM signal_mention_governance_events row_value WHERE mention_id IN (
      SELECT membership.mention_id FROM signal_mention_import_memberships membership WHERE membership.import_batch_id=$1::uuid
    ) ORDER BY mention_id,created_at,id`,[authority.batch_id]],
    ["watermarks",`SELECT to_jsonb(row_value) AS value FROM signal_data_watermarks row_value WHERE workspace_id=$1::uuid AND last_import_batch_id=$2::uuid ORDER BY id`,[authority.workspace_id,authority.batch_id]],
    ["sync_runs",`SELECT to_jsonb(row_value) AS value FROM source_sync_runs row_value WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid ORDER BY started_at,id`,[authority.workspace_id,authority.source_id]],
    ["invalidations",`SELECT to_jsonb(row_value) AS value FROM signal_data_invalidations row_value WHERE workspace_id=$1::uuid ORDER BY created_at,id`,[authority.workspace_id]]
    ,["all_incomplete_batches",`SELECT to_jsonb(row_value) AS value FROM import_batches row_value
      WHERE status<>'completed' ORDER BY workspace_id,created_at,id`,[]]
    ,["all_incomplete_import_memberships",`SELECT to_jsonb(membership) AS value
      FROM signal_mention_import_memberships membership
      JOIN import_batches batch ON batch.id=membership.import_batch_id
      WHERE batch.status<>'completed'
      ORDER BY membership.workspace_id,membership.import_batch_id,membership.mention_id`,[]]
    ,["all_incomplete_population_memberships",`SELECT to_jsonb(population) AS value
      FROM signal_population_memberships population
      WHERE population.mention_id IN (
        SELECT membership.mention_id FROM signal_mention_import_memberships membership
        JOIN import_batches batch ON batch.id=membership.import_batch_id
        WHERE batch.status<>'completed'
      ) ORDER BY population.workspace_id,population.population_id,population.mention_id`,[]]
    ,["all_incomplete_semantic_assertions",`SELECT to_jsonb(semantic) AS value
      FROM signal_mention_attributions semantic
      WHERE semantic.mention_id IN (
        SELECT membership.mention_id FROM signal_mention_import_memberships membership
        JOIN import_batches batch ON batch.id=membership.import_batch_id
        WHERE batch.status<>'completed'
      ) ORDER BY semantic.workspace_id,semantic.mention_id,semantic.created_at,semantic.id`,[]]
  ] as const;
  for (const [domain,sql,params] of domains) {
    const result = await client.query<{ value: unknown }>(sql,[...params]);
    counts[domain]=result.rowCount ?? 0;
    for (const row of result.rows) await writeLine({ domain,value: row.value });
  }
  await client.query("COMMIT");
  committed=true;
} finally {
  if (!committed) await client.query("ROLLBACK").catch(()=>undefined);
  await client.end();
  gzip.end();
  await once(destination,"close");
}

await chmod(output,0o600);
const outputStat = await stat(output);
const artifactHash = await sha256File(output);
const sanitized = {
  contract_version: "signal-workspace-import-restore-evidence-v1",
  ok: true,target: "noisia-staging",captured_at: new Date().toISOString(),
  artifact_sha256: artifactHash,artifact_size_bytes: outputStat.size,counts,
  database_writes: 0,provider_calls: 0,jobs_enqueued: 0
};
await writeFile(sanitizedOutput,`${JSON.stringify(sanitized,null,2)}\n`,{ mode: 0o600 });
await chmod(sanitizedOutput,0o600);
process.stdout.write(`${JSON.stringify(sanitized)}\n`);

async function writeLine(value: unknown) {
  if (!gzip.write(`${JSON.stringify(value)}\n`)) await once(gzip,"drain");
}

async function sha256File(path: string) {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
