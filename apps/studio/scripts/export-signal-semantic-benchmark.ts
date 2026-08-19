import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

const EXPECTED_DATABASE_FINGERPRINTS = new Set([
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815"
]);
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false });

if (
  process.env.NOISIA_REMOTE_DATABASE_TARGET !== "noisia-staging"
  || process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_EXPORT_APPROVED !== "true"
) {
  throw new Error("Signal benchmark export is staging-only and requires explicit approval.");
}
const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const supabaseUrl = required(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  "SUPABASE_URL"
);
const databaseFingerprint = fingerprintDatabase(databaseUrl);
const projectRefHash = hash(new URL(supabaseUrl).hostname.split(".")[0] ?? "");
if (
  !EXPECTED_DATABASE_FINGERPRINTS.has(databaseFingerprint)
  || projectRefHash !== EXPECTED_PROJECT_REF_HASH
) {
  throw new Error("Signal benchmark export target does not match noisia-staging.");
}
const workspaceName = required(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME,
  "NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME"
);
const outputDirectory = resolve(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_OUTPUT_DIR
    ?? "../../.data/signal-semantic-lab/backend-10c/export"
);
const privateDataRoot = resolve(process.cwd(), "../../.data");
if (
  outputDirectory !== privateDataRoot
  && !outputDirectory.startsWith(`${privateDataRoot}/`)
) {
  throw new Error("Signal benchmark export must remain below the repository .data directory.");
}
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await chmod(outputDirectory, 0o700);
const pseudonymKey = await loadOrCreatePseudonymKey(
  resolve(outputDirectory, "pseudonym-key.private.bin")
);

const [{ pool }, { exportSignalSemanticBenchmarkV1 }] = await Promise.all([
  import("../src/lib/db"),
  import("../src/lib/data-os/signal-semantic-benchmark-export")
]);
const workspaceResult = await pool.query<{ workspace_id: string }>(`
  SELECT workspace.id::text AS workspace_id
  FROM signal_workspaces workspace
  JOIN brands brand ON brand.id=workspace.brand_id
  WHERE workspace.status='active' AND brand.status='active' AND lower(brand.name)=lower($1)
`, [workspaceName]);
if (workspaceResult.rowCount !== 1 || !workspaceResult.rows[0]) {
  throw new Error("The staging benchmark workspace is not uniquely resolvable.");
}
const client = await pool.connect();
try {
  const exported = await exportSignalSemanticBenchmarkV1({
    client,
    workspaceId: workspaceResult.rows[0].workspace_id,
    pseudonymKey
  });
  const exportPath = resolve(outputDirectory, "source-export.private.jsonl");
  const body = `${exported.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(exportPath, body, { mode: 0o600 });
  await chmod(exportPath, 0o600);
  const contentDigest = hash(exported.records.map((record) => [
    record.record_key,
    record.content_hash,
    record.context_hash,
    record.authority_digest
  ].join("|")).join("\n"));
  const manifest = {
    contract_version: "signal-semantic-benchmark-export-v1",
    target: "noisia-staging",
    read_only: true,
    writes_performed: false,
    provider_calls: 0,
    jobs_enqueued: 0,
    workspace_ref: exported.workspace_ref,
    export_timestamp: new Date().toISOString(),
    period_start: exported.period_start,
    period_end: exported.period_end,
    timezone: exported.timezone,
    population_digest: exported.population_digest,
    watermark_digest: exported.watermark_digest,
    governance_digest: exported.governance_digest,
    content_digest: contentDigest,
    schema_version: "signal-semantic-benchmark-record-v1",
    denominator: exported.denominator,
    exported: exported.exported,
    excluded_by_reason: exported.excluded_by_reason,
    scope_counts: exported.scope_counts,
    entity_counts: exported.entity_counts,
    language_counts: exported.language_counts,
    platform_counts: exported.platform_counts,
    projection_snapshot_digest: exported.projection_snapshot_digest,
    projection_generation: exported.projection_generation,
    projection_reconciled_at: exported.projection_reconciled_at,
    exclusion_contract: "exclusive-precedence-v1",
    protected_state_digest_before: exported.protected_state_digest_before,
    protected_state_digest_after: exported.protected_state_digest_after,
    transaction_read_only: exported.transaction_read_only,
    transaction_id_assigned: exported.transaction_id_assigned,
    export_file_sha256: fileHash(body)
  } as const;
  const manifestPath = resolve(outputDirectory, "source-export.manifest.private.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600);
  const receipt = {
    contract_version: "signal-semantic-benchmark-export-receipt-v1",
    target: manifest.target,
    database_fingerprint: databaseFingerprint,
    project_ref_hash: projectRefHash,
    workspace_ref: manifest.workspace_ref,
    denominator: manifest.denominator,
    exported: manifest.exported,
    excluded_by_reason: manifest.excluded_by_reason,
    population_digest: manifest.population_digest,
    watermark_digest: manifest.watermark_digest,
    content_digest: manifest.content_digest,
    protected_state_digest_before: manifest.protected_state_digest_before,
    protected_state_digest_after: manifest.protected_state_digest_after,
    read_only: true,
    writes_performed: false,
    jobs_enqueued: 0,
    provider_calls: 0
  };
  const receiptPath = resolve(outputDirectory, "export-receipt.sanitized.json");
  const receiptBody = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(receiptPath, receiptBody, { mode: 0o600 });
  await chmod(receiptPath, 0o600);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    receipt_sha256: fileHash(receiptBody),
    denominator: receipt.denominator,
    exported: receipt.exported,
    excluded_by_reason: receipt.excluded_by_reason,
    read_only: true,
    writes_performed: false,
    jobs_enqueued: 0,
    provider_calls: 0
  })}\n`);
} finally {
  client.release();
  await pool.end();
}

async function loadOrCreatePseudonymKey(path: string) {
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o777) !== 0o600 || metadata.size !== 32) {
      throw new Error("Benchmark pseudonym key is not a private 32-byte artifact.");
    }
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const value = randomBytes(32);
    await writeFile(path, value, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    return value;
  }
}

function fingerprintDatabase(value: string) {
  const parsed = new URL(value);
  return hash([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fileHash(value: string) {
  return hash(value);
}
