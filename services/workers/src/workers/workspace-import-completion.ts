import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

type Database = Pick<Pool, "query" | "connect">;
type Stats = { record_count: number; included_count: number; excluded_count: number; duplicate_count: number };
export type WorkspaceImportClosureRequest = {
  workspaceId: string;
  dataSourceId: string;
  importBatchId: string;
  workerJobId: string;
  fileHash: string;
  verifiedHash: string;
  verifiedBytes: number;
  expectedBytes: number;
  processedBytes: number;
  progressRecords: number;
  stats: Stats;
};
type Completion = { import_batch_id: string; accepted: boolean; accepted_batch_id: string };
type Result = { rows: Completion[]; replayed: boolean; transactional: boolean };
type Options = {
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  reconciliationRetryDelayMs?: number;
  operationTimeoutMs?: number;
  completionGraceMs?: number;
};
type DurableBatch = {
  status: string;
  source_file_hash: string | null;
  record_count: number | null;
  included_count: number | null;
  excluded_count: number | null;
  duplicate_count: number | null;
  processed_bytes: string;
  failure_code: string | null;
  failure_detail: { accepted_batch_id?: string } | null;
};
const MAX_CLOSURE_TIMEOUT_MS = 25 * 60_000;

export function workspaceImportClosureTimeoutMs(records: number) {
  if (!Number.isSafeInteger(records) || records < 0 || records > 2_147_483_647) {
    throw new Error("workspace_import_closure_count_invalid");
  }
  return records < 50_000 ? null : Math.min(MAX_CLOSURE_TIMEOUT_MS, Math.max(15 * 60_000, records * 12));
}
export class WorkspaceImportClosureReconciledError extends Error {
  constructor(options?: ErrorOptions) { super("workspace_import_closure_not_committed", options); }
}
export class WorkspaceImportClosureUnresolvedError extends Error {
  constructor(options?: ErrorOptions) { super("workspace_import_closure_reconciliation_required", options); }
}
class DatabaseResponseTimeout extends Error {
  readonly code = "WORKSPACE_IMPORT_RESPONSE_TIMEOUT";
  constructor() { super("workspace_import_database_response_timeout"); }
}
async function queryWithin<Row extends QueryResultRow = QueryResultRow>(
  client: PoolClient, sql: string, values: unknown[] | undefined, timeoutMs: number
): Promise<QueryResult<Row>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.query<Row>(sql, values),
      new Promise<QueryResult<Row>>((_, reject) => {
        timer = setTimeout(() => reject(new DatabaseResponseTimeout()), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const COMPLETION_SQL = `SELECT import_batch_id::text,accepted,accepted_batch_id::text
  FROM complete_signal_workspace_import_v1($1::uuid,$2,$3,$4,$5,$6,$7,$8)`;
const DURABLE_BATCH_SQL = `SELECT status,source_file_hash,record_count,included_count,excluded_count,
  duplicate_count,processed_bytes::text,failure_code,failure_detail FROM import_batches
  WHERE id=$1::uuid AND workspace_id=$2::uuid AND data_source_id=$3::uuid AND worker_job_id=$4`;
const errorOf = (error: unknown) => error instanceof Error ? error : new Error("workspace_import_closure_failed");

function validateProof(request: WorkspaceImportClosureRequest) {
  const budget = workspaceImportClosureTimeoutMs(request.stats.record_count);
  // CsvImportStats has these four counters. Do not inspect arbitrary extra fields.
  const counters = [request.stats.record_count, request.stats.included_count,
    request.stats.excluded_count, request.stats.duplicate_count];
  if (!/^[a-f0-9]{64}$/.test(request.fileHash) || request.fileHash !== request.verifiedHash
      || !Number.isSafeInteger(request.processedBytes) || request.processedBytes < 1
      || request.processedBytes !== request.verifiedBytes || request.processedBytes !== request.expectedBytes
      || request.progressRecords !== request.stats.record_count
      || counters.some(value => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
      || request.stats.record_count !== request.stats.included_count + request.stats.excluded_count + request.stats.duplicate_count) {
    throw new Error("workspace_import_closure_proof_invalid");
  }
  return budget;
}
function isTransient(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  return error instanceof DatabaseResponseTimeout || /^(08|ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)/.test(code)
    || ["55P03", "57014", "40P01", "40001", "57P01", "57P02", "57P03", "53300"].includes(code)
    || error instanceof Error && ["timeout exceeded when trying to connect", "Connection terminated unexpectedly",
      "Connection terminated"].includes(error.message);
}
function scopeValues(request: WorkspaceImportClosureRequest) {
  return [request.importBatchId, request.workspaceId, request.dataSourceId, request.workerJobId];
}
function matchesCompletedReceipt(batch: DurableBatch, request: WorkspaceImportClosureRequest) {
  return batch.status === "completed" && batch.source_file_hash === request.fileHash
    && batch.record_count === request.stats.record_count && batch.included_count === request.stats.included_count
    && batch.excluded_count === request.stats.excluded_count && batch.duplicate_count === request.stats.duplicate_count
    && Number(batch.processed_bytes) === request.processedBytes;
}
function replayReceipt(request: WorkspaceImportClosureRequest): Result {
  return { rows: [{ import_batch_id: request.importBatchId, accepted: true, accepted_batch_id: request.importBatchId }],
    replayed: true, transactional: true };
}

/** Only a verified large-file closure gets a dedicated, locally bounded transaction.
 * The count is the canonical parser's total, including excluded and duplicate rows.
 * No physical line counting, native FK bypass or retry of completion/COMMIT is used. */
export async function completeWorkspaceImport(
  database: Database, request: WorkspaceImportClosureRequest, options: Options = {}
): Promise<Result> {
  const budget = validateProof(request);
  const completionValues = [request.importBatchId, request.workerJobId, request.fileHash,
    request.stats.record_count, request.stats.included_count, request.stats.excluded_count,
    request.stats.duplicate_count, request.processedBytes];
  if (budget === null) {
    const result = await database.query<Completion>(COMPLETION_SQL, completionValues);
    return { rows: result.rows, replayed: false, transactional: false };
  }
  const statementTimeout = options.statementTimeoutMs ?? budget;
  const lockTimeout = options.lockTimeoutMs ?? 15_000;
  const retryDelay = options.reconciliationRetryDelayMs ?? 250;
  const operationTimeout = options.operationTimeoutMs ?? 35_000;
  const completionGrace = options.completionGraceMs ?? 30_000;
  if (!Number.isSafeInteger(statementTimeout) || statementTimeout < 1 || statementTimeout > MAX_CLOSURE_TIMEOUT_MS
      || !Number.isSafeInteger(lockTimeout) || lockTimeout < 1 || lockTimeout > 15_000
      || !Number.isSafeInteger(retryDelay) || retryDelay < 0 || retryDelay > 1000
      || !Number.isSafeInteger(operationTimeout) || operationTimeout < 1 || operationTimeout > 35_000
      || !Number.isSafeInteger(completionGrace) || completionGrace < 1 || completionGrace > 30_000) {
    throw new Error("workspace_import_closure_budget_invalid");
  }

  const client = await database.connect();
  let phase: "before-completion" | "completion-sent" | "commit-sent" | "committed" = "before-completion";
  let begun = false;
  let released = false;
  let releaseError: Error | undefined;
  let receipt: Completion[] = [];
  try {
    await queryWithin(client, "BEGIN", undefined, operationTimeout);
    begun = true;
    await queryWithin(client, "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
      [`${statementTimeout}ms`, `${lockTimeout}ms`], operationTimeout);
    // Match the native function's batch advisory -> row order, including when
    // another completion/recovery is already operating on this same batch.
    await queryWithin(client, "SELECT pg_advisory_xact_lock(hashtextextended('workspace-import:'||$1::text,0))",
      [request.importBatchId], operationTimeout);
    const target = (await queryWithin<DurableBatch>(client, `${DURABLE_BATCH_SQL} FOR UPDATE`,
      scopeValues(request), operationTimeout)).rows[0];
    if (!target) throw new WorkspaceImportClosureUnresolvedError({ cause: new Error("workspace_import_closure_scope_invalid") });
    const replayed = matchesCompletedReceipt(target, request);
    if (target.status === "completed" && !replayed) {
      throw new WorkspaceImportClosureUnresolvedError({ cause: new Error("workspace_import_closure_receipt_invalid") });
    }
    if (replayed) {
      receipt = replayReceipt(request).rows;
    } else {
      phase = "completion-sent";
      receipt = (await queryWithin<Completion>(client, COMPLETION_SQL, completionValues, statementTimeout + completionGrace)).rows;
      if (receipt.length !== 1 || receipt[0]?.import_batch_id !== request.importBatchId) {
        throw new Error("workspace_import_closure_receipt_invalid");
      }
    }
    phase = "commit-sent";
    await queryWithin(client, "COMMIT", undefined, operationTimeout);
    phase = "committed";
    return { rows: receipt, replayed, transactional: true };
  } catch (error) {
    releaseError = errorOf(error);
    if (phase === "commit-sent" || error instanceof DatabaseResponseTimeout) {
      client.release(releaseError);
      released = true;
      return await reconcileCommit(database, request, receipt, retryDelay, operationTimeout);
    }
    let rolledBack = !begun;
    if (begun) {
      try {
        await queryWithin(client, "ROLLBACK", undefined, operationTimeout);
        rolledBack = true;
      } catch {
        // Destroy this connection before opening the reconciliation fence.
      }
    }
    if (!rolledBack) {
      client.release(releaseError);
      released = true;
      return await reconcileCommit(database, request, receipt, retryDelay, operationTimeout);
    }
    throw error;
  } finally {
    if (!released) client.release(releaseError);
  }
}

async function reconcileCommit(
  database: Database, request: WorkspaceImportClosureRequest, receipt: Completion[], retryDelay: number, operationTimeout: number
): Promise<Result> {
  for (;;) {
    let client: PoolClient | undefined;
    let releaseError: Error | undefined;
    let durableBatch: DurableBatch | undefined;
    try {
      client = await database.connect();
      await queryWithin(client, "BEGIN", undefined, operationTimeout);
      await queryWithin(client, "SELECT set_config('statement_timeout','30000ms',true),set_config('lock_timeout','15000ms',true)",
        undefined, operationTimeout);
      const target = (await queryWithin<DurableBatch>(client, `${DURABLE_BATCH_SQL} FOR UPDATE`,
        scopeValues(request), operationTimeout)).rows[0];
      if (!target) throw new WorkspaceImportClosureUnresolvedError({ cause: new Error("workspace_import_closure_scope_invalid") });
      // The existing CAS waits for the original row lock. Completed is a no-op;
      // an aborted closure becomes failed and can use the existing UI recovery.
      await queryWithin(client, `SELECT fail_signal_workspace_import_v1($1::uuid,$2,'closure_commit_unconfirmed',
        '{"recoverable":true,"kind":"closure_commit_unconfirmed"}'::jsonb,$3,$4)`,
        [request.importBatchId, request.workerJobId, request.stats.record_count, request.processedBytes], operationTimeout);
      durableBatch = (await queryWithin<DurableBatch>(client, DURABLE_BATCH_SQL, scopeValues(request), operationTimeout)).rows[0];
      await queryWithin(client, "COMMIT", undefined, operationTimeout);
    } catch (error) {
      releaseError = errorOf(error);
      if (client && !(error instanceof DatabaseResponseTimeout)) {
        await queryWithin(client, "ROLLBACK", undefined, operationTimeout).catch(() => undefined);
      }
      if (!isTransient(error)) throw new WorkspaceImportClosureUnresolvedError({ cause: error });
      // Retry only the idempotent CAS/read. A transient lock/transport timeout
      // must not strand processing on a BullMQ job configured with attempts=1.
      continue;
    } finally {
      client?.release(releaseError);
      if (releaseError && isTransient(releaseError)) await delay(retryDelay);
    }
    if (durableBatch && matchesCompletedReceipt(durableBatch, request)) return replayReceipt(request);
    if (durableBatch?.status === "failed" && durableBatch.failure_code === "content_already_accepted"
        && receipt[0]?.accepted === false && durableBatch.failure_detail?.accepted_batch_id === receipt[0].accepted_batch_id) {
      return { rows: receipt, replayed: true, transactional: true };
    }
    if (durableBatch?.status === "failed") throw new WorkspaceImportClosureReconciledError();
    throw new WorkspaceImportClosureUnresolvedError();
  }
}
