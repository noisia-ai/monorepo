import "../src/env/load";

import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = "/Users/brandhon_o/Downloads/noisia-website";
const OUTPUT_DIR = resolve(ROOT, ".data/signal-governed-serving/backend-07");
const EXPECTED_DIRECT = "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_MODEL = "claude-sonnet-4-6";
const EXPECTED_PRICING_VERSION = "anthropic-public-2026-08-12";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function databaseFingerprint(value: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function assertExactEnvironment() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || databaseFingerprint(databaseUrl) !== EXPECTED_DIRECT) {
    throw new Error("signal_tb_supervisor_target_mismatch");
  }
  if (!process.env.REDIS_URL?.trim()) throw new Error("signal_tb_supervisor_redis_unavailable");
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("signal_tb_supervisor_provider_key_unavailable");
  if (process.env.NOISIA_SIGNAL_TB_MODEL !== EXPECTED_MODEL) {
    throw new Error("signal_tb_supervisor_model_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_PRICING_VERSION !== EXPECTED_PRICING_VERSION) {
    throw new Error("signal_tb_supervisor_pricing_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_INPUT_USD_PER_MTOK !== "3") {
    throw new Error("signal_tb_supervisor_input_price_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_OUTPUT_USD_PER_MTOK !== "15") {
    throw new Error("signal_tb_supervisor_output_price_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL !== "120000") {
    throw new Error("signal_tb_supervisor_input_limit_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_MAX_BUDGET_USD !== "15") {
    throw new Error("signal_tb_supervisor_budget_mismatch");
  }
  if (process.env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED !== "true") {
    throw new Error("signal_tb_supervisor_launch_authority_missing");
  }
  return { databaseUrl };
}

const { databaseUrl } = assertExactEnvironment();
const [
  { pool },
  queueModule,
  queryEngineQueueModule,
  runOutboxModule,
  stepOutboxModule
] = await Promise.all([
  import("../src/db/client"),
  import("../src/queues/tb-analysis"),
  import("../src/queues/query-engine"),
  import("../src/workers/signal-strategic-run-outbox"),
  import("../src/workers/signal-strategic-step-outbox")
]);

const queue = queueModule.getTbAnalysisProducer();
const [queueCounts, databaseProbeResult] = await Promise.all([
  queue.getJobCounts(
    "active",
    "delayed",
    "failed",
    "paused",
    "prioritized",
    "waiting",
    "waiting-children"
  ),
  pool.query<{ run_outbox_nonterminal: number; step_outbox_nonterminal: number;
    run_controls_nonterminal: number; analyses_nonterminal: number }>(`SELECT
    (SELECT count(*)::int FROM signal_strategic_run_outbox
      WHERE status IN ('pending','dispatching','dispatched','failed')) AS run_outbox_nonterminal,
    (SELECT count(*)::int FROM signal_strategic_step_outbox
      WHERE status IN ('pending','dispatching','dispatched','running','failed')) AS step_outbox_nonterminal,
    (SELECT count(*)::int FROM signal_strategic_run_controls
      WHERE status NOT IN ('completed','failed','cancelled')) AS run_controls_nonterminal,
    (SELECT count(*)::int FROM tb_analyses
      WHERE strategic_contract_version='signal-tb-strategic-v2'
        AND status NOT IN ('completed','failed','cancelled')) AS analyses_nonterminal`)
]);
const databaseProbe = databaseProbeResult.rows[0]!;
const consumableJobs = [
  "active", "delayed", "paused", "prioritized", "waiting", "waiting-children"
].reduce((sum, state) => sum + Number(queueCounts[state] ?? 0), 0);
const nonterminalDatabaseRows = Object.values(databaseProbe)
  .reduce((sum, value) => sum + Number(value), 0);
if (consumableJobs !== 0 || nonterminalDatabaseRows !== 0) {
  await Promise.allSettled([
    queueModule.closeTbAnalysisProducer(),
    queryEngineQueueModule.closeQueryEngineProducer(),
    queryEngineQueueModule.redisConnection.quit(),
    pool.end()
  ]);
  throw new Error("signal_tb_supervisor_nonempty_work_detected");
}

// Only after the read-only zero-work probe is green may this process create a
// consumer or recovery loop. Historical terminal BullMQ failures are observed
// above but never retried, removed or counted as consumable work.
const worker = queueModule.startTbAnalysisWorker();
const runDrainer = runOutboxModule.startSignalStrategicRunOutboxDrainer({ runImmediately: false });
const stepDrainer = stepOutboxModule.startSignalStrategicStepOutboxDrainer({ runImmediately: false });
let heartbeat: ReturnType<typeof queueModule.startTbAnalysisHeartbeat> | null = null;
let closed = false;

async function shutdown() {
  if (closed) return;
  closed = true;
  await heartbeat?.close();
  await Promise.allSettled([
    runDrainer.close(),
    stepDrainer.close(),
    worker.close(),
    queueModule.closeTbAnalysisProducer(),
    queryEngineQueueModule.closeQueryEngineProducer()
  ]);
  await Promise.allSettled([
    queryEngineQueueModule.redisConnection.quit(),
    pool.end()
  ]);
}

try {
  await worker.waitUntilReady();
  heartbeat = queueModule.startTbAnalysisHeartbeat();
  const ready = {
    contract_version: "signal-backend-07-tb-supervisor-v1",
    captured_at: new Date().toISOString(),
    target: "noisia-staging",
    database_fingerprint: databaseFingerprint(databaseUrl),
    queue_name: "noisia-tb-analysis",
    queue_counts: queueCounts,
    prestart_database_probe: databaseProbe,
    prestart_consumable_job_count: consumableJobs,
    prestart_nonterminal_database_count: nonterminalDatabaseRows,
    worker_ready: true,
    run_recovery_ready: true,
    step_recovery_ready: true,
    launch_authorized_process: true,
    jobs_enqueued: 0,
    provider_calls: 0
  };
  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  const outputPath = resolve(OUTPUT_DIR, "tb-supervisor-ready.sanitized.json");
  await writeFile(outputPath, `${JSON.stringify(ready, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);
  process.stdout.write(`${JSON.stringify({
    ready: true,
    queue_name: ready.queue_name,
    worker_ready: true,
    run_recovery_ready: true,
    step_recovery_ready: true,
    jobs_enqueued: 0,
    provider_calls: 0,
    evidence_sha256: sha256(`${JSON.stringify(ready, null, 2)}\n`)
  })}\n`);
} catch (error) {
  await shutdown();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

await new Promise<void>(() => undefined);
