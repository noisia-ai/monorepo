import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

import type { SignalSemanticBenchmarkFrozenCorpusV2 } from
  "../src/lib/data-os/signal-semantic-benchmark-export";

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
  throw new Error("Signal benchmark V2 export is staging-only and requires approval.");
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
  throw new Error("Signal benchmark V2 export target does not match noisia-staging.");
}
const planPath = resolve(process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_PLAN
  ?? "../../tools/signal-semantic-lab/config/benchmark-plan-10c2-v3.json");
const planBody = await readFile(planPath, "utf8");
const plan = JSON.parse(planBody) as {
  contract_version?: string;
  execution_authorized?: boolean;
  ten_d_authorized?: boolean;
  corpus?: SignalSemanticBenchmarkFrozenCorpusV2;
};
if (
  plan.contract_version !== "signal-local-modeling-benchmark-plan-v3"
  || plan.execution_authorized !== false
  || plan.ten_d_authorized !== false
  || !plan.corpus
) {
  throw new Error("Signal benchmark V2 export plan is not the sealed V3 contract.");
}
const workspaceName = required(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME,
  "NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME"
);
const outputDirectory = resolve(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_OUTPUT_DIR
    ?? "../../.data/signal-semantic-lab/backend-10c2/export"
);
const privateDataRoot = resolve(process.cwd(), "../../.data");
if (outputDirectory !== privateDataRoot
  && !outputDirectory.startsWith(`${privateDataRoot}/`)) {
  throw new Error("Signal benchmark V2 export must remain below .data.");
}
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await chmod(outputDirectory, 0o700);
const pseudonymKey = await loadOrCreatePseudonymKey(
  resolve(outputDirectory, "pseudonym-key.private.bin")
);
const exporterSourceDigest = hash([
  "apps/studio/scripts/export-signal-semantic-benchmark-v2.ts",
  await readFile(resolve(process.cwd(), "scripts/export-signal-semantic-benchmark-v2.ts"), "utf8"),
  "apps/studio/src/lib/data-os/signal-semantic-benchmark-export.ts",
  await readFile(
    resolve(process.cwd(), "src/lib/data-os/signal-semantic-benchmark-export.ts"),
    "utf8"
  )
].join("\u0000"));

const [
  { pool },
  {
    buildSignalSemanticBenchmarkExportManifestV2,
    exportSignalSemanticBenchmarkV2
  }
] = await Promise.all([
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
  const exported = await exportSignalSemanticBenchmarkV2({
    client,
    workspaceId: workspaceResult.rows[0].workspace_id,
    frozenCorpus: plan.corpus,
    pseudonymKey
  });
  const exportPath = resolve(outputDirectory, "source-export-v2.private.jsonl");
  const body = `${exported.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(exportPath, body, { mode: 0o600, flag: "wx" });
  await chmod(exportPath, 0o600);
  const manifest = buildSignalSemanticBenchmarkExportManifestV2({
    exported,
    frozenCorpus: plan.corpus,
    exportFileSha256: hash(body),
    exporterSourceDigest
  });
  const manifestPath = resolve(outputDirectory, "source-export-v2.manifest.private.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
  await chmod(manifestPath, 0o600);
  const receipt = {
    contract_version: "signal-semantic-benchmark-export-receipt-v2",
    database_fingerprint: databaseFingerprint,
    project_ref_hash: projectRefHash,
    workspace_ref: manifest.workspace_ref,
    corpus_identity: manifest.corpus_identity,
    acquisition_denominator: manifest.acquisition_denominator,
    modeling_population: manifest.modeling_population,
    quality_excluded_roots: manifest.quality_excluded_roots,
    partition_count: Object.keys(manifest.partitions).length,
    population_digest: manifest.population_digest,
    content_digest: manifest.content_digest,
    provenance_digest: manifest.provenance_digest,
    watermark_digest: manifest.watermark_digest,
    export_file_sha256: manifest.export_file_sha256,
    export_records_digest: manifest.export_records_digest,
    exporter_source_digest: manifest.exporter_source_digest,
    read_only: true,
    writes_performed: false,
    provider_calls: 0,
    jobs_enqueued: 0,
    serving_writes: 0,
    execution_authorized: false,
    ten_d_authorized: false
  } as const;
  const receiptPath = resolve(outputDirectory, "export-receipt-v2.sanitized.json");
  const receiptBody = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(receiptPath, receiptBody, { mode: 0o600, flag: "wx" });
  await chmod(receiptPath, 0o600);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    receipt_sha256: hash(receiptBody),
    acquisition_denominator: receipt.acquisition_denominator,
    modeling_population: receipt.modeling_population,
    quality_excluded_roots: receipt.quality_excluded_roots,
    partition_count: receipt.partition_count,
    read_only: true,
    writes_performed: false,
    provider_calls: 0,
    jobs_enqueued: 0,
    serving_writes: 0
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
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}
