import { randomUUID } from "node:crypto";
import {
  SIGNAL_WORKSPACE_CORPUS_PREPARATION_CONTRACT_V1,
  SIGNAL_CORPUS_CHUNK_POLICY_V1,
  SignalWorkspaceCorpusPreparationError,
  type SignalWorkspaceCorpusPreparationCountsV1,
  type SignalWorkspaceCorpusPreparationDatabaseV1,
  type SignalWorkspaceCorpusPreparationQueryableV1,
  type SignalWorkspaceCorpusPreparationRunV1,
  type SignalWorkspaceCorpusPreparationStatusV1
} from "./signal-workspace-corpus-preparation";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

const retryableErrors = new Set(["corpus_preparation_worker_failed", "corpus_preparation_queue_unavailable"]);
export function isSignalCorpusPreparationRetryableV1(status: string, code: string | null) {
  return status === "failed" && code !== null && retryableErrors.has(code);
}
const countKeys: Array<keyof SignalWorkspaceCorpusPreparationCountsV1> = [
  "total_roots", "processed_roots", "eligible_roots", "excluded_roots", "rights_blocked_roots",
  "missing_text_roots", "inclusion_pending_roots", "reused_roots", "new_roots", "changed_roots", "removed_roots", "chunk_count"
];
type RunRow = Record<string, unknown> & { id: string; status: SignalWorkspaceCorpusPreparationRunV1["status"];
  phase: SignalWorkspaceCorpusPreparationRunV1["phase"]; error_code: string | null };

function count(value: unknown) {
  const number = Number(value);
  if ((typeof value !== "string" && typeof value !== "number") || !Number.isSafeInteger(number) || number < 0) {
    throw new Error("corpus_preparation_count_invalid");
  }
  return number;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) {
    throw new Error("corpus_preparation_timestamp_invalid");
  }
  return value;
}
function runView(row: RunRow | null): SignalWorkspaceCorpusPreparationRunV1 | null {
  if (!row) return null;
  if (!row.counts || typeof row.counts !== "object" || Array.isArray(row.counts)) throw new Error("corpus_preparation_count_invalid");
  const counts = row.counts as Record<string, unknown>;
  const beforeSnapshot = row.phase === "queued" || row.phase === "snapshotting";
  const normalized = Object.fromEntries(countKeys.map(key => [key,
    count(beforeSnapshot && counts[key] === undefined ? 0 : counts[key])])) as SignalWorkspaceCorpusPreparationCountsV1;
  if (normalized.processed_roots > normalized.total_roots || normalized.eligible_roots > normalized.total_roots
    || (row.status === "completed" && normalized.processed_roots !== normalized.total_roots)
    || (!beforeSnapshot && normalized.eligible_roots + normalized.excluded_roots + normalized.rights_blocked_roots
      + normalized.missing_text_roots + normalized.inclusion_pending_roots !== normalized.total_roots)
    || (!beforeSnapshot && normalized.new_roots + normalized.changed_roots + normalized.reused_roots !== normalized.total_roots)) {
    throw new Error("corpus_preparation_count_invalid");
  }
  return {
    id: row.id, status: row.status, phase: row.phase,
    input_revision: row.input_revision === null ? null : count(row.input_revision),
    counts: normalized, error_code: row.error_code,
    retryable: isSignalCorpusPreparationRetryableV1(row.status, row.error_code),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    completed_at: row.completed_at === null ? null : timestamp(row.completed_at)
  };
}

/** One cheap MVCC read: no mention scans, raw text, assets, or request keys in the DTO. */
export async function loadSignalWorkspaceCorpusPreparationStoreV1(args: {
  queryable: SignalWorkspaceCorpusPreparationQueryableV1; workspace_id: string;
}): Promise<SignalWorkspaceCorpusPreparationStatusV1> {
  const result = await args.queryable.query<{
    observed_at: string; input_revision: string; active_run: RunRow | null;
    latest_run: RunRow | null; latest_completed: RunRow | null; is_current: boolean;
  }>(`
    WITH recent AS MATERIALIZED (
      SELECT run.id,run.status,run.phase,run.input_revision,run.counts,run.error_code,
        run.policy_valid_until,run.chunk_policy_version,
        to_char(run.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
        to_char(run.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at,
        to_char(run.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') completed_at
      FROM signal_corpus_preparation_runs run
      WHERE run.workspace_id=$1::uuid AND run.id IN (
        (SELECT id FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid
          ORDER BY created_at DESC,id DESC LIMIT 1),
        (SELECT id FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid AND status IN('queued','running') LIMIT 1),
        (SELECT id FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid AND status='completed'
          ORDER BY completed_at DESC,id DESC LIMIT 1)
      )
    ), completed AS (SELECT * FROM recent WHERE status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1)
    SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
      COALESCE(state.input_revision,0)::text input_revision,
      (SELECT to_jsonb(run) FROM recent run WHERE status IN('queued','running') LIMIT 1) active_run,
      (SELECT to_jsonb(run) FROM recent run ORDER BY created_at DESC,id DESC LIMIT 1) latest_run,
      (SELECT to_jsonb(run) FROM completed run) latest_completed,
      COALESCE((SELECT input_revision=state.input_revision AND chunk_policy_version=$2
        AND (policy_valid_until IS NULL OR policy_valid_until>statement_timestamp()) FROM completed),false) is_current
    FROM signal_workspaces workspace LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=workspace.id
    WHERE workspace.id=$1::uuid
  `, [args.workspace_id, SIGNAL_CORPUS_CHUNK_POLICY_V1]);
  const row = result.rows[0];
  if (!row) throw new SignalWorkspaceCorpusPreparationError("corpus_preparation_workspace_unavailable", 404);
  return {
    contract_version: SIGNAL_WORKSPACE_CORPUS_PREPARATION_CONTRACT_V1,
    workspace_id: args.workspace_id, observed_at: timestamp(row.observed_at), input_revision: count(row.input_revision),
    active_run: runView(row.active_run), latest_run: runView(row.latest_run), latest_completed: runView(row.latest_completed),
    is_current: row.is_current, needs_preparation: !row.is_current
  };
}

/** Creates only the durable intent; snapshotting and processing belong to the Worker. */
export async function requestSignalWorkspaceCorpusPreparationStoreV1(args: {
  database: SignalWorkspaceCorpusPreparationDatabaseV1; workspace_id: string;
  actor_user_id: string; idempotency_key: string;
}): Promise<{ run_id: string; replayed: boolean }> {
  if (args.idempotency_key.length < 8 || args.idempotency_key.length > 200) {
    throw new SignalWorkspaceCorpusPreparationError("corpus_preparation_idempotency_key_required", 400);
  }
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    if (!capabilities.can_view || !capabilities.can_import_mentions) {
      throw new SignalWorkspaceCorpusPreparationError("corpus_preparation_forbidden", 403);
    }
    await client.query(`INSERT INTO signal_corpus_preparation_input_state(workspace_id,opted_in_at)
      VALUES($1::uuid,clock_timestamp()) ON CONFLICT(workspace_id) DO UPDATE
      SET opted_in_at=COALESCE(signal_corpus_preparation_input_state.opted_in_at,EXCLUDED.opted_in_at)`, [args.workspace_id]);
    await client.query(`SELECT workspace_id FROM signal_corpus_preparation_input_state
      WHERE workspace_id=$1::uuid FOR UPDATE`, [args.workspace_id]);
    const replay = (await client.query<{ id: string; actor: string }>(`
      SELECT id::text,request_keys->>$2 actor FROM signal_corpus_preparation_runs
      WHERE workspace_id=$1::uuid AND request_keys ? $2 LIMIT 1
    `, [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) {
      if (replay.actor !== args.actor_user_id) {
        throw new SignalWorkspaceCorpusPreparationError("corpus_preparation_idempotency_conflict", 409);
      }
      await client.query("COMMIT");
      return { run_id: replay.id, replayed: true };
    }
    const existing = (await client.query<{ id: string; status: string; error_code: string | null; resumable: boolean }>(`
      SELECT run.id::text,run.status,run.error_code,
        (run.input_revision=state.input_revision AND run.chunk_policy_version=$2
          AND (run.policy_valid_until IS NULL OR run.policy_valid_until>statement_timestamp())) resumable
      FROM signal_corpus_preparation_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      WHERE workspace_id=$1::uuid
      ORDER BY (run.status IN('queued','running')) DESC,run.created_at DESC,run.id DESC LIMIT 1
      FOR UPDATE OF run
    `, [args.workspace_id, SIGNAL_CORPUS_CHUNK_POLICY_V1])).rows[0];
    const active = existing && ["queued", "running"].includes(existing.status);
    const complete = existing?.status === "completed" && existing.resumable;
    const resume = existing && isSignalCorpusPreparationRetryableV1(existing.status, existing.error_code) && existing.resumable;
    if (existing && (active || complete || resume)) {
      await client.query(`UPDATE signal_corpus_preparation_runs SET
        request_keys=request_keys||jsonb_build_object($2::text,$3::text),updated_at=clock_timestamp()
        WHERE id=$1::uuid`, [existing.id, args.idempotency_key, args.actor_user_id]);
      if (resume) await client.query(`UPDATE signal_corpus_preparation_runs SET status='queued',
        actor_user_id=$2::uuid,error_code=NULL,completed_at=NULL,
        dispatch_generation=dispatch_generation+1,
        worker_job_id='corpus-preparation-'||id::text||'-'||(dispatch_generation+1)::text,
        dispatch_status='pending',dispatch_token=NULL,dispatch_expires_at=NULL,
        dispatch_attempts=0,available_at=clock_timestamp(),
        execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
        WHERE id=$1::uuid`, [existing.id, args.actor_user_id]);
      await client.query("COMMIT");
      return { run_id: existing.id, replayed: false };
    }
    const received = (await client.query(`SELECT 1 FROM import_batches
      WHERE workspace_id=$1::uuid AND status='completed' LIMIT 1`, [args.workspace_id])).rows.length > 0;
    if (!received) throw new SignalWorkspaceCorpusPreparationError("corpus_preparation_import_required", 409);
    const runId = randomUUID();
    await client.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,request_keys,worker_job_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,jsonb_build_object($4::text,$3::text),$5)`,
    [runId, args.workspace_id, args.actor_user_id, args.idempotency_key, `corpus-preparation-${runId}-1`]);
    await client.query("COMMIT");
    return { run_id: runId, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
