import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { continueMassLabelingV1 } from "../../infrastructure/db/signal-mass-labeling";
import { runMassLabelingAcceptanceFixtureV1 } from "../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture";
import { createCalibratedJevRuntimeProviderV2 } from "../../services/workers/src/providers/jev-streaming-runtime";
import { createMassLabelingRuntimeStoreV1, processMassLabelingProductPageV2 } from "../../services/workers/src/workers/signal-mass-labeling-jev";
import { createWorkspaceEngineStorageV1 } from "../../services/workers/src/workers/signal-workspace-engine-storage";
import { startR16HttpFilesystemStorageV1 } from "./http-filesystem-storage";
import { deterministicR16LatencyV1, createSyntheticJevFetchV1 } from "./synthetic-jev";
import { R16BenchmarkRecorderV1 } from "./benchmark-recorder";
import { summarizeR16BenchmarkV1, type R16BenchmarkEvidenceV1, type R16PhaseV1 } from "./benchmark-contract";
import { captureR16SourceProvenanceV1, r16PolicyConfigurationDigestV1 } from "./source-provenance";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = resolve(repo, ".data/piloto-masivo/r16");
const connectionPath = resolve(privateRoot, "labs/benchmark-pg17/connection.env");
const redisPath = resolve(privateRoot, "labs/r16-lab-nov14/connection.env");
type FaultMatrixV1 = { completed_at: string; case_count: number; postgres: { system_identifier: string };
  source_provenance: R16BenchmarkEvidenceV1["source_provenance"]; policy_configuration_digest: string;
  policy_cases: Array<{case:string;admission_id:string;policy_version_id:string;policy_digest:string;
    execution_cap_micro_usd:string;daily_cap_micro_usd:string;action_max_execution_micro_usd:string}>;
  failures: R16BenchmarkEvidenceV1["failures"]; guards: { policy_denials: number; budget_denials: number; denied_requests_not_sent: number };
  invariants: { duplicate_settlements: number; denied_provider_requests: number } };
async function loadPrivateEnv(path: string): Promise<Record<string, string>> {
  const contents = await readFile(path, "utf8");
  const loaded: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2]!.replace(/^(["'])(.*)\1$/u, "$2");
    loaded[match[1]!] = value;
  }
  return loaded;
}
const pgEnv = await loadPrivateEnv(connectionPath);
const inheritedRedisUrl = process.env.R16BENCH_REDIS_URL;
const redisEnv = inheritedRedisUrl ? {} : await loadPrivateEnv(process.env.R16BENCH_REDIS_ENV_PATH ?? redisPath);
process.env.DATABASE_URL = process.env.DATABASE_URL ?? pgEnv.DATABASE_URL;
process.env.R16BENCH_RUN_ID = process.env.R16BENCH_RUN_ID ?? pgEnv.R16BENCH_RUN_ID;
process.env.R16BENCH_REDIS_URL = inheritedRedisUrl ?? redisEnv.R16BENCH_REDIS_URL;
if (process.env.R16BENCH_RUN_ID !== "benchmark-pg17" || !process.env.DATABASE_URL
  || !process.env.R16BENCH_REDIS_URL || !new URL(process.env.R16BENCH_REDIS_URL).hostname.match(/^(127\.0\.0\.1|localhost|\[::1\])$/u)) {
  throw new Error("r16_private_lab_target_invalid");
}
process.env.NOISIA_R16_LOCAL_PG_LAB = "r16-benchmark-pg17";

const rootCount = Number(process.env.R16BENCH_ROOTS ?? 32_768);
const sourceProvenance = await captureR16SourceProvenanceV1(repo);
const execution = { max_in_flight: 1024, flush_size: 256, max_flushes: 2,
  max_buffered_bytes: 512 * 1024 * 1024, flush_interval_ms: 100, window_size: 4096 };
const responseBound = 16 * 1024;
let recorder = new R16BenchmarkRecorderV1("r16-synthetic-benchmark");
const objectRoot = await mkdtemp(join(privateRoot, "objects-"));
const storageServer = await startR16HttpFilesystemStorageV1(objectRoot);
let closeProvider = async () => {};
const spans: Array<{ phase: R16PhaseV1; start_ms: number; end_ms: number; roots: number }> = [];
const storageFetch: typeof fetch = async (input, init) => {
  const start_ms = recorder.elapsedMs();
  try { return await fetch(input, init); }
  finally { spans.push({ phase: "raw_storage", start_ms, end_ms: recorder.elapsedMs(), roots: 0 }); }
};
const providerFetch = createSyntheticJevFetchV1({ latencyForRequest: deterministicR16LatencyV1 });
let inFlight = 0, maxInFlight = 0;
const fetchWithConcurrency: typeof fetch = async (input, init) => {
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  try { return await providerFetch(input, init); } finally { inFlight--; }
};

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type DbLike = { query: (...args: any[]) => Promise<QueryResult>; connect?: () => Promise<any> };
const sqlMetrics = { queries: 0, total_ms: 0, max_ms: 0 };
function instrumentDatabase<T extends DbLike>(database: T): T {
  const wrapQuery = (query: (...args: any[]) => Promise<QueryResult>) => async (...args: any[]) => {
    const start = performance.now(), start_ms = recorder.elapsedMs();
    try { return await query(...args); }
    finally { const elapsed = performance.now() - start; sqlMetrics.queries++; sqlMetrics.total_ms += elapsed; sqlMetrics.max_ms = Math.max(sqlMetrics.max_ms, elapsed);
      spans.push({ phase: "postgres", start_ms, end_ms: recorder.elapsedMs(), roots: 0 }); }
  };
  return new Proxy(database, { get(target, property, receiver) {
    if (property === "query") return wrapQuery(target.query.bind(target));
    if (property === "connect" && target.connect) return async () => {
      const client = await target.connect!();
      return new Proxy(client, { get(clientTarget, clientProperty, clientReceiver) {
        if (clientProperty === "query") return wrapQuery(clientTarget.query.bind(clientTarget));
        const value = Reflect.get(clientTarget, clientProperty, clientReceiver);
        return typeof value === "function" ? value.bind(clientTarget) : value;
      } });
    };
    return Reflect.get(target, property, receiver);
  } });
}

let sampleTimer: NodeJS.Timeout | undefined;
let sustainedStartMs = 5_000;
let sampleDb: DbLike | undefined;
let sampleRunId = "";
let sampleRootCount = 0;
let streamMetrics = { in_flight: 0, reserved_working_bytes: 0, buffered_responses: 0, active_flushes: 0 };
let policyLimits: R16BenchmarkEvidenceV1["policy_limits"] | undefined;
const observeStream = (metrics: typeof streamMetrics) => {
  streamMetrics = metrics;
  recorder.observeStream(metrics);
};
async function sampleProgress() {
  if (!sampleDb || !sampleRunId) return;
  const at = recorder.elapsedMs();
  const [settled, lease] = await Promise.all([
    sampleDb.query(`SELECT count(*) FILTER(WHERE results_applied)::int applied
      FROM signal_labeling_calls WHERE run_id=$1::uuid`, [sampleRunId]),
    sampleDb.query(`SELECT count(*)::int n FROM signal_labeling_runs WHERE id=$1::uuid AND lease_until>clock_timestamp()`, [sampleRunId]),
  ]);
  const total = Number(settled.rows[0]?.applied ?? 0);
  recorder.sample({ at_ms: at, in_flight: streamMetrics.in_flight,
    buffered_bytes: streamMetrics.reserved_working_bytes, buffered_responses: streamMetrics.buffered_responses,
    active_flushes: streamMetrics.active_flushes, leased_runs: Number(lease.rows[0]?.n ?? 0),
    rss_bytes: process.memoryUsage().rss });
  sampleRootCount = Math.max(sampleRootCount, total);
}
sampleTimer = setInterval(() => { void sampleProgress().catch(() => undefined); }, 1_000);
sampleTimer.unref();

let evidence: ReturnType<R16BenchmarkRecorderV1["finish"]> | undefined;
const fixtureSetupStarted = performance.now();
try {
  await runMassLabelingAcceptanceFixtureV1("product-recovery", { benchmark: {
    root_count: rootCount, import_batch_size: 512, preparation_page_size: 100,
    embedding_page_limit: Math.ceil(rootCount / 128) + 8, execution_cap_micro_usd: 20_000_000,
    beforeProcessing: async context => {
      const fixtureSetupMs = performance.now() - fixtureSetupStarted;
      recorder = new R16BenchmarkRecorderV1("r16-synthetic-benchmark");
      sustainedStartMs = 5_000;
      streamMetrics = { in_flight: 0, reserved_working_bytes: 0, buffered_responses: 0, active_flushes: 0 };
      recorder.observeStream(streamMetrics);
      sampleDb = instrumentDatabase(context.database as unknown as DbLike);
      sampleRunId = context.run_id;
      const db = sampleDb;
      const identity = await db.query(`SELECT current_database() database_name,version() verified_version,
        (SELECT system_identifier::text FROM pg_control_system()) system_identifier,
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') pgvector`);
      assert.equal(identity.rows[0]?.database_name, "noisia_mfp_ci");
      assert.equal(identity.rows[0]?.pgvector, true);
      const labeler = await db.query(`SELECT labeler.labeler_digest FROM signal_labeling_runs run
        JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id WHERE run.id=$1::uuid`, [context.run_id]);
      const labelerDigest = String(labeler.rows[0]?.labeler_digest ?? "");
      if (!/^sha256:[0-9a-f]{64}$/u.test(labelerDigest)) throw new Error("r16_labeler_digest_missing");
      const policyRow = await db.query(`SELECT admission.action,admission.configuration,admission.configuration_digest,
          admission.execution_cap_micro_usd::text execution_cap,
          admission.provider,admission.model,policy.id::text policy_version_id,policy.policy_digest,
          policy.daily_cap_micro_usd::text policy_daily_cap,action.max_execution_micro_usd::text policy_max_execution,
          workspace.organization_id::text organization_id,admission.budget_date::text budget_date,policy.budget_timezone
        FROM signal_labeling_runs run JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id
        JOIN signal_processing_policy_versions policy ON policy.id=admission.policy_version_id
        JOIN signal_processing_policy_actions action ON action.policy_version_id=policy.id AND action.action=admission.action
        JOIN signal_workspaces workspace ON workspace.id=run.workspace_id
        WHERE run.id=$1::uuid`, [context.run_id]);
      const policy = policyRow.rows[0];
      if (!policy) throw new Error("r16_policy_provenance_missing");
      const policyConfigurationDigest = r16PolicyConfigurationDigestV1({ action:String(policy.action),
        configuration:policy.configuration, configuration_digest:String(policy.configuration_digest),
        model:String(policy.model), policy_daily_cap_micro_usd:String(policy.policy_daily_cap),
        policy_digest:String(policy.policy_digest), policy_max_execution_micro_usd:String(policy.policy_max_execution),
        policy_version_id:String(policy.policy_version_id), provider:String(policy.provider) });
      assert.equal(policy.action, "mass_labeling_jev");
      assert.ok(BigInt(String(policy.execution_cap)) > 0n
        && BigInt(String(policy.execution_cap)) <= BigInt(String(policy.policy_max_execution))
        && BigInt(String(policy.execution_cap)) <= BigInt(String(policy.policy_daily_cap)));
      const candidates = (await readdir(privateRoot)).filter(name => /^fault-matrix-\d+-[a-f0-9]{8}\.json$/u.test(name)).sort();
      const newest = candidates.at(-1);
      if (!newest) throw new Error("r16_fault_matrix_missing");
      const faultMatrix = JSON.parse(await readFile(resolve(privateRoot, newest), "utf8")) as FaultMatrixV1;
      const ageMs = Date.now() - Date.parse(faultMatrix.completed_at);
      const expectedFaultCases = new Set(["429","529","raw_page_write","postgres_commit","settlement_ack_lost",
        "worker_restart_after_page","lease_expiry","lease_expiry_after_durable"]);
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 2 * 60 * 60 * 1_000
        || faultMatrix.case_count !== 8
        || faultMatrix.policy_cases.length !== 8
        || new Set(faultMatrix.policy_cases.map(item => item.case)).size !== 8
        || faultMatrix.policy_cases.some(item => !expectedFaultCases.has(item.case) || !item.admission_id || !item.policy_version_id
          || !/^sha256:[0-9a-f]{64}$/u.test(item.policy_digest)
          || !/^(0|[1-9][0-9]*)$/u.test(item.execution_cap_micro_usd)
          || !/^(0|[1-9][0-9]*)$/u.test(item.action_max_execution_micro_usd)
          || !/^(0|[1-9][0-9]*)$/u.test(item.daily_cap_micro_usd)
          || BigInt(item.execution_cap_micro_usd) <= 0n
          || BigInt(item.action_max_execution_micro_usd) < BigInt(item.execution_cap_micro_usd)
          || BigInt(item.daily_cap_micro_usd) < BigInt(item.execution_cap_micro_usd))
        || faultMatrix.postgres.system_identifier !== String(identity.rows[0]?.system_identifier)
        || JSON.stringify(faultMatrix.source_provenance) !== JSON.stringify(sourceProvenance)
        || faultMatrix.policy_configuration_digest !== policyConfigurationDigest) {
        throw new Error("r16_fault_matrix_provenance_mismatch");
      }
      const providerClient = createCalibratedJevRuntimeProviderV2({ labeler_digest: labelerDigest, execution,
        env: { NOISIA_TYPESAFE_ACCOUNT_ID: `r16-synthetic-capacity-${randomUUID()}`,
          NOISIA_TYPESAFE_ACCOUNT_RPS: "2000", NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS: "10000000",
          NOISIA_TYPESAFE_ACCOUNT_REDIS_URL: process.env.R16BENCH_REDIS_URL!,
          NOISIA_JEV_TOKEN_CALIBRATIONS_JSON: JSON.stringify({ [labelerDigest]: {
            source: "synthetic-json-utf8-quarter-token", fixed_input_tokens: 0,
            input_tokens_per_utf8_byte: 0.25, max_request_bytes: 1_048_576 } }),
          NOISIA_JEV_MAX_RESPONSE_BYTES: String(responseBound), NOISIA_JEV_PROVIDER_ENABLED: "true",
          TYPESAFE_API_KEY: "r16-synthetic-no-network-key" },
        fetch: fetchWithConcurrency });
      closeProvider = async () => {
        const close = (providerClient as typeof providerClient & { close?: () => Promise<void> }).close;
        await close?.();
      };
      const provider = {
        max_concurrency: providerClient.max_concurrency, max_response_bytes: providerClient.max_response_bytes,
        async evaluate(request: Parameters<typeof providerClient.evaluate>[0], options?: Parameters<typeof providerClient.evaluate>[1]) {
          const raw = await providerClient.evaluate(request, options);
          let usage: { input_tokens?: number; output_tokens?: number } = {};
          try { usage = JSON.parse(raw.body).usage ?? {}; } catch { /* Persist malformed response evidence unchanged. */ }
          recorder.providerResponse({ latency_ms: raw.latency_ms, http_status: raw.http_status,
            input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, retry_after_ms: raw.retry_after_ms });
          return raw;
        },
        observeUsage: providerClient.observeUsage?.bind(providerClient),
      };
      const httpStorage = createWorkspaceEngineStorageV1({ url: storageServer.base_url,
        service_role_key: "r16-synthetic-local-key", bucket: "private-r16", timeout_ms: 120_000, fetch: storageFetch });
      const baseStore = createMassLabelingRuntimeStoreV1(db as never,
        { product_v2: true, execution, storage: httpStorage });
      const store = new Proxy(baseStore, { get(target, property, receiver) {
        if (property === "apply") return async (run: Parameters<typeof target.apply>[0],
          results: Parameters<typeof target.apply>[1]) => {
          const start_ms = recorder.elapsedMs();
          const result = await target.apply(run, results);
          spans.push({ phase: "signal", start_ms, end_ms: recorder.elapsedMs(), roots: results.length });
          return result;
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const before = recorder.elapsedMs();
      let outcome = await processMassLabelingProductPageV2({ run_id: context.run_id, database: db as never,
        store, provider, execution, observe_stream: observeStream });
      if (rootCount > 1_000) {
        await continueMassLabelingV1({ database: db as never, run_id: context.run_id,
          workspace_id: context.workspace_id, actor_user_id: context.actor_user_id });
        outcome = await processMassLabelingProductPageV2({ run_id: context.run_id, database: db as never,
          store, provider, execution, observe_stream: observeStream });
      }
      const after = recorder.elapsedMs();
      await sampleProgress();
      if (sampleRootCount !== rootCount) {
        const diagnostic = await db.query(`SELECT count(*) FILTER(WHERE results_applied)::int applied,
          count(*)::int total,count(*) FILTER(WHERE status='failed')::int failed
          FROM signal_labeling_calls WHERE run_id=$1::uuid`, [context.run_id]);
        process.stderr.write(`${JSON.stringify({ pipeline_status: outcome.status, progress_roots: sampleRootCount,
          expected_roots: rootCount, call_counts: diagnostic.rows[0] })}\n`);
        throw new Error("r16_signal_progress_count_mismatch");
      }
      // A zero-root span preserves the end-to-end phase duration without
      // double-counting the per-window committed-root samples below.
      spans.push({ phase: "jev", start_ms: before, end_ms: after, roots: 0 });
      const pageRows = await db.query(`SELECT id::text page_id,storage_key,sha256,size_bytes::int,member_count,status
        FROM signal_labeling_raw_pages WHERE run_id=$1::uuid ORDER BY created_at,id`, [context.run_id]);
      const pages = pageRows.rows.map(row => ({ page_id: String(row.page_id), storage_key: String(row.storage_key),
        raw_sha256: String(row.sha256), size_bytes: Number(row.size_bytes), members: Number(row.member_count),
        verified: row.status === "verified" }));
      const counts = await db.query(`SELECT
        (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1::uuid AND status='settled' AND results_applied=true) settled,
        (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1::uuid AND status IN('reserved','submitting','submitted','unknown')) active,
        (SELECT count(*)::int FROM signal_mass_labeling_results WHERE run_id=$1::uuid) results,
        (SELECT count(*)::int FROM signal_mass_labeling_root_segments WHERE workspace_id=$2::uuid AND map_id=$3::uuid) segments,
        (SELECT count(*)::int FROM signal_labeling_raw_page_members m JOIN signal_labeling_raw_pages p ON p.id=m.page_id WHERE p.run_id=$1::uuid) members,
        (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1::uuid AND status='settled' AND raw_storage_key IS NULL) missing_receipts,
        (SELECT count(*)::int FROM (SELECT call_id FROM signal_mass_labeling_results WHERE run_id=$1::uuid GROUP BY call_id HAVING count(*)>1) duplicates) duplicate_results,
        (SELECT count(*)::int FROM signal_labeling_runs WHERE id=$1::uuid AND status='completed') completed`,
        [context.run_id, context.workspace_id, context.map_id]);
      const summary = counts.rows[0]!;
      if (Number(summary.settled) !== rootCount || Number(summary.results) !== rootCount
        || Number(summary.segments) !== rootCount || Number(summary.members) !== rootCount
        || Number(summary.active) !== 0 || Number(summary.missing_receipts) !== 0 || Number(summary.completed) !== 1) {
        throw new Error("r16_product_pipeline_invariants_failed");
      }
      const costEvidence = await db.query(`SELECT COALESCE(sum(settled_micro_usd),0)::text settled
        FROM signal_labeling_calls WHERE run_id=$1::uuid`, [context.run_id]);
      const dailyExposure = await db.query(`SELECT total_micro_usd::text exposure
        FROM signal_processing_org_exposure_v1($1::uuid,$2::date,$3::text)`,
      [policy.organization_id,policy.budget_date,policy.budget_timezone]);
      policyLimits = { execution_cap_micro_usd:String(policy.execution_cap),
        action_max_execution_micro_usd:String(policy.policy_max_execution),daily_cap_micro_usd:String(policy.policy_daily_cap),
        settled_micro_usd:String(costEvidence.rows[0]?.settled ?? "0"),
        daily_exposure_micro_usd:String(dailyExposure.rows[0]?.exposure ?? "0") };
      const disk = storageServer.metrics();
      if (disk.object_puts < pages.length || disk.object_gets < pages.length || disk.bytes_written !== disk.bytes_read) {
        throw new Error("r16_storage_readback_metrics_incomplete");
      }
      for (const page of pages) recorder.rawPage({ page_id: page.page_id, storage_key: page.storage_key,
        raw_sha256: page.raw_sha256, size_bytes: page.size_bytes, members: page.members, verified: page.verified });
      const admission = await db.query(`SELECT count(*)::int n FROM signal_processing_admissions WHERE target_id=$1::uuid AND action='mass_labeling_jev'`, [context.run_id]);
      const phaseSpans = spans;
      const measured = recorder.finish({
        source_provenance: sourceProvenance, policy_configuration_digest: policyConfigurationDigest,
        policy_limits: policyLimits!,
        postgres: { verified_version: String(identity.rows[0]?.verified_version), database_name: String(identity.rows[0]?.database_name),
          container_name: "r16-benchmark-pg17", system_identifier: String(identity.rows[0]?.system_identifier),
          loopback_binding: true, pgvector: true,
          committed_root_rows: rootCount, apply_batches: pages.length },
        signal: { materialized_root_rows: Number(summary.segments), incremental: true },
        guards: { policy_admissions: Number(admission.rows[0]?.n ?? 0), budget_admissions: Number(admission.rows[0]?.n ?? 0),
          policy_denials: faultMatrix?.guards.policy_denials ?? 0, budget_denials: faultMatrix?.guards.budget_denials ?? 0,
          denied_requests_not_sent: faultMatrix?.guards.denied_requests_not_sent ?? 0 },
        invariants: { duplicate_settlements: Number(summary.duplicate_results) + (faultMatrix?.invariants.duplicate_settlements ?? 0),
          missing_durable_receipts: Number(summary.missing_receipts), unsettled_provider_responses: Number(summary.active),
          denied_provider_requests: faultMatrix?.invariants.denied_provider_requests ?? 0,
          lost_materialized_rows: rootCount - Number(summary.segments) },
        max_buffered_bytes_allowed: execution.max_buffered_bytes,
        max_in_flight_allowed: execution.max_in_flight,
        max_flushes_allowed: execution.max_flushes,
      }, sustainedStartMs);
      evidence = { ...measured, failures: faultMatrix.failures };
      await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      const output = resolve(privateRoot, `benchmark-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
      const finalSummary = summarizeR16BenchmarkV1({ ...evidence, phases: phaseSpans });
      await writeFile(output, `${JSON.stringify({ fixture_setup_ms: fixtureSetupMs, fixture_import_batch_size: 512,
        fixture_preparation_page_size: 100, fixture_embedding_page_limit: Math.ceil(rootCount / 128) + 8,
        synthetic_provider_limits: { requests_per_second: 2_000, input_tokens_per_second: 10_000_000 },
        evidence: { ...evidence, phases: phaseSpans }, summary: finalSummary,
        measurement: { sql: { ...sqlMetrics }, storage: disk, max_in_flight_observed: maxInFlight } }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      process.stdout.write(`${JSON.stringify({ evidence_path_private: output, fixture_setup_ms: fixtureSetupMs,
        fixture_import_batch_size: 512, fixture_preparation_page_size: 100,
        fixture_embedding_page_limit: Math.ceil(rootCount / 128) + 8,
        summary: finalSummary, sql: sqlMetrics, storage: disk,
        max_in_flight_observed: maxInFlight })}\n`);
      if (!finalSummary.accepted) process.exitCode = 1;
    },
  } });
} finally {
  if (sampleTimer) clearInterval(sampleTimer);
  await Promise.all([storageServer.close(), closeProvider()]);
  await rm(objectRoot, { recursive: true, force: true });
}

if (!evidence) throw new Error("r16_benchmark_evidence_missing");
