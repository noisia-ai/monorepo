import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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

if (process.env.NOISIA_REMOTE_DATABASE_TARGET
  && process.env.NOISIA_REMOTE_DATABASE_TARGET !== "noisia-staging") {
  throw new Error("Signal benchmark preflight target is not noisia-staging.");
}
if (process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_PREFLIGHT_APPROVED !== "true") {
  throw new Error("Signal benchmark preflight requires explicit read-only approval.");
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
  throw new Error("Signal benchmark preflight target does not match noisia-staging.");
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
  throw new Error("Signal benchmark preflight plan is not the sealed V3 contract.");
}
const workspaceName = required(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME,
  "NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME"
);
const outputDirectory = resolve(
  process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_OUTPUT_DIR
    ?? "../../.data/signal-semantic-lab/backend-10c2"
);
const privateDataRoot = resolve(process.cwd(), "../../.data");
if (outputDirectory !== privateDataRoot
  && !outputDirectory.startsWith(`${privateDataRoot}/`)) {
  throw new Error("Signal benchmark preflight output must remain below .data.");
}
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await chmod(outputDirectory, 0o700);

const [
  { pool },
  { preflightSignalSemanticBenchmarkExportV2 }
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
  const result = await preflightSignalSemanticBenchmarkExportV2({
    client,
    workspaceId: workspaceResult.rows[0].workspace_id,
    frozenCorpus: plan.corpus
  });
  const receipt = {
    ...result,
    database_fingerprint: databaseFingerprint,
    project_ref_hash: projectRefHash,
    plan_file_sha256: hash(planBody),
    workspace_ref: hash(`workspace-name:${workspaceName}`),
    output_path_private: true,
    execution_authorized: false,
    ten_d_authorized: false
  };
  const path = resolve(outputDirectory, "real-export-preflight.sanitized.json");
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(path, body, { mode: 0o600 });
  await chmod(path, 0o600);
  process.stdout.write(`${JSON.stringify({
    ok: result.ready,
    blockers: result.blockers,
    acquisition_denominator: result.acquisition_denominator,
    modeling_population: result.modeling_population,
    quality_excluded_roots: result.quality_excluded_roots,
    partition_count: Object.keys(result.partitions).length,
    required_usage: result.required_usage,
    transaction_read_only: result.transaction_read_only,
    transaction_id_assigned: result.transaction_id_assigned,
    writes_performed: result.writes_performed,
    provider_calls: result.provider_calls,
    jobs_enqueued: result.jobs_enqueued,
    serving_writes: result.serving_writes,
    receipt_sha256: hash(body)
  })}\n`);
} finally {
  client.release();
  await pool.end();
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
