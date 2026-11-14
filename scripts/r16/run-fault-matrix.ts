import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMassLabelingAcceptanceFixtureV1 } from '../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import { massLabelingJevIdentityV1 } from '../../packages/query-engine/src/signal-mass-labeling-jev-v1';
import { requestMassLabelingV1 } from '../../infrastructure/db/signal-mass-labeling';
import { createCalibratedJevRuntimeProviderV2 } from '../../services/workers/src/providers/jev-streaming-runtime';
import { createMassLabelingRuntimeStoreV1, processMassLabelingProductPageV2 } from '../../services/workers/src/workers/signal-mass-labeling-jev';
import { createWorkspaceEngineStorageV1 } from '../../services/workers/src/workers/signal-workspace-engine-storage';
import { startR16HttpFilesystemStorageV1 } from './http-filesystem-storage';
import { createSyntheticJevFetchV1, deterministicR16LatencyV1 } from './synthetic-jev';
import type { R16BenchmarkEvidenceV1 } from './benchmark-contract';

type Db = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
type Case = '429' | '529' | 'raw_page_write' | 'postgres_commit' | 'settlement_ack_lost'
  | 'worker_restart_after_page' | 'lease_expiry' | 'lease_expiry_after_durable';
const allCases: Case[] = ['429', '529', 'raw_page_write', 'postgres_commit', 'settlement_ack_lost',
  'worker_restart_after_page', 'lease_expiry', 'lease_expiry_after_durable'];
const requestedCases = process.env.R16_FAULT_MATRIX_CASE?.split(',').map(value => value.trim()).filter(Boolean);
const cases = requestedCases ? allCases.filter(kind => requestedCases.includes(kind)) : allCases;
if (!cases.length) throw new Error('r16_fault_matrix_case_invalid');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = resolve(repo, '.data/piloto-masivo/r16');
const connectionPath = resolve(privateRoot, 'labs/benchmark-pg17/connection.env');
async function loadPrivateEnv(path: string): Promise<Record<string, string>> {
  const content = await readFile(path, 'utf8');
  return Object.fromEntries(content.split(/\r?\n/u).map(line => /^([A-Z0-9_]+)=(.*)$/u.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match)).map(match => [match[1]!, match[2]!.replace(/^(?:"|')(.*)(?:"|')$/u, '$1')]));
}
const pgEnv = await loadPrivateEnv(connectionPath);
if (process.env.R16BENCH_RUN_ID !== 'benchmark-pg17' || !process.env.DATABASE_URL
  || process.env.NOISIA_R16_LOCAL_PG_LAB !== 'r16-benchmark-pg17' || process.env.NOISIA_R16_NATIVE_FIXTURE_PG !== 'true') {
  throw new Error('r16_fault_matrix_owned_lab_required');
}
const redisUrl = process.env.R16BENCH_REDIS_URL ?? (await loadPrivateEnv(
  process.env.R16BENCH_REDIS_ENV_PATH ?? resolve(privateRoot, 'labs/r16-lab-nov14/connection.env'))).R16BENCH_REDIS_URL;
if (!redisUrl || !/^redis:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/\d*)?$/u.test(redisUrl)) throw new Error('r16_fault_matrix_loopback_redis_required');
const objectRoot = await mkdtemp(join(privateRoot, 'fault-objects-'));
const storageServer = await startR16HttpFilesystemStorageV1(objectRoot);
const providerClosers: Array<() => Promise<void>> = [];
const results: R16BenchmarkEvidenceV1['failures'] = [];
const runIds: string[] = [];
let systemIdentifier = '';
let policyDenials = 0, budgetDenials = 0, deniedRequestsNotSent = 0, deniedProviderRequests = 0;
let duplicateSettlements = 0;

function assertNoReplay(requests: string[]): number {
  const counts = new Map<string, number>();
  for (const body of requests) counts.set(body, (counts.get(body) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

async function runCase(kind: Case): Promise<void> {
  await runMassLabelingAcceptanceFixtureV1('product', { beforeProcessing: async context => {
    const database = context.database as unknown as Db;
    runIds.push(context.run_id);
    const identityRow = await database.query(`SELECT current_database() database_name,
      (SELECT system_identifier::text FROM pg_control_system()) system_identifier,
      admission.execution_cap_micro_usd::text execution_cap,admission.provider,admission.model,admission.configuration
      FROM signal_labeling_runs run JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id
      WHERE run.id=$1::uuid`, [context.run_id]);
    const identity = identityRow.rows[0]!;
    assert.match(String(identity.database_name), /^noisia_mfp_recovery_[a-f0-9]{32}$/u);
    assert.ok(identity.system_identifier);
    if (systemIdentifier) assert.equal(String(identity.system_identifier), systemIdentifier);
    else systemIdentifier = String(identity.system_identifier);

    const physicalBodies: string[] = [];
    const physicalStatuses: number[] = [];
    const physicalRetryAfter: number[] = [];
    const fetchLog: Array<{ index: number; request_digest: string | null; http_status?: number }> = [];
    let expiryInjected = false;
    const syntheticFetch = createSyntheticJevFetchV1({
      latencyForRequest: deterministicR16LatencyV1,
      responseForRequest: index => kind === '429' && index === 0 ? { status: 429, retry_after_ms: 1_000 }
        : kind === '529' && index === 0 ? { status: 529, retry_after_ms: 1_000 } : { status: 200 },
      onRequest: async ({ index, body }) => {
        physicalBodies.push(body);
        let request_digest: string | null = null;
        try {
          const request = body;
          const matched = await database.query(`SELECT request_digest FROM signal_labeling_calls
            WHERE run_id=$1::uuid AND request=$2::jsonb LIMIT 1`, [context.run_id, request]);
          request_digest = matched.rows[0] ? String(matched.rows[0].request_digest) : null;
        } catch { /* Keep a null mapping if serialization differs; the body remains synthetic. */ }
        fetchLog.push({ index, request_digest });
        if (kind === 'lease_expiry' && !expiryInjected) {
          expiryInjected = true;
          await database.query(`UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second'
            WHERE id=$1::uuid`, [context.run_id]);
        }
      },
    });
    const digest = String((await database.query(`SELECT labeler.labeler_digest FROM signal_labeling_runs run
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id WHERE run.id=$1::uuid`, [context.run_id])).rows[0]?.labeler_digest);
    const execution = { max_in_flight: 1, flush_size: 1, max_flushes: 1, max_buffered_bytes: 4 * 1024 * 1024,
      flush_interval_ms: 10, window_size: 3 };
    const responseBound = 16 * 1024;
    const providerClient = createCalibratedJevRuntimeProviderV2({ labeler_digest: digest, execution,
      env: { NOISIA_TYPESAFE_ACCOUNT_ID: `r16-fault-${randomUUID()}`, NOISIA_TYPESAFE_ACCOUNT_RPS: '2000',
        NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS: '10000000', NOISIA_TYPESAFE_ACCOUNT_REDIS_URL: redisUrl,
        NOISIA_JEV_TOKEN_CALIBRATIONS_JSON: JSON.stringify({ [digest]: {
          source: 'synthetic-json-utf8-quarter-token', fixed_input_tokens: 0, input_tokens_per_utf8_byte: 0.25, max_request_bytes: 1_048_576 } }),
        NOISIA_JEV_MAX_RESPONSE_BYTES: String(responseBound), NOISIA_JEV_PROVIDER_ENABLED: 'true', TYPESAFE_API_KEY: 'synthetic-no-network-key' },
      fetch: syntheticFetch });
    providerClosers.push(async () => {
      const close = (providerClient as typeof providerClient & { close?: () => Promise<void> }).close;
      await close?.();
    });
    const provider = { max_concurrency: providerClient.max_concurrency, max_response_bytes: providerClient.max_response_bytes,
      async evaluate(request: Parameters<typeof providerClient.evaluate>[0], options?: Parameters<typeof providerClient.evaluate>[1]) {
        const response = await providerClient.evaluate(request, options);
        physicalStatuses.push(response.http_status);
        if (response.retry_after_ms !== undefined) physicalRetryAfter.push(response.retry_after_ms);
        return response;
      }, observeUsage: providerClient.observeUsage?.bind(providerClient) };

    const storage = createWorkspaceEngineStorageV1({ url: storageServer.base_url, service_role_key: 'r16-fault-synthetic-key',
      bucket: 'private-r16-fault', timeout_ms: 120_000 });
    let storageAckLost = false;
    const storageWithFault = new Proxy(storage, { get(target, property, receiver) {
      if (property === 'put' && kind === 'raw_page_write') return async (...args: Parameters<typeof target.put>) => {
        const receipt = await target.put(...args);
        if (!storageAckLost) { storageAckLost = true; throw new Error('r16_synthetic_storage_put_ack_lost'); }
        return receipt;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const baseStore = createMassLabelingRuntimeStoreV1(database as never, { product_v2: true, execution, storage: storageWithFault });
    const storeFaults = { apply: false, settlePage: false, persistRawPage: false };
    const store = new Proxy(baseStore, { get(target, property, receiver) {
      const fault = property === 'apply' && ['postgres_commit', 'lease_expiry_after_durable'].includes(kind) ? 'apply'
        : property === 'settlePage' && kind === 'settlement_ack_lost' ? 'settlePage'
        : property === 'persistRawPage' && kind === 'worker_restart_after_page' ? 'persistRawPage' : undefined;
      if (fault) return async (...args: never[]) => {
        if (kind === 'lease_expiry_after_durable' && !expiryInjected) {
          expiryInjected = true;
          await database.query(`UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second'
            WHERE id=$1::uuid`, [context.run_id]);
          return (target[fault] as (...input: never[]) => Promise<unknown>).apply(target, args);
        }
        const result = await (target[fault] as (...input: never[]) => Promise<unknown>).apply(target, args);
        if (!storeFaults[fault]) { storeFaults[fault] = true; throw new Error(`r16_synthetic_${fault}_ack_lost`); }
        return result;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });

    if (kind === '429') {
      const before = physicalBodies.length;
      await assert.rejects(requestMassLabelingV1({ database: database as never, workspace_id: context.workspace_id,
        actor_user_id: randomUUID(), map_id: context.map_id, idempotency_key: randomUUID(), identity: massLabelingJevIdentityV1(),
        provider_available: true, cap_micro_usd: 1_000_000 }));
      const delta = physicalBodies.length - before;
      assert.equal(delta, 0); policyDenials++; deniedRequestsNotSent++;
      if (delta !== 0) deniedProviderRequests += delta;
      const beforeBudget = physicalBodies.length;
      await assert.rejects(database.query(`SELECT signal_processing_capacity_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,
          ARRAY['mass_labeling_jev']::text[],$5::text,$6::text,$7::jsonb,$8::bigint)`,
      [context.workspace_id, context.actor_user_id, context.run_id, context.run_id, identity.provider, identity.model,
        JSON.stringify(identity.configuration), Number(identity.execution_cap) + 1]));
      const budgetDelta = physicalBodies.length - beforeBudget;
      assert.equal(budgetDelta, 0); budgetDenials++; deniedRequestsNotSent++;
      if (budgetDelta !== 0) deniedProviderRequests += budgetDelta;
    }

    const invoke = async () => processMassLabelingProductPageV2({ run_id: context.run_id, database: database as never,
      store, provider, execution, lease_renewal_ms: 60_000 });
    const callSnapshot = async () => database.query(`SELECT id,request_digest,status,results_applied,usage,
        settled_micro_usd,reserved_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,stop_reason,
        results->0->>'status' result_status
      FROM signal_labeling_calls WHERE run_id=$1::uuid ORDER BY created_at,id`, [context.run_id]);
    let firstAttemptError: string | null = null;
    let firstOutcome: { status?: string } | undefined;
    try { firstOutcome = await invoke(); } catch (error) {
      firstAttemptError = error instanceof Error ? error.stack ?? error.message : 'unknown';
    }
    const tracedKinds = ['raw_page_write', 'postgres_commit', 'settlement_ack_lost', 'lease_expiry', 'lease_expiry_after_durable'];
    const afterFirstAttempt = tracedKinds.includes(kind) ? await callSnapshot() : undefined;
    const requestCountAfterFirst = physicalBodies.length;
    if (!['429', '529'].includes(kind)) {
      let recovered: { status?: string } | undefined;
      try { recovered = await invoke(); } catch (error) {
        process.stderr.write(`${kind} recovery_attempt_error=${error instanceof Error ? error.message : 'unknown'}\n`);
      }
      const afterRecoveryAttempt = tracedKinds.includes(kind) ? await callSnapshot() : undefined;
      if (afterFirstAttempt || afterRecoveryAttempt) {
        const diagnosticPath = resolve(privateRoot, `fault-trace-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
        await mkdir(privateRoot, { recursive: true, mode: 0o700 });
        await writeFile(diagnosticPath, `${JSON.stringify({ stage: kind, first_attempt_error: firstAttemptError,
          after_first_attempt: afterFirstAttempt?.rows, after_recovery_attempt: afterRecoveryAttempt?.rows,
          fetch_log: fetchLog, storage_ack_lost: storageAckLost, provider_http_statuses: physicalStatuses }, null, 2)}\n`,
        { mode: 0o600, flag: 'wx' });
      }
      const summary = await database.query(`SELECT run.status,run.error_code,
          count(call.id)::int calls,count(*) FILTER(WHERE call.status='settled' AND call.results_applied)::int settled,
          count(*) FILTER(WHERE call.status='unknown')::int unknown,
          count(*) FILTER(WHERE call.results_applied)::int applied,
          count(*) FILTER(WHERE call.raw_storage_key IS NOT NULL)::int durable,
          count(*) FILTER(WHERE call.settled_micro_usd IS NULL AND call.status='settled')::int unsettled,
          (SELECT count(*)::int FROM signal_mass_labeling_results result WHERE result.run_id=run.id) results,
          (SELECT count(*)::int FROM signal_mass_labeling_root_segments segment WHERE segment.workspace_id=run.workspace_id
            AND segment.map_id=$2::uuid) segments,
          (SELECT count(*)::int FROM (SELECT call_id FROM signal_mass_labeling_results WHERE run_id=run.id
            GROUP BY call_id HAVING count(*)>1) duplicate_call_results) duplicate_calls
        FROM signal_labeling_runs run LEFT JOIN signal_labeling_calls call ON call.run_id=run.id
        WHERE run.id=$1::uuid GROUP BY run.id`, [context.run_id, context.map_id]);
      const row = summary.rows[0]!;
      if (kind === 'lease_expiry') {
        assert.equal(row.status, 'failed', 'an unreceipted response after lease loss remains unresolved');
        assert.equal(row.error_code, 'labeling_outcome_unknown');
        assert.equal(Number(row.calls), 3);
        assert.equal(physicalBodies.length, requestCountAfterFirst, 'lease-loss recovery must not retry unresolved provider sends');
        assert.equal(Number(row.unknown), physicalBodies.length);
        assert.ok(physicalBodies.length > 0 && physicalBodies.length < 3);
        const unknown = await database.query(`SELECT count(*)::int calls,
            count(*) FILTER(WHERE raw_storage_key IS NULL AND raw_sha256 IS NULL)::int without_receipt,
            count(*) FILTER(WHERE results_applied)::int applied,
            count(*) FILTER(WHERE settled_micro_usd IS NULL AND reserved_micro_usd>0)::int reserved
          FROM signal_labeling_calls WHERE run_id=$1::uuid AND status='unknown'`, [context.run_id]);
        assert.equal(Number(unknown.rows[0]?.calls), physicalBodies.length);
        assert.equal(Number(unknown.rows[0]?.without_receipt), physicalBodies.length);
        assert.equal(Number(unknown.rows[0]?.applied), 0);
        assert.equal(Number(unknown.rows[0]?.reserved), physicalBodies.length);
        assert.equal(assertNoReplay(physicalBodies), 0);
        assert.equal(expiryInjected, true);
        results.push({ stage:'worker',kind,outcome:'contained_unknown',physical_replays:0,
          raw_page_durable:false,technical_result_applied:false,settlement_absent:true,reservation_preserved:true });
        return;
      }
      assert.equal(row.status, 'completed', `${kind} must resume to completed: ${String(row.error_code)}`);
      assert.equal(Number(row.calls), 3, `${kind} call count snapshot: ${JSON.stringify({ row, provider_requests: physicalBodies.length, status_codes: physicalStatuses })}`);
      assert.equal(Number(row.settled), 3, `${kind} settled snapshot: ${JSON.stringify({ row, provider_requests: physicalBodies.length, status_codes: physicalStatuses })}`);
      assert.equal(Number(row.unknown), 0);
      assert.equal(Number(row.applied), 3); assert.equal(Number(row.durable), 3); assert.equal(Number(row.results), 3);
      assert.equal(Number(row.segments), 3); assert.equal(Number(row.unsettled), 0);
      assert.equal(assertNoReplay(physicalBodies), 0, `${kind} must not resend a physical request`);
      duplicateSettlements += Number(row.duplicate_calls);
      if (kind === 'raw_page_write') assert.equal(storageAckLost, true);
      if (kind === 'postgres_commit') assert.equal(storeFaults.apply, true);
      if (kind === 'settlement_ack_lost') assert.equal(storeFaults.settlePage, true);
      if (kind === 'worker_restart_after_page') assert.equal(storeFaults.persistRawPage, true);
      if (kind === 'lease_expiry_after_durable') assert.equal(expiryInjected, true);
      results.push({ stage: kind === 'raw_page_write' ? 'storage' : kind === 'lease_expiry_after_durable' || kind === 'worker_restart_after_page'
        ? 'worker' : 'database', kind, outcome: 'recovered', physical_replays: assertNoReplay(physicalBodies) });
      void firstOutcome; void recovered;
    } else {
      const failed = await database.query(`SELECT run.status,run.error_code,
          count(call.id)::int calls,count(*) FILTER(WHERE call.status='unknown')::int unknown,
          count(*) FILTER(WHERE call.status='unknown' AND call.results_applied AND call.raw_storage_key IS NOT NULL)::int durable_applied,
          count(*) FILTER(WHERE call.status='unknown' AND call.settled_micro_usd IS NULL AND call.reserved_micro_usd>0)::int reserved_unknown,
          count(*) FILTER(WHERE call.status='unknown' AND call.results->0->>'status'='error')::int technical
        FROM signal_labeling_runs run LEFT JOIN signal_labeling_calls call ON call.run_id=run.id
        WHERE run.id=$1::uuid GROUP BY run.id`, [context.run_id]);
      const row = failed.rows[0]!;
      assert.equal(Number(row.unknown), 1, `${kind} must preserve its ambiguous provider response`);
      assert.equal(Number(row.durable_applied), 1); assert.equal(Number(row.reserved_unknown), 1); assert.equal(Number(row.technical), 1);
      const physicalReplays = assertNoReplay(physicalBodies);
      assert.equal(physicalReplays, 0);
      const retryAfter = physicalRetryAfter.find(value => value > 0);
      assert.ok(retryAfter && physicalStatuses.includes(Number(kind)));
      results.push({ stage: 'provider', kind, outcome: 'contained_unknown', retry_after_ms: retryAfter,
        physical_replays: physicalReplays, raw_page_durable: true, technical_result_applied: true,
        settlement_absent: true, reservation_preserved: true });
      void firstOutcome;
    }
  } });
}

try {
  for (const kind of cases) await runCase(kind);
  assert.equal(results.length, cases.length);
  assert.equal(deniedProviderRequests, 0);
  if (requestedCases) {
    process.stdout.write(`${JSON.stringify({ diagnostic_subset: true, cases: results.length,
      requested_cases: cases, denied_provider_requests: deniedProviderRequests })}\n`);
  } else {
  const output = resolve(privateRoot, `fault-matrix-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  const receipt = { completed_at: new Date().toISOString(), postgres: { system_identifier: systemIdentifier },
    failures: results, guards: { policy_denials: policyDenials, budget_denials: budgetDenials,
      denied_requests_not_sent: deniedRequestsNotSent },
    invariants: { duplicate_settlements: duplicateSettlements, denied_provider_requests: deniedProviderRequests } };
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ fault_matrix_path_private: output, cases: results.length,
    policy_denials: policyDenials, budget_denials: budgetDenials, denied_provider_requests: deniedProviderRequests })}\n`);
  }
} finally {
  await Promise.all([storageServer.close(), ...providerClosers.map(close => close())]);
  await rm(objectRoot, { recursive: true, force: true });
}
